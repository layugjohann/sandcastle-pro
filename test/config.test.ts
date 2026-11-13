import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, runWorkflow } from "../src/index.js";
import { createTempRepo, fakeAgent, issueFile, type TempRepo } from "./helpers.js";

const ISSUES = ".scratch/feature/issues";
const CONFIG = "sandcastle-pro.config.json";

describe("Project config", () => {
  let repo: TempRepo;
  const log = () => {};

  beforeEach(() => {
    repo = createTempRepo();
    repo.write(`${ISSUES}/01-only.md`, issueFile({ title: "01: Only", status: "ready-for-agent" }));
  });
  afterEach(() => repo.cleanup());

  it("gives the Agent the default model, effort and iteration limits when the config only sets the Gate", async () => {
    const gateRan = join(repo.dir, "gate-ran");
    repo.write(CONFIG, JSON.stringify({ gate: [`touch ${gateRan}`] }));
    repo.commitAll("setup");

    const agent = fakeAgent(repo.dir);
    await runWorkflow({ repoDir: repo.dir, agent, log });

    expect(agent.calls.map((c) => [c.stage, c.model, c.effort, c.maxIterations])).toEqual([
      ["implementer", "claude-opus-5-5", "medium", 3],
      ["review-session", "claude-opus-5-5", "medium", 1],
    ]);
    expect(existsSync(gateRan)).toBe(true);
  });

  it("changes the default model, effort and iteration limits for both stages", async () => {
    repo.write(
      CONFIG,
      JSON.stringify({
        gate: ["true"],
        model: "claude-sonnet-5-5",
        effort: "high",
        maxIterations: { implementer: 5, reviewSession: 2 },
      }),
    );
    repo.commitAll("setup");

    const agent = fakeAgent(repo.dir);
    await runWorkflow({ repoDir: repo.dir, agent, log });

    expect(agent.calls.map((c) => [c.stage, c.model, c.effort, c.maxIterations])).toEqual([
      ["implementer", "claude-sonnet-5-5", "high", 5],
      ["review-session", "claude-sonnet-5-5", "high", 2],
    ]);
  });

  it("stops before touching any Issue when the config is missing", async () => {
    repo.commitAll("setup");
    const agent = fakeAgent(repo.dir);

    await expect(runWorkflow({ repoDir: repo.dir, agent, log })).rejects.toThrow(
      /No sandcastle-pro\.config\.json .*sandcastle-pro init/,
    );
    expect(agent.calls).toEqual([]);
    expect(repo.read(`${ISSUES}/01-only.md`)).toContain("Status: ready-for-agent");
  });

  it.each([
    ["not JSON", "{ gate: ", /not valid JSON/],
    ["not an object", "[]", /must be a JSON object/],
    ["no gate", "{}", /missing "gate"/],
    ["gate not a list", `{"gate": "npm test"}`, /"gate" must be a non-empty list/],
    ["empty gate command", `{"gate": ["npm test", ""]}`, /"gate" must be a non-empty list/],
    ["no gate commands", `{"gate": []}`, /"gate" must be a non-empty list/],
    ["unknown effort", `{"gate": ["true"], "effort": "huge"}`, /"effort" must be one of low, medium, high, xhigh, max, got "huge"/],
    ["empty model", `{"gate": ["true"], "model": ""}`, /"model" must be a non-empty string/],
    ["zero iterations", `{"gate": ["true"], "maxIterations": {"implementer": 0}}`, /"maxIterations.implementer" must be a positive whole number, got 0/],
    ["misspelt key", `{"gate": ["true"], "modle": "x"}`, /unknown key "modle"/],
    ["unknown sandbox", `{"gate": ["true"], "sandbox": "vm"}`, /"sandbox" must be one of native, docker, got "vm"/],
    ["pullRequest not a boolean", `{"gate": ["true"], "pullRequest": "yes"}`, /"pullRequest" must be true or false, got "yes"/],
    ["misspelt pullRequest", `{"gate": ["true"], "pullRequests": true}`, /unknown key "pullRequests"/],
    ["misspelt limit", `{"gate": ["true"], "maxIterations": {"review": 2}}`, /unknown key "maxIterations.review"/],
  ])("names the problem when the config has %s", async (_case, text, problem) => {
    repo.write(CONFIG, text);
    repo.commitAll("setup");
    const agent = fakeAgent(repo.dir);

    const run = runWorkflow({ repoDir: repo.dir, agent, log });

    await expect(run).rejects.toThrow(/^sandcastle-pro\.config\.json /);
    await expect(run).rejects.toThrow(problem);
    expect(agent.calls).toEqual([]);
  });

  it("uses the native sandbox for the OS unless the config asks for Docker", async () => {
    repo.write(CONFIG, JSON.stringify({ gate: ["true"] }));
    expect((await loadConfig(repo.dir)).sandbox).toBe("native");

    repo.write(CONFIG, JSON.stringify({ gate: ["true"], sandbox: "docker" }));
    expect((await loadConfig(repo.dir)).sandbox).toBe("docker");
  });

  it("leaves Pull Requests off unless the config turns them on", async () => {
    repo.write(CONFIG, JSON.stringify({ gate: ["true"] }));
    expect((await loadConfig(repo.dir)).pullRequest).toBe(false);

    repo.write(CONFIG, JSON.stringify({ gate: ["true"], pullRequest: true }));
    expect((await loadConfig(repo.dir)).pullRequest).toBe(true);

    repo.write(CONFIG, JSON.stringify({ gate: ["true"], pullRequest: false }));
    expect((await loadConfig(repo.dir)).pullRequest).toBe(false);
  });
});
