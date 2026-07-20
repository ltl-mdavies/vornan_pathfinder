import serverless from "serverless-http";
import { proofPublicApp } from "./proof/public-server.js";

export const handler = serverless(proofPublicApp, { binary: false });
