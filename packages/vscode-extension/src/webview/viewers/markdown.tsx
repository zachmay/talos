import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import type { JSX } from "react";
import { useMemo } from "react";
import type { ViewerProps } from "./registry";
import { tagPlugin, wikilinkPlugin } from "./wikilink-plugin";

// markdown-it with GFM-ish config: linkify bare URLs, convert \n to <br>,
// enable typographic replacements, and render GitHub-style task lists.
// Wikilink + tag plugins emit command-URI anchors — VS Code intercepts
// clicks on `command:talos.*` hrefs as long as the webview opts into them.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
})
  .use(taskLists, { enabled: false, label: true })
  .use(wikilinkPlugin)
  .use(tagPlugin);

export function MarkdownViewer({ entry }: ViewerProps): JSX.Element {
  const html = useMemo(() => md.render(entry.content ?? ""), [entry.content]);
  return (
    <article
      className="talos-markdown"
      // Content comes from our own DB; the md instance does not render raw HTML
      // (html: false), so markdown-it's output is the sanitization boundary.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
