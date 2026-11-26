'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Music}=require('../src/music');
function setup(){
 const m=new Music({},{});const calls=[];
 const session={queue:[],current:null,volume:.65};
 m.access=async()=>{};
 m.library.list=()=>[{id:'own',title:'My Original',artist:'Artist'}];
 m.library.track=id=>({local:true,localId:id,title:'My Original'});
 m.library.file=id=>{calls.push('file:'+id);return {};};
 m.library.managed.info=()=>({playlists:[{id:'mix',title:'Originals',tracks:['own']}]});
 m._connect=async()=>{calls.push('connect');return session;};
 m._start=async s=>{s.current={track:s.queue.shift()};};
 m.lookupTrack=async()=>{throw Error('unexpected extraction');};
 m.catalog.page=async()=>{throw Error('unexpected playlist lookup');};
 return {m,calls,session,ctx:{guild:{id:'g'},user:{id:'u'}}};
}
test('Music 4.0 accepts local titles and local playlists, never remote links',async()=>{
 const {m,calls,session,ctx}=setup();
 for(const link of ['https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M','https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M','https://youtu.be/abcdefghijk','https://example.com/track.mp3','Unknown song']){
  await assert.rejects(m.play(ctx,link),/biblioteca autorizada|Spotify no entrega audio/);
 }
 assert.deepEqual(calls,[]);assert.deepEqual(session.queue,[]);
 const local=await m.play(ctx,'My Original Artist');
 assert.equal(local.requestStatus,'started');assert.equal(local.localId,'own');
 const mix=await m.play(ctx,'local-playlist:mix');
 assert.equal(mix.playlist,true);assert.equal(mix.title,'Originals');
 assert.deepEqual(calls,['file:own','connect','file:own','connect']);
});
test('invalid local files are rejected before connection or queue mutation',async()=>{
 const {m,calls,session,ctx}=setup();
 m.library.file=()=>{throw Error('file missing');};
 await assert.rejects(m.play(ctx,'local:own'),/file missing/);
 assert.deepEqual(calls,[]);assert.deepEqual(session.queue,[]);
});
