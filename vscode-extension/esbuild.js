// Build script for the Talos VS Code extension.
//
// Produces:
//   dist/extension.js  — extension host entry (Node/CommonJS, consumed by VS Code)
//
// The webview bundle is not built yet; it joins in Phase 4a when the viewer lands.

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

async function run() {
  if (watch) {
    const ctx = await esbuild.context(extensionBuild);
    await ctx.watch();
    console.log("[talos] watching…");
  } else {
    await esbuild.build(extensionBuild);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
