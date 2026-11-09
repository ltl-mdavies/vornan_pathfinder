import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {bindings,validateBindingBytes} from './bindings.mjs';
const bytes=readFileSync(new URL('../test-fixtures/bindings.json',import.meta.url));
test('self-contained fixture is pinned and deeply immutable',()=>{assert.equal(bindings.repository,'example/proof-review');assert.ok(Object.isFrozen(bindings.target));assert.throws(()=>bindings.target.bucket='other');});
for(const change of [b=>b.target.bucket='arbitrary-target',b=>b.ownerId=999,b=>b.environments['proof-release-owner']=999,b=>b.extra=true])test('altered fixture cannot override pinned config',()=>{const b=JSON.parse(bytes);change(b);assert.throws(()=>validateBindingBytes(Buffer.from(JSON.stringify(b)),'fixture'),/rejected/);});
test('cannot use fixture under private pin or arbitrary profile',()=>{assert.throws(()=>validateBindingBytes(bytes,'private'));assert.throws(()=>validateBindingBytes(bytes,'other'));});
test('malformed or oversize data refused',()=>{assert.throws(()=>validateBindingBytes(Buffer.from('{'),'fixture'));assert.throws(()=>validateBindingBytes(Buffer.alloc(8193),'fixture'));});
