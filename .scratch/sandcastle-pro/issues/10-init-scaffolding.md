# 10: init scaffolding

Status: ready-for-agent
Blocked by: 05

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** A non-interactive `npx sandcastle-pro init` that makes a project ready for Runs. It writes:
- the project config (Gate commands passed as a flag; sandbox native for the OS, or Docker if requested)
- a Project Coding Standards skeleton with headings, examples and a `## Must` section explained
- an env example with `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` (commented out)
- git-ignore entries for the env file, logs and worktrees
- the Issue format conventions in the project's docs

It tells the user to run `claude setup-token`, and never overwrites existing files.

- [x] Non-interactive flags cover the sandbox choice and Gate commands
- [x] The sandbox defaults to Seatbelt on macOS and bubblewrap on Linux, and Docker is used when requested
- [x] All the files listed above are written
- [x] Existing files are left untouched, and the output reports them as skipped
- [x] The output tells the user to run `claude setup-token`
- [x] Tested end to end in a temp directory
