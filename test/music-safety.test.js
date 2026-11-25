'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MusicSafety,AudioLibrary,classify,typed}=require('../src/music-safety');
const {Music}=require('../src/music');
test('429 opens global cooldown, no extension from blocked requests, no secrets in classification',()=>{
 let now=1;const s=new MusicSafety(()=>now);
 assert.equal(classify(Error('HTTP Error 429: Too Many Requests secret')), 'RATE_LIMIT');
 assert.equal(classify(Error("Sign in to confirm you're not a bot")),'BOT_CHECK');
 assert.equal(classify(Error('403')),'FORBIDDEN');
 assert.equal(s.record('a',Error('429')).stop,true);
 assert.throws(()=>s.check(),/pausa temporal/);
 assert.equal(s.record('a',typed('COOLDOWN')).notice,false);
 assert.equal(s.snapshot('b').cooldownSeconds,900);
 now+=900001;s.check();assert.equal(s.snapshot('a').suppressed,1);
});
test('three ordinary failures stop queue and successful playback resets streak',()=>{
 const s=new MusicSafety(()=>0);
 assert.equal(s.record('a',Error('unavailable')).stop,false);
 assert.equal(s.record('a',Error('unavailable')).stop,false);
 assert.equal(s.record('a',Error('unavailable')).stop,true);
 assert.equal(s.blocked(),false);s.success('a');
 assert.equal(s.snapshot('a').consecutive,0);
});
test('library only resolves registered regular files and does not accept external URLs or symlinks',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-audio-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'music-library');fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'song.wav'),'test');fs.writeFileSync(path.join(dir,'secret.wav'),'secret');
 fs.symlinkSync(path.join(dir,'secret.wav'),path.join(root,'link.wav'));
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify([
 {id:'song',title:'Original',file:'song.wav',rights:'Own recording'},
 {id:'bad',title:'Bad',file:'../secret.wav',rights:'test'},
 {id:'link',title:'Link',file:'link.wav',rights:'test'},
 {id:'url',title:'URL',file:'https://example.com/x.mp3',rights:'test'},
 {id:'no-rights',title:'Missing rights',file:'song.wav'}]));
 const lib=new AudioLibrary(dir);assert.deepEqual(lib.list().map(x=>x.id),['song']);
 assert.equal(lib.track('song').local,true);assert.throws(()=>lib.track('bad'));assert.throws(()=>lib.file('link'));
});
test('failure stops remote playlist without removing authorized local tracks and sends one warning',async()=>{
 const m=new Music({},{}),sent=[],s={guildId:'g',queue:[{query:'song'},{page:{}},{local:true,localId:'a'}],loop:'queue',text:{send:async x=>sent.push(x)}};
 await m.reportFailure(s,Error('429 secret'),{query:'x'});
 assert.deepEqual(s.queue,[{local:true,localId:'a'}]);assert.equal(s.loop,'off');
 await m.reportFailure(s,typed('COOLDOWN'),{query:'y'});
 assert.equal(sent.length,1);assert.doesNotMatch(JSON.stringify(sent),/secret/);
});
test('web actions require control authorization and validate values',async()=>{
 const m=new Music({},{});let actions=0;m.control=async()=>{throw Error('denied');};m.action=async()=>actions++;
 await assert.rejects(m.webAction({},'stop'),/denied/);assert.equal(actions,0);
 m.control=async()=>({});await assert.rejects(m.webAction({},'volume','101'));await assert.rejects(m.webAction({},'exec','x'));
 await m.webAction({},'volume','40');assert.equal(actions,1);
});
