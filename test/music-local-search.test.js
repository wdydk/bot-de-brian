'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {localTrackMatch}=require('../src/music-safety');
const {Music}=require('../src/music');
const entries=[{id:'own1',title:'My Recording',artist:'Example'},{id:'own2',title:'Another Song',artist:'Artist'}];
test('local search matches only exact unique authorized tracks',()=>{
 for(const query of ['my recording','MY RECORDING EXAMPLE','Example - My Recording','My Recording de Example','  My   Recording  '])
  assert.equal(localTrackMatch(entries,query),'own1');
 for(const query of ['My','Recording','https://example.com/My%20Recording','local:own1','../My Recording','My Recording unknown',''])
  assert.equal(localTrackMatch(entries,query),null);
 assert.equal(localTrackMatch([...entries,{id:'other',title:'My Recording'}],'My Recording'),null);
});
test('authorized local title can play during remote cooldown without contacting extractor',async()=>{
 const m=new Music({},{}),calls=[];
 m.library.list=()=>entries;
 m.library.track=id=>({local:true,localId:id,title:'My Recording',spotify:false});
 m.library.file=id=>{calls.push(id);return {};};
 m.access=async()=>{};
 m.safety.record('g',Error('429'));
 m.lookupTrack=async()=>{throw Error('Unexpected remote lookup');};
 const session={queue:[],destroyed:false,current:null};
 m._connect=async()=>session;
 m._start=async s=>{s.current={track:s.queue.shift()};};
 const ctx={guild:{id:'g'},user:{id:'u'}};
 const result=await m.play(ctx,'My Recording Example');
 assert.equal(result.local,true);
 assert.equal(result.requestStatus,'started');
 assert.deepEqual(calls,['own1']);
 await assert.rejects(m.play(ctx,'Unknown recording'),/biblioteca autorizada/);
 assert.equal(m.safety.blocked(),true);
});
