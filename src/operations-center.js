'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {AuditLogEvent,ChannelType}=require('discord.js');
const {UserError,integer,idOf}=require('./core');
const {P}=require('./permissions');
const {isAdmin}=require('./access');
const destructive=new Set([AuditLogEvent.ChannelDelete,AuditLogEvent.RoleDelete,AuditLogEvent.MemberBanAdd]);
const tracked=new Map([[AuditLogEvent.ChannelDelete,'Eliminar canal'],[AuditLogEvent.RoleDelete,'Eliminar rol'],[AuditLogEvent.MemberBanAdd,'Banear'],[AuditLogEvent.MemberBanRemove,'Desbanear'],[AuditLogEvent.MemberKick,'Expulsar'],[AuditLogEvent.MemberRoleUpdate,'Cambiar roles'],[AuditLogEvent.MessageDelete,'Eliminar mensaje'],[AuditLogEvent.MessageBulkDelete,'Eliminar mensajes'],[AuditLogEvent.MemberUpdate,'Actualizar miembro']]);
function settings(cfg){return {enabled:false,channel:null,threshold:3,joinEnabled:false,age:7,revision:0,...cfg.operations};}
async function target(guild,member,id){
 const ch=await guild.channels.fetch(idOf(id)),me=await guild.members.fetchMe({force:true});
 if(ch?.type!==ChannelType.GuildText||!ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages])||!ch.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]))throw new UserError('Revisa permisos del canal de texto.');
 return ch;
}
async function saveSettings(store,guild,member,form){
 if(member.id!==guild.ownerId)throw new UserError('Solo el dueño configura protección y automatizaciones.');
 const old=settings(store.guild(guild.id));
 if(String(old.revision)!==form.get('revision'))throw new UserError('La configuración cambió.');
 const enabled=form.has('enabled'),joinEnabled=form.has('joinEnabled'),channel=form.get('channel')||null;
 if(enabled||joinEnabled){await target(guild,member,channel);const me=await guild.members.fetchMe();if(enabled&&!me.permissions.has(P.ViewAuditLog))throw new UserError('Timmy necesita Ver registro de auditoría.');}
 if(settings(store.guild(guild.id)).revision!==old.revision)throw new UserError('La configuración cambió.');
 store.patchGuild(guild.id,{operations:{enabled,joinEnabled,channel,threshold:integer(form.get('threshold'),2,10),age:integer(form.get('age'),1,30),revision:old.revision+1}});
}
class Operations{
 constructor(client,store,clock=Date.now){this.client=client;this.store=store;this.clock=clock;this.running=false;this.notices=new Map();this.listeners=[];}
 db(){if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'operations-center.sqlite'));this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS audit(g TEXT,id TEXT,actor TEXT,kind TEXT,destructive INTEGER,at INTEGER,PRIMARY KEY(g,id)); CREATE INDEX IF NOT EXISTS audit_window ON audit(g,actor,at); CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,g TEXT,actor TEXT,target TEXT,kind TEXT,text TEXT,at INTEGER); CREATE TABLE IF NOT EXISTS announcements(id TEXT PRIMARY KEY,g TEXT,actor TEXT,channel TEXT,body TEXT,role TEXT,due INTEGER,state TEXT); CREATE INDEX IF NOT EXISTS announce_due ON announcements(state,due);');}return this.database;}
 async alert(guild,p,text){const ch=await guild.channels.fetch(p.channel).catch(()=>null);const me=await guild.members.fetchMe().catch(()=>null);if(ch?.type===ChannelType.GuildText&&me&&ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))await ch.send({content:text,allowedMentions:{parse:[]}}).catch(()=>{});}
 notice(key){const now=this.clock();if((this.notices.get(key)||0)>now)return false;if(this.notices.size>=3000)this.notices.delete(this.notices.keys().next().value);this.notices.set(key,now+60000);return true;}
 async audit(entry,guild){
 const p=settings(this.store.guild(guild.id)),kind=tracked.get(entry.action),now=this.clock();
 if(!p.enabled||!kind||!entry.executorId||!entry.id||!Number.isFinite(entry.createdTimestamp)||Math.abs(now-entry.createdTimestamp)>120000)return;
 if(entry.action===AuditLogEvent.MemberUpdate&&!entry.changes?.some(x=>x.key==='communication_disabled_until'))return;
 const db=this.db(),at=entry.createdTimestamp,del=destructive.has(entry.action)?1:0;
 if(!db.prepare('INSERT OR IGNORE INTO audit VALUES(?,?,?,?,?,?)').run(guild.id,entry.id,entry.executorId,kind,del,at).changes)return;
 db.prepare('DELETE FROM audit WHERE g=? AND id NOT IN (SELECT id FROM audit WHERE g=? ORDER BY at DESC LIMIT 3000)').run(guild.id,guild.id);
 if(!del||entry.executorId===guild.ownerId||entry.executorId===this.client.user?.id||(this.store.guild(guild.id).staffPolicy?.whitelist||[]).includes(entry.executorId))return;
 const count=db.prepare('SELECT count(*) n FROM audit WHERE g=? AND actor=? AND destructive=1 AND at>=?').get(guild.id,entry.executorId,now-60000).n;
 if(count>=p.threshold&&this.notice(guild.id+':'+entry.executorId)){
   const msg='Posible abuso masivo: '+count+' acciones destructivas en 60 s. Responsable registrado: '+entry.executorId+'. Revisa la auditoría. No se aplicó sanción automática.';
   this.report(guild.id,'Timmy',entry.executorId,'alert',msg);
   await this.alert(guild,p,msg);
 }
 }
 async join(member){const p=settings(this.store.guild(member.guild.id));if(!p.joinEnabled||member.user.bot||!Number.isFinite(member.user.createdTimestamp)||this.clock()-member.user.createdTimestamp>=p.age*86400000)return;if(this.notice(member.guild.id+':join'))await this.alert(member.guild,p,'Automatización: cuenta nueva '+member.id+' (menos de '+p.age+' días). Revisa la verificación.');}
 report(g,actor,target,kind,text){
 if(!['alert','warning','promotion','work'].includes(kind)||!text||text.length>1000)throw new UserError('Informe inválido.');
 const db=this.db();db.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?)').run(randomUUID(),g,actor,target,kind,text,this.clock());
 db.prepare('DELETE FROM reports WHERE g=? AND id NOT IN (SELECT id FROM reports WHERE g=? ORDER BY at DESC LIMIT 1000)').run(g,g);
 }
 summary(g){const db=this.db();return {audit:db.prepare('SELECT * FROM audit WHERE g=? ORDER BY at DESC LIMIT 100').all(g),staff:db.prepare('SELECT actor,count(*) n FROM audit WHERE g=? GROUP BY actor ORDER BY n DESC LIMIT 30').all(g),reports:db.prepare('SELECT * FROM reports WHERE g=? ORDER BY at DESC LIMIT 100').all(g),announcements:db.prepare('SELECT id,channel,due,state,body FROM announcements WHERE g=? ORDER BY due DESC LIMIT 50').all(g)};}
 async schedule(guild,member,form){
 if(!isAdmin(member,guild))throw new UserError('Necesitas Administrador.');
 const channel=await target(guild,member,form.get('channel')),body=String(form.get('body')||'').trim(),raw=form.get('due');
 if(!body||body.length>1800||!raw||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))throw new UserError('Escribe anuncio y fecha UTC.');
 const due=Date.parse(raw+'Z'),now=this.clock();
 if(!Number.isFinite(due)||due<now+60000||due>now+30*86400000)throw new UserError('Programa entre 1 minuto y 30 días.');
 const role=form.get('mention')||'';
 if(role){const r=await guild.roles.fetch(idOf(role)),me=await guild.members.fetchMe();if(!r||r.id===guild.id||r.managed||!channel.permissionsFor(member)?.has(P.MentionEveryone)||!channel.permissionsFor(me)?.has(P.MentionEveryone))throw new UserError('Para mencionar un rol necesitas permiso explícito tú y Timmy.');}
 const db=this.db();if(db.prepare("SELECT count(*) n FROM announcements WHERE g=? AND state='pending'").get(guild.id).n>=30)throw new UserError('Máximo 30 anuncios pendientes.');
 db.prepare('INSERT INTO announcements VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),guild.id,member.id,channel.id,body,role,due,'pending');
 }
 cancel(g,id){const result=this.db().prepare("UPDATE announcements SET state='cancelled' WHERE g=? AND id=? AND state='pending'").run(g,id);if(!result.changes)throw new UserError('Anuncio no disponible.');}
 async sweep(){
 if(this.running||!this.client.isReady())return;this.running=true;
 try{
 const db=this.db(),now=this.clock();
 for(const row of db.prepare("SELECT * FROM announcements WHERE state='pending' AND due<=? ORDER BY due LIMIT 10").all(now)){
   if(!db.prepare("UPDATE announcements SET state='sending' WHERE id=? AND state='pending'").run(row.id).changes)continue;
   let state='failed';
   try{
     if(now-row.due>3600000)throw Error('expired');
     const guild=this.client.guilds.cache.get(row.g),member=await guild?.members.fetch({user:row.actor,force:true});
     if(!guild||!isAdmin(member,guild))throw Error('access');
     const ch=await target(guild,member,row.channel),me=await guild.members.fetchMe();
     if(row.role){const role=await guild.roles.fetch(row.role);if(!role||role.id===guild.id||role.managed||!ch.permissionsFor(member)?.has(P.MentionEveryone)||!ch.permissionsFor(me)?.has(P.MentionEveryone))throw Error('role');}
     await ch.send({content:(row.role?'<@&'+row.role+'> ':'')+row.body,allowedMentions:{parse:[],roles:row.role?[row.role]:[]}});
     state='sent';
   }catch{}
   db.prepare('UPDATE announcements SET state=? WHERE id=?').run(state,row.id);
 }
 }finally{this.running=false;}
 }
 start(){if(this.timer)return;const bind=(name,fn)=>{const cb=(...args)=>fn(...args).catch(e=>console.warn('[OPERATIONS]',e.code||e.name));this.client.on(name,cb);this.listeners.push([name,cb]);};bind('guildAuditLogEntryCreate',(e,g)=>this.audit(e,g));bind('guildMemberAdd',m=>this.join(m));this.timer=setInterval(()=>this.sweep().catch(e=>console.warn('[OPERATIONS]',e.code||e.name)),15000);this.timer.unref();}
 async close(){if(this.timer)clearInterval(this.timer);for(const [name,cb] of this.listeners)this.client.off(name,cb);while(this.running)await new Promise(r=>setTimeout(r,25));this.database?.close();}
}
module.exports={Operations,settings,saveSettings};
