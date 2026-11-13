import { spawn } from "node:child_process";
import { delimiter } from "node:path";

/** `output` is the full transcript: each command, what it printed and its exit code, up to the first failure. */
export type GateResult = { passed: boolean; output: string };

/** Runs the Gate commands in order in `cwd`, stopping at the first failure. */
export async function runGate(commands: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<GateResult> {
  const gateEnv = withoutNpmExecPath(env);
  let output = "";
  for (const command of commands) {
    const { code, text } = await runShell(command, cwd, gateEnv);
    output += `$ ${command}\n${text}${text === "" || text.endsWith("\n") ? "" : "\n"}(exit code ${code})\n`;
    if (code !== 0) return { passed: false, output };
  }
  return { passed: true, output };
}

/**
 * `npx sandcastle-pro` (npm exec) prepends every `node_modules/.bin` from the main checkout up to `/`, and npm's
 * own `node-gyp-bin`. Left in, a Gate command could pass on a tool installed only in the main checkout, never on the
 * Issue's branch, and pass where it fails in the human's own shell. So the Gate gets the PATH npm started from.
 */
export function withoutNpmExecPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.npm_command === undefined || env.PATH === undefined) return env;
  const added = (dir: string) => /[\\/]node_modules[\\/]\.bin[\\/]?$/.test(dir) || /[\\/]node-gyp-bin[\\/]?$/.test(dir);
  return { ...env, PATH: env.PATH.split(delimiter).filter((dir) => !added(dir)).join(delimiter) };
}

function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, text }));
  });
}
