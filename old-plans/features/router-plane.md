# Router Plane

## Description

This feature defines Router-plane request-path behavior for ingress, HOT pod selection, and fallback provisioning for scale-to-zero endpoints. Router executes request-path lifecycle transitions but does not define shared Redis/Dragonfly transaction contracts; those are defined in `plans/features/lifecycle-state-contract.md`. Router does not use the Kubernetes API.

## Decisions

- Router is the request-path executor for shared lifecycle transitions defined in `plans/features/lifecycle-state-contract.md`.
- Router does not call the Kubernetes API.
- Router uses Redis/Dragonfly lifecycle state as the request-path source of truth for HOT routing selection.
- On HOT miss for the requested endpoint, Router invokes the shared provision workflow defined in `plans/features/lifecycle-state-contract.md`.
- Router uses request-path retry/backoff options for the shared provision workflow.

## To Plan

- On unreachable claimed pod, execute claim release/recovery behavior defined by the shared lifecycle-state contract before retry.
- On nil claim result (shared provision function returns null), define retry policy: how many warm-claim attempts to make before returning 503 Service Unavailable, and whether a replenishment signal is emitted on null result and to which component.
- Define request-path handling for repeated terminal deploy failures (for example decrypt/injection failure): Redis-cached failure markers, cache TTL, and re-attempt gating rules to prevent retry-driven DOS amplification.
- Specify Router autoscaling signals beyond CPU (for example claim latency, activation backlog, timeout rate).

## Concerns

- CPU-only autoscaling can miss request-path saturation before latency collapses.
- Request-path fallback provisioning can increase p95 latency and contention during burst.
- Repeated terminal deploy failures can cause synchronized retry storms unless Router enforces bounded failure caching and backoff at endpoint scope.
- Fairness delegated entirely to upstream controls can still allow one endpoint to consume shared warm capacity if upstream controls are bypassed or misconfigured.
- State backend degradation can break both routing lookup and lifecycle transition behavior unless explicit fail behavior is defined.

## Examples

- Claim path example: no HOT pod is eligible, Router executes the shared warm-claim transaction, then performs post-claim provisioning handoff and routes once HOT state is committed.
- Nil-claim example: claim attempt returns no pod, Router emits replenishment signal and returns queue-or-response behavior according to endpoint policy.

- Router request workflow example (current contract-aligned flow):

```text
[ Incoming HTTP Request ]
		|
		v
1. Extract Endpoint Path
		|
		v
2. Read Redis/Dragonfly HOT state for exact endpoint path binding
		|---> (Found) ----> 3a. Forward request to HOT pod
		|
		'---> (Not Found / Scale-to-Zero)
				|
				v
			3b. Execute claim transition via shared contract
			    (LMOVE warm:available -> warm:claiming)
				|
				|---> (Nil claim) ----> 4b. Emit replenishment signal
				|                      and return queue-or-response behavior
				|
				'---> (Claimed pod)
						|
						v
					4c. Send POST /deploy JSON payload
					    (secrets + vars + code OR download-url)
						|
						v
					5c. Commit HOT lifecycle state and release
					    claiming state per shared contract
						|
						v
					6c. Forward original request to newly HOT pod
```

- Kubernetes label updates occur in Controller reconciliation, not in Router request path.
- Deploy payload shape and validation rules are defined in `plans/features/lifecycle-state-contract.md`.
