# 03: An Issue whose recorded Base Issue is no longer the top goes to ready-for-human

Status: ready-for-agent
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
