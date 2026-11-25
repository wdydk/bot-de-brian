'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MusicPro}=require('../src/music-pro');
test('favorites are private per guild/user, collaborative lists revision-guarded and history opt-in',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-music-pro-')),cfg={musicHistoryEnabled:false},store={directory:dir,guild:()=>cfg};
 let m=new MusicPro(store);t.after(()=>{m.close();fs.rmSync(dir,{recursive:true,force:true});});
 const available=new Set(['song','song2']);m.favorite('a','u','song',available);assert.deepEqual(m.favorites('b','u'),[]);assert.deepEqual(m.favorites('a','v'),[]);
 m.saveList('a','u',{title:'Mix',tracks:'song song2'},available);let p=m.lists('a')[0];assert.throws(()=>m.saveList('b','v',{...p,tracks:'song'},available));
 m.saveList('a','v',{...p,tracks:'song'},available);assert.throws(()=>m.removeList('a',p.id,p.revision));assert.equal(m.lists('a')[0].editor,'v');
 m.record('a',{local:true,localId:'song',title:'Original'});assert.equal(m.history('a').length,0);cfg.musicHistoryEnabled=true;
 m.record('a',{local:false,title:'Remote'});m.record('a',{local:true,localId:'song',title:'Original'});
 assert.throws(()=>m.saveLyric('song','own lyric','own',available,'no'));m.saveLyric('song','own lyric','own',available,'yes');
 m.close();m=new MusicPro(store);assert.equal(m.history('a').length,1);assert.equal(m.history('b').length,0);assert.equal(m.lyric('song').body,'own lyric');
});
