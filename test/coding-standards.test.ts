import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCodingStandards, PERSONAL_CODING_STANDARDS as PERSONAL, PROJECT_CODING_STANDARDS as PROJECT } from "../src/index.js";
import { createTempRepo, useTempHome, writeFile, type TempRepo } from "./helpers.js";

describe("Coding Standards loader", () => {
  const home = useTempHome();
  let repo: TempRepo;

  beforeEach(() => {
    repo = createTempRepo();
  });
  afterEach(() => repo.cleanup());

  it("orders the layers Project, Personal, Preset, highest precedence first", async () => {
    writeFile(home.dir, PERSONAL, "# Personal\n\n- PERSONAL-RULE\n");
    repo.write(PROJECT, "# Project\n\n- PROJECT-RULE\n");

    const layers = await loadCodingStandards(repo.dir);

    expect(layers.map((l) => l.name)).toEqual(["Project", "Personal", "Preset"]);
    expect(layers[0]!.rules).toContain("PROJECT-RULE");
    expect(layers[1]!.rules).toContain("PERSONAL-RULE");
    expect(layers[2]!.rules.trim()).not.toBe("");
  });

  it("skips a missing Personal or Project layer silently", async () => {
    expect((await loadCodingStandards(repo.dir)).map((l) => l.name)).toEqual(["Preset"]);

    writeFile(home.dir, PERSONAL, "- PERSONAL-RULE\n");
    expect((await loadCodingStandards(repo.dir)).map((l) => l.name)).toEqual(["Personal", "Preset"]);
  });

  it("identifies rules under a ## Must heading as Must Rules", async () => {
    repo.write(
      PROJECT,
      [
        "# Project standards",
        "",
        "## Must",
        "",
        "- Never call `fetch` directly; use the client.",
        "- Every exported function has a doc comment",
        "  explaining its contract.",
        "- Log through the logger:",
        "  - not `console.log`",
        "",
        "```sh",
        "# a shell comment, not a heading",
        "```",
        "",
        "### Notes",
        "",
        "- Still a Must Rule under a subheading.",
        "",
        "## Should",
        "",
        "- SHOULD-RULE",
        "",
      ].join("\n"),
    );

    const [project] = await loadCodingStandards(repo.dir);

    expect(project!.mustRules).toEqual([
      "Never call `fetch` directly; use the client.",
      "Every exported function has a doc comment explaining its contract.",
      "Log through the logger: - not `console.log`",
      "```sh # a shell comment, not a heading ```",
      "Still a Must Rule under a subheading.",
    ]);
    expect(project!.rules).toContain("SHOULD-RULE");
    expect(project!.rules).not.toContain("use the client");
  });
});
