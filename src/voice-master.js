'use strict';
const {ChannelType}=require('discord.js');
const {UserError,Serial,integer,idOf}=require('./core');
const {P}=require('./permissions');
const config=cfg=>({enabled:false,lobby:null,category:null,revision:0,...cfg.voiceMaster});
class VoiceMaster{
 constructor(store){this.store=store;this.serial=new Serial();}
 rooms(g){return this.store.guild(g).temporaryVoice||{};}
 setRoom(g,id,record){const rooms={...this.rooms(g)};if(record)rooms[id]=record;else delete rooms[id];this.store.patchGuild(g,{temporaryVoice:rooms});}
 async configure(g,member,form){
  if(member.id!==g.ownerId)throw new UserError('Solo el dueño configura VoiceMaster.');
  const old=config(this.store.guild(g.id));if(String(old.revision)!==form.get('revision'))throw new UserError('Ajustes cambiaron.');
  let lobby=null,category=null;const enabled=form.has('enabled');
  if(enabled){
   lobby=await g.channels.fetch(idOf(form.get('lobby')));category=await g.channels.fetch(idOf(form.get('category')));
   const me=await g.members.fetchMe({force:true});
   if(lobby?.type!==ChannelType.GuildVoice||category?.type!==ChannelType.GuildCategory||lobby.parentId!==category.id||this.rooms(g.id)[lobby.id]||this.store.guild(g.id).officialRuntime?.voice?.channel===lobby.id||!category.permissionsFor(me)?.has([P.ManageChannels,P.ManageRoles,P.ViewChannel,P.Connect,P.MoveMembers])||!lobby.permissionsFor(me)?.has([P.ViewChannel,P.Connect,P.MoveMembers])||!category.permissionsFor(g.roles.everyone)?.has([P.ViewChannel,P.Connect]))throw new UserError('Elige una categoría pública y un canal de entrada dentro de ella; verifica permisos del bot. No uses la radio oficial.');
  }
  if(config(this.store.guild(g.id)).revision!==old.revision)throw new UserError('Ajustes cambiaron.');
  this.store.patchGuild(g.id,{voiceMaster:{enabled,lobby:lobby?.id||null,category:category?.id||null,revision:old.revision+1}});
 }
 async clean(g,id){
  const record=this.rooms(g.id)[id];if(!record)return;
  const c=await g.channels.fetch(id).catch(e=>{if(e.code===10003)return null;throw e;});
  if(!c){this.setRoom(g.id,id,null);return;}
  if(c.type!==ChannelType.GuildVoice||c.parentId!==record.category||c.members.size||id===this.store.guild(g.id).officialRuntime?.voice?.channel)return;
  await c.delete('VoiceMaster: canal temporal vacío');this.setRoom(g.id,id,null);
 }
 async update(old,next){
  const g=next.guild;if(old.channelId===next.channelId)return;
  return this.serial.run(g.id,async()=>{
   if(old.channelId&&this.rooms(g.id)[old.channelId])await this.clean(g,old.channelId).catch(()=>{});
   const p=config(this.store.guild(g.id));if(!p.enabled||next.channelId!==p.lobby||next.member?.user?.bot||!next.member)return;
   if(next.member.voice.channelId!==p.lobby)return;
   const rooms=this.rooms(g.id);if(Object.keys(rooms).length>=20)return;
   const existing=Object.entries(rooms).find(([,r])=>r.owner===next.id);
   if(existing){const c=await g.channels.fetch(existing[0]).catch(()=>null);if(c?.type===ChannelType.GuildVoice&&c.parentId===existing[1].category&&c.permissionsFor(next.member)?.has([P.ViewChannel,P.Connect])){await next.member.voice.setChannel(c).catch(()=>{});return;}}
   const parent=await g.channels.fetch(p.category),me=await g.members.fetchMe();
   if(parent?.type!==ChannelType.GuildCategory||!parent.permissionsFor(g.roles.everyone)?.has([P.ViewChannel,P.Connect])||!parent.permissionsFor(me)?.has([P.ManageChannels,P.ManageRoles,P.MoveMembers]))return;
   const name=('Sala de '+next.member.user.username).slice(0,90);
   const ch=await g.channels.create({name,type:ChannelType.GuildVoice,parent:parent.id,reason:'VoiceMaster: canal temporal'});
   try{this.setRoom(g.id,ch.id,{owner:next.id,category:parent.id,locked:null,hidden:null});}catch(e){await ch.delete('VoiceMaster: registro fallido').catch(()=>{});throw e;}
   if(next.member.voice.channelId!==p.lobby){await this.clean(g,ch.id);return;}
   try{await next.member.voice.setChannel(ch);}catch{await this.clean(g,ch.id).catch(()=>{});}
  });
 }
 async command(ctx,args){
  const g=ctx.guild;
  return this.serial.run(g.id,async()=>{
   const member=await g.members.fetch({user:ctx.user.id,force:true}),id=member.voice.channelId,record=this.rooms(g.id)[id];
   if(!record||record.owner!==member.id)throw new UserError('Entra a tu propia sala temporal.');
   const ch=await g.channels.fetch(id),me=await g.members.fetchMe({force:true}),[action,...rest]=args;
   if(ch?.type!==ChannelType.GuildVoice||ch.parentId!==record.category||!ch.permissionsFor(me)?.has([P.ManageChannels,P.ManageRoles])||id===this.store.guild(g.id).officialRuntime?.voice?.channel)throw new UserError('Sala no disponible.');
   if(action==='name'){const name=rest.join(' ').trim();if(!name||name.length>80)throw new UserError('Nombre de 1–80 caracteres.');await ch.setName(name);}
   else if(action==='limit')await ch.setUserLimit(integer(rest[0],0,99));
   else if(action==='transfer'){
     const target=await g.members.fetch({user:idOf(rest[0]),force:true});if(target.user.bot||target.voice.channelId!==id||target.id===member.id)throw new UserError('Elige otro miembro de esta sala.');
     if(Object.values(this.rooms(g.id)).some(r=>r.owner===target.id))throw new UserError('Ya tiene sala propia.');
     if(record.locked||record.hidden)throw new UserError('Desbloquea y muestra la sala antes de transferir.');
     this.setRoom(g.id,id,{...record,owner:target.id});
   }else if(['lock','unlock','hide','show'].includes(action)){
     const field=['lock','unlock'].includes(action)?'locked':'hidden',perm=field==='locked'?'Connect':'ViewChannel',flag=P[perm],enable=['lock','hide'].includes(action),ow=ch.permissionOverwrites.cache.get(g.id);
     if(enable){
       if(record[field])throw new UserError('Ya está restringida.');
       const previous=ow?.allow.has(flag)?true:ow?.deny.has(flag)?false:null;
       const own=ch.permissionOverwrites.cache.get(member.id),ownerPrevious=own?.allow.has(flag)?true:own?.deny.has(flag)?false:null;
       this.setRoom(g.id,id,{...record,[field]:{previous,ownerPrevious}});
       await ch.permissionOverwrites.edit(member.id,{[perm]:true});await ch.permissionOverwrites.edit(g.id,{[perm]:false});
     }else{
       if(!record[field])throw new UserError('No hay restricción registrada.');
       if(!ow?.deny.has(flag)||!ch.permissionOverwrites.cache.get(member.id)?.allow.has(flag))throw new UserError('Los permisos cambiaron; pide revisión al administrador.');
       await ch.permissionOverwrites.edit(g.id,{[perm]:record[field].previous});await ch.permissionOverwrites.edit(member.id,{[perm]:record[field].ownerPrevious??null});this.setRoom(g.id,id,{...record,[field]:null});
     }
   }else throw new UserError('Usa name, limit, lock, unlock, hide, show o transfer.');
   return 'Sala actualizada. Los permisos explícitos de otros roles pueden prevalecer.';
  });
 }
 async reconcile(g){return this.serial.run(g.id,async()=>{for(const id of Object.keys(this.rooms(g.id)))await this.clean(g,id).catch(()=>{});});}
}
module.exports={VoiceMaster,config};
