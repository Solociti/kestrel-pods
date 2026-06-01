# AGENTS

This repository is architecture-first. AI agents should optimize for design correctness, risk visibility, and decision traceability.

## Canonical Sources

- Project decisions and rationale: [plans/PROJECT.md](plans/PROJECT.md)
- Open risks and unresolved design questions: [plans/concerns.md](plans/concerns.md)
- Implementation backlog items: [plans/BACKLOG.md](plans/BACKLOG.md)
- Feature and architecture plan files: [plans/features/](plans/features/)

Do not duplicate decisions across files. Update the source of truth directly.

## Primary Workflow

Use the Project Critic custom agent when discussing architecture changes:

- Agent definition: [.github/agents/project-critic.agent.md](.github/agents/project-critic.agent.md)
- Purpose: bluntly challenge design claims, then update plans/PROJECT.md and plans/concerns.md only when the user explicitly confirms a concern is resolved.

## Editing Rules For This Repo

- Treat plans/PROJECT.md as normative architecture policy.
- Treat plans/concerns.md as a live risk register, not a task list.
- Keep plans/BACKLOG.md for implementation work, not unresolved architecture policy.
- Keep feature-level and architecture-slice planning in plans/features/*.md.
- Require each feature plan file to use required sections: Description, Decisions, To Plan, Concerns, Examples.
- Allow custom sections in feature plan files when they add feature-specific context.
- Do not create a file in plans/features/ unless it is referenced in plans/PROJECT.md.
- Prefer small, explicit edits that preserve existing terminology (warm, hot, stale, environments, deploy).
- Do not invent build/test commands. None are defined in this repository yet.

## Suggested Decision Hygiene

When adding or changing architecture decisions:

1. State the decision and enforcement boundary in plans/PROJECT.md.
2. Add explicit failure modes or uncertainty to plans/concerns.md.
3. If a concern is resolved, remove or rewrite only that concern and reflect the updated decision in plans/PROJECT.md.
4. If the decision is feature- or architecture-slice specific, link the relevant plans/features/*.md file from plans/PROJECT.md.

## Scope Note

Current workspace contents are documentation plus custom agent config. Planning docs are under plans/. If code is introduced later, extend this file with concrete build/test/run commands and directory ownership boundaries.
