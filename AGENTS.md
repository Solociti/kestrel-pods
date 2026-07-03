# AGENTS

This repository is architecture-first. AI agents should optimize for design correctness, risk visibility, and decision traceability.

## Canonical Sources

- VM-based architecture plan and source of truth: [plans/plan.md](plans/plan.md)

Do not duplicate decisions across files. Update the source of truth directly.

## Primary Workflow

Use the Project Critic custom agent when discussing architecture changes:

- Agent definition: [.github/agents/project-critic.agent.md](.github/agents/project-critic.agent.md)
- Purpose: bluntly challenge design claims, then update the Decisions and Concerns sections in plans/plan.md only when the user explicitly confirms a concern is resolved.

## Editing Rules For This Repo

- Treat plans/plan.md as normative VM architecture policy.
- Keep accepted architecture decisions and rationale in the Decisions section of plans/plan.md.
- Keep unresolved risks, risky claims, and open questions in the Concerns section of plans/plan.md.
- Keep implementation follow-up items in the To Plan section of plans/plan.md.
- Prefer small, explicit edits that preserve existing terminology (warm, hot, stale, environments, deploy).
- Do not invent build/test commands. None are defined in this repository yet.

## Suggested Decision Hygiene

When adding or changing architecture decisions:

1. State the decision and enforcement boundary in the Decisions section of plans/plan.md.
2. Add explicit failure modes or uncertainty to the Concerns section of plans/plan.md.
3. If a concern is resolved, remove or rewrite only that concern and reflect the updated decision in plans/plan.md in the same edit.
4. If the decision creates follow-up implementation work, capture that work in the To Plan section of plans/plan.md.

## Scope Note

Current workspace contents are documentation plus custom agent config. Planning docs are under plans/. If code is introduced later, extend this file with concrete build/test/run commands and directory ownership boundaries.
