/**
 * The production Agent: maps an Agent call onto Sandcastle's `run()`.
 * Kept thin on purpose. It has no automated tests and is checked by hand with one real Run.
 *
 * The usage limit: Sandcastle fails a call on any error Claude reports, and then neither captures the
 * session to the host nor keeps it resumable. So when Claude reports the usage limit, the adapter turns
 * that error into the completion signal: Sandcastle ends the call as a success, captures the session and
 * preserves a dirty worktree, and the adapter returns limit-reached for the Run Workflow to pause on.
 */
import { claudeCode, run, type AgentProvider, type IterationUsage, type SandboxProvider } from "@ai-hero/sandcastle";
import { AgentCallError, SEVERITIES, type Agent, type AgentCall, type AgentResult, type Finding, type Review, type Severity, type TokenUsage } from "./agent.js";
import type { Auth } from "./auth.js";
import { CONFIG_FILE, isObject, type SandboxChoice } from "./config.js";

/** Sandcastle's default completion signal: the agent prints it to end the iteration loop early. */
const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

export interface SandcastleAgentOptions {
  repoDir: string;
  sandbox: SandboxChoice;
  auth: Auth;
}

/** Whether an error Claude reported is the usage limit rather than some other failure. */
export function isUsageLimitMessage(message: string): boolean {
  return /usage limit|limit reached|hit your (usage )?limit/i.test(message);
}

export function createSandcastleAgent({ repoDir, sandbox, auth }: SandcastleAgentOptions): Agent {
  return {
    async run(call: AgentCall): Promise<AgentResult> {
      const provider = claudeCode(call.model, { effort: call.effort, env: auth.env });
      const watch = watchStream(sandboxedClaudeCode(provider));
      // Read after run(): Claude reports the session id during the call.
      const session = () => watch.sessionId ?? call.resumeSession;
      let result;
      try {
        result = await run({
          cwd: repoDir,
          name: call.stage,
          agent: watch.provider,
          sandbox: await sandboxProvider(sandbox),
          prompt: `${call.prompt}\nWhen the work is finished, print ${COMPLETION_SIGNAL} on its own line.\n`,
          // Sandcastle resumes a session for exactly one iteration.
          maxIterations: call.resumeSession ? 1 : call.maxIterations,
          resumeSession: call.resumeSession,
          completionSignal: COMPLETION_SIGNAL,
          // The Run Workflow has already created the Issue's branch.
          branchStrategy: { type: "branch", branch: call.branch },
          logging: { type: "stdout" },
        });
      } catch (error) {
        // Resumable only if Sandcastle captured the session to the host before failing.
        const sessionId = session();
        const resumable = sessionId !== undefined && (await provider.sessionStorage?.existsOnHost(repoDir, sessionId));
        const message = error instanceof Error ? error.message : String(error);
        throw new AgentCallError(message, resumable ? sessionId : undefined, { cause: error });
      }
      const usage = sumUsage(result.iterations.map((i) => i.usage));
      if (watch.limitHit) {
        const sessionId = session();
        if (!sessionId) throw new AgentCallError(`Claude hit the usage limit in the ${call.stage} but reported no session to resume.`);
        return { kind: "limit-reached", sessionId, usage };
      }
      if (call.stage === "implementer") return { kind: "completed", usage };
      return { kind: "completed", usage, review: parseReview(result.stdout) };
    },
  };
}

interface StreamWatch {
  provider: AgentProvider;
  /** The last session id Claude reported in this call. */
  sessionId?: string;
  limitHit: boolean;
}

/**
 * Wraps the provider's stream parser for one call: remembers the session id, and turns a usage-limit
 * error into the completion signal so Sandcastle ends the call cleanly. Other errors pass through.
 */
function watchStream(provider: AgentProvider): StreamWatch {
  const watch: StreamWatch = {
    limitHit: false,
    provider: {
      ...provider,
      parseStreamLine(line) {
        return provider.parseStreamLine(line).map((event) => {
          if (event.type === "session_id") watch.sessionId = event.sessionId;
          if (event.type !== "error" || !isUsageLimitMessage(event.message)) return event;
          watch.limitHit = true;
          return { type: "text", text: `\n${COMPLETION_SIGNAL}\n` };
        });
      },
    },
  };
  return watch;
}

/**
 * Claude Code keeps its temp files in `/tmp/claude-<uid>`, which the native sandbox can't write to.
 * Point it at the sandbox's own private `TMPDIR` instead; the shell expands it inside the sandbox.
 *
 * Claude also exits non-zero after reporting an error in its stream, and Sandcastle fails on the exit code
 * before looking at the stream. So a non-zero exit becomes 0 only when Claude reported the error in its result line;
 * Sandcastle still fails on that error unless `watchStream` finds it is the usage limit.
 */
function sandboxedClaudeCode(provider: AgentProvider): AgentProvider {
  return {
    ...provider,
    buildPrintCommand(options) {
      const built = provider.buildPrintCommand(options);
      const command = [
        `out=$(mktemp) && code_file=$(mktemp) || exit 1`,
        `{ CLAUDE_CODE_TMPDIR="$TMPDIR" ${built.command}; echo $? > "$code_file"; } | tee "$out"`,
        `code=$(cat "$code_file"); code=\${code:-1}`,
        `if [ "$code" -ne 0 ] && grep -q '^{"type":"result".*"is_error":true' "$out"; then code=0; fi`,
        `rm -f "$out" "$code_file"`,
        `exit "$code"`,
      ].join("\n");
      return { ...built, command };
    },
  };
}

/** The native sandbox for this OS, or Docker. Imported lazily so only the chosen provider loads. */
async function sandboxProvider(choice: SandboxChoice): Promise<SandboxProvider> {
  if (choice === "docker") return (await import("@ai-hero/sandcastle/sandboxes/docker")).docker();
  if (process.platform === "darwin") return (await import("@ai-hero/sandcastle/sandboxes/seatbelt")).seatbelt();
  if (process.platform === "linux") return (await import("@ai-hero/sandcastle/sandboxes/bwrap")).bwrap();
  throw new Error(`No native sandbox for ${process.platform}. Set "sandbox": "docker" in ${CONFIG_FILE}.`);
}

/** The total across iterations, or undefined when no iteration reported usage. */
function sumUsage(iterations: readonly (IterationUsage | undefined)[]): TokenUsage | undefined {
  const reported = iterations.filter((u): u is IterationUsage => u !== undefined);
  if (reported.length === 0) return undefined;
  const total = (pick: (u: IterationUsage) => number) => reported.reduce((sum, u) => sum + pick(u), 0);
  return {
    inputTokens: total((u) => u.inputTokens),
    outputTokens: total((u) => u.outputTokens),
    cacheReadTokens: total((u) => u.cacheReadInputTokens),
    cacheCreationTokens: total((u) => u.cacheCreationInputTokens),
  };
}

/**
 * The last fenced `json` block of the Review Session's output, as the review prompt asks for.
 * Undefined when it is missing or malformed, which the Run Workflow treats as a failed review.
 */
function parseReview(stdout: string): Review | undefined {
  const blocks = [...stdout.matchAll(/(`{3,})json[ \t]*\n([\s\S]*?)\n\1/g)];
  const last = blocks.at(-1)?.[2];
  if (last === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(last);
  } catch {
    return undefined;
  }
  if (!isObject(raw)) return undefined;
  const { findings, specDisagreements } = raw;
  if (!Array.isArray(findings) || !findings.every(isFinding)) return undefined;
  if (!Array.isArray(specDisagreements) || !specDisagreements.every((d) => typeof d === "string")) return undefined;
  return { findings, specDisagreements };
}

function isFinding(value: unknown): value is Finding {
  if (!isObject(value)) return false;
  const { severity, fixed, description } = value;
  return SEVERITIES.includes(severity as Severity) && typeof fixed === "boolean" && typeof description === "string";
}
