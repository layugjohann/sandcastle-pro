# 03: An Issue whose recorded Base Issue is no longer the top goes to ready-for-human

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/32
Blocked by: 02

Spec: `.scratch/run-stacking/spec.md` (stories 20–23), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** Say an Issue fails the Gate, goes to `ready-for-human`, and a later Run stacks other work on its Base Issue. When the human sets the failed Issue back to `ready-for-agent`, its `Stacked on:` line and branch would make a second branch on that Base Issue, splitting the Stack in two. The Run must hand the Issue back to the human instead of starting it.

- [x] In `"run"` mode, before starting a `ready-for-agent` Issue that has a `Stacked on:` line, the Run compares that line to the current top of the Stack. If they differ, the Issue goes to `ready-for-human`, and the Run carries on with the next Issue.
- [x] The comment names the recorded Base Issue and the current top. It gives two ways to fix it: rebase onto the top and update `Stacked on:`, or delete the branch and remove the line so the Issue restarts on the top.
- [x] When the recorded Base Issue is still the top, the Issue starts on it as recorded.
- [x] Paused Issues skip this check and resume on their recorded Base Issue, as today.
- [x] Tested at the `runWorkflow` seam:
  - An Issue fails the Gate, the next Run stacks a new Issue, and the failed Issue is set back to `ready-for-agent`: it goes to `ready-for-human` with the comment.
  - An Issue set back while its Base Issue is still the top starts normally.

## Comments

Usage: Implementer 42 input, 11,118 output, 76,325 cache creation, 878,187 cache read; Review Session 10 input, 3,176 output, 27,771 cache creation, 153,286 cache read.

**Review Session: Non-critical Findings**

- sendBackIfBaseMoved checks `issue.stackedOn === undefined` even though toIssue only sets currentTop when stackedOn is defined; the check is redundant.
- The new `currentTop` field is on the exported public `Issue` type, but only the Run uses it to decide whether to start an Issue.
- No test shows that a paused Stacked Issue whose recorded Base Issue is no longer the top still resumes on it (checklist item 4). The code handles it, but nothing guards it.
- The code comment in runIssue still says the base is 'its blocker's' branch for a Stacked Issue; in "run" mode it may be a Base Issue that is not a blocker (Issue 04 may cover this wording).

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-03-2026-11-17T08-46-16-801Z.log`).

Usage: Body writer 2 input, 1,234 output, 24,186 cache creation, 11,457 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/32
