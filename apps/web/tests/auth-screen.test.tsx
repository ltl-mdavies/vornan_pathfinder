import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthScreen, type AuthScreenState } from "../src/AuthScreen";
import { PATHFINDER_SESSION_EXPIRED_MESSAGE } from "../src/api-client";

const render = (state: AuthScreenState, error?: string) => renderToStaticMarkup(<AuthScreen state={state} error={error} onSignIn={() => {}} onSignOut={() => {}} />);

test("signed-out view has one Google action, official logo and selected concise copy", () => {
  const html = render("signed-out");
  assert.match(html, /Sign in to Pathfinder/);
  assert.match(html, /vornan-logo-and-wordmark.png/);
  assert.match(html, /Continue with Google/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /approved Google|Allowed email|Vornan \/ Pathfinder|auth-domain|compass|marketing/);
});
test("checking is quiet, announced, and never shows a login card or action", () => {
  const html = render("checking");
  assert.match(html, /role="status"/);
  assert.match(html, /Checking your session/);
  assert.doesNotMatch(html, /pf-auth-card|<button|<h1|Continue to your workspace/);
});
test("sign-in is disabled and announces progress while provider popup is opening", () => {
  const html = render("signing-in");
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="status"/);
});
test("errors remain actionable; expiry asks for sign-in without promising a safe retry", () => {
  const html = render("error", "<script>bad</script>");
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Continue with Google/);
  assert.doesNotMatch(html, /disabled=""/);
  const expired = render("expired");
  assert.ok(expired.includes(PATHFINDER_SESSION_EXPIRED_MESSAGE));
  assert.match(expired, /pf-auth-message-expired/);
  assert.doesNotMatch(expired, /retry your last action/);
  assert.doesNotMatch(html, /pf-auth-message-expired/);
});
test("restricted accounts only get sign out, unconfigured environments have no auth action", () => {
  assert.match(render("restricted"), /Sign out/);
  assert.doesNotMatch(render("restricted"), /Continue with Google/);
  assert.match(render("unconfigured"), /Sign-in is not configured/);
  assert.doesNotMatch(render("unconfigured"), /<button/);
});
test("Firebase logic, allowlists, token and callbacks are unchanged from startup freeze", async () => {
  const source = await readFile(new URL("../src/auth.tsx", import.meta.url), "utf8");
  // Presentation imports can differ; all policy and provider logic before rendering must remain exact.
  const logic = (s: string) => s.slice(s.indexOf("export interface PathfinderAuthSession"), s.indexOf("  if (!config && !authRequired)"));
  const session = (s: string) => s.slice(s.indexOf("  return children({"), s.indexOf("\n}", s.indexOf("  return children({")) + 2);
  // Frozen from d14b129; no Git-history dependency in shallow CI checkouts.
  assert.equal(createHash("sha256").update(logic(source) + session(source)).digest("hex"), "5b87fdb2456b2388cdf790ba8d10426fddb258cc9383a973ba332e2d117c1c4c");
  assert.match(source, /if \(!config && !authRequired\)[\s\S]*return children\(null\)/);
  assert.match(source, /if \(!isAllowedDomain\(domain\)\)[\s\S]*state="restricted" onSignOut=\{handleSignOut\}/);
  assert.match(source, /onSignIn=\{handleSignIn\}/);
});
test("standalone preview imports only presentation, never the AuthGate or provider", async () => {
  const preview = await readFile(new URL("../../../tests/ux/auth-preview.tsx", import.meta.url), "utf8");
  const screen = await readFile(new URL("../src/AuthScreen.tsx", import.meta.url), "utf8");
  for (const code of [preview, screen]) assert.doesNotMatch(code.replace(/\/\*[\s\S]*?\*\//g, ""), /firebase|fetch\(|AuthGate|api-client|signInWithPopup|localStorage/);
  const css = await readFile(new URL("../src/auth-screen.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /focus-visible/);
  assert.match(css, /body:has\(\.pf-auth-shell\)/);
});
