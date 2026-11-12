/**
 * The Agent capability: the one seam of the Run Workflow.
 * Production uses the Sandcastle adapter; tests pass a scripted fake.
 */

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

export type Stage = "implementer" | "review-session";

export interface AgentCall {
  /** Which stage of the Run this call is. */
  stage: Stage;
  prompt: string;
  model: string;
  effort: Effort;
  /** The branch the agent commits to. It already exists when the agent is called. */
  branch: string;
  maxIterations: number;
  /** A session id to continue instead of starting fresh. */
  resumeSession?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type Severity = "critical" | "non-critical";

/** One problem identified during a Review Session. */
export interface Finding {
  severity: Severity;
  /** Whether the Review Session fixed it on the branch. */
  fixed: boolean;
  description: string;
}

/** The structured output of a Review Session. */
export interface Review {
  findings: Finding[];
  /** Places where the Review Session believes the Spec itself is wrong. Logged, never fixed. */
  specDisagreements: string[];
}

export type AgentResult =
  | { kind: "completed"; usage: TokenUsage; /** Present for a Review Session. */ review?: Review }
  | { kind: "limit-reached"; sessionId: string; usage: TokenUsage };

export interface Agent {
  run(call: AgentCall): Promise<AgentResult>;
}
