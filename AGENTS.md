# AGENTS

This repository is in active implementation. AI agents should optimize for architecture compliance, delivery safety, and clear change traceability.

## Canonical Sources

- VM-based architecture plan and source of truth: [plans/plan.md](plans/plan.md)
- Implementation roots: `control-plane/`, `router/`, `orchestrator/`, `shared-src/`

Do not duplicate policy decisions across files. Update the source of truth directly.

## Primary Workflow

Default workflow is implement-first with architecture checks:

1. Make the smallest code change that satisfies the request.
2. Run package-scoped checks first, then workspace checks if needed.
3. Update `plans/plan.md` only when architecture policy changes.

Use the Project Critic custom agent only for architecture decision changes:

- Agent definition: [.github/agents/project-critic.agent.md](.github/agents/project-critic.agent.md)
- Purpose: bluntly challenge design claims, then update the relevant section’s **Decision:** block and the Concerns section in plans/plan.md only when the user explicitly confirms a concern is resolved.

## Editing Rules For This Repo

- Treat plans/plan.md as normative VM architecture policy.
- Keep architecture policy in `plans/plan.md`; keep implementation details in package code and package READMEs.
- When changing runtime behavior or ownership boundaries, verify wording still matches `plans/plan.md`.
- Use canonical runtime terminology: `Control Plane` pod, `Router` pod, `Orchestrator` pod, `Scheduler Routine`, `Admin API`, `Workload Pods`.
- Keep pod names wrapped in backticks.
- Preserve existing lifecycle terminology (warm, hot, stale, environments, deploy).
- Prefer small, explicit edits that preserve existing terminology and policy intent.

## Build And Test Commands

Workspace level:

- `pnpm build`
- `pnpm test`
- `pnpm typecheck`

Package-scoped examples:

- `pnpm --filter control-plane test`
- `pnpm --filter router test`
- `pnpm --filter shared-src typecheck`
- `pnpm --filter @kestrel/orchestrator-dashboard-client dev`
- `pnpm --filter @kestrel/orchestrator-dashboard-server dev`

Container builds:

- `pnpm docker:build`
- `pnpm docker:build:dashboard`
- `pnpm docker:build:control-plane`
- `pnpm docker:build:router`
- `pnpm docker:build:vm-provision`

## Directory Ownership Boundaries

- `control-plane/`: Admin API and control-plane logic.
- `router/`: Request routing and endpoint selection behavior.
- `orchestrator/vm-provision/`: VM provisioning and orchestration integration.
- `orchestrator/dashboard/client/`: Dashboard frontend.
- `orchestrator/dashboard/server/`: Dashboard backend server.
- `shared-src/`: Shared utilities, including kubectl client abstractions.
- `plans/`: Architecture policy and decision records.

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

## Package Imports

All built in node packages must be imported from the `node:` namespace. For example, use `import fs from 'node:fs'` instead of `import fs from 'fs'`.

## Naming Conventions

- Use camelCase for variable and constant identifiers.
- Do not introduce SCREAMING_SNAKE_CASE identifiers for new code.

## JSDoc Requirements

- Use a short description block at the top.
- Insert one empty line between the description block and JSDoc tags.
- Include only needed tags.
- Avoid redundant tag descriptions. Do not restate the parameter name.
- Keep descriptions short and direct.

## Scope Note

This file is the encompassing development guide for agent behavior, implementation workflows, and planning references.
