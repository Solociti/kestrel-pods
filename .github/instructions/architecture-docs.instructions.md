---
description: "Use when proposing architecture changes or editing plans/PROJECT.md, plans/concerns.md, plans/BACKLOG.md, or plans/features/*.md. Enforces decision/risk/task separation and synchronized updates across architecture docs."
name: "Architecture Docs Workflow"
applyTo:
  - "plans/PROJECT.md"
  - "plans/concerns.md"
  - "plans/BACKLOG.md"
  - "plans/features/*.md"
---
# Architecture Documentation Workflow

Use this workflow for architecture-document edits in this repository.

## Source of Truth Boundaries

- Put accepted architecture decisions and rationale only in [plans/PROJECT.md](../../plans/PROJECT.md).
- Put unresolved risks, risky claims, open questions, and edge cases only in [plans/concerns.md](../../plans/concerns.md).
- Put implementation tasks only in [plans/BACKLOG.md](../../plans/BACKLOG.md).
- Put feature-specific or architecture-slice planning details in [plans/features/](../../plans/features/), with required sections per file: Description, Decisions, To Plan, Concerns, Examples.
- Additional custom sections are allowed when they add feature-specific context.
- Do not create a file in plans/features/ unless it is first referenced in [plans/PROJECT.md](../../plans/PROJECT.md).
- Do not duplicate the same statement across multiple files unless the files need distinct wording for different purposes.

## Decision-Change Flow

1. If a decision changes, update [plans/PROJECT.md](../../plans/PROJECT.md) first.
2. Add or update corresponding uncertainty/failure modes in [plans/concerns.md](../../plans/concerns.md).
3. Only move an item to [plans/BACKLOG.md](../../plans/BACKLOG.md) when it becomes concrete implementation work.
4. If a concern is explicitly resolved, remove or rewrite that concern and reflect the resolution in [plans/PROJECT.md](../../plans/PROJECT.md) in the same edit.
5. If work is feature-specific, ensure [plans/PROJECT.md](../../plans/PROJECT.md) links the relevant plans/features/*.md file.

## Writing Standards

- Preserve existing domain terminology: warm, hot, stale, environments, deploy.
- Avoid absolute claims unless they are verified and scoped.
- Prefer explicit enforcement boundaries, failure modes, and trade-offs.
- Keep edits minimal and traceable to one decision change at a time.

## Guardrails

- Do not invent build/test/run commands in these docs.
- Do not convert unresolved architecture uncertainty into implementation tasks prematurely.
- Do not create orphan plans/features/*.md files that are not linked from plans/PROJECT.md.
- If evidence is missing, state what is unknown rather than implying certainty.
