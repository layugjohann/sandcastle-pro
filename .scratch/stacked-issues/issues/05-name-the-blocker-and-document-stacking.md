# 05: Name the blocker in the Pull Request, and document stacking

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 10, 16)

**What to build:** Make the merge order obvious to the human, and document the repo setup stacking needs.

- [x] A Stacked Issue's Pull Request body starts with a line saying it is stacked on Issue `<id>` and its Pull Request URL, and that the blocker must be merged first. This is added by the host, not left to the body writer, so it costs no tokens and is always present. The plain body used when no body writer is configured gets the same line.
- [x] The "Pull Request opened" comment on the Issue names the blocker it is stacked on.
- [x] `README.md` gets a "Stacking" section: what `"stack": true` does, that it requires `pullRequest`, to merge with merge commits rather than squash, to turn on "Automatically delete head branches" so GitHub retargets the next Pull Request, to merge chains in order, and that the Run never rebases a Stacked Issue. If `README.md` does not exist yet (Issue 17 of `.scratch/sandcastle-pro/` creates it), create it with only this section.
- [x] Tested: the publish call's body for a Stacked Issue contains the blocker line, both with and without a body writer; a non-stacked Issue's body is unchanged.

## Comments
