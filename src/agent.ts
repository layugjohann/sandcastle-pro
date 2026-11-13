/**
 * The Agent capability: the one seam of the Run Workflow.
 * Production uses the Sandcastle adapter; tests pass a scripted fake.
 */

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

export type Stage = "implementer" | "review-session" | "body-writer";

/** The stages an Issue can be paused in. The body writer never pauses: its Issue is published with a fallback body. */
export type PausableStage = Exclude<Stage, "body-writer">;

/** Each stage's name as the human reads it, in Run order. */
export const STAGE_NAMES: Record<Stage, string> = {
  implementer: "Implementer",
  "review-session": "Review Session",
  "body-writer": "Body writer",
};

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

export const SEVERITIES = ["critical", "non-critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

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

/** `usage` is absent when the Agent could not report it; the Run carries on and shows it as unknown. */
export type AgentResult =
  | {
      kind: "completed";
      usage?: TokenUsage;
      /** Present for a Review Session. */
      review?: Review;
      /** Present for the body writer: the Pull Request body it wrote. */
      body?: string;
    }
  | { kind: "limit-reached"; sessionId: string; usage?: TokenUsage };

export interface Agent {
  run(call: AgentCall): Promise<AgentResult>;
}

/**
 * Thrown by an Agent whose call failed for a reason other than the usage limit.
 * `sessionId` is set only when that session can be resumed.
 */
export class AgentCallError extends Error {
  constructor(
    message: string,
    readonly sessionId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentCallError";
  }
}
