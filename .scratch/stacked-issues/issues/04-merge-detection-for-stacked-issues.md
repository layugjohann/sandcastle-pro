# 04: Merge detection for Stacked Issues

Status: done
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/26
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 11, 12, 13)

**What to build:** `done` must keep meaning "merged into the target branch". A Stacked Issue's Pull Request starts out targeting its blocker's branch, so GitHub's `MERGED` alone is not enough. The host also checks the Pull Request's base branch.

- [x] The publisher's merge query returns the Pull Request's state and its base branch (`gh pr view --json state,baseRefName`).
- [x] An Issue is `done` only when its Pull Request is `MERGED` with base equal to the target branch. Catching up after the merge (Issue 16 of `.scratch/sandcastle-pro/`) is unchanged.
- [x] A Pull Request `MERGED` into any other branch leaves the Issue `awaiting-merge`. The Run logs a warning naming the Issue, the branch it was merged into, and the target branch, and says to merge its blocker first.
- [x] When a blocker's Pull Request is `CLOSED` without being merged, each Issue whose `Stacked on:` line names that blocker's branch, and that is not yet `done`, goes to `ready-for-human`. Each gets a comment naming the closed blocker and its URL. The existing warning for the closed blocker itself stays.
- [x] Issues without a `Stacked on:` line behave exactly as today.
- [x] Tested at the `runWorkflow` seam with the fake publisher: merged into the target gives `done`; merged into the blocker's branch gives `awaiting-merge` plus the warning; a closed blocker sends its Stacked Issue to `ready-for-human` with the comment.

## Comments

Implementer note: besides `done`, Stacked Issues already in `ready-for-human` or `wontfix` are left alone when their blocker is closed. The closed blocker stays `awaiting-merge`, so without this every later Run would comment on the same Issue again.

Usage: Implementer 34 input, 11,132 output, 47,080 cache creation, 708,274 cache read; Review Session 8 input, 3,450 output, 27,961 cache creation, 118,061 cache read.

**Review Session: Non-critical Findings**

- When a blocker is closed, its Stacked Issues already in `wontfix` (and `ready-for-human`) are left alone. The Issue says every stacked Issue 'that is not yet done' goes to `ready-for-human`. Skipping `ready-for-human` changes nothing except avoiding a repeat comment on every Run. Skipping `wontfix` is a small departure that seems sensible, and the Implementer's note in the Issue file says so. It needs the human to confirm.
- Edge case: the human retargets a Stacked Issue's Pull Request to the target branch by hand and merges it, while its blocker's Pull Request was closed. The Stacked Issue then goes to `ready-for-human` instead of `done`. This is because `sendStackedIssuesToHuman` runs before catch-up and drops the Issue from `mergedPullRequests`. Strictly it agrees with the Issue text, since the Issue is not yet `done` at that point, but its work is already on the target branch.
- Simplification: if a stacked Issue that is still `awaiting-merge` must never be caught up after its blocker closed, the `!moved.has(...)` filter on `mergedPullRequests` and the second `moved` check in the `caughtUp` loop could be one check. The guard against acting twice is spread over three places in `markMergedIssuesDone`.
- A Pull Request merged into its blocker's branch stays `awaiting-merge`, and its state never changes. Its wrong-order warning is therefore logged on every later Run, with no way to clear it except editing the status by hand. The Spec asks for exactly this, but it may become noisy.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-04-2026-11-15T18-28-25-904Z.log`).

Usage: Body writer 2 input, 1,295 output, 22,071 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/26
