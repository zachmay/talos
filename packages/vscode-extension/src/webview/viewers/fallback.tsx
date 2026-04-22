import type { JSX } from "react";
import type { ViewerProps } from "./registry";

export function FallbackViewer({ entry }: ViewerProps): JSX.Element {
  const size = (entry.content ?? "").length;
  return (
    <div className="talos-fallback">
      <p>No viewer registered for <code>{entry.mime_type}</code>.</p>
      <p>Content size: {size} chars.</p>
      <details>
        <summary>Show raw content</summary>
        <pre>{entry.content ?? ""}</pre>
      </details>
    </div>
  );
}
