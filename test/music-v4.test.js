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
test('voice accepts local titles and playlists and never extracts remote audio',async()=>{
 const {m,calls,session,ctx}=setup();
 for(const link of ['https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M','https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M','https://youtu.be/abcdefghijk','https://example.com/track.mp3','Unknown song']){
  await assert.rejects(m.play(ctx,link),/biblioteca autorizada/);
 }
 assert.deepEqual(calls,[]);assert.deepEqual(session.queue,[]);
 const local=await m.play(ctx,'My Original Artist');
 assert.equal(local.requestStatus,'started');assert.equal(local.localId,'own');
 const mix=await m.play(ctx,'local-playlist:mix');
 assert.equal(mix.playlist,true);assert.equal(mix.title,'Originals');
 assert.deepEqual(calls,['file:own','connect','file:own','connect']);
});
test('shared Spotify links select only registered local audio and never open an external stream', async () => {
 const {m,ctx,calls,session}=setup();
 const id='5DdWTn9Snp801vg4bm0EXP', track='https://open.spotify.com/track/'+id;
 const shared='https://open.spotify.com/intl-es/track/'+id+'?si=share';
 const list='https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
 const entry={id:'own',title:'amor, cómo ESTÁS???',artist:'Yeyo',spotifyUrl:track};
 m.library.list=()=>[entry];
 m.library.managed.info=()=>({playlists:[{id:'mix',title:'Mis pistas',spotifyUrl:list,tracks:['own']}]});
 for(const request of [shared,'<'+shared+'>','spotify:track:'+id,'amor como estas? yeyo']) {
  const result=await m.play(ctx,request);
  assert.equal(result.requestStatus,'started');
  assert.equal(result.localId,'own');
 }
 const playlist=await m.play(ctx,list+'?si=link');
 assert.equal(playlist.playlist,true);
 assert.equal(playlist.title,'Mis pistas');
 const before=[...calls],current=session.current;
 m.library.list=()=>[entry,{...entry,id:'second',artist:'Una versión distinta'}];
 for(const request of [shared,'amor como estas']) {
  await assert.rejects(m.play(ctx,request), error=>/local:own/.test(error.message)&&/local:second/.test(error.message));
 }
 m.library.list=()=>[];
 await assert.rejects(m.play(ctx,shared), error=>error.spotifyUrl===track);
 await assert.rejects(m.play(ctx,'amor como estas? yeyo'),error=>/vacía/.test(error.message)&&new URL(error.spotifyUrl).hostname==='open.spotify.com');
 for(const url of ['https://open.spotify.com.example/track/'+id,'https://example.com/song.mp3','file:///audio.wav']) {
  await assert.rejects(m.play(ctx,url),error=>!error.spotifyUrl);
 }
 assert.deepEqual(calls,before);assert.equal(session.current,current);assert.deepEqual(session.queue,[]);
});
test('invalid local files are rejected before connection or queue mutation',async()=>{
 const {m,calls,session,ctx}=setup();
 m.library.file=()=>{throw Error('file missing');};
 await assert.rejects(m.play(ctx,'local:own'),/file missing/);
 assert.deepEqual(calls,[]);assert.deepEqual(session.queue,[]);
});
