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
  /** The branch the Pull Request merges into: the Run's target branch, or the Base Issue's branch for a Stacked Issue. */
  base: string;
  title: string;
  body: string;
}

/** As `gh pr view --json state` reports it. */
export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

/** A Pull Request's state and the branch it merges (or was merged) into, as `gh pr view --json state,baseRefName` reports them. */
export interface PullRequestStatus {
  state: PullRequestState;
  /** The Pull Request's base branch. GitHub retargets it when its old base branch is deleted on merge. */
  base: string;
}

export interface Publisher {
  /** Pushes `branch` and opens a ready (not draft) Pull Request. Returns its URL; throws when either step fails. */
  publish(request: PullRequestRequest): Promise<{ url: string }>;
  /** Pushes `branch` to `origin` again, after the host committed more onto it. Throws when the push fails. */
  push(branch: string): Promise<void>;
  /** The Pull Request's state and base branch on GitHub. Throws when they can't be read. */
  state(url: string): Promise<PullRequestStatus>;
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

    async push(branch) {
      await run("git", ["push", "origin", branch], repoDir);
    },

    async state(url) {
      const stdout = await run("gh", ["pr", "view", url, "--json", "state,baseRefName"], repoDir);
      const { state, baseRefName } = JSON.parse(stdout) as { state?: unknown; baseRefName?: unknown };
      if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") {
        throw new Error(`gh pr view reported an unknown state: ${stdout.trim()}`);
      }
      if (typeof baseRefName !== "string" || baseRefName === "") {
        throw new Error(`gh pr view reported no base branch: ${stdout.trim()}`);
      }
      return { state, base: baseRefName };
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
