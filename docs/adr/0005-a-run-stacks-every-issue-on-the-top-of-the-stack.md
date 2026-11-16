# A Run stacks every Issue on the top of the Stack

Amends 0004. Under 0004, an Issue is cut from the target branch unless it has an unmerged blocker. So the Issues of one `--count N` Run that don't block each other all start from the same commit. They are often unblocked together and come from the same area of a Spec, so they edit the same files. The Gate checks each branch on its own, so it passes every time. The human then finds textual conflicts, edits lost to file moves, and semantic breaks such as a new required field that a sibling's test fixtures lack, but only when merging the second and third Pull Requests. With `"stack": "run"` in config, every Issue becomes a Stacked Issue on the top of the Stack: the `awaiting-merge` Issue that no `awaiting-merge`, `in-progress` or `paused` Issue is stacked on. The Issue starts from the target branch only when the Stack is empty. The Gate then runs on all the unmerged work at once, and merging from the bottom up lets GitHub retarget each Pull Request without a conflict.

## Considered Options

- **Stack only when files overlap**, judged from the files the previous Issue changed and the files the new Issue's text names. Rejected: it misses the costliest kind of break, a semantic break in tests that build an object by hand, because those test files are never named in the Issue.
- **A `restack` command that rebases the remaining branches after a merge.** Rejected: resolving a conflicted rebase needs an agent and costs tokens, and force-pushing rewrites commits the human has already reviewed.
- **Do nothing in the tool and use `--count 1`.** Rejected: it ends AFK Runs, which 0004 exists to allow.
- **Merge a changed Base Issue into the Issues above it** (a merge commit with no force-push, then the Gate runs again). Deferred, not rejected. Version 1 asks the human to change only the top Pull Request and to put any other fix in a follow-up Issue.

## Consequences

- **One Stack for the whole repo, across features and Runs.** A new Run builds on the old Stack when that Stack is not fully merged. As a result, you can't merge an unrelated Pull Request before the ones below it.
- **The rule of "only one unmerged blocker" no longer applies in `"run"` mode.** A blocker that isn't `done` must be `awaiting-merge` and in the Stack below the top. An Issue can wait on any number of such blockers.
- **The Run never guesses a base.** When it finds two or more tops, for example from blocker-only stacking or from before `"run"` was turned on, it picks nothing, names the tops, and stops. When the Run picks a `ready-for-agent` Issue whose recorded Base Issue is no longer the top, the Issue goes to `ready-for-human` instead of making a second branch on that Base Issue.
- **A closed Pull Request ends its Issue, in every mode.** When a Pull Request is closed without being merged, its Issue goes to `wontfix`, and every Issue above it in the Stack goes to `ready-for-human`, not only the next one. Before this, a closed Pull Request's Issue stayed `awaiting-merge` forever, and in `"run"` mode it would have become the top of the Stack.
- **Changing a Pull Request in the middle of the Stack brings back the breakage this ADR prevents.** The branches above it were cut before the change. 0004's rule still holds: the Run never rebases a Stacked Issue, and never merges into one.
- **`"stack": true` keeps 0004's blocker-only stacking.** `"run"` is the recommended setting.
