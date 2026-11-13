# 14: Publish each finished Issue as a Pull Request (plain body)

Status: ready-for-agent
Blocked by: 13

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** When `pullRequest` is on, an Issue that passes the Gate is published as a Pull Request, so the human reviews and merges it on GitHub. This Issue uses a deterministic body with no agent call; Issue 15 adds the written body on top of it. Read ADR 0003 first, and use the glossary's **Pull Request** term.

- [x] `sandcastle-pro.config.json` accepts an opt-in `pullRequest` setting, off by default. Unknown keys are still rejected. With it off, the behaviour is exactly as today.
- [x] The host publishes, never the sandbox. After the Gate passes it runs `git push -u origin <branch>`, then `gh pr create` with:
  - base set to the Run's target branch;
  - title `Issue <id>: <title>`;
  - the body passed through a body file;
  - not a draft.
- [x] The body is built deterministically with these sections:
  - **Evidence**: the passing Gate output.
  - **Fixed during review**: Critical Findings with `fixed: true`.
  - **Non-critical Findings**.
  - The Issue's token usage, in a collapsed `<details>` block.

  Empty sections are left out.
- [x] The Pull Request URL is recorded on the Issue file as a `Pull Request:` header line, and in a comment. The Issue goes to `awaiting-merge`.
- [x] If the push or `gh pr create` fails, the error is commented on the Issue and shown in the Run summary. The Issue still goes to `awaiting-merge`, and the Run continues with the next Issue.
- [x] `markMergedIssuesDone` marks an Issue with a `Pull Request:` line `done` when `gh pr view <url> --json state` reports `MERGED`. Issues without that line keep using the local ancestry check. If `gh` fails, a warning is logged and the Issue stays `awaiting-merge`.
- [x] Publishing and PR-state lookup go behind one small seam, so tests never call real `gh` or push. Tested at the `runWorkflow` seam:
  - the happy path opens a Pull Request with the expected body;
  - a failed publish still gives `awaiting-merge` and the Run continues;
  - `pullRequest` off gives today's behaviour;
  - a Pull Request reported `MERGED` makes the Issue `done`.
- [x] Config parsing tests cover the new setting.

## Comments

Usage: Implementer 50 input, 21,807 output, 79,069 cache creation, 1,663,889 cache read; Review Session 6 input, 2,574 output, 37,619 cache creation, 101,147 cache read.

**Review Session: Non-critical Findings**

- src/run-workflow.ts publishPullRequest types its body parameter as `Parameters<typeof buildPullRequestBody>[0]` instead of using the exported `PullRequestBodyInput` type.
- publishPullRequest: if `store.comment` throws after `store.recordPullRequest` succeeded, the catch reports 'Could not publish the Pull Request' although the Pull Request was opened and its URL recorded.
- markMergedIssuesDone silently keeps an Issue whose Pull Request is CLOSED (not merged) in awaiting-merge on every Run, with nothing logged to tell the human.
- pull-request-body.ts truncation note says 'the full output is in the Gate log', but that log is only on the host's disk and the Pull Request body does not link it.
- markMergedIssuesDone queries `gh` for Issues with a `Pull Request:` line even when `pullRequest` is off in the config, so a project without `gh` would log warnings for such Issues.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-14-2026-11-13T15-24-32-173Z.log`).
