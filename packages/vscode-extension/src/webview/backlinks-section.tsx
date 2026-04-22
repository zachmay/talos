import type { JSX } from "react";
import type { Backlink } from "./types";

interface Props {
  backlinks: Backlink[];
  onInvoke?: (command: string, arg: string) => void;
}

// Inline section rendered below the entry viewer. Each backlink is a
// clickable row that opens the source entry via the talos.openEntry command
// (forwarded through the host bridge since the webview can't dispatch
// commands directly).
export function BacklinksSection({ backlinks, onInvoke }: Props): JSX.Element | null {
  if (backlinks.length === 0) return null;
  return (
    <section className="talos-backlinks-section" aria-label="Backlinks">
      <h2>Linked mentions</h2>
      <ul>
        {backlinks.map((b) => (
          <li key={b.source_id} className="talos-backlink-row">
            <a
              className="talos-backlink-link"
              href={`command:talos.openEntry?${encodeURIComponent(JSON.stringify([b.source_id]))}`}
              onClick={(e) => {
                e.preventDefault();
                onInvoke?.("talos.openEntry", b.source_id);
              }}
            >
              {b.source_title}
            </a>
            <span className="talos-backlink-path">/{b.source_path.join("/")}</span>
            <span className="talos-backlink-via">
              via <code>{b.link_type}</code>: <code>{b.link_text}</code>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
