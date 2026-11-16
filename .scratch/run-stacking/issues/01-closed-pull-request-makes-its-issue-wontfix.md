# 01: Closing a Pull Request makes its Issue wontfix and cascades up the Stack

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/run-stacking/spec.md` (stories 33–38), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** Today, an Issue whose Pull Request was closed without merging stays `awaiting-merge` forever, and only the Issues stacked directly on it go to `ready-for-human`. Under `"stack": "run"` that closed Issue would become the top of the Stack. Instead, in every `stack` mode, merge detection ends the closed Issue and sends everything above it in the Stack to the human.

- [ ] An `awaiting-merge` Issue whose Pull Request is `CLOSED` goes to `wontfix`, with a comment saying its Pull Request (URL) was closed without being merged. This happens with `stack` off too.
- [ ] Every Issue above it in the Stack, found by following `Stacked on:` lines upward through every level, goes to `ready-for-human`. Each gets a comment naming the closed Issue and its Pull Request URL, even when that Issue is several levels down.
- [ ] Issues whose own Pull Request reached the target branch in the same pass are marked `done`, not sent to the human. Issues already `done`, `ready-for-human` or `wontfix` keep their status.
- [ ] Every state is still read before anything is moved, so the outcome doesn't depend on the order Issues are visited in.
- [ ] A later Run doesn't comment on the same Issues again.
- [ ] Tested at the `runWorkflow` seam with the fake publisher and a three-Issue Stack: closing the bottom Pull Request makes it `wontfix` and sends both Issues above it to `ready-for-human`. An Issue above it that was merged into the target branch goes to `done`. With `stack` off, a closed Pull Request still gives `wontfix`.

## Comments
