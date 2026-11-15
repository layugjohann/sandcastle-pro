# 03: Resume a paused Stacked Issue on its base

Status: done
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/25
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (story 7)

**What to build:** When a Stacked Issue pauses at the usage limit, the next Run resumes it on the same base. The `Stacked on:` line is what records the base, so a resume must read it and never re-derive the base from the current blocker statuses. Those may have changed since: the blocker could have merged meanwhile.

- [x] A paused Stacked Issue resumes on the branch named by its `Stacked on:` line, in whichever stage it paused, with its Review diff and Pull Request base taken from that line.
- [x] If the blocker was merged into the target branch while the Stacked Issue was paused, the resume still uses the recorded base. The Pull Request is retargeted by GitHub, not by the Run.
- [x] If the `Stacked on:` branch no longer exists locally, the Issue goes to `ready-for-human` with a comment naming the missing branch. It isn't silently rebuilt on the target branch.
- [x] Tested at the `runWorkflow` seam: a Stacked Issue paused in the Review Session resumes with the blocker-relative diff; a missing base branch sends it to `ready-for-human`.

## Comments

Usage: Implementer 24 input, 7,958 output, 44,941 cache creation, 479,144 cache read; Review Session 10 input, 2,744 output, 25,184 cache creation, 140,021 cache read.

**Review Session: Non-critical Findings**

- branchExists repeats the `git branch --list` check that ensureBranch does inline; ensureBranch could reuse the new helper.
- cli.ts now exits non-zero on a `base-missing` outcome. Neither the Issue nor the Spec asks for this; it fits how a failed Gate is treated, but it changes the exit behaviour.
- Moving a paused Issue to ready-for-human drops its pause record (session id), so after the base branch is restored the old session can't be resumed and the Issue starts fresh. This matches how transition already works, and the work is committed on the branch.
- Only a pause in the Review Session is tested; a Stacked Issue paused in the Implementer is untested, though it shares the same base handling.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-03-2026-11-15T18-16-57-865Z.log`).

Usage: Body writer 2 input, 1,143 output, 17,866 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/25
