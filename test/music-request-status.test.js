'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {requestStatus} = require('../src/music');

test('reports a request as started only if its own track is current', () => {
    assert.equal(requestStatus({current:{track:{requestId:'a'}},queue:[]},'a'),'started');
    assert.equal(requestStatus({current:{track:{requestId:'b'}},queue:[]},'a'),'failed');
});
test('reports queued requests separately from failed starts', () => {
    assert.equal(requestStatus({current:{track:{requestId:'b'}},queue:[{requestId:'a'}]},'a'),'queued');
    assert.equal(requestStatus({current:null,queue:[]},'a'),'failed');
    assert.equal(requestStatus({destroyed:true,current:{track:{requestId:'a'}},queue:[]},'a'),'failed');
});

test('audiotest confirma el tono únicamente si el reproductor consiguió iniciarlo', async () => {
    const {Music}=require('../src/music');
    const music=new Music({},{}), session={queue:[],current:null};
    const ctx={guild:{id:'g'},user:{id:'u'}};
    music.access=async()=>{};
    music._connect=async()=>session;
    music._start=async s=>{s.queue.shift();};
    await assert.rejects(music.test(ctx),/no llegó a reproducirse/);
    music._start=async s=>{s.current={track:s.queue.shift()};};
    await music.test(ctx);
    assert.equal(session.current.track.test,true);
    await assert.rejects(music.test(ctx),/Primero detén/);
});
