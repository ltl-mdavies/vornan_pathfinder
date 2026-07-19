import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./auth";
import { WorkspaceLoading } from "./WorkspaceLoading";
import "./styles.css";

const App = lazy(() => import("./App").then((module) => ({ default: module.App })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      {(authSession) => (
        <Suspense fallback={<WorkspaceLoading message="Opening Pathfinder…" />}>
          <App authSession={authSession} />
        </Suspense>
      )}
    </AuthGate>
  </StrictMode>
);
