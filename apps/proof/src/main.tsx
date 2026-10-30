import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { watchProofAccessNavigation } from "./session-state";
import "./styles.css";
import "../../../packages/ui/src/vornan-foundation.css";

const stopWatchingAccessNavigation = watchProofAccessNavigation(window);
import.meta.hot?.dispose(stopWatchingAccessNavigation);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
