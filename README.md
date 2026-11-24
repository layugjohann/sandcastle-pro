# sandcastle-pro

A preset for [Sandcastle](https://www.npmjs.com/package/@ai-hero/sandcastle) that fits autonomous coding Runs into a Claude Pro usage window. You plan a feature as a Spec and a set of Issues in markdown. A Run then works through the Issues one at a time, each on its own branch: an Implementer agent builds it, a Review Session fixes Critical Findings, and your Gate commands (tests, typecheck, lint) must pass. Each finished Issue waits for you as a branch or a Pull Request. You review and merge. Agents never merge, and when the usage limit hits, the Issue is paused and resumed on the next Run.

## Requirements

- Node.js 20 or later, and git.
- A Claude Pro or Max subscription (or an Anthropic API key).
- On macOS, a git that isn't Apple's `/usr/bin/git`, because the Seatbelt sandbox blocks it: `brew install git`, then check with `which git`.
- For Pull Requests: the repo's `origin` on GitHub, and the [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`).
- Optional: Docker, if you want `--sandbox docker`.

## Install

### From npm

> Not published yet. Until then, install from source (below).

```sh
npm install -D sandcastle-pro
npx sandcastle-pro init
```

### From source

```sh
git clone https://github.com/layugjohann/sandcastle-pro.git   # private repo for now
cd sandcastle-pro
npm install
npm run build
npm link          # puts `sandcastle-pro` on your PATH
```

Then, in each project where you want to use it:

```sh
cd your-project
sandcastle-pro init
```

With a linked install, run `sandcastle-pro ...` directly. With an npm install, use `npx sandcastle-pro ...`.

### Update

- **From source:** run `git pull && npm install && npm run build` in the sandcastle-pro clone. Every linked project picks up the new build right away, because `dist` isn't committed and the link points at your clone.
- **From npm:** `npm install -D sandcastle-pro@latest`.

You don't need to run `init` again after an update. Read the changes for any new config keys you might want to turn on.

### Uninstall

- **From source:** `npm unlink -g sandcastle-pro`.
- **From npm:** `npm uninstall sandcastle-pro`.

## Set up a project

`sandcastle-pro init` makes a project ready for Runs. It never overwrites a file that already exists. It:

- detects Gate commands from package scripts, Python project config and Makefile targets, and asks you to keep, drop or add commands;
- puts an install command first when it detects package scripts, such as `npm ci --no-audit --no-fund` (exact, from the lockfile) or `pnpm install --frozen-lockfile`, because the Gate runs in a fresh worktree with no `node_modules`;
- offers to turn on Pull Requests, when `origin` is on GitHub and `gh` is logged in;
- writes `sandcastle-pro.config.json`, `.sandcastle/CODING_STANDARDS.md`, `.sandcastle/.env.example` and `docs/agents/sandcastle-pro-issues.md`;
- adds `.sandcastle/.env`, `.sandcastle/logs/` and `.sandcastle/worktrees/` to `.gitignore`.

| Option | What it does |
|---|---|
| `--gate CMD` | Use this Gate command instead of the detected ones. Repeat it for each command, in the order they run. |
| `--sandbox native` | Seatbelt on macOS, bubblewrap on Linux. The default on those systems. |
| `--sandbox docker` | Docker, for stronger isolation. The default on other systems. |
| `--non-interactive` | Never ask questions: use the detected Gate commands. This is also the default without a terminal. |

Then:

1. Run `claude setup-token`, and put the token in `.sandcastle/.env` as `CLAUDE_CODE_OAUTH_TOKEN=...` (copy it from `.sandcastle/.env.example`). To bill the API instead, set `ANTHROPIC_API_KEY` there.
2. Add rules for your codebase to `.sandcastle/CODING_STANDARDS.md`. The agents follow them, and the Review Session checks against them.
3. Write your first Issues (see [Issues](#issues)).

## Commands

| Command | What it does |
|---|---|
| `sandcastle-pro init` | Set up the current project (see above). |
| `sandcastle-pro run` | Catch up on merged Pull Requests, then work on the next ready Issue. |
| `sandcastle-pro run --count N` | Same, but work through up to N Issues one after another. |

A Run:

1. **Catches up.** If any Pull Requests were merged into the target branch, it pulls the target branch and marks their Issues `done`.
2. **Picks Issues.** It resumes a `paused` Issue first, then picks the lowest-numbered `ready-for-agent` Issue whose blockers are done.
3. **Builds each Issue** on branch `issue/NN-slug`: Implementer, Review Session, then the Gate.
4. **Finishes each Issue.** If the Gate passes, the Issue becomes `awaiting-merge`, and with `pullRequest` on, the branch is pushed and a Pull Request opened. If the Gate fails or a Critical Finding stays unfixed, the Issue becomes `ready-for-human` and the Run stops. At the usage limit, the Issue becomes `paused` and the Run stops.

Run it from the target branch (usually `main`), with a clean working tree. It exits with code 1 when an Issue failed the Gate or kept an unfixed Critical Finding. It prints the token usage per Issue at the end.

## Config

`sandcastle-pro.config.json` at the repo root. Only `gate` is required.

| Key | Default | What it does |
|---|---|---|
| `gate` | (required) | Gate commands, run in order on the Issue's branch. All must pass. |
| `model` | `claude-opus-5-5` | Model for the Implementer and Review Session. An Issue's `Model:` line overrides it. |
| `effort` | `medium` | Reasoning effort. |
| `maxIterations.implementer` | `3` | Most iterations the Implementer gets per Issue. |
| `maxIterations.reviewSession` | `1` | Most iterations the Review Session gets per Issue. |
| `sandbox` | `native` | `native` or `docker`. |
| `pullRequest` | `false` | Push each Issue that passes the Gate, and open a Pull Request for it. |
| `bodyWriter.model` | `claude-sonnet-5-5` | Model that writes Pull Request bodies. |
| `bodyWriter.effort` | `low` | Its reasoning effort. |
| `stack` | `false` | `false`, `true` or `"run"`: build Issues on top of unmerged work (see [Stacking](#stacking)). `"run"` is recommended. `true` and `"run"` need `pullRequest`. |

## Issues

Issues are markdown files in your repo. Plan them in a normal Claude Code session, and let a Run implement them.

```
.scratch/<feature>/spec.md               the Spec
.scratch/<feature>/issues/01-first.md    one Issue per file, numbered from 01
```

An Issue starts with a few header lines, followed by what to build and a checklist:

```md
# 01: Add the login form

Status: ready-for-agent
Blocked by: None

**What to build:** ...

- [ ] The form posts to /login.
- [ ] A wrong password shows an error.
```

| Status | Set by | Meaning |
|---|---|---|
| `needs-triage` | you | Not evaluated yet. |
| `ready-for-agent` | you | Fully specified. A Run may pick it. |
| `ready-for-human` | you or a Run | Needs a person. A Run sets it when the Gate fails or a Critical Finding stays unfixed. |
| `wontfix` | you | Won't be done. |
| `in-progress` | Run | A Run is working on it. |
| `paused` | Run | Hit the usage limit. The next Run resumes it first. |
| `needs-info` | Run | The Review Session thinks the Spec is wrong. Fix it, then set `ready-for-agent`. |
| `awaiting-merge` | Run | Passed the Gate. Review and merge it. |
| `done` | Run | Merged into the target branch. The next Run's startup detects this. |

The full format, including `Spec:`, `Model:` and the lines a Run adds, is in [docs/agents/sandcastle-pro-issues.md](docs/agents/sandcastle-pro-issues.md).

## The loop

```
 ┌─▶ 1. Plan     write Issues as ready-for-agent, commit and push them
 │   2. Run      sandcastle-pro run --count N
 │   3. Land     commit and push the Issue files the Run marked done
 │   4. Review   read the Pull Requests
 │   5. Merge    oldest first, with merge commits
 └── back to 2, or to 1 when you're out of Issues
```

- **A Run never commits to the target branch.** At startup it marks merged Issues `done` in your working copy only. After the Run finishes, commit those `done` files and push them (step 3).
- **Don't commit `awaiting-merge` files after you merge.** The merged branch already brings that change to `main`. Committing it again makes your `main` diverge from GitHub's, and the next Run's `git pull --ff-only` fails. Leave them alone, and the next Run catches them up.
- **For the last batch**, run `sandcastle-pro run` once more after merging. With no ready Issues, it catches up and prints "Nothing to do." Then land the `done` files.
- **When something goes wrong:**
  - `ready-for-human`: fix it by hand, or edit the Issue and set `ready-for-agent`.
  - `needs-info`: fix the Spec or the Issue, then set `ready-for-agent`.
  - `paused`: run again after the usage window resets.

### Optional helper: `land-done`

Step 3 as one command. Save this as an executable script on your `PATH`, for example `~/.local/bin/land-done`, and make it executable with `chmod +x`. It must run on the default branch. It commits and pushes only the changed Issue files whose status is `done`, and leaves everything else uncommitted.

```sh
#!/bin/sh
set -e
cd "$(git rev-parse --show-toplevel)"
branch=$(git symbolic-ref --short HEAD)
default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
default=${default:-main}
[ "$branch" = "$default" ] || { echo "land-done: on '$branch', not '$default'." >&2; exit 1; }

files=$(git diff --name-only -- .scratch | grep '\.md$' \
  | while read -r f; do grep -qE '^\**Status\**:\**[[:space:]]*done\b' "$f" && echo "$f"; done)
[ -n "$files" ] || { echo "land-done: no done Issues to commit."; exit 0; }

numbers=$(echo "$files" | sed -E 's|.*/([0-9]+)-[^/]*$|\1|' | paste -sd ',' - | sed 's/,/, /g')
echo "$files" | while read -r f; do git add -- "$f"; done
git commit -m "Mark Issues $numbers as done"
git push
```

In Claude Code, run it with `! land-done`.

## Stacking

A Stacked Issue is an Issue started on the branch of another Issue that is not merged yet: its Base Issue. Its branch is cut from the tip of the Base Issue's branch, its Review Session sees only its own work, the Gate runs on all the unmerged work below it at once, and its Pull Request targets the Base Issue's branch. The Issues awaiting merge, each started on the one before it, form the Stack.

Set `stack` in `sandcastle-pro.config.json` to one of:

- **`"run"` (recommended).** Every Issue becomes a Stacked Issue on the top of the Stack: the newest `awaiting-merge` Issue that nothing is stacked on yet. The Base Issue is usually not one of the Issue's blockers. When nothing is `awaiting-merge`, the Issue starts from the target branch. So with `--count 3`, the second Issue is stacked on the first and the third on the second, and the next Run carries on from the top of whatever you haven't merged. Issues that edit the same files never conflict with each other, and a break between them fails the Gate in the sandbox instead of after you merge. An Issue whose blockers are `awaiting-merge` starts only when they are in the Stack below the top. If the Run finds two or more tops, it starts nothing and names them; merge or close Pull Requests until one Stack remains.
- **`true`.** Only an Issue whose one unmerged blocker is `awaiting-merge` becomes a Stacked Issue, on that blocker's branch. Issues that don't block each other each start from the target branch, so their Pull Requests can conflict once you merge the first one. An Issue with two or more unmerged blockers waits.
- **`false`** (the default). No stacking: every Issue starts from the target branch, and only `done` blockers count.

The Pull Request body of a Stacked Issue starts with a line naming its Base Issue and that Issue's Pull Request, and the "Pull Request opened" comment on the Issue names it too.

Set up the repository before turning it on:

- **It requires `pullRequest`.** `"stack": true` or `"stack": "run"` with `"pullRequest": false` is a config error.
- **Merge with merge commits, not squash merges.** A squash merge rewrites the Base Issue's commits, so the next Pull Request in the Stack would show them again and conflict.
- **Turn on "Automatically delete head branches"** (Settings → General → Pull Requests). When the Base Issue's branch is deleted on merge, GitHub retargets the next Pull Request to the target branch. An Issue is `done` only once its Pull Request is merged into the target branch.

Then, when you merge:

- **Merge the Stack from the bottom up**, starting with the Pull Request that targets the target branch. GitHub then retargets each next Pull Request to the target branch without a conflict. A Stacked Issue merged into its Base Issue's branch instead stays `awaiting-merge`, and the Run warns about it.
- **Change only the top Pull Request.** Pushing to a Pull Request lower in the Stack leaves the Issues above it built on the old version, which brings back the conflicts stacking prevents. To fix a lower one, merge it as it is and put the fix in a follow-up Issue, which the next Run stacks on the top.
- **Closing a Pull Request without merging** makes its Issue `wontfix` and sends every Issue above it in the Stack to `ready-for-human`.

The Run never rebases a Stacked Issue or merges its Base Issue into it. If a Base Issue changes after an Issue was stacked on it, bringing the Stacked Issue up to date is up to you.

