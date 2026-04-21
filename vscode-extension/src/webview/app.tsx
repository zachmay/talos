import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import type { HostBridge } from "./host-bridge";
import type { Entry, HostMessage } from "./types";
import { FallbackViewer } from "./viewers/fallback";
import { registerViewer, selectViewer } from "./viewers/registry";
import { MilkdownViewer } from "./viewers/milkdown";

// Milkdown is the primary markdown viewer (priority 10). The read-only
// markdown-it viewer still lives in viewers/markdown.tsx and could be
// re-registered at a lower priority if we want a source-mode toggle later.
registerViewer({
  id: "markdown-milkdown",
  mimeTypes: ["text/markdown", "text/x-markdown"],
  component: MilkdownViewer,
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
  // Bumped on entry-loaded so the viewer remounts even when loading the
  // same id (happens on conflict "Reload" — same entry, fresh content).
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const off = bridge.onMessage((msg: HostMessage) => {
      if (msg.type === "entry-loaded") {
        setEntry(msg.entry);
        setError(undefined);
        setLoadVersion((v) => v + 1);
      } else if (msg.type === "entry-updated") {
        // Merge the new etag into current entry state — no remount.
        setEntry((prev) => (prev && prev.id === msg.id ? { ...prev, etag: msg.etag } : prev));
      } else if (msg.type === "entry-error") {
        setEntry(undefined);
        setError(msg.error);
      }
    });
    bridge.notifyReady();
    return off;
  }, [bridge]);

  // Hooks must run unconditionally every render — declare callbacks before
  // any early returns, using a guard for the pre-entry state.
  const onEdit = useCallback(
    (content: string, options?: { defer?: boolean }) => {
      if (entry) bridge.updateEntry(entry, content, options?.defer ?? false);
    },
    [bridge, entry],
  );
  const onInvoke = useCallback(
    (command: string, arg: string) => {
      bridge.invokeCommand(command, arg);
    },
    [bridge],
  );

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
      {/* Key includes loadVersion so an entry-loaded for the *same* id
          (conflict "Reload") still remounts the viewer and drops any
          in-editor state. entry-updated bumps only the etag and preserves
          the key, keeping cursor/selection intact during autosave. */}
      <Viewer key={`${entry.id}:${loadVersion}`} entry={entry} onEdit={onEdit} onInvoke={onInvoke} />
    </div>
  );
}
