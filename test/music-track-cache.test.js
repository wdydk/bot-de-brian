'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrackCache } = require('../src/music-track-cache');
const track = { title:'Luna',url:'https://www.youtube.com/watch?v=abcdefghijk',duration:120,thumbnail:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',spotify:false };

test('reuses successful metadata and returns independent objects', async () => {
    const cache = new TrackCache(); let calls = 0;
    const load = async () => { calls++; return {...track,token:'never cache'}; };
    const first = await cache.get('Luna',load);
    first.title = 'modified';
    assert.deepEqual(await cache.get('Luna',load),track);
    assert.equal(calls,1);
    assert.deepEqual(cache.snapshot(),{hits:1,shared:0,misses:1});
});
test('deduplicates simultaneous lookups', async () => {
    const cache = new TrackCache(); let calls = 0;
    const load = async () => { calls++; return track; };
    const results = await Promise.all([cache.get('Luna',load),cache.get('Luna',load)]);
    assert.equal(calls,1);
    assert.notEqual(results[0],results[1]);
    assert.equal(cache.snapshot().shared,1);
});
test('expires entries and bounds cache size', async () => {
    let now = 0, calls = 0;
    const cache = new TrackCache({ttl:10,limit:2,clock:()=>now});
    const load = async () => { calls++; return track; };
    await cache.get('a',load); await cache.get('b',load);
    await cache.get('a',load); await cache.get('c',load);
    await cache.get('b',load); assert.equal(calls,4);
    now=10; await cache.get('b',load); assert.equal(calls,5);
});
test('failed requests are not cached and pending entries are released', async () => {
    const cache = new TrackCache(); let calls=0;
    const load = async () => { calls++; if(calls===1)throw Error('HTTP 429'); return track; };
    await assert.rejects(cache.get('a',load),/429/);
    assert.deepEqual(await cache.get('a',load),track);
    assert.equal(calls,2);
});
test('source restriction blocks even a cached hit and no new lookup occurs', async () => {
    const cache = new TrackCache(); let calls=0, blocked=false;
    const load = async () => { calls++; return track; };
    const check = () => { if(blocked)throw Error('cooldown'); };
    await cache.get('a',load,check); blocked=true;
    await assert.rejects(cache.get('a',load,check),/cooldown/);
    await assert.rejects(cache.get('b',load,check),/cooldown/);
    assert.equal(calls,1);
});
test('a restriction activated during lookup prevents caching its result', async () => {
    const cache = new TrackCache(); let blocked=false,calls=0;
    const check = () => {if(blocked)throw Error('cooldown');};
    await assert.rejects(cache.get('a',async()=>{calls++;blocked=true;return track;},check),/cooldown/);
    blocked=false;
    await cache.get('a',async()=>{calls++;return track;},check);
    assert.equal(calls,2);
});
