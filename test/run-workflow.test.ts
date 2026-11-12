import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONAL_CODING_STANDARDS, PROJECT_CODING_STANDARDS, runWorkflow } from "../src/index.js";
import {
  configWithGate,
  createTempRepo,
  fakeAgent,
  git,
  issueFile,
  useTempHome,
  writeFile,
  type TempRepo,
} from "./helpers.js";

const ISSUES = ".scratch/feature/issues";

const home = useTempHome();

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
    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true", "test -f feature.txt"]), log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
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
    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    expect(statusDuringRun).toBe("in-progress");
  });

  it("gives an Issue's Model line to both of its stages, and only to that Issue", async () => {
    repo.write(
      `${ISSUES}/01-cheap.md`,
      issueFile({ title: "01: Cheap", status: "ready-for-agent", extra: "Model: claude-haiku-5-5\n\nEasy work." }),
    );
    repo.write(`${ISSUES}/02-default.md`, issueFile({ title: "02: Default", status: "ready-for-agent" }));
    repo.commitAll("add issues");

    const agent = fakeAgent(repo.dir);
    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), count: 2, log });

    expect(agent.calls.map((c) => [c.branch, c.stage, c.model])).toEqual([
      ["issue/01-cheap", "implementer", "claude-haiku-5-5"],
      ["issue/01-cheap", "review-session", "claude-haiku-5-5"],
      ["issue/02-default", "implementer", "claude-opus-5-5"],
      ["issue/02-default", "review-session", "claude-opus-5-5"],
    ]);
  });

  it("works without a GLOSSARY.md", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
    expect(statusOf(repo, "01-only.md")).toBe("awaiting-merge");
  });

  it("moves an Issue that fails the Gate to ready-for-human with the output in its comments, keeping its branch", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      config: configWithGate(["echo FIRST-OK", "echo GATE-BOOM-MARKER && false"]),
      log,
    });

    expect(statusOf(repo, "01-only.md")).toBe("ready-for-human");
    const text = repo.read(`${ISSUES}/01-only.md`);
    const comments = text.slice(text.indexOf("## Comments"));
    expect(comments).toContain("FIRST-OK");
    expect(comments).toContain("GATE-BOOM-MARKER");
    expect(git(repo.dir, "log", "--format=%s", "main..issue/01-only")).toBe("fake agent: implement issue");
  });

  it("runs the Gate commands in order and stops at the first failure", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");
    const ranAfterFailure = join(repo.dir, "ran-after-failure");

    await runWorkflow({
      repoDir: repo.dir,
      agent: fakeAgent(repo.dir),
      config: configWithGate(["echo STEP-ONE", "echo STEP-TWO && false", `touch ${ranAfterFailure}`]),
      log,
    });

    expect(existsSync(ranAfterFailure)).toBe(false);
    const text = repo.read(`${ISSUES}/01-only.md`);
    const comments = text.slice(text.indexOf("## Comments"));
    expect(comments.indexOf("STEP-ONE")).toBeGreaterThan(-1);
    expect(comments.indexOf("STEP-ONE")).toBeLessThan(comments.indexOf("STEP-TWO"));
  });

  it("processes exactly one Issue by default", async () => {
    repo.write(`${ISSUES}/01-first.md`, issueFile({ title: "01: First", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/02-second.md`, issueFile({ title: "02: Second", status: "ready-for-agent" }));
    repo.commitAll("add issues");

    await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });

    expect(statusOf(repo, "01-first.md")).toBe("awaiting-merge");
    expect(statusOf(repo, "02-second.md")).toBe("ready-for-agent");
  });

  it("processes up to N Issues one after another with count N", async () => {
    repo.write(`${ISSUES}/01-first.md`, issueFile({ title: "01: First", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/02-second.md`, issueFile({ title: "02: Second", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/03-third.md`, issueFile({ title: "03: Third", status: "ready-for-agent" }));
    repo.commitAll("add issues");

    // Sequential: each Issue is already finished when the next one starts.
    const statusesAtSecondStart: (string | undefined)[] = [];
    const agent = fakeAgent(repo.dir, {
      onCall: (call) => {
        if (call.stage === "implementer" && call.branch === "issue/02-second") {
          statusesAtSecondStart.push(statusOf(repo, "01-first.md"));
        }
      },
    });
    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), count: 2, log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge", "awaiting-merge"]);
    expect(statusOf(repo, "01-first.md")).toBe("awaiting-merge");
    expect(statusOf(repo, "02-second.md")).toBe("awaiting-merge");
    expect(statusOf(repo, "03-third.md")).toBe("ready-for-agent");
    expect(statusesAtSecondStart).toEqual(["awaiting-merge"]);
    expect(agent.calls.map((c) => `${c.stage} ${c.branch}`)).toEqual([
      "implementer issue/01-first",
      "review-session issue/01-first",
      "implementer issue/02-second",
      "review-session issue/02-second",
    ]);
  });

  it("stops before the next Issue when the Gate fails, even with count N", async () => {
    repo.write(`${ISSUES}/01-first.md`, issueFile({ title: "01: First", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/02-second.md`, issueFile({ title: "02: Second", status: "ready-for-agent" }));
    repo.commitAll("add issues");

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["false"]), count: 3, log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["gate-failed"]);
    expect(statusOf(repo, "01-first.md")).toBe("ready-for-human");
    expect(statusOf(repo, "02-second.md")).toBe("ready-for-agent");
    expect(git(repo.dir, "branch", "--list", "issue/02-second")).toBe("");
  });

  it("stops early when fewer than N Issues are ready", async () => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), count: 3, log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
    expect(output.join("\n")).toMatch(/no issue is ready/i);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects count %s before touching any Issue", async (count) => {
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");

    const agent = fakeAgent(repo.dir);
    await expect(runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), count, log })).rejects.toThrow(/count/);

    expect(agent.calls).toHaveLength(0);
    expect(statusOf(repo, "01-only.md")).toBe("ready-for-agent");
  });

  it("exits cleanly with a message and changes nothing when no Issue is ready", async () => {
    repo.write(`${ISSUES}/01-triage.md`, issueFile({ title: "01: Triage", status: "needs-triage" }));
    repo.write(`${ISSUES}/02-done.md`, issueFile({ title: "02: Done", status: "awaiting-merge" }));
    repo.commitAll("add issues");

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    expect(output.join("\n")).toMatch(/no issue is ready/i);
    expect(git(repo.dir, "status", "--porcelain")).toBe("");
    expect(git(repo.dir, "branch", "--list", "issue/*")).toBe("");
  });

  it("exits cleanly when there is no .scratch directory at all", async () => {
    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });
    expect(result.issues).toEqual([]);
  });
});

describe("Blocked Issues and merge detection", () => {
  let repo: TempRepo;
  let output: string[];
  const log = (line: string) => output.push(line);
  const blockedBy = (ids: string) => `Blocked by: ${ids}\n\nDo the thing.`;

  beforeEach(() => {
    repo = createTempRepo();
    output = [];
    repo.write(".scratch/feature/spec.md", "# Spec: feature\n");
  });
  afterEach(() => repo.cleanup());

  it("skips an Issue with an unfinished blocker and picks the next eligible one", async () => {
    repo.write(`${ISSUES}/01-base.md`, issueFile({ title: "01: Base", status: "needs-info" }));
    repo.write(`${ISSUES}/02-done.md`, issueFile({ title: "02: Done", status: "done" }));
    repo.write(`${ISSUES}/03-blocked.md`, issueFile({ title: "03", status: "ready-for-agent", extra: blockedBy("01, 02") }));
    repo.write(`${ISSUES}/04-free.md`, issueFile({ title: "04", status: "ready-for-agent", extra: blockedBy("02") }));
    repo.commitAll("add issues");

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });

    expect(result.issues.map((r) => r.issue.id)).toEqual(["04"]);
    expect(statusOf(repo, "03-blocked.md")).toBe("ready-for-agent");
  });

  it("exits cleanly and lists the blocked Issues when every ready Issue is blocked", async () => {
    repo.write(`${ISSUES}/01-base.md`, issueFile({ title: "01", status: "in-progress" }));
    repo.write(`${ISSUES}/02-waits.md`, issueFile({ title: "02", status: "ready-for-agent", extra: blockedBy("01") }));
    repo.write(`${ISSUES}/03-waits.md`, issueFile({ title: "03", status: "ready-for-agent", extra: blockedBy("01, 02") }));
    repo.commitAll("add issues");

    const agent = fakeAgent(repo.dir);
    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    expect(result.issues).toEqual([]);
    expect(agent.calls).toHaveLength(0);
    const printed = output.join("\n");
    expect(printed).toMatch(/no issue is ready/i);
    expect(printed).toContain("Issue 02 is blocked by 01");
    expect(printed).toContain("Issue 03 is blocked by 01, 02");
  });

  /** Gives `branch` one commit off main, and merges it into main when `merged`. */
  function branchWithWork(branch: string, merged: boolean): void {
    git(repo.dir, "checkout", "-q", "-b", branch);
    repo.write(`${branch.replace("/", "-")}.txt`, "work\n");
    repo.commitAll(`work on ${branch}`);
    git(repo.dir, "checkout", "-q", "main");
    if (merged) git(repo.dir, "merge", "-q", "--no-ff", "-m", `merge ${branch}`, branch);
  }

  it("moves an awaiting-merge Issue whose branch is merged to done at the start of the Run", async () => {
    repo.write(`${ISSUES}/01-merged.md`, issueFile({ title: "01", status: "awaiting-merge" }));
    repo.commitAll("add issues");
    branchWithWork("issue/01-merged", true);

    const agent = fakeAgent(repo.dir);
    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    expect(statusOf(repo, "01-merged.md")).toBe("done");
    expect(agent.calls).toHaveLength(0);
  });

  it("picks an Issue unblocked by that merge in the same Run", async () => {
    repo.write(`${ISSUES}/01-merged.md`, issueFile({ title: "01", status: "awaiting-merge" }));
    repo.write(`${ISSUES}/02-dependent.md`, issueFile({ title: "02", status: "ready-for-agent", extra: blockedBy("01") }));
    repo.commitAll("add issues");
    branchWithWork("issue/01-merged", true);

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });

    expect(result.issues.map((r) => r.issue.id)).toEqual(["02"]);
    expect(statusOf(repo, "02-dependent.md")).toBe("awaiting-merge");
  });

  it("leaves an awaiting-merge Issue alone while its branch is unmerged", async () => {
    repo.write(`${ISSUES}/01-pending.md`, issueFile({ title: "01", status: "awaiting-merge" }));
    repo.write(`${ISSUES}/02-dependent.md`, issueFile({ title: "02", status: "ready-for-agent", extra: blockedBy("01") }));
    repo.commitAll("add issues");
    branchWithWork("issue/01-pending", false);

    const result = await runWorkflow({ repoDir: repo.dir, agent: fakeAgent(repo.dir), config: configWithGate(["true"]), log });

    expect(result.issues).toEqual([]);
    expect(statusOf(repo, "01-pending.md")).toBe("awaiting-merge");
    expect(statusOf(repo, "02-dependent.md")).toBe("ready-for-agent");
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

    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["test -f fix.txt"]), log });

    expect(agent.calls.map((c) => c.stage)).toEqual(["implementer", "review-session"]);
    const review = agent.calls[1]!;
    expect(review.branch).toBe("issue/01-only");
    // The prompt carries the branch diff and the commits.
    expect(review.prompt).toContain("IMPLEMENTED-CONTENT-MARKER");
    expect(review.prompt).toContain("fake agent: implement issue");

    expect(result.issues.map((r) => r.outcome)).toEqual(["awaiting-merge"]);
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

    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

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

    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    const text = repo.read(`${ISSUES}/01-only.md`);
    expect(text.match(/^## Comments$/gm)).toHaveLength(1);
    expect(text.indexOf("Tidy imports")).toBeGreaterThan(text.indexOf("Earlier human note."));
  });

  it("prints the Gate result and Findings when the Gate fails too", async () => {
    const agent = fakeAgent(repo.dir, {
      review: { review: { findings: [{ severity: "non-critical", fixed: false, description: "Tidy imports" }] } },
    });

    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["false"]), log });

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

    const result = await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate([`touch ${gateRan}`]), log });

    expect(result.issues.map((r) => r.outcome)).toEqual(["spec-disagreement"]);
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

    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log });

    const text = repo.read(`${ISSUES}/01-only.md`);
    expect(text.slice(text.indexOf("## Comments"))).toContain("Race on shared cache");
    expect(output.join("\n")).toContain("Race on shared cache");
  });

  it("does not treat a Review Session without Findings as a clean review", async () => {
    const agent = fakeAgent(repo.dir, { review: { noFindings: true } });
    const gateRan = join(repo.dir, "gate-ran");

    await expect(runWorkflow({ repoDir: repo.dir, agent, config: configWithGate([`touch ${gateRan}`]), log })).rejects.toThrow(
      /Review Session/,
    );

    expect(existsSync(gateRan)).toBe(false);
    expect(statusOf(repo, "01-only.md")).not.toBe("awaiting-merge");
  });
});

describe("Coding Standards", () => {
  let repo: TempRepo;

  beforeEach(() => {
    repo = createTempRepo();
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
    repo.commitAll("add issue");
  });
  afterEach(() => repo.cleanup());

  it("gives the Review Session every layer, Project first, and the Implementer none", async () => {
    writeFile(home.dir, PERSONAL_CODING_STANDARDS, "# Mine\n\n- PERSONAL-RULE\n\n## Must\n\n- PERSONAL-MUST\n");
    repo.write(PROJECT_CODING_STANDARDS, "# Ours\n\n## Must\n\n- PROJECT-MUST\n\n## Style\n\n- PROJECT-RULE\n");
    repo.commitAll("add standards");

    const agent = fakeAgent(repo.dir);
    await runWorkflow({ repoDir: repo.dir, agent, config: configWithGate(["true"]), log: () => {} });

    const [implementer, review] = agent.calls.map((c) => c.prompt);
    for (const marker of ["PERSONAL-RULE", "PERSONAL-MUST", "PROJECT-MUST", "PROJECT-RULE", "Preset Coding Standards"]) {
      expect(review).toContain(marker);
      expect(implementer).not.toContain(marker);
    }
    const project = review!.indexOf("PROJECT-RULE");
    const personal = review!.indexOf("PERSONAL-RULE");
    const preset = review!.indexOf("Preset Coding Standards");
    expect(project).toBeLessThan(personal);
    expect(personal).toBeLessThan(preset);
  });
});
