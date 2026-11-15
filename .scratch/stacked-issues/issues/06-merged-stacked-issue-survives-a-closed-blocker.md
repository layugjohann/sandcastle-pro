# 06: A merged Stacked Issue is done even when its blocker was closed

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 11, 13). Review Finding from Issue 04.

**What to build:** Take a blocker whose Pull Request was closed without merging. The human retargets the Stacked Issue's Pull Request to the target branch and merges it. Its work is on the target branch, so it should become `done`. Today, `markMergedIssuesDone` (`src/run-workflow.ts`) handles the closed blocker first. `sendStackedIssuesToHuman` moves the Stacked Issue to `ready-for-human` and adds it to `moved`, so the catch-up later filters it out of `mergedPullRequests`. A Stacked Issue whose Pull Request is merged into the target branch must be caught up and marked `done`, whatever happened to its blocker.

- [ ] When a blocker's Pull Request is `CLOSED`, a Stacked Issue on it whose own Pull Request is `MERGED` into the target branch is not sent to `ready-for-human`, and gets no closed-blocker comment. It is caught up (Issue 16 of `.scratch/sandcastle-pro/`) and marked `done` in the same Run.
- [ ] A Stacked Issue on a closed blocker whose own Pull Request is not merged into the target branch still goes to `ready-for-human` with the closed-blocker comment, as Issue 04 specifies.
- [ ] The result doesn't depend on the order the blocker and the Stacked Issue are visited in. Lower and higher numbers give the same outcome.
- [ ] The guard against acting on an Issue twice lives in one place in `markMergedIssuesDone`, not spread over the `moved` checks in the loop, the `mergedPullRequests` filter and the `caughtUp` loop. (Review Finding from Issue 04.)
- [ ] Tested at the `runWorkflow` seam with the fake publisher and a local bare repository as `origin`:
  - closed blocker plus a Stacked Issue `MERGED` into the target branch gives `done`, with its file caught up and no `ready-for-human` comment;
  - closed blocker plus a Stacked Issue still open gives `ready-for-human` with the comment, unchanged;
  - both cases with the Stacked Issue numbered below and above its blocker.

## Comments
