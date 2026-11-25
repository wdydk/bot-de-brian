'use strict';
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const {UserError,ExpiringCache}=require('./core');
const rbxId=x=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x);
const discordId=x=>typeof x==='string'&&/^\d{17,20}$/.test(x);
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
class Roblox{
 constructor(store,env=process.env,fetchImpl=fetch){this.store=store;this.env=env;this.fetch=fetchImpl;this.cache=new ExpiringCache(60000,1000);}
 ready(){return Boolean(this.env.ROBLOX_CLIENT_ID&&this.env.ROBLOX_CLIENT_SECRET);}
 db(){if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'roblox-links.sqlite'));this.database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS links(discord TEXT PRIMARY KEY,roblox TEXT NOT NULL UNIQUE,at INTEGER NOT NULL)');}return this.database;}
 linked(user){return this.db().prepare('SELECT roblox,at FROM links WHERE discord=?').get(user)||null;}
 unlink(user){this.db().prepare('DELETE FROM links WHERE discord=?').run(user);}
 begin(origin,user){
  if(!this.ready()||!discordId(user)||!origin.startsWith('https://'))throw new UserError('Vinculación Roblox no configurada o requiere HTTPS.');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const pending={state,verifier,user,at:Date.now()},url=new URL('https://apis.roblox.com/oauth/v1/authorize');
  url.search=new URLSearchParams({client_id:this.env.ROBLOX_CLIENT_ID,redirect_uri:origin+'/roblox/callback',scope:'openid profile',response_type:'code',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
  return {pending,url:url.href};
 }
 async json(url,options={}){
  let res;try{res=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new UserError('Roblox no respondió.');}
  if(!res.ok)throw new UserError(res.status===429?'Roblox limitó las solicitudes. Espera.':'Roblox no confirmó esta consulta.');
  try{return await res.json();}catch{throw new UserError('Respuesta de Roblox inválida.');}
 }
 async connect(origin,user,pending,state,code,verify){
  if(!this.ready()||!pending||pending.user!==user||Date.now()-pending.at>300000||!eq(pending.state,state)||typeof code!=='string'||!code||code.length>2048)throw new UserError('Vinculación caducada o no válida.');
  const token=await this.json('https://apis.roblox.com/oauth/v1/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.env.ROBLOX_CLIENT_ID,client_secret:this.env.ROBLOX_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:origin+'/roblox/callback',code_verifier:pending.verifier}).toString()});
  if(typeof token.access_token!=='string'||!token.access_token)throw new UserError('Roblox no devolvió autorización.');
  try{
   const profile=await this.json('https://apis.roblox.com/oauth/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
   if(!rbxId(profile.sub))throw new UserError('Roblox no devolvió un ID válido.');
   await verify();
   const db=this.db(),owner=db.prepare('SELECT discord FROM links WHERE roblox=?').get(profile.sub);
   if(owner&&owner.discord!==user)throw new UserError('Esta cuenta ya está vinculada. Desvincúlala desde tu otra cuenta de Discord.');
   db.prepare('INSERT INTO links VALUES(?,?,?) ON CONFLICT(discord) DO UPDATE SET roblox=excluded.roblox,at=excluded.at').run(user,profile.sub,Date.now());
   return profile.sub;
  }finally{
   // No tokens are stored. Best-effort revocation of the short-lived grant.
   const revoke=token.refresh_token||token.access_token;
   await this.fetch('https://apis.roblox.com/oauth/v1/token/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.env.ROBLOX_CLIENT_ID,client_secret:this.env.ROBLOX_CLIENT_SECRET,token:revoke}).toString(),redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
 }
 async profile(id){
  if(!rbxId(id))throw new UserError('Usa un ID numérico de Roblox.');
  const cached=this.cache.get(id);if(cached)return cached;
  const u=await this.json('https://users.roblox.com/v1/users/'+id);
  if(String(u.id)!==id||typeof u.name!=='string')throw new UserError('Perfil no disponible.');
  const friends=await this.json('https://friends.roblox.com/v1/users/'+id+'/friends/count').catch(()=>null);
  const p={id,name:u.name.slice(0,100),display:String(u.displayName||u.name).slice(0,100),created:typeof u.created==='string'?u.created.slice(0,10):null,friends:Number.isSafeInteger(friends?.count)?friends.count:null,url:'https://www.roblox.com/users/'+id+'/profile'};
  this.cache.set(id,p);return p;
 }
 close(){this.database?.close();this.database=null;}
}
module.exports={Roblox,rbxId};
