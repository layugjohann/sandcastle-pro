# 08: Sandcastle Agent adapter and the real run command

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The production Agent and the `npx sandcastle-pro run` command. The adapter maps an Agent call onto Sandcastle's `run()` using `claudeCode(model, { effort })`, `maxIterations`, `resumeSession` and the `branch` branch strategy. The sandbox is the native one for the OS (Seatbelt on macOS, bubblewrap on Linux) or Docker if configured. Auth comes from `CLAUDE_CODE_OAUTH_TOKEN` in the git-ignored env file, with `ANTHROPIC_API_KEY` as the alternative. Iteration usage is summed into the Agent result. Keep the adapter thin: it isn't covered by automated tests and is verified by hand.

- [x] `npx sandcastle-pro run` connects the CLI, the config, the Issue Store, the Run Workflow and this adapter
- [x] The adapter passes model, effort, iteration limit, branch and resume session through to Sandcastle
- [x] The sandbox provider follows the configured choice
- [x] The OAuth token is the default auth, with the API key as a fallback, and the error is clear if neither is set
- [x] One real Run on a sample project is verified by hand, with the steps written in the ticket comments

## Comments

**Manual verification steps for one real Run** (not yet run: it spends the Pro usage window)

1. In this repo: `npm run build && npm link`.
2. Make a sample project: `mkdir /tmp/sp-sample && cd /tmp/sp-sample && git init -b main && npm init -y && npm link sandcastle-pro`.
3. Add `sandcastle-pro.config.json`: `{"gate": ["test -f hello.txt"], "model": "claude-haiku-5-5", "effort": "low"}`. Haiku keeps the check cheap. Add `"sandbox": "docker"` to try Docker.
4. Run `claude setup-token`, then put `CLAUDE_CODE_OAUTH_TOKEN=...` in `.sandcastle/.env`, and git-ignore `.sandcastle/`.
5. Add `.scratch/demo/issues/01-hello.md` with `Status: ready-for-agent` and "Create hello.txt containing hello.", then commit everything.
6. Run `npx sandcastle-pro run`.
7. Check:
   - the Run prints the Sandcastle stdout UI, then `Issue 01 is awaiting merge. Branch: issue/01-hello. Gate: passed.`
   - `git log issue/01-hello` has the Implementer's commit adding `hello.txt`
   - the Issue file has `Status: awaiting-merge` and a `Usage:` comment with non-zero token counts for both stages
   - `main` is untouched
8. Auth checks:
   - Move the token aside and set only `ANTHROPIC_API_KEY`: the Run uses the key.
   - Remove both: `run` fails with the `claude setup-token` message before any Issue changes status.
9. Tick the last box above and note anything unexpected here. In particular, check whether the Review Session's fenced `json` block reached `stdout`.


**Real Run, verified 2026-11-13** (seatbelt sandbox, `claude-haiku-5-5` at low effort, OAuth token)

- The Implementer committed `hello.txt` on `issue/01-hello`. The Gate passed, and the Issue is `awaiting-merge` with a Usage comment for both stages. `main` was untouched, and the Run exited 0.
- The Review Session's fenced `json` block reached `stdout` and was parsed: "No Findings to report."
- Usage: Implementer 74 output and 18,396 cache read; Review Session 325 output and 19,239 cache read.
- The auth fallbacks in step 8 were not run by hand. The auth tests cover them.

What the Run turned up:

- **Fixed in this Issue:** Claude Code writes its temp files to `/tmp/claude-<uid>`, and seatbelt blocks that, so every Run failed as soon as the agent started. The adapter now starts `claude` with `CLAUDE_CODE_TMPDIR="$TMPDIR"`, which points it at the sandbox's private temp dir.
- **Host setup:** macOS `/usr/bin/git` is an Xcode shim, and it fails inside seatbelt. It needs a real git, such as Homebrew's, first on `PATH`. Issue 10's `init` docs should say so.
- **Running from inside Claude Code:** the `CLAUDE_CODE_*` variables of the parent session leak into the Run, so run it from a plain terminal.
- **A failed Run strands the Issue:** an Agent error leaves the Issue `in-progress` with an empty branch. This has been added to Issue 09.
- **The Review Session doesn't know the Gate commands:** it reported "No Gate checks are configured". This is Issue 12.
