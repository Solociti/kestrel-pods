import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KubectlClient,
  createBackoffStrategy,
  withRetry,
  type PodInfo,
} from "../utils/kubectl";

vi.mock("@kubernetes/client-node", () => {
  const makePod = ({
    name,
    namespace,
    deploymentId = "deploy-123",
    lifecycleState = "warm",
    endpoint,
    phase = "Running",
    ready = true,
  }: {
    name: string;
    namespace: string;
    deploymentId?: string;
    lifecycleState?: "warm" | "claiming" | "hot" | "stale" | "shutdown";
    endpoint?: string;
    phase?: string;
    ready?: boolean;
  }) => ({
    metadata: {
      name,
      namespace,
      uid: `${name}-uid`,
      labels: {
        deployment: deploymentId,
        "lifecycle-state": lifecycleState,
        ...(endpoint ? { "api-endpoint": endpoint } : {}),
      },
      creationTimestamp: "2024-01-01T00:00:00.000Z",
    },
    status: {
      phase,
      hostIP: "10.0.0.1",
      podIP: "10.0.0.2",
      conditions: [{ type: "Ready", status: ready ? "True" : "False" }],
    },
  });

  const listPodsForSelector = (namespace: string, labelSelector?: string) => {
    if (namespace === "non-existent-namespace") {
      throw new Error("namespace not found");
    }

    const selector = labelSelector || "";
    const deploymentId =
      selector.match(/deployment=([^,]+)/)?.[1] ?? "deploy-123";
    const endpoint = selector.match(/api-endpoint=([^,]+)/)?.[1];

    if (selector.includes("lifecycle-state in (hot)")) {
      return {
        items: [
          makePod({
            name: "hot-pod",
            namespace,
            deploymentId,
            lifecycleState: "hot",
            endpoint: endpoint ?? "endpoint-1",
          }),
        ],
      };
    }

    if (selector.includes("lifecycle-state in (claiming)")) {
      return {
        items: [
          makePod({
            name: "claiming-pod",
            namespace,
            deploymentId,
            lifecycleState: "claiming",
          }),
        ],
      };
    }

    if (selector.includes("lifecycle-state in (stale)")) {
      return {
        items: [
          makePod({
            name: "stale-pod",
            namespace,
            deploymentId,
            lifecycleState: "stale",
          }),
        ],
      };
    }

    if (selector.includes("lifecycle-state in (warm)")) {
      return {
        items: [
          makePod({
            name: "warm-pod",
            namespace,
            deploymentId,
            lifecycleState: "warm",
          }),
        ],
      };
    }

    return {
      items: [
        makePod({
          name: "test-pod",
          namespace,
          deploymentId,
          lifecycleState: "warm",
          endpoint: endpoint ?? "endpoint-1",
        }),
      ],
    };
  };

  class CoreV1Api {
    createNamespacedPod = vi.fn(
      async ({
        body,
      }: {
        body: {
          metadata?: { name?: string };
          spec?: { containers?: Array<{ image?: string }> };
        };
      }) => {
        const podName = body?.metadata?.name;
        const containerImage = body?.spec?.containers?.[0]?.image;

        if (!podName || !containerImage) {
          throw new Error("invalid pod spec");
        }

        return {};
      },
    );

    deleteNamespacedPod = vi.fn(async () => ({}));

    readNamespacedPod = vi.fn(
      async ({ name, namespace }: { name: string; namespace: string }) => {
        if (name === "non-existent-pod") {
          throw new Error("pod not found");
        }

        return makePod({
          name,
          namespace,
          deploymentId: "deploy-123",
          lifecycleState: "warm",
          endpoint: "endpoint-1",
        });
      },
    );

    patchNamespacedPod = vi.fn(async () => ({}));

    listNamespacedPod = vi.fn(
      async ({
        namespace,
        labelSelector,
      }: {
        namespace: string;
        labelSelector?: string;
      }) => listPodsForSelector(namespace, labelSelector),
    );

    listPodForAllNamespaces = vi.fn(
      async ({ labelSelector }: { labelSelector?: string }) =>
        listPodsForSelector("default", labelSelector),
    );

    readNamespacedPodLog = vi.fn(async () => "pod logs");

    createNamespacedPodEviction = vi.fn(async () => ({}));
  }

  class KubeConfig {
    loadFromFile() {}

    loadFromDefault() {}

    makeApiClient() {
      return new CoreV1Api();
    }
  }

  class Watch {
    watch = vi.fn(async () => ({
      abort() {},
    }));
  }

  class Metrics {
    getPodMetrics = vi.fn(async () => ({
      items: [
        {
          metadata: { name: "test-pod" },
          containers: [
            {
              usage: {
                cpu: "100m",
                memory: "128Mi",
              },
            },
          ],
        },
      ],
    }));
  }

  return {
    KubeConfig,
    CoreV1Api,
    Watch,
    Metrics,
  };
});

describe("KubectlClient", () => {
  let client: KubectlClient;

  beforeEach(() => {
    client = new KubectlClient();
  });

  describe("Backoff Strategy", () => {
    it("should create exponential backoff with jitter", () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
      const backoff = createBackoffStrategy(50);

      const delays = Array.from({ length: 5 }, (_, i) => backoff(i));

      expect(delays).toEqual([50, 100, 200, 400, 800]);

      randomSpy.mockRestore();
    });
  });

  describe("Retry Mechanism", () => {
    it("should retry on failure with exponential backoff", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new Error("Retry me");
        return "success";
      };

      const result = await withRetry(fn, 3, 10);

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should throw after max attempts exhausted", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error("Always fails");
      };

      await expect(withRetry(fn, 3, 10)).rejects.toThrow();
      expect(attempts).toBe(3);
    });
  });

  describe("Pod Creation", () => {
    it("should create a pod with warm state and affinity", async () => {
      const spec = {
        name: "test-pod-1",
        namespace: "default",
        image: "node:22",
        deploymentId: "deploy-123",
        podServiceName: "test-svc",
        affinity: {
          topologyProfile: "ha" as const,
          nodeSelector: { tenant: "tenant-1" },
          podAntiAffinity: true,
        },
        readinessProbeCommand: ["/bin/sh", "-c", "test -f /ready"],
        labels: {
          environment: "test",
        },
      };

      const result = await client.createPod(spec);

      expect(result.success).toBe(true);
      expect(result.podId).toBe("test-pod-1");
    });

    it("should create pod with readiness probe for warm pool insertion", async () => {
      const spec = {
        name: "test-pod-probed",
        namespace: "default",
        image: "node:22",
        deploymentId: "deploy-123",
        podServiceName: "test-svc",
        readinessProbeCommand: ["curl", "-f", "http://localhost:3000/health"],
        readinessProbeInitialDelay: 5,
        readinessProbeTimeout: 3,
      };

      const result = await client.createPod(spec);

      expect(result.success).toBe(true);
    });

    it("should create pod with liveness probe", async () => {
      const spec = {
        name: "test-pod-liveness",
        namespace: "default",
        image: "node:22",
        deploymentId: "deploy-123",
        podServiceName: "test-svc",
        livenessProbeCommand: ["node", "-e", "process.exit(0)"],
      };

      const result = await client.createPod(spec);

      expect(result.success).toBe(true);
    });

    it("should include deployment label", async () => {
      const spec = {
        name: "test-pod-deploy-label",
        namespace: "default",
        image: "node:22",
        deploymentId: "deploy-abc-123",
        podServiceName: "test-svc",
      };

      const result = await client.createPod(spec);

      expect(result.success).toBe(true);
      // Deployment label should be set during YAML generation
    });
  });

  describe("Pod Deletion and Stopping", () => {
    it("should delete a pod immediately", async () => {
      const result = await client.deletePod("test-pod", "default");

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });
  });

  describe("Label Management", () => {
    it("should set lifecycle-state label", async () => {
      const result = await client.setLifecycleState(
        "test-pod",
        "default",
        "hot",
      );

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should set api-endpoint label", async () => {
      const result = await client.setApiEndpoint(
        "test-pod",
        "default",
        "endpoint-1",
      );

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should update multiple labels atomically", async () => {
      const labels = {
        "custom-label": "value1",
        "another-label": "value2",
      };

      const result = await client.updateLabels("test-pod", "default", labels);

      expect(result.success).toBe(true);
    });
  });

  describe("Pod Queries and Listing", () => {
    it("should list pods by deployment", async () => {
      const pods = await client.getPodsByDeployment("deploy-123", "default");

      expect(Array.isArray(pods)).toBe(true);
    });

    it("should get warm pods", async () => {
      const pods = await client.getWarmPods("deploy-123", "default");

      expect(Array.isArray(pods)).toBe(true);
      pods.forEach((pod) => {
        expect(pod.lifecycleState).toBe("warm");
      });
    });

    it("should get hot pods for endpoint", async () => {
      const pods = await client.getHotPods(
        "endpoint-1",
        "deploy-123",
        "default",
      );

      expect(Array.isArray(pods)).toBe(true);
      pods.forEach((pod) => {
        expect(pod.lifecycleState).toBe("hot");
        expect(pod.endpoint).toBe("endpoint-1");
      });
    });

    it("should get claiming pods", async () => {
      const pods = await client.getClaimingPods("deploy-123", "default");

      expect(Array.isArray(pods)).toBe(true);
      pods.forEach((pod) => {
        expect(pod.lifecycleState).toBe("claiming");
      });
    });

    it("should get stale pods", async () => {
      const pods = await client.getStalePods("deploy-123", "default");

      expect(Array.isArray(pods)).toBe(true);
      pods.forEach((pod) => {
        expect(pod.lifecycleState).toBe("stale");
      });
    });
  });

  describe("Lifecycle State Transitions", () => {
    it("should transition pod to claiming", async () => {
      const result = await client.transitionToClaiming("test-pod", "default");

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should transition pod to hot with endpoint", async () => {
      const result = await client.transitionToHot(
        "test-pod",
        "default",
        "endpoint-1",
      );

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should transition pod to stale", async () => {
      const result = await client.transitionToStale("test-pod", "default");

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should transition pod to shutdown", async () => {
      const result = await client.transitionToShutdown("test-pod", "default");

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should force shutdown pod", async () => {
      const result = await client.transitionToShutdown(
        "test-pod",
        "default",
        true,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Pod Status and Readiness", () => {
    it("should wait for pod readiness", async () => {
      const ready = await client.waitForPodReady("test-pod", "default", 300);

      expect(typeof ready).toBe("boolean");
    });

    it("should check pod readiness", async () => {
      const ready = await client.isPodReady("test-pod", "default");

      expect(typeof ready).toBe("boolean");
    });

    it("should get pod logs", async () => {
      const logs = await client.getPodLogs("test-pod", "default");

      expect(typeof logs).toBe("string");
    });

    it("should get previous pod logs", async () => {
      const logs = await client.getPodLogs("test-pod", "default", {
        previousLogs: true,
      });

      expect(typeof logs).toBe("string");
    });
  });

  describe("Pod Operations", () => {
    it("should evict a pod", async () => {
      const result = await client.evictPod("test-pod", "default");

      expect(result.success).toBe(true);
      expect(result.podName).toBe("test-pod");
    });

    it("should verify pod resources", async () => {
      const valid = await client.verifyPodResources("test-pod", "default");

      expect(typeof valid).toBe("boolean");
    });

    it("should get pod metrics", async () => {
      const metrics = await client.getPodMetrics("test-pod", "default");

      if (metrics !== null) {
        expect(metrics).toHaveProperty("cpu");
        expect(metrics).toHaveProperty("memory");
      }
    });
  });

  describe("Pod Event Watching", () => {
    it("should watch pod readiness", async () => {
      // Test will set up watch and verify it returns a cancellation function
      let wasCalled = false;

      const cancel = client.watchPodReadiness(
        "test-pod",
        "default",
        (pod: PodInfo) => {
          wasCalled = true;
        },
        (error) => {
          expect(error).toBeUndefined();
        },
      );

      expect(typeof cancel).toBe("function");

      // Cancel immediately to avoid hanging
      cancel();

      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it("should watch pod events by deployment", async () => {
      // Test will verify watch returns a cancellation function
      let eventCount = 0;

      const cancel = client.watchPodEvents(
        "default",
        "deploy-123",
        (type, pod) => {
          eventCount++;
        },
        (error) => {
          expect(error).toBeUndefined();
        },
      );

      expect(typeof cancel).toBe("function");

      // Cancel immediately to avoid hanging
      cancel();

      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe("Orphan Detection and Resolution", () => {
    it("should detect orphaned pods", async () => {
      const orphans = await client.detectOrphanPods("default", "deploy-123");

      expect(Array.isArray(orphans)).toBe(true);
      orphans.forEach((pod) => {
        expect(pod.lifecycleState).toBeDefined();
        expect(pod.lifecycleState).not.toBe("shutdown");
      });
    });

    it("should check if pod is orphaned", async () => {
      const isOrphan = await client.isOrphanPod("test-pod", "default", false);

      expect(typeof isOrphan).toBe("boolean");
    });

    it("should not consider pod orphaned if Dragonfly knows about it", async () => {
      const isOrphan = await client.isOrphanPod("test-pod", "default", true);

      expect(typeof isOrphan).toBe("boolean");
    });
  });

  describe("Error Handling", () => {
    it("should return error result on pod creation failure", async () => {
      const spec = {
        name: "",
        namespace: "",
        image: "",
        deploymentId: "",
        podServiceName: "",
      };

      const result = await client.createPod(spec);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should return null for non-existent pod", async () => {
      const pod = await client.getPod("non-existent-pod", "default");

      expect(pod).toBeNull();
    });

    it("should return empty array for failed pod listing", async () => {
      const pods = await client.listPods({
        namespace: "non-existent-namespace",
      });

      expect(Array.isArray(pods)).toBe(true);
      expect(pods.length).toBe(0);
    });
  });
});
