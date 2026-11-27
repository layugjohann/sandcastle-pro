# 18: Tell the Implementer what the sandbox blocks

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Add a short "Sandbox" section to the Implementer and Review Session prompts (`src/prompt.ts`),
so agents stop trying things the native sandbox blocks.

`sandboxedClaudeCode` (`src/sandcastle-agent.ts`) already points `TMPDIR`, `CLAUDE_CODE_TMPDIR` and `TMPPREFIX` at the
sandbox's own temp directory. The agent isn't told about any of this. Across the 26 retail-ops-agent Runs:
- Writes to a literal `/tmp/...` path failed with "Operation not permitted" 8 times in 7 sessions. Agents then wrote
  probe scripts into `tests/` (for example `tests/zz_sweep_test.py`), which risks committing them.
- `make` fails because of the macOS Xcode shim (`xcrun_db ... Operation not permitted`), so the Implementers on
  retail-ops-agent Issues 18 and 20 ran the Gate commands by hand.
- `timeout` isn't installed (exit 127).

- [ ] The prompts say, positively, where scratch files go: `$TMPDIR`, never a literal `/tmp` path, and never inside
      the repo.
- [ ] The prompts say `make` is unavailable in the sandbox on macOS, and the Gate commands listed in the prompt can be
      run directly.
- [ ] The section is no more than about 5 lines, and it's only added under the native sandbox.
- [ ] A test covers the section appearing in both prompts.
