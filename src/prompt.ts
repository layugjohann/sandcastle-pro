import { STAGE_NAMES, type Finding, type PausableStage } from "./agent.js";
import type { CodingStandardsLayer } from "./coding-standards.js";
import type { Issue } from "./issue-store.js";
import { fenced } from "./markdown.js";

export function buildImplementerPrompt(issue: Issue, glossary: string | undefined): string {
  const sections = [
    "You are the Implementer. Turn the Issue below into commits on the current branch.",
    "Work only on what the Issue asks for. Commit your work before you finish.",
    `## Issue\n\n${issue.text.trim()}`,
  ];
  if (issue.spec) sections.push(`## Spec\n\n${issue.spec.trim()}`);
  if (glossary) sections.push(`## Glossary\n\nUse these terms exactly.\n\n${glossary.trim()}`);
  return `${sections.join("\n\n")}\n`;
}

export interface ReviewContext {
  branch: string;
  /** `git log` of the commits on the branch since the target branch. */
  commits: string;
  /** `git diff` of the branch against the target branch. */
  diff: string;
  /** The Coding Standards layers, highest precedence first. */
  standards: readonly CodingStandardsLayer[];
  /** The configured Gate commands, in the order the Run Workflow runs them. */
  gate: readonly string[];
}

const SEVERITY_DEFINITION = `## Critical vs. Non-critical

A **Critical Finding** makes the change wrong. It is one of:
- a correctness bug
- a contradiction of the Spec or the Issue
- a security hole
- a Gate failure (a Gate command below fails)
- data loss
- a breach of a Must Rule (see Coding Standards)

A **Non-critical Finding** makes the change worse but not wrong, such as style, naming or simplification.
Breaking any Coding Standard that is not a Must Rule is a Non-critical Finding.

Fix every Critical Finding yourself, in this pass, with commits on the current branch.
Do not fix Non-critical Findings; report them for the human.

If you believe the Spec itself is wrong, do not change anything because of it.
Report it as a Spec disagreement instead.`;

const OUTPUT_FORMAT = `## Output

End your reply with exactly one fenced \`json\` block in this shape:

\`\`\`json
{
  "findings": [
    { "severity": "critical" | "non-critical", "fixed": true | false, "description": "..." }
  ],
  "specDisagreements": ["..."]
}
\`\`\`

Use empty arrays when there is nothing to report.`;

export function buildReviewPrompt(issue: Issue, context: ReviewContext): string {
  const sections = [
    `You are the Review Session. Review the Implementer's changes on branch \`${context.branch}\` against the Issue and its Spec.`,
    SEVERITY_DEFINITION,
    `## Issue\n\n${issue.text.trim()}`,
  ];
  if (issue.spec) sections.push(`## Spec\n\n${issue.spec.trim()}`);
  sections.push(
    codingStandardsSection(context.standards),
    gateSection(context.gate),
    `## Commits\n\n${fenced(context.commits.trim() || "(no commits)")}`,
    `## Diff\n\n${fenced(context.diff.trim() || "(empty diff)", "diff")}`,
    OUTPUT_FORMAT,
  );
  return `${sections.join("\n\n")}\n`;
}

/**
 * The Gate section: the reviewer runs these only to check its own fixes, because
 * the Run runs the Gate itself once the review is done.
 */
function gateSection(commands: readonly string[]): string {
  return `## Gate

The Run runs the Gate itself after this Review Session, on the Issue's branch, and the change only reaches awaiting-merge if every command passes. The configured Gate commands, one per line, run in order:

${fenced(commands.join("\n"), "sh")}

Run them yourself only to check your own fixes before you finish.`;
}

/**
 * The Coding Standards section: every layer, highest precedence first, each with
 * its Must Rules marked Critical, so a conflict and its winner read in one place.
 */
function codingStandardsSection(layers: readonly CodingStandardsLayer[]): string {
  const order = layers.map((l) => l.name).join(", then ");
  const sections = [
    `## Coding Standards

Check the change against the layers below, listed highest precedence first (${order}). When two rules conflict, follow the one in the higher layer, even if the lower one is a Must Rule.

Breaking a Must Rule is a Critical Finding: fix it. Breaking any other rule is a Non-critical Finding.`,
  ];
  for (const layer of layers) {
    const parts = [`### ${layer.name} layer`];
    if (layer.mustRules.length > 0) {
      parts.push(`Must Rules (Critical):\n\n${layer.mustRules.map((rule) => `- ${rule}`).join("\n")}`);
    }
    if (layer.rules !== "") parts.push(`Other rules (Non-critical):\n\n${fenced(layer.rules, "markdown")}`);
    sections.push(parts.join("\n\n"));
  }
  return sections.join("\n\n");
}

export interface BodyWriterContext {
  branch: string;
  /** `git log` of the commits on the branch since the target branch. */
  commits: string;
  /** `git diff` of the branch against the target branch. */
  diff: string;
  /** Every Finding of the Review Session. */
  findings: readonly Finding[];
  /** The passing Gate's transcript, already cut to a size a Pull Request body can hold. */
  gateOutput: string;
}

/*
 * The `pr` body template. Credit: adapted from the Pull Request description template by
 * Dex Horthy / HumanLayer (https://github.com/humanlayer). Summary, Evidence and Merge Danger
 * (Door, Blast Radius) are theirs; the host appends Findings and usage itself.
 */
const PR_TEMPLATE = `## Summary

<Two to four sentences: what changed and why, in the Issue's terms.>

<One picture of the change, whichever shows it best:
- a mermaid diagram (\`\`\`mermaid) of the new flow or structure;
- a diff sketch: a few key lines before and after, not the whole diff;
- a tree of the files added and changed, each with a few words on why.>

## Evidence

<How we know it works: which Gate commands passed and what they show (e.g. test counts), and which
tests cover the Issue's acceptance criteria. Quote short lines from the Gate output; never invent results.>

## Merge Danger

**Door:** <One-way or two-way. Two-way: reverting the merge undoes it cleanly. One-way: it changes something
a revert can't take back, such as stored data, a published API, a migration or a config format. Say which and why.>

**Blast Radius:** <What breaks, and for whom, if this change is wrong. Name the modules, commands or users affected.>`;

const BODY_OUTPUT_FORMAT = `## Output

End your reply with exactly one fenced \`json\` block in this shape, with the whole body as one JSON string
(newlines escaped as \\n):

\`\`\`json
{ "body": "## Summary\\n\\n..." }
\`\`\``;

/**
 * The body writer's prompt: everything it needs to describe the change, so it can write the body
 * without exploring the repo, and the template to fill in.
 */
export function buildBodyWriterPrompt(issue: Issue, context: BodyWriterContext): string {
  const findings = context.findings.map((f) => `- ${f.severity}${f.severity === "critical" ? (f.fixed ? ", fixed" : ", not fixed") : ""}: ${f.description}`);
  const sections = [
    `You write the body of the Pull Request for branch \`${context.branch}\`, so a human can judge the change from GitHub alone.`,
    [
      "The change has passed its Review Session and the Gate. Do not change it: never edit files, commit, or touch the branch.",
      "Everything you need is below; read the repo only if the diff leaves something unclear.",
      "Fill in the template exactly, keeping its headings. Be concrete and brief.",
      "Do not add sections for Findings or token usage: the host appends those itself.",
    ].join("\n"),
    `## Template\n\n${fenced(PR_TEMPLATE, "markdown")}`,
    `## Issue\n\n${issue.text.trim()}`,
  ];
  if (issue.spec) sections.push(`## Spec\n\n${issue.spec.trim()}`);
  sections.push(
    `## Review Session Findings\n\n${findings.length > 0 ? findings.join("\n") : "None."}`,
    `## Gate output\n\n${fenced(context.gateOutput.trim() || "(no output)")}`,
    `## Commits\n\n${fenced(context.commits.trim() || "(no commits)")}`,
    `## Diff\n\n${fenced(context.diff.trim() || "(empty diff)", "diff")}`,
    BODY_OUTPUT_FORMAT,
  );
  return `${sections.join("\n\n")}\n`;
}

/** The prompt that continues a session the usage limit (or a failure) stopped part-way. */
export function buildResumePrompt(stage: PausableStage): string {
  return [
    `This session stopped part-way through, and you are resuming it as the ${STAGE_NAMES[stage]}.`,
    "Any uncommitted changes you had were committed to the branch as a work-in-progress commit.",
    "Continue exactly where you left off, following the original instructions above, including how to finish.",
  ].join("\n") + "\n";
}
