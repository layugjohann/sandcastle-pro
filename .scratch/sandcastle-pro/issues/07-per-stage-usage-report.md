# 07: Per-stage usage report

Status: ready-for-agent
Blocked by: 02

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The Agent reports token usage (input, output, cache creation, cache read) for each stage. At the end of a Run the Preset prints usage split by stage (Implementer vs. Review Session) for each Issue, and appends a one-line summary to the Issue so the cost history stays with the work. This is the evidence for keeping or changing the Opus 5.5 default.

- [ ] Usage is printed per Issue, split by Implementer and Review Session
- [ ] A one-line usage summary is appended to the Issue
- [ ] Usage is reported for every outcome: awaiting-merge, ready-for-human, needs-info, and paused (once 09 lands)
- [ ] Missing usage from the Agent is shown as "unknown" and the Run does not fail
