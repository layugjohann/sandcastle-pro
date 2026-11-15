# 06: A merged Stacked Issue is done even when its blocker was closed

Status: done
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/28
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 11, 13). Review Finding from Issue 04.

**What to build:** Take a blocker whose Pull Request was closed without merging. The human retargets the Stacked Issue's Pull Request to the target branch and merges it. Its work is on the target branch, so it should become `done`. Today, `markMergedIssuesDone` (`src/run-workflow.ts`) handles the closed blocker first. `sendStackedIssuesToHuman` moves the Stacked Issue to `ready-for-human` and adds it to `moved`, so the catch-up later filters it out of `mergedPullRequests`. A Stacked Issue whose Pull Request is merged into the target branch must be caught up and marked `done`, whatever happened to its blocker.

- [x] When a blocker's Pull Request is `CLOSED`, a Stacked Issue on it whose own Pull Request is `MERGED` into the target branch is not sent to `ready-for-human`, and gets no closed-blocker comment. It is caught up (Issue 16 of `.scratch/sandcastle-pro/`) and marked `done` in the same Run.
- [x] A Stacked Issue on a closed blocker whose own Pull Request is not merged into the target branch still goes to `ready-for-human` with the closed-blocker comment, as Issue 04 specifies.
- [x] The result doesn't depend on the order the blocker and the Stacked Issue are visited in. Lower and higher numbers give the same outcome.
- [x] The guard against acting on an Issue twice lives in one place in `markMergedIssuesDone`, not spread over the `moved` checks in the loop, the `mergedPullRequests` filter and the `caughtUp` loop. (Review Finding from Issue 04.)
- [x] Tested at the `runWorkflow` seam with the fake publisher and a local bare repository as `origin`:
  - closed blocker plus a Stacked Issue `MERGED` into the target branch gives `done`, with its file caught up and no `ready-for-human` comment;
  - closed blocker plus a Stacked Issue still open gives `ready-for-human` with the comment, unchanged;
  - both cases with the Stacked Issue numbered below and above its blocker.

## Comments

- Implementer: `markMergedIssuesDone` now reads every Pull Request state before it moves anything, then marks the Issues on the target branch `done` and only after that handles closed blockers. The set of Issues on the target branch (`onTarget`) is the one guard, passed to `sendStackedIssuesToHuman`. The catch-up also had to change. A Stacked Issue's branch carries its blockers' Issue files, so `git pull` refused while the closed blocker's file had a local edit. `pullMergedIssueFiles` now also discards the edited files of the Issues up the `Stacked on:` chain, but only when they match the merged branch's tip, and it skips files an earlier Issue in the same pull already discarded. Without that skip, a blocker merged together with a lower-numbered Stacked Issue stayed `awaiting-merge`. Tests in `test/stacked-issues.test.ts` run each case with the Stacked Issue numbered above and below its blocker. One existing assertion changed: the closed-blocker test now expects the Stacked Issue's Pull Request state to be read too (`[PR_A, PR_B]`).

Usage: Implementer 48 input, 20,671 output, 55,377 cache creation, 1,099,960 cache read; Review Session 4 input, 3,889 output, 27,255 cache creation, 45,465 cache read.

**Review Session: Non-critical Findings**

- pullMergedIssueFiles (src/run-workflow.ts) is about 70 lines doing selection, checks, discard and pull; split it at those seams (Preset: each function does one thing).
- When `git checkout HEAD -- <file>` fails on a blocker's file in pullMergedIssueFiles, the warning names the Issue's own file, not the blocker file that failed.
- In markMergedIssuesDone the comment 'The Issue file was committed onto the branch, so the merge brings it in: catch up first.' sits on a line that also routes the pullRequest:false case to `merged.ready`, so the comment is only half true.
- No test covers a failure to read the Stacked Issue's Pull Request state while its blocker is CLOSED; it then goes to ready-for-human, which is reasonable but untested.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-06-2026-11-15T18-57-01-279Z.log`).

Usage: Body writer 2 input, 1,326 output, 25,601 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/28
