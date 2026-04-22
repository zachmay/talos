// Build script for the Talos VS Code extension.
//
// Produces two bundles:
//   dist/extension.js       — extension host entry (Node/CJS, consumed by VS Code)
//   dist/webview/main.js    — webview UI (browser/IIFE, loaded by the panel HTML)
//
// These are separate builds because the host runs in Node (needs 'vscode'
// marked external, CJS format) while the webview runs in a sandboxed
// browser context (needs JSX, DOM lib, IIFE).

const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const extensionBuild = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

const webviewBuild = {
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  outfile: "dist/webview/main.js",
  platform: "browser",
  target: "es2022",
  format: "iife",
  jsx: "automatic",
  sourcemap: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

async function run() {
  if (watch) {
    const extCtx = await esbuild.context(extensionBuild);
    const wvCtx = await esbuild.context(webviewBuild);
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log("[talos] watching extension + webview…");
  } else {
    await Promise.all([esbuild.build(extensionBuild), esbuild.build(webviewBuild)]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
