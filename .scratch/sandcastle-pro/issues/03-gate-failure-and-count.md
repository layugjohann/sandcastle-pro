# 03: Gate failure and --count N

Status: done
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** A Run can process up to N Issues back to back (`--count N`, default 1). When the Gate fails, the Issue moves to `ready-for-human`, the combined Gate output is appended to its comments, and its branch is left as it is. A Gate failure stops the Run even if more Issues were requested, because later Issues may depend on the broken one.

- [x] By default a Run processes exactly one Issue
- [x] `--count N` processes up to N Issues in sequence, never in parallel
- [x] A Gate failure moves the Issue to `ready-for-human` and appends the failure output
- [x] The branch of a failed Issue is kept
- [x] A Gate failure stops the Run before the next Issue, even with `--count N`
- [x] The Gate runs its commands in order and stops at the first failure
