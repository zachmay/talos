import * as vscode from "vscode";
import { McpClient } from "../mcp/client.js";
import { listChildren } from "../mcp/tools.js";

// A node is either a folder (intermediate path segment with descendants) or an
// entry (a leaf at exactly this path). Entries are keyed by UUID since many
// entries share a path.
type Node =
  | { kind: "folder"; path: string[]; descendants: number }
  | {
      kind: "entry";
      path: string[];
      id: string;
      title: string;
      type: string;
      mime_type: string;
    };

// Maps Talos entry types to codicon names. Unknowns fall back to 'file'.
function iconForType(type: string): string {
  switch (type) {
    case "tag":
      return "tag";
    case "agent-def":
      return "robot";
    case "concept":
      return "symbol-namespace";
    case "task":
      return "checklist";
    case "log":
      return "history";
    case "note":
    case "reference":
      return "file-text";
    default:
      return "file";
  }
}

export class EntriesTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly getClient: () => Promise<McpClient | undefined>) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "folder") {
      const name = node.path[node.path.length - 1] ?? "(root)";
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `folder:${node.path.join("/")}`;
      item.iconPath = new vscode.ThemeIcon("folder");
      item.description = `${node.descendants}`;
      item.tooltip = `/${node.path.join("/")} — ${node.descendants} descendants`;
      item.contextValue = "talos.folder";
      return item;
    }
    const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
    item.id = `entry:${node.id}`;
    item.iconPath = new vscode.ThemeIcon(iconForType(node.type));
    item.description = node.type;
    item.tooltip = `${node.title}\n/${node.path.join("/")}\ntype: ${node.type}`;
    item.contextValue = "talos.entry";
    item.command = {
      command: "talos.openEntry",
      title: "Open Entry",
      arguments: [node.id],
    };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    const client = await this.getClient();
    if (!client) return [];

    const path = element?.kind === "folder" ? element.path : [];
    try {
      const result = await listChildren(client, path);
      const folders: Node[] = result.folders.map((f) => ({
        kind: "folder",
        path: f.path,
        descendants: f.descendants,
      }));
      const entries: Node[] = result.entries.map((e) => ({
        kind: "entry",
        path,
        id: e.id,
        title: e.title,
        type: e.type,
        mime_type: e.mime_type,
      }));
      return [...folders, ...entries];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Talos: list_children failed: ${msg}`);
      return [];
    }
  }
}
