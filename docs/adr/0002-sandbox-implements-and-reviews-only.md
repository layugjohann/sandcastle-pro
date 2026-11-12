# The sandbox only implements and reviews; the human plans and merges

Sandcastle's richest template (`parallel-planner-with-review`) runs a planner, parallel implementers, reviewers, and a merge agent. That uses up a Claude Pro 5-hour window almost immediately. Instead, a Run handles one Issue at a time. It runs a single Implementer, then a single Review Session that fixes only Critical Findings, then a deterministic Gate. Specs are planned interactively with the human beforehand, and the human merges each Issue's branch afterward. The default model is Opus 5.5, which is affordable because Issues run one at a time; it will be revisited using the token usage reported for each Run. There is no parallelism. When a Run hits the usage limit it pauses and is resumed manually instead of waiting.

## Consequences

- Throughput is lower than with Sandcastle's parallel templates by design. Do not "fix" this by adding parallel Implementers without measuring the token cost of each Issue (reported for every Run).
- Non-critical Findings and Gate failures are left for the human. A Gate failure stops the Run, even with `--count N`.
