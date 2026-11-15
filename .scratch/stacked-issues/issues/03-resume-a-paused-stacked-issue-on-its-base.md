# 03: Resume a paused Stacked Issue on its base

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (story 7)

**What to build:** When a Stacked Issue pauses at the usage limit, the next Run resumes it on the same base. The `Stacked on:` line is what records the base, so a resume must read it and never re-derive the base from the current blocker statuses. Those may have changed since: the blocker could have merged meanwhile.

- [x] A paused Stacked Issue resumes on the branch named by its `Stacked on:` line, in whichever stage it paused, with its Review diff and Pull Request base taken from that line.
- [x] If the blocker was merged into the target branch while the Stacked Issue was paused, the resume still uses the recorded base. The Pull Request is retargeted by GitHub, not by the Run.
- [x] If the `Stacked on:` branch no longer exists locally, the Issue goes to `ready-for-human` with a comment naming the missing branch. It isn't silently rebuilt on the target branch.
- [x] Tested at the `runWorkflow` seam: a Stacked Issue paused in the Review Session resumes with the blocker-relative diff; a missing base branch sends it to `ready-for-human`.

## Comments
