import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIssueStore, runWorkflow, type Agent, type AgentCall, type Config } from "../src/index.js";
import { configWithGate, createTempRepo, fakeAgent, fakePublisher, git, issueFile, useTempHome, type FakeAgent, type TempRepo } from "./helpers.js";

const ISSUES = ".scratch/feature/issues";
const A = `${ISSUES}/01-first.md`;
const B = `${ISSUES}/02-second.md`;

useTempHome();

function config(stack: boolean, gate = ["true"]): Config {
  return { ...configWithGate(gate), pullRequest: true, stack };
}

/** A fake agent whose Implementer commits `a.txt` on Issue 01's branch and `b.txt` on any other. */
function chainAgent(repoDir: string): FakeAgent {
  const first = fakeAgent(repoDir, { files: { "a.txt": "A-MARKER\n" } });
  const rest = fakeAgent(repoDir, { files: { "b.txt": "B-MARKER\n" } });
  const calls: AgentCall[] = [];
  return {
    calls,
    run(call) {
      calls.push(call);
      return (call.branch === "issue/01-first" ? first : rest).run(call);
    },
  };
}

/** Merges each branch, in order, into `into` on `origin`, as the merge button would. */
function mergeOnOrigin(origin: string, into: string, ...branches: string[]): void {
  const clone = mkdtempSync(join(tmpdir(), "sandcastle-pro-clone-"));
  try {
    git(clone, "clone", "-q", origin, ".");
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "config", "user.name", "Test");
    git(clone, "config", "commit.gpgsign", "false");
    git(clone, "checkout", "-q", into);
    for (const branch of branches) git(clone, "merge", "-q", "--no-ff", "-m", `Merge ${branch}`, `origin/${branch}`);
    git(clone, "push", "-q", "origin", into);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

describe("Stacked Issues", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(file))?.[1];
  const headerOf = (text: string) => text.split(/^## Comments$/m)[0]!;

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(A, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.write(B, issueFile({ title: "02: Second slice", status: "ready-for-agent", extra: "Blocked by: 01\n\nBuild on the first." }));
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  it("with stack on, builds a two-Issue chain in one Run, stacking the second on the first's branch", async () => {
    const agent = chainAgent(repo.dir);
    const publisher = fakePublisher({ pushFrom: repo.dir });
    // The Gate passes only on a branch with both Issues' work.
    const gate = ["test -f a.txt", "test -f b.txt || test \"$(git branch --show-current)\" = issue/01-first"];

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true, gate), count: 2, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
    ]);
    expect(statusOf(A)).toBe("awaiting-merge");
    expect(statusOf(B)).toBe("awaiting-merge");

    // The second branch is cut from the first's tip, so it contains every commit of it.
    git(repo.dir, "merge-base", "--is-ancestor", "issue/01-first", "issue/02-second");
    expect(git(repo.dir, "show", "issue/02-second:a.txt")).toBe("A-MARKER");

    // Its Review Session sees only its own work.
    const review = agent.calls.find((c) => c.stage === "review-session" && c.branch === "issue/02-second")!;
    expect(review.prompt).toContain("+B-MARKER");
    expect(review.prompt).not.toContain("A-MARKER");
    expect(review.prompt).not.toContain("Record Issue 01's Run comments");

    // Its Pull Request targets the first's branch.
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([
      ["issue/01-first", "main"],
      ["issue/02-second", "issue/01-first"],
    ]);

    // The base is recorded near the top of the Issue, and travels onto its branch.
    expect(headerOf(repo.read(B))).toMatch(/^Blocked by: 01\nStacked on: issue\/01-first$/m);
    expect(headerOf(git(repo.dir, "show", `issue/02-second:${B}`))).toMatch(/^Stacked on: issue\/01-first$/m);
    expect(headerOf(repo.read(A))).not.toContain("Stacked on:");
    expect(output.join("\n")).toContain("Starting Issue 02 on issue/02-second stacked on issue/01-first");
  });

  it("with stack off, stops after the first Issue and says the second is blocked by it", async () => {
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent: chainAgent(repo.dir), publisher, config: config(false), count: 2, log });

    expect(result.issues.map((r) => r.issue.id)).toEqual(["01"]);
    expect(statusOf(B)).toBe("ready-for-agent");
    expect(repo.read(B)).not.toContain("Stacked on:");
    expect(git(repo.dir, "branch", "--list", "issue/02-second")).toBe("");
    expect(output.join("\n")).toContain("Issue 02 is blocked by 01.");
  });

  const BLOCKER_LINE =
    "> **Stacked on Issue 01**: this Pull Request targets `issue/01-first`, the branch of https://github.com/owner/repo/pull/1. Merge that Pull Request first.";

  it("starts a Stacked Issue's plain body with the blocker line, and leaves a non-stacked body without it", async () => {
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent: chainAgent(repo.dir), publisher, config: config(true), count: 2, log });

    const [first, second] = publisher.published;
    expect(first!.body).not.toContain("Stacked on");
    expect(first!.body.startsWith("> **Note:**")).toBe(true);
    expect(second!.body.startsWith(`${BLOCKER_LINE}\n\n> **Note:**`)).toBe(true);
    const comments = repo.read(B).split(/^## Comments$/m)[1]!;
    expect(comments).toContain(
      "**Pull Request opened**: https://github.com/owner/repo/pull/2\n\nStacked on Issue 01: this Pull Request targets `issue/01-first`, the branch of https://github.com/owner/repo/pull/1. Merge that Pull Request first.",
    );
    expect(repo.read(A).split(/^## Comments$/m)[1]).not.toContain("Stacked on");
  });

  it("names the blocker's branch, and no Pull Request, when the blocker has no Pull Request recorded", async () => {
    // 01 passed the Gate without a Pull Request: its branch exists, its file has no Pull Request line.
    git(repo.dir, "checkout", "-q", "-b", "issue/01-first");
    repo.write("a.txt", "A-MARKER\n");
    repo.commitAll("01's work");
    git(repo.dir, "checkout", "-q", "main");
    repo.write(A, issueFile({ title: "01: First slice", status: "awaiting-merge" }));
    repo.commitAll("01 awaits merge");
    git(repo.dir, "push", "-q", "origin", "main");
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent: chainAgent(repo.dir), publisher, config: config(true), log });

    const line = "Stacked on Issue 01: this Pull Request targets `issue/01-first`. Merge `issue/01-first` into `main` first.";
    expect(publisher.published.map((p) => p.base)).toEqual(["issue/01-first"]);
    const body = publisher.published[0]!.body;
    expect(body.startsWith("> **Stacked on Issue 01**: this Pull Request targets `issue/01-first`. Merge `issue/01-first` into `main` first.")).toBe(true);
    expect(body).not.toContain("the branch of");
    const comments = repo.read(B).split(/^## Comments$/m)[1]!;
    expect(comments).toContain(`**Pull Request opened**: https://github.com/owner/repo/pull/1\n\n${line}`);
  });

  it("starts a Stacked Issue's written body with the blocker line, and leaves a non-stacked body as written", async () => {
    const writerA = fakeAgent(repo.dir, { files: { "a.txt": "A\n" }, body: "## Summary\n\nDid it." });
    const writerB = fakeAgent(repo.dir, { files: { "b.txt": "B\n" }, body: "## Summary\n\nDid it." });
    const agent: FakeAgent = { calls: [], run: (call) => (call.branch === "issue/01-first" ? writerA : writerB).run(call) };
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true), count: 2, log });

    const [first, second] = publisher.published;
    expect(first!.body.startsWith("## Summary\n\nDid it.")).toBe(true);
    expect(first!.body).not.toContain("Stacked on");
    expect(second!.body.startsWith(`${BLOCKER_LINE}\n\n## Summary\n\nDid it.`)).toBe(true);
  });
});

describe("Picking rules for Stacked Issues at the runWorkflow seam", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(`${ISSUES}/${file}.md`))?.[1];
  const write = (file: string, status: string, blockedBy?: string) =>
    repo.write(`${ISSUES}/${file}.md`, issueFile({ title: file, status, extra: blockedBy ? `Blocked by: ${blockedBy}\n\nDo it.` : "Do it." }));

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  function commitAndPush(): void {
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
  }

  it("skips an Issue with two awaiting-merge blockers, naming both and saying a Stacked Issue can have only one", async () => {
    write("01-first", "awaiting-merge");
    write("02-second", "awaiting-merge");
    write("03-third", "ready-for-agent", "01, 02");
    commitAndPush();
    const agent = fakeAgent(repo.dir);

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config: config(true), count: 3, log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    expect(statusOf("03-third")).toBe("ready-for-agent");
    expect(repo.read(`${ISSUES}/03-third.md`)).not.toContain("Stacked on:");
    expect(output.join("\n")).toContain(
      "Issue 03 is blocked by 01, 02. It has 2 unmerged blockers, and a Stacked Issue can have only one.",
    );
  });

  it("does not stack on a blocker in ready-for-human", async () => {
    write("01-first", "ready-for-human");
    write("02-second", "ready-for-agent", "01");
    commitAndPush();
    const agent = fakeAgent(repo.dir);

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config: config(true), count: 2, log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    expect(statusOf("02-second")).toBe("ready-for-agent");
    const printed = output.join("\n");
    expect(printed).toContain("Issue 02 is blocked by 01.");
    expect(printed).not.toContain("can have only one");
  });

  it("builds a three-Issue chain in one Run, each stacked on the one before", async () => {
    write("01-first", "ready-for-agent");
    write("02-second", "ready-for-agent", "01");
    write("03-third", "ready-for-agent", "02");
    commitAndPush();
    const markers: Record<string, string> = { "issue/01-first": "a.txt", "issue/02-second": "b.txt", "issue/03-third": "c.txt" };
    const agents = Object.fromEntries(
      Object.entries(markers).map(([branch, file]) => [branch, fakeAgent(repo.dir, { files: { [file]: `${file}-MARKER\n` } })]),
    );
    const calls: AgentCall[] = [];
    const agent: FakeAgent = {
      calls,
      run(call) {
        calls.push(call);
        return agents[call.branch]!.run(call);
      },
    };
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true), count: 3, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
      ["03", "awaiting-merge"],
    ]);
    // C is cut from B's tip, which contains A's commits.
    git(repo.dir, "merge-base", "--is-ancestor", "issue/01-first", "issue/02-second");
    git(repo.dir, "merge-base", "--is-ancestor", "issue/02-second", "issue/03-third");
    expect(git(repo.dir, "show", "issue/03-third:a.txt")).toBe("a.txt-MARKER");
    expect(git(repo.dir, "show", "issue/03-third:b.txt")).toBe("b.txt-MARKER");
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([
      ["issue/01-first", "main"],
      ["issue/02-second", "issue/01-first"],
      ["issue/03-third", "issue/02-second"],
    ]);
    const review = calls.find((c) => c.stage === "review-session" && c.branch === "issue/03-third")!;
    expect(review.prompt).toContain("+c.txt-MARKER");
    expect(review.prompt).not.toContain("b.txt-MARKER");
    expect(output.join("\n")).toContain("Starting Issue 03 on issue/03-third stacked on issue/02-second");
  });

  it("keeps the paused-first rule and the lowest-numbered order with stacking on", async () => {
    write("01-first", "awaiting-merge");
    write("02-second", "ready-for-agent", "01");
    write("03-third", "ready-for-agent");
    repo.write(`${ISSUES}/04-fourth.md`, "# 04: Fourth\n\nStatus: paused\n\nDo it.\n");
    commitAndPush();
    const store = createIssueStore(repo.dir, { stack: true });

    expect((await store.next())?.id).toBe("04");
    repo.write(`${ISSUES}/04-fourth.md`, "# 04: Fourth\n\nStatus: done\n\nDo it.\n");
    expect((await store.next())?.id).toBe("02");
  });
});

describe("Picking Stacked Issues", () => {
  let repo: TempRepo;
  beforeEach(() => (repo = createTempRepo()));
  afterEach(() => repo.cleanup());

  const write = (file: string, status: string, blockedBy?: string) =>
    repo.write(`${ISSUES}/${file}.md`, issueFile({ title: file, status, extra: blockedBy ? `Blocked by: ${blockedBy}\n\nDo it.` : "Do it." }));

  it("picks an Issue whose only unmerged blocker is awaiting-merge, naming the branch to stack on", async () => {
    write("01-first", "awaiting-merge");
    write("02-second", "ready-for-agent", "01");

    const issue = await createIssueStore(repo.dir, { stack: true }).next();

    expect(issue?.id).toBe("02");
    expect(issue?.stackOn).toBe("issue/01-first");
    expect(await createIssueStore(repo.dir, { stack: true }).blocked()).toEqual([]);
    expect(await createIssueStore(repo.dir).next()).toBeNull();
    expect(await createIssueStore(repo.dir).blocked()).toEqual([{ id: "02", blockers: ["01"] }]);
  });

  it("counts done blockers as satisfied alongside one awaiting-merge blocker", async () => {
    write("01-first", "done");
    write("02-second", "awaiting-merge");
    write("03-third", "ready-for-agent", "01, 02");

    expect((await createIssueStore(repo.dir, { stack: true }).next())?.stackOn).toBe("issue/02-second");
  });

  it("does not stack on two unmerged blockers, or on a blocker that has not passed the Gate", async () => {
    write("01-first", "awaiting-merge");
    write("02-second", "awaiting-merge");
    write("03-third", "ready-for-agent", "01, 02");
    write("04-fourth", "in-progress");
    write("05-fifth", "ready-for-agent", "04");
    const store = createIssueStore(repo.dir, { stack: true });

    expect(await store.next()).toBeNull();
    expect(await store.blocked()).toEqual([
      { id: "03", blockers: ["01", "02"], tooManyToStack: true },
      { id: "05", blockers: ["04"] },
    ]);
  });

  it("does not stack an unblocked Issue", async () => {
    write("01-first", "ready-for-agent");

    const issue = await createIssueStore(repo.dir, { stack: true }).next();

    expect(issue?.stackOn).toBeUndefined();
    expect(issue?.stackedOn).toBeUndefined();
  });

  it("records the Stacked on line under Blocked by, replaces an earlier one, and keeps the bold style", async () => {
    write("01-first", "awaiting-merge");
    write("02-second", "ready-for-agent", "01");
    const store = createIssueStore(repo.dir, { stack: true });
    const issue = (await store.next())!;
    await store.comment(issue, "Stacked on: issue/in-a-comment");

    await store.recordStackedOn(issue, "issue/01-first");
    await store.recordStackedOn(issue, "issue/01-first");

    const text = repo.read(`${ISSUES}/02-second.md`);
    expect(text.match(/^Stacked on:.*$/gm)).toEqual(["Stacked on: issue/01-first", "Stacked on: issue/in-a-comment"]);
    expect(text).toMatch(/^Blocked by: 01\nStacked on: issue\/01-first$/m);
    const reread = (await createIssueStore(repo.dir, { stack: true }).next())!;
    expect(reread.stackedOn).toBe("issue/01-first");
    expect(reread.stackOn).toBeUndefined();

    repo.write(`${ISSUES}/03-bold.md`, "# 03: Bold\n\nStatus: ready-for-agent\n**Blocked by:** 01\n\nDo it.\n");
    await store.recordStackedOn({ ...reread, path: join(repo.dir, `${ISSUES}/03-bold.md`) }, "issue/01-first");
    expect(repo.read(`${ISSUES}/03-bold.md`)).toMatch(/^\*\*Blocked by:\*\* 01\n\*\*Stacked on:\*\* issue\/01-first$/m);
  });
});

describe("Resuming a paused Stacked Issue", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(file))?.[1];

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(A, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.write(B, issueFile({ title: "02: Second slice", status: "ready-for-agent", extra: "Blocked by: 01\n\nBuild on the first." }));
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  /** Runs 01 to awaiting-merge, then pauses 02, stacked on 01, at the usage limit in the Review Session. */
  async function pauseSecondInReviewSession(): Promise<void> {
    const first = fakeAgent(repo.dir, { files: { "a.txt": "A-MARKER\n" } });
    const second = fakeAgent(repo.dir, { files: { "b.txt": "B-MARKER\n" }, limit: { stage: "review-session", sessionId: "s-review" } });
    const agent: FakeAgent = { calls: [], run: (call) => (call.branch === "issue/01-first" ? first : second).run(call) };
    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher({ pushFrom: repo.dir }), config: config(true), count: 2, log });
    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "paused"],
    ]);
    expect(repo.read(B)).toMatch(/^Stacked on: issue\/01-first$/m);
    output = [];
  }

  it("resumes a Stacked Issue paused in the Review Session on its recorded base", async () => {
    await pauseSecondInReviewSession();
    const agent = fakeAgent(repo.dir, { files: { "b.txt": "B-MARKER\n" } });
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true), count: 1, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["02", "awaiting-merge"]]);
    const review = agent.calls.find((c) => c.stage === "review-session")!;
    expect(review.resumeSession).toBe("s-review");
    expect(agent.calls.some((c) => c.stage === "implementer")).toBe(false);
    // The body writer sees the diff measured from the blocker's branch, without the blocker's work.
    const bodyWriter = agent.calls.find((c) => c.stage === "body-writer")!;
    expect(bodyWriter.prompt).toContain("+B-MARKER");
    expect(bodyWriter.prompt).not.toContain("A-MARKER");
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([["issue/02-second", "issue/01-first"]]);
    expect(output.join("\n")).toContain("Resuming Issue 02 in the Review Session on issue/02-second stacked on issue/01-first");
  });

  it("keeps the recorded base when the blocker was merged into the target branch while paused", async () => {
    await pauseSecondInReviewSession();
    repo.commitAll("record the first Run");
    git(repo.dir, "merge", "-q", "--no-ff", "-m", "Merge Issue 01", "issue/01-first");
    repo.write(A, repo.read(A).replace(/^Status: .*$/m, "Status: done"));
    repo.commitAll("Mark Issue 01 as done");
    const agent = fakeAgent(repo.dir);
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true), count: 1, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["02", "awaiting-merge"]]);
    expect(agent.calls.find((c) => c.stage === "review-session")?.resumeSession).toBe("s-review");
    // GitHub retargets the Pull Request once the blocker's branch is deleted; the Run does not.
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([["issue/02-second", "issue/01-first"]]);
    expect(repo.read(B)).toMatch(/^Stacked on: issue\/01-first$/m);
  });

  it("sends a Stacked Issue to ready-for-human when its Stacked on branch no longer exists locally", async () => {
    await pauseSecondInReviewSession();
    repo.commitAll("record the first Run");
    git(repo.dir, "merge", "-q", "--no-ff", "-m", "Merge Issue 01", "issue/01-first");
    repo.write(A, repo.read(A).replace(/^Status: .*$/m, "Status: done"));
    repo.commitAll("Mark Issue 01 as done");
    git(repo.dir, "branch", "-D", "issue/01-first");
    const before = git(repo.dir, "rev-parse", "issue/02-second");
    const agent = fakeAgent(repo.dir);
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: config(true), count: 1, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["02", "base-missing"]]);
    expect(agent.calls).toHaveLength(0);
    expect(publisher.published).toHaveLength(0);
    expect(statusOf(B)).toBe("ready-for-human");
    expect(repo.read(B)).toMatch(/^Stacked on: issue\/01-first$/m);
    expect(repo.read(B).split(/^## Comments$/m)[1]).toContain("`issue/01-first`, which no longer exists locally");
    expect(git(repo.dir, "rev-parse", "issue/02-second")).toBe(before);
    expect(output.join("\n")).toContain("Issue 02 is stacked on issue/01-first, which no longer exists locally, so it goes to ready-for-human.");
  });
});

describe("Detecting merges of Stacked Issues", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(file))?.[1];
  const commentsOf = (file: string) => repo.read(file).split(/^## Comments$/m)[1] ?? "";
  const PR_A = "https://github.com/owner/repo/pull/1";
  const PR_B = "https://github.com/owner/repo/pull/2";

  beforeEach(async () => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(A, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.write(B, issueFile({ title: "02: Second slice", status: "ready-for-agent", extra: "Blocked by: 01\n\nBuild on the first." }));
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
    // One Run publishes 01, then 02 stacked on it.
    const result = await runWorkflow({
      repoDir: repo.dir,
      agent: chainAgent(repo.dir),
      publisher: fakePublisher({ pushFrom: repo.dir }),
      config: config(true),
      count: 2,
      log,
    });
    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
    ]);
    expect(repo.read(B)).toMatch(/^Pull Request: https:\/\/github\.com\/owner\/repo\/pull\/2$/m);
    output = [];
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  it("marks a Stacked Issue done when its Pull Request was merged into the target branch", async () => {
    mergeOnOrigin(origin, "main", "issue/01-first", "issue/02-second");
    const publisher = fakePublisher({
      states: { [PR_A]: { state: "MERGED", base: "main" }, [PR_B]: { state: "MERGED", base: "main" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("done");
    expect(statusOf(B)).toBe("done");
    expect(output.join("\n")).toContain(`Issue 02 is done: its Pull Request ${PR_B} is merged.`);
  });

  it("keeps a Stacked Issue awaiting-merge with a warning when its Pull Request was merged into its blocker's branch", async () => {
    mergeOnOrigin(origin, "issue/01-first", "issue/02-second");
    const publisher = fakePublisher({
      states: { [PR_A]: { state: "OPEN", base: "main" }, [PR_B]: { state: "MERGED", base: "issue/01-first" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("awaiting-merge");
    expect(statusOf(B)).toBe("awaiting-merge");
    expect(output.join("\n")).toContain(
      `Warning: Issue 02's Pull Request ${PR_B} was merged into issue/01-first, not the target branch main, so it stays awaiting-merge. Merge its blocker first`,
    );
  });

  it("sends a Stacked Issue to ready-for-human when its blocker was closed and its own Pull Request's state can't be read", async () => {
    // PR_B is not in `states`, so reading it throws.
    const publisher = fakePublisher({ states: { [PR_A]: { state: "CLOSED", base: "main" } } });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(B)).toBe("ready-for-human");
    expect(commentsOf(B).match(/Blocker closed/g)).toHaveLength(1);
    expect(commentsOf(B)).toContain(`the branch of Issue 01, whose Pull Request ${PR_A} was closed without being merged.`);
    expect(statusOf(A)).toBe("wontfix");
    const text = output.join("\n");
    expect(text).toContain(`Warning: could not read the state of Issue 02's Pull Request ${PR_B}, so it stays awaiting-merge: gh: could not resolve ${PR_B}`);
    expect(text).toContain(`Issue 02 is ready-for-human: it is stacked on Issue 01, whose Pull Request ${PR_A} was closed without being merged.`);
  });

  it("names the blocker's file in the warning when discarding that file's local edit fails", async () => {
    // The human merged 02, which holds 01's work, into main; 01's own Pull Request is still open.
    mergeOnOrigin(origin, "main", "issue/02-second");
    // 01's working copy matches the file on 02's branch, but is not in HEAD, so `git checkout HEAD --` fails on it.
    const atTip = git(repo.dir, "show", `issue/02-second:${A}`);
    git(repo.dir, "rm", "-q", "--cached", A);
    git(repo.dir, "commit", "-q", "-m", "untrack 01");
    repo.write(A, `${atTip}\n`);
    expect(git(repo.dir, "hash-object", A)).toBe(git(repo.dir, "rev-parse", `issue/02-second:${A}`));
    const before = repo.read(B);
    const publisher = fakePublisher({
      states: { [PR_A]: { state: "OPEN", base: "main" }, [PR_B]: { state: "MERGED", base: "main" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(B)).toBe("awaiting-merge");
    expect(repo.read(B)).toBe(before);
    expect(repo.read(A)).toBe(`${atTip}\n`);
    expect(output.join("\n")).toContain(
      `Warning: Issue 02's Pull Request ${PR_B} is merged, but ${A} was left as it is and the Issue stays awaiting-merge: could not discard its local edit`,
    );
  });

  it("sends the Issues stacked on a closed blocker to ready-for-human with a comment naming it, once", async () => {
    // A done Issue, and one already with the human, stacked on the same branch, keep their status.
    repo.write(`${ISSUES}/03-done.md`, issueFile({ title: "03: Done", status: "done", extra: "Stacked on: issue/01-first" }));
    repo.write(`${ISSUES}/04-human.md`, issueFile({ title: "04: Human", status: "ready-for-human", extra: "Stacked on: issue/01-first" }));
    const publisher = fakePublisher({
      states: { [PR_A]: { state: "CLOSED", base: "main" }, [PR_B]: { state: "OPEN", base: "issue/01-first" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("wontfix");
    expect(statusOf(B)).toBe("ready-for-human");
    expect(commentsOf(B)).toContain(
      `**Blocker closed**: this Issue is stacked on \`issue/01-first\`, the branch of Issue 01, whose Pull Request ${PR_A} was closed without being merged.`,
    );
    expect(statusOf(`${ISSUES}/03-done.md`)).toBe("done");
    expect(statusOf(`${ISSUES}/04-human.md`)).toBe("ready-for-human");
    expect(commentsOf(`${ISSUES}/04-human.md`)).not.toContain("Blocker closed");
    expect(publisher.stateLookups).toEqual([PR_A, PR_B]);
    const text = output.join("\n");
    expect(text).toContain(`Issue 01 is wontfix: its Pull Request ${PR_A} was closed without being merged.`);
    expect(text).toContain(`Issue 02 is ready-for-human: it is stacked on Issue 01, whose Pull Request ${PR_A} was closed without being merged.`);

    // A later Run does not comment again.
    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });
    expect(commentsOf(B).match(/Blocker closed/g)).toHaveLength(1);
  });
});

describe.each([
  { order: "numbered above its blocker", blocker: "01-blocker", stacked: "02-stacked" },
  { order: "numbered below its blocker", blocker: "02-blocker", stacked: "01-stacked" },
])("Detecting merges of a Stacked Issue $order", ({ blocker, stacked }) => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const BLOCKER = `${ISSUES}/${blocker}.md`;
  const STACKED = `${ISSUES}/${stacked}.md`;
  const BLOCKER_BRANCH = `issue/${blocker}`;
  const STACKED_BRANCH = `issue/${stacked}`;
  const PR_BLOCKER = "https://github.com/owner/repo/pull/1";
  const PR_STACKED = "https://github.com/owner/repo/pull/2";
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(file))?.[1];
  const commentsOf = (file: string) => repo.read(file).split(/^## Comments$/m)[1] ?? "";

  beforeEach(async () => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(BLOCKER, issueFile({ title: `${blocker.slice(0, 2)}: Blocker`, status: "ready-for-agent" }));
    repo.write(
      STACKED,
      issueFile({ title: `${stacked.slice(0, 2)}: Stacked`, status: "ready-for-agent", extra: `Blocked by: ${blocker.slice(0, 2)}\n\nBuild on the blocker.` }),
    );
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
    const first = fakeAgent(repo.dir, { files: { "a.txt": "A-MARKER\n" } });
    const rest = fakeAgent(repo.dir, { files: { "b.txt": "B-MARKER\n" } });
    const agent: Agent = { run: (call) => (call.branch === BLOCKER_BRANCH ? first : rest).run(call) };
    // One Run publishes the blocker, then the Issue stacked on it.
    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher({ pushFrom: repo.dir }), config: config(true), count: 2, log });
    expect(result.issues.map((r) => r.branch)).toEqual([BLOCKER_BRANCH, STACKED_BRANCH]);
    expect(repo.read(STACKED)).toContain(`Stacked on: ${BLOCKER_BRANCH}`);
    output = [];
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  it("marks it done, caught up and without a closed-blocker comment, when its Pull Request was merged into the target branch", async () => {
    // The human retargets the stacked Pull Request to main and merges it.
    mergeOnOrigin(origin, "main", STACKED_BRANCH);
    const publisher = fakePublisher({
      states: { [PR_BLOCKER]: { state: "CLOSED", base: "main" }, [PR_STACKED]: { state: "MERGED", base: "main" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(STACKED)).toBe("done");
    expect(commentsOf(STACKED)).not.toContain("Blocker closed");
    expect(git(repo.dir, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "main"));
    expect(repo.read("b.txt")).toBe("B-MARKER\n");
    expect(statusOf(BLOCKER)).toBe("wontfix");
    const text = output.join("\n");
    expect(text).toContain(`Issue ${stacked.slice(0, 2)} is done: its Pull Request ${PR_STACKED} is merged.`);
    expect(text).not.toContain("is ready-for-human");
  });

  it("marks both done when the blocker and then the Stacked Issue were merged into the target branch", async () => {
    mergeOnOrigin(origin, "main", BLOCKER_BRANCH, STACKED_BRANCH);
    const publisher = fakePublisher({
      states: { [PR_BLOCKER]: { state: "MERGED", base: "main" }, [PR_STACKED]: { state: "MERGED", base: "main" } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(BLOCKER)).toBe("done");
    expect(statusOf(STACKED)).toBe("done");
    expect(git(repo.dir, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "main"));
    expect(output.join("\n")).not.toContain("Warning");
  });

  it("sends it to ready-for-human with the closed-blocker comment when its Pull Request is still open", async () => {
    const publisher = fakePublisher({
      states: { [PR_BLOCKER]: { state: "CLOSED", base: "main" }, [PR_STACKED]: { state: "OPEN", base: BLOCKER_BRANCH } },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(STACKED)).toBe("ready-for-human");
    expect(commentsOf(STACKED).match(/Blocker closed/g)).toHaveLength(1);
    expect(commentsOf(STACKED)).toContain(`the branch of Issue ${blocker.slice(0, 2)}, whose Pull Request ${PR_BLOCKER} was closed without being merged.`);
    expect(statusOf(BLOCKER)).toBe("wontfix");
    expect(output.join("\n")).toContain(
      `Issue ${stacked.slice(0, 2)} is ready-for-human: it is stacked on Issue ${blocker.slice(0, 2)}, whose Pull Request ${PR_BLOCKER} was closed without being merged.`,
    );
  });
});

describe("A closed Pull Request in a three-Issue Stack", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const C = `${ISSUES}/03-third.md`;
  const PR_A = "https://github.com/owner/repo/pull/1";
  const PR_B = "https://github.com/owner/repo/pull/2";
  const PR_C = "https://github.com/owner/repo/pull/3";
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(file))?.[1];
  const commentsOf = (file: string) => repo.read(file).split(/^## Comments$/m)[1] ?? "";

  beforeEach(async () => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(A, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.write(B, issueFile({ title: "02: Second slice", status: "ready-for-agent", extra: "Blocked by: 01" }));
    repo.write(C, issueFile({ title: "03: Third slice", status: "ready-for-agent", extra: "Blocked by: 02" }));
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
    const agents: Record<string, Agent> = {
      "issue/01-first": fakeAgent(repo.dir, { files: { "a.txt": "A\n" } }),
      "issue/02-second": fakeAgent(repo.dir, { files: { "b.txt": "B\n" } }),
      "issue/03-third": fakeAgent(repo.dir, { files: { "c.txt": "C\n" } }),
    };
    const agent: Agent = { run: (call) => agents[call.branch]!.run(call) };
    // One Run publishes 01, 02 stacked on it, and 03 stacked on 02.
    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher({ pushFrom: repo.dir }), config: config(true), count: 3, log });
    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
      ["03", "awaiting-merge"],
    ]);
    expect(repo.read(C)).toContain("Stacked on: issue/02-second");
    expect(repo.read(C)).toContain(`Pull Request: ${PR_C}`);
    output = [];
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  it("makes the bottom Issue wontfix and sends both Issues above it to ready-for-human, naming it, once", async () => {
    const publisher = fakePublisher({
      states: {
        [PR_A]: { state: "CLOSED", base: "main" },
        [PR_B]: { state: "OPEN", base: "issue/01-first" },
        [PR_C]: { state: "OPEN", base: "issue/02-second" },
      },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("wontfix");
    expect(commentsOf(A)).toContain(`**Pull Request closed**: this Issue's Pull Request ${PR_A} was closed without being merged, so it is wontfix.`);
    expect(statusOf(B)).toBe("ready-for-human");
    expect(commentsOf(B)).toContain(`the branch of Issue 01, whose Pull Request ${PR_A} was closed without being merged.`);
    expect(statusOf(C)).toBe("ready-for-human");
    expect(commentsOf(C)).toContain(
      `**Blocker closed**: this Issue is stacked on \`issue/02-second\`, which is above \`issue/01-first\`, the branch of Issue 01, in the Stack. Issue 01's Pull Request ${PR_A} was closed without being merged.`,
    );
    const text = output.join("\n");
    expect(text).toContain(`Issue 01 is wontfix: its Pull Request ${PR_A} was closed without being merged.`);
    expect(text).toContain(`Issue 02 is ready-for-human: it is stacked on Issue 01, whose Pull Request ${PR_A} was closed without being merged.`);
    expect(text).toContain(`Issue 03 is ready-for-human: it is above Issue 01 in the Stack, whose Pull Request ${PR_A} was closed without being merged.`);

    // A later Run does not comment again.
    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });
    for (const file of [A, B, C]) expect(commentsOf(file).match(/closed without being merged/g)).toHaveLength(1);
  });

  it("marks an Issue above the closed one done when its Pull Request was merged into the target branch", async () => {
    mergeOnOrigin(origin, "main", "issue/03-third");
    const publisher = fakePublisher({
      states: {
        [PR_A]: { state: "CLOSED", base: "main" },
        [PR_B]: { state: "OPEN", base: "issue/01-first" },
        [PR_C]: { state: "MERGED", base: "main" },
      },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("wontfix");
    expect(statusOf(B)).toBe("ready-for-human");
    expect(statusOf(C)).toBe("done");
    expect(commentsOf(C)).not.toContain("Blocker closed");
    expect(output.join("\n")).toContain(`Issue 03 is done: its Pull Request ${PR_C} is merged.`);
  });

  it("leaves the Issue below a closed one in the middle of the Stack awaiting-merge", async () => {
    const publisher = fakePublisher({
      states: {
        [PR_A]: { state: "OPEN", base: "main" },
        [PR_B]: { state: "CLOSED", base: "issue/01-first" },
        [PR_C]: { state: "OPEN", base: "issue/02-second" },
      },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("awaiting-merge");
    expect(statusOf(B)).toBe("wontfix");
    expect(statusOf(C)).toBe("ready-for-human");
    expect(commentsOf(C)).toContain(`the branch of Issue 02, whose Pull Request ${PR_B} was closed without being merged.`);
  });

  it("names the lowest closed Issue when two in one Stack were closed", async () => {
    const publisher = fakePublisher({
      states: {
        [PR_A]: { state: "CLOSED", base: "main" },
        [PR_B]: { state: "CLOSED", base: "issue/01-first" },
        [PR_C]: { state: "OPEN", base: "issue/02-second" },
      },
    });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: config(true), log });

    expect(statusOf(A)).toBe("wontfix");
    expect(statusOf(B)).toBe("wontfix");
    expect(commentsOf(B)).not.toContain("Blocker closed");
    expect(statusOf(C)).toBe("ready-for-human");
    expect(commentsOf(C).match(/Blocker closed/g)).toHaveLength(1);
    expect(commentsOf(C)).toContain(`Issue 01's Pull Request ${PR_A} was closed without being merged.`);
  });
});

describe('Run stacking with "stack": "run"', () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const runConfig = (gate = ["true"]): Config => ({ ...configWithGate(gate), pullRequest: true, stack: "run" });
  const path = (file: string) => (file.includes("/") ? file : `${ISSUES}/${file}.md`);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(path(file)))?.[1];
  const headerOf = (file: string) => repo.read(path(file)).split(/^## Comments$/m)[0]!;
  const write = (file: string, status: string, extra = "Do it.") => repo.write(path(file), issueFile({ title: file, status, extra }));

  /** A fake agent whose Implementer commits `<slug>.txt` holding `<slug>-MARKER` on each Issue's branch. */
  function markerAgent(): FakeAgent {
    const calls: AgentCall[] = [];
    return {
      calls,
      run(call) {
        calls.push(call);
        const slug = call.branch.replace(/^issue\//, "");
        return fakeAgent(repo.dir, { files: { [`${slug}.txt`]: `${slug}-MARKER\n` } }).run(call);
      },
    };
  }

  /** Commits a branch for `slug` holding its marker, cut from `from`, and returns to main. */
  function branchWithWork(slug: string, from = "main"): void {
    git(repo.dir, "checkout", "-q", "-b", `issue/${slug}`, from);
    repo.write(`${slug}.txt`, `${slug}-MARKER\n`);
    repo.commitAll(`${slug}'s work`);
    git(repo.dir, "checkout", "-q", "main");
  }

  function commitAndPush(): void {
    repo.commitAll("add issues");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
  }

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  it("stacks three Issues that don't block each other into one Stack in a --count 3 Run", async () => {
    write("01-first", "ready-for-agent");
    write("02-second", "ready-for-agent");
    write("03-third", "ready-for-agent");
    commitAndPush();
    const agent = markerAgent();
    const publisher = fakePublisher({ pushFrom: repo.dir });
    // The Gate passes only when every Issue below the current one is in its branch.
    const gate = [
      'test -f 02-second.txt || test "$(git branch --show-current)" != issue/03-third',
      'test -f 01-first.txt || test "$(git branch --show-current)" = issue/01-first',
    ];

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: runConfig(gate), count: 3, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
      ["03", "awaiting-merge"],
    ]);
    git(repo.dir, "merge-base", "--is-ancestor", "issue/01-first", "issue/02-second");
    git(repo.dir, "merge-base", "--is-ancestor", "issue/02-second", "issue/03-third");
    expect(git(repo.dir, "show", "issue/03-third:01-first.txt")).toBe("01-first-MARKER");
    expect(git(repo.dir, "show", "issue/03-third:02-second.txt")).toBe("02-second-MARKER");
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([
      ["issue/01-first", "main"],
      ["issue/02-second", "issue/01-first"],
      ["issue/03-third", "issue/02-second"],
    ]);
    const reviewOf = (branch: string) => agent.calls.find((c) => c.stage === "review-session" && c.branch === branch)!.prompt;
    expect(reviewOf("issue/02-second")).toContain("+02-second-MARKER");
    expect(reviewOf("issue/02-second")).not.toContain("01-first-MARKER");
    expect(reviewOf("issue/03-third")).toContain("+03-third-MARKER");
    expect(reviewOf("issue/03-third")).not.toContain("02-second-MARKER");
    expect(reviewOf("issue/03-third")).not.toContain("01-first-MARKER");

    expect(headerOf("01-first")).not.toContain("Stacked on:");
    expect(headerOf("02-second")).toMatch(/^Stacked on: issue\/01-first$/m);
    expect(headerOf("03-third")).toMatch(/^Stacked on: issue\/02-second$/m);
    const third = publisher.published[2]!.body;
    expect(third).toContain(
      "this Pull Request targets `issue/02-second`, the branch of https://github.com/owner/repo/pull/2. Merge that Pull Request first.",
    );
    expect(third).not.toMatch(/\b\d+ of \d+\b/);
    expect(output.join("\n")).toContain("Starting Issue 03 on issue/03-third stacked on issue/02-second");
  });

  it("starts a new Run on the unmerged Issue an earlier Run left, across features", async () => {
    write("01-first", "ready-for-agent");
    repo.write(".scratch/other/spec.md", "# Spec: other\n\nSpec body.\n");
    write(".scratch/other/issues/05-other.md", "ready-for-agent");
    commitAndPush();
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: runConfig(), count: 1, log });
    expect(statusOf("01-first")).toBe("awaiting-merge");
    const second = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: runConfig(), count: 1, log });

    expect(second.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["05", "awaiting-merge"]]);
    git(repo.dir, "merge-base", "--is-ancestor", "issue/01-first", "issue/05-other");
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([
      ["issue/01-first", "main"],
      ["issue/05-other", "issue/01-first"],
    ]);
    expect(headerOf(".scratch/other/issues/05-other.md")).toMatch(/^Stacked on: issue\/01-first$/m);
  });

  it("starts the next Issue from the target branch once everything is merged", async () => {
    write("01-first", "ready-for-agent");
    write("02-second", "ready-for-agent");
    commitAndPush();
    await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher: fakePublisher({ pushFrom: repo.dir }), config: runConfig(), count: 1, log });
    mergeOnOrigin(origin, "main", "issue/01-first");
    const publisher = fakePublisher({ pushFrom: repo.dir, states: { "https://github.com/owner/repo/pull/1": "MERGED" } });

    const result = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: runConfig(), count: 1, log });

    expect(statusOf("01-first")).toBe("done");
    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["02", "awaiting-merge"]]);
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([["issue/02-second", "main"]]);
    expect(headerOf("02-second")).not.toContain("Stacked on:");
    expect(output.join("\n")).toContain("Starting Issue 02 on issue/02-second\n");
  });

  it("picks nothing when the Stack has two tops, and names both", async () => {
    write("01-first", "awaiting-merge", "Pull Request: https://github.com/owner/repo/pull/1\n\nDo it.");
    write("02-second", "awaiting-merge", "Pull Request: https://github.com/owner/repo/pull/2\n\nDo it.");
    write("03-third", "ready-for-agent");
    commitAndPush();
    const agent = markerAgent();
    const publisher = fakePublisher({
      states: { "https://github.com/owner/repo/pull/1": "OPEN", "https://github.com/owner/repo/pull/2": "OPEN" },
    });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: runConfig(), count: 3, log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    expect(statusOf("03-third")).toBe("ready-for-agent");
    expect(headerOf("03-third")).not.toContain("Stacked on:");
    expect(git(repo.dir, "branch", "--list", "issue/03-third")).toBe("");
    expect(output.join("\n")).toContain(
      "The Stack has 2 tops, so the Run can't tell which to build on: Issue 01 (`issue/01-first`, https://github.com/owner/repo/pull/1), Issue 02 (`issue/02-second`, https://github.com/owner/repo/pull/2). Merge or close Pull Requests until one Stack remains.",
    );
  });

  it("starts an Issue whose two awaiting-merge blockers are both in the Stack, on the top", async () => {
    branchWithWork("01-first");
    branchWithWork("02-second", "issue/01-first");
    write("01-first", "awaiting-merge");
    write("02-second", "awaiting-merge", "Stacked on: issue/01-first\n\nDo it.");
    write("03-third", "ready-for-agent", "Blocked by: 01, 02\n\nDo it.");
    commitAndPush();
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const result = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: runConfig(), count: 1, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["03", "awaiting-merge"]]);
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([["issue/03-third", "issue/02-second"]]);
    expect(git(repo.dir, "show", "issue/03-third:01-first.txt")).toBe("01-first-MARKER");
  });

  it("makes an Issue wait when an awaiting-merge blocker is outside the Stack, naming it", async () => {
    // 01 is built on by a leftover in-progress Issue, so the top is 03 and 01 is not below it.
    branchWithWork("01-first");
    branchWithWork("03-third");
    write("01-first", "awaiting-merge");
    write("02-second", "in-progress", "Stacked on: issue/01-first\n\nDo it.");
    write("03-third", "awaiting-merge");
    write("04-fourth", "ready-for-agent", "Blocked by: 01\n\nDo it.");
    commitAndPush();
    const agent = markerAgent();

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config: runConfig(), count: 1, log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    expect(statusOf("04-fourth")).toBe("ready-for-agent");
    expect(output.join("\n")).toContain(
      "Issue 04 is blocked by 01. Blocker 01 is awaiting-merge but not in the Stack below the top, so Issue 04's base would not have that work.",
    );
  });

  it("keeps an Issue whose blocker has not passed the Gate waiting", async () => {
    write("01-first", "ready-for-human");
    write("02-second", "ready-for-agent", "Blocked by: 01\n\nDo it.");
    commitAndPush();

    const result = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher: fakePublisher(), config: runConfig(), count: 1, log });

    expect(result.issues).toEqual([]);
    const printed = output.join("\n");
    expect(printed).toContain("Issue 02 is blocked by 01.");
    expect(printed).not.toContain("not in the Stack");
  });

  it("stacks the next Run on the Issue below one that failed the Gate", async () => {
    write("01-first", "ready-for-agent");
    write("02-second", "ready-for-agent");
    write("03-third", "ready-for-agent");
    commitAndPush();
    const failSecond = runConfig(['test "$(git branch --show-current)" != issue/02-second']);
    const publisher = fakePublisher({ pushFrom: repo.dir });

    const first = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: failSecond, count: 3, log });
    expect(first.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "gate-failed"],
    ]);
    expect(statusOf("02-second")).toBe("ready-for-human");
    const second = await runWorkflow({ repoDir: repo.dir, agent: markerAgent(), publisher, config: runConfig(), count: 1, log });

    expect(second.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["03", "awaiting-merge"]]);
    expect(headerOf("03-third")).toMatch(/^Stacked on: issue\/01-first$/m);
    expect(publisher.published.map((p) => [p.branch, p.base])).toEqual([
      ["issue/01-first", "main"],
      ["issue/03-third", "issue/01-first"],
    ]);
    expect(git(repo.dir, "show", "issue/03-third:01-first.txt")).toBe("01-first-MARKER");
    expect(() => git(repo.dir, "show", "issue/03-third:02-second.txt")).toThrow();
  });
});
