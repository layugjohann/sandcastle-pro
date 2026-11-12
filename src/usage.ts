import type { Stage, TokenUsage } from "./agent.js";

/** The tokens each stage of one Issue used. A stage is absent when the Agent reported no usage for it. */
export type IssueUsage = Partial<Record<Stage, TokenUsage>>;

const STAGE_NAMES: Record<Stage, string> = { implementer: "Implementer", "review-session": "Review Session" };

/** One line: each stage's input, output, cache creation and cache read tokens, "unknown" where not reported. */
export function formatUsage(usage: IssueUsage): string {
  const stages = (Object.keys(STAGE_NAMES) as Stage[]).map((stage) => `${STAGE_NAMES[stage]} ${formatStage(usage[stage])}`);
  return `Usage: ${stages.join("; ")}.`;
}

function formatStage(usage: TokenUsage | undefined): string {
  if (!usage) return "unknown";
  return [
    `${count(usage.inputTokens)} input`,
    `${count(usage.outputTokens)} output`,
    `${count(usage.cacheCreationTokens)} cache creation`,
    `${count(usage.cacheReadTokens)} cache read`,
  ].join(", ");
}

function count(tokens: number | undefined): string {
  return tokens === undefined ? "unknown" : tokens.toLocaleString("en-US");
}
