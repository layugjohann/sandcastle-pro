# 01: Stack a two-Issue chain in one Run

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/23
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 1, 5, 6, 8, 9, 14, 15), ADR `docs/adr/0004-blocked-issues-stack-on-unmerged-blockers.md`

**What to build:** This is the tracer bullet. With `"stack": true`, a `--count 2` Run over Issue A and Issue B (`Blocked by: A`) builds both. A reaches `awaiting-merge` and gets its Pull Request. B is then picked as a Stacked Issue: the Run writes a `Stacked on: issue/<A's branch>` header line, cuts B's branch from A's branch tip, reviews B against A's branch, runs the Gate on B's branch as it is, and opens B's Pull Request with A's branch as the base. With `stack` off, nothing changes.

- [x] Config accepts `stack: boolean`, default `false`. A non-boolean value is a config error, and so is `stack: true` with `pullRequest: false`; the message names both keys.
- [x] With `stack` on, `next()` treats a blocker as satisfied when it is `done`, or when it is the Issue's only unsatisfied blocker and it is `awaiting-merge`. With `stack` off, `next()` and `blocked()` behave exactly as today.
- [x] When the Run starts a Stacked Issue, it writes `Stacked on: <blocker branch>` near the top of the Issue file, following the existing header-line rules (bold style kept, never below `## Comments`). An Issue without the line is based on the target branch.
- [x] The Issue's base (its `Stacked on:` branch, else the target branch) replaces the target branch wherever one Issue's work is measured or published: `ensureBranch`, the Review Session's commit list and diff, and `publisher.publish({ base })`. The target branch is still what the Run pulls and detects merges into.
- [x] The Gate runs on the Stacked Issue's branch, which includes the blocker's commits.
- [x] `docs/agents/sandcastle-pro-issues.md` documents `stack` and the `Stacked on:` line ("set by a Run; leave it alone").
- [x] Tested at the `runWorkflow` seam with the fake agent, the fake publisher and a local bare repository as `origin`:
  - with `stack` on, `--count 2` over A ← B gives two `awaiting-merge` Issues; B's branch contains A's commits; B's Review diff doesn't; B's publish call has `base` set to A's branch;
  - with `stack` off, the same Run stops after A and logs that B is blocked by A;
  - the config errors above.

## Comments

**Implementer note:** The Issue parser has no bold-style header lines today (`Status:` and `Blocked by:` are only read in plain style). `Stacked on:` is read in either style, and it is written in bold when the file's `Status:` or `Blocked by:` line is bold. It goes under `Blocked by:`, else under `Status:`, else under the title, and never below `## Comments`. When the Run publishes a Stacked Issue, the Issue file is merged against the blocker branch's copy, and the `Stacked on:` line goes onto the branch along with `Status:` and `Pull Request:`. Merge detection for Stacked Issues is unchanged; later Issues cover it.

Usage: Implementer 50 input, 20,666 output, 110,755 cache creation, 1,362,597 cache read; Review Session 10 input, 3,865 output, 36,400 cache creation, 186,122 cache read.

**Review Session: Non-critical Findings**

- When a Stacked Issue fails and goes back to ready-for-agent, its `Stacked on:` line stays in the file. If the blocker is merged before the next Run, the Issue restarts on the old blocker branch and its Pull Request targets a branch that may be deleted, because `baseOf` prefers the recorded `stackedOn` over a fresh pick. Consider removing the line when the Issue goes back to ready-for-agent, or checking it again when the Issue is picked.
- `Issue.stackOn` (picked by `next()`, not yet recorded) and `Issue.stackedOn` (read from the `Stacked on:` line) are near-identical names for different things. A name like `stackCandidate` would make the difference clear.
- The doc comments in src/prompt.ts (lines 26-28 and 131-133) still say `commits`/`diff` are measured since/against the target branch. They now come from the Issue's base (the blocker's branch for a Stacked Issue).

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-01-2026-11-15T17-13-13-680Z.log`).

Usage: Body writer 2 input, 1,584 output, 31,000 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/23
