# Dynamic Warm-Pool Scaling

## Description

This feature defines warm-pool control-loop policy per environment namespace based on demand signals while avoiding oscillation and protecting shared capacity. It covers policy inputs, decision boundaries, and failure behavior; Kubernetes manifests are implementation detail, not the architecture contract.

## Decisions

- Dynamic warm-pool scaling is a control-loop policy concern, not a Kubernetes YAML contract.
- Scaling policy is enforced per environment namespace with explicit min/max bounds.
- Degraded-mode behavior is required when policy signals are stale or state-backend health is partial.
- Warm-pool min/max bounds are configured per environment namespace.
- Baseline warm-pool defaults are defined in `plans/features/config.md`; per-environment values are configured through `plans/features/admin-api.md`.

## To Plan

- Scaling
  - Establish controller input signals: request rate, queue depth, claim latency, warm deficit, and cold-start latency.
  - Add cooldown windows to avoid rapid scale-in/scale-out oscillation.
  - Instrument observability for scaling decisions, saturation, and policy triggers.
- Validate policy behavior under thundering herd and partial Redis/Dragonfly failures.

## Concerns

- Aggressive scale-up can cause registry/image pull bottlenecks and node pressure.
- Weak fairness controls can let one tenant consume most warm capacity in a shared environment.
- Slow or stale demand signals can produce oscillation and over-provisioning.
- Redis/Dragonfly partial failure can produce incorrect warm-deficit perception and unstable controller actions.

## Examples

- Burst example: rising claim latency and warm deficit in one environment trigger bounded scale-up, then cooldown prevents immediate reverse scale-in.
- Degraded-signal example: partial backend health reduces confidence in warm-deficit signal, so controller shifts to conservative scaling and emits saturation alerts.
