import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import {
  AgentCallError,
  DEFAULT_CONFIG,
  type Agent,
  type AgentCall,
  type AgentResult,
  type Config,
  type Publisher,
  type PullRequestRequest,
  type PullRequestState,
  type Review,
  type Stage,
  type TokenUsage,
} from "../src/index.js";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Writes `content` to `path` under `root`, creating parent directories. */
export function writeFile(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/**
 * Points `HOME` at a fresh temp directory, and unsets `XDG_CONFIG_HOME`, around each test, so the Personal
 * Coding Standards layer never comes from the real user. Call at the top of a test file.
 */
export function useTempHome(): { readonly dir: string } {
  const original = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  const home = { dir: "" };
  beforeEach(() => {
    home.dir = mkdtempSync(join(tmpdir(), "sandcastle-pro-home-"));
    process.env.HOME = home.dir;
    // A real XDG_CONFIG_HOME would point the Personal layer outside the temp home.
    delete process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home.dir, { recursive: true, force: true });
  });
  return home;
}

export interface TempRepo {
  dir: string;
  write(path: string, content: string): void;
  read(path: string): string;
  commitAll(message: string): void;
  cleanup(): void;
}

/** A real git repo on `main` in a temp directory, with one initial commit. */
export function createTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "sandcastle-pro-test-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  const repo: TempRepo = {
    dir,
    write: (path, content) => writeFile(dir, path, content),
    read: (path) => readFileSync(join(dir, path), "utf8"),
    commitAll(message) {
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", message);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  repo.write("README.md", "# test project\n");
  repo.commitAll("initial");
  return repo;
}

export function issueFile(opts: { title: string; status?: string; extra?: string }): string {
  const lines = [`# ${opts.title}`, ""];
  if (opts.status) lines.push(`Status: ${opts.status}`);
  lines.push("", "Spec: `.scratch/feature/spec.md`", "", opts.extra ?? "Do the thing.", "");
  return lines.join("\n");
}

export interface FakeAgent extends Agent {
  calls: AgentCall[];
}

export interface ReviewScript {
  /** Files the Review Session commits, e.g. to fix a Critical Finding. None by default. */
  files?: Record<string, string>;
  review?: Partial<Review>;
  /** Complete without any structured Findings, as when the output can't be read. */
  noFindings?: boolean;
}

/**
 * A scripted Agent that stands in for Sandcastle. Each call checks out the
 * requested branch in its own worktree and commits the scripted files there.
 * The Implementer commits `files`; the Review Session follows `review`.
 */
export function fakeAgent(
  repoDir: string,
  opts: {
    files?: Record<string, string>;
    review?: ReviewScript;
    /** The Pull Request body the body writer returns. None by default, as when its output can't be read. */
    body?: string;
    /** Files the body writer commits, though it is told never to. None by default. */
    bodyWriterFiles?: Record<string, string>;
    onCall?: (call: AgentCall) => void;
    /** Token usage each stage reports; "missing" reports none. Defaults to 100 in, 50 out. */
    usage?: Partial<Record<Stage, TokenUsage | "missing">>;
    /**
     * A fresh (not resumed) call to this stage hits the usage limit: like Sandcastle, it leaves
     * uncommitted `wip` in a preserved worktree and returns limit-reached with `sessionId`.
     */
    limit?: { stage: Stage; sessionId: string; wip?: Record<string, string> };
    /** A fresh call to this stage throws, leaving `wip` uncommitted; `sessionId` makes it resumable. */
    fail?: { stage: Stage; sessionId?: string; wip?: Record<string, string> };
  } = {},
): FakeAgent {
  const calls: AgentCall[] = [];
  return {
    calls,
    async run(call): Promise<AgentResult> {
      calls.push(call);
      opts.onCall?.(call);
      const scripted = opts.usage?.[call.stage] ?? { inputTokens: 100, outputTokens: 50 };
      const usage = scripted === "missing" ? undefined : scripted;
      const fresh = call.resumeSession === undefined;
      if (opts.limit?.stage === call.stage && fresh) {
        leaveWorkInProgress(repoDir, call.branch, opts.limit.wip ?? {});
        return { kind: "limit-reached", sessionId: opts.limit.sessionId, usage };
      }
      if (opts.fail?.stage === call.stage && fresh) {
        leaveWorkInProgress(repoDir, call.branch, opts.fail.wip ?? {});
        throw new AgentCallError("fake agent: sandbox error", opts.fail.sessionId);
      }
      if (call.stage === "implementer") {
        commitOnBranch(repoDir, call.branch, opts.files ?? { "feature.txt": "implemented\n" }, "fake agent: implement issue");
        return { kind: "completed", usage };
      }
      if (call.stage === "body-writer") {
        const files = opts.bodyWriterFiles ?? {};
        if (Object.keys(files).length > 0) commitOnBranch(repoDir, call.branch, files, "fake agent: body writer commit");
        return { kind: "completed", usage, body: opts.body };
      }
      const files = opts.review?.files ?? {};
      if (Object.keys(files).length > 0) commitOnBranch(repoDir, call.branch, files, "fake agent: fix critical finding");
      if (opts.review?.noFindings) return { kind: "completed", usage };
      return {
        kind: "completed",
        usage,
        review: { findings: [], specDisagreements: [], ...opts.review?.review },
      };
    },
  };
}

/** Checks out `branch` in a Sandcastle-style worktree and leaves `files` there uncommitted. */
function leaveWorkInProgress(repoDir: string, branch: string, files: Record<string, string>): void {
  if (Object.keys(files).length === 0) return;
  const worktree = join(repoDir, ".sandcastle", "worktrees", branch.replaceAll("/", "-"));
  git(repoDir, "worktree", "add", "-q", worktree, branch);
  for (const [path, content] of Object.entries(files)) writeFile(worktree, path, content);
}

function commitOnBranch(repoDir: string, branch: string, files: Record<string, string>, message: string): void {
  const worktree = mkdtempSync(join(tmpdir(), "sandcastle-pro-agent-"));
  rmSync(worktree, { recursive: true });
  git(repoDir, "worktree", "add", "-q", worktree, branch);
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(worktree, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", message);
  } finally {
    git(repoDir, "worktree", "remove", "--force", worktree);
  }
}

export interface FakePublisher extends Publisher {
  published: PullRequestRequest[];
  stateLookups: string[];
}

/**
 * A scripted Publisher that never pushes or calls `gh`. Each published Pull Request gets the next number;
 * `fail` makes publishing throw. `states` maps a URL to the state GitHub reports; a URL not in it makes the lookup throw.
 */
export function fakePublisher(opts: { fail?: string; states?: Record<string, PullRequestState> } = {}): FakePublisher {
  const published: PullRequestRequest[] = [];
  const stateLookups: string[] = [];
  return {
    published,
    stateLookups,
    async publish(request) {
      if (opts.fail) throw new Error(opts.fail);
      published.push(request);
      return { url: `https://github.com/owner/repo/pull/${published.length}` };
    },
    async state(url) {
      stateLookups.push(url);
      const state = opts.states?.[url];
      if (!state) throw new Error(`gh: could not resolve ${url}`);
      return state;
    },
  };
}

/** A project config with the defaults and the given Gate commands. */
export function configWithGate(gate: string[]): Config {
  return { ...DEFAULT_CONFIG, gate };
}
