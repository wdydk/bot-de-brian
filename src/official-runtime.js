'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {ChannelType,EmbedBuilder}=require('discord.js');
const {UserError,idOf}=require('./core');
const {P}=require('./permissions');
const release=require('./official-release.json');
const {authorize,publish,publicDefinitions}=require('./official-community');
const SHA=/^[a-f0-9]{40}$/i;
function deployment(env=process.env){const s=env.RAILWAY_GIT_COMMIT_SHA;return typeof s==='string'&&SHA.test(s)?s.toLowerCase():null;}
function catalogue(defs){
 return Object.fromEntries(defs.map(d=>[d.name,createHash('sha256').update(JSON.stringify([d.description,d.usage,d.category,Boolean(d.adminOnly),String(d.permission||''),Boolean(d.private),d.aliases,d.params])).digest('hex')]).sort(([a],[b])=>a.localeCompare(b)));
}
function difference(before={},after={}){
 return {added:Object.keys(after).filter(k=>!Object.hasOwn(before,k)),removed:Object.keys(before).filter(k=>!Object.hasOwn(after,k)),changed:Object.keys(after).filter(k=>Object.hasOwn(before,k)&&before[k]!==after[k])};
}
function facts(previous,next){
 const d=difference(previous?.catalogue||next.catalogue,next.catalogue),notes=previous?.release===next.release?[]:[...release.features,...release.fixes];
 const lines=[...notes];
 for(const [label,keys] of [['Nuevos comandos',d.added],['Comandos modificados',d.changed],['Comandos retirados',d.removed]])if(keys.length)lines.push(label+': '+keys.map(x=>'/'+x).join(', '));
 return lines.length?lines:['Nueva revisión del código conectada a Discord. No hay cambios de comandos ni notas nuevas registradas.'];
}
async function intro(ai){
 // AI chooses one of three factual, pre-approved first-person introductions.
 // It cannot add claims, mentions, URLs or instructions to the release.
 const choices=['¡Hola! Mi creador instaló una nueva revisión de mi código. Estas son las novedades registradas.','¡Timmy al habla! Ya estoy conectado con una nueva revisión. Aquí tienen los cambios documentados.','¡Nueva actualización! Les comparto lo que cambió en mi versión instalada.'];
 if(!ai?.available||typeof ai.generate!=='function')return choices[0];
 try{
    const result=await ai.generate({model:ai.model,contents:'Elige un saludo de Timmy para anunciar una actualización. Devuelve exclusivamente 0, 1 o 2. Opciones: '+JSON.stringify(choices),config:{maxOutputTokens:32,httpOptions:{timeout:10000}}});
    const n=String(result.text||'').trim();return /^[012]$/.test(n)?choices[Number(n)]:choices[0];
 }catch{return choices[0];}
}
async function textChannel(guild,id){
 const ch=await guild.channels.fetch(id),me=await guild.members.fetchMe({force:true});
 if(![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(ch?.type)||!ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new UserError('Timmy necesita ver el canal, enviar mensajes e insertar enlaces.');
 return ch;
}
class OfficialRuntime{
 constructor({client,store,music,ai,defs,origin,env=process.env,clock=Date.now}){Object.assign(this,{client,store,music,ai,defs,origin,env,clock});this.running=false;this.closed=false;}
 config(g){return this.store.guild(g).officialRuntime||{};}
 patch(g,part){this.store.patchGuild(g,{officialRuntime:{...this.config(g),...part}});}
 async command(guild,ctx,args){
    const [action,mode,id,playlist,...extra]=args;
    if(mode==='status') {const c=this.config(guild.id);return 'Auto updates: '+(c.updates?'activado':'desactivado')+' · Último anuncio: '+(c.announcement?.state||'ninguno')+'\nVoz 24/7: '+(c.voice?'activada':'desactivada')+' · Playlist: '+(c.voice?.playlist||'ninguna');}
    if(action==='auto'){
       if(mode==='off'&&!id){this.patch(guild.id,{updates:null});return 'Anuncios automáticos desactivados.';}
       if(mode!=='on'||!id||playlist||extra.length)throw new UserError('Usa >official auto on #updates, off o status.');
       if(!deployment(this.env))throw new UserError('Railway no proporcionó RAILWAY_GIT_COMMIT_SHA. Activa un despliegue desde GitHub.');
       const ch=await textChannel(guild,idOf(id));
       this.patch(guild.id,{updates:{channel:ch.id,owner:ctx.user.id}});
       return 'Anuncios automáticos activados. Se comprobará esta revisión y las siguientes sin repetir revisiones ya registradas.';
    }
    if(action==='voice'){
       if(mode==='off'&&!id){this.patch(guild.id,{voice:null});await this.music.serial.run(guild.id,()=>{const s=this.music.sessions.get(guild.id);if(s?.officialPinned)this.music._destroy(s);});return 'Voz 24/7 desactivada.';}
       if(mode!=='on'||!id||extra.length)throw new UserError('Usa >official voice on ID_CANAL_VOZ [ID_PLAYLIST_LOCAL], off o status.');
       const ch=await guild.channels.fetch(idOf(id)),me=await guild.members.fetchMe({force:true});
       if(ch?.type!==ChannelType.GuildVoice||!ch.permissionsFor(me)?.has([P.ViewChannel,P.Connect,P.Speak]))throw new UserError('Elige un canal de voz donde Timmy pueda ver, conectar y hablar.');
       const oldVoice=this.config(guild.id).voice,active=this.music.sessions.get(guild.id);
       if(active&&active.voiceId!==ch.id)throw new UserError('Primero detén la sesión en el otro canal.');
       if(playlist&&!this.music.library.managed.info().playlists.some(p=>p.id===playlist&&p.tracks.length))throw new UserError('Playlist local inexistente o vacía.');
       const text=await textChannel(guild,ctx.channel.id);
       this.patch(guild.id,{voice:{channel:ch.id,text:text.id,owner:ctx.user.id,playlist:playlist||null}});
       await this.music.serial.run(guild.id,()=>{
          const s=this.music.sessions.get(guild.id);if(!s)return;
          s.autoPaused=false;s.autoRetryAt=0;
          if(oldVoice?.playlist!==(playlist||null)){
             s.queue=s.queue.filter(t=>!t.officialAuto);
             if(s.current?.track.officialAuto){this.music._cleanup(s.current);s.current=null;s.player.stop(true);}
          }
       });
       return 'Voz 24/7 activada. Timmy intentará conectar en el próximo ciclo. Usa >official voice off para desactivarla.';
    }
    throw new UserError('Acción desconocida.');
 }
 async announce(guild,c){
    const sha=deployment(this.env),previous=c.announcement;
    if(!sha||previous?.sha===sha||(c.announcedRevisions||[]).includes(sha))return;
    const next={sha,release:release.id,catalogue:catalogue(publicDefinitions(this.defs)),state:'sending',at:this.clock()};
    const channel=await textChannel(guild,c.updates.channel);
    const lines=facts(previous,next),greeting=await intro(this.ai);
    // Recheck the configured destination and ownership after any asynchronous work.
    const live=this.config(guild.id);
    if(this.closed||!live.updates||live.updates.channel!==c.updates.channel||live.updates.owner!==c.updates.owner||live.announcement?.sha===sha||(live.announcedRevisions||[]).includes(sha))return;
    await authorize(this.client,{guild,user:{id:c.updates.owner}});
    if(this.closed||this.config(guild.id).updates?.channel!==c.updates.channel||this.config(guild.id).announcement?.sha===sha||(this.config(guild.id).announcedRevisions||[]).includes(sha))return;
    // Durable claim before sending: a crash after a successful send never reposts.
    // An uncertain send stays visible in status for manual review; no blind retry.
    this.patch(guild.id,{announcement:next,announcedRevisions:[...new Set([...(this.config(guild.id).announcedRevisions||[]),previous?.sha,sha].filter(Boolean))].slice(-200)});
    let state='uncertain';
    try{
       const body=lines.map(x=>'• '+x).join('\n').slice(0,3500);
       const embed=new EmbedBuilder().setColor(0xb8a5ff).setTitle('✦ Timmy Max · Nueva actualización').setDescription(greeting+'\n\n'+body+'\n\n[Ver revisión en GitHub](https://github.com/wdydk/bot-de-brian/commit/'+sha+')').setFooter({text:'Revisión '+sha.slice(0,12)+' · Discord conectado; no certifica todos los servicios.'}).setTimestamp();
       await channel.send({embeds:[embed],allowedMentions:{parse:[]},nonce:sha.slice(0,24),enforceNonce:true});state='sent';
    }catch{}
    this.patch(guild.id,{announcement:{...next,state}});
    if(state==='sent'&&this.origin){
       for(const kind of ['directory','setup']){
          const old=this.store.guild(guild.id).officialPanels?.[kind];if(!old)continue;
          try{await publish({client:this.client,store:this.store,guild,ctx:{channel:{id:old.channel}},kind,defs:this.defs,origin:this.origin});}catch(e){console.warn('[OFFICIAL PANEL]',e.code||e.name);}
       }
    }
 }
 async tick(){
    if(this.closed||this.running||!this.client.isReady())return;
    this.running=true;
    try{
       for(const [id,cfg] of Object.entries(this.store.data.guilds)){
          if(this.closed)break;
          const c=cfg.officialRuntime;if(!c?.updates&&!c?.voice)continue;
          const cached=this.client.guilds.cache.get(id);if(!cached)continue;
          try{
             const owner=c.updates?.owner||c.voice?.owner,guild=await authorize(this.client,{guild:cached,user:{id:owner}});
             if(this.closed)break;
             if(c.updates&&c.updates.owner===owner)await this.announce(guild,c).catch(e=>console.warn('[OFFICIAL UPDATE]',e.code||e.name));
             const voice=this.config(id).voice;
             if(!this.closed&&voice&&voice.owner===owner)await this.music.ensureOfficialVoice(guild,voice);
          }catch(e){console.warn('[OFFICIAL RUNTIME]',e.code||e.name);}
       }
    }finally{this.running=false;}
 }
 start(){if(this.timer||this.closed)return;const tick=()=>this.tick().catch(e=>console.warn('[OFFICIAL RUNTIME]',e.code||e.name));this.timer=setInterval(tick,120000);this.timer.unref();tick();}
 async close(){this.closed=true;clearInterval(this.timer);while(this.running)await new Promise(r=>setTimeout(r,50));}
}
module.exports={OfficialRuntime,deployment,catalogue,difference,facts,intro};
