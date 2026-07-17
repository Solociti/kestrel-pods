import * as k8s from "@kubernetes/client-node";

import type {
  KestrelLabels,
  LifecycleState,
  OperationResult,
  PodAffinity,
  PodCreateSpec,
  PodInfo,
  PodQueryCriteria,
} from "./types";

/**
 * Exponential backoff with jitter per Dragonfly Availability Failure Handling decision.
 *
 * @internal
 */
export function createBackoffStrategy(
  initialDelayMs: number = 50,
): (attempt: number) => number {
  return (attempt: number) => {
    const jitter = Math.random();
    const power = Math.pow(2, attempt);

    return initialDelayMs * (power * jitter);
  };
}

/**
 * Retry a function with exponential backoff.
 * Per Dragonfly Availability Failure Handling: up to 3 attempts with 50ms initial backoff and jitter.
 *
 * @internal
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelayMs: number = 50,
): Promise<T> {
  const backoff = createBackoffStrategy(initialDelayMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      } else {
        const delayMs = backoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // fallback, should not reach here due to throw in catch
  throw new Error("Retry exhausted");
}

/**
 * Normalize kubernetes client errors to standard Error objects.
 *
 * @param error
 * @returns
 */
function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Kubectl client for pod operations aligned with Kestrel lifecycle model.
 * Implements operations from the Base Reliability Model and Pod Specification.
 *
 * **Architectural Note**: This is a lower-level Kubernetes abstraction layer.
 * Higher-level components (Scheduler Routine, Router) handle Dragonfly lifecycle state management
 * and use this client for Kubernetes-specific pod operations.
 * Per Dragonfly Lifecycle State Contract: Kubernetes labels are projections that must converge
 * to Dragonfly state after reconciliation.
 */
export class KubectlClient {
  private kubeConfig: k8s.KubeConfig;
  private coreV1: k8s.CoreV1Api;
  private watch: k8s.Watch;
  private metrics: k8s.Metrics;
  private kubeconfig?: string;

  constructor(kubeconfig?: string) {
    this.kubeconfig = kubeconfig;

    this.kubeConfig = new k8s.KubeConfig();
    if (this.kubeconfig) {
      this.kubeConfig.loadFromFile(this.kubeconfig);
    } else {
      this.kubeConfig.loadFromDefault();
    }

    this.coreV1 = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.watch = new k8s.Watch(this.kubeConfig);
    this.metrics = new k8s.Metrics(this.kubeConfig);
  }

  // ============================================================================
  // Pod Creation and Lifecycle
  // ============================================================================

  /**
   * Create a new pod for deployment.
   * Initial pod state is "warm" (not yet claimed).
   * Sets: lifecycle-state=warm, deployment label, custom labels.
   *
   * Per Dragonfly Lifecycle State Contract: pod starts in warm state.
   * Per Tenant Isolation Boundary: enforces node selectors and pod affinity policies.
   * Per Warm Pool Management: pod should include readiness probe for warm pool insertion.
   */
  async createPod(spec: PodCreateSpec): Promise<OperationResult> {
    try {
      const labels: KestrelLabels = {
        "lifecycle-state": "warm",
        deployment: spec.deploymentId,
        ...spec.labels,
      };

      const podManifest = this.buildPodManifest(spec, labels);
      await withRetry(() =>
        this.coreV1.createNamespacedPod({
          namespace: spec.namespace,
          body: podManifest,
        }),
      );

      return {
        success: true,
        podId: spec.name,
        podName: spec.name,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  /**
   * Build pod manifest from spec using Kubernetes SDK types.
   * Includes resource requests, env vars, Kestrel labels, affinity policies,
   * and readiness probes for warm pool insertion.
   * Per Tenant Isolation Boundary: includes pod affinity and node selectors.
   * @internal
   */
  private buildPodManifest(
    spec: PodCreateSpec,
    labels: KestrelLabels,
  ): k8s.V1Pod {
    const readinessProbe: k8s.V1Probe | undefined = spec.readinessProbeCommand
      ? {
          exec: {
            command: spec.readinessProbeCommand,
          },
          initialDelaySeconds: spec.readinessProbeInitialDelay || 10,
          timeoutSeconds: spec.readinessProbeTimeout || 5,
          periodSeconds: 10,
          successThreshold: 1,
          failureThreshold: 3,
        }
      : undefined;

    const livenessProbe: k8s.V1Probe | undefined = spec.livenessProbeCommand
      ? {
          exec: {
            command: spec.livenessProbeCommand,
          },
          initialDelaySeconds: 30,
          timeoutSeconds: 5,
          periodSeconds: 10,
          failureThreshold: 3,
        }
      : undefined;

    const container: k8s.V1Container = {
      name: "workload",
      image: spec.image,
      imagePullPolicy: "IfNotPresent",
      env: spec.env,
      resources: spec.resources,
      readinessProbe,
      livenessProbe,
    };

    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels: this.toStringLabels(labels),
      },
      spec: {
        containers: [container],
        restartPolicy: "Never",
        terminationGracePeriodSeconds: 60,
        nodeSelector: spec.affinity?.nodeSelector,
        affinity: this.buildAffinitySpec(spec.affinity),
      },
    };
  }

  /**
   * Convert possibly-undefined label map values to strict Kubernetes string labels.
   * @internal
   */
  private toStringLabels(
    labels: Record<string, string | undefined>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(labels).filter(
        (entry): entry is [string, string] => typeof entry[1] !== "undefined",
      ),
    );
  }

  /**
   * Build affinity spec for topology enforcement.
   * Per Tenant Isolation Boundary and Cluster Topology decisions.
   * Supports both standard (no anti-affinity) and HA (multi-node) profiles.
   * @internal
   */
  private buildAffinitySpec(
    affinity: PodAffinity | undefined,
  ): k8s.V1Affinity | undefined {
    if (
      !affinity ||
      (!affinity.podAntiAffinity && affinity.topologyProfile !== "ha")
    ) {
      return undefined;
    }

    if (affinity.podAntiAffinity || affinity.topologyProfile === "ha") {
      return {
        podAntiAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 100,
              podAffinityTerm: {
                labelSelector: {
                  matchExpressions: [
                    {
                      key: "deployment",
                      operator: "In",
                      values: [""],
                    },
                  ],
                },
                topologyKey: "kubernetes.io/hostname",
              },
            },
          ],
        },
      };
    }

    return undefined;
  }

  // ============================================================================
  // Pod Deletion and Cleanup
  // ============================================================================

  /**
   * Delete a pod immediately (force delete).
   * Per Scheduler Routine responsibility: hard termination after drain cap.
   */
  async deletePod(
    podName: string,
    namespace: string,
    options?: { gracePeriod?: number },
  ): Promise<OperationResult> {
    try {
      await withRetry(() =>
        this.coreV1.deleteNamespacedPod({
          name: podName,
          namespace,
          gracePeriodSeconds: options?.gracePeriod,
        }),
      );

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  // ============================================================================
  // Pod Label Management
  // ============================================================================

  /**
   * Set lifecycle-state label on a pod.
   * Per Pod Specification: lifecycle-state is managed by Scheduler Routine.
   * Legal values: warm, claiming, hot, stale, shutdown.
   */
  async setLifecycleState(
    podName: string,
    namespace: string,
    state: LifecycleState,
  ): Promise<OperationResult> {
    return this.updateLabels(podName, namespace, { "lifecycle-state": state });
  }

  /**
   * Set api-endpoint label on a pod.
   * Per Pod Specification: set during provisioning completion, cleared during stale transition.
   */
  async setApiEndpoint(
    podName: string,
    namespace: string,
    endpoint: string,
  ): Promise<OperationResult> {
    return this.updateLabels(podName, namespace, { "api-endpoint": endpoint });
  }

  /**
   * Update multiple labels on a pod atomically.
   * Used for deployment-supplied custom labels during pod creation.
   */
  async updateLabels(
    podName: string,
    namespace: string,
    labels: Record<string, string | undefined>,
  ): Promise<OperationResult> {
    try {
      const pod = await this.coreV1.readNamespacedPod({
        name: podName,
        namespace,
      });
      const currentLabels: Record<string, string> = {
        ...(pod.metadata?.labels || {}),
      };
      const patchOps: Array<{ op: string; path: string; value?: unknown }> = [];

      if (
        !pod.metadata?.labels &&
        Object.values(labels).some((value) => value !== undefined)
      ) {
        patchOps.push({ op: "add", path: "/metadata/labels", value: {} });
      }

      for (const [key, value] of Object.entries(labels)) {
        const path = `/metadata/labels/${key}`;

        if (value === undefined) {
          if (Object.hasOwn(currentLabels, key)) {
            patchOps.push({ op: "remove", path });
          }
          continue;
        }

        if (Object.hasOwn(currentLabels, key)) {
          patchOps.push({ op: "replace", path, value });
        } else {
          patchOps.push({ op: "add", path, value });
        }
      }

      if (patchOps.length > 0) {
        await withRetry(() =>
          this.coreV1.patchNamespacedPod({
            name: podName,
            namespace,
            body: patchOps,
          }),
        );
      }

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  // ============================================================================
  // Pod Queries and Listing
  // ============================================================================

  /**
   * Get pod information by name.
   */
  async getPod(podName: string, namespace: string): Promise<PodInfo | null> {
    try {
      const pod = await this.coreV1.readNamespacedPod({
        name: podName,
        namespace,
      });
      return this.parsePodData(pod);
    } catch (error) {
      return null;
    }
  }

  /**
   * List pods matching query criteria.
   * Supports filtering by deployment, endpoint, lifecycle state, and custom label selectors.
   */
  async listPods(criteria: PodQueryCriteria): Promise<PodInfo[]> {
    try {
      const labelSelector = this.buildLabelSelector(criteria);

      const result = await (async () => {
        if (criteria.namespace) {
          return await this.coreV1.listNamespacedPod({
            namespace: criteria.namespace,
            labelSelector: labelSelector || undefined,
          });
        } else {
          return await this.coreV1.listPodForAllNamespaces({
            labelSelector: labelSelector || undefined,
          });
        }
      })();

      return (result.items || []).map((item) => this.parsePodData(item));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get pods by deployment ID.
   */
  async getPodsByDeployment(
    deploymentId: string,
    namespace: string,
  ): Promise<PodInfo[]> {
    return this.listPods({
      namespace,
      deploymentId,
    });
  }

  /**
   * Get pods by endpoint and lifecycle state.
   * Used by Router for HOT pod selection.
   */
  async getHotPods(
    endpoint: string,
    deploymentId: string,
    namespace: string,
  ): Promise<PodInfo[]> {
    return this.listPods({
      namespace,
      deploymentId,
      endpoint,
      lifecycleState: "hot",
    });
  }

  /**
   * Get warm pods (ready for claiming).
   */
  async getWarmPods(
    deploymentId: string,
    namespace: string,
  ): Promise<PodInfo[]> {
    return this.listPods({
      namespace,
      deploymentId,
      lifecycleState: "warm",
    });
  }

  /**
   * Get pods in claiming state (provisioning in progress).
   */
  async getClaimingPods(
    deploymentId: string,
    namespace: string,
  ): Promise<PodInfo[]> {
    return this.listPods({
      namespace,
      deploymentId,
      lifecycleState: "claiming",
    });
  }

  /**
   * Get pods in stale state (draining).
   */
  async getStalePods(
    deploymentId: string,
    namespace: string,
  ): Promise<PodInfo[]> {
    return this.listPods({
      namespace,
      deploymentId,
      lifecycleState: "stale",
    });
  }

  /**
   * Build a kubectl label selector from query criteria.
   * @internal
   */
  private buildLabelSelector(criteria: PodQueryCriteria): string {
    const selectors: string[] = [];

    if (criteria.deploymentId) {
      selectors.push(`deployment=${criteria.deploymentId}`);
    }

    if (criteria.lifecycleState) {
      const states = Array.isArray(criteria.lifecycleState)
        ? criteria.lifecycleState
        : [criteria.lifecycleState];
      selectors.push(`lifecycle-state in (${states.join(",")})`);
    }

    if (criteria.endpoint) {
      selectors.push(`api-endpoint=${criteria.endpoint}`);
    }

    if (criteria.labelSelector) {
      selectors.push(criteria.labelSelector);
    }

    return selectors.join(",");
  }

  /**
   * Parse Kubernetes pod JSON data into PodInfo.
   * @internal
   */
  private parsePodData(podData: k8s.V1Pod): PodInfo {
    const metadata = podData.metadata || {};
    const status = podData.status || {};

    const lifecycleState = metadata.labels?.["lifecycle-state"] as
      | LifecycleState
      | undefined;
    const endpoint = metadata.labels?.["api-endpoint"] as string | undefined;

    // Check pod readiness
    const conditions = status.conditions || [];
    const readyCondition = conditions.find((c) => c.type === "Ready");
    const ready = readyCondition?.status === "True";

    return {
      id: metadata.uid || metadata.name || "unknown-pod",
      name: metadata.name || "unknown-pod",
      namespace: metadata.namespace || "default",
      deploymentId: metadata.labels?.deployment || "unknown",
      lifecycleState,
      endpoint,
      labels: metadata.labels || {},
      ready,
      phase: status.phase || "Unknown",
      hostIP: status.hostIP,
      podIP: status.podIP,
      createdAt: metadata.creationTimestamp
        ? new Date(metadata.creationTimestamp)
        : new Date(0),
    };
  }

  // ============================================================================
  // Pod Status and Readiness
  // ============================================================================

  /**
   * Wait for a pod to reach Ready condition.
   * Used during claiming -> hot transition.
   */
  async waitForPodReady(
    podName: string,
    namespace: string,
    timeoutSeconds: number = 300,
  ): Promise<boolean> {
    const start = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - start < timeoutMs) {
      const pod = await this.getPod(podName, namespace);
      if (pod?.ready) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Check if a pod is ready.
   */
  async isPodReady(podName: string, namespace: string): Promise<boolean> {
    const pod = await this.getPod(podName, namespace);
    return pod?.ready ?? false;
  }

  /**
   * Get pod logs (for troubleshooting and observability).
   */
  async getPodLogs(
    podName: string,
    namespace: string,
    options?: { tail?: number; previousLogs?: boolean },
  ): Promise<string> {
    try {
      const tailLines = options?.tail;
      const previous = options?.previousLogs;

      return await this.coreV1.readNamespacedPodLog({
        name: podName,
        namespace,
        follow: false,
        previous,
        tailLines,
      });
    } catch (error) {
      return "";
    }
  }

  // ============================================================================
  // Lifecycle State Transitions
  // ============================================================================

  /**
   * Transition pod from warm -> claiming.
   * Sets lifecycle-state label and marks deployment ownership.
   */
  async transitionToClaiming(
    podName: string,
    namespace: string,
  ): Promise<OperationResult> {
    return this.setLifecycleState(podName, namespace, "claiming");
  }

  /**
   * Transition pod from claiming -> hot.
   * Sets lifecycle-state=hot and api-endpoint label after provisioning completes.
   */
  async transitionToHot(
    podName: string,
    namespace: string,
    endpoint: string,
  ): Promise<OperationResult> {
    try {
      await this.setLifecycleState(podName, namespace, "hot");
      await this.setApiEndpoint(podName, namespace, endpoint);

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  /**
   * Transition pod to stale (draining).
   * Clears api-endpoint label and starts drain grace period.
   * Scheduler Routine owns the actual shutdown after grace period.
   */
  async transitionToStale(
    podName: string,
    namespace: string,
  ): Promise<OperationResult> {
    try {
      await this.setLifecycleState(podName, namespace, "stale");

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  /**
   * Transition pod to shutdown and delete.
   * Final cleanup after stale drain grace expires.
   */
  async transitionToShutdown(
    podName: string,
    namespace: string,
    force: boolean = false,
  ): Promise<OperationResult> {
    try {
      await this.setLifecycleState(podName, namespace, "shutdown");

      const graceSeconds = force ? 0 : 5;
      await this.deletePod(podName, namespace, { gracePeriod: graceSeconds });

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  // ============================================================================
  // Pod Eviction and Node Operations
  // ============================================================================

  /**
   * Evict a pod from a node (triggers rescheduling).
   * Used for node maintenance and migration scenarios.
   */
  async evictPod(podName: string, namespace: string): Promise<OperationResult> {
    try {
      const eviction: k8s.V1Eviction = {
        apiVersion: "policy/v1",
        kind: "Eviction",
        metadata: {
          name: podName,
          namespace,
        },
      };

      await this.coreV1.createNamespacedPodEviction({
        name: podName,
        namespace,
        body: eviction,
      });

      return {
        success: true,
        podName,
      };
    } catch (error) {
      return {
        success: false,
        error: normalizeError(error),
      };
    }
  }

  // ============================================================================
  // Pod Resource and Constraint Operations
  // ============================================================================

  /**
   * Verify pod resource compliance.
   * Returns true if pod resources match expectations.
   */
  async verifyPodResources(
    podName: string,
    namespace: string,
  ): Promise<boolean> {
    try {
      const pod = await this.getPod(podName, namespace);
      return pod !== null && pod.phase === "Running";
    } catch {
      return false;
    }
  }

  /**
   * Get pod resource usage (CPU and memory).
   * Requires metrics-server to be installed.
   */
  async getPodMetrics(
    podName: string,
    namespace: string,
  ): Promise<{ cpu?: string; memory?: string } | null> {
    try {
      const metrics = await this.metrics.getPodMetrics(namespace);
      const podMetrics = metrics.items.find(
        (item) => item.metadata.name === podName,
      );

      if (!podMetrics || podMetrics.containers.length === 0) {
        return null;
      }

      const first = podMetrics.containers[0];
      return {
        cpu: first.usage.cpu,
        memory: first.usage.memory,
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Pod Event Watching
  // ============================================================================

  /**
   * Watch pod readiness state changes.
   * Emits callback when pod transitions to Ready condition.
   * Per Warm Pool Management: "Scheduler Routine inserts warm pods into Dragonfly warm availability
   * from Kubernetes readiness events using atomic claim-safe operations."
   *
   * @param podName - Pod name
   * @param namespace - Kubernetes namespace
   * @param onReady - Callback when pod reaches Ready state
   * @param onError - Callback on watch error
   * @returns Function to cancel the watch
   */
  watchPodReadiness(
    podName: string,
    namespace: string,
    onReady: (pod: PodInfo) => void,
    onError?: (error: Error) => void,
  ): () => void {
    let abortController: AbortController | undefined;
    let cancelled = false;

    void this.watch
      .watch(
        `/api/v1/namespaces/${namespace}/pods`,
        {
          fieldSelector: `metadata.name=${podName}`,
        },
        (_phase: string, apiObj: k8s.V1Pod) => {
          if (cancelled) {
            return;
          }

          const pod = this.parsePodData(apiObj);
          if (pod.ready) {
            onReady(pod);
          }
        },
        (err: unknown) => {
          if (!cancelled && err && onError) {
            onError(err instanceof Error ? err : new Error(String(err)));
          }
        },
      )
      .then((controller) => {
        abortController = controller;
        if (cancelled) {
          abortController.abort();
        }
      })
      .catch((err) => {
        if (!cancelled && onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
      abortController?.abort();
    };
  }

  /**
   * Watch pod events for lifecycle transitions.
   * Useful for monitoring state changes across multiple pods.
   * Per Scheduler Routine reconciliation needs.
   *
   * @param namespace - Kubernetes namespace
   * @param deploymentId - Filter by deployment
   * @param onEventType - Handle different event types (Added, Modified, Deleted)
   * @param onError - Callback on watch error
   * @returns Function to cancel the watch
   */
  watchPodEvents(
    namespace: string,
    deploymentId: string,
    onEventType: (type: "ADDED" | "MODIFIED" | "DELETED", pod: PodInfo) => void,
    onError?: (error: Error) => void,
  ): () => void {
    let abortController: AbortController | undefined;
    let cancelled = false;

    void this.watch
      .watch(
        `/api/v1/namespaces/${namespace}/pods`,
        {
          labelSelector: `deployment=${deploymentId}`,
        },
        (phase: string, apiObj: k8s.V1Pod) => {
          if (cancelled) {
            return;
          }

          const mapped = phase.toUpperCase();
          if (
            mapped === "ADDED" ||
            mapped === "MODIFIED" ||
            mapped === "DELETED"
          ) {
            onEventType(mapped, this.parsePodData(apiObj));
          }
        },
        (err: unknown) => {
          if (!cancelled && err && onError) {
            onError(err instanceof Error ? err : new Error(String(err)));
          }
        },
      )
      .then((controller) => {
        abortController = controller;
        if (cancelled) {
          abortController.abort();
        }
      })
      .catch((err) => {
        if (!cancelled && onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
      abortController?.abort();
    };
  }

  // ============================================================================
  // Orphan Detection and Resolution
  // ============================================================================

  /**
   * Detect orphaned pods (pods with Kestrel lifecycle labels but no Dragonfly record).
   * Per Dragonfly Lifecycle State Contract > Timer And Orphan Resolution:
   * "An orphaned pod is a pod with Kestrel lifecycle labels but no authoritative Dragonfly pod record."
   *
   * **Caller Responsibility**: Integrate this with Dragonfly checks.
   * This method only identifies pods with lifecycle labels; caller must verify against Dragonfly.
   *
   * @param namespace - Kubernetes namespace
   * @param deploymentId - Filter by deployment
   * @returns Array of potentially orphaned pods
   */
  async detectOrphanPods(
    namespace: string,
    deploymentId: string,
  ): Promise<PodInfo[]> {
    try {
      // Get all pods with lifecycle labels in this deployment
      const pods = await this.listPods({
        namespace,
        deploymentId,
      });

      // Return pods with lifecycle labels (caller will check Dragonfly for actual orphans)
      return pods.filter(
        (pod) =>
          pod.lifecycleState !== undefined && pod.lifecycleState !== "shutdown",
      );
    } catch {
      return [];
    }
  }

  /**
   * Check if a pod is orphaned (has lifecycle label but Dragonfly status unknown).
   * Per Timer And Orphan Resolution: "On orphan detection during the orphan sweep,
   * Scheduler Routine transitions the pod to shutdown (terminate and garbage collect)."
   *
   * @param podName - Pod name
   * @param namespace - Kubernetes namespace
   * @param dragonflyShouldExist - Verify that pod should exist in Dragonfly
   * @returns true if pod appears orphaned
   */
  async isOrphanPod(
    podName: string,
    namespace: string,
    dragonflyShouldExist: boolean = true,
  ): Promise<boolean> {
    try {
      const pod = await this.getPod(podName, namespace);

      if (!pod) return false;

      // Pod is orphaned if it has lifecycle labels but Dragonfly says it shouldn't exist
      const hasLifecycleLabel = pod.lifecycleState !== undefined;
      const isNotShutdown = pod.lifecycleState !== "shutdown";

      return hasLifecycleLabel && isNotShutdown && !dragonflyShouldExist;
    } catch {
      return false;
    }
  }
}

export default KubectlClient;
