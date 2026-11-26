'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteLookupGate } = require('../src/music-lookup-gate');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('serializes lookups with a gap after completion',async()=>{
    let now=0,active=0,peak=0;
    const order=[],gate=new RemoteLookupGate({clock:()=>now,wait:async ms=>{now+=ms;}});
    const task=id=>async()=>{active++;peak=Math.max(peak,active);order.push([id,now]);await Promise.resolve();now+=100;active--;return id;};
    assert.deepEqual(await Promise.all([gate.run(task('a')),gate.run(task('b')),gate.run(task('c'))]),['a','b','c']);
    assert.equal(peak,1);
    assert.deepEqual(order,[['a',0],['b',2100],['c',4200]]);
    assert.deepEqual(gate.snapshot(),{active:0,waiting:0,completed:3,rejected:0});
});
test('bounds pending work, rejects overload and releases capacity',async()=>{
    let release;
    const gate=new RemoteLookupGate({gap:0,limit:2});
    const first=gate.run(()=>new Promise(resolve=>{release=resolve;}));
    await tick();
    const second=gate.run(async()=>2);
    await assert.rejects(gate.run(async()=>3),{code:'MUSIC_LOOKUP_BUSY'});
    assert.deepEqual(gate.snapshot(),{active:1,waiting:1,completed:0,rejected:1});
    release(1);
    assert.deepEqual(await Promise.all([first,second]),[1,2]);
    assert.equal(await gate.run(async()=>4),4);
});
test('rechecks source cooldown immediately before starting queued work',async()=>{
    let blocked=false,ran=false;
    const gate=new RemoteLookupGate({gap:0});
    const check=()=>{if(blocked)throw Error('cooldown');};
    const first=gate.run(async()=>{blocked=true;throw Error('HTTP 429');},check);
    const second=gate.run(async()=>{ran=true;},check);
    await Promise.all([assert.rejects(first,/429/),assert.rejects(second,/cooldown/)]);
    assert.equal(ran,false);
    assert.equal(gate.snapshot().waiting,0);
    blocked=false;
    assert.equal(await gate.run(async()=>5,check),5);
});
test('checks restrictions again after the pacing delay',async()=>{
    let now=0,blocked=false;
    const gate=new RemoteLookupGate({clock:()=>now,wait:async ms=>{now+=ms;blocked=true;}});
    const check=()=>{if(blocked)throw Error('cooldown');};
    await gate.run(async()=>1,check);
    await assert.rejects(gate.run(async()=>assert.fail('must not start'),check),/cooldown/);
    assert.equal(gate.snapshot().completed,1);
});
