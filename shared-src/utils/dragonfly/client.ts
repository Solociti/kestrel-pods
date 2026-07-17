import type {
  ClaimedWarmPod,
  DragonflyAdapterOptions,
  DragonflyClient,
  DragonflyPodPayload,
  DragonflyPodRecord,
  HotSelectionOptions,
  HotSelectionResult,
} from "./types";
import { warmAvailableKey, warmClaimingKey } from "./types";

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Creates exponential backoff with plan-aligned jitter.
 * Jitter is computed as Math.random() * backoff on each retry.
 */
export function createDragonflyBackoffStrategy(
  initialDelayMs: number = 50,
): (attempt: number) => number {
  return (attempt: number) => {
    const exponentialBackoff = initialDelayMs * Math.pow(2, attempt - 1);
    return Math.random() * exponentialBackoff;
  };
}

/**
 * Retry helper for Dragonfly read/write operations.
 */
export async function withDragonflyRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelayMs: number = 50,
): Promise<T> {
  const backoffStrategy = createDragonflyBackoffStrategy(initialDelayMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw normalizeError(error);
      }

      const delayMs = backoffStrategy(attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Retry exhausted");
}

function parsePodPayload(rawPayload: string): DragonflyPodPayload {
  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;

  if (
    typeof parsed.deploymentId !== "string" ||
    typeof parsed.podServiceName !== "string" ||
    typeof parsed.namespace !== "string" ||
    typeof parsed.podHostName !== "string"
  ) {
    throw new Error("Invalid Dragonfly pod payload shape");
  }

  if (
    typeof parsed["api-endpoint"] !== "undefined" &&
    typeof parsed["api-endpoint"] !== "string"
  ) {
    throw new Error("Invalid Dragonfly api-endpoint value");
  }

  return {
    deploymentId: parsed.deploymentId,
    podServiceName: parsed.podServiceName,
    namespace: parsed.namespace,
    podHostName: parsed.podHostName,
    "api-endpoint": parsed["api-endpoint"],
  };
}

function parsePodRecord(rawRecord: string): DragonflyPodRecord {
  const parsed = JSON.parse(rawRecord) as Record<string, unknown>;

  if (
    parsed.state !== "warm" &&
    parsed.state !== "claiming" &&
    parsed.state !== "hot" &&
    parsed.state !== "stale" &&
    parsed.state !== "shutdown"
  ) {
    throw new Error("Invalid Dragonfly pod record state");
  }

  return {
    ...parsePodPayload(rawRecord),
    state: parsed.state,
  };
}

export function derivePodHostName(
  podServiceName: string,
  namespace: string,
): string {
  return `${podServiceName}.${namespace}.svc.cluster.local`;
}

/**
 * Adapter for Dragonfly lifecycle operations used by Router and Scheduler Routine.
 */
export class DragonflyAdapter {
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;

  constructor(
    private readonly client: DragonflyClient,
    options: DragonflyAdapterOptions = {},
  ) {
    this.maxAttempts = options.retryPolicy?.maxAttempts ?? 3;
    this.initialDelayMs = options.retryPolicy?.initialDelayMs ?? 50;
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    return withDragonflyRetry(fn, this.maxAttempts, this.initialDelayMs);
  }

  static hotKey(deploymentId: string, endpoint: string): string {
    return `hot:${deploymentId}:${endpoint}`;
  }

  static podKey(deploymentId: string, podId: string): string {
    return `pod:${deploymentId}:${podId}`;
  }

  buildPodPayload(input: {
    deploymentId: string;
    podServiceName: string;
    namespace: string;
    endpoint?: string;
  }): DragonflyPodPayload {
    return {
      deploymentId: input.deploymentId,
      podServiceName: input.podServiceName,
      namespace: input.namespace,
      podHostName: derivePodHostName(input.podServiceName, input.namespace),
      "api-endpoint": input.endpoint,
    };
  }

  async registerWarmPod(
    deploymentId: string,
    podId: string,
    payload: DragonflyPodPayload,
  ): Promise<void> {
    const record: DragonflyPodRecord = { ...payload, state: "warm" };
    await this.retry(() =>
      this.client.set(
        DragonflyAdapter.podKey(deploymentId, podId),
        JSON.stringify(record),
      ),
    );
    await this.retry(() =>
      this.client.rPush(warmAvailableKey, JSON.stringify(payload)),
    );
  }

  async claimWarmPod(): Promise<ClaimedWarmPod | null> {
    const rawPayload = await this.retry(() =>
      this.client.lMove(warmAvailableKey, warmClaimingKey, "LEFT", "RIGHT"),
    );

    if (rawPayload === null) {
      return null;
    }

    return {
      rawPayload,
      payload: parsePodPayload(rawPayload),
    };
  }

  async updatePodRecord(
    deploymentId: string,
    podId: string,
    record: DragonflyPodRecord,
  ): Promise<void> {
    await this.retry(() =>
      this.client.set(
        DragonflyAdapter.podKey(deploymentId, podId),
        JSON.stringify(record),
      ),
    );
  }

  async getPodRecord(
    deploymentId: string,
    podId: string,
  ): Promise<DragonflyPodRecord | null> {
    const rawRecord = await this.retry(() =>
      this.client.get(DragonflyAdapter.podKey(deploymentId, podId)),
    );

    if (rawRecord === null) {
      return null;
    }

    return parsePodRecord(rawRecord);
  }

  async markClaimingPodHot(input: {
    deploymentId: string;
    podId: string;
    endpoint: string;
    claimedWarmPod: ClaimedWarmPod;
  }): Promise<void> {
    await this.retry(() =>
      this.client.lRem(warmClaimingKey, 1, input.claimedWarmPod.rawPayload),
    );

    await this.retry(() =>
      this.client.rPush(
        DragonflyAdapter.hotKey(input.deploymentId, input.endpoint),
        input.podId,
      ),
    );

    const updatedRecord: DragonflyPodRecord = {
      ...input.claimedWarmPod.payload,
      "api-endpoint": input.endpoint,
      state: "hot",
    };
    await this.updatePodRecord(input.deploymentId, input.podId, updatedRecord);
  }

  async removePodFromHot(
    deploymentId: string,
    endpoint: string,
    podId: string,
  ): Promise<number> {
    return this.retry(() =>
      this.client.lRem(
        DragonflyAdapter.hotKey(deploymentId, endpoint),
        0,
        podId,
      ),
    );
  }

  async removePodRecord(deploymentId: string, podId: string): Promise<void> {
    await this.retry(() =>
      this.client.del(DragonflyAdapter.podKey(deploymentId, podId)),
    );
  }

  async transitionPodToStale(
    deploymentId: string,
    podId: string,
  ): Promise<DragonflyPodRecord | null> {
    const current = await this.getPodRecord(deploymentId, podId);
    if (!current) {
      return null;
    }

    if (typeof current["api-endpoint"] === "string") {
      await this.removePodFromHot(deploymentId, current["api-endpoint"], podId);
    }

    const next: DragonflyPodRecord = {
      ...current,
      "api-endpoint": undefined,
      state: "stale",
    };
    await this.updatePodRecord(deploymentId, podId, next);

    return next;
  }

  async transitionPodToShutdown(
    deploymentId: string,
    podId: string,
  ): Promise<DragonflyPodRecord | null> {
    const current = await this.getPodRecord(deploymentId, podId);
    if (!current) {
      return null;
    }

    if (typeof current["api-endpoint"] === "string") {
      await this.removePodFromHot(deploymentId, current["api-endpoint"], podId);
    }

    const next: DragonflyPodRecord = {
      ...current,
      "api-endpoint": undefined,
      state: "shutdown",
    };
    await this.updatePodRecord(deploymentId, podId, next);

    return next;
  }

  async listHotPodIds(
    deploymentId: string,
    endpoint: string,
  ): Promise<string[]> {
    return this.retry(() =>
      this.client.lRange(
        DragonflyAdapter.hotKey(deploymentId, endpoint),
        0,
        -1,
      ),
    );
  }

  async selectHotPodRoundRobin(
    deploymentId: string,
    endpoint: string,
    options: HotSelectionOptions = {},
  ): Promise<HotSelectionResult | null> {
    const maxSelectionAttempts = options.maxSelectionAttempts ?? 3;
    const evictInvalidPodIds = options.evictInvalidPodIds ?? true;
    const key = DragonflyAdapter.hotKey(deploymentId, endpoint);

    for (let attempt = 0; attempt < maxSelectionAttempts; attempt++) {
      const podId = await this.retry(() =>
        this.client.lMove(key, key, "LEFT", "RIGHT"),
      );

      if (podId === null) {
        return null;
      }

      const record = await this.getPodRecord(deploymentId, podId);
      if (record?.state === "hot" && record["api-endpoint"] === endpoint) {
        return { podId, record };
      }

      if (evictInvalidPodIds) {
        await this.retry(() => this.client.lRem(key, 0, podId));
      }
    }

    return null;
  }

  async waitAndSelectHotPod(input: {
    deploymentId: string;
    endpoint: string;
    waitTimeoutSeconds: number;
    evictInvalidPodIds?: boolean;
  }): Promise<HotSelectionResult | null> {
    const key = DragonflyAdapter.hotKey(input.deploymentId, input.endpoint);
    const podId = await this.retry(() =>
      this.client.blMove(key, key, "LEFT", "RIGHT", input.waitTimeoutSeconds),
    );

    if (podId === null) {
      return null;
    }

    const record = await this.getPodRecord(input.deploymentId, podId);
    if (record?.state === "hot" && record["api-endpoint"] === input.endpoint) {
      return { podId, record };
    }

    if (input.evictInvalidPodIds ?? true) {
      await this.retry(() => this.client.lRem(key, 0, podId));
    }

    return null;
  }
}

export default DragonflyAdapter;
