# 04: "Base Issue" wording and README

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/33
Blocked by: 02

Spec: `.scratch/run-stacking/spec.md` (stories 30, 39–42), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** Under `"stack": "run"`, the Issue a Stacked Issue is started on is usually not one of its blockers, so text calling it "the blocker" is wrong. Use the glossary's Base Issue and Stack, and document how to use `"run"`.

- [x] Comments, logs, the Pull Request body and the code's type and function names say "Base Issue" for the Issue a Stacked Issue is started on, for example the "Blocker closed" comment and the stacked-on text in the Pull Request body. Text about real `Blocked by:` relationships keeps "blocker".
- [x] The README explains `"stack": false | true | "run"` and recommends `"run"`.
- [x] The README tells the human to merge the Stack from the bottom up, to change only the top Pull Request, and to put a fix to any other Pull Request in a follow-up Issue.
- [x] The README says `"run"` needs `pullRequest`, merge commits rather than squash merges, and "Automatically delete head branches" turned on.
- [x] Tests that assert on the changed wording are updated, and `npm run check` passes.

## Comments

Usage: Implementer 28 input, 7,653 output, 43,039 cache creation, 582,316 cache read; Review Session 8 input, 1,793 output, 34,623 cache creation, 140,209 cache read.

**Review Session: Non-critical Findings**

- README 'Picks Issues' step (line 88) still says a Run picks the lowest-numbered ready-for-agent Issue 'whose blockers are done', which is incomplete under "stack": true / "run" (awaiting-merge blockers can be satisfied) and now contradicts the new Stacking section. Pre-existing text, not touched by the diff.
- test/stacked-issues.test.ts keeps the constant name BLOCKER_LINE and the test title 'starts a Stacked Issue's plain body with the blocker line' although the line now names the Base Issue; the names no longer match the domain wording.
- README.md now ends with an extra trailing blank line after the Stacking section.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-04-2026-11-17T08-56-12-395Z.log`).

Usage: Body writer 2 input, 1,202 output, 32,716 cache creation, 11,457 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/33
