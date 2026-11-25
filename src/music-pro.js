'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {UserError}=require('./core');
const idOK=x=>typeof x==='string'&&/^[a-z0-9_-]{1,40}$/.test(x);
class MusicPro{
 constructor(store){this.store=store;}
 db(){if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'music-pro.sqlite'));this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS favorites(g TEXT,u TEXT,track TEXT,PRIMARY KEY(g,u,track)); CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,g TEXT,track TEXT,title TEXT,at INTEGER); CREATE INDEX IF NOT EXISTS music_history ON history(g,at); CREATE TABLE IF NOT EXISTS lists(g TEXT,id TEXT PRIMARY KEY,title TEXT,tracks TEXT,editor TEXT,revision INTEGER); CREATE TABLE IF NOT EXISTS lyrics(track TEXT PRIMARY KEY,body TEXT,rights TEXT);');}return this.database;}
 favorites(g,u){return this.db().prepare('SELECT track FROM favorites WHERE g=? AND u=? ORDER BY track LIMIT 100').all(g,u).map(x=>x.track);}
 favorite(g,u,track,available,remove=false){
 if(!idOK(track))throw new UserError('Pista inválida.');
 const db=this.db();
 if(remove){db.prepare('DELETE FROM favorites WHERE g=? AND u=? AND track=?').run(g,u,track);return;}
 if(!available.has(track))throw new UserError('Pista no disponible.');
 if(this.favorites(g,u).length>=100&&!this.favorites(g,u).includes(track))throw new UserError('Máximo 100 favoritos.');
 db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?,?)').run(g,u,track);
 }
 record(g,track){if(!track?.local||!idOK(track.localId)||!this.store.directory||!this.store.guild(g).musicHistoryEnabled)return;
 try{const db=this.db();db.prepare('INSERT INTO history(g,track,title,at) VALUES(?,?,?,?)').run(g,track.localId,String(track.title).slice(0,150),Date.now());db.prepare('DELETE FROM history WHERE g=? AND id NOT IN (SELECT id FROM history WHERE g=? ORDER BY id DESC LIMIT 100)').run(g,g);}catch(e){console.warn('[MUSIC HISTORY]',e.code||e.name);}
 }
 history(g){return this.db().prepare('SELECT track,title,at FROM history WHERE g=? ORDER BY id DESC LIMIT 100').all(g);}
 lists(g){return this.db().prepare('SELECT id,title,tracks,editor,revision FROM lists WHERE g=? ORDER BY title LIMIT 30').all(g).map(x=>({...x,tracks:JSON.parse(x.tracks)}));}
 playlist(g,id){return this.lists(g).find(x=>x.id===id);}
 saveList(g,u,input,available){
 const title=String(input.title||'').trim(),tracks=String(input.tracks||'').split(/[\s,]+/).filter(Boolean);
 if(!title||title.length>100||!tracks.length||tracks.length>30||new Set(tracks).size!==tracks.length||tracks.some(x=>!idOK(x)||!available.has(x)))throw new UserError('Playlist: nombre y 1–30 IDs de pistas locales diferentes.');
 const db=this.db(),old=input.id?this.playlist(g,input.id):null;
 if(input.id){if(!old||String(old.revision)!==String(input.revision))throw new UserError('La playlist cambió o no pertenece al servidor.');db.prepare('UPDATE lists SET title=?,tracks=?,editor=?,revision=revision+1 WHERE g=? AND id=?').run(title,JSON.stringify(tracks),u,g,old.id);}
 else{if(this.lists(g).length>=30)throw new UserError('Máximo 30 playlists por servidor.');db.prepare('INSERT INTO lists VALUES(?,?,?,?,?,1)').run(g,'p-'+randomUUID().replace(/-/g,''),title,JSON.stringify(tracks),u);}
 }
 removeList(g,id,revision){if(!this.db().prepare('DELETE FROM lists WHERE g=? AND id=? AND revision=?').run(g,id,Number(revision)).changes)throw new UserError('Playlist no disponible o cambió.');}
 lyric(id){return this.db().prepare('SELECT body,rights FROM lyrics WHERE track=?').get(id);}
 saveLyric(id,body,rights,available,confirm){
 if(!idOK(id)||!available.has(id)||confirm!=='yes')throw new UserError('Confirma autorización y selecciona una pista local.');
 body=String(body||'').trim();rights=String(rights||'').trim();
 if(body.length>8000||!rights||rights.length>300)throw new UserError('Letra de hasta 8000 caracteres y declaración de autorización.');
 const db=this.db();
 if(!body){db.prepare('DELETE FROM lyrics WHERE track=?').run(id);return;}
 db.prepare('INSERT INTO lyrics VALUES(?,?,?) ON CONFLICT(track) DO UPDATE SET body=excluded.body,rights=excluded.rights').run(id,body,rights);
 }
 close(){this.database?.close();this.database=null;}
}
module.exports={MusicPro};
