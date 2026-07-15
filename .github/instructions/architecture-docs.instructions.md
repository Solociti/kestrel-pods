---
description: "Use when proposing architecture changes or editing plans/plan.md. Enforces section-level decision/risk/task separation in the vm-based architecture plan."
name: "Architecture Docs Workflow"
applyTo:
  - "plans/plan.md"
---
# Architecture Documentation Workflow

Use this workflow for architecture-document edits in this repository.

## Source of Truth Boundaries

- Put accepted architecture decisions and rationale in the relevant **Decision:** block(s) inside Base Architecture or feature sections of [plans/plan.md](../../plans/plan.md).
- Put unresolved risks, risky claims, open questions, and edge cases in the Concerns section of [plans/plan.md](../../plans/plan.md).
- Put concrete architecture follow-up work in the relevant **To Plan:** subsection(s) of [plans/plan.md](../../plans/plan.md).
- Keep the Description section aligned with current decisions and operational reality.
- Do not duplicate the same statement across multiple sections unless wording differs for section purpose.

## Decision-Change Flow

1. If a decision changes, update the relevant section’s **Decision:** block(s) in [plans/plan.md](../../plans/plan.md) first.
2. Add or update corresponding uncertainty/failure modes in the Concerns section in [plans/plan.md](../../plans/plan.md).
3. Record concrete architecture follow-up work in the relevant **To Plan:** subsection(s) in [plans/plan.md](../../plans/plan.md).
4. If a concern is explicitly resolved, remove or rewrite that concern and reflect the resolution in the relevant **Decision:** block(s) in the same edit.
5. Keep section updates synchronized so Description, Decision blocks, To Plan, and Concerns do not conflict.

## Writing Standards

- Preserve existing domain terminology: warm, hot, stale, environments, deploy.
- Avoid absolute claims unless they are verified and scoped.
- Prefer explicit enforcement boundaries, failure modes, and trade-offs.
- Keep edits minimal and traceable to one decision change at a time.

## Guardrails

- Do not invent build/test/run commands in these docs.
- Do not convert unresolved architecture uncertainty into To Plan entries prematurely.
- If evidence is missing, state what is unknown rather than implying certainty.
