# 02: Picking rules for Stacked Issues

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 2, 3, 4)

**What to build:** Pin down which blocked Issues may stack, and make the Run explain each one it skips. Only a blocker that passed the Gate (`awaiting-merge`) can be built on, and only when it is the one unmerged blocker. Chains have no depth cap.

- [x] An Issue with two or more blockers that are not `done` is skipped even if all of them are `awaiting-merge`. `blocked()` reports it, and the "No Issue is ready" log names each unmerged blocker and says a Stacked Issue can have only one.
- [x] A blocker that is `in-progress`, `paused`, `ready-for-human`, `needs-info`, `ready-for-agent`, `needs-triage` or `wontfix` still blocks, as today.
- [x] Chains have no depth cap: `--count 3` over A ← B ← C builds all three. C is stacked on B's branch, which contains A's commits.
- [x] The lowest-numbered pick order and the "paused first" rule are unchanged.
- [x] Tested at the `runWorkflow` seam: the two-unmerged-blockers skip and its log; a blocker in `ready-for-human` still blocks; a three-Issue chain in one Run.

## Comments
