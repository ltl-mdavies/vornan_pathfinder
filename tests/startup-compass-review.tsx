// Synthetic local fixture only: no authentication, data access, or artificial production delay.
import React from "react";
import { createRoot } from "react-dom/client";
import { PathfinderStartup } from "../apps/web/src/PathfinderStartup";
import "../apps/web/src/styles.css";
import "../apps/web/src/pathfinder-startup.css";
import "../packages/ui/compass-loader/compass-loader.js";
createRoot(document.getElementById("root")!).render(<PathfinderStartup operations session={null}/>);
