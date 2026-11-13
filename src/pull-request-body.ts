import type { Finding } from "./agent.js";
import { fenced } from "./markdown.js";
import { formatUsage, type IssueUsage } from "./usage.js";

/** GitHub rejects a body over 65,536 characters; this leaves room for every other section. */
const MAX_EVIDENCE_CHARS = 50_000;

export interface PullRequestBodyInput {
  /** The passing Gate's full transcript. */
  gateOutput: string;
  findings: readonly Finding[];
  usage: IssueUsage;
}

/**
 * The deterministic Pull Request body: Evidence (the passing Gate output), Fixed during review,
 * Non-critical Findings, and the Issue's token usage in a collapsed block. Empty sections are left out.
 */
export function buildPullRequestBody({ gateOutput, findings, usage }: PullRequestBodyInput): string {
  const fixed = findings.filter((f) => f.severity === "critical" && f.fixed).map((f) => f.description);
  const nonCritical = findings.filter((f) => f.severity === "non-critical").map((f) => f.description);
  const evidence = gateOutput.trim();
  const sections = [
    evidence ? `## Evidence\n\nThe Gate passed.\n\n${fenced(truncateStart(evidence, MAX_EVIDENCE_CHARS))}` : undefined,
    list("Fixed during review", fixed),
    list("Non-critical Findings", nonCritical),
    `<details>\n<summary>Token usage</summary>\n\n${formatUsage(usage)}\n\n</details>`,
  ];
  return `${sections.filter((s) => s !== undefined).join("\n\n")}\n`;
}

function list(heading: string, items: readonly string[]): string | undefined {
  if (items.length === 0) return undefined;
  return `## ${heading}\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

/** Keeps the end of `text`, where the last Gate commands' results are. */
function truncateStart(text: string, max: number): string {
  if (text.length <= max) return text;
  return `[… ${(text.length - max).toLocaleString("en-US")} earlier characters cut; the full output is in the Gate log]\n${text.slice(-max)}`;
}
