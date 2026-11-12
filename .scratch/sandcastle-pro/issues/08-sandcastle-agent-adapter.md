# 08: Sandcastle Agent adapter and the real run command

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The production Agent and the `npx sandcastle-pro run` command. The adapter maps an Agent call onto Sandcastle's `run()` using `claudeCode(model, { effort })`, `maxIterations`, `resumeSession` and the `branch` branch strategy. The sandbox is the native one for the OS (Seatbelt on macOS, bubblewrap on Linux) or Docker if configured. Auth comes from `CLAUDE_CODE_OAUTH_TOKEN` in the git-ignored env file, with `ANTHROPIC_API_KEY` as the alternative. Iteration usage is summed into the Agent result. Keep the adapter thin: it isn't covered by automated tests and is verified by hand.

- [x] `npx sandcastle-pro run` connects the CLI, the config, the Issue Store, the Run Workflow and this adapter
- [x] The adapter passes model, effort, iteration limit, branch and resume session through to Sandcastle
- [x] The sandbox provider follows the configured choice
- [x] The OAuth token is the default auth, with the API key as a fallback, and the error is clear if neither is set
- [ ] One real Run on a sample project is verified by hand, with the steps written in the ticket comments

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

