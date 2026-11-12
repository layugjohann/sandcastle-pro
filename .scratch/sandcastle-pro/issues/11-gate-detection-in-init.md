# 11: Gate detection and interactive confirm in init

Status: ready-for-agent
Blocked by: 10

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** `init` detects likely Gate commands from the project: package scripts (`test`, `typecheck`, `lint`), Python project config, and Makefile targets. When run interactively, it asks the user to confirm or edit the list before writing the config. Flags still skip the prompts.

- [x] Gate commands are detected from package scripts, using the package manager the project uses
- [x] Gate commands are detected from Python project config and from Makefile targets
- [x] Interactive mode lets the user confirm or edit the detected list
- [x] Non-interactive mode uses the detected commands unless overridden by a flag
- [x] With nothing detected, the user is asked (interactive) or `init` fails with a clear message (non-interactive)
- [x] Tested end to end in temp directories for each project type
