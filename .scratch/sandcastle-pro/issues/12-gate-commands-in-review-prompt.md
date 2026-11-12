# 12: Gate commands in the Review Session prompt

Status: done
Blocked by: 08

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The Review Session prompt lists the configured Gate commands, so the reviewer can run them and judge Findings against them. Today it mentions "a Gate failure" in general terms only. In Issue 08's real Run, the reviewer reported "No Gate checks are configured" even though the config set `test -f hello.txt`.

- [x] The Review Session prompt includes each configured Gate command
- [x] The prompt says the Run Workflow runs the Gate itself after review, so the reviewer runs the commands only to check its own fixes
- [x] Tested at the prompt seam: a config with Gate commands produces a prompt naming them
