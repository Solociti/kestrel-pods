# Backlog Plans

This document tracks deferred architecture topics that are not yet accepted into the canonical plan in `plans/plan.md`.
Items here are candidate directions and follow-up questions for future planning, not current architecture decisions.

---

## Autoscaling

### Candidate Direction

- Endpoint pod-count automation may adjust pod count based on latency, queue depth, and CPU utilization.
- Min and max pod counts would be configured per endpoint.
- Scaling actions would remain bounded by tenant cluster resource limits.

### To Plan

- Define autoscaling policy boundaries at endpoint scope (min/max, cooldown windows).
- Define scaling metric sources and calculation windows.
- Define scaling signal precedence and conflict resolution between warm-pool policy signals and endpoint autoscaler actions.
- Define autoscaling policy boundaries at tenant and endpoint scope.
