# Lifecycle State Contract

## Description

This feature defines the shared Redis/Dragonfly lifecycle-state contract used by both Router and Controller planes. It specifies keyspace ownership, legal state transitions, atomic transaction boundaries, and invariant enforcement so request-path execution and reconciliation logic follow the same lifecycle rules.

## Redis Keys Dictionary

- `warm:available` stores IDs for warm pods that are currently claimable.
- `warm:claiming` stores IDs for warm pods currently in claim transition.

## Deploy Payload Contract

- `POST /deploy` accepts a JSON payload with `secrets`, `vars`, and exactly one code source field.
- Valid inline-code shape:

```json
{
  "secrets": {},
  "vars": {},
  "payload": {
    "code": "console.log('Hello World!')"
  }
}
```

- Valid download-url shape:

```json
{
  "secrets": {},
  "vars": {},
  "payload": {
    "download-url": "https://some-s3-service.com/someproject/somecode.js"
  }
}
```

## Dictionary

#### Warm Pods

Containers that are loaded and ready to receive tenant code to run. They are listening for a POST request on /deploy. Once a request is received, the code will be executed and the container will be transitioned to the HOT state. Warm pods are generic until deployed. Once a pod transitions to HOT, it is permanently bound to one API endpoint and is never reassigned.

#### Warm Claiming Pods

Containers that are currently being provisioned and not ready for requests yet.

#### Hot Pods

Containers that have code provisioned and are ready to receive requests. Once a container has the HOT state, it is permanently bound to one API endpoint path, may serve multiple requests for that same endpoint path, and is never reassigned to another endpoint. When stale triggers are hit, it is removed from routing, drains in-flight requests, and is then killed.

#### Stale Pods

Pods that were previously HOT for a specific API endpoint path but have hit a recycle trigger (for example request-count limit, max age, idle timeout, or explicit unhealthy marking). A stale pod is immediately removed from HOT routing eligibility, does not accept new requests, is allowed to finish in-flight requests within drain policy, and is then terminated.

#### Error Pods

The same as stale pods except the state was updated because of an error instead of lifecycle rule. Need to be cleaned up.

## Decisions

- This file is the shared Redis/Dragonfly lifecycle contract authority used by Router and Controller.
- Router and Controller must not redefine legal transition semantics in their own feature files.
- Claim operations require atomic transition guarantees and idempotency boundaries.
- Both Router and Controller may invoke the shared provision workflow and call `POST /deploy`.
- Warm pods enter `warm:available` when Controller observes a Kubernetes readiness event. No additional healthcheck is required beyond the Kubernetes readiness signal.
- A pod becomes HOT upon a successful `/deploy` response. HOT routing eligibility is tracked in Redis state; no separate HTTP healthcheck is required for routing.
- Deploy payload supports two valid code-source modes: inline `code` or remote `download-url`.
- Provisioning should be implemented as a self-contained function.
  1. Use a Redis list operation for atomic pod selection: `LMOVE warm:available warm:claiming LEFT RIGHT`
  2. Provision the pod through the `/deploy` endpoint
  3. Add the pod ID to the list for the target endpoint (round-robin and retry policy remain to plan)
  4. Return the pod ID
- Shared provision workflow contract is settled at the architecture level: required inputs, caller policy overrides, and terminal outputs are part of the contract surface.
- Provision workflow and deploy workflow refer to the same lifecycle operation (`POST /deploy` with contract-defined state transitions).
- Claim transition timeout is configuration-driven with an interim default of 60 seconds, defined in `plans/features/config.md`.

## To Plan

- Specify endpoint HOT-list keyspace schema and selection policy. No key naming schema has been decided (candidates include `hot:{endpoint_path}` or similar). Open questions: data structure (list vs set), key naming and scoping, insertion deduplication on HOT commit, selection strategy for multiple eligible HOT pods (round-robin, LRU, or FIFO), and behavior when the HOT list is empty mid-request. This policy is shared between Router (selection at request time) and Controller (minimum HOT maintenance). See `plans/features/router-plane.md` and `plans/features/controller-plane.md`.
- Specify legal transition graph and enforce which plane is allowed to execute each transition.
- Set stale transition ordering guarantees for route removal, drain behavior, and termination readiness. Controller executes termination; the sequencing contract belongs here.
- Set contract-versioning and compatibility rules for Router and Controller rollouts.
- Specify deploy payload validation rules: required top-level fields (`secrets`, `vars`), the `payload` wrapper key, and the mutually exclusive inner fields (`code` for inline or `download-url` for remote). Define behavior when required fields are absent or both code-source fields are present.

## Concerns

- Repair loops can over-correct and terminate valid pods when reconciliation operates on stale backend reads.
- Contract-version skew during rolling deploys can break transition legality unless compatibility boundaries are explicit.
- Endpoint HOT-list keyspace schema is not yet decided; divergent key naming or data structure across Router and Controller will break routing correctness until this is locked.

## Examples

- Atomic claim example: Router executes `LMOVE warm:available warm:claiming LEFT RIGHT`, then commits HOT transition only if claim ownership is still valid.
- Recovery example: Controller detects a stale claiming entry past grace policy and executes contract-defined release/repair before any termination action.
- Shared provision workflow example: caller invokes one contract-defined workflow and receives one of: provisioned HOT pod reference, nil-capacity result, or error result.
