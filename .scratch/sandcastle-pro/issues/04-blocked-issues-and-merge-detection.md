# 04: Blocked Issues and merge detection

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** A Run skips any `ready-for-agent` Issue whose `Blocked by:` Issues are not all `done`. At the start of every Run, each `awaiting-merge` Issue whose branch has been merged into the target branch moves to `done`. Issues that depended on it are then unblocked within that same Run.

- [ ] An Issue with an unfinished blocker is skipped, and the next eligible Issue is picked
- [ ] `Blocked by: None ...` or a missing line means unblocked
- [ ] An `awaiting-merge` Issue whose branch is merged into the target becomes `done` at the start of the Run
- [ ] An Issue unblocked by that merge can be picked in the same Run
- [ ] An Issue with an unmerged `awaiting-merge` branch is left alone
- [ ] If every ready Issue is blocked, the Run exits cleanly and lists the blocked Issues
