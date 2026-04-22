// Editable markdown viewer built on Milkdown.
//
// Subscribes to Milkdown's markdownUpdated event, debounces it, and forwards
// the latest content to the host via props.onEdit. The editor is remounted
// when the entry id changes (via React key on the wrapper component) — this
// discards any in-flight debounce and resets the editor state cleanly.

import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { HostBridge } from "../host-bridge";
import {
  autocompletePlugin,
  type AutocompleteController,
  type NavAction,
  type Trigger,
} from "./autocomplete-plugin";
import { AutocompletePopup } from "./autocomplete-popup";
import { talosDecorationsPlugin, type InvokeCommand } from "./milkdown-decorations";
import type { ViewerProps } from "./registry";

const AUTOSAVE_DEBOUNCE_MS = 2000;

type EditCallback = (md: string, options?: { defer?: boolean }) => void;

function EditorHost({
  initialContent,
  onEdit,
  onInvoke,
  bridge,
}: {
  initialContent: string;
  onEdit?: EditCallback;
  onInvoke?: InvokeCommand;
  bridge?: HostBridge;
}) {
  // Ref wrappers so useEditor's closure always reads the current callbacks /
  // debounce handle without re-running on every render.
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onInvokeRef = useRef(onInvoke);
  onInvokeRef.current = onInvoke;

  const timeoutRef = useRef<number | undefined>(undefined);
  const latestRef = useRef<string | undefined>(undefined);
  // Last content we flushed (defer=false). Used to dedupe blur+unmount:
  // both fire on navigate-away, but only the first has real work to do.
  const lastFlushedRef = useRef<string | undefined>(undefined);

  // Autocomplete state. Trigger is owned by the PM plugin and mirrored into
  // React for popup rendering. Controller lets the popup dispatch the final
  // insertion transaction; navHandlerRef is how PM keydown events (arrow /
  // enter / escape) reach the popup without stealing focus from the editor.
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const controllerRef = useRef<AutocompleteController | null>(null);
  const navHandlerRef = useRef<((action: NavAction) => void) | null>(null);

  const flush = () => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    if (latestRef.current === undefined) return;
    if (latestRef.current === lastFlushedRef.current) return;
    lastFlushedRef.current = latestRef.current;
    onEditRef.current?.(latestRef.current, { defer: false });
  };

  useEffect(() => {
    // On unmount (entry switch, panel close), flush any pending edits with
    // a full update so chunks and links catch up.
    return flush;
    // Intentionally no deps — we want the latest `flush` closure via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
        ctx.get(listenerCtx).markdownUpdated((_c, markdown, prev) => {
          if (markdown === prev) return;
          latestRef.current = markdown;
          if (timeoutRef.current !== undefined) {
            window.clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = undefined;
            if (latestRef.current === lastFlushedRef.current) return;
            // Autosave: defer embedding & link rescan. Embedding stays
            // stale until a blur/unmount flush.
            onEditRef.current?.(latestRef.current!, { defer: true });
          }, AUTOSAVE_DEBOUNCE_MS);
        });
        ctx.get(listenerCtx).blur(() => {
          // Blur signals the user's editing attention has left; flush.
          flush();
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(
        talosDecorationsPlugin((command, arg) => {
          onInvokeRef.current?.(command, arg);
        }),
      )
      .use(
        autocompletePlugin(
          {
            onTriggerChange: (t) => setTrigger(t),
            onNav: (action) => navHandlerRef.current?.(action),
          },
          (c) => {
            controllerRef.current = c;
          },
        ),
      ),
  );

  return (
    <>
      <Milkdown />
      {trigger && bridge && (
        <AutocompletePopup
          trigger={trigger}
          bridge={bridge}
          controller={controllerRef.current}
          navHandlerRef={navHandlerRef}
          onDismiss={() => setTrigger(null)}
        />
      )}
    </>
  );
}

export function MilkdownViewer({ entry, onEdit, onInvoke, bridge }: ViewerProps): JSX.Element {
  return (
    <div className="talos-milkdown">
      <MilkdownProvider>
        {/* Remount on entry id change — discards editor state cleanly. */}
        <EditorHost
          key={entry.id}
          initialContent={entry.content ?? ""}
          onEdit={onEdit}
          onInvoke={onInvoke}
          bridge={bridge}
        />
      </MilkdownProvider>
    </div>
  );
}
