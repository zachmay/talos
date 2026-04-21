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
import { useEffect, useRef } from "react";
import { talosDecorationsPlugin, type InvokeCommand } from "./milkdown-decorations";
import type { ViewerProps } from "./registry";

const AUTOSAVE_DEBOUNCE_MS = 2000;

function EditorHost({
  initialContent,
  onEdit,
  onInvoke,
}: {
  initialContent: string;
  onEdit?: (md: string) => void;
  onInvoke?: InvokeCommand;
}) {
  // Ref wrappers so useEditor's closure always reads the current callbacks /
  // debounce handle without re-running on every render.
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onInvokeRef = useRef(onInvoke);
  onInvokeRef.current = onInvoke;

  const timeoutRef = useRef<number | undefined>(undefined);
  const latestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Flush any pending debounced save when the component unmounts so entry
    // switches / panel close don't discard in-flight edits.
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
        if (latestRef.current !== undefined) {
          onEditRef.current?.(latestRef.current);
        }
      }
    };
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
            onEditRef.current?.(markdown);
          }, AUTOSAVE_DEBOUNCE_MS);
        });
        ctx.get(listenerCtx).blur(() => {
          // Flush immediately on blur — don't strand a pending save if the
          // user alt-tabs away mid-edit.
          if (timeoutRef.current === undefined) return;
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
          if (latestRef.current !== undefined) {
            onEditRef.current?.(latestRef.current);
          }
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(
        talosDecorationsPlugin((command, arg) => {
          onInvokeRef.current?.(command, arg);
        }),
      ),
  );

  return <Milkdown />;
}

export function MilkdownViewer({ entry, onEdit, onInvoke }: ViewerProps): JSX.Element {
  return (
    <div className="talos-milkdown">
      <MilkdownProvider>
        {/* Remount on entry id change — discards editor state cleanly. */}
        <EditorHost
          key={entry.id}
          initialContent={entry.content ?? ""}
          onEdit={onEdit}
          onInvoke={onInvoke}
        />
      </MilkdownProvider>
    </div>
  );
}
