/** Reproducible sanitized fixture preview. No runtime store, network or submission path. */
import { readFile } from 'node:fs/promises';
import { stickerPressV1, sha256 } from '../apps/api/src/json-intake/adapter.js';
import { buildJsonLiftPreview } from '../apps/api/src/json-intake/lift-preview.js';

const payload = JSON.parse(await readFile(new URL('../apps/api/tests/fixtures/json-intake/sample-factory-test.json', import.meta.url), 'utf8'));
const identity = {customer_id: 'synthetic', customer_name: 'Sticker Press', integration_id: 'synthetic-json', store: 'ltlco', environment: 'test' as const, schema: 'stickerpress.order.v1'};
const adapted = stickerPressV1.validate(payload, identity);
const packet = buildJsonLiftPreview({identity, adapted, assets: [], receipt_id: `rcpt_${sha256('synthetic-preview')}`, revision: 0, fingerprint: adapted.fingerprint}, {
  scope: {customer_id: identity.customer_id, integration_id: identity.integration_id, store: identity.store, environment: 'test'},
  revision: 'unconfigured-v1', review_reference: 'local-unresolved-mapping-review', customer: null,
  product_identifier: 'lift_unit_number', products: []
});
process.stdout.write(JSON.stringify({fixture_only: true, ...packet}, null, 2) + '\n');
