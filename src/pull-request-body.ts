import type { Finding } from "./agent.js";
import { fenced } from "./markdown.js";
import { formatUsage, type IssueUsage } from "./usage.js";

/** GitHub rejects a body over 65,536 characters; this leaves room for every other section. */
const MAX_EVIDENCE_CHARS = 50_000;

/** The same room for the body writer's sections, which the host does not control. */
const MAX_WRITTEN_CHARS = 50_000;

export interface PullRequestBodyInput {
  /** The passing Gate's full transcript. */
  gateOutput: string;
  findings: readonly Finding[];
  usage: IssueUsage;
}

/**
 * The deterministic Pull Request body: Evidence (the passing Gate output), then the host's sections. It is the
 * fallback when the body writer wrote nothing; `note` then says why, at the top. Empty sections are left out.
 */
export function buildPullRequestBody({ gateOutput, findings, usage }: PullRequestBodyInput, note?: string): string {
  const evidence = gateOutput.trim();
  return join([
    note === undefined ? undefined : `> **Note:** ${note}`,
    evidence ? `## Evidence\n\nThe Gate passed.\n\n${fenced(truncateStart(evidence, MAX_EVIDENCE_CHARS))}` : undefined,
    ...hostSections(findings, usage),
  ]);
}

/** The body writer's Summary, Evidence and Merge Danger, followed by the host's sections. */
export function buildWrittenPullRequestBody(written: string, { findings, usage }: PullRequestBodyInput): string {
  return join([truncateEnd(written.trim(), MAX_WRITTEN_CHARS), ...hostSections(findings, usage)]);
}

/**
 * The sections the host adds to every body, because it knows them exactly: Fixed during review
 * (Critical Findings with `fixed: true`), Non-critical Findings, and the Issue's token usage in a collapsed block.
 */
function hostSections(findings: readonly Finding[], usage: IssueUsage): (string | undefined)[] {
  const fixed = findings.filter((f) => f.severity === "critical" && f.fixed).map((f) => f.description);
  const nonCritical = findings.filter((f) => f.severity === "non-critical").map((f) => f.description);
  return [
    list("Fixed during review", fixed),
    list("Non-critical Findings", nonCritical),
    `<details>\n<summary>Token usage</summary>\n\n${formatUsage(usage)}\n\n</details>`,
  ];
}

function join(sections: readonly (string | undefined)[]): string {
  return `${sections.filter((s) => s !== undefined && s !== "").join("\n\n")}\n`;
}

function list(heading: string, items: readonly string[]): string | undefined {
  if (items.length === 0) return undefined;
  return `## ${heading}\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

/** Keeps the end of `text`, where the last Gate commands' results are. Exported for the body writer's prompt. */
export function truncateStart(text: string, max: number = MAX_EVIDENCE_CHARS): string {
  if (text.length <= max) return text;
  return `[… ${(text.length - max).toLocaleString("en-US")} earlier characters cut; the full output is in the Gate log]\n${text.slice(-max)}`;
}

function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… ${(text.length - max).toLocaleString("en-US")} more characters cut]`;
}
