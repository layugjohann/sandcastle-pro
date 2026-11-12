# 11: Gate detection and interactive confirm in init

Status: ready-for-agent
Blocked by: 10

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** `init` detects likely Gate commands from the project: package scripts (`test`, `typecheck`, `lint`), Python project config, and Makefile targets. When run interactively, it asks the user to confirm or edit the list before writing the config. Flags still skip the prompts.

- [ ] Gate commands are detected from package scripts, using the package manager the project uses
- [ ] Gate commands are detected from Python project config and from Makefile targets
- [ ] Interactive mode lets the user confirm or edit the detected list
- [ ] Non-interactive mode uses the detected commands unless overridden by a flag
- [ ] With nothing detected, the user is asked (interactive) or `init` fails with a clear message (non-interactive)
- [ ] Tested end to end in temp directories for each project type
