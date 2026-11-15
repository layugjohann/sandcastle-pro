# 05: Name the blocker in the Pull Request, and document stacking

Status: done
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/27
Blocked by: 01

Spec: `.scratch/stacked-issues/spec.md` (stories 10, 16)

**What to build:** Make the merge order obvious to the human, and document the repo setup stacking needs.

- [x] A Stacked Issue's Pull Request body starts with a line saying it is stacked on Issue `<id>` and its Pull Request URL, and that the blocker must be merged first. This is added by the host, not left to the body writer, so it costs no tokens and is always present. The plain body used when no body writer is configured gets the same line.
- [x] The "Pull Request opened" comment on the Issue names the blocker it is stacked on.
- [x] `README.md` gets a "Stacking" section: what `"stack": true` does, that it requires `pullRequest`, to merge with merge commits rather than squash, to turn on "Automatically delete head branches" so GitHub retargets the next Pull Request, to merge chains in order, and that the Run never rebases a Stacked Issue. If `README.md` does not exist yet (Issue 17 of `.scratch/sandcastle-pro/` creates it), create it with only this section.
- [x] Tested: the publish call's body for a Stacked Issue contains the blocker line, both with and without a body writer; a non-stacked Issue's body is unchanged.

## Comments

Usage: Implementer 38 input, 7,566 output, 48,031 cache creation, 843,910 cache read; Review Session 6 input, 1,805 output, 20,038 cache creation, 71,168 cache read.

**Review Session: Non-critical Findings**

- The blocker line reads 'this Pull Request targets its Pull Request <url>'. A Pull Request targets a branch, not another Pull Request; wording such as 'targets the branch of Issue 01 (<url>)' would be clearer (src/pull-request-body.ts stackedOnLine).
- When the blocker has no recorded Pull Request URL, stackedOnLine still ends with 'Merge that Pull Request first.', which refers to a Pull Request it never named.
- stackedOnLine (src/pull-request-body.ts) and stackedOnComment (src/run-workflow.ts) separately format the same StackedOnBlocker data with different wording; the blocker-naming logic is duplicated.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-05-2026-11-15T18-40-32-760Z.log`).

Usage: Body writer 2 input, 1,101 output, 19,904 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/27
