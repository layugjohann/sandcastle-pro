import { createInterface } from "node:readline";

/**
 * Opens a prompt on the terminal for `use`, and closes it afterwards. `ask` rejects when the user closes
 * input (Ctrl-D, Ctrl-C) instead of answering.
 */
export async function withTerminalPrompt<T>(use: (ask: (question: string) => Promise<string>) => Promise<T>): Promise<T> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  terminal.once("close", () => (closed = true));
  const cancelled = () => new Error("init cancelled: nothing was written.");
  const ask = (question: string) =>
    new Promise<string>((resolve, reject) => {
      if (closed) return reject(cancelled());
      const onClose = () => reject(cancelled());
      terminal.once("close", onClose);
      terminal.question(question, (answer) => {
        terminal.off("close", onClose);
        resolve(answer);
      });
    });
  try {
    return await use(ask);
  } finally {
    terminal.close();
  }
}
