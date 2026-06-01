# Administration API

## Description

This feature defines the Administration API contract for Kestrel control-plane operations. The API allows upstream applications to manage environments, submit builds, register and bind build artifacts to endpoints, configure endpoint runtime behavior, and query usage/health metrics. Authentication and authorization policies are the responsibility of the upstream application; Kestrel enforces endpoint isolation, lifecycle safety, and configuration bounds.

## Decisions

- _Cross-Cutting_
  - Administration API is the sole interface for Kestrel control-plane management.
  - Upstream application is responsible for authentication, authorization, and access control (who can create/delete environments, endpoints, and build submissions).
  - Kestrel enforces `/admin` boundary access but does not implement per-resource permission edges within the Administration API.

- _Environment API_
  - Administration API manages environment creation, updates, listing, and deletion.
  - Environment API manages per-environment stale and warm-pool values within configured policy bounds.
  - Environment deletion must enforce safety gates for active endpoints and active pod workloads.

- _Build API_
  - Administration API is the entry point for build submission and build-status retrieval.
  - Build artifacts are immutable once registered.

- _Artifact API_
  - Artifact versions are bindable references used by endpoints.
  - Endpoint updates bind to artifact versions rather than mutating artifact content.

- _Endpoint API_
  - Endpoint identity is unique and immutable within Kestrel.
  - Endpoint trigger URL is globally unique across all endpoints, including paths that encode tenant IDs.
  - Endpoint trigger URL registration rejects any path that starts with `/admin` or `/admin/` because that prefix is reserved for the Administration API.
  - Endpoint configuration includes trigger URL, timeout limits, minimum HOT count, stale trigger overrides, and assigned environment.
  - Per-endpoint configuration is distinct from environment-level defaults.
  - Per-endpoint configuration overrides operate within bounds enforced by Kestrel, not defined by the endpoint owner.
  - Per-endpoint configuration applies only to HOT pods bound to that specific endpoint.
  - Minimum HOT instances, stale triggers, and timeout behaviors are configurable per-endpoint.
  - Configuration changes are applied at runtime without requiring pod restarts or workflow interruption.
  - Configuration changes are applied to future pod transitions without affecting in-flight requests on existing HOT pods.
  - Deleted endpoints must drain existing HOT pods before deletion completes; in-flight requests complete.
  - Path lookups for routing will treat URL paths as case-sensitive and will normalize trailing slashes (for example `/foo` and `/foo/` are equivalent) to enforce uniqueness and prevent routing confusion.

- _Secret and Env-Var API_
  - Endpoint secret and environment-variable decisions are defined in `plans/features/secrets-and-env-vars.md`.
  - Secret and env-var management is a dedicated Administration API surface and process, separate from `/build` operations.

- _Metrics API_
  - Metrics APIs are read-only and expose per-endpoint and per-environment operational usage needed by upstream systems.

## To Plan

- _Cross-Cutting_
  - Define contract versioning and compatibility for rolling API updates.
  - Define audit/event model across all API types.

- _Environment API_
  - Define create/update/delete/list operations.
  - Define allowed runtime/resource profiles and immutability rules.
  - Define per-environment stale and warm-pool configuration schema, bounds, and validation behavior.
  - Define deletion preconditions and safe deletion flow for environments with bound endpoints or active workloads.

- _Build API_
  - Define build submission API: source pointer validation, idempotency keys, and admission limits.
  - Define build-status API: polling/streaming semantics and terminal states.

- _Artifact API_
  - Define artifact registration API and metadata schema.
  - Define retention policy and garbage-collection behavior.
  - Define artifact integrity verification and reference validation.

- _Endpoint API_
  - Define endpoint creation API: required fields (endpoint ID, environment, artifact version, trigger URL, initial configuration), validation rules, and idempotency guarantees.
  - Define endpoint update API: supported fields, partial update semantics, rollback behavior.
  - Define endpoint deletion API: cascade behavior, grace period for in-flight requests, and orphan pod cleanup guarantees.
  - Define endpoint list/query API: filter options and pagination.
  - Define endpoint configuration query API: effective configuration and optional history.
  - Define which parameters are per-endpoint vs per-environment.
  - Define minimum HOT instance configuration per-endpoint, including enforcement boundaries and per-environment pool interaction semantics.
  - Define per-endpoint stale trigger overrides (request count, max age, idle timeout) and their enforcement boundaries.
  - Define timeout policy (request timeout, deploy timeout, drain timeout), hard limits, and out-of-bounds rejection behavior.
  - Define how endpoint configuration is stored, updated, and applied at runtime without requiring pod restarts.

- _Metrics API_
  - Define metrics query API: per-endpoint and per-environment request counts, error rates, CPU/memory usage, timeout counts.
  - Define timerange constraints, aggregation windows, and cardinality limits.
  - Define consistency guarantees for billing-sensitive metrics.

## Concerns

- _Environment API_
  - Environment deletion can cause broad outage if active endpoints are not blocked or migrated before deletion proceeds.
  - Misconfigured per-environment stale or warm-pool values can destabilize warm capacity and stale transitions unless bounds and validation are enforced.

- _Artifact API_
  - Artifact registration races can bind stale or unintended build output unless artifact version references are immutable and verified.

- _Endpoint API_
  - One endpoint configured with high minimum HOT instances can compete for shared environment warm capacity against other endpoints in the same environment.
  - Multiple endpoints in the same environment need fair access to warm capacity; per-endpoint minimums must respect per-environment pool bounds.
  - Orphaned HOT pods from deleted endpoints consume capacity until explicitly cleaned; cleanup must be automatic and deterministic.
  - API concurrency: simultaneous configuration updates to the same endpoint can race if transactions are not atomic; must be serialized or versioned.
  - Endpoint ID naming collisions or reuse: if deleted endpoint ID can be recreated, routing cache or stale state might serve old HOT pods to new endpoint; deletion must be durable and reuse-safe.

- _Metrics API_
  - Metrics query API design impacts billing accuracy and audit trail; must be queryable by timerange, include error/success breakdowns, and be tamper-resistant.
  - Metrics cardinality can explode if dimensions are unconstrained, causing storage and query degradation.

## Examples

- _Environment API_
  - Environment creation: upstream application sends POST with runtime major and resource profile; API creates an environment class and returns environment ID.
  - Environment deletion safety: upstream application sends DELETE for an environment with active endpoints; API rejects deletion until endpoints are removed or migrated.

- _Build API_
  - Build submission: upstream application sends POST with source pointer and build options; API returns build ID and status endpoint.

- _Artifact API_
  - Artifact binding: upstream application sends PATCH to bind endpoint to artifact version v42; new HOT activations use v42 while in-flight requests continue on existing pods.

- _Endpoint API_
  - Endpoint creation: upstream application sends POST with endpoint ID, environment, artifact version, trigger URL, minimum HOT count, timeout limits, and stale timeout; API returns endpoint metadata and configuration applied timestamp.
  - URL uniqueness behavior: `/tenant-a/reports` is rejected if an endpoint with the same normalized trigger URL already exists, regardless of tenant semantics outside Kestrel.
  - Reserved-prefix behavior: `/admin/reports` is rejected because `/admin/` paths are reserved for Administration API routes.
  - Endpoint configuration update: upstream application sends PATCH with new stale timeout and request timeout; configuration is applied to future pod transitions immediately; existing HOT pods complete their lifecycle under old rules.
  - Minimum HOT behavior: an endpoint is configured with a minimum HOT instance count of 5; Controller enforces the target while respecting per-environment warm pool caps.
  - Stale override behavior: an endpoint is configured with a custom idle timeout; Controller applies the endpoint-specific trigger for pods bound to that endpoint.
  - Endpoint deletion: upstream application sends DELETE; Kestrel marks endpoint as draining, stops accepting new requests for that endpoint, waits for in-flight requests to complete, then terminates remaining HOT pods.

- _Metrics API_
  - Metrics query: upstream application queries GET /metrics?endpoint=x&from=t1&to=t2; response returns request count, error count, CPU-seconds, memory-seconds, and timeout counts for reporting or billing.
