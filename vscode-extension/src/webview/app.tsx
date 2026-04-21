import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { HostBridge } from "./host-bridge";
import type { Entry, HostMessage } from "./types";
import { FallbackViewer } from "./viewers/fallback";
import { registerViewer, selectViewer } from "./viewers/registry";
import { MarkdownViewer } from "./viewers/markdown";

registerViewer({
  id: "markdown",
  mimeTypes: ["text/markdown", "text/x-markdown"],
  component: MarkdownViewer,
  priority: 10,
});
registerViewer({
  id: "fallback",
  mimeTypes: ["*"],
  component: FallbackViewer,
  priority: -100,
});

interface AppProps {
  bridge: HostBridge;
}

export function App({ bridge }: AppProps): JSX.Element {
  const [entry, setEntry] = useState<Entry | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const off = bridge.onMessage((msg: HostMessage) => {
      if (msg.type === "entry-loaded") {
        setEntry(msg.entry);
        setError(undefined);
      } else if (msg.type === "entry-error") {
        setEntry(undefined);
        setError(msg.error);
      }
    });
    bridge.notifyReady();
    return off;
  }, [bridge]);

  if (error) {
    return <div className="talos-error">Error: {error}</div>;
  }
  if (!entry) {
    return <div className="talos-loading">Loading…</div>;
  }

  const viewer = selectViewer(entry.mime_type);
  const Viewer = viewer?.component ?? FallbackViewer;

  return (
    <div className="talos-app">
      <header className="talos-header">
        <h1>{entry.title}</h1>
        <div className="talos-meta">
          <span className="talos-path">/{entry.path.join("/")}</span>
          <span className="talos-type">{entry.type}</span>
        </div>
      </header>
      <Viewer entry={entry} />
    </div>
  );
}
