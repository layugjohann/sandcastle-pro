# Spec: Stacked Issues

Decision record: `docs/adr/0004-blocked-issues-stack-on-unmerged-blockers.md`. Amends `.scratch/sandcastle-pro/spec.md`, ADR 0002 and ADR 0003.

## Problem Statement

A `--count N` Run stops at the first Issue whose blocker isn't `done`. A blocker becomes `done` only after I merge its Pull Request, so I have to merge between Runs and the loop can't run while I'm away. A chain of three dependent Issues takes three Runs with a merge in between each.

## Solution

With `"stack": true` in config, an Issue whose only unmerged blocker is `awaiting-merge` becomes a Stacked Issue. It starts on that blocker's branch, it is reviewed against that branch, and its Pull Request targets that branch. One Run can then work through a whole chain. I review and merge the chain in one sitting: merging the blocker lets GitHub retarget the next Pull Request to the target branch. `done` keeps its meaning, "merged into the target branch", and the Run never edits statuses I would otherwise set by hand.

## User Stories

### Picking Issues

1. As a developer, I want a `ready-for-agent` Issue whose one unmerged blocker is `awaiting-merge` to be picked, so that a Run keeps going through a chain without me.
2. As a developer, I want an Issue with two or more unmerged blockers to wait, with the Run logging which blockers it waits on, so that a branch is never built on top of two others.
3. As a developer, I want an Issue whose blocker is `in-progress`, `paused`, `ready-for-human`, `needs-info` or `ready-for-agent` to keep waiting as today, so that only work that passed the Gate is built on.
4. As a developer, I want chains of any length to be allowed, so that `--count` is the only limit on how much is queued for my review.

### Implementing and reviewing

5. As a developer, I want a Stacked Issue's branch cut from the tip of its blocker's branch, so that it builds on code that passed the Gate.
6. As a developer, I want the Review Session's commit list and diff for a Stacked Issue measured from the blocker's branch, so that the blocker's code isn't reviewed again.
7. As a developer, I want a paused Stacked Issue to resume on the same base, so that a usage limit doesn't change what it is built on.
8. As a developer, I want the Gate to run on the Stacked Issue's branch as it is, which includes the blocker's work, so that the stacked result is what is checked.

### Publishing

9. As a developer, I want a Stacked Issue's Pull Request to target its blocker's branch, so that its diff shows only its own work.
10. As a developer, I want the Pull Request body and the Issue's comments to name the blocker it is stacked on, so that I merge in the right order.

### Detecting merges

11. As a developer, I want an Issue marked `done` only when its Pull Request was merged into the target branch, so that `done` still means "on the target branch".
12. As a developer, I want a Stacked Issue whose Pull Request was merged into its blocker's branch, not the target branch, to stay `awaiting-merge` with a warning naming both branches, so that a wrong-order merge is visible.
13. As a developer, I want the Stacked Issues of a blocker whose Pull Request was closed without merging to go to `ready-for-human` with a comment naming the closed blocker, so that I decide what to do with work whose base is gone.

### Config

14. As a developer, I want stacking off unless I set `"stack": true`, so that existing projects behave exactly as before.
15. As a developer, I want `"stack": true` with `"pullRequest": false` rejected with a clear config error, so that I don't have to merge local branches in order by hand.
16. As a developer, I want the README to say that stacking needs merge commits rather than squash merges, and works best with "Automatically delete head branches" turned on, so that I set up the repo correctly.

## Implementation Decisions

- **Where the base lives.** The Issue file records it as a `Stacked on:` header line naming the blocker's branch, written when the Run starts a Stacked Issue. The line is in the file, so it travels with the Issue onto the branch (Issue 16), survives a Pause, and is visible to the human. An Issue without the line is based on the target branch, as today.
- **Picking.** `next()` treats a blocker as satisfied when it is `done`, or, with `stack` on, when it is the only unsatisfied blocker and is `awaiting-merge`. `blocked()` explains each skipped Issue, including "two unmerged blockers".
- **Base threading.** Wherever the workflow uses the target branch as the base for one Issue (`ensureBranch`, the Review diff and `log`, `publisher.publish({ base })`), it uses the Issue's base instead. The target branch stays the branch the Run pulls and detects merges into.
- **Merge detection.** For an Issue with a Pull Request, the host reads the Pull Request's state and base branch from GitHub. It is `done` only when it is `MERGED` with base equal to the target branch. GitHub retargets a stacked Pull Request to the target branch when the blocker's head branch is deleted on merge, so a correctly ordered merge passes this check. Catching up after a merge (Issue 16) is unchanged.
- **No rebasing.** The Run never rebases or merges a blocker into a Stacked Issue's branch. If the blocker changes after stacking, the human handles it.
- **Config.** `stack: boolean`, default `false`. With `pullRequest: false` it is a config error.

## Testing Decisions

- Test at the `runWorkflow` seam with the fake agent, the fake publisher and a local bare repository as `origin`, as for Issue 16.
- `--count 3` over a chain 01 ← 02 ← 03 builds all three. 02's branch contains 01's commits, its Review diff doesn't, and its publish call has `base: issue/01-…`.
- An Issue with two `awaiting-merge` blockers is skipped, and the log names both.
- With `stack` off, the same chain stops at 02 exactly as today.
- Merge detection: `MERGED` into the target branch gives `done`; `MERGED` into the blocker's branch gives `awaiting-merge` plus a warning; a `CLOSED` blocker sends its Stacked Issues to `ready-for-human`.
- A paused Stacked Issue resumes on its recorded base.
- Config: `stack: true` with `pullRequest: false` is rejected.

## Out of Scope

- Automatically rebasing or updating Stacked Issues when their blocker changes.
- Stacking on two or more unmerged blockers, for example by building an octopus base.
- Squash-merge support for chains.
- Merging anything: the merge button stays with the human (ADR 0002).
- A separate agent stage that ticks boxes or sets statuses. The Implementer already ticks boxes, and the host sets statuses without spending tokens.

## Further Notes

- This repo has `delete_branch_on_merge` off. Turn it on before using stacking here.
- Slice into Issues after this Spec is approved.
