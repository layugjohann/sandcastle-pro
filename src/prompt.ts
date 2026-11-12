import { STAGE_NAMES, type Stage } from "./agent.js";
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
}

const SEVERITY_DEFINITION = `## Critical vs. Non-critical

A **Critical Finding** makes the change wrong. It is one of:
- a correctness bug
- a contradiction of the Spec or the Issue
- a security hole
- a Gate failure (failing tests, typecheck or other configured checks)
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
    `## Commits\n\n${fenced(context.commits.trim() || "(no commits)")}`,
    `## Diff\n\n${fenced(context.diff.trim() || "(empty diff)", "diff")}`,
    OUTPUT_FORMAT,
  );
  return `${sections.join("\n\n")}\n`;
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

/** The prompt that continues a session the usage limit (or a failure) stopped part-way. */
export function buildResumePrompt(stage: Stage): string {
  return [
    `This session stopped part-way through, and you are resuming it as the ${STAGE_NAMES[stage]}.`,
    "Any uncommitted changes you had were committed to the branch as a work-in-progress commit.",
    "Continue exactly where you left off, following the original instructions above, including how to finish.",
  ].join("\n") + "\n";
}
