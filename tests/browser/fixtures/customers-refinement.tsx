// Actual production components with synthetic data only. No API/auth or production writes.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Users, LayoutDashboard, BriefcaseBusiness, FileCheck, Settings, Target, History } from 'lucide-react';
import '../../../apps/web/src/styles.css';
// App loads OperationsWorkspace before PathfinderShell; retain that cascade here.
import '../../../apps/web/src/operations-workspace.css';
import { PathfinderShell } from '../../../apps/web/src/PathfinderShell';
import { OperationsCustomers, CustomerRecordHeader, CustomerRecordTabs } from '../../../apps/web/src/OperationsCustomers';
import type { LiftCustomer } from '@pathfinder/customer-directory';
const customers: LiftCustomer[] = Array.from({length: 26}, (_, i) => ({lift_customer_id: `fixture-${i}`, customer_name: i === 0 ? 'Cedar Studio' : i === 1 ? 'North Coast Creative Manufacturing and International Display Company' : `Sample Customer ${String(i + 1).padStart(2, '0')}`, customer_number: `QA-${i+1}`, primary_market: i === 1 ? 'Specialty architectural manufacturing and retail signage' : i % 3 === 0 ? null : i % 3 === 1 ? undefined : 'Retail', sales_rep: i === 1 ? 'Alexandria Example — National Account Management' : i % 3 === 0 ? 'Sample Representative' : null, customer_status: i % 2 ? 'Inactive' : 'Regular'}));
const session = {displayName: 'QA Reviewer', email: 'qa@example.invalid', photoURL:null, token:null, domain:null, getIdToken:async()=>null, expireSession:async()=>{}, signOut:async()=>{}};
const params = new URLSearchParams(location.search);
function Fixture() {
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('Proof');
  return <PathfinderShell enabled active="Customers" items={[{label:'Dashboard',icon:LayoutDashboard},{label:'Jobs',icon:BriefcaseBusiness},{label:'Proof',icon:FileCheck},{label:'Customers',icon:Users},{label:'Targets',icon:Target},{label:'Audit',icon:History},{label:'Settings',icon:Settings}]} onNavigate={()=>setSelected('')} session={session}>
    <section id="pathfinder-content" className="workspace" data-admin-view="Customer Directory">
      {selected ? <><CustomerRecordHeader customers={customers} customer={customers.find(c=>c.lift_customer_id===selected)!} onSelect={setSelected} onDirectory={()=>setSelected('')}/><CustomerRecordTabs tabs={['Overview','Jobs','Proof','Settings']} selected={tab} onSelect={setTab} onGlobalProof={()=>{}}/><p>Local navigation fixture; selected tab: {tab}</p></> : <OperationsCustomers customers={params.has('empty') ? [] : customers} currentTab={tab} workspaceIds={params.has('unknown') ? null : customers.slice(0,15).map(c=>c.lift_customer_id)} setupError={params.has('unknown') ? 'Setup status unavailable' : undefined} refreshing={false} onSelect={setSelected} onRefresh={()=>{}} orderSummaries={{'fixture-0':{customer_id:'fixture-0',status:'confirmed',order_number:'QA-ORDER-1',confirmed_at:'2026-10-29T15:00:00Z'},'fixture-1':{customer_id:'fixture-1',status:'date_unavailable'},'fixture-2':{customer_id:'fixture-2',status:'none'}}}/>}</section>
  </PathfinderShell>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture/>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
