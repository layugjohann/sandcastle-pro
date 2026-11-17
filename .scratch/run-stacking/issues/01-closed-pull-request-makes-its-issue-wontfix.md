# 01: Closing a Pull Request makes its Issue wontfix and cascades up the Stack

Status: done
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/30
Blocked by: None

Spec: `.scratch/run-stacking/spec.md` (stories 33–38), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** Today, an Issue whose Pull Request was closed without merging stays `awaiting-merge` forever, and only the Issues stacked directly on it go to `ready-for-human`. Under `"stack": "run"` that closed Issue would become the top of the Stack. Instead, in every `stack` mode, merge detection ends the closed Issue and sends everything above it in the Stack to the human.

- [x] An `awaiting-merge` Issue whose Pull Request is `CLOSED` goes to `wontfix`, with a comment saying its Pull Request (URL) was closed without being merged. This happens with `stack` off too.
- [x] Every Issue above it in the Stack, found by following `Stacked on:` lines upward through every level, goes to `ready-for-human`. Each gets a comment naming the closed Issue and its Pull Request URL, even when that Issue is several levels down.
- [x] Issues whose own Pull Request reached the target branch in the same pass are marked `done`, not sent to the human. Issues already `done`, `ready-for-human` or `wontfix` keep their status.
- [x] Every state is still read before anything is moved, so the outcome doesn't depend on the order Issues are visited in.
- [x] A later Run doesn't comment on the same Issues again.
- [x] Tested at the `runWorkflow` seam with the fake publisher and a three-Issue Stack: closing the bottom Pull Request makes it `wontfix` and sends both Issues above it to `ready-for-human`. An Issue above it that was merged into the target branch goes to `done`. With `stack` off, a closed Pull Request still gives `wontfix`.

## Comments

Usage: Implementer 36 input, 15,154 output, 50,503 cache creation, 798,517 cache read; Review Session 8 input, 4,481 output, 34,968 cache creation, 134,340 cache read.

**Review Session: Non-critical Findings**

- strandedByClosedIssues does two jobs: it climbs the Stack from each closed Issue, then gives each stranded Issue the lowest closure below it. Splitting the climb into its own helper would make each part easier to read (Preset: each function does one thing).
- strandedByClosedIssues finds the lowest closed Issue by sorting closed Issues on how many Issues sit above each. That is correct, because a lower closed Issue always has strictly more above it, but it is indirect. Checking whether one closed Issue is reachable from another would say what it means.
- Each level of the climb calls store.stackedOn, and every call reads and parses all Issue files again, so the cost grows with the square of the Stack's size. Reading the Issue files once and following the Stacked on: lines in memory would avoid the repeated reads.
- The comment for an Issue several levels up still opens with '**Blocker closed**', even though the closed Issue is not one of its blockers. Spec story 30 asks for 'Base Issue' wording; the Spec's suggested split leaves this to Issue 04.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-01-2026-11-16T20-50-13-380Z.log`).

Usage: Body writer 2 input, 1,247 output, 27,481 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/30
