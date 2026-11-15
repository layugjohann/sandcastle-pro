# 07: Clearer blocker wording, and one rule for the bold style

Status: in-progress
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 10, 13). Review Findings from Issues 05 and 06, plus a docs mismatch found while resolving PR #23 (Issue 01).

**What to build:** A small wording and consistency pass. Every stacked Pull Request carries the line that names its blocker, so it has to read correctly. And the docs have to match how the Run writes the `Stacked on:` line.

- [x] A single formatter builds the blocker text from `StackedOnBlocker`, used by both `stackedOnLine` (`src/pull-request-body.ts`) and `stackedOnComment` (`src/run-workflow.ts`). The two places no longer word the same facts differently.
- [x] With a Pull Request URL, the line says the Pull Request targets the blocker's branch, not "its Pull Request". For example: "Stacked on Issue 01: this Pull Request targets `issue/01-first`, the branch of <url>. Merge that Pull Request first."
- [x] Without a URL, the line names the branch and says to merge it first, for example "Merge `issue/01-first` into `main` first.". It never mentions a Pull Request it didn't name.
- [x] `docs/agents/sandcastle-pro-issues.md` line 28 ("a line it adds is plain") matches the code. The Run writes an added `Stacked on:` line in bold when the Issue's `Status:` or `Blocked by:` line is bold, and its tests expect that. Keep that behaviour and change the doc to say an added line follows the style of the header around it. Check that the other lines a Run adds (`Pull Request:`, `Paused session:`, `Paused stage:`) do the same; if one doesn't, make it, or say in the doc which ones are always plain.
- [x] Tested: the body and the comment for a Stacked Issue, with and without a blocker URL, contain the new wording; a non-stacked Issue's body is unchanged.
- [x] When `git checkout HEAD -- <file>` fails on a blocker's Issue file in `pullMergedIssueFiles` (`src/run-workflow.ts`), the warning names that blocker's file, not the Stacked Issue's own file. (Review Finding from Issue 06.)
- [x] A test at the `runWorkflow` seam covers this case: a blocker's Pull Request is `CLOSED`, and reading the Stacked Issue's own Pull Request state fails. The Stacked Issue goes to `ready-for-human` with the closed-blocker comment, and a warning names the read failure. (Review Finding from Issue 06.)
- [x] A test covers the warning above: a blocker file whose discard fails is the file the warning names.

## Comments

Usage: Implementer 54 input, 14,817 output, 78,683 cache creation, 1,256,195 cache read; Review Session 10 input, 2,367 output, 25,201 cache creation, 150,739 cache read.

**Review Session: Non-critical Findings**

- When the blocker is not a known Issue (id undefined), stackedOnText names the branch three times: "Stacked on `issue/x`: this Pull Request targets `issue/x`. Merge `issue/x` into `main` first." It is correct but repetitive; the lead could be shortened in that case.
- test/stacked-issues.test.ts: the new no-URL test writes out the expected blocker sentence twice, once as `line` for the comment check and again inline for the body check. The body check could reuse `line` (as "> **Stacked on Issue 01**:" plus the rest).

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-07-2026-11-15T19-09-38-813Z.log`).

Usage: Body writer 2 input, 1,343 output, 23,959 cache creation, 11,370 cache read.
