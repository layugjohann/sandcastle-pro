# Spec: Run Stacking

Status: ready-for-agent

Decision record: `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`. Amends `.scratch/stacked-issues/spec.md` and ADR 0004.

## Problem Statement

My loop in fixline is: merge the last Run's Pull Requests, run `npx sandcastle-pro run --count 3`, then review and merge the 3 new Pull Requests. In every round, Pull Requests 2 and 3 conflict with `main` once I merge the first one. Each Issue is cut from the target branch as it is at that moment. The Issues the Run finished earlier are only `awaiting-merge`, so all three branches share one merge-base, and none of them sees the others' work. `stack` doesn't help, because these Issues don't block each other. They were unblocked together when I marked a batch `done`, and they come from the same area of the Spec, so they edit the same files. The Gate checks each branch on its own and passes every time, so the breakage only shows when I merge.

There are three kinds of breakage:
- **Textual conflicts** in files that every Issue touches.
- **Edits lost to file moves**, which I port by hand.
- **Semantic breaks with no git conflict**, such as a new required schema field that a sibling's hand-built test fixtures don't have. These take the most fixing.

Every round, I rebase the second and third Pull Requests by hand.

## Solution

With `"stack": "run"` in config, every Issue becomes a Stacked Issue on the top of the Stack: the newest Issue awaiting merge that nothing is stacked on yet. The Issue starts from the target branch only when nothing is awaiting merge. The Gate then runs on all the unmerged work at once, so semantic breaks are caught in the sandbox. I merge the Stack from the bottom up, and GitHub retargets each Pull Request to the target branch without a conflict.

When a Pull Request is closed without merging, its Issue goes to `wontfix`, and every Issue above it in the Stack goes to `ready-for-human`. The Run never guesses a base. When it can't find exactly one top, or an Issue's recorded Base Issue is no longer the top, the Run stops or hands that Issue to me.

`"stack": true` keeps today's blocker-only stacking. `"stack": false` keeps stacking off.

## User Stories

### Turning it on

1. As a developer, I want `"stack": "run"` in config to make every Issue a Stacked Issue on the top of the Stack, so that each Issue in a Run builds on the work before it.
2. As a developer, I want `"stack": true` to keep stacking only on an unmerged blocker, exactly as today, so that existing projects don't change behaviour.
3. As a developer, I want `"stack": false`, or no `stack` key, to keep stacking off, so that projects without GitHub behave as before.
4. As a developer, I want `"stack": "run"` with `"pullRequest": false` rejected with a clear config error, so that I'm never asked to merge local branches in order by hand.
5. As a developer, I want any other `stack` value rejected with an error listing `false`, `true` and `"run"`, so that a typo doesn't silently turn stacking off.

### Picking the base

6. As a developer, I want the top of the Stack to be the `awaiting-merge` Issue that no `awaiting-merge`, `in-progress` or `paused` Issue is stacked on, so that "newest" doesn't depend on timestamps or Issue numbers.
7. As a developer, I want an Issue to start from the target branch when no Issue is `awaiting-merge`, so that the first Issue after I merge everything starts from a clean base.
8. As a developer, I want each Issue after the first in a `--count 3` Run to be stacked on the one the Run just finished, so that the three Pull Requests form one Stack.
9. As a developer, I want the first Issue of a new Run to stack on the top of the Stack left by an earlier Run that I haven't fully merged, so that a new Run never conflicts with unmerged work.
10. As a developer, I want Issues from different features to share the one Stack, so that work on shared files, such as the coordinator, is always checked together.
11. As a developer, I want a `ready-for-human` Issue not to count as something stacked on its Base Issue, so that work that failed the Gate is never built on, and the next Issue stacks on the last Issue that passed.
12. As a developer, I want a `paused` Issue to count as stacked on its Base Issue, so that no other Issue starts on the same Base Issue while it waits to resume.
13. As a developer, I want the Run to pick nothing, log every top it found, and stop when there are two or more tops, so that it never guesses which branch to build on.
14. As a developer, I want that log to tell me to merge or close Pull Requests until one Stack remains, so that I know how to get the Run going again.
15. As a developer, I want the "two or more tops" stop to happen before any Issue starts, so that no Issue is left half-started.

### Blockers in the Stack

16. As a developer, I want an Issue to be ready in `"run"` mode when every blocker is `done`, or is `awaiting-merge` and in the Stack below the top, so that its blockers' work is always in its base.
17. As a developer, I want an Issue with two or more such `awaiting-merge` blockers to start, so that blockers no longer cap how far one Run gets.
18. As a developer, I want an Issue whose `awaiting-merge` blocker is not in the Stack below the top to wait, with the Run logging that blocker, so that an Issue never starts without its blocker's work.
19. As a developer, I want an Issue whose blocker is `in-progress`, `paused`, `ready-for-human`, `needs-info` or `ready-for-agent` to keep waiting as today, so that only work that passed the Gate is built on.

### A Base Issue that is no longer the top

20. As a developer, I want a `ready-for-agent` Issue whose `Stacked on:` line names a Base Issue that is no longer the top to go to `ready-for-human` instead of starting, so that the Run never makes a second branch on one Base Issue.
21. As a developer, I want that Issue's comment to name its recorded Base Issue and the current top, and to tell me to either rebase onto the top and update `Stacked on:`, or delete the branch and remove the line so it restarts on the top, so that I know both ways to fix it.
22. As a developer, I want a `ready-for-agent` Issue whose recorded Base Issue is still the top to start on it as recorded, so that an Issue I sent back without changes carries on.
23. As a developer, I want a paused Stacked Issue to resume on its recorded Base Issue, as today, so that a usage limit never changes what it builds on.

### Implementing, reviewing and publishing

24. As a developer, I want a Stacked Issue's branch cut from the tip of its Base Issue's branch, so that the Implementer sees every unmerged Issue's work.
25. As a developer, I want the Review Session's commit list and diff measured from the Base Issue's branch, so that work below it isn't reviewed again.
26. As a developer, I want the Gate to run on the Stacked Issue's branch as it is, so that semantic breaks between Issues fail in the sandbox, not after I merge.
27. As a developer, I want a Stacked Issue's Pull Request to target its Base Issue's branch, so that its diff shows only its own work.
28. As a developer, I want the Pull Request body and the Issue's comments to name the Base Issue and its Pull Request, and to say "merge that Pull Request first", so that I merge from the bottom up.
29. As a developer, I want the Pull Request body to give no "2 of 3" position, so that it never goes stale as the Stack changes.
30. As a developer, I want comments, logs and the Pull Request body to say "Base Issue", not "blocker", when the Issue underneath isn't one of its blockers, so that the wording is never wrong.

### Merging

31. As a developer, I want a Stacked Issue marked `done` only when its Pull Request was merged into the target branch, as today, so that `done` still means "on the target branch".
32. As a developer, I want a Stacked Issue whose Pull Request was merged into its Base Issue's branch to stay `awaiting-merge` with a warning, as today, so that a wrong-order merge is visible.

### Closed Pull Requests

33. As a developer, I want an Issue whose Pull Request was closed without merging to go to `wontfix` with a comment saying so, in every `stack` mode, so that it stops showing up as `awaiting-merge` forever.
34. As a developer, I want a closed Pull Request's Issue never to become the top of the Stack, so that no Issue is built on work I rejected.
35. As a developer, I want every Issue above a closed Pull Request's Issue in the Stack to go to `ready-for-human`, not only the next one, so that nothing is left `awaiting-merge` on a base that will never land.
36. As a developer, I want each of those comments to name the closed Issue and its Pull Request, even when it is several Issues down the Stack, so that I know which closure stranded the work.
37. As a developer, I want an Issue above the closed one whose own Pull Request already reached the target branch to be marked `done`, not `ready-for-human`, as today, so that merged work is never sent back.
38. As a developer, I want Issues above the closed one that are already `done`, `ready-for-human` or `wontfix` to keep their status, as today, so that the cascade never overrides a decision already made.

### Documentation

39. As a developer, I want the README to explain `"stack": "run"` and recommend it over `"stack": true`, so that I pick the right mode.
40. As a developer, I want the README to say to merge the Stack from the bottom up, so that GitHub retargets each Pull Request cleanly.
41. As a developer, I want the README to say to change only the top Pull Request, and to put a fix to any other one in a follow-up Issue, so that I don't bring back the breakage stacking prevents.
42. As a developer, I want the README to say that `"run"` needs merge commits, not squash merges, and "Automatically delete head branches" turned on, so that I set up the repo correctly.

## Implementation Decisions

- **Config.** `stack` becomes `false | true | "run"`, with `false` as the default. `true` and `"run"` both need `pullRequest: true`. The error for an invalid value lists all three.
- **Finding the top.** The Issue Store finds the top of the Stack from Issue files alone. It looks for `awaiting-merge` Issues that no `awaiting-merge`, `in-progress` or `paused` Issue names in its `Stacked on:` line. There are three outcomes: no top (the base is the target branch), one top (its branch), or two or more tops (no Issue is picked).
- **Picking.** In `"run"` mode, `next()` still resumes a paused Issue first. Otherwise, it returns the first `ready-for-agent` Issue whose blockers are all `done`, or are `awaiting-merge` and in the Stack below the top, with the top's branch as its `stackOn`. "In the Stack below the top" means reachable by following `Stacked on:` lines down from the top. `"run"` mode drops the blocker-only rule that an Issue can have at most one unmerged blocker. `true` mode keeps its current `readiness` rules unchanged.
- **Explaining a wait.** `blocked()` covers the new reasons: two or more tops (naming them), and an `awaiting-merge` blocker that isn't in the Stack.
- **A recorded Base Issue that moved.** Before starting a `ready-for-agent` Issue that already has a `Stacked on:` line, the Run compares that line to the current top. If the two differ, the Issue goes to `ready-for-human` with a comment, and the Run carries on with the next Issue. This follows the existing "Stacked on a missing branch" handling. Paused Issues skip this check.
- **Base threading is unchanged.** `baseOf()` already drives the branch cut, the Review diff, the Pull Request base, and branch clean-up after a failure. Those parts need no change, because `stackOn` now simply comes from the top.
- **Closed Pull Requests.** Merge detection moves an Issue whose Pull Request is `CLOSED` to `wontfix`, with a comment, in every mode. Its Stacked Issues are found by following `Stacked on:` upward through every level, not one. The existing exceptions still apply: Issues in the `onTarget` set, and Issues that are `done`, `ready-for-human` or `wontfix`, keep their status. All states are still read before anything is moved.
- **Wording.** User-facing text and types that say "blocker" for what an Issue is stacked on say "Base Issue" instead, for example the "Blocker closed" comment and the stacked-on text in the Pull Request body. Text about real `Blocked by:` relationships keeps "blocker".
- **No rebasing or forward merging.** The Run never rebases a Stacked Issue or merges into one (ADR 0004 and ADR 0005).

## Testing Decisions

- Test external behaviour only: the statuses, comments and logs the human sees, which branch each Issue was cut from, and the `base` passed to the publisher. Don't test how the top is computed internally.
- **The `runWorkflow` seam**, in the stacked-issues test file: the fake agent, the fake publisher, and a local bare repository as `origin`. That is the prior art from the `stacked-issues` Spec. Cases:
  - `--count 3` over three Issues that don't block each other: Issue 02's branch contains 01's commits and 03's contains 02's, each publish call's `base` is the Issue below it, and each Review diff excludes the work below it.
  - A new Run with an unmerged Issue left from an earlier Run starts on that Issue's branch.
  - Everything merged: the next Issue starts from the target branch.
  - Two tops: nothing is picked, and the log names both.
  - An Issue with two `awaiting-merge` blockers, both in the Stack, starts. One with an `awaiting-merge` blocker that isn't in the Stack waits, and the log names that blocker.
  - A Gate failure in the middle: the failed Issue goes to `ready-for-human`, and the next Run stacks on the Issue below it.
  - A `ready-for-agent` Issue whose recorded Base Issue is no longer the top goes to `ready-for-human` with the comment. One whose Base Issue is still the top starts.
  - A closed Pull Request in the middle of a three-Issue Stack: that Issue goes to `wontfix`, both Issues above it go to `ready-for-human` with comments naming it, and an Issue above it whose Pull Request reached the target branch goes to `done`.
  - A closed Pull Request with `"stack": false` still moves its Issue to `wontfix`.
  - `"stack": true` keeps today's behaviour. The existing stacked-issues tests pass unchanged, apart from any wording changes.
- **The `loadConfig` seam**, in the config test file: `"run"` is accepted, `"run"` with `pullRequest: false` is rejected, and an unknown value is rejected with the list of valid values.
- There's no separate Issue Store test for the top of the Stack. Everything it does is visible through `runWorkflow`.

## Out of Scope

- Merging a changed Base Issue's branch into the Issues above it. ADR 0005 defers this.
- Rebasing, force-pushing, or a `restack` command.
- Stacking only when files overlap.
- Squash-merge support.
- Merging anything: the merge button stays with the human (ADR 0002).
- A separate Stack for each feature.
- Removing `"stack": true`.

## Further Notes

- fixline currently has `delete_branch_on_merge` off and no `stack` key. Before using this there, turn on "Automatically delete head branches" and add `"stack": "run"` to `sandcastle-pro.config.json`. fixline already uses merge commits.
- Issues: `.scratch/run-stacking/issues/`. Suggested split: (1) closed Pull Request makes its Issue `wontfix`, with the cascade up the whole Stack; (2) `"stack": "run"` with picking the top; (3) a recorded Base Issue that is no longer the top; (4) wording and README. Blocked: 2←1, 3←2, 4←2.
