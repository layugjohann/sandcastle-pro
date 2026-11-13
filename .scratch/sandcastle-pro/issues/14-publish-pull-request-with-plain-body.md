# 14: Publish each finished Issue as a Pull Request (plain body)

Status: ready-for-agent
Blocked by: 13

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** When `pullRequest` is on, an Issue that passes the Gate is published as a Pull Request, so the human reviews and merges it on GitHub. This Issue uses a deterministic body with no agent call; Issue 15 adds the written body on top of it. Read ADR 0003 first, and use the glossary's **Pull Request** term.

- [ ] `sandcastle-pro.config.json` accepts an opt-in `pullRequest` setting, off by default. Unknown keys are still rejected. With it off, the behaviour is exactly as today.
- [ ] The host publishes, never the sandbox. After the Gate passes it runs `git push -u origin <branch>`, then `gh pr create` with:
  - base set to the Run's target branch;
  - title `Issue <id>: <title>`;
  - the body passed through a body file;
  - not a draft.
- [ ] The body is built deterministically with these sections:
  - **Evidence**: the passing Gate output.
  - **Fixed during review**: Critical Findings with `fixed: true`.
  - **Non-critical Findings**.
  - The Issue's token usage, in a collapsed `<details>` block.

  Empty sections are left out.
- [ ] The Pull Request URL is recorded on the Issue file as a `Pull Request:` header line, and in a comment. The Issue goes to `awaiting-merge`.
- [ ] If the push or `gh pr create` fails, the error is commented on the Issue and shown in the Run summary. The Issue still goes to `awaiting-merge`, and the Run continues with the next Issue.
- [ ] `markMergedIssuesDone` marks an Issue with a `Pull Request:` line `done` when `gh pr view <url> --json state` reports `MERGED`. Issues without that line keep using the local ancestry check. If `gh` fails, a warning is logged and the Issue stays `awaiting-merge`.
- [ ] Publishing and PR-state lookup go behind one small seam, so tests never call real `gh` or push. Tested at the `runWorkflow` seam:
  - the happy path opens a Pull Request with the expected body;
  - a failed publish still gives `awaiting-merge` and the Run continues;
  - `pullRequest` off gives today's behaviour;
  - a Pull Request reported `MERGED` makes the Issue `done`.
- [ ] Config parsing tests cover the new setting.
