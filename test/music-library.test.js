'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {ManagedLibrary,isBotOwner,probe}=require('../src/music-library');
const {AudioLibrary}=require('../src/music-safety');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-lib-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const lib=new ManagedLibrary(dir,{probeAudio:async()=>2,convertCover:async(_a,b)=>fs.writeFileSync(b,'jpeg')});
 return {dir,lib};
}
const data=()=>Readable.from([Buffer.from('test')]),meta={title:'Original',artist:'Artista',rights:'Grabación propia',format:'wav',confirm:'yes'},verify=async()=>{};
test('only real Discord app owner or team owner can manage',async()=>{
 const id='123456789012345678',other='222222222222222222';
 assert.equal(await isBotOwner({application:{fetch:async()=>({owner:{id}})}},id),true);
 assert.equal(await isBotOwner({application:{fetch:async()=>({owner:{id:other,ownerId:id}})}},other),false);
 assert.equal(await isBotOwner({application:{fetch:async()=>({owner:{id:other,ownerId:id}})}},id),true);
 assert.equal(await isBotOwner({application:{fetch:async()=>{throw Error();}}},id),false);
});
test('upload persists, legacy manifest remains untouched, metadata and playlists are revision guarded',async t=>{
 const {dir,lib}=fixture(t),root=path.join(dir,'music-library');fs.mkdirSync(root);
 const old=[{id:'manual',title:'Manual',rights:'Own',file:'manual.wav'}];fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(old));fs.writeFileSync(path.join(root,'manual.wav'),'audio');
 const id=await lib.upload(data(),meta,verify),other=new ManagedLibrary(dir);
 assert.equal(other.list()[0].artist,'Artista');assert.equal(new AudioLibrary(dir).list().length,2);
 await lib.uploadCover(data(),id,verify);assert.ok(other.cover(id));
 let revision=lib.info().revision;
 lib.change('playlist-save',{title:'Mix',tracks:'manual '+id,revision},new Set(['manual',id]));
 assert.throws(()=>lib.change('edit',{...meta,id,revision},new Set()));
 revision=lib.info().revision;lib.change('delete',{id,revision,confirm:'yes'},new Set());
 assert.equal(lib.list().length,0);assert.equal(lib.info().trash.length,1);assert.deepEqual(lib.info().playlists[0].tracks,['manual']);
 assert.equal(lib.cover(id),null);lib.change('restore',{id,revision:lib.info().revision},new Set());
 assert.equal(other.list().length,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),old);
});
test('bad metadata, unauthorized commit, oversized upload and corrupt catalog do not overwrite data',async t=>{
 const {dir,lib}=fixture(t);
 await assert.rejects(lib.upload(data(),{...meta,format:'../wav'},verify));
 await assert.rejects(lib.upload(data(),{...meta,confirm:'no'},verify));
 await assert.rejects(lib.upload(data(),meta,async()=>{throw Error('denied');}));
 assert.equal(lib.list().length,0);
 const large=data();large.headers={'content-length':String(26*1024*1024)};
 await assert.rejects(lib.upload(large,meta,verify));
 const id=await lib.upload(data(),meta,verify);const file=path.join(dir,'music-library','web-managed','index.json');fs.writeFileSync(file,'bad');
 await assert.rejects(lib.upload(data(),meta,verify));assert.equal(fs.readFileSync(file,'utf8'),'bad');
 assert.ok(fs.existsSync(path.join(path.dirname(file),id+'.wav')));
});
test('Spotify associations survive old editors and restarts and can be explicitly removed',async t=>{
 const {dir,lib}=fixture(t);
 const track='https://open.spotify.com/track/5DdWTn9Snp801vg4bm0EXP';
 const playlist='https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
 const id=await lib.upload(data(),{...meta,spotifyUrl:track.replace('/track/','/intl-es/track/')+'?si=sharing'},verify);
 const edit=(action,input)=>lib.change(action,{revision:lib.info().revision,...input},new Set([id]));
 edit('edit',{...meta,id,title:'Renamed'});
 assert.equal(new AudioLibrary(dir).list()[0].spotifyUrl,track);
 assert.throws(()=>edit('edit',{...meta,id,spotifyUrl:playlist}),/canción/);
 edit('playlist-save',{title:'Favorites',tracks:id,spotifyUrl:playlist});
 const saved=lib.info().playlists[0];
 edit('playlist-save',{id:saved.id,title:'Renamed',tracks:id});
 assert.equal(new ManagedLibrary(dir).info().playlists[0].spotifyUrl,playlist);
 edit('delete',{id,confirm:'yes'});assert.equal(new AudioLibrary(dir).list().length,0);
 edit('restore',{id});assert.equal(new AudioLibrary(dir).list()[0].spotifyUrl,track);
 edit('edit',{...meta,id,spotifyUrl:''});assert.equal(new AudioLibrary(dir).list()[0].spotifyUrl,'');
});
test('real ffprobe rejects invalid audio and accepts generated WAV',async t=>{
 const {dir}=fixture(t);const file=path.join(dir,'test.wav');
 const pcm=Buffer.alloc(16000),h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(8000,24);h.writeUInt32LE(16000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);fs.writeFileSync(file,Buffer.concat([h,pcm]));
 assert.equal(await probe(file,'wav'),1);fs.writeFileSync(file,'bad');await assert.rejects(probe(file,'wav'));
});
