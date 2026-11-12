---
name: land
description: "Finish an Issue after its PR is merged: mark it done on main, push, and delete its branch."
disable-model-invocation: true
---

The user passes an Issue number (e.g. `Issue 07`). The Issue file is `.scratch/*/issues/NN-*.md` and its branch is `issue/NN-<slug>`.

1. Confirm the PR is merged: `gh pr list --state merged --head issue/NN-<slug>` returns it. If it doesn't, stop and tell the user.
2. `git checkout main && git pull --ff-only`.
3. Check the Issue file's acceptance checkboxes. Each open box needs a `## Comments` note explaining why it's open; report any that lack one and ask before going on.
4. Set the `Status:` line to `Status: done` with the Edit tool. Commit only that file as `Mark Issue NN as done`, then `git push origin main`.
5. Delete the branch: `git branch -d issue/NN-<slug>`, then `git fetch --prune`.

Done when `main` matches `origin/main`, the Issue says `Status: done`, and `git branch` no longer lists the Issue branch. Report those three facts in one line.
