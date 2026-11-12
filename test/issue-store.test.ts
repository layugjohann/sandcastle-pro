import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIssueStore } from "../src/index.js";
import { createTempRepo, issueFile, type TempRepo } from "./helpers.js";

const ISSUES = ".scratch/feature/issues";

describe("Issue Store", () => {
  let repo: TempRepo;
  beforeEach(() => (repo = createTempRepo()));
  afterEach(() => repo.cleanup());

  it("ignores Issues with a missing or unknown status", async () => {
    repo.write(`${ISSUES}/01-no-status.md`, issueFile({ title: "01: No status" }));
    repo.write(`${ISSUES}/02-weird.md`, issueFile({ title: "02: Weird", status: "someday-maybe" }));
    repo.write(`${ISSUES}/03-ready.md`, issueFile({ title: "03: Ready", status: "ready-for-agent" }));

    const issue = await createIssueStore(repo.dir).next();

    expect(issue?.id).toBe("03");
  });

  it("orders Issues numerically, not lexically", async () => {
    repo.write(`${ISSUES}/10-ten.md`, issueFile({ title: "10", status: "ready-for-agent" }));
    repo.write(`${ISSUES}/9-nine.md`, issueFile({ title: "9", status: "ready-for-agent" }));

    expect((await createIssueStore(repo.dir).next())?.branch).toBe("issue/9-nine");
  });

  it("finds the Spec next to the issues directory when there is no Spec line", async () => {
    repo.write(".scratch/feature/spec.md", "SPEC");
    repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\nStatus: ready-for-agent\n");

    expect((await createIssueStore(repo.dir).next())?.spec).toBe("SPEC");
  });

  it("appends a comment, creating the Comments heading if missing", async () => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01: A", status: "ready-for-agent" }));
    const store = createIssueStore(repo.dir);
    const issue = (await store.next())!;

    await store.comment(issue, "first note");
    await store.comment(issue, "second note");

    const text = repo.read(`${ISSUES}/01-a.md`);
    expect(text.match(/^## Comments$/gm)).toHaveLength(1);
    expect(text.indexOf("first note")).toBeGreaterThan(text.indexOf("## Comments"));
    expect(text.indexOf("second note")).toBeGreaterThan(text.indexOf("first note"));
  });

  it("transitions an Issue that has no Status line by adding one", async () => {
    repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\nStatus: ready-for-agent\n\nBody\n");
    const store = createIssueStore(repo.dir);
    const issue = (await store.next())!;
    repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\nBody\n");

    await store.transition(issue, "in-progress");

    expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(/^Status: in-progress$/m);
    expect(repo.read(`${ISSUES}/01-a.md`)).toContain("Body");
  });

  it.each([
    ["no Blocked by line", "Do the thing."],
    ["Blocked by: None", "Blocked by: None - can start immediately"],
  ])("treats an Issue with %s as unblocked", async (_label, extra) => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01: A", status: "ready-for-agent", extra }));

    expect((await createIssueStore(repo.dir).next())?.id).toBe("01");
  });

  it("reads blockers listed with prose after the numbers", async () => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01", status: "done" }));
    repo.write(`${ISSUES}/02-b.md`, issueFile({ title: "02", status: "in-progress" }));
    repo.write(`${ISSUES}/03-c.md`, issueFile({ title: "03", status: "ready-for-agent", extra: "Blocked by: 01 (tracer) and #02" }));

    expect(await createIssueStore(repo.dir).next()).toBeNull();
  });

  it.each(["Issue 01", "see 01", "the auth work"])("keeps an Issue blocked by %s until it is done", async (line) => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01", status: "in-progress" }));
    repo.write(`${ISSUES}/02-b.md`, issueFile({ title: "02", status: "ready-for-agent", extra: `Blocked by: ${line}` }));

    expect(await createIssueStore(repo.dir).next()).toBeNull();
  });

  it.each([
    ["Model: claude-haiku-5-5", "claude-haiku-5-5"],
    ["Model: `claude-haiku-5-5`", "claude-haiku-5-5"],
    ["Model:", undefined],
    ["", undefined],
    ["## Comments\n\nModel: claude-haiku-5-5", undefined],
  ])("reads the model from %j", async (line, model) => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01: A", status: "ready-for-agent", extra: line }));

    expect((await createIssueStore(repo.dir).next())?.model).toBe(model);
  });

  describe("paused Issues", () => {
    const path = `${ISSUES}/01-a.md`;
    const paused = (record: string, extra?: string) =>
      issueFile({ title: "01: A", status: record ? `paused\n${record}` : "paused", extra });

    it("pause() records the session and stage, and next() reads them back", async () => {
      repo.write(path, issueFile({ title: "01: A", status: "ready-for-agent" }));
      const store = createIssueStore(repo.dir);

      await store.pause((await store.next())!, { sessionId: "sess-1", stage: "review-session" });

      expect(repo.read(path)).toMatch(/^Status: paused\nPaused session: sess-1\nPaused stage: Review Session$/m);
      expect((await store.next())?.paused).toEqual({ sessionId: "sess-1", stage: "review-session" });
    });

    it("drops the pause record when the Issue leaves paused", async () => {
      repo.write(path, paused("Paused session: sess-1\nPaused stage: Implementer"));
      const store = createIssueStore(repo.dir);

      await store.transition((await store.next())!, "in-progress");

      expect(repo.read(path)).toMatch(/^Status: in-progress$/m);
      expect(repo.read(path)).not.toMatch(/Paused/);
    });

    it.each([
      ["no record", ""],
      ["no stage", "Paused session: sess-1"],
      ["an unknown stage", "Paused session: sess-1\nPaused stage: Gate"],
    ])("reads a paused Issue with %s as having nothing to resume", async (_, record) => {
      repo.write(path, paused(record));

      const issue = await createIssueStore(repo.dir).next();

      expect(issue?.id).toBe("01");
      expect(issue?.paused).toBeUndefined();
    });

    it("ignores pause lines under Comments", async () => {
      repo.write(path, paused("", "## Comments\n\nPaused session: sess-x\nPaused stage: Implementer"));

      expect((await createIssueStore(repo.dir).next())?.paused).toBeUndefined();
    });
  });
});
