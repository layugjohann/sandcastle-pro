import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkflow } from "../src/index.js";
import { createTempRepo, fakeAgent, git, issueFile, type TempRepo } from "./helpers.js";

const ISSUES = ".scratch/feature/issues";

function statusOf(repo: TempRepo, file: string): string | undefined {
  return /^Status:\s*(\S+)/m.exec(repo.read(`${ISSUES}/${file}`))?.[1];
}

describe("Run Workflow", () => {
  let repo: TempRepo;
  let output: string[];
  const log = (line: string) => output.push(line);

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSPEC-BODY-MARKER\n");
  });
  afterEach(() => repo.cleanup());

  it("takes the lowest-numbered ready Issue to awaiting-merge on its own branch", async () => {
    repo.write("GLOSSARY.md", "# Glossary\n\nGLOSSARY-MARKER\n");
    repo.write(`${ISSUES}/02-later-work.md`, issueFile({ title: "02: Later work", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/03-not-ready.md`, issueFile({ title: "03: Not ready", status: "needs-triage" }));
    repo.write(
      `${ISSUES}/05-other.md`,
      issueFile({ title: "05: Other", status: "ready-for-agent" }),
    );
    repo.write(
      `${ISSUES}/01-first-slice.md`,
      issueFile({ title: "01: First slice", status: "needs-info" }),
    );
    repo.commitAll("add issues");
    const mainBefore = git(repo.dir, "rev-parse", "main");

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, gate: ["true", "test -f feature.txt"], log });

    expect(result.outcome).toBe("awaiting-merge");
    expect(statusOf(repo, "02-later-work.md")).toBe("awaiting-merge");
    expect(statusOf(repo, "05-other.md")).toBe("ready-for-agent");
    expect(statusOf(repo, "01-first-slice.md")).toBe("needs-info");

    // Commits land on the Issue's branch; the target branch is untouched.
    expect(git(repo.dir, "rev-parse", "main")).toBe(mainBefore);
    expect(git(repo.dir, "log", "--format=%s", "main..issue/02-later-work")).toBe("fake agent: implement issue");
    expect(git(repo.dir, "branch", "--show-current")).toBe("main");

    // The Implementer starts with the Issue, its Spec and the glossary.
    expect(agent.calls).toHaveLength(1);
    const call = agent.calls[0]!;
    expect(call.branch).toBe("issue/02-later-work");
    expect(call.prompt).toContain("02: Later work");
    expect(call.prompt).toContain("SPEC-BODY-MARKER");
    expect(call.prompt).toContain("GLOSSARY-MARKER");
    expect(call.model).toBe("claude-opus-5-5");
    expect(call.effort).toBe("medium");
    expect(call.maxIterations).toBe(3);

    expect(output.join("\n")).toContain("issue/02-later-work");
  });

  it("sets the Issue to in-progress before the Implementer runs", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    let statusDuringRun: string | undefined;
    const agent = fakeAgent(repo.dir, { onCall: () => (statusDuringRun = statusOf(repo, "01-only.md")) });
    await runWorkflow({ repoDir: repo.dir, agent, gate: ["true"], log });

    expect(statusDuringRun).toBe("in-progress");
  });

  it("works without a GLOSSARY.md", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), gate: ["true"], log });

    expect(result.outcome).toBe("awaiting-merge");
    expect(statusOf(repo, "01-only.md")).toBe("awaiting-merge");
  });

  it("does not move the Issue to awaiting-merge when the Gate fails", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    const result = await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      gate: ["true", "echo boom && false"],
      log,
    });

    expect(result.outcome).toBe("gate-failed");
    expect(statusOf(repo, "01-only.md")).not.toBe("awaiting-merge");
  });

  it("exits cleanly with a message and changes nothing when no Issue is ready", async () => {
    repo.write(`${ISSUES}/01-triage.md`, issueFile({ title: "01: Triage", status: "needs-triage" }));
    repo.write(`${ISSUES}/02-done.md`, issueFile({ title: "02: Done", status: "awaiting-merge" }));
    repo.commitAll("add issues");

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, gate: ["true"], log });

    expect(result.outcome).toBe("no-ready-issue");
    expect(agent.calls).toHaveLength(0);
    expect(output.join("\n")).toMatch(/no issue is ready/i);
    expect(git(repo.dir, "status", "--porcelain")).toBe("");
    expect(git(repo.dir, "branch", "--list", "issue/*")).toBe("");
  });

  it("exits cleanly when there is no .scratch directory at all", async () => {
    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), gate: ["true"], log });
    expect(result.outcome).toBe("no-ready-issue");
  });
});
