import { beforeEach, describe, expect, it } from "vitest";
import {
  createDragonflyBackoffStrategy,
  derivePodHostName,
  DragonflyAdapter,
  type DragonflyClient,
  warmAvailableKey,
  warmClaimingKey,
} from "../utils/dragonfly";

class InMemoryDragonflyClient implements DragonflyClient {
  private readonly strings = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();

  private getList(key: string): string[] {
    const current = this.lists.get(key);
    if (current) {
      return current;
    }

    const next: string[] = [];
    this.lists.set(key, next);
    return next;
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;

    for (const key of keys) {
      const deletedString = this.strings.delete(key);
      const deletedList = this.lists.delete(key);
      if (deletedString || deletedList) {
        removed++;
      }
    }

    return removed;
  }

  async lMove(
    source: string,
    destination: string,
    whereFrom: "LEFT" | "RIGHT",
    whereTo: "LEFT" | "RIGHT",
  ): Promise<string | null> {
    const sourceList = this.getList(source);
    if (sourceList.length === 0) {
      return null;
    }

    const value = whereFrom === "LEFT" ? sourceList.shift() : sourceList.pop();
    if (typeof value === "undefined") {
      return null;
    }

    const destinationList = this.getList(destination);
    if (whereTo === "LEFT") {
      destinationList.unshift(value);
    } else {
      destinationList.push(value);
    }

    return value;
  }

  async blMove(
    source: string,
    destination: string,
    whereFrom: "LEFT" | "RIGHT",
    whereTo: "LEFT" | "RIGHT",
    timeoutSeconds: number,
  ): Promise<string | null> {
    void timeoutSeconds;
    return this.lMove(source, destination, whereFrom, whereTo);
  }

  async rPush(key: string, ...elements: string[]): Promise<number> {
    const list = this.getList(key);
    list.push(...elements);
    return list.length;
  }

  async lRem(key: string, count: number, element: string): Promise<number> {
    const list = this.getList(key);

    if (count > 0) {
      let removed = 0;
      const kept: string[] = [];

      for (const item of list) {
        if (item === element && removed < count) {
          removed++;
        } else {
          kept.push(item);
        }
      }

      this.lists.set(key, kept);
      return removed;
    }

    const kept = list.filter((item) => item !== element);
    const removed = list.length - kept.length;
    this.lists.set(key, kept);
    return removed;
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.getList(key);
    const actualStop = stop === -1 ? list.length - 1 : stop;

    if (actualStop < start) {
      return [];
    }

    return list.slice(start, actualStop + 1);
  }
}

class FlakyGetClient extends InMemoryDragonflyClient {
  private attempts = 0;

  async get(key: string): Promise<string | null> {
    this.attempts++;
    if (this.attempts < 3) {
      throw new Error("transient read failure");
    }

    return super.get(key);
  }
}

describe("DragonflyAdapter", () => {
  let adapter: DragonflyAdapter;
  let client: InMemoryDragonflyClient;

  beforeEach(() => {
    client = new InMemoryDragonflyClient();
    adapter = new DragonflyAdapter(client);
  });

  describe("contract helpers", () => {
    it("builds key names that match plan contract", () => {
      expect(warmAvailableKey).toBe("warm:available");
      expect(warmClaimingKey).toBe("warm:claiming");
      expect(DragonflyAdapter.hotKey("deploy-1", "hello")).toBe(
        "hot:deploy-1:hello",
      );
      expect(DragonflyAdapter.podKey("deploy-1", "pod-1")).toBe(
        "pod:deploy-1:pod-1",
      );
    });

    it("derives pod host names correctly", () => {
      expect(derivePodHostName("svc-1", "tenant-a")).toBe(
        "svc-1.tenant-a.svc.cluster.local",
      );
    });

    it("creates payloads with derived host name", () => {
      const payload = adapter.buildPodPayload({
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
      });

      expect(payload).toEqual({
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
        podHostName: "svc-1.tenant-a.svc.cluster.local",
        "api-endpoint": undefined,
      });
    });
  });

  describe("warm and claiming flow", () => {
    it("registers warm pod and claims it via lmove", async () => {
      const payload = adapter.buildPodPayload({
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
      });

      await adapter.registerWarmPod("deploy-1", "pod-1", payload);

      const record = await adapter.getPodRecord("deploy-1", "pod-1");
      expect(record?.state).toBe("warm");

      const claimed = await adapter.claimWarmPod();
      expect(claimed).not.toBeNull();
      expect(claimed?.payload.podServiceName).toBe("svc-1");

      const claimingEntries = await client.lRange(warmClaimingKey, 0, -1);
      expect(claimingEntries).toHaveLength(1);
    });

    it("returns null on nil-claim", async () => {
      const claimed = await adapter.claimWarmPod();
      expect(claimed).toBeNull();
    });
  });

  describe("hot transition and selection", () => {
    it("moves claiming payload to hot list and updates pod record", async () => {
      const payload = adapter.buildPodPayload({
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
      });
      await adapter.registerWarmPod("deploy-1", "pod-1", payload);

      const claimed = await adapter.claimWarmPod();
      expect(claimed).not.toBeNull();
      if (!claimed) {
        throw new Error("Expected a claimed warm pod");
      }

      await adapter.markClaimingPodHot({
        deploymentId: "deploy-1",
        podId: "pod-1",
        endpoint: "hello",
        claimedWarmPod: claimed,
      });

      const hotPodIds = await adapter.listHotPodIds("deploy-1", "hello");
      expect(hotPodIds).toEqual(["pod-1"]);

      const record = await adapter.getPodRecord("deploy-1", "pod-1");
      expect(record?.state).toBe("hot");
      expect(record?.["api-endpoint"]).toBe("hello");

      const claimingEntries = await client.lRange(warmClaimingKey, 0, -1);
      expect(claimingEntries).toHaveLength(0);
    });

    it("selects hot pods with round-robin rotation", async () => {
      await client.rPush(DragonflyAdapter.hotKey("deploy-1", "hello"), "pod-1");
      await client.rPush(DragonflyAdapter.hotKey("deploy-1", "hello"), "pod-2");

      await adapter.updatePodRecord("deploy-1", "pod-1", {
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
        podHostName: "svc-1.tenant-a.svc.cluster.local",
        "api-endpoint": "hello",
        state: "hot",
      });

      await adapter.updatePodRecord("deploy-1", "pod-2", {
        deploymentId: "deploy-1",
        podServiceName: "svc-2",
        namespace: "tenant-a",
        podHostName: "svc-2.tenant-a.svc.cluster.local",
        "api-endpoint": "hello",
        state: "hot",
      });

      const first = await adapter.selectHotPodRoundRobin("deploy-1", "hello");
      const second = await adapter.selectHotPodRoundRobin("deploy-1", "hello");

      expect(first?.podId).toBe("pod-1");
      expect(second?.podId).toBe("pod-2");
    });

    it("evicts invalid hot pod ids and returns null when no valid pods remain", async () => {
      await client.rPush(DragonflyAdapter.hotKey("deploy-1", "hello"), "pod-stale");

      await adapter.updatePodRecord("deploy-1", "pod-stale", {
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
        podHostName: "svc-1.tenant-a.svc.cluster.local",
        "api-endpoint": "hello",
        state: "stale",
      });

      const selected = await adapter.selectHotPodRoundRobin("deploy-1", "hello", {
        maxSelectionAttempts: 1,
      });

      expect(selected).toBeNull();
      const remaining = await adapter.listHotPodIds("deploy-1", "hello");
      expect(remaining).toEqual([]);
    });

    it("transitions hot pod to stale by removing hot membership and clearing endpoint", async () => {
      await client.rPush(DragonflyAdapter.hotKey("deploy-1", "hello"), "pod-1");
      await adapter.updatePodRecord("deploy-1", "pod-1", {
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
        podHostName: "svc-1.tenant-a.svc.cluster.local",
        "api-endpoint": "hello",
        state: "hot",
      });

      const stale = await adapter.transitionPodToStale("deploy-1", "pod-1");
      expect(stale?.state).toBe("stale");
      expect(stale?.["api-endpoint"]).toBeUndefined();

      const hotPodIds = await adapter.listHotPodIds("deploy-1", "hello");
      expect(hotPodIds).toEqual([]);
    });

    it("transitions pod to shutdown and keeps record as reconciliation-managed", async () => {
      await client.rPush(DragonflyAdapter.hotKey("deploy-1", "hello"), "pod-1");
      await adapter.updatePodRecord("deploy-1", "pod-1", {
        deploymentId: "deploy-1",
        podServiceName: "svc-1",
        namespace: "tenant-a",
        podHostName: "svc-1.tenant-a.svc.cluster.local",
        "api-endpoint": "hello",
        state: "hot",
      });

      const shutdown = await adapter.transitionPodToShutdown("deploy-1", "pod-1");
      expect(shutdown?.state).toBe("shutdown");
      expect(shutdown?.["api-endpoint"]).toBeUndefined();

      const stillStored = await adapter.getPodRecord("deploy-1", "pod-1");
      expect(stillStored?.state).toBe("shutdown");
      const hotPodIds = await adapter.listHotPodIds("deploy-1", "hello");
      expect(hotPodIds).toEqual([]);
    });
  });

  describe("retries", () => {
    it("retries transient dragonfly read failures", async () => {
      const flaky = new FlakyGetClient();
      const flakyAdapter = new DragonflyAdapter(flaky, {
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 1,
        },
      });

      await flaky.set(
        DragonflyAdapter.podKey("deploy-1", "pod-1"),
        JSON.stringify({
          deploymentId: "deploy-1",
          podServiceName: "svc-1",
          namespace: "tenant-a",
          podHostName: "svc-1.tenant-a.svc.cluster.local",
          "api-endpoint": "hello",
          state: "hot",
        }),
      );

      const record = await flakyAdapter.getPodRecord("deploy-1", "pod-1");
      expect(record?.state).toBe("hot");
    });

    it("builds bounded jittered backoff delays", () => {
      const backoff = createDragonflyBackoffStrategy(50);

      for (let attempt = 1; attempt <= 4; attempt++) {
        const delay = backoff(attempt);
        const maxDelay = 50 * Math.pow(2, attempt - 1);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(maxDelay);
      }
    });
  });
});