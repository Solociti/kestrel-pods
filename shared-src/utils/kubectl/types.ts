/**
 * Type definitions for kubectl pod operations.
 * Aligns with Kestrel lifecycle state model from plans/plan.md
 */

/**
 * Legal pod lifecycle states per the Dragonfly Lifecycle State Contract.
 * These are the canonical states managed by Scheduler Routine and projected to Kubernetes labels.
 */
export type LifecycleState = "warm" | "claiming" | "hot" | "stale" | "shutdown";

/**
 * Pod metadata payload stored in Dragonfly and Kubernetes.
 * Matches the structure specified in the Dragonfly Key and Payload Contract.
 */
export interface PodMetadata {
  deploymentId: string;
  podServiceName: string;
  namespace: string;
  podHostName: string;
  /**
   * Added only after provisioning completes.
   */
  "api-endpoint"?: string;
  /**
   * Current lifecycle state.
   */
  state?: LifecycleState;
}

/**
 * Kubernetes pod labels managed by Kestrel.
 * Per Pod Specification and Labeling decision.
 */
export interface KestrelLabels {
  "lifecycle-state"?: LifecycleState;
  "api-endpoint"?: string;
  /**
   * Custom labels from deployment config.
   */
  [key: string]: string | undefined;
}

/**
 * Pod topology affinity for HA and tenant isolation enforcement.
 * Per Base Architecture > Cluster Topology and Tenant Isolation Boundary decisions.
 */
export interface PodAffinity {
  /**
   * Topology profile: standard (single-node) or ha (multi-node with anti-affinity).
   */
  topologyProfile?: "standard" | "ha";
  /**
   * Tenant affinity enforcement via node labels.
   */
  nodeSelector?: Record<string, string>;
  /**
   * HA topology requires spreading across nodes.
   */
  podAntiAffinity?: boolean;
  requiredDuringScheduling?: boolean;
}

/**
 * Pod creation specification.
 * Per Pod Specification and Labeling decision and Tenant Isolation Boundary decision.
 */
export interface PodCreateSpec {
  name: string;
  namespace: string;
  image: string;
  deploymentId: string;
  podServiceName: string;
  /**
   * Custom labels from deployment configuration.
   */
  labels?: Record<string, string>;
  env?: Array<{ name: string; value: string }>;
  resources?: {
    requests?: { memory?: string; cpu?: string };
    limits?: { memory?: string; cpu?: string };
  };
  /**
   * Topology and tenant isolation affinity policies.
   */
  affinity?: PodAffinity;
  /**
   * Command for readiness probe (used for warm pool insertion detection).
   */
  readinessProbeCommand?: string[];
  /**
   * Seconds before first readiness probe is performed.
   */
  readinessProbeInitialDelay?: number;
  /**
   * Timeout in seconds for each readiness probe attempt.
   */
  readinessProbeTimeout?: number;
  /**
   * Command for liveness probe.
   */
  livenessProbeCommand?: string[];
}

/**
 * Pod query/filter criteria.
 */
export interface PodQueryCriteria {
  namespace?: string;
  deploymentId?: string;
  endpoint?: string;
  lifecycleState?: LifecycleState | LifecycleState[];
  /**
   * kubectl-style label selector expression.
   */
  labelSelector?: string;
}

/**
 * Pod information retrieved from Kubernetes.
 */
export interface PodInfo {
  id: string;
  name: string;
  namespace: string;
  deploymentId: string;
  lifecycleState?: LifecycleState;
  endpoint?: string;
  labels: Record<string, string>;
  ready: boolean;
  /**
   * Kubernetes pod phase (e.g., Pending, Running, Succeeded, Failed).
   */
  phase: string;
  hostIP?: string;
  podIP?: string;
  createdAt: Date;
  metadata?: PodMetadata;
}

/**
 * Result of a pod operation (create, delete, label update, etc.)
 */
export interface OperationResult {
  success: boolean;
  podId?: string;
  podName?: string;
  error?: Error;
}

/**
 * Options for transacting pod state transitions.
 */
export interface StateTransitionOptions {
  /**
   * Operation timeout in milliseconds.
   */
  timeout?: number;
  retries?: number;
  /**
   * Skip graceful drain; force immediate termination.
   */
  force?: boolean;
}
