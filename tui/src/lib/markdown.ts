import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal());

export function renderMarkdown(text: string): string {
  return marked(text) as string;
}
