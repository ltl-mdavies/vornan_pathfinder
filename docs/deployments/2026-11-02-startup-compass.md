# Pathfinder startup compass — November 2, 2026

## Scope
Local UX-approved trial, release preparation only. Replace application startup spinner with the existing shared compass (56px, simple detail, 0.5x, Forest/Zinnia). Remove routine startup preparation sentence. Keep all error/retry/readiness/auth handling and customer spinners unchanged. No API, Proof, Status, intake, OAuth branding/configuration or catalog activation.

## Verification
- Web build and311 tests pass. Desktop1366×768/mobile390×844 inspected; UX accepted local visual treatment.
- Actual-app synthetic hold/completion, directory failure/retry and customer return failure/retry pass.
- Real Firebase authenticated local candidate reached Dashboard as existing internal account. Scoped loopback-only GET proxy retained upstream bearer authentication; unauthenticated requests401, writes403, unlisted routes403. No production CORS changes. Local proxy/launcher excluded from release source/artifacts.
- Real OS Reduce Motion enabled for check; all four motion layers computed animationName and transform none. Original off setting restored.
- Source asset copied byte-identically from approved Motion Studio component. Registration bundled locally; no new remote dependency.
- Base origin/main0516d96. Auth/API/Proof/Status source unchanged.

## Target and recovery inspection
- AWS account744016783602, regionus-east-1.
- Only intended production target: s3://vornan-pathfinder/ and CloudFrontE34F508KID3LHW (pathfinder.vornan.co; originvornan-pathfinder.s3.us-east-1.amazonaws.com).
- Distribution inspected Deployed, ETagETVPDKIKX0DER.
- Prior index version lI8mPfeJWMbRgkGswVptUdt9UZ5rqdEz, ETagf2479491b3e33769f0ab953bce54460b, modified2026-10-30T18:07:09Z. Bucket versioning Enabled. Recheck immediately before any release.
- Existing workflow is main-only, assets first, HTML last, no deletes. Preserve previous hashed assets.
- Current repository production variables: operations UItrue; existing Artwork Catalog internal pilottrue; allowed domainsltlco.com,vornan.co. Customer Catalog is separate and must remain disabled. Do not deploy local smoke flags blindly.

## Remaining release gates
Production-configured clean candidate and baseline reproduction comparison, artifact inspection/hash, upload dry run, durable rollback archive, CI and final concurrency check. No deployment dispatched. No production upload or cache invalidation performed.

## Rollback plan
Retain/download prior entrypoint and its referenced assets with hashes before release. Restore compatible prior assets if necessary, restore recorded index version last with existing cache/content metadata, invalidate only Pathfinder distribution, verify authenticated startup and data. No backend rollback/migration needed for this UI-only change.
