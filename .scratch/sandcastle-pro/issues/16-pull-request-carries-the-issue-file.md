# 16: The Pull Request carries the Issue file, and the Run catches up after a merge

Status: ready-for-agent
Blocked by: 14

Spec: `.scratch/sandcastle-pro/spec.md`, as amended by `docs/adr/0003-publish-each-issue-as-a-pull-request.md`

**What to build:** A Run writes its comments and status into the Issue file in the target branch's working copy. The Issue branch edits the same file too, because the Implementer ticks the acceptance boxes. So today:

- the Pull Request has no Run comments: no usage, no Findings, no Gate result;
- after the human merges, `git pull` refuses, because a local edit to the Issue file would be overwritten. Git refuses even when the local edit is identical to the merged one.

The fix has two parts:

- The host commits the Issue file onto the Issue branch, so the Pull Request shows the comments.
- When the next Run finds the Pull Request merged, it drops the now-redundant local edit and fast-forwards the target branch.

The working copy keeps the status, so `next()` still sees the Issue as `awaiting-merge` until then. Everything here only applies when `pullRequest` is on; with it off, behaviour is exactly as today.

- [x] Before pushing, the host copies the Issue file from the working copy into the Issue branch and commits it as `Record Issue <id>'s Run comments`, so the Pull Request includes the comments up to "Gate passed".
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
