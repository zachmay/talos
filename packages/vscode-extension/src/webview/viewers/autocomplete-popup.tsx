import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { HostBridge } from "../host-bridge";
import type { TitleHit } from "../types";
import type { AutocompleteController, NavAction, Trigger } from "./autocomplete-plugin";

interface Props {
  trigger: Trigger;
  bridge: HostBridge;
  controller: AutocompleteController | null;
  // Popup sets this ref on mount so the plugin's onNav handler can dispatch
  // actions back into React state (select move / accept / dismiss) without
  // stealing focus from the editor.
  navHandlerRef: React.MutableRefObject<((action: NavAction) => void) | null>;
  onDismiss: () => void;
}

const DEBOUNCE_MS = 150;

export function AutocompletePopup({
  trigger,
  bridge,
  controller,
  navHandlerRef,
  onDismiss,
}: Props): JSX.Element | null {
  const coords = trigger.coords;
  const [hits, setHits] = useState<TitleHit[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqSeq = useRef(0);

  // Fetch candidates on trigger changes (query + kind). Debounced so rapid
  // typing doesn't fire per-keystroke requests.
  useEffect(() => {
    const mine = ++reqSeq.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const args = trigger.kind === "tag"
          ? { query: trigger.query, limit: 10, path_prefix: ["tags"] }
          : { query: trigger.query, limit: 10 };
        const results = await bridge.searchTitles(args);
        if (mine !== reqSeq.current) return;
        setHits(results);
        setSelected(0);
      } catch {
        if (mine !== reqSeq.current) return;
        setHits([]);
      } finally {
        if (mine === reqSeq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trigger.kind, trigger.query, bridge]);

  // Install nav handler so the plugin can drive selection / accept / dismiss
  // from PM keydown events. Reinstalled on every render so the closure sees
  // fresh `selected` / `hits`.
  useEffect(() => {
    navHandlerRef.current = (action: NavAction) => {
      if (action === "down") {
        setSelected((s) => (hits.length === 0 ? 0 : (s + 1) % hits.length));
      } else if (action === "up") {
        setSelected((s) => (hits.length === 0 ? 0 : (s - 1 + hits.length) % hits.length));
      } else if (action === "accept") {
        const pick = hits[selected];
        if (pick && controller) {
          controller.accept(pick.title);
          onDismiss();
        }
      } else if (action === "dismiss") {
        onDismiss();
      }
    };
    return () => {
      navHandlerRef.current = null;
    };
  }, [hits, selected, controller, navHandlerRef, onDismiss]);

  if (!coords) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    // Prefer below the cursor; the popup is small enough that vertical
    // flipping usually isn't necessary. Could be upgraded if it clips.
    top: coords.bottom + 4,
    left: coords.left,
  };

  return (
    <div className="talos-autocomplete" style={style} role="listbox">
      <div className="talos-autocomplete-header">
        {trigger.kind === "wikilink" ? "[[link]]" : "#tag"}
        {loading ? " …" : ""}
      </div>
      {hits.length === 0 && !loading && (
        <div className="talos-autocomplete-empty">No matches</div>
      )}
      <ul>
        {hits.map((hit, i) => (
          <li
            key={hit.id}
            className={`talos-autocomplete-row${i === selected ? " talos-autocomplete-row-selected" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => {
              // mousedown not click — avoids losing editor focus before we
              // can dispatch the insertion transaction.
              e.preventDefault();
              if (controller) {
                controller.accept(hit.title);
                onDismiss();
              }
            }}
          >
            <span className="talos-autocomplete-title">{hit.title}</span>
            <span className="talos-autocomplete-path">/{hit.path.join("/")}</span>
            <span className="talos-autocomplete-type">{hit.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
