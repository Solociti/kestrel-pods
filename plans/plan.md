# Kestrel VM Plan

## Description

Kestrel is a multi-tenant platform where each tenant runs on a dedicated k3s cluster hosted on one or more tenant-dedicated virtual machines.
The control plane runs a management container that exposes the REST Administration API and a scheduler pod that manages lifecycle transitions for serverless workload pods.
The data plane executes tenant workloads on base workload pods inside the owning tenant cluster.
Dragonfly stores lifecycle source-of-truth state for serverless pods, including availability, claim/provision state, and shutdown transitions.

## Decisions

- _Tenant Isolation Boundary_
  - Each tenant is assigned a dedicated k3s cluster.
  - Each tenant cluster runs on one or more dedicated VMs.
  - Tenant workloads never share VM nodes with other tenants.

- _Cluster Topology_
  - Minimum topology is single-node k3s on one VM.
  - Optional high-availability topology uses multiple VMs per tenant.
  - Topology profile is selected at tenant creation and may be upgraded later.

- _Control Plane Ownership_
  - Control plane provisions tenant VM infrastructure.
  - Control plane bootstraps and registers tenant k3s clusters.
  - Management container exposes REST API surfaces for tenant, endpoint, and deployment operations.
  - Scheduler pod executes pod lifecycle orchestration, warm pool maintenance, and deployment-triggered provisioning actions.
  - Control plane stores tenant metadata, endpoint definitions, artifact bindings, desired capacity settings, and lifecycle policy configuration.

- _Endpoint Runtime Model_
  - Base workload pods are created as deploy targets where endpoint code is provisioned and executed.
  - Pod lifecycle uses shared warm, claiming, hot, and stale states.
  - Endpoint updates use rolling deployment semantics for deployment templates and lifecycle-safe pod replacement.
  - Endpoint scale is pod-count based and cluster-local.

- _Lifecycle State Source Of Truth_
  - Dragonfly is the authoritative lifecycle store for serverless pod state.
  - Dragonfly tracks pod availability, claiming/provisioning transitions, endpoint binding, and shutdown/stale transitions.
  - Router and scheduler lifecycle actions must use the shared Dragonfly contract for legal state transitions.

- _Routing Model_
  - Global ingress resolves incoming request path to tenant and endpoint.
  - Requests are forwarded to the target tenant cluster ingress/service and resolved to eligible hot pods.
  - Traffic policy and retries are enforced at ingress and service layers.

- _Artifact and Release Model_
  - Build artifacts are immutable and versioned.
  - Endpoint configuration references artifact versions.
  - Deploy operations bind a specific artifact version to a tenant endpoint revision.

- _Secrets and Configuration Model_
  - Secret values are encrypted at rest in control-plane storage.
  - Secret writes and updates are managed through Administration API surfaces.
  - Secret material is injected only into workloads running in the owning tenant cluster.

- _Administration API Scope_
  - Management container REST API is the authoritative management surface.
  - Tenant APIs manage tenant creation, topology profile, VM count, and deletion workflow.
  - Endpoint APIs manage endpoint lifecycle, artifact binding, runtime settings, and scaling limits.
  - Deployment APIs manage rollout triggers, status, and rollback controls.

- _Observability and Metering_
  - Control plane records tenant-level and endpoint-level operational events.
  - Metrics include request volume, latency, error rates, deployment duration, and resource utilization.
  - Usage reporting windows are deterministic and timestamp-bounded.

- _Reliability and Recovery_
  - Failure domain is tenant cluster scoped.
  - Node replacement and cluster reconciliation are automated control-plane actions.
  - Deployment rollback and endpoint fail-safe behavior are first-class operational controls.

## To Plan

- _Provisioning Contract_
  - Define VM provider abstraction and required capabilities.
  - Define VM image baseline, bootstrap sequence, and hardening profile.
  - Define tenant cluster registration handshake and health validation.
  - Define scheduler pod ownership boundaries for claim, deploy, stale, and shutdown transitions.

- _Tenant Lifecycle Contract_
  - Define create, suspend, resume, and delete workflows.
  - Define safe deletion preconditions for active traffic and retained artifacts.
  - Define topology upgrade and VM count change procedures.

- _API Contract Details_
  - Define request/response schemas, idempotency behavior, and error taxonomy.
  - Define API versioning and compatibility guarantees.
  - Define audit-event schema for tenant, endpoint, and deployment actions.

- _Routing Contract_
  - Define tenant/endpoint resolution key model and cache behavior.
  - Define ingress timeout, retry, and circuit-breaker defaults.
  - Define behavior for tenant-cluster unreachable states.
  - Define how routing consumes Dragonfly hot-pod eligibility and fallback behavior when no hot pod is available.

- _Deployment Contract_
  - Define rollout strategies and readiness gates.
  - Define rollback triggers and operator override behavior.
  - Define progressive delivery policy and failure thresholds.
  - Define deploy handoff between management API and scheduler pod including idempotency and timeout behavior.

- _Lifecycle State Contract_
  - Define Dragonfly keyspace schema and ownership boundaries for warm, claiming, hot, stale, and shutdown states.
  - Define legal transition graph, atomic transaction boundaries, and repair/reconciliation policy.
  - Define state retention and cleanup policy for stale, shutdown, and error-terminal pods.

- _Security Contract_
  - Define workload identity model between control plane and tenant clusters.
  - Define RBAC boundaries for tenant-level operations.
  - Define network policies for ingress, egress, and metadata-service protection.
  - Define key management and rotation policy for encrypted secret material.

- _Capacity and Cost Contract_
  - Define default VM sizing profiles by workload class.
  - Define autoscaling policy boundaries at tenant and endpoint scope.
  - Define quota and rate-limit policy for control-plane operations.

- _Disaster Recovery Contract_
  - Define backup cadence and restore point objectives.
  - Define region-failure behavior and failover procedures.
  - Define control-plane recovery sequencing for tenant clusters.

## Concerns

- Provisioning delays can degrade tenant onboarding and scale responsiveness if VM creation and cluster bootstrap are not bounded by strict SLOs.
- Endpoint density on undersized tenant VM profiles can produce contention and unstable latency unless sizing and autoscaling contracts are explicit.
- Dragonfly state staleness can misdirect traffic during rapid lifecycle transitions unless cache invalidation and consistency boundaries are defined.
- Control-plane credential scope that is too broad can increase blast radius across tenant operations unless identity boundaries are narrowly enforced.
- Secret rotation during active deployment windows can produce mixed runtime state unless rollout and rotation ordering rules are deterministic.
- Multi-VM tenant topologies can introduce quorum and upgrade complexity unless node lifecycle and upgrade ordering are formalized.
- Tenant deletion safety can fail if artifact retention, data ownership, and irreversible delete preconditions are not contractually enforced.
- Regional outages can cause prolonged tenant downtime unless cross-region backup and restore procedures are validated.
- Scheduler and router contract skew can violate legal lifecycle transitions unless version compatibility rules are explicit.
- Repair loops can over-correct and terminate valid pods when reconciliation runs from stale Dragonfly reads.

## Examples

- _Tenant Creation_
  - Operator creates tenant with profile `standard-ha` and VM count `3`.
  - Control plane provisions VMs, bootstraps k3s, registers cluster identity, and marks tenant `ready`.

- _Endpoint Deployment_
  - Operator calls management REST API to bind endpoint `/reports/daily` to artifact `v42` with min pods `2` and max pods `10`.
  - Scheduler claims warm pods, executes deploy, marks pods hot in Dragonfly, and tracks rollout until readiness gates pass.

- _Scaling_
  - Endpoint autoscaler increases hot pod count from `3` to `7` based on latency and queue depth.
  - Tenant cluster remains within VM resource budget and policy limits.

- _Rollback_
  - New endpoint revision exceeds error-rate threshold.
  - Management API triggers rollback; scheduler retires new hot pods to stale and restores prior hot pool state.

- _Tenant Upgrade_
  - Operator upgrades tenant from single-node to three-node topology.
  - Control plane adds nodes, rebalances workloads, and confirms post-upgrade health checks.
