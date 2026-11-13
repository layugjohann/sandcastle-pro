# 13: Unfixed Critical Findings stop the Issue

Status: done
Blocked by: 12

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** An Issue should only reach `awaiting-merge` once every Critical Finding is fixed, so that only Non-critical Findings are left for the human. Today, a Critical Finding the Review Session reports with `fixed: false` is only commented on the Issue. The Gate still runs and the Issue still reaches `awaiting-merge`. This is the first of three Issues toward ADR 0003; the later ones publish only Issues that pass this check.

- [x] When the Review Session returns any Critical Finding with `fixed: false`, the Gate is not run, and the Issue goes to `ready-for-human`. The unfixed Critical Findings are commented on the Issue. The Run stops, like it does on a Gate failure.
- [x] This is a new `IssueResult` outcome, and the log summary says the Gate was not run and why.
- [x] Spec disagreements still take priority, exactly as today: `needs-info`, and the Gate is not run.
- [x] Tested at the `runWorkflow` seam with a fake Agent:
  - an unfixed Critical Finding gives `ready-for-human`, no Gate run, and the Run stops with `--count 2`;
  - a fixed Critical Finding still reaches the Gate.

## Comments

Usage: Implementer 28 input, 7,211 output, 41,298 cache creation, 562,009 cache read; Review Session 12 input, 1,933 output, 22,947 cache creation, 173,224 cache read.

**Review Session: Non-critical Findings**

- The Issue file never records that the Gate was not run or why for a critical-unfixed outcome; only the console log says so. Someone reading the Issue sees ready-for-human and the Findings comment, but no explicit note that the Gate was skipped.
- cli.ts now exits with 1 on the critical-unfixed outcome. This is consistent with gate-failed but was not requested by the Issue, and no test covers it.
- The findingsForHuman doc comment ('any Critical one left unfixed') now only matters for the spec-disagreement path, because any Issue with an unfixed Critical Finding stops before the Gate. The comment could say so to stay accurate.

**Gate failed** (log: `.sandcastle/logs/gate-13-2026-11-13T15-07-48-686Z.log`)

```
$ npm run typecheck

> sandcastle-pro@0.0.0 typecheck
> tsc --noEmit

sh: tsc: command not found
(exit code 127)
```

The Gate failure was environmental: the Gate worktree had no `node_modules`, so `tsc` was missing. With `npm ci` run first, `npm run check` passes on this branch (typecheck, 141 tests, build). The Gate config now starts with `npm ci`.
