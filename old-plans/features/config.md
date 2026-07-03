# Kestrel Configuration

## Description

This feature tracks configuration values required to deploy and operate Kestrel. Configuration is provided externally at runtime. Backend selection, HA topology, and failover strategy are system administrator responsibilities; Kestrel consumes a configured endpoint and does not own deployment topology decisions.

## Config Values

```yaml
kestrel:
  state-backend:
    endpoint: "redis://dragonfly.default.svc.cluster.local:6379" # required; Kestrel only consumes endpoint config

metrics:
  # Backup sampling cadence for VictoriaMetrics used in audit/dispute workflows
  scrape-interval-seconds: 30

environment:
  stale:
    request-count: 1000 # HOT pod stale trigger by served request count
    max-age-seconds: 1800 # HOT pod stale trigger by pod age (30 minutes)
    hot-idle-timeout-seconds: 120 # idle-based stale trigger for HOT pods (2 minutes)
  warm-pool:
    min-pods: 4 # lower bound of warm pods per environment namespace
    max-pods: 10 # upper bound of warm pods per environment namespace

router:
  request:
    timeout-seconds: 30 # default request timeout in request path
  provision:
    retry:
      max-attempts: 5 # warm-claim/provision retries before 503 or policy fallback
      initial-backoff-ms: 50 # first retry delay
      strategy: exponential # backoff strategy for retries; e.g., fixed, linear, exponential

controller:
  claim:
    timeout-seconds: 60 # default wait for claiming -> HOT transition; interim until benchmarked
  provision:
    retry:
      max-attempts: 5 # controller-specific retries for HOT deficit reconciliation
      initial-backoff-ms: 100 # first retry delay for controller-initiated provision attempts
      strategy: exponential # backoff strategy for controller retries
cleanup:
  # The stale drain grace is a hard cap for stale and pod drain lifetime after route removal.
  # Under normal operation, the controller should terminate once active requests are completed.
  # This value should be greater than any request timeouts to avoid killing pods with in-flight requests.
  stale-drain-grace-seconds: 60
  orphan-grace-seconds: 30 # max age for claiming/orphan entries before controller runs recovery/cleanup actions
  scan-interval-seconds: 30 # controller reconciliation cadence for stale/idle/orphan detection and cleanup
```

## Decisions

- Kestrel is configured through external configuration values provided at deploy time.
- Redis/Dragonfly connection endpoint is a required configuration value. HA topology, replication, and failover strategy are system administrator responsibilities and are outside Kestrel scope.
- This file is the source of truth for concrete configuration values and defaults. Other planning docs reference this file instead of repeating values.
- Provision workflow and deploy workflow are the same contract surface and share one configuration group per caller type.
- Environment values in this file are baseline defaults; per-environment values are configured and updated through the Administration API.
- Metrics backup collection cadence is configured in this file and can be tuned without changing the event-first metering contract.
- All numeric defaults are interim and expected to change after development benchmarking.

## To Plan

- Define configuration source: environment variables, config file, or both.
- Define validation and startup failure behavior when required configuration values are absent or invalid.

## Concerns

- Missing or misconfigured required values at deploy need deterministic failure behavior to avoid silent misoperation.

## Examples

- Redis/Dragonfly: Kestrel reads connection endpoint from configuration and connects; HA topology and replication are not within Kestrel scope.
- Environment policy: stale and warm-pool baseline defaults are read from environment config; per-environment values are configured through the Administration API.
- Router policy: request timeout and router provision retry/backoff are read from router config.
- Controller policy: claim timeout, controller provision retry/backoff, and cleanup policy are read from controller config.
- Metrics policy: VictoriaMetrics backup scrape interval is read from metrics config.
