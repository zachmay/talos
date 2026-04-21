import type { FunctionComponent } from "react";
import type { Entry } from "../types";

export interface EditOptions {
  // When true, this edit is a rapid autosave — host should skip derived
  // work (embedding, link rescan) and write content only. When false /
  // absent, it's a flush and the host performs the full update pipeline.
  defer?: boolean;
}

export interface ViewerProps {
  entry: Entry;
  // Called by editable viewers when the user changes content. Viewers that
  // are read-only (or for non-text content) simply ignore this prop.
  onEdit?: (content: string, options?: EditOptions) => void;
  // Fire-and-forget invocation of an allowlisted VS Code command. Used by
  // viewers whose UI contains clickable elements (wikilinks, tags) that the
  // editor swallows before command-URI navigation can fire.
  onInvoke?: (command: string, arg: string) => void;
}

export interface Viewer {
  id: string;
  mimeTypes: string[]; // exact matches or wildcards like "text/*", "image/*", "*"
  component: FunctionComponent<ViewerProps>;
  priority?: number; // higher wins tiebreaker; defaults to 0
}

const viewers: Viewer[] = [];

export function registerViewer(v: Viewer): void {
  viewers.push(v);
  viewers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function matches(mimeType: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === mimeType) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "text/"
    return mimeType.startsWith(prefix);
  }
  return false;
}

export function selectViewer(mimeType: string): Viewer | undefined {
  for (const v of viewers) {
    for (const pattern of v.mimeTypes) {
      if (matches(mimeType, pattern)) return v;
    }
  }
  return undefined;
}
