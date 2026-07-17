# Kubectl Component Review Against plans/plan.md

## ✅ Correctly Implemented

1. **Lifecycle States**: All five states properly defined (warm, claiming, hot, stale, shutdown)
2. **Label Management**: lifecycle-state and api-endpoint labels correctly handled
3. **Pod Queries**: Comprehensive filtering by deployment, endpoint, and lifecycle state
4. **State Transitions**: Complete transition path (warm→claiming→hot→stale→shutdown)
5. **Timing Defaults**: Proper grace period handling (60s stale drain, 30s orphan sweep cadence)

---

## ⚠️  Issues Requiring Fix

### Critical Issues

1. **YAML Generation Incomplete**
   - Missing pod affinity/anti-affinity enforcement (required by Tenant Isolation Boundary decision)
   - Missing node selectors (required for cluster-local placement)
   - Missing readiness probes (required for warm pool readiness detection)
   - Missing security context
   - Missing service account configuration
   
   **Plan Reference**: Base Architecture > Tenant Isolation Boundary:
   > "Node selectors and pod affinity policies enforce cluster-local workload placement."

2. **executeCommand Implementation**
   - Uses generic `exec` which doesn't properly handle YAML application
   - Placeholder in `applyYaml` method
   - Should use proper kubectl apply with `-f -` stdin
   
3. **Missing Pod Affinity Support**
   - Plan requires both pod affinity (for HA topology quorum) and anti-affinity (for tenant isolation)
   - Should add configuration for topology profiles (Standard vs HA)
   
   **Plan Reference**: Base Architecture > Cluster Topology:
   > "HA profile: multi-node cluster across 2+ VMs with quorum properties."

4. **Pod Event Watching Not Implemented**
   - Scheduler Routine needs to watch pod state changes for event-driven lifecycle management
   - Should support watching pod readiness events for warm pool insertion
   
   **Plan Reference**: Dragonfly Lifecycle State Contract:
   > "Scheduler Routine inserts warm pods into Dragonfly warm availability from Kubernetes readiness events"

### High Priority Issues

5. **Missing Pod Disruption Budget (PDB) Support**
   - Required for HA topology reliability during node maintenance
   - Should ensure minimum availability during pod evictions

6. **Orphan Sweep Detection**
   - While transitionToShutdown handles cleanup, no explicit orphan detection logic
   - Missing validation: "pod with Kestrel lifecycle labels but no authoritative Dragonfly pod record"
   
   **Plan Reference**: Dragonfly Lifecycle State Contract > Timer And Orphan Resolution:
   > "An orphaned pod is a pod with Kestrel lifecycle labels but no authoritative Dragonfly pod record."

7. **Pod Metadata Alignment**
   - Current PodInfo doesn't fully structure per-pod metadata as specified in Dragonfly contract
   - Missing podHostName derivation: `{podServiceName}.{namespace}.svc.cluster.local`
   
   **Plan Reference**: Dragonfly Key And Payload Contract:
   > "`podHostName` is derived as `{podServiceName}.{namespace}.svc.cluster.local`"

### Medium Priority Issues

8. **Retries Don't Match Plan Specification**
   - Plan requires exponential backoff with 50ms initial delay and jitter: `Math.random() * backoff`
   - Current implementation has no backoff strategy
   
   **Plan Reference**: Dragonfly Availability Failure Handling:
   > "Dragonfly operations use exponential backoff with 50ms initial delay and jitter computed as `Math.random() * backoff`"

9. **Resource Limit Defaults Missing**
   - Pod specs should have sensible resource defaults
   - No memory/CPU presets for workload pod sizing

10. **Integration Point Clarity**
    - Comments should clarify that Dragonfly integration happens at Scheduler Routine/Router layer, not here
    - This is a Kubernetes abstraction layer; higher components handle Dragonfly state management

---

## 📋 Recommendations for Changes

### Phase 1: Critical (Immediate)
- [ ] Fix executeCommand to properly apply YAML
- [ ] Add pod affinity/anti-affinity configuration with topology profile support
- [ ] Add node selector support for tenant affinity
- [ ] Add readiness probe configuration

### Phase 2: High Priority
- [ ] Add pod event watching for readiness state changes
- [ ] Add pod disruption budget support
- [ ] Implement explicit orphan detection check
- [ ] Add exponential backoff + jitter utility

### Phase 3: Documentation
- [ ] Add architectural integration notes clarifying Dragonfly layer separation
- [ ] Document expected integration points with Scheduler Routine and Router
- [ ] Add lifecycle diagram comments

---

## Plan Alignment Summary

- **Dragonfly Lifecycle State Contract**: ✅ Labels and states correct; ⚠️ needs event watching
- **Pod Specification and Labeling**: ✅ Correct label management; ⚠️ needs affinity enforcement
- **Tenant Isolation Boundary**: ⚠️ Missing node selectors and pod affinity
- **Warm Pool Management**: ⚠️ Missing readiness event watching
- **Control Plane Ownership**: ✅ Correct responsibility boundaries (kubectl is lower-level abstraction)
