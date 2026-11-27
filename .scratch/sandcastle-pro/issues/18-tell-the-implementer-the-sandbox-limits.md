# 18: Tell the Implementer what the sandbox blocks

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** Add a short "Sandbox" section to the Implementer and Review Session prompts (`src/prompt.ts`) saying
where scratch files go, and make `make` work inside the native sandbox on macOS.

`sandboxedClaudeCode` (`src/sandcastle-agent.ts`) already points `TMPDIR`, `CLAUDE_CODE_TMPDIR` and `TMPPREFIX` at the
sandbox's own temp directory. The agent isn't told about any of this. Across the 26 retail-ops-agent Runs:
- Writes to a literal `/tmp/...` path failed with "Operation not permitted" 8 times in 7 sessions. Agents then wrote
  probe scripts into `tests/` (for example `tests/zz_sweep_test.py`), which risks committing them.
- `make` failed on macOS, so the Implementers on retail-ops-agent Issues 18 and 20 ran the Gate commands by hand.
  `/usr/bin/make` is Apple's `xcrun` shim: it can't write its `xcrun_db` cache (it ignores `TMPDIR`), then runs
  `xcodebuild`, which fails to load `DVTSystemPrerequisites.framework` under Seatbelt. The real binary under
  `$(xcode-select -p)/usr/bin` runs fine under a write-restricting Seatbelt profile.

- [ ] `buildImplementerPrompt` and `buildReviewPrompt` receive `config.sandbox` (today they don't:
      `run-workflow.ts` around the Implementer and Review Session calls).
- [ ] When the sandbox is `native` (macOS and Linux alike), both prompts get a "Sandbox" section of at most about
      5 lines saying, positively: put scratch files under `$TMPDIR`; never write to a literal `/tmp` path (the sandbox
      blocks it); never put scratch files inside the repo. No section under any other sandbox.
- [ ] On macOS, the native sandbox puts the host's `$(xcode-select -p)/usr/bin` (resolved on the host) first on
      `PATH`, so `make` and other shimmed tools bypass `xcrun`. Verified with a real `make` call inside a native
      sandbox, since the real Seatbelt profile also limits reads. If that can't be made to work, fall back to a
      prompt line: `make` is unavailable on macOS; for a `make <target>` Gate command, run that target's recipe from
      the Makefile.
- [ ] Tests cover the section appearing in both prompts under `native`, and its absence otherwise.

Out of scope:
- `timeout` (exit 127): a macOS fact (no GNU coreutils), not a sandbox limit, and agents recover at once.
- `buildResumePrompt`: it continues the same session, which already holds the original prompt with the section.

## Comments

**Triage (2026-11-27):** Fixing `make` at the sandbox level replaces the planned "make is unavailable; run the Gate
commands directly" line, which would not work for Gates detected as `make <target>` (`gate-detection.ts`).
