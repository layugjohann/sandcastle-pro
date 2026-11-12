# 02: Review Session with Findings

Status: done
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** After the Implementer, one Review Session runs on the same branch before the Gate. It returns structured Findings (severity, whether fixed, description), with Spec disagreements flagged separately. It fixes Critical Findings in the same pass. Critical means correctness bugs, contradictions of the Spec or Issue, security holes, Gate failures and data loss. Non-critical Findings are appended to the Issue's `## Comments`, and that heading is created if it doesn't exist yet. If the reviewer thinks the Spec itself is wrong, that is logged and never fixed, and the Issue moves to `needs-info`. The Gate runs after the Review Session.

- [ ] Exactly one Review Session runs after the Implementer and before the Gate
- [ ] The Review Session prompt includes the branch diff, the commits, and the Critical vs. Non-critical definition
- [ ] Non-critical Findings are appended under `## Comments`, with the heading created if missing
- [ ] Commits that fix Critical Findings land on the Issue's branch
- [ ] A Spec disagreement moves the Issue to `needs-info`, the disagreement is logged, and the Gate doesn't run
- [ ] When the Run finishes it prints the branch name, the Gate result and the Non-critical Findings
