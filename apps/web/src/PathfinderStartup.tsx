import type { PathfinderAuthSession } from "./auth";
import { PathfinderShell } from "./PathfinderShell";
import { WorkspaceLoading } from "./WorkspaceLoading";

/** The authenticated lazy-chunk fallback uses the same masthead as the App. */
export function PathfinderStartup({ session, operations }: { session: PathfinderAuthSession | null; operations: boolean }) {
  if (!operations) return <WorkspaceLoading message="Opening Pathfinder…"/>;
  return <PathfinderShell enabled active="" items={[]} onNavigate={() => {}} session={session}>
    <section id="pathfinder-content" tabIndex={-1} className="workspace">
      <WorkspaceLoading embedded scope="application"/>
    </section>
  </PathfinderShell>;
}
