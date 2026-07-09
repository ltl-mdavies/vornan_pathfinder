# Pathfinder UI Brand Brief

**Product:** Pathfinder  
**Parent brand:** Vornan  
**Status:** Implementation brief  
**Brand sources:** `assets/brand/Vornan-Brand-Guidelines.pdf`, Vornan logo assets, Plus Jakarta Sans font files

---

## 1. Brand Position

Pathfinder is a Vornan platform product. It should feel like a precise operational system that helps teams anticipate order problems, translate customer intent, and move print work forward with less manual coordination.

The brand idea from the Vornan guide is **Anticipate**:

- thinking ahead,
- seeing ahead,
- pushing ahead,
- getting ahead.

For Pathfinder, that translates to:

- detect bad order data before it reaches production,
- show exactly what was received, understood, and sent,
- make order translation and routing auditable,
- help operators move faster without hiding risk.

The Pathfinder voice should be confident, useful, and direct. Avoid generic SaaS language and decorative complexity.

---

## 2. Product Messaging

Use the app name **Pathfinder** as the primary product mark. Pair it with Vornan brand treatment where appropriate.

Recommended product positioning:

> Pathfinder turns customer order files into production-ready Lift orders with mapping, validation, routing, and audit visibility.

Short variants:

- Upload, map, validate, and route orders.
- See every order before it becomes a production problem.
- Move customer orders into Lift without duplicate entry.
- Translate source files into production-ready orders.

Vornan-aligned headline language may draw from the guide:

- Faster forward.
- Ahead of the game.
- Let us build that for you.
- We make it easy to buy printing.

For the internal app, use those sparingly. Operational screens should prioritize clarity over campaign-style copy.

---

## 3. Typography

The Vornan brand guide specifies **Plus Jakarta Sans** as the brand typeface, using medium and extra bold weights.

Use the provided font assets:

- `assets/fonts/plus-jakarta-sans-500.ttf`
- `assets/fonts/plus-jakarta-sans-800.ttf`

Implementation rules:

- Use Plus Jakarta Sans Extra Bold for app name, page titles, major section headers, and empty state headlines.
- Use Plus Jakarta Sans Medium for navigation labels, summary numbers, tab labels, and emphasized UI labels.
- Inter may still be used for dense data tables, form controls, JSON viewers, code-like payload views, and long body text if it improves readability.
- Avoid heavy display typography inside dense tables and forms.

Recommended CSS tokens:

```css
--font-brand: "Plus Jakarta Sans", Inter, system-ui, sans-serif;
--font-ui: Inter, "Plus Jakarta Sans", system-ui, sans-serif;
--font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

---

## 4. Color Tokens

The Vornan palette centers on forest green, lime green, pale green, black, and soft stone surfaces.

Recommended implementation tokens:

```css
--vornan-black: #191818;
--vornan-forest: #39523b;
--vornan-lime: #abc65f;
--vornan-stone: #f3f7f1;

--surface-0: #f7f8f5;
--surface-1: #ffffff;
--surface-2: #eef3eb;
--border-subtle: #d8dfd3;
--text-primary: #191818;
--text-secondary: #4f5b4f;
--text-muted: #768070;

--status-success: #39523b;
--status-warning: #a87921;
--status-danger: #b13b33;
--status-info: #3f5f8f;
```

Usage rules:

- Use black and forest green for structure, navigation, headings, and primary identity.
- Use lime green as an accent, not a flood color.
- Use stone and soft white surfaces for work areas.
- Keep dashboard and operational screens light, calm, and scan-friendly.
- Reserve danger/warning colors for actual validation, submission, and operational risk.

---

## 5. Logo And Imagery

Source assets:

- `assets/brand/scout.png`
- `assets/brand/vornan-wordmark.png`
- `assets/brand/vornan-logo-and-wordmark.png`

Rules from the brand guide:

- Use the Vornan wordmark and Scout mark in black and white for most applications.
- Preserve clear space around the logo.
- Do not recolor, skew, flip, gradient-fill, or distort the Scout.
- Use the Scout as an identity mark, not as decorative clutter.

Pathfinder app usage:

- Use a compact Vornan wordmark or lockup in the global shell.
- Use **Pathfinder** as the app title next to or below the Vornan mark.
- Use the Scout sparingly on login, empty states, and setup screens.
- Do not use Scout inside dense operational data screens unless it is small and non-intrusive.

---

## 6. Interface Character

Pathfinder should feel like:

- an operations console,
- an order translation workbench,
- a validation and routing cockpit,
- a reliable internal platform product.

Avoid:

- marketing-site hero layouts inside the app,
- oversized decorative cards,
- excessive gradients,
- generic blue SaaS styling,
- playful or consumer-app affordances,
- hidden automation.

Core UI principles:

- dense but calm,
- clear state and next action,
- visible source/canonical/Lift payload comparison,
- strong table and form ergonomics,
- no unexplained automation,
- every failed state has a recovery path.

---

## 7. First Screen Direction

The first usable screen should be the **Order Intake Workbench**, not a landing page.

Recommended layout:

- left navigation: Dashboard, Upload, Orders, Templates, Product Mapping, Lift Target, Audit
- top bar: Vornan mark, Pathfinder title, environment indicator
- main panel: upload/import workflow and job state
- right panel or tabbed lower panel: validation, canonical JSON, Lift payload

The most important visual pattern is the three-panel debug view:

1. Raw source grid
2. Canonical Order
3. Lift payload

This pattern should become a reusable component.

---

## 8. Accessibility And Implementation Notes

- Maintain strong contrast on pale green and stone backgrounds.
- Do not rely on green alone to indicate success or active state.
- Keep JSON and spreadsheet views in readable monospace or compact UI type.
- Make all statuses text-labeled, not color-only.
- Use stable layout dimensions for data grids, sidebars, toolbars, and upload panels.
- Keep button labels action-oriented: Upload, Map Fields, Validate, Generate Lift Payload, Submit to QA1.

---

## 9. Asset Inventory

```text
assets/brand/Vornan-Brand-Guidelines.pdf
assets/brand/scout.png
assets/brand/vornan-wordmark.png
assets/brand/vornan-logo-and-wordmark.png
assets/fonts/plus-jakarta-sans-500.ttf
assets/fonts/plus-jakarta-sans-800.ttf
```

