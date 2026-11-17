# 04: "Base Issue" wording and README

Status: ready-for-agent
Blocked by: 02

Spec: `.scratch/run-stacking/spec.md` (stories 30, 39–42), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** Under `"stack": "run"`, the Issue a Stacked Issue is started on is usually not one of its blockers, so text calling it "the blocker" is wrong. Use the glossary's Base Issue and Stack, and document how to use `"run"`.

- [x] Comments, logs, the Pull Request body and the code's type and function names say "Base Issue" for the Issue a Stacked Issue is started on, for example the "Blocker closed" comment and the stacked-on text in the Pull Request body. Text about real `Blocked by:` relationships keeps "blocker".
- [x] The README explains `"stack": false | true | "run"` and recommends `"run"`.
- [x] The README tells the human to merge the Stack from the bottom up, to change only the top Pull Request, and to put a fix to any other Pull Request in a follow-up Issue.
- [x] The README says `"run"` needs `pullRequest`, merge commits rather than squash merges, and "Automatically delete head branches" turned on.
- [x] Tests that assert on the changed wording are updated, and `npm run check` passes.

## Comments
