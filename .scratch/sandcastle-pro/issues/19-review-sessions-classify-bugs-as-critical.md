# 19: Review Sessions classify bugs as Critical

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/37
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

Usage: Implementer 18 input, 3,919 output, 30,900 cache creation, 299,492 cache read; Review Session 8 input, 1,504 output, 19,225 cache creation, 102,008 cache read.

**Review Session: Non-critical Findings**

- run-workflow.ts reads GLOSSARY.md separately for the Implementer and for the Review Session (lines 506 and 529); a shared helper would remove the duplication.
- The glossary line in buildReviewPrompt (src/prompt.ts:88) is much longer than the surrounding lines; splitting it would match the existing style.

**Review Session: Spec disagreement (not acted on)**

- The Spec's Testing Decisions say tests 'never assert on internal calls or prompt wording', but Issue 19 asks for tests that check the Review prompt's wording (behaviour test, ADR/glossary rule, tiebreak). The new test follows the Issue; the Spec should say whether prompt-wording tests are allowed for prompt-contract Issues like this one.

**Spec disagreement resolved (2026-11-27):** The Spec's Testing Decisions now allow tests to check that a prompt
carries a required instruction (a section heading or a key rule), but never its exact wording. The prompt tests this
Issue asks for are allowed.

Usage: Implementer 10 input, 1,896 output, 22,347 cache creation, 135,536 cache read; Review Session 6 input, 1,294 output, 20,183 cache creation, 72,795 cache read.

**Review Session: Non-critical Findings**

- The new Review Session test in test/run-workflow.test.ts matches long exact phrases (e.g. 'user or caller would see the change do other than intended, however small'), so it breaks on any rewording even when the rule is unchanged. Shorter key-rule matches would fit the Spec's 'a key rule, never its exact wording' guidance better.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-19-2026-11-27T11-19-23-864Z.log`).

Usage: Body writer 2 input, 1,138 output, 21,321 cache creation, 11,837 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/37
