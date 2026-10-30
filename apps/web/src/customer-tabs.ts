/** Keep the deployed artwork label unless two different catalog tools are available. */
export function customerTabLabel(tab: string, tabs: readonly string[]) {
  return tab === "Artwork Catalog" && !tabs.includes("Catalog") ? "Catalog" : tab;
}
