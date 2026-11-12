# Build a preset on top of Sandcastle, not a fork

`sandcastle-pro` depends on `@ai-hero/sandcastle` and ships only its own `init`, `main.mts`, and prompts. We considered forking the engine or writing an orchestrator around `claude -p` from scratch. We rejected both because what drains a Claude Pro usage window is the workflow in the template: how many agents run, which models they use, and how often they loop. The sandboxing, worktree, and merge engine is not the cost. Building a preset keeps upstream engine fixes free and leaves us maintaining only the workflow layer.
