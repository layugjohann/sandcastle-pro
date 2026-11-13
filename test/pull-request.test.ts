import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIssueStore, runWorkflow, type Config, type Issue } from "../src/index.js";
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

  const findings = {
    review: {
      review: {
        findings: [
          { severity: "critical" as const, fixed: true, description: "FIXED-CRITICAL-MARKER" },
          { severity: "non-critical" as const, fixed: false, description: "NIT-MARKER" },
        ],
      },
    },
  };
  const WRITTEN = "## Summary\n\nWRITTEN-SUMMARY-MARKER\n\n## Evidence\n\nWRITTEN-EVIDENCE-MARKER\n\n## Merge Danger\n\n**Door:** two-way\n\n**Blast Radius:** small";

  it("opens a Pull Request with the written body, followed by the host's Findings and usage sections, and records its URL", async () => {
    const publisher = fakePublisher();
    const agent = fakeAgent(repo.dir, { ...findings, body: WRITTEN });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: withPullRequests(["echo GATE-EVIDENCE-MARKER"]), log });

    expect(publisher.published).toHaveLength(1);
    const request = publisher.published[0]!;
    expect(request.branch).toBe("issue/01-first");
    expect(request.base).toBe("main");
    expect(request.title).toBe("Issue 01: First slice");

    const { body } = request;
    expect(body.startsWith(WRITTEN)).toBe(true);
    // The written Evidence replaces the Gate transcript, and nothing says the body was not written.
    expect(body).not.toContain("(exit code 0)");
    expect(body).not.toContain("Note:");
    expect(body).toMatch(/## Fixed during review\n\n- FIXED-CRITICAL-MARKER/);
    expect(body).toMatch(/## Non-critical Findings\n\n- NIT-MARKER/);
    expect(body).toMatch(
      /<details>\n<summary>Token usage<\/summary>\n\nUsage: Implementer 100 input, 50 output.*; Body writer 100 input, 50 output.*<\/details>/s,
    );
    // The sections come in the order the human reads them.
    const order = ["## Summary", "## Merge Danger", "## Fixed during review", "## Non-critical Findings", "<details>"].map((s) => body.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.issues[0]).toMatchObject({ bodyWriter: { written: true } });
    expect(commentsOf("01-first.md")).toMatch(/Usage: Body writer 100 input, 50 output/);

    const url = "https://github.com/owner/repo/pull/1";
    expect(result.issues[0]).toMatchObject({ outcome: "awaiting-merge", pullRequest: { published: true, url } });
    expect(statusOf("01-first.md")).toBe("awaiting-merge");
    expect(headerOf("01-first.md")).toMatch(/^Status: awaiting-merge\nPull Request: https:\/\/github\.com\/owner\/repo\/pull\/1$/m);
    expect(commentsOf("01-first.md")).toContain(url);
    expect(output.join("\n")).toContain(`Pull Request: ${url}`);
  });

  it("runs the body writer once, after the Gate, with its own model and effort, defaulting to Sonnet at low effort", async () => {
    const gateRan = join(repo.dir, "gate-ran");
    const seenGate: boolean[] = [];
    const agent = fakeAgent(repo.dir, { body: WRITTEN, onCall: (call) => call.stage === "body-writer" && seenGate.push(existsSync(gateRan)) });

    await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config: withPullRequests([`touch ${gateRan}`]), log });

    expect(agent.calls.map((c) => [c.stage, c.model, c.effort, c.maxIterations])).toEqual([
      ["implementer", "claude-opus-5-5", "medium", 3],
      ["review-session", "claude-opus-5-5", "medium", 1],
      ["body-writer", "claude-sonnet-5-5", "low", 1],
    ]);
    expect(seenGate).toEqual([true]);
    const call = agent.calls[2]!;
    expect(call.branch).toBe("issue/01-first");
    expect(call.resumeSession).toBeUndefined();
  });

  it("runs the body writer with the model and effort the config sets, whatever the Issue's Model line says", async () => {
    repo.write(`${ISSUES}/01-first.md`, issueFile({ title: "01: First slice", status: "ready-for-agent", extra: "Model: claude-haiku-5-5\n\nDo it." }));
    repo.commitAll("cheap issue");
    const agent = fakeAgent(repo.dir, { body: WRITTEN });
    const config = { ...withPullRequests(["true"]), bodyWriter: { model: "claude-opus-5-5", effort: "high" as const } };

    await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config, log });

    expect(agent.calls.map((c) => [c.stage, c.model, c.effort])).toEqual([
      ["implementer", "claude-haiku-5-5", "medium"],
      ["review-session", "claude-haiku-5-5", "medium"],
      ["body-writer", "claude-opus-5-5", "high"],
    ]);
  });

  it("gives the body writer the Issue, Spec, Findings, Gate output, commits and diff", async () => {
    const agent = fakeAgent(repo.dir, { ...findings, body: WRITTEN, files: { "feature.txt": "DIFF-MARKER\n" } });

    await runWorkflow({ repoDir: repo.dir, agent, publisher: fakePublisher(), config: withPullRequests(["echo GATE-OUTPUT-MARKER"]), log });

    const { prompt } = agent.calls.find((c) => c.stage === "body-writer")!;
    for (const marker of ["01: First slice", "Spec body.", "FIXED-CRITICAL-MARKER", "NIT-MARKER", "GATE-OUTPUT-MARKER", "fake agent: implement issue", "+DIFF-MARKER"]) {
      expect(prompt).toContain(marker);
    }
  });

  it("publishes the plain body with a note when the body writer returns no body", async () => {
    const publisher = fakePublisher();

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir, findings), publisher, config: withPullRequests(["echo GATE-EVIDENCE-MARKER"]), log });

    const { body } = publisher.published[0]!;
    expect(body).toMatch(/^> \*\*Note:\*\* The body writer did not write this body, because it returned no body\./);
    expect(body).toContain("## Evidence\n\nThe Gate passed.");
    expect(body).toContain("$ echo GATE-EVIDENCE-MARKER\nGATE-EVIDENCE-MARKER\n(exit code 0)");
    expect(body).toMatch(/## Fixed during review\n\n- FIXED-CRITICAL-MARKER/);
    expect(body).toMatch(/## Non-critical Findings\n\n- NIT-MARKER/);
    expect(body).toMatch(/Usage: Implementer .*; Body writer 100 input/);
    expect(result.issues[0]).toMatchObject({ outcome: "awaiting-merge", bodyWriter: { written: false, limitReached: false } });
    expect(statusOf("01-first.md")).toBe("awaiting-merge");
  });

  it("publishes the plain body when the body writer hits the usage limit, without pausing the Issue, and stops the Run", async () => {
    const publisher = fakePublisher();
    const agent = fakeAgent(repo.dir, { ...findings, limit: { stage: "body-writer", sessionId: "body-session" } });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: withPullRequests(["true"]), count: 2, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([["01", "awaiting-merge"]]);
    expect(result.issues[0]).toMatchObject({ pullRequest: { published: true }, bodyWriter: { written: false, limitReached: true } });
    expect(publisher.published).toHaveLength(1);
    const { body } = publisher.published[0]!;
    expect(body).toMatch(/^> \*\*Note:\*\* The body writer did not write this body, because it hit the usage limit\./);
    expect(body).toContain("## Evidence");
    expect(body).toMatch(/## Non-critical Findings\n\n- NIT-MARKER/);

    expect(statusOf("01-first.md")).toBe("awaiting-merge");
    expect(read("01-first.md")).not.toContain("Paused");
    expect(commentsOf("01-first.md")).toContain("usage limit");
    expect(statusOf("02-second.md")).toBe("ready-for-agent");
    expect(git(repo.dir, "branch", "--list", "issue/02-second")).toBe("");
    expect(output.join("\n")).toMatch(/Stopping the Run at the usage limit/);
    expect(agent.calls.filter((c) => c.stage === "implementer")).toHaveLength(1);
  });

  it("publishes the plain body when the body writer throws, without pausing the Issue, and carries on with the next Issue", async () => {
    const publisher = fakePublisher();
    const agent = fakeAgent(repo.dir, { fail: { stage: "body-writer", sessionId: "resumable-but-unused" } });

    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: withPullRequests(["true"]), count: 2, log });

    expect(result.issues.map((r) => [r.issue.id, r.outcome])).toEqual([
      ["01", "awaiting-merge"],
      ["02", "awaiting-merge"],
    ]);
    expect(publisher.published).toHaveLength(2);
    expect(publisher.published[0]!.body).toMatch(/^> \*\*Note:\*\* The body writer did not write this body, because it failed: fake agent: sandbox error\./);
    for (const file of ["01-first.md", "02-second.md"]) {
      expect(statusOf(file)).toBe("awaiting-merge");
      expect(read(file)).not.toContain("Paused");
    }
    expect(output.join("\n")).toMatch(/Issue 01 is awaiting merge\.[\s\S]*body writer did not write this body/);
  });

  it("puts the branch back to the commit that passed the Gate when the body writer commits to it", async () => {
    const publisher = fakePublisher();
    const agent = fakeAgent(repo.dir, { body: WRITTEN, bodyWriterFiles: { "sneaky.txt": "not gated\n" } });

    await runWorkflow({ repoDir: repo.dir, agent, publisher, config: withPullRequests(["true"]), log });

    // Only the host's Issue file commits follow the commit that passed the Gate.
    expect(git(repo.dir, "log", "--format=%s", "main..issue/01-first").split("\n")).toEqual([
      "Record Issue 01's Run comments",
      "Record Issue 01's Run comments",
      "fake agent: implement issue",
    ]);
    expect(git(repo.dir, "ls-tree", "--name-only", "issue/01-first")).not.toContain("sneaky.txt");
    expect(output.join("\n")).toMatch(/Warning: The body writer changed issue\/01-first/);
    expect(publisher.published).toHaveLength(1);
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

  it("publishes nothing, records no Pull Request and calls no body writer when pullRequest is off", async () => {
    const publisher = fakePublisher();

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, publisher, config: configWithGate(["true"]), log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
    expect(result.issues[0]).not.toHaveProperty("pullRequest");
    expect(agent.calls.map((c) => c.stage)).toEqual(["implementer", "review-session"]);
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

  it("logs a warning naming the Issue and its URL when the Pull Request was closed without being merged", async () => {
    awaitingWithPullRequest("01-closed.md", "01: Closed");
    repo.commitAll("add issue");

    await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      publisher: fakePublisher({ states: { [URL]: "CLOSED" } }),
      config: configWithGate(["true"]),
      log,
    });

    expect(statusOf("01-closed.md")).toBe("awaiting-merge");
    expect(output.join("\n")).toMatch(/Warning: Issue 01's Pull Request https:\/\/github\.com\/owner\/repo\/pull\/7 was closed without being merged/);
  });
});

describe("The Issue file on the Pull Request", () => {
  let repo: TempRepo;
  let origin: string;
  let output: string[];
  const log = (line: string) => output.push(line);
  const FILE = `${ISSUES}/01-first.md`;
  const URL = "https://github.com/owner/repo/pull/1";
  const config = withPullRequests(["true"]);
  const statusOf = () => /^Status:\s*(\S+)/m.exec(repo.read(FILE))?.[1];

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    origin = mkdtempSync(join(tmpdir(), "sandcastle-pro-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(repo.dir, "remote", "add", "origin", origin);
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSpec body.\n");
    repo.write(FILE, issueFile({ title: "01: First slice", status: "ready-for-agent" }));
    repo.commitAll("add issue");
    git(repo.dir, "push", "-q", "-u", "origin", "main");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(origin, { recursive: true, force: true });
  });

  /** Merges the Issue's branch into `main` on `origin`, as the merge button would. */
  function mergeOnOrigin(): void {
    const clone = mkdtempSync(join(tmpdir(), "sandcastle-pro-clone-"));
    try {
      git(clone, "clone", "-q", origin, ".");
      git(clone, "config", "user.email", "test@example.com");
      git(clone, "config", "user.name", "Test");
      git(clone, "config", "commit.gpgsign", "false");
      git(clone, "merge", "-q", "--no-ff", "-m", "Merge pull request #1", "origin/issue/01-first");
      git(clone, "push", "-q", "origin", "main");
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  }

  async function publishFirst(): Promise<void> {
    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher: fakePublisher({ pushFrom: repo.dir }), config, log });
  }

  async function runAfterMerge(): Promise<void> {
    output = [];
    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher: fakePublisher({ states: { [URL]: "MERGED" } }), config, log });
  }

  it("commits the Issue file with its Run comments and Pull Request line onto the pushed branch", async () => {
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config, log });

    expect(publisher.pushes).toEqual(["issue/01-first", "issue/01-first"]);
    expect(git(repo.dir, "log", "--format=%s", "main..issue/01-first").split("\n")).toEqual([
      "Record Issue 01's Run comments",
      "Record Issue 01's Run comments",
      "fake agent: implement issue",
    ]);
    // The commit the Pull Request opens with already has the comments up to the Gate.
    expect(git(repo.dir, "show", `issue/01-first~1:${FILE}`)).toMatch(/Usage: Implementer[\s\S]*\*\*Gate passed\*\*/);
    const branchFile = git(repo.dir, "show", `issue/01-first:${FILE}`);
    expect(branchFile).toMatch(/^Status: awaiting-merge\nPull Request: https:\/\/github\.com\/owner\/repo\/pull\/1$/m);
    expect(branchFile).toContain(`**Pull Request opened**: ${URL}`);
    expect(git(repo.dir, "status", "--porcelain")).toContain(FILE);
    expect(git(repo.dir, "hash-object", FILE)).toBe(git(repo.dir, "rev-parse", `issue/01-first:${FILE}`));
    expect(git(origin, "rev-parse", "issue/01-first")).toBe(git(repo.dir, "rev-parse", "issue/01-first"));
  });

  it("pulls the target branch and marks the Issue done after the Pull Request is merged, leaving other changes alone", async () => {
    await publishFirst();
    mergeOnOrigin();
    repo.write("README.md", "# local edit\n");
    repo.write("notes.txt", "untracked\n");

    await runAfterMerge();

    expect(statusOf()).toBe("done");
    expect(git(repo.dir, "rev-parse", "main")).toBe(git(origin, "rev-parse", "main"));
    expect(repo.read("feature.txt")).toBe("implemented\n");
    expect(repo.read("README.md")).toBe("# local edit\n");
    expect(repo.read("notes.txt")).toBe("untracked\n");
    expect(output.join("\n")).not.toMatch(/Warning/);
    expect(output.join("\n")).toContain(`Issue 01 is done: its Pull Request ${URL} is merged.`);
  });

  it("leaves a working copy whose Issue file differs from the branch untouched, and warns", async () => {
    await publishFirst();
    mergeOnOrigin();
    const edited = `${repo.read(FILE)}\nA HUMAN NOTE\n`;
    repo.write(FILE, edited);
    const before = git(repo.dir, "rev-parse", "main");

    await runAfterMerge();

    expect(repo.read(FILE)).toBe(edited);
    expect(statusOf()).toBe("awaiting-merge");
    expect(git(repo.dir, "rev-parse", "main")).toBe(before);
    expect(output.join("\n")).toContain(`Warning: Issue 01's Pull Request ${URL} is merged, but ${FILE} was left as it is`);
    expect(output.join("\n")).toContain("differs from the file at the tip of issue/01-first");
  });

  it("leaves the Issue file alone and warns when the target branch is not checked out", async () => {
    await publishFirst();
    mergeOnOrigin();
    const before = repo.read(FILE);
    git(repo.dir, "checkout", "-q", "-b", "elsewhere");
    output = [];

    await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      publisher: fakePublisher({ states: { [URL]: "MERGED" } }),
      config,
      targetBranch: "main",
      log,
    });

    expect(repo.read(FILE)).toBe(before);
    expect(statusOf()).toBe("awaiting-merge");
    expect(output.join("\n")).toMatch(/Warning: Issue 01's .* was left as it is .*the target branch main is not checked out/);
  });

  it("puts the Issue file back and warns when the pull fails", async () => {
    await publishFirst();
    mergeOnOrigin();
    // A local commit on main makes the fast-forward impossible.
    repo.write("diverged.txt", "local\n");
    git(repo.dir, "add", "diverged.txt");
    git(repo.dir, "commit", "-q", "-m", "diverge");
    const before = repo.read(FILE);

    await runAfterMerge();

    expect(repo.read(FILE)).toBe(before);
    // The edit is back in the working copy, and the index is as it was.
    expect(git(repo.dir, "diff", "--name-only")).toBe(FILE);
    expect(git(repo.dir, "diff", "--cached", "--name-only")).toBe("");
    expect(statusOf()).toBe("awaiting-merge");
    expect(output.join("\n")).toContain(`${FILE} was left as it is and the Issue stays awaiting-merge: \`git pull --ff-only origin main\` failed`);
  });

  it("commits and pushes nothing for an Issue that fails the Gate", async () => {
    const publisher = fakePublisher({ pushFrom: repo.dir });

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher, config: withPullRequests(["false"]), log });

    expect(statusOf()).toBe("ready-for-human");
    expect(publisher.pushes).toEqual([]);
    expect(git(repo.dir, "log", "--format=%s", "main..issue/01-first")).toBe("fake agent: implement issue");
    expect(git(origin, "branch", "--list", "issue/01-first")).toBe("");
  });

  it("says the Pull Request was opened, with its URL, when the comment after opening it fails", async () => {
    const store = createIssueStore(repo.dir);
    const failing = {
      ...store,
      async comment(issue: Issue, text: string) {
        if (text.startsWith("**Pull Request opened**")) throw new Error("COMMENT-FAILED-MARKER");
        return store.comment(issue, text);
      },
    };

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), publisher: fakePublisher(), store: failing, config, log });

    expect(result.issues[0]).toMatchObject({ outcome: "awaiting-merge", pullRequest: { published: true, url: URL } });
    const text = output.join("\n");
    expect(text).not.toContain("Could not publish the Pull Request");
    expect(text).toContain(`The Pull Request was opened at ${URL}, but`);
    expect(text).toContain("COMMENT-FAILED-MARKER");
    expect(repo.read(FILE)).not.toContain("Could not publish the Pull Request");
    expect(repo.read(FILE)).toContain(`The Pull Request was opened at ${URL}`);
    expect(statusOf()).toBe("awaiting-merge");
  });

  it("says the Pull Request was opened when pushing the Issue file afterwards fails", async () => {
    const result = await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      publisher: fakePublisher({ failPush: "PUSH-FAILED-MARKER" }),
      config,
      log,
    });

    expect(result.issues[0]).toMatchObject({ pullRequest: { published: true, url: URL, error: expect.stringContaining("PUSH-FAILED-MARKER") } });
    expect(output.join("\n")).toContain(`Warning: The Pull Request was opened at ${URL}, but`);
    expect(output.join("\n")).not.toContain("Could not publish the Pull Request");
  });
});
