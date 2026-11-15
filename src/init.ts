import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { API_KEY, ENV_FILE, OAUTH_TOKEN } from "./auth.js";
import { PROJECT_CODING_STANDARDS } from "./coding-standards.js";
import { CONFIG_FILE, DEFAULT_CONFIG, isGate, type SandboxChoice } from "./config.js";
import { readOptional } from "./files.js";
import { detectGate } from "./gate-detection.js";

export interface InitOptions {
  repoDir: string;
  /** Gate commands, in the order they run. Detected from the project when omitted. */
  gate?: string[];
  /** Defaults to the native sandbox for the OS, or Docker where the OS has none. */
  sandbox?: SandboxChoice;
  /** The OS Runs will use; defaults to this one. */
  platform?: NodeJS.Platform;
  /**
   * Asks the user a question and resolves to their answer. When given, the detected Gate commands are
   * confirmed or edited interactively; when omitted, they are used as detected.
   */
  ask?: (question: string) => Promise<string>;
  /** Whether `gh auth status` succeeds. Defaults to running it. Asked only when `origin` is on GitHub. */
  ghAuthenticated?: () => Promise<boolean>;
  log?: (line: string) => void;
}

const exec = promisify(execFile);

/** The native sandbox Sandcastle provides for each OS that has one. */
const NATIVE_SANDBOXES: Partial<Record<NodeJS.Platform, string>> = { darwin: "Seatbelt", linux: "bubblewrap" };

/** Makes a project ready for Runs. Never overwrites an existing file. */
export async function initProject({
  repoDir,
  gate,
  sandbox,
  platform = process.platform,
  ask,
  ghAuthenticated = ghAuthStatus,
  log = console.log,
}: InitOptions): Promise<void> {
  const native = NATIVE_SANDBOXES[platform];
  sandbox ??= native ? "native" : "docker";
  if (gate !== undefined && !isGate(gate)) {
    throw new Error(`Pass at least one Gate command, and no blank ones, e.g. --gate "npm test". Got ${JSON.stringify(gate)}.`);
  }
  if (sandbox === "native" && !native) throw new Error(`No native sandbox for ${platform}. Use --sandbox docker.`);

  // An existing config is kept, so there is nothing to detect or ask.
  const configExists = existsSync(join(repoDir, CONFIG_FILE));
  let pullRequest = false;
  if (!configExists) {
    gate ??= await chooseGate(await detectGate(repoDir), ask, log);
    // Offered only where publishing can work; elsewhere the setting stays off without a word.
    if (await canPublish(repoDir, ghAuthenticated)) pullRequest = await choosePullRequest(ask, log);
    const config = {
      gate,
      model: DEFAULT_CONFIG.model,
      effort: DEFAULT_CONFIG.effort,
      sandbox,
      ...(pullRequest ? { pullRequest, bodyWriter: DEFAULT_CONFIG.bodyWriter } : {}),
    };
    await writeNew(repoDir, CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, log);
  } else {
    log(`skipped  ${CONFIG_FILE} (already exists)`);
  }
  await writeNew(repoDir, PROJECT_CODING_STANDARDS, PROJECT_CODING_STANDARDS_SKELETON, log);
  await writeNew(repoDir, ENV_EXAMPLE_FILE, ENV_EXAMPLE, log);
  await writeNew(repoDir, ISSUE_FORMAT_DOC, ISSUE_FORMAT, log);
  await addGitIgnoreEntries(repoDir, log);

  log("");
  if (gate !== undefined && !configExists) {
    log(`Sandbox: ${sandbox === "native" ? `${native} (native to ${platform})` : "Docker"}`);
    log(`Gate:    ${gate.join(" && ")}`);
    if (pullRequest) {
      const { model, effort } = DEFAULT_CONFIG.bodyWriter;
      log(`Pull Requests: on; each Issue that passes the Gate is published, its body written by ${model} at ${effort} effort.`);
    }
  } else {
    log(`Kept the Gate and sandbox in the existing ${CONFIG_FILE}; edit it to change them.`);
  }
  log("");
  log("Next:");
  log(`  1. Run \`claude setup-token\` and put the token in ${ENV_FILE} as ${OAUTH_TOKEN}=...`);
  log(`     (see ${ENV_EXAMPLE_FILE}; set ${API_KEY} there instead to bill the API).`);
  log(`  2. Add rules for this codebase to ${PROJECT_CODING_STANDARDS}.`);
  log("  3. Write Issues under .scratch/<feature>/issues/, then run `npx sandcastle-pro run`.");
  if (sandbox === "native" && platform === "darwin") {
    log("");
    log("Note: Seatbelt can't run Apple's /usr/bin/git (its xcrun shim is blocked). Put another git first in PATH,");
    log("      e.g. Homebrew's: `brew install git`; check with `which git`.");
  }
}

/**
 * The Gate commands to write. Without `ask`, the detected ones, or an error when there are none. With
 * `ask`, the user keeps or drops each detected command and adds their own, ending up with at least one.
 */
async function chooseGate(detected: string[], ask: InitOptions["ask"], log: (line: string) => void): Promise<string[]> {
  if (!ask) {
    if (detected.length > 0) return detected;
    throw new Error(
      "No Gate commands detected: no test, typecheck or lint package scripts, Python tools or Makefile targets. " +
        'Pass them with --gate, e.g. --gate "npm test".',
    );
  }
  const gate: string[] = [];
  if (detected.length > 0) {
    log("Detected Gate commands. A Run's change must pass each, in this order:");
    for (const command of detected) {
      if (!/^\s*n/i.test(await ask(`  Keep \`${command}\`? [Y/n] `))) gate.push(command);
    }
  } else {
    log("No Gate commands detected. A Run's change must pass each Gate command, in order.");
  }
  log("Add Gate commands, one per line. Leave the line blank to finish.");
  for (;;) {
    const command = (await ask("  > ")).trim();
    if (command !== "") gate.push(command);
    else if (gate.length > 0) return gate;
    else log("The Gate needs at least one command.");
  }
}

/** Whether Runs could publish Pull Requests here: `origin` is on GitHub, which `git push` uses, and `gh` is logged in. */
async function canPublish(repoDir: string, ghAuthenticated: () => Promise<boolean>): Promise<boolean> {
  let origin: string;
  try {
    origin = (await exec("git", ["remote", "get-url", "origin"], { cwd: repoDir })).stdout.trim();
  } catch {
    return false; // Not a git repo, or no `origin`.
  }
  return /github\.com[:/]/i.test(origin) && (await ghAuthenticated());
}

async function ghAuthStatus(): Promise<boolean> {
  try {
    await exec("gh", ["auth", "status"]);
    return true;
  } catch {
    return false; // `gh` is missing or not logged in.
  }
}

/**
 * Whether to turn `pullRequest` on. With `ask`, the user's answer, off unless they say yes. Without it,
 * off, with a pointer to the setting, since a non-interactive init should not publish anything on its own.
 */
async function choosePullRequest(ask: InitOptions["ask"], log: (line: string) => void): Promise<boolean> {
  if (!ask) {
    log(`This repo is on GitHub and gh is logged in: set "pullRequest": true in ${CONFIG_FILE} to publish each Issue as a Pull Request.`);
    return false;
  }
  log("This repo is on GitHub and gh is logged in, so Runs can publish each Issue that passes the Gate as a Pull Request.");
  return /^\s*y/i.test(await ask("  Turn on Pull Requests? [y/N] "));
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

/** Writes a file that doesn't exist yet, or leaves an existing one untouched. */
async function writeNew(repoDir: string, path: string, content: string, log: (line: string) => void): Promise<void> {
  const full = join(repoDir, path);
  if (existsSync(full)) {
    log(`skipped  ${path} (already exists)`);
    return;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  log(`created  ${path}`);
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
  With \`"stack": true\` in the config (which needs \`"pullRequest": true\`), an Issue whose only blocker that is not
  \`done\` is \`awaiting-merge\` starts as a Stacked Issue: its branch is cut from that blocker's branch, its Review Session
  only sees its own commits, and its Pull Request targets that branch. Merge the chain in order, with merge commits.
- \`Stacked on:\` the blocker branch a Stacked Issue is built on, e.g. \`Stacked on: issue/01-first\`. Set by a Run; leave it
  alone. Without it, the Issue is based on the target branch.
- \`Spec:\` the Spec's path from the repo root, e.g. \`Spec: .scratch/<feature>/spec.md\`.
  Without it, \`spec.md\` next to the \`issues/\` directory is used.
- \`Model:\` optional; overrides the configured model for this Issue only, e.g. \`Model: claude-sonnet-5-5\`.
  Put it above any \`## Comments\` heading; below it, it is ignored.

Each label may also be written in bold, \`**Status:** ready-for-agent\` or \`**Status**: ready-for-agent\`.
A Run keeps the style it finds: when it rewrites a bold line, the line stays bold. A line it adds (\`Stacked on:\`,
\`Pull Request:\`, \`Paused session:\`, \`Paused stage:\`) follows the style of the header around it: it is bold when the
\`Status:\` or \`Blocked by:\` line is.

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
- \`awaiting-merge\`: passed the Gate. Review and merge \`issue/NN-slug\` yourself. With \`"pullRequest": true\` in the
  config, the Run publishes it as a Pull Request and records the URL on a \`Pull Request:\` line; leave that line alone.
- \`done\`: merged, detected at the start of the next Run: its Pull Request is merged on GitHub or, without one,
  its branch is merged into the target branch.

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
