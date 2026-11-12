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
  /** The model from the Issue's `Model:` line, overriding the configured default for this Issue only. */
  model: string | undefined;
}

export interface BlockedIssue {
  id: string;
  /** Its `Blocked by:` entries that are not `done`, as written in the Issue. */
  blockers: string[];
}

export interface IssueStore {
  /** The next Issue a Run should work on, or null when none is ready. */
  next(): Promise<Issue | null>;
  /** The `ready-for-agent` Issues that `next()` skips because a blocker is not `done`. */
  blocked(): Promise<BlockedIssue[]>;
  /** Every Issue in `awaiting-merge`, whose branch the human may have merged. */
  awaitingMerge(): Promise<Issue[]>;
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

/**
 * The blockers on the `Blocked by:` line, as written: an Issue number, or text naming no number.
 * A missing line or `None` means unblocked; a blocker the Run can't read stays unfinished.
 */
function parseBlockedBy(text: string): string[] {
  const value = /^Blocked by:[ \t]*(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  if (value === "" || /^none\b/i.test(value)) return [];
  return value
    .split(/,|\band\b/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => /\d+/.exec(part)?.[0] ?? part);
}

/** The value of the `Model:` line, without backticks, or undefined when the line is missing or empty. */
function parseModel(text: string): string | undefined {
  const value = /^Model:[ \t]*(.*)$/m.exec(text)?.[1]?.replace(/`/g, "").trim();
  return value || undefined;
}

interface IssueFile {
  id: string;
  number: number;
  path: string;
  text: string;
  status: Status | undefined;
  blockedBy: string[];
}

/** `file`'s blockers that are not `done`. Blockers resolve within the same issues directory. */
function unfinishedBlockers(file: IssueFile, all: readonly IssueFile[]): string[] {
  const isDone = (blocker: string) =>
    all.some((f) => f.number === Number(blocker) && dirname(f.path) === dirname(file.path) && f.status === "done");
  return file.blockedBy.filter((blocker) => !isDone(blocker));
}

/** An Issue Store over `.scratch/<feature>/issues/NN-slug.md` files. */
export function createIssueStore(repoDir: string): IssueStore {
  const scratch = join(repoDir, ".scratch");

  async function listIssueFiles(): Promise<{ id: string; number: number; path: string }[]> {
    if (!existsSync(scratch)) return [];
    const found: { id: string; number: number; path: string }[] = [];
    for (const feature of await readdir(scratch, { withFileTypes: true })) {
      if (!feature.isDirectory()) continue;
      const issuesDir = join(scratch, feature.name, "issues");
      if (!existsSync(issuesDir)) continue;
      for (const name of await readdir(issuesDir)) {
        const match = ISSUE_FILE.exec(name);
        if (!match) continue;
        found.push({ id: match[1]!, number: Number(match[1]), path: join(issuesDir, name) });
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

  async function readIssues(): Promise<IssueFile[]> {
    const files = [];
    for (const file of await listIssueFiles()) {
      const text = await readFile(file.path, "utf8");
      files.push({ ...file, text, status: parseStatus(text), blockedBy: parseBlockedBy(text) });
    }
    return files;
  }

  async function toIssue(file: IssueFile): Promise<Issue> {
    return {
      id: file.id,
      branch: `issue/${basename(file.path, ".md")}`,
      text: file.text,
      spec: await readSpec(file.path, file.text),
      path: file.path,
      model: parseModel(file.text),
    };
  }

  return {
    async next() {
      const files = await readIssues();
      const ready = files.find((f) => f.status === "ready-for-agent" && unfinishedBlockers(f, files).length === 0);
      return ready ? toIssue(ready) : null;
    },

    async blocked() {
      const files = await readIssues();
      return files
        .filter((f) => f.status === "ready-for-agent")
        .map((f) => ({ id: f.id, blockers: unfinishedBlockers(f, files) }))
        .filter((b) => b.blockers.length > 0);
    },

    async awaitingMerge() {
      const files = (await readIssues()).filter((f) => f.status === "awaiting-merge");
      return Promise.all(files.map(toIssue));
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
