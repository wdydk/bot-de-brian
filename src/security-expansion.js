'use strict';
const {randomUUID,randomInt}=require('node:crypto');
const {AuditLogEvent,ChannelType}=require('discord.js');
const {UserError,Serial,ExpiringCache,idOf,integer}=require('./core');
const {P}=require('./permissions');
const {guardSelfAssignable,guardGrantRole,readScopes}=require('./delegation');
const settings=cfg=>({captcha:false,age:7,nuke:false,threshold:3,revision:0,...cfg.securityExpansion});
const serial=new Serial();
function challenge(){const a=randomInt(2,10),b=randomInt(2,10);return {label:'¿Cuánto es '+a+' + '+b+'?',answer:String(a+b)};}
function evidence(g,v){if(!v)return '';if(!new RegExp('^https://(?:discord\\.com|discordapp\\.com)/channels/'+g+'/\\d{17,20}/\\d{17,20}$').test(v))throw new UserError('Usa un enlace de mensaje del mismo servidor.');return v;}
class SecurityExpansion{
 constructor(store,log,clock=Date.now){this.store=store;this.log=log;this.clock=clock;this.seen=new ExpiringCache(120000,10000);this.windows=new ExpiringCache(60000,5000);this.alerts=new ExpiringCache(60000,5000);}
 cases(g){return this.store.guild(g).moderationCases||[];}
 record(g,actor,target,kind,reason,reference=''){
  const entry={id:randomUUID().slice(0,12),actor,target,kind,reason:String(reason).slice(0,500),reference,at:this.clock(),evidence:'',appeal:null};
  this.store.patchGuild(g,{moderationCases:[...this.cases(g),entry].slice(-200)});return entry;
 }
 safeRecord(...args){try{return this.record(...args);}catch(e){console.warn('[CASE STORAGE]',e.code||e.name);return null;}}
 change(g,id,actor,action,value){
  const list=structuredClone(this.cases(g)),c=list.find(x=>x.id===id);if(!c)throw new UserError('Caso no encontrado.');
  if(action==='appeal'){if(c.target!==actor||c.appeal||!value.trim()||value.length>1000)throw new UserError('Solo el afectado puede presentar una apelación de hasta 1000 caracteres, una vez.');c.appeal={text:value,at:this.clock(),status:'pending'};}
  else if(action==='evidence')c.evidence=evidence(g,value);
  else if(action==='accept'||action==='reject'){if(c.appeal?.status!=='pending')throw new UserError('No hay apelación pendiente.');c.appeal.status=action;c.appeal.reviewer=actor;c.appeal.reviewedAt=this.clock();}
  else throw new UserError('Acción inválida.');
  this.store.patchGuild(g,{moderationCases:list});
 }
 async audit(entry,guild,botId){
  const cfg=this.store.guild(guild.id),p=settings(cfg),now=this.clock();
  const kinds=new Map([[AuditLogEvent.ChannelDelete,'eliminación de canal'],[AuditLogEvent.RoleDelete,'eliminación de rol'],[AuditLogEvent.MemberBanAdd,'baneo'],[AuditLogEvent.MemberKick,'expulsión'],[AuditLogEvent.WebhookCreate,'creación de webhook'],[AuditLogEvent.WebhookUpdate,'edición de webhook'],[AuditLogEvent.WebhookDelete,'eliminación de webhook'],[AuditLogEvent.RoleUpdate,'cambio de permisos de rol'],[AuditLogEvent.ChannelOverwriteCreate,'creación de permisos de canal'],[AuditLogEvent.ChannelOverwriteUpdate,'cambio de permisos de canal'],[AuditLogEvent.ChannelOverwriteDelete,'eliminación de permisos de canal']]);
  const kind=kinds.get(entry.action);
  if(!kind||!entry.id||!entry.executorId||!Number.isFinite(entry.createdTimestamp)||Math.abs(now-entry.createdTimestamp)>120000||this.seen.get(guild.id+':'+entry.id))return;
  this.seen.set(guild.id+':'+entry.id,true);
  if(entry.executorId===botId||entry.executorId===guild.ownerId||cfg.staffPolicy?.whitelist?.includes(entry.executorId)||!p.nuke)return;
  if(entry.action===AuditLogEvent.RoleUpdate&&!entry.changes?.some(x=>x.key==='permissions'))return;
  const key=guild.id+':'+entry.executorId,rows=(this.windows.get(key)||[]).filter(x=>now-x.at<60000);rows.push({at:now,kind});this.windows.set(key,rows.slice(-20));
  if(rows.length<p.threshold||this.alerts.get(key))return;
  this.alerts.set(key,true);
  this.safeRecord(guild.id,entry.executorId,entry.targetId||'', 'audit-alert','Umbral de acciones administrativas observado: '+rows.length+' en 60 segundos. Revisión humana requerida.',entry.id);
  await this.log(guild,'Anti-Nuke · revisión necesaria','Actor registrado: '+entry.executorId+' · '+rows.length+' acciones en 60 s. No se aplicó sanción automática.');
 }
 async configure(guild,member,form){
  if(member.id!==guild.ownerId)throw new UserError('Solo el dueño configura seguridad.');
  const old=settings(this.store.guild(guild.id));
  if(String(old.revision)!==form.get('revision'))throw new UserError('Los ajustes cambiaron. Recarga.');
  if(form.has('nuke')){const me=await guild.members.fetchMe({force:true});if(!me.permissions.has(P.ViewAuditLog)||!this.store.guild(guild.id).logChannel)throw new UserError('Configura el canal de logs y Ver registro de auditoría.');}
  if(settings(this.store.guild(guild.id)).revision!==old.revision)throw new UserError('Los ajustes cambiaron.');
  this.store.patchGuild(guild.id,{securityExpansion:{captcha:form.has('captcha'),age:integer(form.get('age'),1,30),nuke:form.has('nuke'),threshold:integer(form.get('threshold'),2,10),revision:old.revision+1}});
 }
 async delegate(guild,member,form){
  if(member.id!==guild.ownerId)throw new UserError('Solo el dueño puede delegar permisos desde la web.');
  const role=await guild.roles.fetch(idOf(form.get('role')));guardGrantRole(role,member);
  const cfg=this.store.guild(guild.id),next={...cfg.delegatedRoles};
  if(form.has('remove'))delete next[role.id];else{guardSelfAssignable(role.id,cfg);next[role.id]=readScopes(String(form.get('scopes')||''));}
  this.store.patchGuild(guild.id,{delegatedRoles:next});
 }
 async bulk(ctx,protection,ids,locked){
  if(ctx.user.id!==ctx.guild.ownerId)throw new UserError('Solo el dueño puede aplicar bloqueo múltiple.');
  return serial.run(ctx.guild.id,async()=>{
   const g=ctx.guild;await g.channels.fetch();
   const channels=ids==='all'?[...g.channels.cache.values()].filter(c=>c.type===ChannelType.GuildText&&c.permissionsFor(ctx.member)?.has(P.ViewChannel)):ids.map(id=>g.channels.cache.get(idOf(id)));
   if(!channels.length||channels.length>30||channels.some(c=>c?.type!==ChannelType.GuildText))throw new UserError('Selecciona hasta 30 canales de texto válidos.');
   const result=[];
   for(const ch of channels){
    const cfg=this.store.guild(g.id),exists=Object.hasOwn(cfg.locks,ch.id);
    if(exists===locked){result.push(ch.name+': omitido');continue;}
    try{await protection.lock(ctx,ch,locked);result.push(ch.name+': OK');}catch{result.push(ch.name+': revisar');}
   }return result;
  });
 }
}
module.exports={SecurityExpansion,settings,challenge,evidence};
