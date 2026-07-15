# AGENTS

This repository is architecture-first. AI agents should optimize for design correctness, risk visibility, and decision traceability.

## Canonical Sources

- VM-based architecture plan and source of truth: [plans/plan.md](plans/plan.md)

Do not duplicate decisions across files. Update the source of truth directly.

## Primary Workflow

Use the Project Critic custom agent when discussing architecture changes:

- Agent definition: [.github/agents/project-critic.agent.md](.github/agents/project-critic.agent.md)
- Purpose: bluntly challenge design claims, then update the relevant section’s **Decision:** block and the Concerns section in plans/plan.md only when the user explicitly confirms a concern is resolved.

## Editing Rules For This Repo

- Treat plans/plan.md as normative VM architecture policy.
- Structure: Base Architecture section (core tenant isolation, `Control Plane` pod, `Router` pod, `Orchestrator` pod, lifecycle state model) + feature-specific sections (Endpoint Runtime, Routing, Secrets, etc.) + To Plan subsections within features.
- Keep accepted architecture decisions and rationale within each section (Base and feature sections).
- Keep implementation follow-up items in the To Plan subsections within each feature section.
- Keep unresolved risks, risky claims, and open questions in the Concerns section at the end, grouped by severity level (Critical, High, Medium, Low).
- Each concern must include severity level, impact description, and enforcement guidance.
- Use canonical runtime terminology: `Control Plane` pod, `Router` pod, `Orchestrator` pod, `Scheduler Routine`, `Admin API`, `Workload Pods`.
- Keep pod names wrapped in backticks.
- Preserve existing lifecycle terminology (warm, hot, stale, environments, deploy).
- Prefer small, explicit edits that preserve existing terminology and policy intent.
- Do not invent build/test commands. None are defined in this repository yet.

## Suggested Decision Hygiene

When adding or changing architecture decisions:

1. State the decision within the appropriate Base Architecture or feature section of plans/plan.md.
2. Add enforcement boundaries and responsibility delineations where applicable.
3. If the decision defers work, add a To Plan subsection within that feature section.
4. Add explicit failure modes or uncertainty to the Concerns section in plans/plan.md.
5. Classify each concern with a severity level: Critical, High, Medium, or Low.
6. Include impact description for each concern (blast radius, user-visible effect, recovery complexity).
7. If a concern is resolved, remove or rewrite only that concern and reflect the updated decision within the feature section in the same edit.
8. When resolving a concern, update both the feature section decision and the concern entry at the end of the file.
9. Keep ownership boundaries explicit: `Orchestrator` pod owns VM and tenant-cluster provisioning; `Control Plane` pod does not.

## Scope Note

Current workspace contents are documentation plus custom agent config. Planning docs are under plans/. If code is introduced later, extend this file with concrete build/test/run commands and directory ownership boundaries.
