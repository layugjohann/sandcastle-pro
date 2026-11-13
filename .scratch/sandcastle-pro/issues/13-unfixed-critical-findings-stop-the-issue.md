# 13: Unfixed Critical Findings stop the Issue

Status: ready-for-agent
Blocked by: 12

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** An Issue should only reach `awaiting-merge` once every Critical Finding is fixed, so that only Non-critical Findings are left for the human. Today, a Critical Finding the Review Session reports with `fixed: false` is only commented on the Issue. The Gate still runs and the Issue still reaches `awaiting-merge`. This is the first of three Issues toward ADR 0003; the later ones publish only Issues that pass this check.

- [x] When the Review Session returns any Critical Finding with `fixed: false`, the Gate is not run, and the Issue goes to `ready-for-human`. The unfixed Critical Findings are commented on the Issue. The Run stops, like it does on a Gate failure.
- [x] This is a new `IssueResult` outcome, and the log summary says the Gate was not run and why.
- [x] Spec disagreements still take priority, exactly as today: `needs-info`, and the Gate is not run.
- [x] Tested at the `runWorkflow` seam with a fake Agent:
  - an unfixed Critical Finding gives `ready-for-human`, no Gate run, and the Run stops with `--count 2`;
  - a fixed Critical Finding still reaches the Gate.
