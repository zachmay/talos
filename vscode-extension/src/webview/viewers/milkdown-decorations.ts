// ProseMirror plugin that overlays clickable decorations on [[wikilinks]] and
// #tags inside a Milkdown editor. Document content is never transformed — the
// underlying markdown stays as literal "[[foo]]" / "#bar" so round-trips
// through parse/serialize are lossless.
//
// Clicks are caught in handleDOMEvents.click and dispatched via the provided
// invoker (host bridge), since ProseMirror would otherwise swallow the
// command-URI navigation on the anchor.

import type { Ctx } from "@milkdown/ctx";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

export type InvokeCommand = (command: string, arg: string) => void;

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
// Tag: preceded by non-word/non-link char, then #, then [A-Za-z][\w/-]*
// Captures the name in group 2.
const TAG_RE = /(^|[^\w\])/"'=])#([A-Za-z][\w/-]*)/g;

interface Match {
  from: number;
  to: number;
  command: "talos.openWikilink" | "talos.openTag";
  arg: string;
  label: string;
}

function collectMatches(doc: ProseNode): Match[] {
  const matches: Match[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText) return;
    // Skip text inside code blocks and inline code.
    if (parent?.type.name === "code_block") return;
    if (node.marks.some((m) => m.type.name === "code")) return;
    const text = node.text ?? "";

    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      const pipe = m[1].indexOf("|");
      const target = pipe >= 0 ? m[1].slice(0, pipe).trim() : m[1].trim();
      const alias = pipe >= 0 ? m[1].slice(pipe + 1).trim() : target;
      matches.push({
        from,
        to,
        command: "talos.openWikilink",
        arg: target,
        label: alias,
      });
    }

    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text)) !== null) {
      // group 1 = leading boundary char (or empty at start-of-text); advance
      // the offset past it so the # aligns with the actual hash.
      const leadLen = m[1].length;
      const from = pos + m.index + leadLen;
      const to = from + 1 + m[2].length;
      matches.push({
        from,
        to,
        command: "talos.openTag",
        arg: m[2],
        label: `#${m[2]}`,
      });
    }
  });
  return matches;
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = [];
  for (const m of collectMatches(doc)) {
    const cls = m.command === "talos.openWikilink" ? "talos-openWikilink" : "talos-openTag";
    decos.push(
      Decoration.inline(m.from, m.to, {
        class: cls,
        "data-talos-command": m.command,
        "data-talos-arg": m.arg,
        title: m.command === "talos.openWikilink" ? `Open "${m.arg}"` : `Open tag #${m.arg}`,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

const pluginKey = new PluginKey<DecorationSet>("talos-wikilink-decorations");

export function talosDecorationsPlugin(invoke: InvokeCommand) {
  return $prose(
    (_ctx: Ctx) =>
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, prev) => (tr.docChanged ? buildDecorations(tr.doc) : prev),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            click: (_view, event) => {
              const target = (event.target as HTMLElement | null)?.closest?.(
                "[data-talos-command]",
              ) as HTMLElement | null;
              if (!target) return false;
              const command = target.getAttribute("data-talos-command");
              const arg = target.getAttribute("data-talos-arg");
              if (!command || !arg) return false;
              invoke(command, arg);
              event.preventDefault();
              event.stopPropagation();
              return true;
            },
          },
        },
      }),
  );
}
