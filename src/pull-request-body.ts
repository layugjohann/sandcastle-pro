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
  /** The blocker a Stacked Issue is built on; undefined for an Issue based on the target branch. */
  stackedOn?: StackedOnBlocker;
}

/** The blocker a Stacked Issue's Pull Request is stacked on, named at the top of its body. */
export interface StackedOnBlocker {
  /** The blocker Issue's id, or undefined when no Issue file has the branch. */
  id: string | undefined;
  branch: string;
  /** The blocker's Pull Request URL, or undefined when it has none recorded. */
  pullRequest: string | undefined;
  /** The Run's target branch, which the blocker must reach first. */
  targetBranch: string;
}

/**
 * The sentence naming the blocker a Stacked Issue's Pull Request is stacked on, used by the Pull Request body and the
 * Issue's "Pull Request opened" comment alike. With `bold`, its "Stacked on" lead is bold.
 */
export function stackedOnText({ id, branch, pullRequest, targetBranch }: StackedOnBlocker, bold = false): string {
  const lead = `Stacked on ${id === undefined ? `\`${branch}\`` : `Issue ${id}`}`;
  const detail =
    pullRequest === undefined
      ? `this Pull Request targets \`${branch}\`. Merge \`${branch}\` into \`${targetBranch}\` first.`
      : `this Pull Request targets \`${branch}\`, the branch of ${pullRequest}. Merge that Pull Request first.`;
  return `${bold ? `**${lead}**` : lead}: ${detail}`;
}

/** The line a Stacked Issue's body starts with, so the human merges the chain in order. */
export function stackedOnLine(blocker: StackedOnBlocker): string {
  return `> ${stackedOnText(blocker, true)}`;
}

/**
 * The deterministic Pull Request body: for a Stacked Issue, a line naming its blocker; then Evidence (the passing Gate output), then the host's sections. It is the
 * fallback when the body writer wrote nothing; `note` then says why, at the top. Empty sections are left out.
 */
export function buildPullRequestBody({ gateOutput, findings, usage, stackedOn }: PullRequestBodyInput, note?: string): string {
  const evidence = gateOutput.trim();
  return join([
    stackedOn === undefined ? undefined : stackedOnLine(stackedOn),
    note === undefined ? undefined : `> **Note:** ${note}`,
    evidence ? `## Evidence\n\nThe Gate passed.\n\n${fenced(truncateStart(evidence, MAX_EVIDENCE_CHARS))}` : undefined,
    ...hostSections(findings, usage),
  ]);
}

/** For a Stacked Issue, a line naming its blocker; then the body writer's Summary, Evidence and Merge Danger, followed by the host's sections. */
export function buildWrittenPullRequestBody(written: string, { findings, usage, stackedOn }: PullRequestBodyInput): string {
  return join([
    stackedOn === undefined ? undefined : stackedOnLine(stackedOn),
    truncateEnd(written.trim(), MAX_WRITTEN_CHARS),
    ...hostSections(findings, usage),
  ]);
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
