# 01: Stack a two-Issue chain in one Run

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 1, 5, 6, 8, 9, 14, 15), ADR `docs/adr/0004-blocked-issues-stack-on-unmerged-blockers.md`

**What to build:** This is the tracer bullet. With `"stack": true`, a `--count 2` Run over Issue A and Issue B (`Blocked by: A`) builds both. A reaches `awaiting-merge` and gets its Pull Request. B is then picked as a Stacked Issue: the Run writes a `Stacked on: issue/<A's branch>` header line, cuts B's branch from A's branch tip, reviews B against A's branch, runs the Gate on B's branch as it is, and opens B's Pull Request with A's branch as the base. With `stack` off, nothing changes.

- [ ] Config accepts `stack: boolean`, default `false`. A non-boolean value is a config error, and so is `stack: true` with `pullRequest: false`; the message names both keys.
- [ ] With `stack` on, `next()` treats a blocker as satisfied when it is `done`, or when it is the Issue's only unsatisfied blocker and it is `awaiting-merge`. With `stack` off, `next()` and `blocked()` behave exactly as today.
- [ ] When the Run starts a Stacked Issue, it writes `Stacked on: <blocker branch>` near the top of the Issue file, following the existing header-line rules (bold style kept, never below `## Comments`). An Issue without the line is based on the target branch.
- [ ] The Issue's base (its `Stacked on:` branch, else the target branch) replaces the target branch wherever one Issue's work is measured or published: `ensureBranch`, the Review Session's commit list and diff, and `publisher.publish({ base })`. The target branch is still what the Run pulls and detects merges into.
- [ ] The Gate runs on the Stacked Issue's branch, which includes the blocker's commits.
- [ ] `docs/agents/sandcastle-pro-issues.md` documents `stack` and the `Stacked on:` line ("set by a Run; leave it alone").
- [ ] Tested at the `runWorkflow` seam with the fake agent, the fake publisher and a local bare repository as `origin`:
  - with `stack` on, `--count 2` over A ← B gives two `awaiting-merge` Issues; B's branch contains A's commits; B's Review diff doesn't; B's publish call has `base` set to A's branch;
  - with `stack` off, the same Run stops after A and logs that B is blocked by A;
  - the config errors above.

## Comments
