// Autocomplete trigger detection for Milkdown/ProseMirror.
//
// Owns three concerns:
//   1. Watch doc/selection state; detect when the cursor is inside a [[ or #
//      trigger context. When the trigger state changes, fire onChange.
//   2. Intercept keyboard nav (Arrow Up/Down, Enter, Escape) while a trigger
//      is active so the popup stays out of React focus management.
//   3. Provide an acceptCandidate action that dispatches a transaction
//      replacing the trigger range with the chosen "[[Title]]" or "#name".
//
// The React popup reads trigger state via onChange, owns candidate fetching
// and selected-index state, and calls the nav callbacks below in response
// to keyboard events that bubble back out via onNav.

import type { Ctx } from "@milkdown/ctx";
import type { EditorView } from "@milkdown/prose/view";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

export type TriggerKind = "wikilink" | "tag";

export interface Trigger {
  kind: TriggerKind;
  query: string;
  from: number; // first position of the "[[" or "#"
  to: number; // current cursor position
  // Cursor coordinates in viewport (position:fixed) space, captured when the
  // trigger was most recently re-emitted. Null if PM couldn't compute them.
  coords: { top: number; bottom: number; left: number } | null;
}

export type NavAction = "up" | "down" | "accept" | "dismiss";

export interface AutocompleteCallbacks {
  onTriggerChange: (trigger: Trigger | null) => void;
  // Triggered for Arrow Up/Down/Enter/Escape when a trigger is active. The
  // React popup moves its selected index on up/down, accepts on enter (calls
  // accept() below), or dismisses on escape.
  onNav: (action: NavAction) => void;
}

// Regexes look at up to 100 chars before the cursor. Whitespace, code blocks,
// or newlines inside the wikilink kill the match — mimics Obsidian semantics.
const WIKILINK_RE = /\[\[([^\]\n]*)$/;
// Same non-word boundary rule as the server-side tag scanner in mcp/src/links.ts.
const TAG_RE = /(?:^|[^\w\])/"'=])#([A-Za-z][\w/-]*)$/;

function detectTrigger(view: EditorView): Trigger | null {
  const { from, empty } = view.state.selection;
  if (!empty) return null;

  const start = Math.max(0, from - 100);
  const textBefore = view.state.doc.textBetween(start, from, "\n", "\n");

  let triggerFrom: number | null = null;
  let kind: TriggerKind | null = null;
  let query = "";

  const wiki = WIKILINK_RE.exec(textBefore);
  if (wiki) {
    triggerFrom = from - wiki[0].length;
    kind = "wikilink";
    query = wiki[1];
  } else {
    const tag = TAG_RE.exec(textBefore);
    if (tag) {
      // tag[0] may include a leading boundary char; skip past it so `from`
      // sits on the "#".
      const hashOffset = tag[0].length - (tag[1].length + 1);
      triggerFrom = from - (tag[0].length - hashOffset);
      kind = "tag";
      query = tag[1];
    }
  }
  if (kind === null || triggerFrom === null) return null;

  let coords: Trigger["coords"] = null;
  try {
    const c = view.coordsAtPos(triggerFrom);
    coords = { top: c.top, bottom: c.bottom, left: c.left };
  } catch {
    coords = null;
  }

  return { kind, query, from: triggerFrom, to: from, coords };
}

function triggersEqual(a: Trigger | null, b: Trigger | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.query === b.query &&
    a.from === b.from &&
    a.to === b.to &&
    a.coords?.top === b.coords?.top &&
    a.coords?.left === b.coords?.left
  );
}

const pluginKey = new PluginKey<{ active: boolean }>("talos-autocomplete");

// Public control surface exposed back to the React layer so the popup can
// dispatch the final insertion.
export interface AutocompleteController {
  accept(title: string): void;
  isActive(): boolean;
}

export function autocompletePlugin(
  callbacks: AutocompleteCallbacks,
  setController: (c: AutocompleteController) => void,
) {
  return $prose((_ctx: Ctx) => {
    let lastTrigger: Trigger | null = null;
    let currentView: EditorView | null = null;

    const controller: AutocompleteController = {
      accept(title: string) {
        if (!currentView || !lastTrigger) return;
        const insertion =
          lastTrigger.kind === "wikilink" ? `[[${title}]]` : `#${title}`;
        const tr = currentView.state.tr.insertText(
          insertion,
          lastTrigger.from,
          lastTrigger.to,
        );
        currentView.dispatch(tr);
        currentView.focus();
      },
      isActive() {
        return lastTrigger !== null;
      },
    };
    setController(controller);

    return new Plugin({
      key: pluginKey,
      state: {
        init: () => ({ active: false }),
        apply: (_tr, prev) => prev,
      },
      view(view) {
        currentView = view;
        return {
          update(updatedView) {
            const next = detectTrigger(updatedView);
            if (!triggersEqual(next, lastTrigger)) {
              lastTrigger = next;
              callbacks.onTriggerChange(next);
            }
          },
          destroy() {
            lastTrigger = null;
            callbacks.onTriggerChange(null);
          },
        };
      },
      props: {
        handleKeyDown(_view, event) {
          if (lastTrigger === null) return false;
          switch (event.key) {
            case "ArrowDown":
              callbacks.onNav("down");
              return true;
            case "ArrowUp":
              callbacks.onNav("up");
              return true;
            case "Enter":
              callbacks.onNav("accept");
              return true;
            case "Escape":
              callbacks.onNav("dismiss");
              return true;
            default:
              return false;
          }
        },
      },
    });
  });
}

