# 01: Tracer bullet: one Issue runs to awaiting-merge

Status: done
Blocked by: None (can start immediately)

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Set up the TypeScript package (`sandcastle-pro`) and its test harness. Build the first end-to-end path through the Run Workflow. With an Agent passed in, a Run picks the lowest-numbered `ready-for-agent` Issue from `.scratch/<feature>/issues/` and sets it to `in-progress`. It runs the Implementer on the Issue's own branch (`issue/NN-slug`), runs the Gate commands, and moves the Issue to `awaiting-merge`. If no Issue is ready, the Run exits cleanly with a clear message. There is no Review Session yet.

This ticket sets up the single test seam. Tests pass in a fake Agent that makes commits. Everything else is real: a temporary git repo, real Issue files and real Gate commands. The Issue Store's interface is in domain terms (`next`, `transition`, `comment`). It doesn't expose raw text editing.

- [x] The package builds and the test runner works
- [x] The Run Workflow accepts an Agent capability (prompt, model, effort, branch, iteration cap, optional resume session), so a fake Agent can be used
- [x] A Run picks the lowest-numbered `ready-for-agent` Issue and sets it to `in-progress`
- [x] The Implementer's commits land on `issue/NN-slug`, and the target branch is untouched
- [x] The Implementer prompt includes the Issue, its Spec and `GLOSSARY.md` (if present)
- [x] When the Gate passes, the Issue moves to `awaiting-merge`
- [x] With no ready Issue, the Run exits cleanly with a message and changes nothing
- [x] The tests use a real temp git repo, real Issue files and real Gate commands; only the Agent is faked

## Comments

Implemented on `issue/01-tracer-bullet-issue-to-awaiting-merge`.

- Package: `src/` (Agent types, Issue Store, Gate, prompt builder, Run Workflow), tests in `test/` (vitest). `npm test`, `npm run typecheck`, `npm run build`.
- The Run Workflow creates `issue/NN-slug` from the target branch (the current branch by default) before calling the Agent, so the Agent always gets an existing branch. The Gate runs in a temporary worktree of that branch, so the main checkout is never switched.
- Status changes are written to the working tree and not committed.
- Left for later tickets: on a Gate failure the Issue stays `in-progress` (03 moves it to `ready-for-human`); a `limit-reached` Agent result throws (09 adds pausing); no blocker or paused handling yet (04, 09).
