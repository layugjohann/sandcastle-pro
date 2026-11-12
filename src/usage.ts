import { STAGE_NAMES, type Stage, type TokenUsage } from "./agent.js";

/**
 * The tokens each stage of one Issue used in one Run. A stage is absent when the Run did not call it,
 * as when a resumed Issue starts at the Review Session, and undefined when the Agent reported no usage.
 */
export type IssueUsage = Partial<Record<Stage, TokenUsage | undefined>>;

/** One line: each called stage's input, output, cache creation and cache read tokens, "unknown" where not reported. */
export function formatUsage(usage: IssueUsage): string {
  const called = (Object.keys(STAGE_NAMES) as Stage[]).filter((stage) => stage in usage);
  const stages = called.map((stage) => `${STAGE_NAMES[stage]} ${formatStage(usage[stage])}`);
  return `Usage: ${stages.join("; ")}.`;
}

function formatStage(usage: TokenUsage | undefined): string {
  if (!usage) return "unknown";
  return [
    `${formatTokens(usage.inputTokens)} input`,
    `${formatTokens(usage.outputTokens)} output`,
    `${formatTokens(usage.cacheCreationTokens)} cache creation`,
    `${formatTokens(usage.cacheReadTokens)} cache read`,
  ].join(", ");
}

function formatTokens(tokens: number | undefined): string {
  return tokens === undefined ? "unknown" : tokens.toLocaleString("en-US");
}
