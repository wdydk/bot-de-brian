'use strict';
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const {UserError,integer}=require('./core');
const DAY=86400000;
function settings(cfg){return {enabled:false,items:[],revision:0,...cfg.communityMarket};}
function parseShop(text){
 const items=String(text||'').split(/\r?\n/).filter(x=>x.trim()).map(line=>{
  const [id,name,price,...rest]=line.split('|').map(x=>x.trim());
  if(rest.length||!/^[a-z0-9_-]{1,24}$/.test(id||'')||!name||name.length>60)throw new UserError('Cada artículo: id | nombre | precio.');
  return {id,name,price:integer(price,1,100000)};
 });
 if(items.length>30||new Set(items.map(x=>x.id)).size!==items.length)throw new UserError('Máximo 30 artículos con IDs distintos.');
 return items;
}
function saveConfig(store,guild,member,form){
 if(member.id!==guild.ownerId)throw new UserError('Solo el dueño configura la economía.');
 const old=settings(store.guild(guild.id));if(String(old.revision)!==form.get('revision'))throw new UserError('La tienda cambió. Recarga.');
 store.patchGuild(guild.id,{communityMarket:{enabled:form.has('enabled'),items:parseShop(form.get('items')),revision:old.revision+1}});
}
function bannerURL(value){
 if(value==='off'||!value)return '';
 let url;try{url=new URL(value);}catch{throw new UserError('Usa una URL HTTPS del CDN de Discord.');}
 if(url.origin!=='https://cdn.discordapp.com'||url.username||url.password||!/^\/(?:attachments|banners|avatars)\/[a-zA-Z0-9_./%-]+$/.test(url.pathname)||value.length>1000)throw new UserError('Usa una imagen autorizada del CDN de Discord.');
 return url.href;
}
class Market{
 constructor(store,clock=Date.now){this.store=store;this.clock=clock;}
 config(g){const c=settings(this.store.guild(g));if(!c.enabled)throw new UserError('La comunidad virtual está desactivada.');return c;}
 db(){if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'community-market.sqlite'));this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS profiles(g TEXT,u TEXT,balance INTEGER NOT NULL DEFAULT 0,last_daily INTEGER,rep INTEGER NOT NULL DEFAULT 0,last_rep INTEGER,bio TEXT NOT NULL DEFAULT \'\',banner TEXT NOT NULL DEFAULT \'\',visible INTEGER NOT NULL DEFAULT 0,activity INTEGER NOT NULL DEFAULT 0,last_activity INTEGER,PRIMARY KEY(g,u)); CREATE TABLE IF NOT EXISTS inventory(g TEXT,u TEXT,item TEXT,label TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(g,u,item));');}return this.database;}
 tx(fn){const db=this.db();db.exec('BEGIN IMMEDIATE');try{const r=fn(db);db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 ensure(db,g,u){db.prepare('INSERT OR IGNORE INTO profiles(g,u) VALUES(?,?)').run(g,u);}
 profile(g,u,viewer=u){this.config(g);const p=this.db().prepare('SELECT * FROM profiles WHERE g=? AND u=?').get(g,u);if(viewer!==u&&!p?.visible)throw new UserError('Este perfil es privado.');return p||{balance:0,rep:0,bio:'',banner:'',visible:0,activity:0};}
 customize(g,u,field,value){
 this.config(g);let next;
 if(field==='bio'){next=String(value||'').trim();if(next.length>200)throw new UserError('Bio de máximo 200 caracteres.');}
 else if(field==='banner')next=bannerURL(value);
 else if(field==='visible'){if(!['on','off'].includes(value))throw new UserError('Usa on u off.');next=value==='on'?1:0;}
 else throw new UserError('Campo inválido.');
 const db=this.db();this.ensure(db,g,u);db.prepare('UPDATE profiles SET '+field+'=? WHERE g=? AND u=?').run(next,g,u);
 }
 daily(g,u){this.config(g);const now=this.clock();return this.tx(db=>{this.ensure(db,g,u);const p=db.prepare('SELECT balance,last_daily FROM profiles WHERE g=? AND u=?').get(g,u);if(p.last_daily!==null&&now-p.last_daily<DAY)throw new UserError('Ya recibiste la recompensa de hoy.');if(p.balance>999999900)throw new UserError('Límite de monedas.');db.prepare('UPDATE profiles SET balance=balance+100,last_daily=? WHERE g=? AND u=?').run(now,g,u);return 100;});}
 buy(g,u,id){
 const item=this.config(g).items.find(x=>x.id===id);if(!item)throw new UserError('Artículo no disponible.');
 return this.tx(db=>{this.ensure(db,g,u);if(!db.prepare('UPDATE profiles SET balance=balance-? WHERE g=? AND u=? AND balance>=?').run(item.price,g,u,item.price).changes)throw new UserError('Monedas insuficientes.');db.prepare('INSERT INTO inventory VALUES(?,?,?,?,1) ON CONFLICT(g,u,item) DO UPDATE SET quantity=quantity+1').run(g,u,id,item.name);return item;});
 }
 inventory(g,u){this.config(g);return this.db().prepare('SELECT label,quantity FROM inventory WHERE g=? AND u=? ORDER BY item LIMIT 50').all(g,u);}
 giveRep(g,actor,target){
 this.config(g);if(actor===target)throw new UserError('No puedes darte reputación.');
 const now=this.clock();return this.tx(db=>{this.ensure(db,g,actor);this.ensure(db,g,target);const p=db.prepare('SELECT last_rep FROM profiles WHERE g=? AND u=?').get(g,actor);if(p.last_rep!==null&&now-p.last_rep<DAY)throw new UserError('Puedes dar reputación una vez cada 24 horas.');db.prepare('UPDATE profiles SET last_rep=? WHERE g=? AND u=?').run(now,g,actor);db.prepare('UPDATE profiles SET rep=rep+1 WHERE g=? AND u=?').run(g,target);});
 }
 observe(g,u){
 if(!settings(this.store.guild(g)).enabled)return;
 const now=this.clock();this.db().prepare('UPDATE profiles SET activity=activity+1,last_activity=? WHERE g=? AND u=? AND visible=1 AND (last_activity IS NULL OR last_activity<=?)').run(now,g,u,now-60000);
 }
 ranking(g,kind){
 if(!['activity','balance','rep'].includes(kind))throw new UserError('Ranking inválido.');
 if(!settings(this.store.guild(g)).enabled)return [];
 return this.db().prepare('SELECT u,'+kind+' AS value FROM profiles WHERE g=? AND visible=1 ORDER BY '+kind+' DESC,u LIMIT 25').all(g);
 }
 overview(g){return this.db().prepare('SELECT count(*) users,COALESCE(sum(balance),0) coins FROM profiles WHERE g=?').get(g);}
 close(){this.database?.close();this.database=null;}
}
module.exports={Market,settings,parseShop,saveConfig,bannerURL};
