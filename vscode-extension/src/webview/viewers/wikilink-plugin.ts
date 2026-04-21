// markdown-it plugins for Obsidian-style wikilinks and #tags.
//
// Both render as VS Code command-URIs (command:talos.openWikilink, command:talos.openTag).
// VS Code intercepts these on click as long as the webview opts into command URIs.

import type MarkdownIt from "markdown-it";

type StateInline = Parameters<NonNullable<Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2]>>[0];

function cmdLink(command: string, arg: string, label: string): string {
  // VS Code expects the arguments as a URL-encoded JSON array.
  const args = encodeURIComponent(JSON.stringify([arg]));
  return `<a class="talos-${command.split(".").pop()}" href="command:${command}?${args}" data-talos-link="${escapeAttr(arg)}">${escapeHtml(label)}</a>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// [[target]] or [[target|alias]] — stop at ]] or newline.
export function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;

    // Don't treat #[[ as a wikilink — that's a bracketed tag
    if (start > 0 && src.charCodeAt(start - 1) === 0x23) return false;

    const end = src.indexOf("]]", start + 2);
    if (end === -1) return false;
    const slice = src.slice(start + 2, end);
    if (slice.includes("\n")) return false;
    if (slice.length === 0) return false;

    if (silent) {
      state.pos = end + 2;
      return true;
    }

    const token = state.push("wikilink", "", 0);
    token.content = slice;
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx) => {
    const raw = tokens[idx].content;
    const pipeAt = raw.indexOf("|");
    const target = pipeAt >= 0 ? raw.slice(0, pipeAt).trim() : raw.trim();
    const alias = pipeAt >= 0 ? raw.slice(pipeAt + 1).trim() : target;
    return cmdLink("talos.openWikilink", target, alias);
  };
}

// #tagname — starts with #, followed by [A-Za-z][\w/-]*, preceded by non-word.
// Mirrors the server-side scanner in mcp/src/links.ts.
const TAG_RE = /(^|[^\w\])/"'=])#([A-Za-z][\w/-]*)/;

export function tagPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("emphasis", "talos_tag", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x23) return false; // '#'
    // Reject if preceded by a word character or certain separators (from scanner regex).
    if (start > 0) {
      const prev = src[start - 1];
      if (/[\w\])/"'=]/.test(prev)) return false;
    }
    // Match the tag name.
    const match = /^#([A-Za-z][\w/-]*)/.exec(src.slice(start));
    if (!match) return false;
    const name = match[1];

    if (silent) {
      state.pos = start + match[0].length;
      return true;
    }

    const token = state.push("talos_tag", "", 0);
    token.content = name;
    state.pos = start + match[0].length;
    return true;
  });

  md.renderer.rules.talos_tag = (tokens, idx) => {
    const name = tokens[idx].content;
    return cmdLink("talos.openTag", name, `#${name}`);
  };
}
// TAG_RE is unused at runtime (the regex lives in the rule body); kept as
// documentation of the intended pattern.
void TAG_RE;
