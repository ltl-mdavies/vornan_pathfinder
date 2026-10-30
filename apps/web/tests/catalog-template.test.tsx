import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {catalogTemplateCsv} from '../src/customer-catalog/catalog-template';
import {emptyCatalog, previewImport} from '../src/customer-catalog/catalog';
test('downloaded template round-trips production columns, price and approval for another customer', () => {
  const csv = catalogTemplateCsv('customer-b');
  const workbook = XLSX.read(csv, {type: 'string', raw: true});
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], {defval: '', raw: false});
  const preview = previewImport(emptyCatalog({id: 'customer-b', name: 'Example B', source: 'standard-v1'}), rows.map((raw, i) => ({row: i + 2, raw})), 'template.csv');
  assert.equal(preview.rows[0].disposition, 'new');
  assert.equal(rows[0]['Unit Price'], '0.056'); assert.equal(rows[0].Approval, 'pending');
  assert.equal(rows[0]['White Ink Required'], 'No'); assert.equal(rows[0].Shape, 'Square/Rectangle');
  assert.equal(rows[0].Corners, '1/8" Radius Corners'); assert.equal(rows[0]['Artwork URL'], '');
});
