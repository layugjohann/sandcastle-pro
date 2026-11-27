# 18: Tell the Implementer what the sandbox blocks

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/36
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

- [x] `buildImplementerPrompt` and `buildReviewPrompt` receive `config.sandbox` (today they don't:
      `run-workflow.ts` around the Implementer and Review Session calls).
- [x] When the sandbox is `native` (macOS and Linux alike), both prompts get a "Sandbox" section of at most about
      5 lines saying, positively: put scratch files under `$TMPDIR`; never write to a literal `/tmp` path (the sandbox
      blocks it); never put scratch files inside the repo. No section under any other sandbox.
- [x] On macOS, the native sandbox puts the host's `$(xcode-select -p)/usr/bin` (resolved on the host) first on
      `PATH`, so `make` and other shimmed tools bypass `xcrun`. Verified with a real `make` call inside a native
      sandbox, since the real Seatbelt profile also limits reads. If that can't be made to work, fall back to a
      prompt line: `make` is unavailable on macOS; for a `make <target>` Gate command, run that target's recipe from
      the Makefile.
- [x] Tests cover the section appearing in both prompts under `native`, and its absence otherwise.

Out of scope:
- `timeout` (exit 127): a macOS fact (no GNU coreutils), not a sandbox limit, and agents recover at once.
- `buildResumePrompt`: it continues the same session, which already holds the original prompt with the section.

## Comments

**Triage (2026-11-27):** Fixing `make` at the sandbox level replaces the planned "make is unavailable; run the Gate
commands directly" line, which would not work for Gates detected as `make <target>` (`gate-detection.ts`).

**Implementer (2026-11-27):** The developer `usr/bin` goes on `PATH` just before `/usr/bin`, not first. That dir also
holds Xcode's `python3` (3.9), `pip3` and `git`, and putting it first would hide the host's own (Homebrew, python.org)
ones. Just before `/usr/bin` still puts it ahead of every `xcrun` shim, which is the point. Checked inside a real
Seatbelt sandbox: `/usr/bin/make` fails on `DVTSystemPrerequisites`. With the new `PATH` line, `make` resolves to
`/Applications/Xcode.app/Contents/Developer/usr/bin/make` and runs a Makefile target, and `python3` and `git` still
resolve to the host's earlier dirs.

Usage: Implementer 58 input, 14,083 output, 76,056 cache creation, 1,306,855 cache read; Review Session 8 input, 2,578 output, 24,920 cache creation, 114,916 cache read.

**Review Session: Non-critical Findings**

- The Issue says the host's $(xcode-select -p)/usr/bin goes first on PATH; the implementation puts it just before /usr/bin instead. The reason is sound (that dir also holds Xcode's python3/pip3/git, which would hide the host's Homebrew or python.org ones) and it still bypasses every xcrun shim. It is explained in the Issue comments, but the Issue text should be updated or the deviation accepted explicitly.
- The new Run Workflow test loops over 'native' and 'docker' in one test and rewrites the Issue to 'done' between runs. Two separate tests would read more clearly and fail on their own.
- The new test checks prompt text (the '## Sandbox' heading and '$TMPDIR'). The Issue asks for this check, but the Spec's Testing Decisions say tests never assert on prompt wording.
- developerBin() runs `xcode-select -p` on every Agent call. It could be looked up once in createSandcastleAgent.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-18-2026-11-27T10-39-19-507Z.log`).

Usage: Body writer 2 input, 1,226 output, 24,932 cache creation, 11,837 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/36
