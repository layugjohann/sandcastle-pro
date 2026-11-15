# 02: Picking rules for Stacked Issues

Status: in-progress
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 2, 3, 4)

**What to build:** Pin down which blocked Issues may stack, and make the Run explain each one it skips. Only a blocker that passed the Gate (`awaiting-merge`) can be built on, and only when it is the one unmerged blocker. Chains have no depth cap.

- [x] An Issue with two or more blockers that are not `done` is skipped even if all of them are `awaiting-merge`. `blocked()` reports it, and the "No Issue is ready" log names each unmerged blocker and says a Stacked Issue can have only one.
- [x] A blocker that is `in-progress`, `paused`, `ready-for-human`, `needs-info`, `ready-for-agent`, `needs-triage` or `wontfix` still blocks, as today.
- [x] Chains have no depth cap: `--count 3` over A ← B ← C builds all three. C is stacked on B's branch, which contains A's commits.
- [x] The lowest-numbered pick order and the "paused first" rule are unchanged.
- [x] Tested at the `runWorkflow` seam: the two-unmerged-blockers skip and its log; a blocker in `ready-for-human` still blocks; a three-Issue chain in one Run.

## Comments

Usage: Implementer 16 input, 5,832 output, 35,059 cache creation, 265,873 cache read; Review Session 8 input, 1,292 output, 19,285 cache creation, 98,150 cache read.

**Review Session: Non-critical Findings**

- The 'keeps the paused-first rule and the lowest-numbered order' test sits in the '…at the runWorkflow seam' describe block but calls createIssueStore directly instead of going through runWorkflow. The test's name and location are misleading; no required coverage is missing.
- In run-workflow.ts, the skip log line 'It has N unmerged blockers' repeats the blocker list printed just before it. A wording or simplification nit.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-02-2026-11-15T17-55-14-126Z.log`).

Usage: Body writer 2 input, 1,246 output, 17,408 cache creation, 11,370 cache read.
