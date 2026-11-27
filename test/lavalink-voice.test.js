'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {LavaApi,LavaVoice,approvedUrl,testUrl,toneWav}=require('../src/lavalink-voice');
const env={LAVALINK_HOST:'lavalink.railway.internal',LAVALINK_PASSWORD:'test-secret',WEB_ENABLED:'true',WEB_BASE_URL:'https://timmy.example',LAVALINK_AUTHORIZED_URLS:'https://music.example/authorized.wav'};
test('only exact operator-authorized HTTPS URLs can select Lavalink; generated tone has valid RIFF header',()=>{
 assert.equal(approvedUrl('https://music.example/authorized.wav',env),'https://music.example/authorized.wav');
 for(const url of ['https://music.example/other.wav','http://music.example/authorized.wav','https://open.spotify.com/track/1xBg37ECDzty1i0UKPj9qa','https://music.example@evil.example/authorized.wav'])assert.equal(approvedUrl(url,env),null);
 assert.equal(testUrl(env),'https://timmy.example/music/test-tone.wav');
 const tone=toneWav();assert.equal(tone.toString('ascii',0,4),'RIFF');assert.equal(tone.readUInt32LE(40),480000);
});
test('HTTP loading rejects metadata-only Spotify tracks, playlists and unauthorized long streams',async()=>{
 let result={loadType:'track',data:{encoded:'encoded',info:{sourceName:'http',title:'Test',length:5000,isStream:false}}};
 const api=new LavaApi({env,request:async(url,options)=>{
  assert.equal(url.pathname,'/v4/loadtracks');assert.equal(options.headers.Authorization,'test-secret');return Response.json(result);
 }});
 const url=approvedUrl('https://music.example/authorized.wav',env);
 assert.equal((await api.load(url)).lavaEncoded,'encoded');
 result.data.info.sourceName='spotify';await assert.rejects(api.load(url));
 result.data.info.sourceName='http';result.data.info.isStream=true;await assert.rejects(api.load(url));
 result={loadType:'playlist',data:{tracks:[]}};await assert.rejects(api.load(url));
});
test('Lavalink voice transport forwards four Discord voice fields and waits for track start',async()=>{
 let socket,adapterDestroyed=false,player,deleted=false;const payloads=[],events=[];
 class FakeSocket extends EventEmitter {
  constructor(url,opts){super();socket=this;assert.equal(url.pathname,'/v4/websocket');assert.equal(opts.headers['User-Id'],'bot');queueMicrotask(()=>this.emit('message',JSON.stringify({op:'ready',sessionId:'lava-session'})));}
  terminate(){this.emit('close');}
  event(data){this.emit('message',JSON.stringify({guildId:'guild',...data}));}
 }
 const guild={id:'guild',voiceAdapterCreator:methods=>({
  sendPayload(payload){payloads.push(payload);if(payload.d.channel_id){methods.onVoiceServerUpdate({endpoint:'voice.example',token:'discord-voice-token'});methods.onVoiceStateUpdate({user_id:'bot',channel_id:'channel',session_id:'discord-session'});}return true;},
  destroy(){adapterDestroyed=true;}
 })};
 const api={origin:new URL('http://lavalink.railway.internal:2333'),password:'secret',async call(path,method,body){
  assert.equal(path,'/v4/sessions/lava-session/players/guild');
  if(method==='DELETE'){deleted=true;return null;}
  if(body.voice){assert.deepEqual(body.voice,{endpoint:'voice.example',token:'discord-voice-token',sessionId:'discord-session',channelId:'channel'});return {state:{connected:true}};}
  player=body;
  if(body.track?.encoded)socket.event({op:'event',type:'TrackStartEvent',track:{userData:body.track.userData}});
  return {};
 }};
 const voice=new LavaVoice({api,guild,voiceId:'channel',userId:'bot',Socket:FakeSocket,onEvent:(...args)=>events.push(args)});
 try{
  await voice.connect();assert.equal(voice.state.status,'ready');
  await voice.play({lavaEncoded:'test'},'token',.65);assert.equal(player.volume,65);
  socket.event({op:'event',type:'TrackEndEvent',reason:'finished',track:{userData:{timmyToken:'old'}}});assert.equal(events.length,0);
  socket.event({op:'event',type:'TrackEndEvent',reason:'finished',track:{userData:{timmyToken:'token'}}});assert.deepEqual(events,[['token','end']]);
  await voice.stop();assert.equal(player.track.encoded,null);
 }finally{voice.destroy();}
 assert.equal(payloads.at(-1).d.channel_id,null);assert.equal(adapterDestroyed,true);assert.equal(deleted,true);
});
