# Kestrel VM Plan

## Description

Kestrel is a multi-tenant platform where each tenant runs on a dedicated k3s cluster hosted on one or more tenant-dedicated virtual machines.
The `Control Plane` pod runs the `Scheduler Routine` to manage lifecycle transitions for `Workload Pods` and handles in-cluster control-plane operations.
The `Router` pod handles inbound workload and `Admin API` requests and routes workload traffic to eligible `Workload Pods`.
The `Orchestrator` pod is responsible for VM provisioning, tenant creation, and tenant-cluster bootstrap. `Orchestrator` is out of scope for the current phase and must be planned before official release.
The `Control Plane` pod must not provision VMs or bootstrap tenant clusters.
Dragonfly stores lifecycle source-of-truth state for `Workload Pods`, including availability, claim/provision state, and shutdown transitions.

---

## Base Architecture

### Tenant Isolation Boundary

**Decision:**

- Each tenant is assigned a dedicated k3s cluster.
- Each tenant cluster runs on one or more dedicated VMs.
- Tenant workloads never share VM nodes with other tenants.

**Enforcement:**

- VM allocation layer validates tenant affinity before node provisioning.
- Node selectors and pod affinity policies enforce cluster-local workload placement.

### Cluster Topology

**Decision:**

- Minimum topology is single-node k3s on one VM.
- Optional high-availability topology uses multiple VMs per tenant.
- Topology profile is selected at tenant creation and may be upgraded later.
- Each cluster can have multiple deployments.

**Profile Selection:**

- Standard profile: single-node cluster on one VM.
- HA profile: multi-node cluster across 2+ VMs with quorum properties.

**To Plan:**

- Evaluate per-deployment namespace topology (`one deployment -> one namespace`) including migration and operational overhead tradeoffs.

### Dragonfly Lifecycle State Contract

**Decision:**

- Dragonfly is the authoritative lifecycle store for `Workload Pods` lifecycle state.
- Dragonfly tracks pod availability, claiming/provisioning transitions, endpoint binding, and stale/shutdown transitions.
- `Router` and `Scheduler Routine` lifecycle actions must use the shared Dragonfly contract for legal state transitions.
- Dragonfly state is ephemeral and may be lost during control-plane restarts; after state loss, existing `Workload Pods` are treated as orphaned and are terminated instead of reused.
- Recovery after Dragonfly state loss is reprovision-first: `Scheduler Routine` rebuilds warm/hot capacity from desired endpoint state and current orphaned pods are not reattached.

**Ownership Boundaries:**

- `Router` reads Dragonfly HOT eligibility and can initiate bounded claim-and-provision attempts when HOT capacity is unavailable.
- `Scheduler Routine` also initiates claim-and-provision transitions for warm-pool reconciliation and deployment-triggered capacity deficits.
- `Router` and `Scheduler Routine` both use the shared Dragonfly lifecycle transaction contract for claim/provision/hot transitions.
- `Scheduler Routine` owns background reconciliation, stale/shutdown transitions, and orphan-sweep behavior.
- `Control Plane` pod configures desired warm/hot policy targets and transition limits but does not mutate per-request Dragonfly lifecycle state.
- Kubernetes labels (`lifecycle-state`, `api-endpoint`) are projections of Dragonfly lifecycle state and must converge to Dragonfly after reconciliation.

**Timing Defaults:**

- Claim transition timeout defaults to 60 seconds.
- Orphan sweep scan cadence defaults to 30 seconds; orphaned pods found by the sweep are shut down immediately.
- Stale drain grace defaults to 60 seconds as a hard cap for stale pod termination.
- Reconciliation scan cadence defaults to 30 seconds.

**Legal States:**

- `warm`: pod exists, ready to be claimed for deployment.
- `claiming`: pod acquired by deployment, provisioning endpoint code.
- `hot`: pod assigned to endpoint, ready to receive traffic.
- `stale`: pod marked for termination, active traffic drains.
- `shutdown`: pod terminated and garbage collected.

**Timer And Orphan Resolution (Decision):**

- An orphaned pod is a pod with Kestrel lifecycle labels but no authoritative Dragonfly pod record.
- A pod under stale-drain tracking is not considered orphaned because it still has an authoritative Dragonfly lifecycle record.
- On orphan detection during the orphan sweep, `Scheduler Routine` transitions the pod to `shutdown` (terminate and garbage collect).
- On stale-drain grace expiry, `Scheduler Routine` transitions the pod to `shutdown` (hard termination after drain cap).
- On claim-timeout expiry, `Scheduler Routine` transitions the pod from `claiming` to `stale`.

**Nil-Claim Contract (Decision):**

- A nil-claim occurs when the Dragonfly warm-claim move returns no pod from `warm:available`.
- `Router` owns request-path nil-claim retries using exponential backoff with jitter (50ms initial interval) and continues retrying until the active request timeout budget is exhausted.
- `Router` is the replenishment-signal owner for request-path nil-claim outcomes and emits the warm-pool replenishment signal when nil-claim outcomes are sustained.
- `Scheduler Routine` consumes replenishment signals and executes warm-pool recovery actions.
- When the request timeout budget is exhausted before a ready event arrives, `Router` returns 503 for that request.

**Dragonfly Availability Failure Handling (Decision):**

- `Router` and `Scheduler Routine` must treat Dragonfly availability as a hard dependency for lifecycle-backed event processing.
- When Dragonfly is unavailable, `Router` must not continue request-path lifecycle processing beyond bounded Dragonfly read retries.
- Dragonfly operations use exponential backoff with 50ms initial delay and jitter computed as `Math.random() * backoff` on each retry attempt.
- Dragonfly get/read calls use up to 3 retry attempts per operation before failing the operation.
- Dragonfly write/mutation calls use up to 3 retry attempts per operation before failing the operation.
- If Dragonfly remains unavailable after retry exhaustion for a request-path operation, `Router` returns 503 Service Unavailable for that request.
- `Scheduler Routine` must pause Dragonfly-dependent reconciliation transitions while Dragonfly is unavailable and resume on recovery.

**Dragonfly Key And Payload Contract (Decision):**

- `Router` readiness wait key is `hot:{deployment-id}:{endpoint}`.
- Shared warm-claim keys remain `warm:available` and `warm:claiming`.
- Each hot key stores a Redis list of `podId` values.
- `Router` selects HOT pods with atomic round-robin rotation using `LMOVE hot:{deployment-id}:{endpoint} hot:{deployment-id}:{endpoint} LEFT RIGHT`.
- Per-pod metadata is stored at `pod:{deployment-id}:{pod-id}`.
- Records moved through `warm:available` and `warm:claiming` use JSON payloads with keys: `deploymentId`, `podServiceName`, `namespace`, `podHostName`, `api-endpoint`.
- `pod:{deployment-id}:{pod-id}` stores the same JSON payload shape plus `state` (`warm`, `claiming`, `hot`, `stale`, `shutdown`).
- `podHostName` is derived as `{podServiceName}.{namespace}.svc.cluster.local`.
- `Router` may dispatch directly from readiness payload data, but HOT-list selection by `podId` must validate `pod:{deployment-id}:{pod-id}` state before forwarding.
- Pods must be removed from `hot:{deployment-id}:{endpoint}` when they transition to `stale` or `shutdown`.
- `Router` may evict selected pod IDs that resolve to non-routable state and retry within the active request timeout budget.
- `Scheduler Routine` cleanup loop must remove Dragonfly pod entries that no longer have a corresponding Kubernetes pod.
- Pod lifecycle keys are reconciliation-managed and must not use TTL-based forced orphaning as a normal cleanup mechanism.

**Request Cancellation Contract (Decision):**

- `Router` request context is authoritative for request-scoped listeners and request-scoped retry/provision wait loops.
- On client disconnect, request-timeout-budget exhaustion, or any terminal request-path outcome where the endpoint cannot be fulfilled for that request, `Router` must unregister all request-scoped listeners for that request and stop request-scoped work immediately.
- If the request currently has an open upstream connection to a worker pod, `Router` must terminate that upstream connection as part of cancellation cleanup.
- Pod provision work that was already accepted by `Scheduler Routine` may continue after request cancellation; completed pods transition to `hot` normally and are eligible for subsequent requests.
- Request cancellation must not roll back or bind completed provision results to the canceled request.

### Control Plane Ownership

**Decision:**

- `Orchestrator` pod provisions tenant VM infrastructure.
- `Orchestrator` pod bootstraps and registers tenant k3s clusters.
- `Control Plane` pod exposes `Admin API` surfaces for tenant, endpoint, and deployment operations.
- `Scheduler Routine` executes pod lifecycle orchestration, warm pool maintenance, and deployment-triggered provisioning actions.
- `Control Plane` pod stores tenant metadata, endpoint definitions, artifact bindings, desired capacity settings, and lifecycle policy configuration.
- `Control Plane` pod must not provision VMs or bootstrap tenant clusters.

**Responsibility Boundaries:**

- `Orchestrator` pod: VM provisioning, cluster bootstrap, and tenant-cluster migration orchestration.
- `Control Plane` pod: lifecycle state transitions, warm pool maintenance, `Admin API` gateway, and metadata ownership.
- Tenant cluster: pod execution, request routing, workload isolation.
- `Scheduler Routine`: Dragonfly state transitions, claim/provision orchestration, lifecycle callbacks.
- Request timeout default is 30 seconds and may be overridden by tenant and endpoint configuration within API-enforced bounds.
- `Scheduler Routine` owns claim/deploy/stale/shutdown transition ordering, minimum HOT target enforcement, and orphan-claiming reconciliation cadence.

### Admin API Scope

**Decision:**

- `Control Plane` `Admin API` is the authoritative management surface.
- Tenant APIs manage tenant creation, topology profile, VM count, and deletion workflow.
- Endpoint APIs manage endpoint lifecycle, artifact binding, runtime settings, and scaling limits.
- Deployment APIs manage deployment creation, status, and deployment-scoped metadata used by request routing.

**Constraints:**

- All tenant mutations are mediated through the API layer.
- Audit events are recorded for all admin operations.
- API versioning supports backward compatibility within major versions.

---

## Endpoint Runtime & Lifecycle

### Endpoint Runtime Model

**Decision:**

- `Workload Pods` are created as deploy targets where endpoint code is provisioned and executed.
- Pod lifecycle uses shared warm, claiming, hot, and stale states.
- Endpoint updates create new immutable deployments; existing deployments remain routable until callers stop targeting them.
- Endpoint scale is pod-count based and cluster-local.

**Deployment Semantics:**

- New deployments are independently routable through `KESTREL-DEPLOY: {deployment-id}` selection.
- New pods transition claiming -> hot during readiness checks and become eligible for immediate requests once deployment creation succeeds.
- `Scheduler Routine` reconciles warm/hot capacity in the background while `Router` continues request-path claim-and-provision on demand.

### Pod Specification and Labeling

**Decision:**

- All tenant `Workload Pods` must have the following labels:
  - `lifecycle-state`: pod current state (values: `warm`, `claiming`, `hot`, `stale`, `shutdown`)
  - `api-endpoint`: endpoint identifier (added only after provisioning completes and pod transitions to `hot`)
  - Custom labels: tenant-supplied labels specified at deployment time to support routing, observability, and workload identification

**Pod Label Semantics:**

- `lifecycle-state` label is managed by the `Scheduler Routine` and reflects the authoritative Dragonfly state.
- `api-endpoint` label is set by the provisioning logic during endpoint binding and cleared during stale transition.
- Custom labels are applied during pod creation from the endpoint deployment configuration and remain stable across pod lifetime.
- Labels enable pod filtering for observability queries, traffic routing decisions, and lifecycle event correlation.
- Endpoint configuration changes (minimum HOT, stale triggers, timeout policy) apply to future pod transitions without requiring restart of existing HOT pods.

**Responsibility Boundaries:**

- `Scheduler Routine`: manages `lifecycle-state` label transitions to match Dragonfly state changes.
- Provisioning logic: sets `api-endpoint` label when pod transitions to `hot`.
- Deployment API: receives and applies custom labels from tenant deployment requests.

### Warm Pool Management

**Decision:**

- Controller inserts warm pods into Dragonfly warm availability from Kubernetes readiness events using atomic claim-safe operations.
- Controller maintains per-endpoint minimum HOT targets within per-deployment warm pool bounds.
- Controller invokes shared provision workflow for HOT deficit reconciliation with controller-specific retry policy.
- Dynamic warm-pool scaling uses request rate, queue depth, claim latency, warm deficit, and cold-start latency signals.
- Scaling policy enforces min/max bounds, cooldown windows, and degraded-mode behavior when Dragonfly signal confidence is low.

**To Plan:**

- Define scaling signal precedence and conflict resolution between warm-pool policy signals and other deferred pod-count automation controls.

---

## Routing & Traffic Management

### Routing Model

**Decision:**

- Global ingress resolves incoming request path to tenant and endpoint.
- Requests are forwarded to the target tenant cluster ingress/service and resolved to eligible hot pods.
- Requests must include `KESTREL-DEPLOY: {deployment-id}` so `Router` selects deployment-scoped lifecycle keys.
- Traffic policy and retries are enforced at ingress and service layers.
- Default request timeout is 30 seconds for all endpoints unless overridden by tenant or deploy configuration.
- Unreachable tenant clusters return 503 Service Unavailable to the global ingress.

**Fallback Behavior:**

- When no hot pod is available for an endpoint, `Router` invokes claim-and-provision through the shared Dragonfly transaction contract.
- Claim/provision is event-driven: `Router` requests wait on `hot:{deployment-id}:{endpoint}` readiness records emitted after successful provision-to-HOT transition.
- `hot:{deployment-id}:{endpoint}` readiness records include pod routing metadata so `Router` can dispatch without a follow-up HOT lookup.
- HOT routing uses round-robin selection over `hot:{deployment-id}:{endpoint}` pod IDs and validates selected pod state through `pod:{deployment-id}:{pod-id}` before forwarding.
- `Router` request timeout starts when request ingress is accepted, not when claim/provision starts.
- `Router` timeout uses tenant/endpoint API timeout policy from settings (`settings > api settings`) and returns timeout failure when the budget is exhausted.
- Claim step uses atomic `LMOVE warm:available warm:claiming LEFT RIGHT` semantics; nil claim results follow `Router` retry/backoff policy.
- `Router` retry policy is budget-bound (no fixed attempt cap): 50ms initial backoff, exponential growth, jitter, and stop at timeout-budget exhaustion.
- Dragonfly get/read and write/mutation operations in request-path handling are capped at 3 attempts with exponential backoff (50ms initial) and jitter `Math.random() * backoff`; on persistent Dragonfly unavailability, request handling fails with 503 Service Unavailable.
- On timeout-budget exhaustion or terminal deploy failure, ingress returns 503 Service Unavailable.
- On any terminal request-path outcome where the endpoint cannot be fulfilled for that request (including client disconnect, timeout, terminal deploy failure, or exhausted routing eligibility), `Router` unregisters request listeners, cancels request-scoped work, and terminates any open upstream worker-pod connection; only already-accepted pod provision work may continue for future requests.
- Warm-pool replenishment signal is emitted on sustained nil-claim outcomes.
- Circuit breaker settings prevent cascading failures.

---

## Artifact & Deployment Management

### Artifact and Release Model

**Decision:**

- Build artifacts are immutable and versioned.
- Endpoint configuration references artifact versions.
- Deploy operations bind a specific artifact version to a tenant endpoint revision.

**Versioning:**

- Artifacts are tagged with semantic versions (major.minor.patch).
- Artifact images are stored in a registry and immutable after release.
- Endpoint revisions track artifact binding history.

### Deploy Payload Contract

**Decision:**

- Deploy payload requires `secrets`, `vars`, and `payload` fields.
- Exactly one code source mode is legal inside `payload`: inline `code` or remote `download-url`.
- Inline payload shape: `{ "secrets": {}, "vars": {}, "payload": { "code": "..." } }`.
- Remote payload shape: `{ "secrets": {}, "vars": {}, "payload": { "download-url": "https://..." } }`.
- Secret decryption and injection happen in-memory only during deploy request assembly; plaintext is cleared after handoff.
- Missing secret-key records are treated as not present for the referenced secret set.
- Decrypt or injection failures are terminal for that deploy attempt and return 5xx.
- Payload size limit is configurable with a default of 50 MB.

### Deployment Execution Contract

**Decision:**

- Once deployment creation succeeds, requests may be sent immediately to that deployment.
- Kestrel does not perform rollback to prior deployments; each deploy operation creates a new deployment ID and callers choose which deployment ID to target.
- Primary deploy failure threshold is timeout exhaustion; deploy attempts also fail when critical dependencies are unavailable (for example code persistence or settings-database access).
- On deploy failure, partially created resources for that deploy attempt must be cleaned up before returning failure.
- `Control Plane` `Admin API` owns deployment orchestration, including request validation, payload assembly, persistence, and `Scheduler Routine` handoff.
- `Scheduler Routine` does not orchestrate deployment creation and instead reconciles pod provisioning needs after deployment state changes are recorded.

---

## Secrets & Configuration

### Secrets and Configuration Model

**Decision:**

- Secret values are encrypted at rest in control-plane storage.
- Secret writes and updates are managed through `Admin API` surfaces.
- Secret material is injected only into workloads running in the owning tenant cluster.

**Encryption & Lifecycle:**

- Secrets are encrypted using tenant-scoped keys.
- Secret rotation is coordinated with endpoint deployments to prevent mixed runtime state.
- Secret access is audited and logged.

### To Plan: Security Contract

- Define workload identity model between `Control Plane` pod and tenant clusters.
- Define network policies for ingress, egress, and metadata-service protection.
- Define key management and rotation policy for encrypted secret material.

---

## Observability & Metering

### Observability and Metering

**Decision:**

- `Control Plane` pod records tenant-level and endpoint-level operational events.
- Metrics include request volume, latency, error rates, deployment duration, and resource utilization.
- Usage reporting windows are deterministic and timestamp-bounded.

**Metrics Collection:**

- Request path includes telemetry checkpoints at ingress, tenant cluster, and pod layers.
- Error rates and latency percentiles are sampled across deployment windows.
- Deployment duration tracks provisioning, claiming, and readiness transition times.

### Log Collection

**Decision:**

- All `Workload Pods` logs are collected from `Workload Pods` running in tenant clusters.
- Log collector agent runs as a DaemonSet on each tenant cluster node to scrape pod stdout/stderr from the container runtime.
- Logs are aggregated and buffered locally on the tenant cluster before being pushed to Victoria Metrics (push-based model).
- Push-based architecture minimizes Victoria Metrics configuration overhead and eliminates per-tenant pull configuration.

**Log Collection Architecture:**

- DaemonSet vlagent runs on each tenant cluster node with `-kubernetesCollector` enabled to auto-discover and collect pod stdout/stderr logs.
- Collected logs are automatically enriched with Kubernetes metadata (pod name, namespace, container name, node name, pod labels).
- Logs are tagged with tenant ID, endpoint ID, and deployment revision via custom labels and extra fields (`-kubernetesCollector.extraFields`).
- Central aggregator vlagent pod buffers logs locally on disk (`-remoteWrite.tmpDataPath`) before pushing to Victoria Logs.
- Logs are pushed to Victoria Logs via native HTTP protocol (`/insert/native`) with configurable batch sizes and flush intervals.
- On-disk buffer provides fault tolerance during Victoria Logs outages; buffered logs are persisted in chunks and replayed when connectivity restores.
- Checkpoint files track read offsets per container, ensuring no log duplication after pod restarts or vlagent pod rescheduling.
- Retry logic and configurable backoff handle transient failures to Victoria Logs.
- Support for HA replication via multiple `-remoteWrite.url` targets with independent buffers per destination.

**Responsibility Boundaries:**

- `Control Plane` pod: provisions vlagent DaemonSet and aggregator pod configurations, manages Victoria Logs endpoint credentials and URLs, monitors aggregator health metrics.
- Tenant cluster: runs DaemonSet vlagent on each node and central aggregator pod; exposes aggregator `/metrics` endpoint for monitoring.
- `Scheduler Routine`: coordinates vlagent DaemonSet lifecycle with node availability and pod lifecycle events.

### Lifecycle Event Collection

**Decision:**

- Lifecycle events are collected in row-based SQL with one row per transition event.
- Required event types: endpoint execution start, endpoint execution end, pod HOT start, pod stale.
- `Router` and `Scheduler Routine` are lifecycle event writers for transitions they own.
- Query windows use `[from, to)` semantics and filter by end timestamp for period attribution.
- Cross-boundary transactions are attributed to the period containing the end timestamp.
- Victoria Metrics sampling is a secondary audit/dispute signal and not an authoritative billing source.

**To Plan:**

- Define SQL schema and index strategy for lifecycle event IDs, endpoint identity labels, and end-time queries.
- Define aggregation query contract for endpoint execution seconds, HOT online seconds, and lifecycle event counts.

### To Plan: Log Collection Contract

- Specify vlagent as the log aggregator and collector (Victoria Metrics native agent).
- Define vlagent DaemonSet image, versioning, and update strategy for pod log collection.
- Define central vlagent aggregator pod configuration for buffering and remote write.
- Define on-disk buffer allocation (`-remoteWrite.tmpDataPath`, `-remoteWrite.maxDiskUsagePerURL`), rotation policy, and capacity thresholds.
- Define Victoria Logs authentication (bearer token via `-remoteWrite.bearerTokenFile`), TLS configuration (`-remoteWrite.tlsCAFile`), and endpoint URLs.
- Define checkpoint file location and persistence (`-kubernetesCollector.checkpointsPath`) for read offset tracking.
- Define Kubernetes metadata enrichment strategy (pod labels, node labels, namespace via `-kubernetesCollector.includeNodeLabels`, etc.).
- Define stream field configuration for efficient log filtering in Victoria Logs queries.
- Define retry/backoff policy (`-remoteWrite.retryMinInterval`, `-remoteWrite.retryMaxTime`) for buffered log delivery.
- Define multi-destination HA setup if backup Victoria Logs instances are required.
- Define query interface for tenant and operator access to logs by endpoint, pod, and time range via Victoria Logs HTTP API.
- Define resource requests/limits for aggregator pod and DaemonSet under high log volume scenarios.

---

## Reliability & Recovery

### Base Reliability Model

**Decision:**

- Failure domain is tenant cluster scoped.
- Node replacement and cluster reconciliation are automated control-plane actions.
- Deployment replacement and endpoint fail-safe behavior are first-class operational controls.
- No permanent state is stored as part of the Kubernetes cluster. All state including Dragonfly is considered ephemeral.
- Tenant clusters need to be able to be migrated to new VMs in the event of a VM failure or upgrade.
- The `Orchestrator` pod should be able to orchestrate cluster migration without downtime.

**Failure Handling:**

- Node failures trigger workload evacuation and rescheduling.
- Cluster health checks run at regular intervals.
- Failed deployments are marked failed, cleaned up, and do not trigger rollback to prior deployments.

### Lifecycle Reconciliation

**Decision:**

- Lifecycle reconciliation timing and Dragonfly recovery defaults are defined by the Dragonfly Lifecycle State Contract.
- On Dragonfly state-loss recovery, `Scheduler Routine` enters orphan-sweep mode and terminates non-authoritative pods before restoring endpoint warm/hot targets.
- Single-node tenant topologies should expect temporary endpoint brownouts during orphan-sweep and cold reprovision after Dragonfly state loss.
- HA tenant topologies still cycle orphaned pods during Dragonfly state-loss recovery, but availability impact should be limited when redundancy targets are satisfied.

---

## Provisioning

### To Plan: Provisioning Contract

- Define VM provider abstraction and required capabilities.
- Define VM image baseline, bootstrap sequence, and hardening profile.
- Define tenant cluster registration handshake and health validation.

---

### To Plan: API Contract Details

- Define request/response schemas, idempotency behavior, and error taxonomy.
- Define API versioning and compatibility guarantees.
- Define audit-event schema for tenant, endpoint, and deployment actions.

---

## Capacity & Cost Management

### To Plan: Capacity and Cost Contract

- Define default VM sizing profiles by workload class.
- Define quota and rate-limit policy for control-plane operations.
- Define fairness boundaries so per-endpoint minimum HOT targets cannot starve other endpoints in the same deployment.

---

## Concerns

### Critical Severity

- **Lifecycle state transition correctness**: `Scheduler Routine` and `Router` contract skew can violate legal lifecycle transitions unless version compatibility rules are explicit. _Impact: silent traffic loss, corrupted pod state._
- **Dragonfly state divergence**: Repair loops can over-correct and terminate valid pods when reconciliation runs from stale Dragonfly reads. _Impact: production pod termination, cascading traffic loss._
- **Tenant deletion safety**: Tenant deletion safety can fail if artifact retention, data ownership, and irreversible delete preconditions are not contractually enforced. _Impact: data loss, cross-tenant leakage._

### High Severity

- **Provisioning SLO violations**: Provisioning delays can degrade tenant onboarding and scale responsiveness if VM creation and cluster bootstrap are not bounded by strict SLOs. _Impact: onboarding latency, failed scale events._
- **Control-plane blast radius**: Control-plane credential scope that is too broad can increase blast radius across tenant operations unless identity boundaries are narrowly enforced. _Impact: security breach affecting multiple tenants._
- **Regional outage recovery**: Regional outages can cause prolonged tenant downtime unless cross-region backup and restore procedures are validated. _Impact: extended tenant unavailability._
- **Multi-VM upgrade complexity**: Multi-VM tenant topologies can introduce quorum and upgrade complexity unless node lifecycle and upgrade ordering are formalized. _Impact: split-brain states, failed topology upgrades._
- **HOT-list schema divergence**: `Router` and `Scheduler Routine` can misroute or fail eligibility checks if endpoint HOT-list naming, structure, and selection semantics diverge across implementations. _Impact: persistent request misdirection and sustained 5xx errors until schema alignment is restored._
- **Retry amplification on terminal deploy failures**: Repeated terminal deploy failures can trigger synchronized retry storms if failure-marker gating and timeout-budget-aware backoff/jitter policies are not enforced. _Impact: control-plane overload, warm-pool exhaustion, prolonged 503 windows._
- **Dragonfly loss recovery churn (single-node sensitive)**: Dragonfly state loss forces orphan cycling and cold reprovision; brownout risk is highest for single-node tenant topologies, while HA topologies should retain partial availability if warm/hot redundancy targets are met. _Impact: elevated cold-start latency, burst 503 rates for single-node tenants, and control-plane saturation during recovery windows._

### Medium Severity

- **Endpoint density contention**: Endpoint density on undersized tenant VM profiles can produce contention and unstable latency unless sizing and pod-count management contracts are explicit. _Impact: noisy neighbor, unpredictable latency SLOs._
- **Dragonfly cache staleness**: Dragonfly state staleness can misdirect traffic during rapid lifecycle transitions unless cache invalidation and consistency boundaries are defined. _Impact: request misdirection, transient 503 errors._
- **Secret rotation timing**: Secret rotation during active deployment windows can produce mixed runtime state unless rollout and rotation ordering rules are deterministic. _Impact: mixed secret versions across pods, configuration drift._
- **Log collection reliability**: Log collection agents can drop logs during pod evictions or Victoria Metrics outages unless buffering, retry, and fallback policies are contractually enforced. _Impact: incomplete audit trail, gaps in observability during incidents._
- **Log volume and retention cost**: Rapid pod churn and high log volume can cause Victoria Metrics storage cost overruns unless log sampling, retention windows, and disk quotas are bounded per tenant. _Impact: cost overruns, storage exhaustion._
- **Nil-claim replenishment signaling gaps**: Warm-pool recovery can stall if nil-claim signals are not routed reliably from request path to scaling control loop. _Impact: extended cold-start failures and persistent endpoint 503 responses._
- **Claim timeout classification gaps**: Missing transient-versus-terminal failure classification for claim/provision paths can cause either leaked claiming entries or overly aggressive pod termination. _Impact: reduced warm capacity and intermittent false-positive disruption._
