I want to fix a problem with how a `--count N` Run handles Issues that don't block each other. Please grill me on the design first, then write a Spec and Issues under `.scratch/`, and an ADR that amends 0004. Don't implement anything yet.

## The problem

My loop in another project (fixline) is:

1. Merge the Pull Requests from the last Run, then `land-done` to mark those Issues `done`.
2. `npx sandcastle-pro run --count 3`
3. Review and merge the 3 Pull Requests.

In every round, Pull Requests 2 and 3 conflict with `main` once I merge the first one. The cause:

- Each Issue in a Run is cut from the target branch as it is at that moment. The Issues the Run finished earlier are only `awaiting-merge`, so all 3 branches start from the same commit, and none of them sees the others' changes. Rounds of fixline Issues 06/11/14 and 07/08/12 each shared a single merge-base.
- `stack` (ADR 0004) doesn't help. It only stacks an Issue on an unmerged *blocker*. These Issues had no `Blocked by:` between them, since each was blocked only by an Issue that was already `done`. Marking a whole batch `done` unblocks its dependants together, and those dependants usually come from the same area of the Spec, so they edit the same files.
- The Gate runs on each branch alone, against its own base. So it passes every time, and the breakage only shows when the human merges.

The breakage comes in three kinds, from most to least visible:

1. **Textual conflicts** in files everyone touches, such as the main UI component, the domain schema module and the coordinator.
2. **File moves.** One Issue moves or splits a file while a sibling edits the original, so git can't carry the edit over, and I moved it by hand.
3. **Semantic breaks with no git conflict.** One Issue adds a required schema field, and a sibling's tests build that object by hand without it. After the rebase, the typecheck or tests fail even where git merged cleanly. This took the most fixing.

Each round, I had to rebase the 2nd and 3rd Pull Requests by hand, port UI changes across moved files, and patch test fixtures.

## What I want

Ideally, the Issues of one Run land without the human rebasing anything, and the Gate sees all the Run's earlier work, so semantic breaks get caught in the sandbox instead of after the merge.

Here's my leading idea; challenge it:

- **Chain the Run.** Add a config option (or `--chain`) that makes each Issue after the first a Stacked Issue on the previous Issue's branch, even with no `Blocked by:` between them. That reuses the existing stacking (Review Session diff against the base, the Pull Request targets the base, GitHub retargets on merge), and the Gate then runs on the combined work.
- Open questions:
  - Should the first Issue of a new Run also chain onto the last still-`awaiting-merge` branch from an earlier Run?
  - How should this interact with Issues that do have an unmerged blocker? An Issue that's already stacked can't also chain onto a different branch.
  - What happens when the human wants to merge out of order, or close one Pull Request in the middle of the chain? The rule "stacked Issues go to `ready-for-human`" might cascade badly here.
  - Should the PR body tell the human to merge in order?

Alternatives to weigh against it:

- **Chain only when files overlap.** For example, chain an Issue when the files the previous Issue changed overlap with files the new Issue's text names. This one is cheaper for the human but fuzzier.
- **A `restack` command after merging.** It would rebase the remaining `awaiting-merge` branches onto the new target branch, rerun the Gate, and force-push. ADR 0004 says "the Run never rebases a Stacked Issue", so this would need to amend that.
- **Do nothing in the tool,** and document `--count 1` plus serialising `Blocked by:` instead.

Constraints from the existing ADRs: `done` must keep meaning "on the target branch"; status changes stay in the host, with no extra agent stage; and stacking needs merge commits, not squash merges.

Read `GLOSSARY.md`, `docs/adr/0002`–`0004`, the `stacked-issues` Spec, and `src/run-workflow.ts` / `src/issue-store.ts` (look at `baseOf` and `stackOn`) before asking me anything. Use the glossary's terms. "Chained" is currently listed under *Avoid* for Stacked Issue, so if we need a new term, propose one.
