# Orchestrator Plan

This document captures basic planning inputs for the `Orchestrator` pod.
It is not a source of accepted architecture decisions. Accepted decisions belong in `plans/plan.md`.

---

## Scope

The `Orchestrator` pod owns tenant VM provisioning, tenant-cluster bootstrap, and the execution stack required to turn a newly allocated VM into a usable tenant k3s cluster.

---

## Candidate Direction

### VM Isolation Boundary

- Treat the entire tenant VM as an untrusted boundary.
- Assume a tenant cluster hosted inside that VM may be compromised without granting access beyond that VM.
- Keep the isolation guarantee at the hypervisor boundary rather than depending on container sandboxing inside the tenant environment.

### Control And Communication Model

- Use a strict management-initiated model for bootstrap and orchestration actions.
- `Orchestrator` accepts only API requests from the upstream application.
- `Orchestrator` is not a general client-traffic ingress and does not sit on the direct end-user workload path.
- `Orchestrator` resolves tenant and deployment placement, then returns the deployment-specific access location to the upstream application.
- This allows the upstream application to reach deployed code directly and removes one routing hop from the request path.
- `Orchestrator` and related management components initiate provisioning calls into tenant VMs.
- Tenant VMs must not have privileged push access into internal management systems.
- Route management access through controlled routing infrastructure so VM addresses do not become the primary trust surface and access can be cut off quickly when needed.
- If accepted, this model changes the current `Router`-fronted external request path described in `plans/plan.md` by moving upstream API resolution to `Orchestrator` while keeping direct workload access off the `Orchestrator` path.

### Provisioning Stack

- The dashboard app submits VM provisioning and bootstrap jobs into Dragonfly.
- A Python worker consumes those jobs with BullMQ semantics for queueing, retries, rate limiting, and progress tracking.
- The worker executes Ansible against the target tenant VM over SSH.
- Ansible is responsible for first-boot hardening, firewall lock-down, package installation, and k3s bootstrap.
- Dragonfly is the queue/state backend for worker coordination.
- The dashboard remains a control surface for job submission and status display rather than executing provisioning logic directly.

### Deployment Retention And Ephemeral VM Model

- `Orchestrator` keeps a durable copy of all tenant deployment definitions needed to rebuild a tenant cluster on a replacement VM.
- Tenant VMs are treated as ephemeral execution environments rather than durable system-of-record infrastructure.
- VM replacement and cluster rebootstrap must restore deployments from `Orchestrator`-owned records instead of depending on data preserved inside the old VM.
- This recovery model allows compromised, failed, or obsolete VMs to be discarded and reprovisioned without promoting the VM itself to a persistence boundary.

---

## Proposed Execution Flow

1. The dashboard records tenant provisioning intent and enqueues a VM bootstrap job.
2. The worker dequeues the job from Dragonfly-backed BullMQ state.
3. The worker runs Ansible against the target VM over SSH.
4. Ansible hardens the VM, installs required dependencies, and bootstraps k3s.
5. `Orchestrator` reapplies the tenant's stored deployment set onto the newly bootstrapped cluster.
6. When deployment completes, the API responds with an endpoint that the upstream application can use for direct access to the deployed code.
7. The upstream application uses the returned endpoint for direct workload access, skipping one router hop and reducing the path from five hops to four.
8. The worker reports progress and terminal status back through the queue/state layer for dashboard visibility.

---

## To Plan

- Define how `Orchestrator` authenticates to newly created VMs and how bootstrap credentials are rotated or destroyed after cluster registration.
- Define whether routing infrastructure for management access is a hard requirement during initial bootstrap or a post-bootstrap control.
- Define failure-handling boundaries between the dashboard, queue backend, worker, and Ansible execution layer.
- Define idempotency and retry rules for partially configured VMs.
- Define the registration handoff from `Orchestrator` into the `Control Plane` pod after cluster bootstrap completes.
- Define which deployment artifacts and runtime configuration must be retained by `Orchestrator` so a replacement VM can be rebuilt deterministically.
- Define the boundary between upstream application API requests that must stay on the `Orchestrator` path and direct workload requests that should use the deployment-specific endpoint.
- Define endpoint issuance, endpoint revocation, and tenant-cluster remap behavior when an ephemeral VM is replaced.

## Python Worker Example

```python
import asyncio
import ansible_runner
from bullmq import Worker

async def process_provisioning(job, token):
    tenant_id = job.data.get("tenant_id")
    vm_ip = job.data.get("vm_ip")

    # 1. Update progress in Dragonfly (Dashboard can read this live)
    await job.update_progress(10)

    # 2. Run Ansible Runner in-process via Python API
    # (Using the async interface so it doesn't block other queue jobs)
    thread, runner = ansible_runner.interface.run_async(
        private_data_dir=f"/tmp/ansible-runner/{job.id}",
        project_dir="/app/playbooks",
        playbook="provision_k8s.yml",
        inventory=f"{vm_ip},",
        extravars={"tenant_id": tenant_id}
    )

    # 3. Monitor the background thread and update progress
    while thread.is_alive():
        await asyncio.sleep(2)
        # You can parse runner stats here to update progress incrementally
        await job.update_progress(50)

    # 4. Finish and return status
    if runner.rc == 0:
        await job.update_progress(100)
        return {"status": "success", "rc": 0}
    else:
        raise Exception(f"Ansible failed with exit code {runner.rc}")

async def main():
    # Dragonfly is a drop-in Redis replacement, so the connection string is identical
    connection_opts = {"connection": "redis://dragonfly-host:6379"}

    worker = Worker("provisioning-queue", process_provisioning, connection_opts)
    print("Worker is live and listening for jobs...")

    # Keep the worker running
    keep_alive = asyncio.Event()
    await keep_alive.wait()

if __name__ == "__main__":
    asyncio.run(main())
```
