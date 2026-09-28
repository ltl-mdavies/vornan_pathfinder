/** Synthetic combined-field review only. Does not read the private WooCommerce XML or create a job. */
import { readFile } from 'node:fs/promises';
import type { CanonicalEcommerceOrder } from '@pathfinder/canonical';
import { generateLiftPayload, projectLiftEcommercePayload, LIFT_ECOMMERCE_TEMPLATE_ID } from '@pathfinder/lift-adapter';
import { stickerPressV1 } from '../apps/api/src/json-intake/adapter.js';
const fixture=JSON.parse(await readFile(new URL('../apps/api/tests/fixtures/json-intake/sample-factory-test.json',import.meta.url),'utf8'));
const source:CanonicalEcommerceOrder=stickerPressV1.validate(fixture,{customer_id:'synthetic',customer_name:'Example Label Customer',integration_id:'combined-review',store:'ltlco',environment:'test',schema:'stickerpress.order.v1'}).canonical;
source.source.schema='pathfinder.ecommerce-review.v1';
source.source.source_system='Synthetic combined-field example';
source.order.source_status='Processing';source.order.reference_number=null;
source.order.account_rep=null;source.order.invoice_email='billing@example.invalid';
source.order.billing={first_name:'Example',last_name:'Buyer',company:'Example Label Customer',address_1:'123 Example Street',address_2:null,city:'Example City',state:'OH',postal_code:'45000',country:'US',email:'billing@example.invalid',phone:null,address_book_reference:'primary'};
source.order.ship_date='2026-12-01';
source.order.pricing={currency:null,discount:null,subtotal:null,shipping:null,refund:null,tax:null,total:null};
source.order.payment={method:'Use My Account',authorized_amount:null,charged_amount:null,authorization_code:null};
source.order.coupons=[];
for(const line of source.lines) {
  // Remove access links from this internal review; no document has been published for this example.
  line.artwork={file_name:line.artwork?.file_name,checksum:line.artwork?.checksum};
  line.pricing={item_base_price:null,customer_price:'0.10900'};line.sample=false;
  line.production={...line.production,varnish:'Semi-gloss',orientation:null,die_reference:null,cut_complexity:'Radius corners',white_ink_required:false};
  line.proof_status='approved';
}
source.lines[0].roll_finishing={specification:'max_roll_diameter',value:14,unwind_direction:'3-Right',spacing:0.125};
source.lines[1].roll_finishing={specification:'max_labels_per_roll',value:500,unwind_direction:'3-Right',spacing:0.125};
// Keep approval provenance distinct from current shop workflow status; examples are not production approval.
const payload=projectLiftEcommercePayload(LIFT_ECOMMERCE_TEMPLATE_ID,generateLiftPayload(source),source);
process.stdout.write(JSON.stringify({review_only:true,submission_allowed:false,fixture_only:true,output_template_id:LIFT_ECOMMERCE_TEMPLATE_ID,payload},null,2)+'\n');
