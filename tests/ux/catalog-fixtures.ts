import { applyImport, emptyCatalog, previewImport } from "../../packages/catalog-domain/src/catalog";
import { DEFAULT_CHANGE_REASONS } from "../../packages/catalog-domain/src/change-reasons";

/** Synthetic UI transport only. No external API, customer files, or persistent server state. */
export function createCatalogReview(query: URLSearchParams) {
  const records = new Map<string, ReturnType<typeof emptyCatalog>>();
  let writes = 0;
  let release: (() => void) | null = null;
  const mode = query.get("catalogReview");
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"Content-Type":"application/json"}});
  return {
    counts: () => ({writes}),
    release: () => { release?.(); release = null; },
    async handle(path: string, method: string) {
      const match = path.match(/^\/api\/customers\/([^/]+)\/catalog-records(.*)$/);
      if (!match) return null;
      const customer = {id: match[1], name: "Synthetic catalog customer", source: "standard-v1"};
      if (!records.has(customer.id)) {
        const catalog = emptyCatalog(customer);
        const preview = previewImport(catalog, [{row:2, raw:{"Customer Number":customer.id,"Source ID":"sample-1",SKU:"QA-LABEL-001",Name:"Synthetic label",Product:"Sample label",Width:"4",Height:"5",Material:"Example substrate",Laminate:"None",Varnish:"None",Shape:"Square/Rectangle","Corner Radius":"1/8","Spacing (in)":"0.125","White Ink Required":"No","Cut Type":"Laser",Corners:'1/8" Radius Corners',Unwind:"3-Right","Roll Mode":"Max Labels per Roll","Roll Value":"1000","Unit Price":"0.056",Approval:"pending"}}], "synthetic.csv");
        records.set(customer.id, applyImport(catalog, preview, "2026-10-30T12:00:00Z"));
      }
      if (method !== "GET") {
        writes++;
        if (mode === "pending") await new Promise<void>(resolve => {
          // Native item dialogs make the outer harness controls inert; always finish the simulation.
          const timer = setTimeout(resolve, 8000);
          release = () => { clearTimeout(timer); resolve(); };
        });
        if (mode === "unknown" || mode === "pending") return reply({error:"Synthetic interrupted response"},503);
        return reply({error:"Synthetic save rejected; no saved data changed."},422);
      }
      if (match[2].startsWith("/operations/")) return reply({status:"unconfirmed",revision:null,submissionEnabled:false});
      const catalog = records.get(customer.id)!;
      return reply({customer,operatorId:"synthetic-operator",capabilities:{edit:mode !== "reader"},submissionEnabled:false,record:{catalog,revision:catalog.revision,reasons:DEFAULT_CHANGE_REASONS,actor:"synthetic-operator",at:"2026-10-30T12:00:00Z"}});
    }
  };
}
