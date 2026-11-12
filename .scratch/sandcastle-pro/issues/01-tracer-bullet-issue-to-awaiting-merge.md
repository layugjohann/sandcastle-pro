# 01: Tracer bullet: one Issue runs to awaiting-merge

Status: ready-for-agent
Blocked by: None (can start immediately)

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Set up the TypeScript package (`sandcastle-pro`) and its test harness. Build the first end-to-end path through the Run Workflow. With an Agent passed in, a Run picks the lowest-numbered `ready-for-agent` Issue from `.scratch/<feature>/issues/` and sets it to `in-progress`. It runs the Implementer on the Issue's own branch (`issue/NN-slug`), runs the Gate commands, and moves the Issue to `awaiting-merge`. If no Issue is ready, the Run exits cleanly with a clear message. There is no Review Session yet.

This ticket sets up the single test seam. Tests pass in a fake Agent that makes commits. Everything else is real: a temporary git repo, real Issue files and real Gate commands. The Issue Store's interface is in domain terms (`next`, `transition`, `comment`). It doesn't expose raw text editing.

- [ ] The package builds and the test runner works
- [ ] The Run Workflow accepts an Agent capability (prompt, model, effort, branch, iteration cap, optional resume session), so a fake Agent can be used
- [ ] A Run picks the lowest-numbered `ready-for-agent` Issue and sets it to `in-progress`
- [ ] The Implementer's commits land on `issue/NN-slug`, and the target branch is untouched
- [ ] The Implementer prompt includes the Issue, its Spec and `GLOSSARY.md` (if present)
- [ ] When the Gate passes, the Issue moves to `awaiting-merge`
- [ ] With no ready Issue, the Run exits cleanly with a message and changes nothing
- [ ] The tests use a real temp git repo, real Issue files and real Gate commands; only the Agent is faked
