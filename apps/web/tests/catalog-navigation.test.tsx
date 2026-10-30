import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogNavigation} from '../src/customer-catalog/catalog-navigation';
test('pending navigation is locked synchronously and cannot discard an unresolved receipt',()=>{
 let discards=0;const guard=createCatalogNavigation('synthetic-a',()=>{discards++;});
 guard.update({dirty:true,busy:true});assert.equal(guard.snapshot().busy,true);assert.equal(guard.discardUnsaved(),false);
 guard.update({busy:false,unconfirmed:true});assert.equal(guard.discardUnsaved(),false);assert.equal(discards,0);
 guard.update({unconfirmed:false});assert.equal(guard.discardUnsaved(),true);assert.equal(discards,1);assert.equal(guard.snapshot().dirty,false);
});
test('customer scopes and returned snapshots cannot mutate one another',()=>{
 const a=createCatalogNavigation('synthetic-a',()=>{}),b=createCatalogNavigation('synthetic-b',()=>{});
 a.update({unconfirmed:true});const snapshot=a.snapshot();snapshot.unconfirmed=false;
 assert.equal(a.snapshot().unconfirmed,true);assert.equal(b.snapshot().unconfirmed,false);assert.notEqual(a.snapshot().customerId,b.snapshot().customerId);
});
