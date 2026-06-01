# Concerns and Open Decisions

## 1) Potentially Inaccurate or Risky Claims

- Runtime and sandboxing
  - Claim: gVisor has lower overhead than full VM in all practical serverless cases.
  - Why risky: Workload type matters. Syscall-heavy and IO-heavy workloads can see significant overhead.

- Networking and egress
  - Claim: Blocking RFC1918 alone prevents private network access.
  - Why risky: Private reachability can still happen via IPv6 ULA/link-local ranges, metadata endpoints, DNS rebinding, or misclassified CIDRs unless all paths are blocked.

- Capacity, fairness, and cost
  - Claim: Never reusing a HOT pod for any other endpoint is operationally affordable at all scales.
  - Why risky: Strict one-time binding can increase pod churn, image pulls, and warm-pool pressure during deploy spikes unless capacity and recycle policies are modeled.

  - Claim: Pod-level quotas are sufficient without any per-endpoint enforcement.
  - Why risky: A noisy endpoint can monopolize warm capacity and queue slots inside an environment unless there is explicit per-endpoint fairness control.

  - Claim: HOT scale-to-zero removes idle-cost pressure for low-usage endpoints.
  - Why risky: Environment warm pools are always-on, so baseline idle cost still exists and can grow with environment count even when endpoints run with zero HOT pods.


- Router and Controller feature concerns
  - Router-plane specific concerns are consolidated in `plans/features/router-plane.md`.
  - Controller-plane specific concerns are consolidated in `plans/features/controller-plane.md`.

## 2) Critical Architecture Decisions Still Needed

- Runtime and packaging contract
  - Runtime isolation default:
    Choose one default path for MVP deployment behavior; dual runtime support is currently a future goal, not a released requirement.

  - Dual-runtime security profile contract:
    If Kata+Firecracker and gVisor are both supported later, define separate guarantees, SLOs, enforcement controls, migration rules, and audit requirements so they are not treated as interchangeable.

  - Function packaging contract:
    Define required interface for custom runtime images (port, health/readiness endpoint, signal handling, timeout semantics).

- Build and deploy pipeline
  - Build output model:
    Decide whether build produces tarball artifact, full runtime image, or both.

  - Cold-start retry policy:
    Set max retries and classify failures: image pull fail, artifact fetch fail, app boot fail, timeout.


- Secrets and networking policy
  - Secret and environment-variable concern set is tracked in `plans/features/secrets-and-env-vars.md`.

  - Egress model:
    Choose enforcement for default deny with allowlist, DNS policy, IPv6 handling, and non-RFC1918 private ranges.

- Environment, scaling, and lifecycle
  - Environment policy contract:
    Define allowed environment dimensions, naming, lifecycle, and who can create new environment classes.

  - Hot pod lifecycle policy:
    Initial triggers are set (request count, max age, idle timeout), but enforcement details remain open: stale transition ordering, drain grace period cap, and hard-kill deadline.

  - Cleanup without transient lag safety gate:
    MVP cleanup now relies on grace windows and scan cadence without a freshness gate. During Redis/Kubernetes state lag, this can still terminate valid pods unless lag-aware guards are introduced in a future update.


  - Error-triggered stale policy:
    Immediate stale on HTTP 500 is proposed, but thresholds and classification are undefined (single 500 vs rolling error rate, app error vs platform error).

  - Scale-out policy for hot endpoints:
    Proposed burst behavior (spin up additional endpoint-bound pods and round robin) needs admission triggers, max replicas per endpoint, and cooldown rules.

- Fairness, reservation, and billing
  - Per-endpoint minimum HOT policy:
    Define how per-endpoint minimum HOT instances are capped per environment so high-priority endpoints cannot starve shared warm pool capacity from other endpoints.

  - Billing model:
    Upstream applications query per-endpoint usage metrics for billing and reporting. Metering source of truth, sampling/aggregation model, and tamper-resistant logging pipeline are unresolved.

## 3) Edge Cases to Design Now

- Deploy and startup flow
  - Thundering herd on cold start for the same endpoint.
  - Partial deploy state when pod receives traffic before code specialization completes.
  - Function image with long startup scripts causing false readiness.

- Runtime lifecycle and state drift
  - Stale mutable state when reusing container for the same endpoint.
  - Endpoint-bound pod drift from memory leaks or stale local state over long lifetimes.

- Build and image distribution pressure
  - Build stampede from repeated commits on same function.
  - Large image pulls causing node and registry bottlenecks.

- Infrastructure fault scenarios
  - KVM unavailable on a subset of cluster nodes.
  - Node crash during in-flight request and idempotency of retried request.

- Secrets and rotation
  - Rotation and propagation concerns are tracked in `plans/features/secrets-and-env-vars.md`.

- Consistency and topology growth
  - Multi-region or disaster recovery behavior for artifact pointer consistency.
  - Environment explosion from too many runtime/memory class combinations.

## 4) Security and Isolation Gaps to Close

- Identity and metadata protection
  - Decide how to prevent endpoint code from accessing Kubernetes metadata and cloud instance metadata.
  - Enforce ingress identity so only supervisor/router principals can call runtime pods.
  - Restrict RBAC so only lifecycle-controller identities can mutate HOT/WARM/STALE/ERROR labels and routing-critical pod metadata.

- Supply chain and sandbox policy
  - Define image policy: signing, allowed registries, CVE threshold, block/allow behavior.
  - Define build-job sandboxing profile separately from runtime pod sandboxing.

- Secrets and auditability
  - Audit and redaction concerns are tracked in `plans/features/secrets-and-env-vars.md`.

- Egress hardening
  - Define controls for IPv6 private/link-local ranges and DNS rebinding in egress policy.

## 5) Operational Readiness Gaps

- Reliability targets and response
  - SLOs not defined yet (cold start p95, request latency p95, deploy time p95, availability targets).
  - Incident procedure missing for draining and replacing degraded endpoint-bound HOT pods.

- Operations and recovery playbooks
  - Runbooks missing for image pull failures, S3 outages, lock backend outages, and stuck warm pools.

- Capacity and lifecycle planning
  - Capacity model missing for warm pool sizing and eviction policy.
  - Upgrade strategy for runtime classes and kernel images not defined.

## 6) Recommended Near-Term Experiments

- Runtime and isolation benchmarks
  - Benchmark Kata+Firecracker vs gVisor on your expected workloads (CPU, IO, memory, startup).

- Secrets and ingress handling
  - Secret payload and leak-path experiments are tracked in `plans/features/secrets-and-env-vars.md`.

- Scaling and lifecycle behavior
  - Simulate thundering herd for one scaled-to-zero endpoint with N concurrent requests.
  - Validate endpoint-bound pod stability under long runs and forced recycle policies.

- Build and distribution performance
  - Benchmark build pipeline with realistic function repositories and dependency caches.

- Network and fairness controls
  - Test egress policy against RFC1918, IPv6 ULA/link-local, metadata IPs, and DNS rebinding attempts.
  - Stress-test fairness controls with one abusive endpoint in a shared environment.
