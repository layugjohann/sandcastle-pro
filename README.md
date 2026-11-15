## Stacking

With `"stack": true` in `sandcastle-pro.config.json`, a Run does not stop at an Issue whose only unmerged blocker is `awaiting-merge`. It starts that Issue as a Stacked Issue: its branch is cut from the tip of the blocker's branch, its Review Session sees only its own work, and its Pull Request targets the blocker's branch. One Run can then work through a whole chain of dependent Issues. An Issue with two or more unmerged blockers still waits. Stacking is off by default.

The Pull Request body of a Stacked Issue starts with a line naming the Issue and Pull Request it is stacked on, and the "Pull Request opened" comment on the Issue names it too.

Set up the repository before turning it on:

- **It requires `pullRequest`.** `"stack": true` with `"pullRequest": false` is a config error.
- **Merge with merge commits, not squash.** A squash merge rewrites the blocker's commits, so the next Pull Request in the chain would show them again and conflict.
- **Turn on "Automatically delete head branches"** (Settings → General → Pull Requests). When the blocker's branch is deleted on merge, GitHub retargets the next Pull Request to the target branch. An Issue is `done` only once its Pull Request is merged into the target branch.
- **Merge a chain in order**, blocker first. A Stacked Issue merged into its blocker's branch instead stays `awaiting-merge`, and the Run warns about it.

The Run never rebases a Stacked Issue or merges its blocker into it. If the blocker changes after the Issue was stacked on it, bringing the Stacked Issue up to date is up to you.
