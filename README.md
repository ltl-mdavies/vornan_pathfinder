# Vornan Pathfinder

Pathfinder is a Vornan-aligned order translation and routing platform. The MVP focuses on taking customer order input from XLSX/grid sources, translating it into a Canonical Order, validating it, and generating a Lift Standard Graphics payload and submit-request preview.

## Current MVP State

- React/Vite web app with Vornan/Pathfinder UI shell.
- Express API with Lift customer directory import/fallback.
- Shared packages for Canonical Order, XLSX/template mapping, Lift payload generation, and customer directory parsing.
- Manual XLSX/grid import workflow with field mapping, canonical preview, Lift payload preview, and persisted local preview jobs.
- Local JSON persistence for development workspaces, import methods, target config, and processing jobs.
- Lift QA1/PROD target configuration UI with masked credential handling.

## Run Locally

```bash
npm install
npm run dev
```

Web app: `http://127.0.0.1:5173`  
API: `http://127.0.0.1:3000`

## Useful Commands

```bash
npm run check
npm run build
```

## Production Hosting Prep

The first AWS static hosting foundation is documented in
[docs/AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md](docs/AWS_PRODUCTION_HOSTING_AND_STATUS_PLAN.md).

Production auth is opt-in by environment:

- Web: set `VITE_AUTH_REQUIRED=true` and the `VITE_FIREBASE_*` values.
- API: set `PATHFINDER_REQUIRE_AUTH=true`, `FIREBASE_PROJECT_ID`, and either
  `FIREBASE_SERVICE_ACCOUNT_JSON` or AWS/application default credentials.
- Allowed Google domains default to `ltlco.com,vornan.co`.

Admin web deploy entry point:

```bash
VITE_API_BASE_URL=https://api.pathfinder.vornan.co \
PATHFINDER_ADMIN_BUCKET=vornan-pathfinder \
PATHFINDER_ADMIN_CLOUDFRONT_DISTRIBUTION_ID=YOUR_DISTRIBUTION_ID \
npm run deploy:admin-web
```

The deploy script builds `@pathfinder/web`, syncs immutable assets to S3, uploads
`index.html` with no-cache headers, and optionally invalidates CloudFront.

## Project Records

- Master product directive: [docs/PATHFINDER_MASTER_SPEC.md](docs/PATHFINDER_MASTER_SPEC.md)
- Initial implementation plan: [docs/PATHFINDER_INITIAL_BUILD_PLAN.md](docs/PATHFINDER_INITIAL_BUILD_PLAN.md)
- Living build log: [docs/PATHFINDER_BUILD_LOG.md](docs/PATHFINDER_BUILD_LOG.md)
- Lift payload example: [docs/examples/lift-standard-graphics-order.sample.json](docs/examples/lift-standard-graphics-order.sample.json)

## Local Runtime Data

The development API writes local runtime state to `data/pathfinder-store.local.json`. That file is intentionally ignored because it can contain local job history and credential placeholders. The API will recreate it from seed defaults when needed.
