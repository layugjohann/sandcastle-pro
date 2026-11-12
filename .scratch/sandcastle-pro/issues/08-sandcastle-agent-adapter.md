# 08: Sandcastle Agent adapter and the real run command

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The production Agent and the `npx sandcastle-pro run` command. The adapter maps an Agent call onto Sandcastle's `run()` using `claudeCode(model, { effort })`, `maxIterations`, `resumeSession` and the `branch` branch strategy. The sandbox is the native one for the OS (Seatbelt on macOS, bubblewrap on Linux) or Docker if configured. Auth comes from `CLAUDE_CODE_OAUTH_TOKEN` in the git-ignored env file, with `ANTHROPIC_API_KEY` as the alternative. Iteration usage is summed into the Agent result. Keep the adapter thin: it isn't covered by automated tests and is verified by hand.

- [ ] `npx sandcastle-pro run` connects the CLI, the config, the Issue Store, the Run Workflow and this adapter
- [ ] The adapter passes model, effort, iteration limit, branch and resume session through to Sandcastle
- [ ] The sandbox provider follows the configured choice
- [ ] The OAuth token is the default auth, with the API key as a fallback, and the error is clear if neither is set
- [ ] One real Run on a sample project is verified by hand, with the steps written in the ticket comments
