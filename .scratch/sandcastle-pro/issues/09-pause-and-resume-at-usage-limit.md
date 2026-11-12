# 09: Pause and resume at the usage limit

Status: ready-for-agent
Blocked by: 02, 08

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** When Claude hits the Pro usage limit, the adapter returns limit-reached with the session id and usage so far. The Run commits work-in-progress to the Issue's branch, and marks the Issue `paused` with the session id and the stage it was in (Implementer or Review Session). Then it exits immediately, without waiting. The next Run picks paused Issues before any new one, continues the original session in the recorded stage, and then carries on through the rest of the Run as normal.

- [ ] The adapter turns Claude's usage-limit failure into a limit-reached result
- [ ] Work-in-progress is committed to the Issue's branch on pause
- [ ] The Issue is marked `paused` and records the session id and stage
- [ ] The Run exits immediately on the limit, even with `--count N`
- [ ] The next Run resumes a paused Issue before any `ready-for-agent` Issue
- [ ] A pause during the Implementer resumes the Implementer; a pause during the Review Session resumes the Review Session
- [ ] The resumed stage continues the original session, not a fresh one
