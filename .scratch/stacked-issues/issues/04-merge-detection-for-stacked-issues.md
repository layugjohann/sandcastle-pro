# 04: Merge detection for Stacked Issues

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 11, 12, 13)

**What to build:** `done` must keep meaning "merged into the target branch". A Stacked Issue's Pull Request starts out targeting its blocker's branch, so GitHub's `MERGED` alone is not enough. The host also checks the Pull Request's base branch.

- [ ] The publisher's merge query returns the Pull Request's state and its base branch (`gh pr view --json state,baseRefName`).
- [ ] An Issue is `done` only when its Pull Request is `MERGED` with base equal to the target branch. Catching up after the merge (Issue 16 of `.scratch/sandcastle-pro/`) is unchanged.
- [ ] A Pull Request `MERGED` into any other branch leaves the Issue `awaiting-merge`. The Run logs a warning naming the Issue, the branch it was merged into, and the target branch, and says to merge its blocker first.
- [ ] When a blocker's Pull Request is `CLOSED` without being merged, each Issue whose `Stacked on:` line names that blocker's branch, and that is not yet `done`, goes to `ready-for-human`. Each gets a comment naming the closed blocker and its URL. The existing warning for the closed blocker itself stays.
- [ ] Issues without a `Stacked on:` line behave exactly as today.
- [ ] Tested at the `runWorkflow` seam with the fake publisher: merged into the target gives `done`; merged into the blocker's branch gives `awaiting-merge` plus the warning; a closed blocker sends its Stacked Issue to `ready-for-human` with the comment.

## Comments
