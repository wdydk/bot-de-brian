'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrackCache } = require('../src/music-track-cache');
const { RemoteLookupGate } = require('../src/music-lookup-gate');
const { MusicSafety } = require('../src/music-safety');

const track = {title:'Authorized recording',url:'https://www.youtube.com/watch?v=abcdefghijk',duration:90,thumbnail:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',spotify:false};
function harness(){
    let now=100, calls=0;
    const safety=new MusicSafety(()=>now);
    const cache=new TrackCache({clock:()=>now});
    const gate=new RemoteLookupGate({clock:()=>now,wait:async ms=>{now+=ms;}});
    const check=()=>safety.check();
    const lookup=(key,load=async()=>track)=>cache.get(key,()=>gate.run(async()=>{
        calls++;
        try { return await load(); }
        catch(error){safety.record('g',error);throw error;}
    },check),check);
    return {safety,cache,gate,lookup,calls:()=>calls,advance:ms=>{now+=ms;}};
}
test('cache and global gate deduplicate same-track requests without sharing mutable state',async()=>{
    const h=harness();
    const [a,b]=await Promise.all([h.lookup('same'),h.lookup('same')]);
    a.title='changed';
    assert.equal(b.title,track.title);
    assert.equal((await h.lookup('same')).title,track.title);
    assert.equal(h.calls(),1);
    assert.equal(h.cache.shared,1);
    assert.equal(h.cache.hits,1);
    assert.equal(h.gate.snapshot().completed,1);
});
test('source restriction blocks cached and queued requests until explicit post-cooldown request',async()=>{
    const h=harness();
    await h.lookup('cached');
    const first=h.lookup('failing',async()=>{throw Error('HTTP 429');});
    const second=h.lookup('waiting');
    await Promise.all([assert.rejects(first,/429/),assert.rejects(second,/pausa temporal/)]);
    assert.equal(h.calls(),2);
    await assert.rejects(h.lookup('cached'),/pausa temporal/);
    assert.equal(h.calls(),2);
    h.advance(900001);
    assert.equal(h.calls(),2);
    assert.deepEqual(await h.lookup('waiting'),track);
    assert.equal(h.calls(),3);
});
