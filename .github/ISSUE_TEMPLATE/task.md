---
name: Task
about: One piece of work an agent or a person can start from
labels: agent-ready
---

## Goal

<!-- One sentence: what is true when this is done. -->

## Context

<!-- What exists today, the PRs it builds on, X's own ops or pages involved. -->

## Where

<!-- The files to start from, one per line, with the function or section. -->

- `path/to/file.ts` (function)

## Done when

- [ ] <!-- observable outcome -->

## Verify

- `pnpm check:changed`
- `vp test run <the tests beside the changed files>`

<!-- Engine work: `pnpm test:engine <file>` on mock X, then the live bench on the owner's machine. -->

## Constraints

- Read `AGENTS.md` first; its rules win.

## Related

<!-- #issues and #PRs; the epic it belongs to. -->
