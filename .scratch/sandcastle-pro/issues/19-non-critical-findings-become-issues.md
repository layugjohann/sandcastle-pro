# 19: Non-critical Findings become Issues

Status: needs-triage
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Make sure a Run's Non-critical Findings reach the tracker, instead of only being appended to the
Issue's `## Comments` (`run-workflow.ts`, around the "Review Session: Non-critical Findings" section).

In retail-ops-agent, Review Sessions logged about 100 Non-critical Findings across 22 Issues and none were acted on.
Real bugs were among them (an `assert` standing in for a decision table, a warning wiped by `st.rerun()`, undo leaving
a stale status), and they're still on `main`.

Choose an approach in triage:
- **A.** After the Gate passes, write one `needs-triage` Issue file per Run that lists its Non-critical Findings,
  linked from the source Issue.
- **B.** Have the Review Session label each Finding `bug` or `style`. Treat `bug` Findings like Critical ones (fixed in
  the same pass), and leave only `style` ones as comments.

- [ ] Approach chosen and recorded in this Issue's comments.
- [ ] A Run whose review has Non-critical Findings leaves them where a human or a later Run will pick them up.
- [ ] Tests cover a Run with and without Non-critical Findings.
