import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { VsCodeBridge } from "./host-bridge";

const root = createRoot(document.getElementById("root")!);
const bridge = new VsCodeBridge();
root.render(
  <StrictMode>
    <App bridge={bridge} />
  </StrictMode>
);
