# 19: Review Sessions classify bugs as Critical

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Tighten the severity definition in the Review Session prompt (`SEVERITY_DEFINITION` in
`src/prompt.ts`) so bugs stop being logged as Non-critical Findings, and give the Review Session the project's glossary
and ADRs to check against.

In retail-ops-agent, Review Sessions logged about 100 Non-critical Findings across 22 Issues and none were acted on.
Real bugs were among them, all in code the Issue's own change added: a warning wiped by `st.rerun()` (Issue 11), an
`assert` standing in for a decision table (Issue 03), undo leaving a Reorder `approved` (Issue 10), and a release that
contradicts ADR 0011 (Issue 14). They were already Critical under the old definition ("a correctness bug"), so the
Review Session misclassified them.

- [x] `SEVERITY_DEFINITION` says a Finding is Critical if a user or caller would see the change behave other than
      intended, however small (for example a message that never shows, stale state after undo, a check that only
      holds while `assert` is enabled).
- [x] It counts a contradiction of an ADR or a glossary definition as Critical, like a Spec contradiction. Using a
      glossary _Avoid_ word in a name stays Non-critical.
- [x] It says: if a Finding might be either, it is Critical.
- [x] Non-critical is narrowed to "the change behaves correctly but could be written better": style, naming,
      simplification, dead code.
- [x] The Review prompt includes the glossary (as the Implementer prompt does) and tells the agent to check the
      changed behaviour against the ADRs in `docs/adr/` (by path, not inlined).
- [x] Tests check the Review prompt for the behaviour test, the ADR/glossary rule, the tiebreak and the glossary.

## Comments

**Triage (2026-11-27):** Chose to tighten the definition (C) over the original options.
- A (a `needs-triage` Issue per Run) was rejected: Non-critical Findings already reach the human in the Issue's
  Comments and the Pull Request body, and were ignored there. More tracker files would not fix the misclassification.
- B (`bug`/`style` labels) was rejected: a `bug` Finding is already Critical, so B is C under another name.
- Non-critical Findings stay where they are (Issue Comments and Pull Request body). The Run Workflow does not change.
- GLOSSARY.md's Critical / Non-critical Finding entries are updated to match.
