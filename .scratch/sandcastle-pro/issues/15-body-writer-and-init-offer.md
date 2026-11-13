# 15: Body writer for the Pull Request, and the init offer

Status: ready-for-agent
Blocked by: 14

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** An agent writes the Pull Request's Summary and Merge Danger, so the human can judge the change from GitHub alone. Issue 14's deterministic body becomes the fallback. `init` also offers to turn Pull Requests on.

- [x] **The body writer:** a new Agent stage called once through the existing Agent interface, with `maxIterations: 1`, before the host publishes.
  - Its prompt includes the diff, the commits, the Issue, the Spec, the Findings, and the Gate output.
  - It also embeds the `pr` body template: Summary (a diagram, diff sketch or tree), Evidence, Merge Danger (Door, Blast Radius). Keep the credit to Dex Horthy / Humanlayer as a source comment.
  - It returns the body as structured output. It never commits and never changes the branch.
- [x] The host combines the written body with Issue 14's host-added sections:
  - Fixed during review;
  - Non-critical Findings;
  - Usage, which now includes the body writer's usage.
- [x] Config: when `pullRequest` is on, the body writer's model defaults to `claude-sonnet-5-5` and its effort to `low`. Both can be overridden in config.
- [x] If the body writer hits the usage limit or throws, the Pull Request is still opened with Issue 14's deterministic body, plus a note saying why the body was not written. The Issue is not paused. If the cause was the usage limit, the Run stops after this Issue.
- [x] `init` offers to turn on `pullRequest` only when the repo has a GitHub remote and `gh auth status` succeeds. Otherwise it leaves the setting off and says nothing about it.
- [x] Tested with a fake Agent:
  - the written body is used and the host sections are appended;
  - a usage limit in the body writer gives the fallback body, `awaiting-merge`, and the Run stops;
  - the body writer runs with the configured model.
- [x] `init` tests cover offering the setting and not offering it.

## Comments

Usage: Implementer 126 input, 47,658 output, 135,695 cache creation, 6,619,146 cache read; Review Session 12 input, 4,408 output, 47,856 cache creation, 287,604 cache read.

**Review Session: Non-critical Findings**

- writeBody runs `git rev-parse` and restoreBranch outside the try block. A git failure there, after the Gate passed, ends the Run with the Issue still in-progress and no Pull Request opened.
- The diff goes into the body writer's prompt with no size limit, so a large change costs a lot of tokens for a low-effort summary.
- truncateStart is exported from pull-request-body with MAX_EVIDENCE_CHARS as its default, so the prompt depends on a Pull Request body limit. MAX_WRITTEN_CHARS repeats the same 50,000.
- writeBody returns both `result` and `note`; the note could be built from result.reason instead of being carried separately.
- init treats 'has a GitHub remote' as 'origin is on GitHub'. That matches what git push uses, but a repo with only a non-origin GitHub remote is not offered Pull Requests.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-15-2026-11-13T16-00-16-720Z.log`).
