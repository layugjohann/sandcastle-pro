/**
 * Publishing an Issue as a Pull Request, and asking GitHub whether one was merged.
 * The host does both, never the sandbox. Production uses `git` and `gh`; tests pass a fake.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface PullRequestRequest {
  /** The Issue's branch, pushed to `origin` and used as the head. */
  branch: string;
  /** The Run's target branch. */
  base: string;
  title: string;
  body: string;
}

/** As `gh pr view --json state` reports it. */
export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

export interface Publisher {
  /** Pushes `branch` and opens a ready (not draft) Pull Request. Returns its URL; throws when either step fails. */
  publish(request: PullRequestRequest): Promise<{ url: string }>;
  /** The Pull Request's state on GitHub. Throws when it can't be read. */
  state(url: string): Promise<PullRequestState>;
}

/** The production Publisher: `git push -u origin <branch>`, then `gh pr create` with the body in a file. */
export function createGitHubPublisher(repoDir: string): Publisher {
  return {
    async publish({ branch, base, title, body }) {
      await run("git", ["push", "-u", "origin", branch], repoDir);
      const dir = await mkdtemp(join(tmpdir(), "sandcastle-pro-pr-"));
      try {
        const bodyFile = join(dir, "body.md");
        await writeFile(bodyFile, body);
        const stdout = await run(
          "gh",
          ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile],
          repoDir,
        );
        // gh prints progress first and the Pull Request's URL last.
        const url = stdout.trim().split("\n").reverse().find((line) => /^https?:\/\//.test(line.trim()))?.trim();
        if (!url) throw new Error(`gh pr create printed no Pull Request URL:\n${stdout}`);
        return { url };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async state(url) {
      const stdout = await run("gh", ["pr", "view", url, "--json", "state"], repoDir);
      const state = (JSON.parse(stdout) as { state?: unknown }).state;
      if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") {
        throw new Error(`gh pr view reported an unknown state: ${stdout.trim()}`);
      }
      return state;
    },
  };
}

/** Runs a command, returning stdout, or throwing an error that carries its stderr. */
async function run(command: string, args: string[], cwd: string): Promise<string> {
  try {
    return (await exec(command, args, { cwd })).stdout;
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : (error as Error).message;
    throw new Error(`\`${command} ${args.slice(0, 2).join(" ")}\` failed: ${detail}`, { cause: error });
  }
}
