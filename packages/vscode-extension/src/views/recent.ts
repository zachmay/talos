import * as vscode from "vscode";
import { McpClient } from "../mcp/client.js";
import { recent, type RecentHit } from "../mcp/tools.js";

// Sidebar view listing recently updated entries. Static list — refreshed via
// the view title's Refresh command (we don't auto-refresh on every save since
// that would churn the tree on typing).
export class RecentTreeProvider implements vscode.TreeDataProvider<RecentHit> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly getClient: () => Promise<McpClient | undefined>) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: RecentHit): vscode.TreeItem {
    const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
    item.id = `recent:${node.id}`;
    item.iconPath = new vscode.ThemeIcon("history");
    item.description = `/${node.path.join("/")}`;
    item.tooltip = `${node.title}\n/${node.path.join("/")}\nupdated ${node.updated_at}`;
    item.command = {
      command: "talos.openEntry",
      title: "Open Entry",
      arguments: [node.id],
    };
    return item;
  }

  async getChildren(element?: RecentHit): Promise<RecentHit[]> {
    if (element) return [];
    const client = await this.getClient();
    if (!client) return [];
    try {
      return await recent(client, 50);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Talos: recent failed: ${msg}`);
      return [];
    }
  }
}
