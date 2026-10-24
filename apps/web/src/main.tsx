import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./auth";
import "./styles.css";
import { PathfinderStartup } from "./PathfinderStartup";

const App = lazy(() => import("./App").then((module) => ({ default: module.App })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      {(authSession) => (
        <Suspense fallback={<PathfinderStartup session={authSession} operations={import.meta.env.VITE_ENABLE_OPERATIONS_WORKSPACE === "true"} />}>
          <App authSession={authSession} />
        </Suspense>
      )}
    </AuthGate>
  </StrictMode>
);
