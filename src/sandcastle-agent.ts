/**
 * The production Agent: maps an Agent call onto Sandcastle's `run()`.
 * Kept thin on purpose. Only `resultUsage` has automated tests; the rest is checked by hand with one real Run.
 *
 * The usage limit: Sandcastle fails a call on any error Claude reports, and then neither captures the
 * session to the host nor keeps it resumable. So when Claude reports the usage limit, the adapter turns
 * that error into the completion signal: Sandcastle ends the call as a success, captures the session and
 * preserves a dirty worktree, and the adapter returns limit-reached for the Run Workflow to pause on.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { claudeCode, run, type AgentProvider, type SandboxProvider } from "@ai-hero/sandcastle";
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
          sandbox: await sandboxProvider(sandbox, repoDir),
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
      // One result line per iteration; a missing one would make the total too low, so it is reported as unknown.
      const usage = watch.results.length === result.iterations.length ? sumUsage(watch.results) : undefined;
      if (watch.limitHit) {
        const sessionId = session();
        // The body writer is never resumed, so it needs no session to report the limit.
        if (call.stage === "body-writer") return { kind: "limit-reached", sessionId: sessionId ?? "", usage };
        if (!sessionId) throw new AgentCallError(`Claude hit the usage limit in the ${call.stage} but reported no session to resume.`);
        return { kind: "limit-reached", sessionId, usage };
      }
      if (call.stage === "implementer") return { kind: "completed", usage };
      if (call.stage === "body-writer") return { kind: "completed", usage, body: parseBody(result.stdout) };
      return { kind: "completed", usage, review: parseReview(result.stdout) };
    },
  };
}

interface StreamWatch {
  provider: AgentProvider;
  /** The last session id Claude reported in this call. */
  sessionId?: string;
  limitHit: boolean;
  /** The session total from each result line Claude printed: one per iteration. */
  results: TokenUsage[];
}

/**
 * Wraps the provider's stream parser for one call: remembers the session id, and turns a usage-limit
 * error into the completion signal so Sandcastle ends the call cleanly. Other errors pass through.
 */
function watchStream(provider: AgentProvider): StreamWatch {
  const watch: StreamWatch = {
    limitHit: false,
    results: [],
    provider: {
      ...provider,
      parseStreamLine(line) {
        const usage = resultUsage(line);
        if (usage) watch.results.push(usage);
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
 * Claude Code keeps its temp files in `/tmp/claude-<uid>`, which the native sandbox can't write to, and on macOS
 * a bare `mktemp` ignores `TMPDIR` and uses the per-user temp dir, which Seatbelt also blocks.
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
        `tmp="\${TMPDIR:-/tmp}"; out=$(mktemp "$tmp/sandcastle-out.XXXXXX") && code_file=$(mktemp "$tmp/sandcastle-code.XXXXXX") || exit 1`,
        `{ CLAUDE_CODE_TMPDIR="$TMPDIR" ${built.command}; echo $? > "$code_file"; } | tee "$out"`,
        `code=$(cat "$code_file"); code=\${code:-1}`,
        // Claude does not print `type` first in its result line, so both keys are matched anywhere on the line.
        `if [ "$code" -ne 0 ] && grep '"type":"result"' "$out" | grep -q '"is_error":true'; then code=0; fi`,
        `rm -f "$out" "$code_file"`,
        `exit "$code"`,
      ].join("\n");
      return { ...built, command };
    },
  };
}

/**
 * Files at the repo root that a toolchain reads when it walks up from the worktree looking for a project or
 * workspace root. Sandcastle puts worktrees under `<repo>/.sandcastle/worktrees/`, so that walk reaches the main
 * checkout, which the native sandbox otherwise denies: `uv run` then fails on the repo's `pyproject.toml`.
 */
const PARENT_PROJECT_FILES = ["pyproject.toml", "uv.toml"];

/**
 * The native sandbox for this OS, or Docker. Imported lazily so only the chosen provider loads.
 * A native sandbox can read the repo root's project files that exist; Sandcastle rejects a mount that doesn't.
 */
async function sandboxProvider(choice: SandboxChoice, repoDir: string): Promise<SandboxProvider> {
  if (choice === "docker") return (await import("@ai-hero/sandcastle/sandboxes/docker")).docker();
  const mounts = PARENT_PROJECT_FILES.map((file) => join(repoDir, file))
    .filter((path) => existsSync(path))
    .map((path) => ({ hostPath: path, sandboxPath: path, readonly: true }));
  if (process.platform === "darwin") return (await import("@ai-hero/sandcastle/sandboxes/seatbelt")).seatbelt({ mounts });
  if (process.platform === "linux") return (await import("@ai-hero/sandcastle/sandboxes/bwrap")).bwrap({ mounts });
  throw new Error(`No native sandbox for ${process.platform}. Set "sandbox": "docker" in ${CONFIG_FILE}.`);
}

/**
 * The session's total usage from a Claude `result` stream line, or undefined for any other line.
 * Not Sandcastle's `IterationUsage`: that is the last assistant message's usage, one API call out of many.
 */
export function resultUsage(line: string): TokenUsage | undefined {
  // Claude does not print `type` first, so the line is matched on its parsed type.
  if (!line.startsWith("{") || !line.includes('"type":"result"')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || parsed.type !== "result" || !isObject(parsed.usage)) return undefined;
  const u = parsed.usage;
  const count = (value: unknown) => (typeof value === "number" ? value : undefined);
  const input = count(u.input_tokens);
  const output = count(u.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: count(u.cache_creation_input_tokens),
    cacheReadTokens: count(u.cache_read_input_tokens),
  };
}

/** The total across iterations, or undefined when there were none. */
function sumUsage(iterations: readonly TokenUsage[]): TokenUsage | undefined {
  if (iterations.length === 0) return undefined;
  const total = (pick: (u: TokenUsage) => number | undefined) => {
    const values = iterations.map(pick);
    return values.every((v) => v !== undefined) ? values.reduce((sum, v) => sum + v, 0) : undefined;
  };
  return {
    inputTokens: total((u) => u.inputTokens) ?? 0,
    outputTokens: total((u) => u.outputTokens) ?? 0,
    cacheCreationTokens: total((u) => u.cacheCreationTokens),
    cacheReadTokens: total((u) => u.cacheReadTokens),
  };
}

/**
 * The last fenced `json` block of the Review Session's output, as the review prompt asks for.
 * Undefined when it is missing or malformed, which the Run Workflow treats as a failed review.
 */
function parseReview(stdout: string): Review | undefined {
  const raw = lastJsonBlock(stdout);
  if (!raw) return undefined;
  const { findings, specDisagreements } = raw;
  if (!Array.isArray(findings) || !findings.every(isFinding)) return undefined;
  if (!Array.isArray(specDisagreements) || !specDisagreements.every((d) => typeof d === "string")) return undefined;
  return { findings, specDisagreements };
}

/**
 * The body writer's Pull Request body, from the last fenced `json` block of its output.
 * Undefined when it is missing or malformed, which the Run Workflow answers with the deterministic body.
 */
function parseBody(stdout: string): string | undefined {
  const body = lastJsonBlock(stdout)?.body;
  return typeof body === "string" && body.trim() !== "" ? body : undefined;
}

/**
 * The last fenced `json` block holding a JSON object. A JSON string can't hold a raw newline,
 * so a fence inside one, as in a body with a diagram, can't end the block early.
 */
function lastJsonBlock(stdout: string): Record<string, unknown> | undefined {
  const blocks = [...stdout.matchAll(/(`{3,})json[ \t]*\n([\s\S]*?)\n\1/g)];
  const last = blocks.at(-1)?.[2];
  if (last === undefined) return undefined;
  try {
    const raw: unknown = JSON.parse(last);
    return isObject(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function isFinding(value: unknown): value is Finding {
  if (!isObject(value)) return false;
  const { severity, fixed, description } = value;
  return SEVERITIES.includes(severity as Severity) && typeof fixed === "boolean" && typeof description === "string";
}
