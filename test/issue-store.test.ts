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

  it("records a Pull Request line under Status, replaces an earlier one, and ignores one under Comments", async () => {
    repo.write(`${ISSUES}/01-a.md`, issueFile({ title: "01: A", status: "awaiting-merge" }));
    const store = createIssueStore(repo.dir);
    const [issue] = await store.awaitingMerge();
    expect(issue!.pullRequest).toBeUndefined();

    await store.comment(issue!, "Pull Request: https://example.com/in-a-comment");
    expect((await store.awaitingMerge())[0]!.pullRequest).toBeUndefined();

    await store.recordPullRequest(issue!, "https://github.com/o/r/pull/1");
    await store.recordPullRequest(issue!, "https://github.com/o/r/pull/2");

    const text = repo.read(`${ISSUES}/01-a.md`);
    expect(text).toMatch(/^Status: awaiting-merge\nPull Request: https:\/\/github\.com\/o\/r\/pull\/2$/m);
    expect(text).not.toContain("pull/1");
    expect(text).toContain("Pull Request: https://example.com/in-a-comment");
    expect((await store.awaitingMerge())[0]!.pullRequest).toBe("https://github.com/o/r/pull/2");
  });

  it("takes the title from the heading without its number", async () => {
    repo.write(`${ISSUES}/01-a.md`, "# 01: Do the thing\n\nStatus: ready-for-agent\n");
    repo.write(`${ISSUES}/02-no-heading.md`, "Status: ready-for-agent\n");
    const store = createIssueStore(repo.dir);

    expect((await store.next())?.title).toBe("Do the thing");
    await store.transition((await store.next())!, "done");
    expect((await store.next())?.title).toBe("no heading");
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

  describe("bold header lines", () => {
    it.each(["**Status:** ready-for-agent", "**Status**: ready-for-agent"])("next() picks an Issue written as %j", async (line) => {
      repo.write(`${ISSUES}/01-a.md`, `# 01: A\n\n${line}\n`);

      expect((await createIssueStore(repo.dir).next())?.id).toBe("01");
    });

    it("holds back an Issue with a bold Blocked by line until its blocker is done", async () => {
      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\n**Status:** in-progress\n");
      repo.write(`${ISSUES}/02-b.md`, "# 02: B\n\n**Status:** ready-for-agent\n**Blocked by:** 01\n");
      const store = createIssueStore(repo.dir);

      expect(await store.next()).toBeNull();
      expect(await store.blocked()).toEqual([{ id: "02", blockers: ["01"] }]);

      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\n**Status:** done\n");

      expect((await store.next())?.id).toBe("02");
    });

    it.each([
      ["**Status:** ready-for-agent", "**Status:** awaiting-merge"],
      ["**Status**: ready-for-agent", "**Status**: awaiting-merge"],
    ])("transition() keeps %j bold and reads it back", async (line, expected) => {
      repo.write(`${ISSUES}/01-a.md`, `# 01: A\n\n${line}\n`);
      const store = createIssueStore(repo.dir);

      await store.transition((await store.next())!, "awaiting-merge");

      expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(new RegExp(`^${expected.replaceAll("*", "\\*")}$`, "m"));
      expect((await store.awaitingMerge())[0]?.status).toBe("awaiting-merge");
    });

    it("pause() keeps a bold Status bold, adds a plain pause record, and next() reads it back", async () => {
      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\n**Status:** ready-for-agent\n");
      const store = createIssueStore(repo.dir);

      await store.pause((await store.next())!, { sessionId: "sess-1", stage: "implementer" });

      expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(/^\*\*Status:\*\* paused\nPaused session: sess-1\nPaused stage: Implementer$/m);
      expect((await store.next())?.paused).toEqual({ sessionId: "sess-1", stage: "implementer" });
    });

    it("pause() rewrites a bold pause record in bold, and leaving paused drops it", async () => {
      repo.write(
        `${ISSUES}/01-a.md`,
        "# 01: A\n\n**Status:** paused\n**Paused session:** sess-1\n**Paused stage:** Implementer\n",
      );
      const store = createIssueStore(repo.dir);
      expect((await store.next())?.paused).toEqual({ sessionId: "sess-1", stage: "implementer" });

      await store.pause((await store.next())!, { sessionId: "sess-2", stage: "review-session" });

      expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(
        /^\*\*Status:\*\* paused\n\*\*Paused session:\*\* sess-2\n\*\*Paused stage:\*\* Review Session$/m,
      );
      expect(repo.read(`${ISSUES}/01-a.md`)).not.toContain("sess-1");

      await store.transition((await store.next())!, "in-progress");

      expect(repo.read(`${ISSUES}/01-a.md`)).not.toMatch(/Paused/);
    });

    it("reads a bold Pull Request line and keeps it bold when replacing it", async () => {
      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\n**Status:** awaiting-merge\n**Pull Request:** https://github.com/o/r/pull/1\n");
      const store = createIssueStore(repo.dir);
      const [issue] = await store.awaitingMerge();
      expect(issue?.pullRequest).toBe("https://github.com/o/r/pull/1");

      await store.recordPullRequest(issue!, "https://github.com/o/r/pull/2");

      expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(/^\*\*Pull Request:\*\* https:\/\/github\.com\/o\/r\/pull\/2$/m);
      expect(repo.read(`${ISSUES}/01-a.md`)).not.toContain("pull/1");
    });

    it.each(["**Model:** claude-haiku-5-5", "**Model**: `claude-haiku-5-5`"])("reads the model from %j", async (line) => {
      repo.write(`${ISSUES}/01-a.md`, `# 01: A\n\n**Status:** ready-for-agent\n${line}\n`);

      expect((await createIssueStore(repo.dir).next())?.model).toBe("claude-haiku-5-5");
    });

    it("reads the Spec from a bold Spec line", async () => {
      repo.write(".scratch/elsewhere/spec.md", "OTHER SPEC");
      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\n**Status:** ready-for-agent\n**Spec:** `.scratch/elsewhere/spec.md`\n");

      expect((await createIssueStore(repo.dir).next())?.spec).toBe("OTHER SPEC");
    });

    it("works through a mix of bold and plain Issues in one directory", async () => {
      repo.write(`${ISSUES}/01-a.md`, "# 01: A\n\nStatus: ready-for-agent\n");
      repo.write(`${ISSUES}/02-b.md`, "# 02: B\n\n**Status:** ready-for-agent\n**Blocked by:** 01\n");
      repo.write(`${ISSUES}/03-c.md`, "# 03: C\n\nStatus: ready-for-agent\nBlocked by: 02\n");
      const store = createIssueStore(repo.dir);

      const picked: string[] = [];
      for (let issue = await store.next(); issue; issue = await store.next()) {
        picked.push(issue.id);
        await store.transition(issue, "done");
      }

      expect(picked).toEqual(["01", "02", "03"]);
      expect(repo.read(`${ISSUES}/01-a.md`)).toMatch(/^Status: done$/m);
      expect(repo.read(`${ISSUES}/02-b.md`)).toMatch(/^\*\*Status:\*\* done$/m);
      expect(repo.read(`${ISSUES}/03-c.md`)).toMatch(/^Status: done$/m);
    });
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
