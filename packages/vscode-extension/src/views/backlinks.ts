import * as vscode from "vscode";
import { McpClient } from "../mcp/client.js";
import { backlinks, type Backlink } from "../mcp/tools.js";

// Sidebar view listing entries that link INTO the currently-open entry.
// Reactive to EntryPanel.onActiveChanged — rebuilt when the user navigates
// to a different entry or closes the panel.
export class BacklinksTreeProvider implements vscode.TreeDataProvider<Backlink> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private currentId: string | undefined;

  constructor(
    private readonly getClient: () => Promise<McpClient | undefined>,
    activeChanged: vscode.Event<string | undefined>,
  ) {
    activeChanged((id) => {
      this.currentId = id;
      this._onDidChange.fire();
    });
  }

  getTreeItem(node: Backlink): vscode.TreeItem {
    const item = new vscode.TreeItem(node.source_title, vscode.TreeItemCollapsibleState.None);
    item.id = `backlink:${this.currentId}:${node.source_id}`;
    item.iconPath = new vscode.ThemeIcon("arrow-left");
    item.description = `/${node.source_path.join("/")}`;
    item.tooltip = `${node.source_title}\n/${node.source_path.join("/")}\nvia ${node.link_type}: "${node.link_text}"`;
    item.command = {
      command: "talos.openEntry",
      title: "Open Entry",
      arguments: [node.source_id],
    };
    return item;
  }

  async getChildren(element?: Backlink): Promise<Backlink[]> {
    if (element) return [];
    if (!this.currentId) return [];
    const client = await this.getClient();
    if (!client) return [];
    try {
      const res = await backlinks(client, this.currentId);
      return res.backlinks;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Talos: backlinks failed: ${msg}`);
      return [];
    }
  }
}
