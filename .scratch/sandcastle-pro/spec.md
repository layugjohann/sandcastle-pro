# Spec: sandcastle-pro

Status: ready-for-agent

## Problem Statement

I use Matt Pocock's Sandcastle to run autonomous coding agents, but I'm on Claude Pro, not Max. Sandcastle's richer templates run a planner, parallel implementers, reviewers and a merge agent for every batch of work. That uses up my 5-hour usage window almost immediately. To make it fit Pro, I have to hand-customize the generated workflow in every new project: models, number of stages, iteration limits, and an issue tracker that matches my local `.scratch` markdown files. Repeating that setup per project is slow and inconsistent. I also get no visibility into what each piece of work actually costs against my window.

## Solution

`sandcastle-pro` is an installable Preset that sits on top of Sandcastle (it is not a fork; see ADR 0001). In any project I run `init` once. It scaffolds a workflow designed for Pro. Then I use `run` to work through my Issues one at a time.

I plan Specs and Issues interactively in a normal Claude Code session, and I merge branches myself. The sandbox only implements and reviews (see ADR 0002). Each Run picks the next ready Issue. An Implementer works on that Issue's own branch. One Review Session reviews the change and fixes only Critical Findings. Then the Gate checks the result. Everything that needs my judgment ends up in the Issue file: Non-critical Findings, Gate failures, token usage. If I hit the usage limit, the Run pauses cleanly, and the next Run picks up exactly where it left off.

## User Stories

### Installing and initialising

1. As a developer, I want to install the Preset as a dev dependency, so that each project pins the version it uses.
2. As a developer, I want a single `init` command, so that a new project is ready for Runs without hand-editing workflow code.
3. As a developer, I want `init` to choose the native sandbox for my OS (Seatbelt on macOS, bubblewrap on Linux), so that I don't need to write or build a container image.
4. As a developer, I want to be able to ask `init` for Docker instead, so that I can choose stronger isolation when a project needs it.
5. As a developer, I want `init` to detect likely Gate commands from my project (package scripts, Python project config, Makefile targets), so that I don't have to remember them.
6. As a developer, I want to confirm or edit the detected Gate commands during `init`, so that the Gate checks exactly what I trust.
7. As a developer, I want `init` to support non-interactive flags, so that I can script it and so that it can be tested.
8. As a developer, I want `init` to create a Project Coding Standards skeleton with headings and examples, so that I know where to put rules specific to this codebase.
9. As a developer, I want `init` to never overwrite my existing Project Coding Standards, config or prompts, so that re-running it is safe.
10. As a developer, I want `init` to create an env example and git-ignore the real env file, so that my token is never committed.
11. As a developer, I want `init` to tell me to run `claude setup-token` and where to put the token, so that Runs use my Pro subscription instead of a separately billed API key.
12. As a developer, I want to be able to supply an API key instead of the OAuth token, so that I'm not locked out if I ever use the API.
13. As a developer, I want `init` to write the Issue format conventions into the project's docs, so that the agents and I agree on the format.

### Picking Issues

14. As a developer, I want a Run to read Issues from my local `.scratch/<feature>/issues/` markdown files, so that I need neither GitHub Issues nor Beads.
15. As a developer, I want a Run to pick the lowest-numbered Issue whose status is `ready-for-agent`, so that the order of work is predictable.
16. As a developer, I want a Run to skip an Issue whose `Blocked by:` Issues aren't all `done`, so that dependent work never starts too early.
17. As a developer, I want a Run to resume a `paused` Issue before picking any new one, so that half-finished work is never abandoned.
18. As a developer, I want a Run to mark an Issue as `done` once its branch has been merged into the target branch, so that I don't have to update statuses by hand after merging.
19. As a developer, I want a Run to set the Issue to `in-progress` when it starts, so that I can see what is being worked on.
20. As a developer, I want a Run to exit cleanly with a clear message when no Issue is ready, so that I know there is nothing to do.

### Implementing

21. As a developer, I want the Implementer to work on its own branch for each Issue (`issue/NN-slug`), so that `main` is never touched without me.
22. As a developer, I want the Implementer to start with the Issue, its Spec and the project glossary, so that it spends fewer tokens exploring the codebase.
23. As a developer, I want the Implementer to be limited to 3 iterations, so that one stubborn Issue can't drain my window.
24. As a developer, I want the default model to be Opus 5.5 at medium effort, so that each Issue gets strong reasoning while Issues still run one at a time.
25. As a developer, I want to override the model for a single Issue with a `Model:` line, so that I can use a cheaper model for easy Issues.
26. As a developer, I want to change the default model and effort in the project config, so that I can tune cost after watching token usage.

### Review Session

27. As a developer, I want exactly one Review Session after the Implementer finishes, so that each change gets a second look without a chain of reviews.
28. As a developer, I want the Review Session to fix Critical Findings itself in the same pass, so that problems that make the change wrong are fixed without starting another agent.
29. As a developer, I want Critical to mean correctness bugs, contradictions of the Spec or Issue, security holes, Gate failures and data loss, so that tokens are spent only where the change is wrong.
30. As a developer, I want Non-critical Findings appended to the Issue's `## Comments`, so that I can decide whether to act on them.
31. As a developer, I want a reviewer's belief that the Spec itself is wrong to be logged, never fixed, and to move the Issue to `needs-info`, so that agents never quietly change what I decided.
32. As a developer, I want the Review Session to check changes against three layers of Coding Standards (Preset, Personal, Project), so that universal, personal and codebase-specific rules all apply.
33. As a developer, I want to keep my personal Coding Standards in one file in my user config directory, so that I write my preferences once for every project.
34. As a developer, I want the Project layer to override the Personal layer, and the Personal layer to override the Preset layer when rules conflict, so that the most specific rule wins.
35. As a developer, I want breaking a Coding Standard to be a Non-critical Finding by default, so that style doesn't use up my window.
36. As a developer, I want rules under a `## Must` heading in any layer to be Must Rules, whose breach is a Critical Finding, so that I choose which standards are worth fixing automatically.
37. As a developer, I want Coding Standards to be loaded only during the Review Session, so that implementation doesn't pay for them.

### Gate and outcome

38. As a developer, I want the Gate to run after the Review Session, so that every change that reaches me has passed my checks.
39. As a developer, I want an Issue that passes the Gate to move to `awaiting-merge`, so that I know it is ready for me.
40. As a developer, I want an Issue that fails the Gate to move to `ready-for-human`, with the failure output appended to its comments and its branch left as it is, so that I can take over with full context.
41. As a developer, I want a Gate failure to stop the Run even when more Issues were requested, so that later Issues don't build on broken work.
42. As a developer, I want the Run to print the branch name, the Gate result and the Non-critical Findings when it finishes, so that I can merge or follow up straight away.

### Usage limit

43. As a developer, I want a Run that hits the Pro usage limit to commit work-in-progress to the Issue's branch, so that nothing is lost.
44. As a developer, I want that Issue marked `paused`, with the agent session id and the stage it was in (Implementer or Review Session), so that it can resume exactly where it stopped.
45. As a developer, I want the Run to exit straight away on the usage limit instead of waiting, so that I decide when to spend the next window.
46. As a developer, I want a resumed Issue to continue the original agent session, so that the work done before the limit isn't paid for twice.

### Batching and cost visibility

47. As a developer, I want `run` to process one Issue by default, so that I stay in control of merging and each Run's cost is predictable.
48. As a developer, I want `run --count N` to process up to N Issues back to back, so that I can queue work when I have budget to spare.
49. As a developer, I want a usage summary for each Run, split by stage (Implementer vs. Review Session), so that I learn what an Issue actually costs.
50. As a developer, I want that usage summary appended to the Issue, so that cost history stays with the work.
51. As a developer, I want no parallel Implementers, so that a Run never multiplies its token use or creates merge conflicts.

## Implementation Decisions

- **Built on Sandcastle (ADR 0001).** The Preset depends on `@ai-hero/sandcastle` and uses its `claudeCode()` agent provider, its sandbox providers (Seatbelt, bubblewrap, Docker) and its `branch` branch strategy. It never reimplements sandboxing, worktrees or commit collection.
- **Scope (ADR 0002).** No planner agent, no merge agent, no parallelism. Planning skills are not shipped. The Preset only consumes the Issue format.
- **Modules:**
  - **CLI.** Commands: `init` (flags: sandbox choice, Gate commands, non-interactive) and `run` (flag: `--count N`). It only wires the modules together.
  - **Issue Store.** A deep module over the `.scratch` markdown convention. It parses `Status:`, `Blocked by:` and `Model:` lines and the paused session metadata. It picks the next Issue: paused first, then the lowest-numbered unblocked `ready-for-agent`. It transitions statuses, appends under `## Comments` and finds an Issue's Spec. Its interface is in domain terms (`next()`, `transition(issue, status)`, `comment(issue, text)`, `pause(issue, sessionId, stage)`), with no raw text editing exposed.
  - **Run Workflow.** The orchestrator, and the one test seam. It receives an **Agent** capability: given a prompt, model, effort, branch, iteration cap and optional session to resume, it returns one of: completed (with token usage and, for a Review Session, structured Findings), or limit-reached (with session id and token usage). The Workflow also receives the Gate commands and the Issue Store. It handles the sequence, statuses, stopping rules and usage reporting.
  - **Sandcastle Agent adapter.** The production Agent. It maps the call onto Sandcastle's `run()` with `claudeCode(model, { effort })`, `resumeSession`, `maxIterations` and the `branch` strategy. It turns a usage-limit failure from Claude into the limit-reached result and collects `IterationUsage` into a total.
  - **Gate.** Runs the configured commands in sequence in the Issue's worktree. It returns pass, or fail with the combined output. It uses no tokens.
  - **Coding Standards loader.** Reads the Preset, Personal (user config directory) and Project layers and orders them so the Project layer has the highest precedence. It identifies Must Rules by the `## Must` heading.
  - **Prompt builder.** The Implementer prompt includes the Issue, its Spec and the glossary. The Review Session prompt includes the branch diff, commits, all three Coding Standards layers and the definition of Critical vs. Non-critical. It asks for structured Findings output (severity, whether fixed, description), with Spec disagreements flagged separately.
  - **Init scaffolder.** Detects the OS sandbox and Gate commands, and writes config, the Project Coding Standards skeleton, the env example, git-ignore entries and the Issue format docs. Existing files are never overwritten.
- **Statuses.** The existing triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) plus the Run statuses `in-progress`, `paused`, `awaiting-merge` and `done`.
- **Defaults.** Model `claude-opus-5-5`, effort `medium`, Implementer `maxIterations` 3, Review Session `maxIterations` 1, one Issue per Run. Model and effort can be set in the project config. Model can be overridden per Issue.
- **Merge detection.** At the start of a Run, any `awaiting-merge` Issue whose branch is merged into the target branch moves to `done`.
- **Auth.** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) is the default. `ANTHROPIC_API_KEY` is supported as an alternative. Both live in a git-ignored env file.
- **Language.** TypeScript, distributed on npm as `sandcastle-pro`, run with `npx sandcastle-pro <command>`.

## Testing Decisions

- **Test only external behavior.** A good test sets up a world (a git repo, Issue files, config), runs a command or the Run Workflow, and asserts what a user could observe. That means Issue statuses and comments, branches and commits, printed output and exit behavior. Tests never assert on internal calls or exact prompt wording. A prompt is what an agent can observe, so a test may check that a prompt carries a required instruction (a section heading or a key rule), but never pin its full text.
- **One seam: the Agent.** Run Workflow tests inject a fake Agent that is scripted for each scenario. It can make commits on the branch, return Findings (critical fixed, non-critical), return a Spec disagreement, return limit-reached with a session id, and report token usage. Everything else is real:
  - a temporary git repository
  - real `.scratch` Issue files
  - real Gate commands (`true`, `false`, and a script that fails once)
  - `HOME` pointed at a temp directory for the Personal Coding Standards layer
- **Scenarios the Run Workflow tests must cover:**
  - happy path to `awaiting-merge`
  - Gate failure to `ready-for-human`, which stops `--count N`
  - limit-reached during the Implementer, and during the Review Session, each followed by resume with the correct session and stage
  - blocked Issues skipped
  - paused Issues picked before new ones
  - merged branches detected as `done`
  - Spec disagreement goes to `needs-info`
  - usage appended to the Issue
  - no ready Issue exits cleanly
  - the per-Issue `Model:` override reaches the Agent
- **Issue Store.** Covered through the Run Workflow tests, plus focused tests for parsing edge cases: missing lines, unknown statuses, and comments appended when no `## Comments` heading exists yet.
- **Coding Standards loader.** Tests for layer ordering and Must Rule detection, using real files.
- **`init`.** End-to-end tests in a temp directory using non-interactive flags. They assert Gate detection for each project type, the scaffolded files, git-ignore entries, and that existing files are left untouched.
- **Not tested:** the real Claude model, and Sandcastle's own sandboxing and merging (upstream responsibility). The Sandcastle Agent adapter is kept thin enough to check by hand with one real Run.
- **Prior art:** none in this repo yet. These tests set the pattern.

## Out of Scope

- Parallel Implementers, a planner agent, a merge agent, or a `merge` command.
- Automatically waiting or scheduling until the usage window resets.
- Shipping or installing planning skills (grilling, domain modeling, Spec-to-Issue splitting). A Claude Code plugin may follow later.
- GitHub Issues, Beads or other issue trackers.
- A review of the review, or more than one Review Session per Issue.
- Dollar cost estimates. Only token counts are reported.

## Further Notes

- Opus 5.5 as the default is an experiment. The usage summary for each Run is the evidence for keeping it or changing it, and the fix if it's too expensive is changing the default model, not the workflow (ADR 0002).
- The words used here are defined in `GLOSSARY.md`: Preset, Spec, Issue, Implementer, Review Session, Finding, Critical Finding, Non-critical Finding, Coding Standards, Must Rule, Gate, Run, Pause.
- The Implementer prompt includes the glossary, so keeping `GLOSSARY.md` small also keeps every Run cheaper.
