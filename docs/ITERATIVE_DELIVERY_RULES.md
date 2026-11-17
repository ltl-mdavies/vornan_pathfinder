# Iterative delivery and release rules

Owner: Marcus Davies. Standing direction recorded November 14, 2026.

## Objective

Deliver approved improvements promptly without spending disproportionate time or credits on process. Catalog UX will evolve through frequent iterations. A styling, search, filtering, or performance release must not automatically trigger a new deployment system, cloud acceptance environment, or comprehensive recertification.

This supplements the workspace's mandatory deployment requirements and Pathfinder UX governance. It does not authorize deployment, weaken access controls, excuse failed required checks, or allow customer data loss, lost configuration, duplicated order submissions, or interference with other apps.

## Choose checks from the actual change

| Change | Default validation | Expand only when |
| --- | --- | --- |
| Copy, spacing, color, modal layout, presentation | Build/typecheck as applicable; focused visual and interaction check of changed screens; proportional UX review | Shared component behavior, accessibility, rendering, or loading behavior actually changed |
| Search, filtering, sorting, pagination, performance | Affected behavior tests and representative UI/data checks; verify retained navigation/filter state where changed | Query contracts, authorization, caching, shared APIs, or persistence changed |
| Saves, recovery, authentication, permissions | Targeted regression for the changed contract and failure modes; authenticated checks appropriate to the changed path | Evidence identifies a specific cross-app or integration dependency |
| Storage, scanning, migrations, order submission, shared infrastructure | Validate affected data/access boundaries, recovery and idempotency; inspect exact resource/package changes | The actual scope requires additional integration coverage, not simply because tools are available |

Classify by implementation, not the task title. A UI request that changes shared authentication needs authentication checks. Conversely, unrelated upload or scanning work does not become a prerequisite for a styling release merely because it exists in the candidate directory.

## Keep the release bounded

1. State what the user expects in this release and identify the exact source/artifact and affected surfaces.
2. Identify real dependencies and the smallest adequate validation set before starting expensive work. Existing release records suffice; do not create a new planning system.
3. Separate unrelated unfinished functionality where technically safe. If separation is unsafe, explain the specific coupling and offer the smallest viable release option. Do not silently drop approved features or label an integrated backend change as cosmetic.
4. Run applicable checks, resolve relevant failures, and bring back a concrete package or a specific blocker. Do not end every step with another generic planning/approval cycle.
5. Follow the existing scoped deployment, artifact retention, rollback, concurrency and post-deployment smoke process when authorized. No redesign of that process is implied by an ordinary feature request.

## Control time and credit use

- Reuse passing results for unchanged artifacts and dependencies, recording their identity and limitations. Refresh live-state evidence when it can have drifted.
- Once focused checks pass, do not repeat or broaden testing without new code, a failed check, changed dependencies, or a concrete unresolved concern.
- Do not rerun full suites merely to restate confidence. Broad suites are appropriate when the changed shared code warrants them; avoid rerunning overlapping suites without purpose.
- Prefer one implementation owner and one focused independent review where needed. Avoid duplicate investigations, repeated status polling, and repeated whole-history reads. Use concise evidence-bearing coordination.
- If a small task is becoming materially larger or more expensive, stop scope expansion, explain why, recommend the minimum path, and obtain direction where new scope needs authorization. Continue independent work already authorized.
- Do not ask again for an action already authorized within its established scope. Ask only for an actual scope change, missing decision, access challenge, or required approval.

## Temporary test environments are an exception

Use existing local tests, supported previews, and established authenticated acceptance paths first. Do not routinely provision or recreate cloud resources for UX changes.

When a temporary environment is genuinely needed, explain the defect/risk it will resolve, why existing checks are insufficient, exact resources and shared-auth changes, permitted synthetic writes, workload/cost bounds, and cleanup before requesting new authorization. Reuse existing reviewed tooling. No wildcard trust, token extraction, production CORS bypass, or copying live customer records to make a test easier.

A “24-hour” expiry is a maximum resource lifetime, **not a mandatory 24-hour testing cycle**. Complete the bounded checks and clean up promptly. Plan the necessary tests together so avoidable teardown/recreation does not consume another cycle; never retain resources beyond approved limits. If a failure requires a code correction, make the next step explicit rather than restarting all release work.

## Handle blockers honestly

- Distinguish a confirmed defect from a hypothesis, a relevant release blocker from unrelated backlog, and a passed local fixture from genuine authenticated acceptance.
- Fix a failing assertion's underlying contract; do not weaken the test just to obtain green results.
- A preexisting failure is not automatically harmless or automatically a blocker for every release. Establish its impact on the proposed artifact and mandatory gates. Document the disposition; do not silently waive a relevant security or data-integrity defect.
- Do not introduce new mandatory gates based only on hypothetical risks. Any added gate needs a concrete connection to the changed behavior or an existing mandatory requirement.
- Report exactly what remains before deployment. Avoid indefinite “release readiness” work with no completion criteria.

## User-facing handoff

Keep it short and understandable:

- What approved improvements are included?
- What checks passed, and what do they actually prove?
- Is there a specific remaining blocker? What is the smallest action to resolve it?
- What exact action needs approval, if any?

Do not require Marcus to interpret technical release details without a recommendation. Technical review remains our responsibility; business authorization remains his. Current holds on deployment, submissions, email, portal access, or other actions persist until explicitly changed; this document grants none of those permissions.

## Persistence and handoff

The repository's `AGENTS.md` links this document so future work reads it at the start. Include both files in relevant worktrees and source-candidate handoffs, and reference them in coordination with Development. Check that archived-source release lanes actually received the rules. Do not claim that this file alone changes other repositories, threads, CI, or cloud enforcement.
