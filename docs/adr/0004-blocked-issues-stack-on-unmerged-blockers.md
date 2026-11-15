# Blocked Issues stack on unmerged blockers

Amends 0002 and 0003. Under 0002 an Issue starts only when every blocker is `done`, meaning merged. So a `--count N` Run stalls at the first blocked Issue until the human merges its blocker, and the loop can't run AFK. When `stack` is on in config, an Issue whose only unmerged blocker is `awaiting-merge` becomes a Stacked Issue. Its branch is cut from the blocker's branch, its Review Session diff is taken against that branch, and its Pull Request targets that branch. GitHub retargets it to the target branch once the blocker merges, provided the repo deletes head branches on merge. We rejected marking Issues `done` before they merge, because `done` gates `Blocked by:` and must keep meaning "on the target branch". We also rejected an extra agent stage to set statuses, because the host already sets them without spending tokens.

## Consequences

- `stack` requires `pullRequest`, merge commits rather than squash merges, and ideally `delete_branch_on_merge`. A squash merge leaves the blocker's original commits on the stacked branch.
- An Issue with two or more unmerged blockers still waits. Chains have no depth cap, so `--count` is the only limit on the review queue.
- An Issue is `done` only when its Pull Request was merged into the target branch. A Stacked Issue merged into its blocker's branch stays `awaiting-merge`, and the Run logs a warning.
- The Run never rebases a Stacked Issue when its blocker changes. If a blocker's Pull Request is closed without merging, its Stacked Issues go to `ready-for-human`.
