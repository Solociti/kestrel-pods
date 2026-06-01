---
name: resolve-architecture-concern
description: "Resolve one architecture concern by updating plans/PROJECT.md and plans/concerns.md with synchronized, evidence-based edits. Use when closing risky claims, open decisions, or edge-case entries in plans/concerns.md."
argument-hint: "Which concern should be resolved?"
user-invocable: true
disable-model-invocation: false
---

# Resolve Architecture Concern

Use this skill to close one concern from [plans/concerns.md](../../../plans/concerns.md) without creating policy drift between architecture documents.

## Outcome

Produce synchronized edits that:

- update [plans/PROJECT.md](../../../plans/PROJECT.md) with the accepted decision and enforcement boundary,
- remove or rewrite the resolved concern in [plans/concerns.md](../../../plans/concerns.md),
- add new follow-on risks if the resolution introduces new uncertainty,
- move implementation-only actions to [plans/BACKLOG.md](../../../plans/BACKLOG.md) only when concrete execution work is required.

## When To Use

- A concern in [plans/concerns.md](../../../plans/concerns.md) is ready for resolution.
- A risky claim in [plans/PROJECT.md](../../../plans/PROJECT.md) needs narrowing, scoping, or evidence.
- A user asks to close an open architecture decision and reflect it across docs.

## Procedure

1. Select exactly one concern.

- Quote the specific concern heading or bullet before editing.
- If multiple concerns are requested, split into separate passes.

2. Classify concern type.

- Risky claim: convert absolutes into scoped, testable statements.
- Open decision: add explicit decision plus rationale in [plans/PROJECT.md](../../../plans/PROJECT.md).
- Edge case: define expected behavior and enforcement point.
- Security gap: define control boundary, ownership, and audit surface.

3. Capture resolution contract.

- Record what is now decided.
- Record what evidence supports it and what remains unknown.
- Record failure modes that still apply after the decision.

4. Apply synchronized edits.

- Update [plans/PROJECT.md](../../../plans/PROJECT.md) first with decision and rationale.
- Remove or rewrite the matching item in [plans/concerns.md](../../../plans/concerns.md).
- If new risks emerge, add them immediately to [plans/concerns.md](../../../plans/concerns.md).
- Add [plans/BACKLOG.md](../../../plans/BACKLOG.md) entries only for concrete implementation tasks.

5. Run consistency checks.

- No duplicated policy statements across files.
- No unresolved concern marked as resolved without a PROJECT update.
- No implementation checklist mixed into unresolved architecture concerns.
- Existing domain terms remain stable: warm, hot, stale, environments, deploy.

6. Report completion.

- Provide changed file list.
- State which concern was resolved.
- State residual risks and required follow-up validation.

## Branching Rules

- If evidence is missing, do not mark the concern resolved; rewrite it as narrowed uncertainty.
- If the resolution depends on benchmark results or fault-injection tests, keep the concern open and add explicit validation criteria.
- If the update affects security posture, add or update the security gap entry in [plans/concerns.md](../../../plans/concerns.md) in the same pass.
- If the change creates execution work only, add a targeted item to [plans/BACKLOG.md](../../../plans/BACKLOG.md) and keep unresolved policy in [plans/concerns.md](../../../plans/concerns.md).

## Completion Criteria

A run is complete only when all are true:

- One concern has a clear before and after state.
- [plans/PROJECT.md](../../../plans/PROJECT.md) and [plans/concerns.md](../../../plans/concerns.md) are consistent.
- Any new risk created by the resolution is captured.
- The output explicitly lists residual uncertainty and next validation step.
