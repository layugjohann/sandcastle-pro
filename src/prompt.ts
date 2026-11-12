import type { Issue } from "./issue-store.js";

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
}

const SEVERITY_DEFINITION = `## Critical vs. Non-critical

A **Critical Finding** makes the change wrong. It is one of:
- a correctness bug
- a contradiction of the Spec or the Issue
- a security hole
- a Gate failure (failing tests, typecheck or other configured checks)
- data loss

A **Non-critical Finding** makes the change worse but not wrong, such as style, naming or simplification.

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
    `## Commits\n\n${fenced(context.commits.trim() || "(no commits)")}`,
    `## Diff\n\n${fenced(context.diff.trim() || "(empty diff)", "diff")}`,
    OUTPUT_FORMAT,
  );
  return `${sections.join("\n\n")}\n`;
}

/** Fences `content` with more backticks than any run inside it, so a diff can't close its own fence. */
function fenced(content: string, lang = ""): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${content}\n${fence}`;
}
