import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkflow, type Config } from "../src/index.js";
import { configWithGate, createTempRepo, fakeAgent, fakePublisher, git, issueFile, useTempHome, type TempRepo } from "./helpers.js";

const ISSUES = ".scratch/feature/issues";

useTempHome();

function withPullRequests(gate: string[]): Config {
  return { ...configWithGate(gate), pullRequest: true };
}

describe("Publishing a Pull Request", () => {
  let repo: TempRepo;
  let output: string[];
  const log = (line: string) => output.push(line);

  const read = (file: string) => repo.read(`${ISSUES}/${file}`);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(read(file))?.[1];
  const headerOf = (file: string) => read(file).split(/^## Comments$/m)[0]!;
  const commentsOf = (file: string) => read(file).split(/^## Comments$/m)[1] ?? "";

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(`${ISSUES}/01-first.md`, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/02-second.md`, issueFile({ title: "02: Second slice", status: "ready-for-agent" }));
    repo.commitAll("add issues");
  });
  afterEach(() => repo.cleanup());

  it("opens a Pull Request against the target branch with the deterministic body and records its URL", async () => {
    const publisher = fakePublisher();
    const agent = fakeAgent(repo.dir, {
      review: {
        review: {
          findings: [
            { severity: "critical", fixed: true, description: "FIXED-CRITICAL-MARKER" },
            { severity: "non-critical", fixed: false, description: "NIT-MARKER" },
          ],
        },
      },
    });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: withPullRequests(["echo GATE-EVIDENCE-MARKER"]), log });

    expect(publisher.published).toHaveLength(1);
    const request = publisher.published[0]!;
    expect(request.branch).toBe("issue/01-first");
    expect(request.base).toBe("main");
    expect(request.title).toBe("Issue 01: First slice");

    const { body } = request;
    expect(body).toMatch(/^## Evidence\n/);
    expect(body).toContain("$ echo GATE-EVIDENCE-MARKER\nGATE-EVIDENCE-MARKER\n(exit code 0)");
    expect(body).toMatch(/## Fixed during review\n\n- FIXED-CRITICAL-MARKER/);
    expect(body).toMatch(/## Non-critical Findings\n\n- NIT-MARKER/);
    expect(body).toMatch(/<details>\n<summary>Token usage<\/summary>\n\nUsage: Implementer 100 input, 50 output.*<\/details>/s);
    // The sections come in the order the human reads them.
    const order = ["## Evidence", "## Fixed during review", "## Non-critical Findings", "<details>"].map((s) => body.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const url = "https://github.com/owner/repo/pull/1";
    expect(result.issues[0]).toMatchObject({ outcome: "awaiting-merge", pullRequest: { published: true, url } });
    expect(statusOf("01-first.md")).toBe("awaiting-merge");
    expect(headerOf("01-first.md")).toMatch(/^Status: awaiting-merge\nPull Request: https:\/\/github\.com\/owner\/repo\/pull\/1$/m);
    expect(commentsOf("01-first.md")).toContain(url);
    expect(output.join("\n")).toContain(`Pull Request: ${url}`);
  });

  it("leaves empty sections out of the body", async () => {
    const publisher = fakePublisher();

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: withPullRequests(["true"]), log });

    const { body } = publisher.published[0]!;
    expect(body).toContain("## Evidence");
    expect(body).toContain("<details>");
    expect(body).not.toContain("## Fixed during review");
    expect(body).not.toContain("## Non-critical Findings");
  });

  it("still moves the Issue to awaiting-merge when publishing fails, comments the error and carries on with the next Issue", async () => {
    const publisher = fakePublisher({ fail: "PUSH-REJECTED-MARKER" });

    const result = await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      publisher,
      config: withPullRequests(["true"]),
      count: 2,
      log,
    });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
    ]);
    expect(result.issues[0]).toMatchObject({ pullRequest: { published: false, error: "PUSH-REJECTED-MARKER" } });
    for (const file of ["01-first.md", "02-second.md"]) {
      expect(statusOf(file)).toBe("awaiting-merge");
      expect(headerOf(file)).not.toContain("Pull Request:");
      expect(commentsOf(file)).toContain("PUSH-REJECTED-MARKER");
    }
    expect(output.join("\n")).toMatch(/Issue 01 is awaiting merge\.[\s\S]*Could not publish the Pull Request: PUSH-REJECTED-MARKER/);
  });

  it("publishes nothing and records no Pull Request when pullRequest is off", async () => {
    const publisher = fakePublisher();

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: configWithGate(["true"]), log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
    expect(result.issues[0]).not.toHaveProperty("pullRequest");
    expect(publisher.published).toEqual([]);
    expect(read("01-first.md")).not.toContain("Pull Request");
    expect(output.join("\n")).not.toContain("Pull Request");
  });
});

describe("Merge detection through the Pull Request", () => {
  let repo: TempRepo;
  let output: string[];
  const log = (line: string) => output.push(line);
  const statusOf = (file: string) => /^Status:\s*(\S+)/m.exec(repo.read(`${ISSUES}/${file}`))?.[1];
  const URL = "https://github.com/owner/repo/pull/7";

  function awaitingWithPullRequest(file: string, title: string): void {
    repo.write(`${ISSUES}/${file}`, issueFile({ title, status: "awaiting-merge", extra: `Pull Request: ${URL}\n\nDo the thing.` }));
  }

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
  });
  afterEach(() => repo.cleanup());

  it("marks an Issue done when its Pull Request is reported MERGED, though its branch is not in the target branch", async () => {
    awaitingWithPullRequest("01-squashed.md", "01: Squashed");
    repo.commitAll("add issue");
    git(repo.dir, "branch", "issue/01-squashed");
    git(repo.dir, "checkout", "-q", "issue/01-squashed");
    repo.write("work.txt", "work\n");
    repo.commitAll("unmerged work");
    git(repo.dir, "checkout", "-q", "main");
    const publisher = fakePublisher({ states: { [URL]: "MERGED" } });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: configWithGate(["true"]), log });

    expect(publisher.stateLookups).toEqual([URL]);
    expect(statusOf("01-squashed.md")).toBe("done");
  });

  it("keeps an Issue awaiting-merge while its Pull Request is open", async () => {
    awaitingWithPullRequest("01-open.md", "01: Open");
    repo.commitAll("add issue");

    await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      publisher: fakePublisher({ states: { [URL]: "OPEN" } }),
      config: configWithGate(["true"]),
      log,
    });

    expect(statusOf("01-open.md")).toBe("awaiting-merge");
  });

  it("logs a warning and keeps the Issue awaiting-merge when gh fails", async () => {
    awaitingWithPullRequest("01-unknown.md", "01: Unknown");
    repo.commitAll("add issue");

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher: fakePublisher(), config: configWithGate(["true"]), log });

    expect(statusOf("01-unknown.md")).toBe("awaiting-merge");
    expect(output.join("\n")).toMatch(/Warning: could not read the state of Issue 01's Pull Request .*pull\/7/);
  });

  it("keeps using the local ancestry check for an Issue without a Pull Request line", async () => {
    repo.write(`${ISSUES}/01-local.md`, issueFile({ title: "01: Local", status: "awaiting-merge" }));
    repo.commitAll("add issue");
    git(repo.dir, "branch", "issue/01-local");
    const publisher = fakePublisher();

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: configWithGate(["true"]), log });

    expect(publisher.stateLookups).toEqual([]);
    expect(statusOf("01-local.md")).toBe("done");
  });
});
