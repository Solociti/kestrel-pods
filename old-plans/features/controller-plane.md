# Controller Plane

## Description

This feature defines Controller-plane responsibilities for lifecycle reconciliation, warm capacity maintenance, stale/orphan cleanup, and minimum HOT maintenance. Controller enforces lifecycle correctness outside the request path and repairs drift against the shared Redis/Dragonfly lifecycle-state contract defined in `plans/features/lifecycle-state-contract.md`.

## Decisions

- Controller is responsible for lifecycle reconciliation and repair outside the request path.
- Controller enforces shared lifecycle-state invariants defined in `plans/features/lifecycle-state-contract.md`.
- Controller maintains minimum HOT targets for endpoints that configure minimum HOT capacity.
- Controller may invoke the shared provision workflow defined in `plans/features/lifecycle-state-contract.md` when reconciling HOT deficits.
- Controller uses controller-specific retry/backoff options for the shared provision workflow.
- Controller owns all stale, idle, and orphan pod termination. Controller reconciles Redis/Dragonfly lifecycle state against Kubernetes observed state and applies cleanup policy with configurable grace periods and scan cadence.

## To Plan

- Populate warm availability from Kubernetes readiness watch events according to insertion and dedupe rules in the shared lifecycle-state contract.
- Specify stale, idle, and orphan termination policy details: grace period bounds, scan frequency, and stale termination sequencing. Stale transition ordering contract is defined in `plans/features/lifecycle-state-contract.md`.
- Specify activation task model and dedupe behavior shared with Router fallback flows.

## Concerns

- Aggressive orphan termination can kill valid pods during transient state lag if grace criteria are too narrow.
- Reconciliation lag on controller restart can leave warm capacity underrepresented and increase nil-claim responses.
- Scan frequency and orphan grace period trade off between fast recovery and false-positive pod termination.

## Examples

- Warm insertion example: readiness watch marks pod eligible, Controller inserts pod into warm availability using shared dedupe and ownership checks.
- Orphan recovery example: claiming entry exceeds grace policy, Controller executes contract-defined recovery and terminates according to cleanup grace and scan policy.