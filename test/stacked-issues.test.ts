import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIssueStore, runWorkflow, type AgentCall, type Config } from "../src/index.js";
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
      { id: "03", blockers: ["01", "02"] },
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
