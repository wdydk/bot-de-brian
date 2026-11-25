'use strict';
const {ChannelType,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {UserError,Serial}=require('./core');
const {P}=require('./permissions');
const {isBotOwner}=require('./music-library');
const INVITE='https://discord.gg/qaXbDZyK3z';
const structure=[
 ['INFORMATION',[['info','read'],['rules','read'],['updates','read'],['status','read']]],
 ['COMMUNITY',[['general','text'],['commands','text'],['suggestions','text'],['supporters','text']]],
 ['TIMMY MAX',[['server-setup','read'],['command-directory','read'],['support','text'],['bug-reports','text']]],
 ['CREATIONS',[['embeds','text'],['showcases','text'],['templates','text']]],
 ['VOICE CHANNELS',[['General','voice'],['Music 24/7','voice']]],
 ['DEVELOPMENT',[['development','private'],['error-logs','private'],['security-logs','private'],['staff-chat','private']]]
];
const publicDefinitions=defs=>defs.filter(d=>!d.adminOnly&&!d.permission&&!d.private&&!['close','transcript','official'].includes(d.name));
const categories=defs=>[...new Set(publicDefinitions(defs).map(d=>d.category))].sort();
const serial=new Serial();
async function authorize(client,ctx){
 if(!ctx.guild||!await isBotOwner(client,ctx.user.id))throw new UserError('Solo el propietario de la aplicación Timmy puede usar este comando.');
 const guild=await ctx.guild.fetch();
 if(guild.ownerId!==ctx.user.id)throw new UserError('También debes ser el dueño de este servidor.');
 let invite;try{invite=await client.fetchInvite('qaXbDZyK3z',{force:true});}catch{throw new UserError('No pude verificar la invitación oficial. Revisa que siga activa.');}
 if(invite.guild?.id!==guild.id)throw new UserError('Este comando solo funciona en el servidor oficial vinculado.');
 return guild;
}
function plan(){return structure.map(([category,channels])=>category+'\n'+channels.map(([name,type])=>'  '+(type==='voice'?'🔊 ':type==='private'?'🔒 ':type==='read'?'📖 ':'# ')+name).join('\n')).join('\n\n');}
async function createStructure(guild){
 const me=await guild.members.fetchMe({force:true});
 if(!me.permissions.has(P.ManageChannels))throw new UserError('Timmy necesita Gestionar canales.');
 await guild.channels.fetch();
 const all=()=>[...guild.channels.cache.values()];
 for(const [name] of structure)if(all().filter(c=>c.type===ChannelType.GuildCategory&&c.name===name).length>1)throw new UserError('Hay categorías duplicadas: '+name);
 const made=[],skipped=[];
 const botAllow={id:me.id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.EmbedLinks]};
 const privateOverwrites=[{id:guild.id,deny:[P.ViewChannel]},botAllow];
 try{
  for(const [name,children] of structure){
    let parent=all().find(c=>c.type===ChannelType.GuildCategory&&c.name===name);
    if(!parent){parent=await guild.channels.create({name,type:ChannelType.GuildCategory,...(name==='DEVELOPMENT'?{permissionOverwrites:privateOverwrites}:{}),reason:'Timmy Official: estructura confirmada por propietario'});made.push(name);}
    else skipped.push(name);
    for(const [child,kind] of children){
      const type=kind==='voice'?ChannelType.GuildVoice:ChannelType.GuildText;
      if(all().some(c=>c.parentId===parent.id&&c.name===child&&c.type===type)){skipped.push(child);continue;}
      let overwrites;
      if(kind==='private')overwrites=privateOverwrites;
      if(kind==='read'){
        overwrites=[...(parent.permissionOverwrites?.cache?.values()||[])].filter(o=>o.id!==guild.id&&o.id!==me.id).map(o=>({id:o.id,type:o.type,allow:o.allow.bitfield,deny:o.deny.bitfield}));
        const everyone=parent.permissionOverwrites?.cache?.get(guild.id);
        const deny=[P.SendMessages,P.CreatePublicThreads,P.CreatePrivateThreads,P.SendMessagesInThreads].reduce((bits,p)=>bits|p,everyone?.deny?.bitfield||0n);
        overwrites.push({id:guild.id,allow:(everyone?.allow?.bitfield||0n)&~deny,deny},botAllow);
      }
      await guild.channels.create({name:child,type,parent:parent.id,...(overwrites?{permissionOverwrites:overwrites}:{}),reason:'Timmy Official: estructura confirmada por propietario'});
      made.push(child);
    }
  }
 }catch{return {made,skipped,partial:true};}
 return {made,skipped,partial:false};
}
function panel(kind,defs,origin,client){
 const titles={directory:'Command Directory',status:'Estado',setup:'Server Setup Directory',info:'Official Community'};
 const embed=new EmbedBuilder().setColor(0xb8a5ff).setTitle('Timmy Max · '+titles[kind]);
 if(kind==='directory'){
   embed.setDescription('Comandos generales del código instalado. Usa >help para consultar los disponibles según tus permisos. Los ajustes administrativos se consultan en el panel privado.');
   const fields=[];let size=0;
   for(const name of categories(defs).slice(0,20)){
      const value=publicDefinitions(defs).filter(d=>d.category===name).map(d=>'• '+String(d.usage).replace(/[\r\n]/g,' ')).join('\n').slice(0,900)||'—';
      if(size+name.length+value.length>4400)break;fields.push({name:name.slice(0,100),value});size+=name.length+value.length;
   }
   if(fields.length)embed.addFields(fields);
 }else if(kind==='status')embed.setDescription('Estado consultado: '+(client.isReady()?'Conectado':'No disponible')+'\nConsulta el estado actual desde la web.').setTimestamp();
 else if(kind==='setup'){
    const groups=[
      ['Important Information',[['Initial Setup (First Time Use)','/guia#inicio'],['Common Errors & Questions','/guia#errores'],['Official Support','/support'],['Command Directory','/commands']]],
      ['Security Setup',[['Moderation & Anti-Raid','/guia#proteccion'],['Staff Hierarchy & Whitelist','/guia#staff'],['Snipe & Lockdown','/guia#proteccion'],['Verification','/guia#verificacion'],['Cases, Anti-Nuke & Delegation','/guia#securityplus']]],
      ['Server Setup',[['Welcome & Goodbye Messages','/guia#bienvenidas'],['Tickets','/guia#bienvenidas'],['Booster Roles & Messages','/guia#boosts'],['Levels & XP','/guia#niveles'],['Birthdays','/guia#cumpleanos'],['Embed Creation','/guia#embeds'],['Custom Commands','/guia#custom'],['Autoresponders, Roles & Starboard','/guia#communityplus']]],
      ['Music & Entertainment',[['Music Center','/guia#musica'],['Authorized Audio Library','/guia#biblioteca'],['Spotify','/guia#musica'],['Giveaways','/guia#sorteos']]],
      ['Artificial Intelligence',[['Ask Timmy','/guia#ask'],['Server Knowledge','/guia#ask'],['AI Custom Commands','/guia#custom']]]
    ];
    embed.setDescription('Choose a topic to learn how to configure Timmy Max.\n\n'+groups.map(([title,links])=>'**'+title+'**\n'+links.map(([label,url])=>'> ['+label+']('+origin+url+')').join('\n')).join('\n\n')).setFooter({text:'Timmy Max · Official Documentation'});
 }
 else embed.setDescription('Servidor oficial de soporte, actualizaciones y comunidad de Timmy Max.\nUsa el directorio para aprender comandos, #support para pedir ayuda y #bug-reports para informar problemas.');
 return {embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Sitio web').setURL(origin),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(kind==='directory'?'Comandos públicos':kind==='status'?'Estado actual':'Guía rápida').setURL(origin+(kind==='directory'?'/commands':kind==='status'?'/status':'/guia')),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Comunidad oficial').setURL(INVITE))],allowedMentions:{parse:[]}};
}
async function publish({client,store,guild,ctx,kind,defs,origin}){
 const channel=await guild.channels.fetch(ctx.channel.id),me=await guild.members.fetchMe({force:true});
 if(![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(channel?.type)||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory]))throw new UserError('Revisa permisos de Timmy en el canal.');
 const panels=store.guild(guild.id).officialPanels||{},old=panels[kind],payload=panel(kind,defs,origin,client);
 if(old){
   if(old.channel!==channel.id)throw new UserError('El panel ya está registrado en otro canal. Ejecútalo allí.');
   const message=await channel.messages.fetch(old.message).catch(()=>null);
   if(!message||message.author.id!==client.user.id)throw new UserError('El panel anterior no está disponible; no se publicará un duplicado automáticamente.');
   await message.edit(payload);return 'Panel actualizado.';
 }
 const message=await channel.send(payload);
 store.patchGuild(guild.id,{officialPanels:{...panels,[kind]:{channel:channel.id,message:message.id}}});
 return 'Panel publicado.';
}
async function run({client,store,ctx,defs,origin,args,runtime}){
 return serial.run('official:'+ctx.guild?.id,async()=>{
  const guild=await authorize(client,ctx),[action='plan',kind,...rest]=args;
  if(['auto','voice'].includes(action)){if(!runtime)throw new UserError('Módulo no disponible.');return runtime.command(guild,ctx,args);}
  if(action==='plan')return 'Estructura propuesta (sin cambios):\n'+plan()+'\n\nUsa >official create CONFIRMAR. Revisa los permisos de los canales nuevos.';
  if(action==='create'){
   if(kind!=='CONFIRMAR'||rest.length)throw new UserError('Escribe >official create CONFIRMAR para crear la estructura.');
   const r=await createStructure(guild);
   return (r.partial?'Creación parcial; revisa antes de repetir.':'Estructura preparada.')+'\nCreados: '+(r.made.join(', ')||'ninguno')+'\nOmitidos: '+(r.skipped.join(', ')||'ninguno');
  }
  if(!origin)throw new UserError('Configura WEB_BASE_URL antes de publicar paneles.');
  if(action==='publish'&&['info','setup','directory','status'].includes(kind)&&!rest.length)return publish({client,store,guild,ctx,kind,defs,origin});
  if(action==='update'){
    const text=[kind,...rest].filter(Boolean).join(' ').trim();
    if(!text||text.length>1800)throw new UserError('Escribe una actualización confirmada de hasta 1800 caracteres.');
    const ch=await guild.channels.fetch(ctx.channel.id),me=await guild.members.fetchMe();
    if(![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(ch?.type)||!ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new UserError('Revisa el canal de anuncios.');
    await ch.send({embeds:[new EmbedBuilder().setColor(0xb8a5ff).setTitle('Timmy Max · Actualización').setDescription(text).setTimestamp()],allowedMentions:{parse:[]}});
    return 'Actualización publicada.';
  }
  throw new UserError('Usa plan, create CONFIRMAR, publish info|setup|directory|status o update texto.');
 });
}
module.exports={INVITE,structure,publicDefinitions,categories,authorize,createStructure,plan,panel,publish,run};
