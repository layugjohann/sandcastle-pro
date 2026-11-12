import type { Issue } from "./issue-store.js";

export function buildImplementerPrompt(issue: Issue, glossary: string | undefined): string {
  const sections = [
    "You are the Implementer. Turn the Issue below into commits on the current branch.",
    "Work only on what the Issue asks for. Commit your work before you finish.",
    `## Issue\n\n${issue.text.trim()}`,
  ];
  if (issue.spec) sections.push(`## Spec\n\n${issue.spec.trim()}`);
  if (glossary) sections.push(`## Glossary\n\nUse these terms exactly.\n\n${glossary.trim()}`);
  return `${sections.join("\n\n")}\n`;
}
