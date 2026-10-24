# Pathfinder login — local design QA

final result: passed

## Target and scope

Source: /Users/marcusdavies/.codex/visualizations/2026/10/23/01a16a35-2fc7-7a62-8945-f6c7f25a1638/login-startup-review/login-selected-refined.png

The selected reference is subordinate to approved refinements: 420px card,
180px official logo, 26px heading, and no top-left Vornan / Pathfinder label.
The source's larger dimensions and corner label are intentionally not replicated.
This is authentication presentation only; deployment remains held.

Implementation: http://127.0.0.1:5214/auth.html?state=signed-out

## Comparison evidence

- Source pixels: 1672 × 940. Actual screenshot: 1672 × 940, CSS viewport
  1672 × 940, DPR 1. No density scaling needed.
- Both source and implementation were displayed together in one comparison input.
- Implementation: output/login-review/comparison-1672.jpg.
- Focused card inspection in that same comparison: logo, divider, eyebrow, heading,
  supporting line, and Google button are readable; no separate enlarged crop needed.
- Required desktop: output/login-review/desktop-1366.jpg, 1366 × 768.
- Mobile: output/login-review/mobile-390.jpg, 390 × 844.
- Narrow mobile: output/login-review/mobile-320.jpg, CSS viewport 320 × 568.
- Zoom-equivalent: output/login-review/zoom-equivalent-expired.jpg, CSS viewport
  683 × 384, full-page capture. This checks layout reflow, not genuine browser zoom.
- State evidence: checking.jpg, signing-in.jpg, error.jpg, expired.jpg,
  restricted.jpg, unconfigured.jpg in output/login-review.
- Keyboard focus: output/login-review/keyboard-focus.jpg.

## Findings and comparison history

No remaining actionable P0/P1/P2 visual findings.

Before final comparison, UX identified the initial button outline as too faint.
Changed #bcc5b8 to #8c9687 (approximately 3.08:1 on white), keeping Forest
hover/focus. Final desktop, mobile and comparison captures include that fix.
The initial structural prototype is not an acceptance capture.

Approved deviations from the generated image: smaller dimensions, official logo
asset instead of generated likeness, accessible darker small text/button outline,
no corner label, and 6px Forest strip rather than the image's thicker rule.

### Five fidelity surfaces

- Typography: actual Plus Jakarta Sans, 26px/800 title at desktop, 24px at narrow
  widths, 14px supporting text and action. No truncation; heading may wrap at 320px.
- Spacing: measured card 420 × 346.2px at desktop. Single centered panel,
  28px horizontal padding, 48px minimum button, 8px radius. No nested cards.
  Small-height error views scroll naturally without horizontal overflow.
- Color: Stone #f3f7f1, Forest #39523b, Lime #abc65f, white panel; restrained
  border/shadow. Text and focus indicators are distinct.
- Assets: unchanged official 900 × 300 Vornan/scout asset renders at 180 × 60.
  Existing Google SVG paths extracted unchanged from prior AuthGate; not redrawn.
  Both images loaded successfully. Lucide supplies the progress icon.
- Copy: Sign in to Pathfinder / Continue to your workspace / Continue with Google.
  No approved-account guidance, domain pills, marketing pane or corner label.
  Restricted, expired and unconfigured states explain their specific issue.

## Interaction and safety checks

- Enter on Google action enters simulated busy state; disabled button and live
  status appear. Error retry does the same. Restricted Sign out returns to signed out.
- Checking state has logo and status only; no sign-in card or action.
- Unconfigured has no Google button. Errors use alert semantics and escape HTML.
- Keyboard action focus has visible 2px Forest outline. Reduced motion is supported.
- No horizontal overflow at 1366, 390, 320, or 683 CSS pixels.
- Browser warning/error logs: none.
- Preview imports the real pure AuthScreen, not AuthGate/Firebase. All callbacks
  are local state changes; no provider, API, email or proof decisions.
- Frozen-baseline test verifies provider loading, session callbacks, allowlists,
  sign-in, token, expiry and sign-out implementation remains byte-identical.
- All workspace typechecks pass; Admin production build passes (existing
  large-chunk warning remains); all 1,392 regression tests pass.

## Limits and handoff

Live Google sign-in was not performed. This validates presentation and unchanged
authentication source contracts, not a new end-to-end provider session.
Public Proof/Status and intake/API runtime files are unchanged.
Independent UX acceptance and user local review precede any release.

Independent UX presentation review passed on this source: desktop 1366, large
1920 × 1080, mobile 390 × 844, and error 320 × 568; keyboard, busy, retry,
expired, restricted sign-out, unconfigured and quiet checking all passed.
UX evidence lives under the source reference's login-startup-review directory:
login-checks.json, login-comparison.jpg and login-*.jpg.

Independent integrated startup recheck also passed on runtime freeze 9f69433:
held targets/registry root and reload show no directory action or legacy panel;
release reaches Dashboard; directory failure retries to Dashboard; supported
Wrike customer return retries its scoped failure into LTL Demo Settings.
Evidence: startup-integrated-checks.json and startup-integrated.jpg in the same
UX directory. UX accepts this combined local candidate with no design findings.
No actual provider OAuth/sign-out was exercised, and deployment remains held.

Implementation checklist: complete. No additional P3 changes proposed.
