import { spawn } from "node:child_process";

export type GateResult = { passed: true } | { passed: false; output: string };

/** Runs the Gate commands in order in `cwd`, stopping at the first failure. */
export async function runGate(commands: readonly string[], cwd: string): Promise<GateResult> {
  let output = "";
  for (const command of commands) {
    const { code, text } = await runShell(command, cwd);
    output += `$ ${command}\n${text}`;
    if (code !== 0) return { passed: false, output: `${output}(exit code ${code})\n` };
  }
  return { passed: true };
}

function runShell(command: string, cwd: string): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, text }));
  });
}
