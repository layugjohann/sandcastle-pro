# Issue format for sandcastle-pro

Runs read Issues from local markdown files. Plan Specs and Issues in a normal Claude Code session;
a Run only implements and reviews them.

## Files

- One feature per directory: `.scratch/<feature>/`.
- The Spec is `.scratch/<feature>/spec.md`.
- One Issue per file: `.scratch/<feature>/issues/NN-slug.md`, numbered from `01`.
  The Run works on the Issue's own branch, `issue/NN-slug`.

## Lines near the top

- `Status:` the Issue's status (below). Required: an Issue without a known status is never picked.
- `Blocked by:` numbers of Issues in the same `issues/` directory that must be `done` first, e.g. `Blocked by: 02, 05`. Missing or `None` means unblocked.
- `Spec:` the Spec's path from the repo root, e.g. `Spec: .scratch/<feature>/spec.md`.
  Without it, `spec.md` next to the `issues/` directory is used.
- `Model:` optional; overrides the configured model for this Issue only, e.g. `Model: claude-sonnet-5-5`.
  Put it above any `## Comments` heading; below it, it is ignored.

The rest of the file describes the work: what to build, and a checklist of acceptance criteria.

## Statuses

Set by you:

- `needs-triage`: not yet evaluated.
- `ready-for-agent`: fully specified. A Run picks the lowest-numbered unblocked one.
- `ready-for-human`: needs a person. A Run also sets it when the Gate fails, leaving the branch as it is.
- `wontfix`: will not be done.

Set by a Run:

- `in-progress`: a Run is working on it.
- `paused`: the Run hit the usage limit. The next Run resumes it before any new Issue.
  The `Paused session:` and `Paused stage:` lines record where to continue; leave them alone.
- `needs-info`: the Review Session believes the Spec itself is wrong. Read its comment, fix the Spec or Issue, and set `ready-for-agent` again.
- `awaiting-merge`: passed the Gate. Review and merge `issue/NN-slug` yourself.
- `done`: its branch was merged into the target branch, detected at the start of the next Run.

## Comments

A Run appends Non-critical Findings, Gate failures and token usage under a `## Comments` heading at the
bottom of the file, creating it if needed.
