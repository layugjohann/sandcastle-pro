#!/usr/bin/env node
/** `npx sandcastle-pro <command>`. Only wires the modules together. */
import { parseArgs } from "node:util";
import { resolveAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createIssueStore } from "./issue-store.js";
import { runWorkflow } from "./run-workflow.js";
import { createSandcastleAgent } from "./sandcastle-agent.js";

const USAGE = `Usage: npx sandcastle-pro run [--count N]

  run    Work through the next ready Issue: Implementer, Review Session, then the Gate.
         --count N   process up to N Issues, one after another (default 1)
         At the usage limit the Issue is paused and the Run stops; the next run resumes it first.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
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
  const result = await runWorkflow({ repoDir, agent, config, store: createIssueStore(repoDir), count });
  return result.issues.some((r) => r.outcome === "gate-failed") ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
