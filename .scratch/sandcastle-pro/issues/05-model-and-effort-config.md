# 05: Model and effort config, plus per-Issue Model

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** A project config file for the Preset. It holds the Gate commands, the default model (`claude-opus-5-5`), the default effort (`medium`) and the iteration limits (3 for the Implementer, 1 for the Review Session). A `Model:` line on an Issue overrides the default model for that Issue only. This config format is what `init` will write.

- [ ] Without config overrides, the Agent receives `claude-opus-5-5`, `medium`, and iteration limits of 3 and 1
- [ ] The project config can change the default model and effort
- [ ] A `Model:` line on an Issue reaches the Agent for both stages of that Issue only
- [ ] The Gate commands are read from the project config
- [ ] An invalid or missing config gives a clear error that names the problem
