# Multi-Tenant Serverless Project

## Feature Plan Index

- [Dynamic Warm-Pool Scaling](features/dynamic-warm-pool-scaling.md)
- [Router Plane](features/router-plane.md)
- [Controller Plane](features/controller-plane.md)
- [Lifecycle State Contract](features/lifecycle-state-contract.md)
- [Kestrel Configuration](features/config.md)
- [Administration API](features/admin-api.md)
- [Secrets and Env Vars](features/secrets-and-env-vars.md)

## Features and Projects Used

- Platform and control plane
  - Kubernetes-native platform
  - Node.js Router and Controller planes

- Runtime and packaging
  - Runtime isolation using micro-VM-capable stack
  - Custom tenant runtime images (OCI/Docker)
  - Dedicated build containers per function entry file

- Storage and artifacts
  - Artifact and source storage in S3

- Lifecycle and scaling
  - HOT scale-to-zero support (configurable per-endpoint)
  - Per-environment warm container pools (always on)
  - Label-driven warm-pool management with per-namespace target counts
  - Single-purpose hot pods (no reuse across endpoints)
  - Endpoint-bound HOT pod reuse with configurable stale triggers

- Security boundaries
  - Secret and env delivery via request headers
  - Per-environment namespaces with strict pod-level isolation controls

## Dictionary

#### Admin API

The Administration API is the control-plane API through which upstream applications configure and manage their API endpoints, including trigger URLs, environment assignment, lifecycle policies, secrets, and environment variables. It is distinct from tenant API endpoints and is only accessible to authorized users and services.
Kestrel enforces the `/admin` boundary but does not implement per-resource permission edges within the Administration API surface.

#### Client

The client is the party that sends API requests to tenant endpoints or the Administration API. Clients are the trusted plane outside of Kestrel and are not part of the threat model. They can be upstream applications, end users, or internal services. They are responsible to setup, maintain and control Kestrel using the Administration API.

#### Warm Containers

Containers that are loaded and ready to receive tenant code to run. They are listening for a POST request on /deploy. Once a request is received, the code will be executed and the container will be transitioned to the HOT state. Warm pods are generic until deployed. Once a pod transitions to HOT, it is permanently bound to one API endpoint and is never reassigned.

#### Hot Containers

Containers that have code provisioned and are ready to receive requests. Once a container has the HOT state, it is permanently bound to one API endpoint, may serve multiple requests for that same endpoint, and is never reassigned to another endpoint. When stale triggers are hit, it is removed from routing, drains in-flight requests, and is then killed.

#### Stale Pods

Pods that were previously HOT for a specific API endpoint but have hit a recycle trigger (for example request-count limit, max age, idle timeout, or explicit unhealthy marking). A stale pod is immediately removed from HOT routing eligibility, does not accept new requests, is allowed to finish in-flight requests within drain policy, and is then terminated.

#### Environments

An environment is an execution class defined by runtime major version and resource profile (for example: node24-512mb, node24-1gb).
Each environment maps to one Kubernetes namespace and owns its warm pod pool.
Multiple endpoints sharing an environment consume warm pods from that pool, but pod-level isolation rules still apply (no pod-to-pod communication, no shared mounted storage).

#### Deploy

The HTTP endpoint (typically POST /deploy) through which tenant API code is provisioned onto a warm pod. When deployed, the endpoint delivers tenant code, then adds tenant secrets and environment variables to the pod and saves them in the process.env object. Since pods run in micro-VMs, these secrets and environment variables are isolated to the node process and container and do not leak outside the VM boundary.

## Decisions

- Planning document structure
  - Primary planning docs live under plans/: PROJECT.md, concerns.md, and BACKLOG.md.
  - Feature and architecture-slice plans live under plans/features/\*.md.
  - A file under plans/features/\*.md must contain required sections: Description, Decisions, To Plan, Concerns, Examples.
  - Additional custom sections are allowed when they provide feature-specific context (for example Redis key dictionaries).
  - No file under plans/features/\*.md may be created unless it is referenced from this Feature Plan Index.

- Platform, control plane, and build pipeline
  - Primary runtime target is Kubernetes.
  - Initial orchestrator/runtime control implementation is Node.js.
  - Tenant functions may run in custom OCI images (Go, Python, PHP, Node.js, others).
  - Build and runtime are separate phases with separate containers.
  - Build unit is per API entry file/function.
  - Source and build artifacts are stored in S3 with immutable versions.

- Runtime isolation strategy
  - Micro-VM-based isolation is required for untrusted multi-tenant workloads.
  - First runtime path to evaluate deeply: Kata Containers with Firecracker backend.
  - Keep runtime abstraction open so gVisor remains a fallback option where KVM is unavailable.
  - Future goal (not a current requirement): support both Kata+Firecracker and gVisor as customer-selectable runtime security profiles with separate guarantees, SLOs, and enforcement policies.

- Environment and isolation boundaries
  - Namespace boundary is per environment, not per tenant.
  - Environment definition is runtime major version + resource class (for example: node24-512mb, node24-1gb).
  - Isolation is enforced at pod boundary inside an environment namespace: no pod-to-pod communication and no shared mounted storage.
  - Resource enforcement is at pod level (environment class), not per-tenant quota.

- Router and Controller topology
  - Router and Controller architecture decisions are split into feature plans:
    - Router behavior and boundaries: `plans/features/router-plane.md`
    - Controller behavior and boundaries: `plans/features/controller-plane.md`
    - Shared Redis/Dragonfly lifecycle contract and transaction invariants: `plans/features/lifecycle-state-contract.md`
  - Boundary contract is explicit:
    - Router executes request-path lifecycle transitions.
    - Controller reconciles and repairs lifecycle state outside the request path.
    - Shared lifecycle-state contract defines legal transitions, ownership, and atomic operations.
  - Redis/Dragonfly remains authoritative for lifecycle and routing state; Kubernetes labels remain visibility mirrors and reconciliation inputs.

- Pod lifecycle, routing, and stale behavior
  - HOT pods are single-purpose: each pod is provisioned once, permanently bound to one API endpoint, never re-provisioned with a different payload, and may only serve repeated requests for that same endpoint.
  - Warm containers are consumed when converted into endpoint-bound HOT pods and are never reused after binding.
  - Detailed warm claim transaction semantics and invariants are defined in `plans/features/lifecycle-state-contract.md`.
  - Router and Controller feature plans reference the shared state contract and define only plane-specific execution behavior.
  - Pod lifecycle state uses `warm`, `claiming`, `hot`, `stale`, and `error` in Redis state and mirrored Kubernetes labels.
  - Warm pod readiness is signaled by the Kubernetes readiness probe. Controller observes Kubernetes readiness events to insert warm pods into the Redis/Dragonfly warm pool. HOT pod transition and routing eligibility semantics are defined in `plans/features/lifecycle-state-contract.md`.
  - Controller manages all stale, idle, and orphan pod termination outside the request path; see `plans/features/controller-plane.md`.
  - Concrete lifecycle and request-path configuration values (including stale defaults, request timeout, claim timeout, warm-pool bounds, and caller-specific provision retry settings) are defined in `plans/features/config.md`.
  - Stale lifecycle configuration uses baseline environment defaults in `plans/features/config.md`; per-environment values are configured through `plans/features/admin-api.md`.
  - MVP cleanup policy uses drain grace, orphan grace, and scan cadence only; no transient-lag safety gate is enabled until a later architecture update.
  - Pod lifecycle/routing state is tracked in Redis or Dragonfly and mirrored with Kubernetes labels for cluster visibility.
  - If a stale/race condition briefly results in extra endpoint-bound pods, this is acceptable and billed by CPU usage.
  - In-flight requests that started before stale marking remain part of the old pod lifecycle for billing/accounting.
  - See `plans/features/dynamic-warm-pool-scaling.md` for warm pool sizing and scaling policy.
  - See `plans/features/router-plane.md` for routing selection and fallback provisioning behavior.
  - See `plans/features/controller-plane.md` for minimum HOT maintenance.

- Endpoint configuration and capacity model
  - Each endpoint is independently configurable for minimum HOT instances and stale triggers.
  - Upstream applications decide tiering and feature access through their own business logic.
  - Per-endpoint configuration options, runtime behavior, and endpoint lifecycle management are defined in `plans/features/admin-api.md`.

- Dynamic warm-pool scaling policy boundary
  - Dynamic warm-pool scaling defines control-loop policy (signals, bounds, cooldowns, and failure behavior) separate from Kubernetes manifest implementation details.

- Secret delivery and network controls
  - Secret and environment-variable storage/encryption/deploy behavior is defined in `plans/features/secrets-and-env-vars.md`.
  - Kubernetes Secrets and ConfigMaps are not used for tenant runtime delivery.
  - Runtime pods use no mounted persistent volumes.
  - Runtime pod ingress is restricted to supervisor/router only.
  - Runtime pod egress defaults to deny and only required public internet destinations are allowed.
  - RFC1918 destination ranges are explicitly blocked for runtime pods.

## Reasons for Decisions

- Planning document structure
  - Keeping primary architecture state in three stable docs under plans/ preserves one source of truth for decisions, concerns, and tasks.
  - Feature plan files reduce noise in the primary docs while preserving deep planning context.
  - A required five-section feature template keeps decisions, planned work, risks, and concrete examples explicit.
  - Allowing optional custom sections preserves flexibility for domain-specific context without weakening baseline consistency.
  - Requiring PROJECT.md references before plan file creation prevents orphan plans and documentation drift.

- Platform, control plane, and build pipeline
  - Kubernetes and Node.js are the fastest path to build and iterate on scheduler, routing, and API orchestration behavior.
  - Custom image support is required to let upstream applications choose language/runtime freely instead of forcing a single runtime model.
  - Separate build/runtime phases reduce blast radius and allow stricter policies for untrusted code.
  - Per-entry-file builds keep deployment granularity aligned with API-level scaling and routing.
  - S3 gives durable, cheap, versioned artifact storage and clean endpoint prefix isolation.

- Runtime isolation strategy
  - VM-class isolation is needed because shared-kernel containers alone are not strong enough for arbitrary untrusted code.
  - Kata + Firecracker is the most direct path to OCI compatibility plus strong isolation in Kubernetes.
  - Keeping gVisor as an option preserves deployability on clusters where nested virtualization is limited.
  - Treating dual runtime support as a future goal allows benchmarking and policy design first, instead of committing to equivalent production guarantees before contracts and enforcement are defined.

- Environment and isolation boundaries
  - Namespace-per-environment allows warm pool reuse across endpoints that share runtime and sizing constraints.
  - Defining environments by runtime major and memory class makes placement and capacity policies explicit.
  - Pod-level isolation requirements are necessary because endpoints share an environment namespace.
  - Pod-level isolation via micro-VMs ensures endpoints never interfere with each other regardless of environment sharing.

- Router and Controller topology
  - Splitting Router and Controller removes the single-process failure domain between request serving and lifecycle reconciliation.
  - Separating plane behavior from shared transaction contracts reduces documentation drift and keeps ownership boundaries explicit.
  - Detailed rationale and contracts are documented in `plans/features/router-plane.md`, `plans/features/controller-plane.md`, and `plans/features/lifecycle-state-contract.md`.

- Pod lifecycle, routing, and stale behavior
  - One-time warm-to-hot binding prevents cross-endpoint reassignment and reduces cross-endpoint state contamination risk.
  - Namespace-level warm-pool target counts keep baseline warm capacity explicit per execution environment.
  - Keeping shared Redis/Dragonfly transaction contracts in a dedicated lifecycle-state plan avoids duplicate definitions across Router and Controller plans.
  - Keeping lifecycle state in Redis with mirrored labels allows routing control-plane truth while preserving Kubernetes visibility.
  - Using Kubernetes readiness events as the warm pool entry signal keeps pod eligibility aligned with actual Kubernetes-observed state. HOT pod readiness is determined by successful `/deploy` response, tracked in Redis.
  - Controller handling stale, idle, and orphan pod termination outside the request path avoids coupling claim path latency to pod retirement.
  - Allowing endpoint-bound HOT pod reuse until stale triggers reduces unnecessary reprovisioning while preserving endpoint isolation boundaries.
  - Redis/Dragonfly HOT-state lookup provides a single routing truth for exact API matching and stale exclusion.
  - Baseline environment defaults in configuration plus per-environment Administration API settings keep lifecycle policy consistent while allowing environment-specific tuning.
  - Configurable request timeout bounds long-running requests so stale drains can complete predictably.
  - Accepting occasional duplicate endpoint-bound pods under race conditions prioritizes availability and simplifies distributed coordination.

- Endpoint configuration and capacity model
  - Each endpoint is independently configurable for minimum HOT instances and stale triggers, allowing upstream applications to implement their own tiering logic.
  - Always-on environment warm pools reduce first-request latency for scale-to-zero endpoints.
  - Upstream applications query per-endpoint usage metrics for billing and reporting.
  - CPU-time billing aligned to pod lifecycle captures work done even when a pod is already marked stale.

- Dynamic warm-pool scaling policy boundary
  - Separating scaling policy from YAML-level deployment details keeps architecture decisions testable and portable across rollout mechanisms.

- Secret delivery and network controls
  - Secret and environment-variable lifecycle detail is centralized in `plans/features/secrets-and-env-vars.md` to keep one source of truth for secret-set behavior and API semantics.
