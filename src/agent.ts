/**
 * The Agent capability: the one seam of the Run Workflow.
 * Production uses the Sandcastle adapter; tests pass a scripted fake.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentCall {
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

export type AgentResult =
  | { kind: "completed"; usage: TokenUsage }
  | { kind: "limit-reached"; sessionId: string; usage: TokenUsage };

export interface Agent {
  run(call: AgentCall): Promise<AgentResult>;
}
