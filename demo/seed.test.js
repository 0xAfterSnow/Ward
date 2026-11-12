import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seedDemo} from './seed.js';
test('mock seed creates funded history, one held payment and one stopped scam',async()=>{
 const {code,wallet}=await seedDemo(':memory:');
 assert.ok(code);assert.equal(wallet.balance,'115.5');assert.equal(wallet.pending.length,1);assert.equal(wallet.blockedAlerts.length,1);
 assert.equal(wallet.audit.filter(r=>r.decision==='ALLOW').length,3);
 assert.equal(wallet.paired,false);assert.equal(wallet.mode,undefined);
});
