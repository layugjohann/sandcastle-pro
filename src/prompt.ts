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
    codingStandards(context.standards),
    `## Commits\n\n${fenced(context.commits.trim() || "(no commits)")}`,
    `## Diff\n\n${fenced(context.diff.trim() || "(empty diff)", "diff")}`,
    OUTPUT_FORMAT,
  );
  return `${sections.join("\n\n")}\n`;
}

/** The Coding Standards section: Must Rules first, as Critical, then every layer in order of precedence. */
function codingStandards(layers: readonly CodingStandardsLayer[]): string {
  const sections = [
    `## Coding Standards

Check the change against the layers below. They are listed highest precedence first (${layers.map((l) => l.name).join(", then ")}). When two rules conflict, follow the one in the higher layer.`,
  ];
  const must = layers.flatMap((layer) => layer.mustRules.map((rule) => `- (${layer.name}) ${rule}`));
  if (must.length > 0) {
    sections.push(
      `### Must Rules (breaking one is a Critical Finding)\n\nUnless a higher layer overrides it, a breach of any of these is Critical: fix it.\n\n${must.join("\n")}`,
    );
  }
  layers.forEach((layer, index) => {
    if (layer.rules === "") return;
    const precedence = index === 0 ? "highest precedence" : index === layers.length - 1 ? "lowest precedence" : "overrides the layers below";
    sections.push(`### ${layer.name} layer (${precedence})\n\n${fenced(layer.rules, "markdown")}`);
  });
  return sections.join("\n\n");
}
