import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { API_KEY, ENV_FILE, OAUTH_TOKEN } from "./auth.js";
import { PROJECT_CODING_STANDARDS } from "./coding-standards.js";
import { CONFIG_FILE, DEFAULT_CONFIG, isGate, type SandboxChoice } from "./config.js";
import { readOptional } from "./files.js";

export interface InitOptions {
  repoDir: string;
  /** Gate commands, in the order they run. */
  gate: string[];
  /** Defaults to the native sandbox for the OS, or Docker where the OS has none. */
  sandbox?: SandboxChoice;
  /** The OS Runs will use; defaults to this one. */
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
}

/** The native sandbox Sandcastle provides for each OS that has one. */
const NATIVE_SANDBOXES: Partial<Record<NodeJS.Platform, string>> = { darwin: "Seatbelt", linux: "bubblewrap" };

/** Makes a project ready for Runs. Never overwrites an existing file. */
export async function initProject({ repoDir, gate, sandbox, platform = process.platform, log = console.log }: InitOptions): Promise<void> {
  const native = NATIVE_SANDBOXES[platform];
  sandbox ??= native ? "native" : "docker";
  if (!isGate(gate)) {
    throw new Error(`Pass at least one Gate command, and no blank ones, e.g. --gate "npm test". Got ${JSON.stringify(gate)}.`);
  }
  if (sandbox === "native" && !native) throw new Error(`No native sandbox for ${platform}. Use --sandbox docker.`);

  const config = { gate, model: DEFAULT_CONFIG.model, effort: DEFAULT_CONFIG.effort, sandbox };
  const configWritten = await writeNew(repoDir, CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, log);
  await writeNew(repoDir, PROJECT_CODING_STANDARDS, PROJECT_CODING_STANDARDS_SKELETON, log);
  await writeNew(repoDir, ENV_EXAMPLE_FILE, ENV_EXAMPLE, log);
  await writeNew(repoDir, ISSUE_FORMAT_DOC, ISSUE_FORMAT, log);
  await addGitIgnoreEntries(repoDir, log);

  log("");
  if (configWritten) {
    log(`Sandbox: ${sandbox === "native" ? `${native} (native to ${platform})` : "Docker"}`);
    log(`Gate:    ${gate.join(" && ")}`);
  } else {
    log(`--gate and --sandbox were not applied: ${CONFIG_FILE} already exists. Edit it to change them.`);
  }
  log("");
  log("Next:");
  log(`  1. Run \`claude setup-token\` and put the token in ${ENV_FILE} as ${OAUTH_TOKEN}=...`);
  log(`     (see ${ENV_EXAMPLE_FILE}; set ${API_KEY} there instead to bill the API).`);
  log(`  2. Add rules for this codebase to ${PROJECT_CODING_STANDARDS}.`);
  log("  3. Write Issues under .scratch/<feature>/issues/, then run `npx sandcastle-pro run`.");
}

/** Appends the entries `.gitignore` lacks, creating it if needed. Existing lines are never changed. */
async function addGitIgnoreEntries(repoDir: string, log: (line: string) => void): Promise<void> {
  const path = join(repoDir, ".gitignore");
  const existing = await readOptional(path);
  const present = new Set((existing ?? "").split(/\r?\n/).map((line) => line.trim()));
  const missing = GIT_IGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) {
    log("skipped  .gitignore (already ignores the env file, logs and worktrees)");
    return;
  }
  const separator = existing === undefined || existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  await appendFile(path, `${separator}# sandcastle-pro\n${missing.join("\n")}\n`);
  log(`${existing === undefined ? "created " : "updated "} .gitignore (${missing.join(", ")})`);
}

/** Writes a file that doesn't exist yet and returns true, or leaves an existing one untouched and returns false. */
async function writeNew(repoDir: string, path: string, content: string, log: (line: string) => void): Promise<boolean> {
  const full = join(repoDir, path);
  if (existsSync(full)) {
    log(`skipped  ${path} (already exists)`);
    return false;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  log(`created  ${path}`);
  return true;
}

const ENV_EXAMPLE_FILE = ".sandcastle/.env.example";

/** Kept out of git: the real env file with the token, and Sandcastle's logs and worktrees. */
const GIT_IGNORE_ENTRIES = [ENV_FILE, ".sandcastle/logs/", ".sandcastle/worktrees/"];

const ENV_EXAMPLE = `# Copy this file to ${ENV_FILE} and fill in one credential. ${ENV_FILE} is git-ignored.

# Bills your Claude subscription (Pro or Max). Create it with: claude setup-token
${OAUTH_TOKEN}=

# Or bill the API instead. Used only when ${OAUTH_TOKEN} is empty.
# ${API_KEY}=
`;

const ISSUE_FORMAT_DOC = "docs/agents/sandcastle-pro-issues.md";

const ISSUE_FORMAT = `# Issue format for sandcastle-pro

Runs read Issues from local markdown files. Plan Specs and Issues in a normal Claude Code session;
a Run only implements and reviews them.

## Files

- One feature per directory: \`.scratch/<feature>/\`.
- The Spec is \`.scratch/<feature>/spec.md\`.
- One Issue per file: \`.scratch/<feature>/issues/NN-slug.md\`, numbered from \`01\`.
  The Run works on the Issue's own branch, \`issue/NN-slug\`.

## Lines near the top

- \`Status:\` the Issue's status (below). Required: an Issue without a known status is never picked.
- \`Blocked by:\` numbers of Issues in the same \`issues/\` directory that must be \`done\` first, e.g. \`Blocked by: 02, 05\`. Missing or \`None\` means unblocked.
- \`Spec:\` the Spec's path from the repo root, e.g. \`Spec: .scratch/<feature>/spec.md\`.
  Without it, \`spec.md\` next to the \`issues/\` directory is used.
- \`Model:\` optional; overrides the configured model for this Issue only, e.g. \`Model: claude-sonnet-5-5\`.
  Put it above any \`## Comments\` heading; below it, it is ignored.

The rest of the file describes the work: what to build, and a checklist of acceptance criteria.

## Statuses

Set by you:

- \`needs-triage\`: not yet evaluated.
- \`ready-for-agent\`: fully specified. A Run picks the lowest-numbered unblocked one.
- \`ready-for-human\`: needs a person. A Run also sets it when the Gate fails, leaving the branch as it is.
- \`wontfix\`: will not be done.

Set by a Run:

- \`in-progress\`: a Run is working on it.
- \`paused\`: the Run hit the usage limit. The next Run resumes it before any new Issue.
  The \`Paused session:\` and \`Paused stage:\` lines record where to continue; leave them alone.
- \`needs-info\`: the Review Session believes the Spec itself is wrong. Read its comment, fix the Spec or Issue, and set \`ready-for-agent\` again.
- \`awaiting-merge\`: passed the Gate. Review and merge \`issue/NN-slug\` yourself.
- \`done\`: its branch was merged into the target branch, detected at the start of the next Run.

## Comments

A Run appends Non-critical Findings, Gate failures and token usage under a \`## Comments\` heading at the
bottom of the file, creating it if needed.
`;

/**
 * The Project layer skeleton. Its guidance and examples are HTML comments, which the loader drops,
 * so the layer adds no rules until the user writes some.
 */
const PROJECT_CODING_STANDARDS_SKELETON = `# Project Coding Standards

<!--
Rules specific to this codebase. The Review Session checks every change against them, on top of
the Preset layer (shipped with sandcastle-pro) and your Personal layer
(~/.config/sandcastle-pro/CODING_STANDARDS.md). When rules conflict, this file wins.

Write one rule per list item. Delete the headings you don't need, or add your own.
Text inside HTML comments, like this one, is ignored.

Breaking a rule in this file is a Non-critical Finding: it is logged on the Issue for you to decide.
Only rules under the "## Must" heading at the bottom are fixed automatically.
-->

## Naming

<!--
- Database tables are plural snake_case, e.g. \`order_items\`.
- React components are PascalCase and live in a file of the same name.
-->

## Structure

<!--
- HTTP handlers only parse input and call a service; business logic lives in \`src/services/\`.
- No module in \`src/domain/\` imports from \`src/infra/\`.
-->

## Testing

<!--
- Every bug fix comes with a test that fails without the fix.
- Tests use the in-memory store, never the real database.
-->

## Must

<!--
Must Rules. Breaking one is a Critical Finding, which the Review Session fixes in the same pass,
so it costs tokens on every Issue that breaks it. Keep this list short: only rules worth that cost.

- Never log secrets, tokens or personal data.
- Every database migration is reversible.
-->
`;
