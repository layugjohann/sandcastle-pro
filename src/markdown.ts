/** Fences `content` with more backticks than any run inside it, so the content can't close its own fence. */
export function fenced(content: string, lang = ""): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${content}\n${fence}`;
}
