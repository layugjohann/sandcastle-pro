# 18: The detected Gate installs dependencies first

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** When `init` detects package scripts as Gate commands, it puts the package manager's install command first. The Gate runs in a fresh worktree with no `node_modules`, and it removes the main checkout's `node_modules/.bin` from PATH, so without an install every package script fails. In a real Run in another project, `npm run typecheck` failed with `sh: tsc: command not found`. The Issue went to `ready-for-human` and got no Pull Request, even though its code passed every check once dependencies were installed.

- [x] With package scripts detected, the Gate starts with an install: `npm ci --no-audit --no-fund` with `package-lock.json` or `npm-shrinkwrap.json`; `pnpm install --frozen-lockfile`; `yarn install --frozen-lockfile` (Yarn 1) or `yarn install --immutable` (Yarn 2+); `bun install --frozen-lockfile`
- [x] Without the manager's own lockfile, the install is a plain install (`npm install --no-audit --no-fund`, `pnpm install`, ...), since a frozen install would fail
- [x] No install step when no package script is a Gate command
- [x] The interactive confirmation offers the install like any other detected command, so it can be dropped
- [x] `--gate` and an existing config are unchanged: they never gain an install step
- [x] README's `init` section says why the install is there

## Comments

Python projects are out of scope here. `uv run` syncs the environment itself, but `poetry run` and plain `pytest` in a fresh worktree have the same gap and may need a follow-up Issue.
