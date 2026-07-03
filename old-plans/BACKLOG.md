# Backlog

## Dynamic Warm-Pool Scaling

- Source plan: [plans/features/dynamic-warm-pool-scaling.md](features/dynamic-warm-pool-scaling.md)
- Add adaptive warm-pool controller per environment namespace.
- Inputs: request rate, queue depth, claim latency, warm deficit, and cold-start latency.
- Support min/max warm pod bounds per namespace.
- Add cooldown windows to prevent oscillation.
- Add per-environment override policies and safe defaults.
- Emit metrics and alerts for scaling decisions and warm-pool saturation.
- Validate behavior under thundering herd and partial Redis failure.
