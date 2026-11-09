import {openSync, closeSync, readSync, readFileSync, lstatSync, fstatSync, constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const pins = JSON.parse(readFileSync(new URL('./release-input-pins.json', import.meta.url)));
const profile = process.env.PROOF_REVIEW_PROFILE ?? 'private';
const reject = () => { throw Error('Pinned release input rejected'); };
if (!['fixture', 'private'].includes(profile)) reject();
const root = fileURLToPath(new URL(profile === 'fixture'
  ? '../test-fixtures/release-inputs/' : '../../private/original/', import.meta.url));
const safeName = name => typeof name === 'string' &&
  name.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');

export function validateReleaseInput(bytes, name, selectedProfile = profile) {
  if (!['fixture', 'private'].includes(selectedProfile) || !safeName(name)) reject();
  const entry = pins[selectedProfile]?.[name];
  if (!entry || !Buffer.isBuffer(bytes) || bytes.length !== entry.bytes ||
      bytes.length > 32 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256) reject();
  return Buffer.from(bytes);
}

export function readReleaseInput(name) {
  if (!safeName(name) || !Object.hasOwn(pins[profile], name)) reject();
  return readBoundedPinnedFile(root,name,pins[profile][name]);
}

/** Integrity primitive only, not an authorization API. The calling entrypoint
 * must fix the root and supply independently reviewed pins, never user input.
 */
export function readBoundedPinnedFile(root,name,entry) {
  if(typeof root!=='string'||!root.startsWith('/')||!safeName(name)||
     !Number.isSafeInteger(entry?.bytes)||entry.bytes<1||entry.bytes>32*1024*1024||
     !/^[a-f0-9]{64}$/.test(entry.sha256??''))reject();
  // No caller-selected root or expected digest. Reject links in every component,
  // including the profile directory; the final open also forbids symlink following.
  for (let cursor = root; cursor !== dirname(cursor); cursor = dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) reject();
  }
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) reject();
  }
  if (!lstatSync(path).isFile()) reject();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== entry.bytes || stat.size > 32 * 1024 * 1024) reject();
    // Bounded allocation/read even if a file grows after the initial stat.
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, count);
      if (n === 0) break;
      count += n;
    }
    const result=bytes.subarray(0,count);
    if(count!==entry.bytes||createHash('sha256').update(result).digest('hex')!==entry.sha256)reject();
    return Buffer.from(result);
  } finally { closeSync(fd); }
}

export function releaseInputNames(prefix) {
  if (typeof prefix !== 'string') reject();
  return Object.freeze(Object.keys(pins[profile]).filter(name => name.startsWith(prefix)).sort());
}
