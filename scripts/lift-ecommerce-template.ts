/** Pure draft generator. No target store/config writes. Pass an exported High End Work template to clone a reviewed customization. */
import { readFile } from 'node:fs/promises';
import { createSeedOutputTemplate, createLiftEcommerceOutputTemplate } from '../apps/api/src/lift-output-templates.js';
const timestamp='2026-09-28T00:00:00.000Z';
const base=process.argv[2] ? JSON.parse(await readFile(process.argv[2],'utf8')) : createSeedOutputTemplate(timestamp);
process.stdout.write(JSON.stringify(createLiftEcommerceOutputTemplate(base,timestamp),null,2)+'\n');
