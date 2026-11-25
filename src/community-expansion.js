'use strict';
const {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ChannelType,MessageFlags}=require('discord.js');
const {UserError,Serial,idOf,integer,ExpiringCache}=require('./core');
const {P,safeRole}=require('./permissions');
const {guardCommunityRole,guardEarnedRole}=require('./delegation');
const {saveRequest,removeMemory}=require('./memory');
const serial=new Serial();
const starConfig=cfg=>({enabled:false,source:null,destination:null,threshold:3,revision:0,...cfg.starboard});
async function channel(g,actor,id){const c=await g.channels.fetch(idOf(id)),me=await g.members.fetchMe({force:true});if(c?.type!==ChannelType.GuildText||!c.permissionsFor(actor)?.has([P.ViewChannel,P.SendMessages])||!c.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.ReadMessageHistory]))throw new UserError('Elige un canal de texto accesible.');return c;}
async function volunteer(g,cfg,id,actor=null){const role=await g.roles.fetch(id,{force:true}),me=await g.members.fetchMe({force:true});if(!me.permissions.has(P.ManageRoles))throw new UserError('Timmy necesita Gestionar roles.');safeRole(role,me,actor);guardCommunityRole(role,cfg);guardEarnedRole(role,cfg);if(role.permissions.any([P.ViewAuditLog,P.MuteMembers,P.DeafenMembers,P.MoveMembers,P.ManageGuildExpressions,P.PinMessages]))throw new UserError('Elige un rol sin privilegios.');return role;}
class CommunityExpansion{
 constructor(store){this.store=store;this.rate=new ExpiringCache(10000,5000);}
 async save(g,member,form){
  if(member.id!==g.ownerId)throw new UserError('Solo el dueño puede editar estos módulos.');
  const section=form.get('section'),action=form.get('action'),cfg=this.store.guild(g.id);
  if(section==='responders'){
   if(action==='remove')return removeMemory(this.store,g.id,form.get('trigger'));
   if(action!=='save')throw new UserError('Acción inválida.');
   return saveRequest(this.store,g.id,{kind:'response',trigger:String(form.get('trigger')||''),value:String(form.get('response')||'')});
  }
  if(section==='volunteer'){
   if(action==='retire'){
    const id=idOf(form.get('id')),panels={...cfg.voluntaryPanels};if(!panels[id])throw new UserError('Panel no encontrado.');
    delete panels[id];const roleButtons={...cfg.roleButtons};delete roleButtons[id];this.store.patchGuild(g.id,{voluntaryPanels:panels,roleButtons});return;
   }
   if(action!=='publish'||form.get('confirm')!=='yes')throw new UserError('Confirma la publicación.');
   if(Object.keys(cfg.voluntaryPanels||{}).length>=30)throw new UserError('Máximo 30 paneles nuevos.');
   const ch=await channel(g,member,form.get('channel')),role=await volunteer(g,cfg,idOf(form.get('role')),member),kind=form.get('kind');
   if(!['button','menu','reaction'].includes(kind))throw new UserError('Tipo inválido.');
   const payload={content:'Rol voluntario: '+role.name+'\n'+(kind==='reaction'?'Reacciona con ✅ para obtenerlo o ❌ para quitarlo.':'Elige obtener o retirar el rol.'),allowedMentions:{parse:[]},components:[]};
   if(kind==='button')payload.components=[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tm:vol:add').setLabel('Obtener').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('tm:vol:remove').setLabel('Quitar').setStyle(ButtonStyle.Secondary))];
   if(kind==='menu')payload.components=[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('tm:vol:menu').setPlaceholder('Elige una acción').addOptions({label:'Obtener '+role.name.slice(0,70),value:'add'},{label:'Quitar '+role.name.slice(0,70),value:'remove'}))];
   return serial.run(g.id,async()=>{
     const live=this.store.guild(g.id);if(Object.keys(live.voluntaryPanels||{}).length>=30)throw new UserError('Límite alcanzado.');
     await volunteer(g,live,role.id,member);
     const msg=await ch.send(payload);
     this.store.patchGuild(g.id,{voluntaryPanels:{...live.voluntaryPanels,[msg.id]:{channel:ch.id,role:role.id,kind}},roleButtons:{...live.roleButtons,[msg.id]:role.id}});
     if(kind==='reaction'){await msg.react('✅');await msg.react('❌');}
   });
  }
  if(section==='starboard'){
   const old=starConfig(cfg);if(String(old.revision)!==form.get('revision'))throw new UserError('Configuración cambió.');
   const enabled=form.has('enabled'),threshold=integer(form.get('threshold'),3,20);
   let source=null,destination=null;
   if(enabled){source=await channel(g,member,form.get('source'));destination=await channel(g,member,form.get('destination'));if(source.id===destination.id||!source.permissionsFor(g.roles.everyone)?.has([P.ViewChannel,P.ReadMessageHistory])||!destination.permissionsFor(g.roles.everyone)?.has(P.ViewChannel))throw new UserError('Elige dos canales públicos distintos.');}
   if(starConfig(this.store.guild(g.id)).revision!==old.revision)throw new UserError('Configuración cambió.');
   this.store.patchGuild(g.id,{starboard:{enabled,source:source?.id||null,destination:destination?.id||null,threshold,revision:old.revision+1}});return;
  }
  throw new UserError('Módulo inválido.');
 }
 async grant(g,user,msg,action,kind){
  return serial.run(g.id+':'+user,async()=>{
   const cfg=this.store.guild(g.id),p=cfg.voluntaryPanels?.[msg.id];if(!p||p.channel!==msg.channelId||p.kind!==kind||!['add','remove'].includes(action))throw new UserError('Panel no activo.');
   const m=await g.members.fetch({user,force:true}),role=await volunteer(g,cfg,p.role);
   if(m.user.bot||!msg.channel.permissionsFor(m)?.has(P.ViewChannel))throw new UserError('No tienes acceso.');
   if(action==='add')await m.roles.add(role,'Rol voluntario');else await m.roles.remove(role,'Rol voluntario');
  });
 }
 async interaction(i){
  if(!i.customId?.startsWith('tm:vol:'))return false;
  if(!i.guild||(!i.isButton()&&!i.isStringSelectMenu()))throw new UserError('Panel inválido.');
  await i.deferReply({flags:MessageFlags.Ephemeral});
  await this.grant(i.guild,i.user.id,i.message,i.isButton()?i.customId.split(':')[2]:i.values[0],i.isButton()?'button':'menu');
  await i.editReply('Rol actualizado.');return true;
 }
 async reaction(r,user){
  if(user.bot)return;if(r.partial)await r.fetch();let m=r.message;if(m.partial)m=await m.fetch();if(!m.guild)return;
  const cfg=this.store.guild(m.guild.id),p=cfg.voluntaryPanels?.[m.id],emoji=r.emoji.name;
  if(p?.kind==='reaction'&&['✅','❌'].includes(emoji)){
    await this.grant(m.guild,user.id,m,emoji==='✅'?'add':'remove','reaction');
    await r.users.remove(user.id).catch(()=>{});return;
  }
  const s=starConfig(cfg);if(!s.enabled||m.channelId!==s.source||emoji!=='⭐'||m.author?.bot||m.author?.id===user.id||r.count<s.threshold)return;
  await serial.run(m.guild.id+':star',async()=>{
   const live=this.store.guild(m.guild.id),now=starConfig(live);
   if(!now.enabled||now.revision!==s.revision||(live.starPosts||[]).includes(m.id))return;
   if(!m.channel.permissionsFor(m.guild.roles.everyone)?.has([P.ViewChannel,P.ReadMessageHistory]))return;
   const users=await r.users.fetch({limit:100}),votes=users.filter(u=>!u.bot&&u.id!==m.author?.id).size;if(votes<now.threshold)return;
   const dest=await m.guild.channels.fetch(now.destination),me=await m.guild.members.fetchMe();
   if(dest?.type!==ChannelType.GuildText||!dest.permissionsFor(m.guild.roles.everyone)?.has(P.ViewChannel)||!dest.permissionsFor(me)?.has(P.SendMessages))return;
   // Claim before sending: no duplicate on an uncertain Discord response. No message text or attachments copied.
   this.store.patchGuild(m.guild.id,{starPosts:[...(live.starPosts||[]),m.id].slice(-500)});
   await dest.send({content:'⭐ Mensaje destacado por '+votes+' miembros: https://discord.com/channels/'+m.guild.id+'/'+m.channelId+'/'+m.id,allowedMentions:{parse:[]}});
  });
 }
}
module.exports={CommunityExpansion,starConfig,volunteer};
