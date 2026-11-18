#!/usr/bin/env node
/** `npx sandcastle-pro <command>`. Only wires the modules together. */
import { parseArgs } from "node:util";
import { resolveAuth } from "./auth.js";
import { loadConfig, SANDBOXES, type SandboxChoice } from "./config.js";
import { initProject } from "./init.js";
import { runWorkflow } from "./run-workflow.js";
import { createSandcastleAgent } from "./sandcastle-agent.js";
import { withTerminalPrompt } from "./terminal-prompt.js";

const USAGE = `Usage: npx sandcastle-pro init [--gate CMD ...] [--sandbox native|docker] [--non-interactive]
       npx sandcastle-pro run [--count N]

  init   Make this project ready for Runs. Never overwrites an existing file.
         Detects Gate commands from package scripts, Python project config and Makefile targets,
         and asks you to confirm or edit them. When origin is on GitHub and gh is logged in,
         offers to publish each Issue that passes the Gate as a Pull Request.
         --gate CMD          a Gate command instead of the detected ones; repeat for each, in the order they run
         --non-interactive   never ask: use the detected Gate commands (also the default without a terminal)
         --sandbox native    Seatbelt on macOS, bubblewrap on Linux (the default there)
         --sandbox docker    Docker, for stronger isolation (the default on other OSes)

  run    Work through the next ready Issue: Implementer, Review Session, then the Gate.
         --count N   process up to N Issues, one after another (default 1)
         At the usage limit the Issue is paused and the Run stops; the next run resumes it first.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "init") return init(rest);
  if (command !== "run") {
    console.error(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE);
    return 2;
  }
  const { values } = parseArgs({ args: rest, options: { count: { type: "string" } } });
  const count = values.count === undefined ? 1 : Number(values.count);
  if (!Number.isInteger(count) || count < 1) {
    console.error(`--count must be a positive whole number, got ${JSON.stringify(values.count)}.`);
    return 2;
  }

  const repoDir = process.cwd();
  const config = await loadConfig(repoDir);
  // Checked before any Issue changes status, so a missing token never leaves an Issue in-progress.
  const auth = resolveAuth(repoDir);
  const agent = createSandcastleAgent({ repoDir, sandbox: config.sandbox, auth });
  const result = await runWorkflow({ repoDir, agent, config, count });
  return result.issues.some((r) => r.outcome === "gate-failed" || r.outcome === "critical-unfixed" || r.outcome === "base-missing" || r.outcome === "base-moved") ? 1 : 0;
}

async function init(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { gate: { type: "string", multiple: true }, sandbox: { type: "string" }, "non-interactive": { type: "boolean" } },
  });
  if (values.sandbox !== undefined && !SANDBOXES.includes(values.sandbox as SandboxChoice)) {
    console.error(`--sandbox must be one of ${SANDBOXES.join(", ")}, got ${JSON.stringify(values.sandbox)}.`);
    return 2;
  }
  const options = { repoDir: process.cwd(), gate: values.gate, sandbox: values.sandbox as SandboxChoice | undefined };
  const interactive = !values["non-interactive"] && process.stdin.isTTY === true;
  await (interactive ? withTerminalPrompt((ask) => initProject({ ...options, ask })) : initProject(options));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
