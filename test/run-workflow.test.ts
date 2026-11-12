import { existsSync } from "node:fs";
import { join } from "node:path";
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
    const call = agent.calls[0]!;
    expect(call.stage).toBe("implementer");
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

describe("Review Session", () => {
  let repo: TempRepo;
  let output: string[];
  const log = (line: string) => output.push(line);

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n\nSPEC-BODY-MARKER\n");
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");
  });
  afterEach(() => repo.cleanup());

  it("runs exactly once, on the Issue's branch, after the Implementer and before the Gate", async () => {
    const agent = fakeAgent(repo.dir, {
      files: { "feature.txt": "IMPLEMENTED-CONTENT-MARKER\n" },
      // The Review Session fixes a Critical Finding; the Gate only passes with the fix.
      review: {
        files: { "fix.txt": "fixed\n" },
        review: { findings: [{ severity: "critical", fixed: true, description: "Off-by-one in loop" }] },
      },
    });

    const result = await runWorkflow({ repoDir: repo.dir, agent, gate: ["test -f fix.txt"], log });

    expect(agent.calls.map((c) => c.stage)).toEqual(["implementer", "review-session"]);
    const review = agent.calls[1]!;
    expect(review.branch).toBe("issue/01-only");
    // The prompt carries the branch diff and the commits.
    expect(review.prompt).toContain("IMPLEMENTED-CONTENT-MARKER");
    expect(review.prompt).toContain("fake agent: implement issue");

    expect(result.outcome).toBe("awaiting-merge");
    expect(git(repo.dir, "log", "--format=%s", "main..issue/01-only").split("\n")).toEqual([
      "fake agent: fix critical finding",
      "fake agent: implement issue",
    ]);
  });

  it("appends Non-critical Findings under Comments and prints them with the branch and Gate result", async () => {
    const agent = fakeAgent(repo.dir, {
      review: {
        review: {
          findings: [
            { severity: "non-critical", fixed: false, description: "Rename `tmp` to `pending`" },
            { severity: "critical", fixed: true, description: "Fixed null dereference" },
            { severity: "non-critical", fixed: false, description: "Extract the retry loop" },
          ],
        },
      },
    });

    await runWorkflow({ repoDir: repo.dir, agent, gate: ["true"], log });

    const text = repo.read(`${ISSUES}/01-only.md`);
    const comments = text.slice(text.indexOf("## Comments"));
    expect(text.match(/^## Comments$/gm)).toHaveLength(1);
    expect(comments).toContain("Rename `tmp` to `pending`");
    expect(comments).toContain("Extract the retry loop");
    expect(comments).not.toContain("Fixed null dereference");

    const printed = output.join("\n");
    expect(printed).toContain("issue/01-only");
    expect(printed).toMatch(/gate: passed/i);
    expect(printed).toContain("Rename `tmp` to `pending`");
    expect(printed).toContain("Extract the retry loop");
  });

  it("appends under an existing Comments heading", async () => {
    repo.write(
      `${ISSUES}/01-only.md`,
      issueFile({ title: "01: Only", status: "ready-for-agent", extra: "Body.\n\n## Comments\n\nEarlier human note." }),
    );
    const agent = fakeAgent(repo.dir, {
      review: { review: { findings: [{ severity: "non-critical", fixed: false, description: "Tidy imports" }] } },
    });

    await runWorkflow({ repoDir: repo.dir, agent, gate: ["true"], log });

    const text = repo.read(`${ISSUES}/01-only.md`);
    expect(text.match(/^## Comments$/gm)).toHaveLength(1);
    expect(text.indexOf("Tidy imports")).toBeGreaterThan(text.indexOf("Earlier human note."));
  });

  it("prints the Gate result and Findings when the Gate fails too", async () => {
    const agent = fakeAgent(repo.dir, {
      review: { review: { findings: [{ severity: "non-critical", fixed: false, description: "Tidy imports" }] } },
    });

    await runWorkflow({ repoDir: repo.dir, agent, gate: ["false"], log });

    const printed = output.join("\n");
    expect(printed).toContain("issue/01-only");
    expect(printed).toMatch(/gate: failed/i);
    expect(printed).toContain("Tidy imports");
  });

  it("moves the Issue to needs-info, logs a Spec disagreement and skips the Gate", async () => {
    const agent = fakeAgent(repo.dir, {
      review: {
        review: {
          findings: [{ severity: "non-critical", fixed: false, description: "Tidy imports" }],
          specDisagreements: ["The Spec says retries are unbounded; that can loop forever"],
        },
      },
    });
    const gateRan = join(repo.dir, "gate-ran");

    const result = await runWorkflow({ repoDir: repo.dir, agent, gate: [`touch ${gateRan}`], log });

    expect(result.outcome).toBe("spec-disagreement");
    expect(existsSync(gateRan)).toBe(false);
    expect(statusOf(repo, "01-only.md")).toBe("needs-info");
    const text = repo.read(`${ISSUES}/01-only.md`);
    const comments = text.slice(text.indexOf("## Comments"));
    expect(comments).toContain("The Spec says retries are unbounded; that can loop forever");
    expect(comments).toContain("Tidy imports");
    const printed = output.join("\n");
    expect(printed).toContain("issue/01-only");
    expect(printed).toContain("The Spec says retries are unbounded; that can loop forever");
  });

  it("logs a Critical Finding the Review Session could not fix instead of dropping it", async () => {
    const agent = fakeAgent(repo.dir, {
      review: { review: { findings: [{ severity: "critical", fixed: false, description: "Race on shared cache" }] } },
    });

    await runWorkflow({ repoDir: repo.dir, agent, gate: ["true"], log });

    const text = repo.read(`${ISSUES}/01-only.md`);
    expect(text.slice(text.indexOf("## Comments"))).toContain("Race on shared cache");
    expect(output.join("\n")).toContain("Race on shared cache");
  });

  it("does not treat a Review Session without Findings as a clean review", async () => {
    const agent = fakeAgent(repo.dir, { review: { noFindings: true } });
    const gateRan = join(repo.dir, "gate-ran");

    await expect(runWorkflow({ repoDir: repo.dir, agent, gate: [`touch ${gateRan}`], log })).rejects.toThrow(
      /Review Session/,
    );

    expect(existsSync(gateRan)).toBe(false);
    expect(statusOf(repo, "01-only.md")).not.toBe("awaiting-merge");
  });
});
