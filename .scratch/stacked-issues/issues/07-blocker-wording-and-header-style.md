# 07: Clearer blocker wording, and one rule for the bold style

Status: ready-for-agent
Blocked by: None

Spec: `.scratch/stacked-issues/spec.md` (stories 10, 13). Review Findings from Issues 05 and 06, plus a docs mismatch found while resolving PR #23 (Issue 01).

**What to build:** A small wording and consistency pass. Every stacked Pull Request carries the line that names its blocker, so it has to read correctly. And the docs have to match how the Run writes the `Stacked on:` line.

- [ ] A single formatter builds the blocker text from `StackedOnBlocker`, used by both `stackedOnLine` (`src/pull-request-body.ts`) and `stackedOnComment` (`src/run-workflow.ts`). The two places no longer word the same facts differently.
- [ ] With a Pull Request URL, the line says the Pull Request targets the blocker's branch, not "its Pull Request". For example: "Stacked on Issue 01: this Pull Request targets `issue/01-first`, the branch of <url>. Merge that Pull Request first."
- [ ] Without a URL, the line names the branch and says to merge it first, for example "Merge `issue/01-first` into `main` first.". It never mentions a Pull Request it didn't name.
- [ ] `docs/agents/sandcastle-pro-issues.md` line 28 ("a line it adds is plain") matches the code. The Run writes an added `Stacked on:` line in bold when the Issue's `Status:` or `Blocked by:` line is bold, and its tests expect that. Keep that behaviour and change the doc to say an added line follows the style of the header around it. Check that the other lines a Run adds (`Pull Request:`, `Paused session:`, `Paused stage:`) do the same; if one doesn't, make it, or say in the doc which ones are always plain.
- [ ] Tested: the body and the comment for a Stacked Issue, with and without a blocker URL, contain the new wording; a non-stacked Issue's body is unchanged.
- [ ] When `git checkout HEAD -- <file>` fails on a blocker's Issue file in `pullMergedIssueFiles` (`src/run-workflow.ts`), the warning names that blocker's file, not the Stacked Issue's own file. (Review Finding from Issue 06.)
- [ ] A test at the `runWorkflow` seam covers this case: a blocker's Pull Request is `CLOSED`, and reading the Stacked Issue's own Pull Request state fails. The Stacked Issue goes to `ready-for-human` with the closed-blocker comment, and a warning names the read failure. (Review Finding from Issue 06.)
- [ ] A test covers the warning above: a blocker file whose discard fails is the file the warning names.

## Comments
