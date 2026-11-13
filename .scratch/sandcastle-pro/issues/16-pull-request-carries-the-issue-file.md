# 16: The Pull Request carries the Issue file, and the Run catches up after a merge

Status: awaiting-merge
Pull Request: https://github.com/layugjohann/sandcastle-pro/pull/19
Blocked by: 14

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** A Run writes its comments and status into the Issue file in the target branch's working copy. The Issue branch edits the same file too, because the Implementer ticks the acceptance boxes. So today:

- the Pull Request has no Run comments: no usage, no Findings, no Gate result;
- after the human merges, `git pull` refuses, because a local edit to the Issue file would be overwritten. Git refuses even when the local edit is identical to the merged one.

The fix has two parts:

- The host commits the Issue file onto the Issue branch, so the Pull Request shows the comments.
- When the next Run finds the Pull Request merged, it drops the now-redundant local edit and fast-forwards the target branch.

The working copy keeps the status, so `next()` still sees the Issue as `awaiting-merge` until then. Everything here only applies when `pullRequest` is on; with it off, behaviour is exactly as today.

- [x] Before pushing, the host merges the Issue file onto the Issue branch and commits it as `Record Issue <id>'s Run comments`, so the Pull Request includes the comments up to "Gate passed". The merged file is the branch's copy, which keeps the Implementer's ticked boxes and any comments of its own, plus the working copy's header lines (`Status:`, `Pull Request:`) and the comments the Run added since the target branch's committed version. The host writes the same merged file back to the working copy, so the two match. It never overwrites the branch's copy with the working copy's.
- [x] After the `Pull Request:` line and the "Pull Request opened" comment are written, the host commits the Issue file onto the branch again and pushes. The working copy's Issue file then matches the branch tip exactly.
- [x] Issues that are not published (Gate failed, unfixed Critical Findings, Spec disagreement, paused) are unchanged: nothing is committed or pushed for them.
- [x] At the start of a Run, for each Issue whose Pull Request is `MERGED`, the host:
  1. checks that the target branch is checked out and that the working copy's Issue file matches the file at the tip of the Issue branch;
  2. discards the local edit to that file and runs `git pull --ff-only origin <target>`;
  3. marks the Issue `done`.
  If either check fails, or the pull fails, the host puts the file back as it was, logs a warning naming the file and the reason, and leaves the Issue `awaiting-merge`. Other uncommitted changes in the working copy are never touched.
- [x] When the comment after a successful `gh pr create` fails, the error says the Pull Request was opened and gives its URL. It never says "Could not publish the Pull Request" when it was published. (Review Finding from Issue 14.)
- [x] When an Issue's Pull Request is `CLOSED` without being merged, the Run logs a warning naming the Issue and its URL, instead of keeping it `awaiting-merge` silently. (Review Finding from Issue 14.)
- [x] Tested at the `runWorkflow` seam with the fake publisher and a local bare repository as `origin`:
  - a published Issue's branch contains the Issue file with its Run comments and `Pull Request:` line;
  - after a merge on `origin`, the next Run pulls the target branch and marks the Issue `done`, without an error from git;
  - a working copy whose Issue file differs from the branch is left untouched, and a warning is logged;
  - a `CLOSED` Pull Request logs a warning.

## Comments

Usage: Implementer 54 input, 28,120 output, 82,660 cache creation, 1,918,828 cache read; Review Session 8 input, 5,195 output, 33,849 cache creation, 132,190 cache read.

**Review Session: Non-critical Findings**

- publishPullRequest commits the Issue file onto the local Issue branch before publisher.publish; when the push or `gh pr create` fails, that commit stays on the branch and the working copy then gains a 'Could not publish' comment, so merging the branch locally hits the same git refusal over the Issue file that this Issue fixes.
- The empty `catch {}` around the warning comment in publishPullRequest drops that error; the Run summary still has the original message, but the Preset Coding Standards say errors are never swallowed silently.
- The log line 'Issue X is done: its Pull Request URL is merged.' is duplicated in markMergedIssuesDone (once for pullRequest off, once after pullMergedIssueFiles).
- PublishResult now allows `published: true` together with `error`; a separate field such as `warning` would make the partial-success case clearer than reusing `error`.

**Review Session: Spec disagreement (not acted on)**

- Issue 16 says the host copies the Issue file from the working copy onto the Issue branch. The Implementer ticks the acceptance boxes on the branch and the working copy never has those ticks, so the 'Record Issue NN's Run comments' commit un-ticks every box the Implementer ticked and the Pull Request shows them unticked. Merging the comments into the branch's copy, instead of overwriting it, would keep both.

**Spec disagreement resolved:** the Review Session was right. The first box now merges the branch's copy with the working copy's header lines and Run comments, so the ticked boxes survive. Everything else on `issue/16-pull-request-carries-the-issue-file` (commit `778087c`) stands; only the Issue-file step needs to change. Also consider the first Non-critical Finding: after a failed publish, the Issue-file commit stays on the branch.
**Spec disagreement resolved:** the Review Session was right. The first box now merges the branch's copy with the working copy's header lines and Run comments, so the ticked boxes survive. Everything else on `issue/16-pull-request-carries-the-issue-file` (commit `778087c`) stands; only the Issue-file step needs to change. Also consider the first Non-critical Finding: after a failed publish, the Issue-file commit stays on the branch.

Usage: Implementer 58 input, 17,534 output, 68,915 cache creation, 1,586,601 cache read; Review Session 8 input, 4,649 output, 38,563 cache creation, 144,704 cache read.

**Review Session: Non-critical Findings**

- If the follow-up push fails, or the Issue was published before this change, the working copy's Issue file never matches the branch tip. The Issue then stays awaiting-merge with the same warning every Run, and the warning does not say how to recover.
- If the Issue file was never committed on the target branch, `git checkout HEAD -- file` fails in pullMergedIssueFiles, so catch-up warns 'could not discard its local edit'. An identical untracked file could be removed safely before the pull instead.
- The error mergeIssueFile throws when the working copy's comments do not extend the committed ones does not name the Issue file. It reaches the human only inside the generic 'Could not publish the Pull Request' comment.

**Gate passed**: every command exited 0 (log: `.sandcastle/logs/gate-16-2026-11-13T16-39-21-762Z.log`).

Usage: Body writer 2 input, 1,371 output, 33,395 cache creation, 11,370 cache read.

**Pull Request opened**: https://github.com/layugjohann/sandcastle-pro/pull/19
