import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const STATUSES = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
  "in-progress",
  "paused",
  "awaiting-merge",
  "done",
] as const;

export type Status = (typeof STATUSES)[number];

export interface Issue {
  /** The number prefix as written in the file name, e.g. "01". */
  id: string;
  /** The Issue's own branch, `issue/NN-slug`. */
  branch: string;
  /** The Issue file's full text when it was read. */
  text: string;
  /** The Spec's text, or undefined when the Issue has no Spec. */
  spec: string | undefined;
  /** Absolute path of the Issue file. */
  path: string;
}

export interface IssueStore {
  /** The next Issue a Run should work on, or null when none is ready. */
  next(): Promise<Issue | null>;
  transition(issue: Issue, status: Status): Promise<void>;
  /** Appends text under the Issue's `## Comments` heading, creating it if needed. */
  comment(issue: Issue, text: string): Promise<void>;
}

const ISSUE_FILE = /^(\d+)-(.+)\.md$/;
const STATUS_LINE = /^Status:[ \t]*(\S*).*$/m;

function parseStatus(text: string): Status | undefined {
  const value = STATUS_LINE.exec(text)?.[1];
  return STATUSES.find((s) => s === value);
}

/** An Issue Store over `.scratch/<feature>/issues/NN-slug.md` files. */
export function createIssueStore(repoDir: string): IssueStore {
  const scratch = join(repoDir, ".scratch");

  async function listIssueFiles(): Promise<{ id: string; number: number; slug: string; path: string }[]> {
    if (!existsSync(scratch)) return [];
    const found = [];
    for (const feature of await readdir(scratch, { withFileTypes: true })) {
      if (!feature.isDirectory()) continue;
      const issuesDir = join(scratch, feature.name, "issues");
      if (!existsSync(issuesDir)) continue;
      for (const name of await readdir(issuesDir)) {
        const match = ISSUE_FILE.exec(name);
        if (!match) continue;
        found.push({ id: match[1]!, number: Number(match[1]), slug: match[2]!, path: join(issuesDir, name) });
      }
    }
    return found.sort((a, b) => a.number - b.number || a.path.localeCompare(b.path));
  }

  async function readSpec(issuePath: string, text: string): Promise<string | undefined> {
    const declared = /^Spec:[ \t]*`?([^`\s]+)`?/m.exec(text)?.[1];
    const candidates = declared
      ? [join(repoDir, declared)]
      : [join(dirname(dirname(issuePath)), "spec.md")];
    for (const path of candidates) {
      if (existsSync(path)) return readFile(path, "utf8");
    }
    return undefined;
  }

  return {
    async next() {
      for (const file of await listIssueFiles()) {
        const text = await readFile(file.path, "utf8");
        if (parseStatus(text) !== "ready-for-agent") continue;
        return {
          id: file.id,
          branch: `issue/${basename(file.path, ".md")}`,
          text,
          spec: await readSpec(file.path, text),
          path: file.path,
        };
      }
      return null;
    },

    async transition(issue, status) {
      const text = await readFile(issue.path, "utf8");
      const updated = STATUS_LINE.test(text)
        ? text.replace(STATUS_LINE, `Status: ${status}`)
        : insertAfterTitle(text, `Status: ${status}`);
      await writeFile(issue.path, updated);
    },

    async comment(issue, comment) {
      let text = (await readFile(issue.path, "utf8")).replace(/\s*$/, "\n");
      if (!/^## Comments[ \t]*$/m.test(text)) text += "\n## Comments\n";
      await writeFile(issue.path, `${text}\n${comment.trim()}\n`);
    },
  };
}

function insertAfterTitle(text: string, line: string): string {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((l) => l.startsWith("# "));
  lines.splice(titleIndex + 1, 0, "", line);
  return lines.join("\n");
}
