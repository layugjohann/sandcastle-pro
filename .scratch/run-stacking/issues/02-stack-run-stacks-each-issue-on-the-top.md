# 02: "stack": "run" stacks each Issue on the top of the Stack

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/run-stacking/spec.md` (stories 1–19, 24–29, 31–32), ADR `docs/adr/0005-a-run-stacks-every-issue-on-the-top-of-the-stack.md`

**What to build:** With `"stack": "run"`, every Issue becomes a Stacked Issue on the top of the Stack, the newest work awaiting merge, even when it has no blockers. A `--count 3` Run then produces one Stack, and the Gate checks all the unmerged work together. `"stack": true` keeps today's blocker-only stacking.

- [x] Config accepts `"stack": false | true | "run"`, with `false` as the default. `"run"` with `pullRequest: false` is rejected with a clear error. Any other value is rejected with an error listing the three valid values.
- [x] The top of the Stack is the `awaiting-merge` Issue that no `awaiting-merge`, `in-progress` or `paused` Issue names in its `Stacked on:` line. It is found from the Issue files alone. A `ready-for-human` Issue doesn't count as built on its Base Issue.
- [x] In `"run"` mode, a paused Issue is still resumed first. Otherwise, the picked Issue starts on the top's branch and records `Stacked on:`, or starts from the target branch when nothing is `awaiting-merge`. This works across Runs and across features.
- [x] When there are two or more tops, the Run picks no Issue, logs every top, says to merge or close Pull Requests until one Stack remains, and stops.
- [x] In `"run"` mode, an Issue is ready when every blocker is `done`, or is `awaiting-merge` and in the Stack below the top. There's no limit on the number of such blockers. An `awaiting-merge` blocker outside the Stack makes the Issue wait, and `blocked()` names it. Other blocker statuses wait as today.
- [x] The branch cut, the Review diff, the Pull Request `base`, and the Pull Request body line "merge that Pull Request first" all follow the Base Issue through `baseOf()`. The body shows no position such as "2 of 3".
- [x] `"stack": true` and `"stack": false` behave exactly as today. The existing stacked-issues tests pass.
- [x] Tested at the `runWorkflow` seam:
  - `--count 3` over three Issues that don't block each other forms one Stack: each branch contains the work below it, each Review diff excludes it, and each publish `base` is the Issue below.
  - A new Run starts on an unmerged Issue left from an earlier Run.
  - When everything is merged, the next Issue starts from the target branch.
  - Two tops: nothing is picked, and the log names both.
  - Two `awaiting-merge` blockers in the Stack: the Issue starts. A blocker outside the Stack: the Issue waits.
  - A Gate failure in the middle: the next Run stacks on the Issue below the failed one.
- [x] Tested at the `loadConfig` seam: `"run"` is accepted, `"run"` without `pullRequest` is rejected, and an unknown value is rejected.

## Comments
