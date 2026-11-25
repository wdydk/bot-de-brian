'use strict';
const {randomUUID}=require('node:crypto');
const {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder}=require('discord.js');
const {UserError,ExpiringCache}=require('./core');
const {P}=require('./permissions');
const labels={hug:['🤗','abrazo virtual','se dieron un abrazo virtual'],kiss:['💜','beso virtual','compartieron un beso virtual'],slap:['✋','bofetada de broma','aceptaron una bofetada de broma'],ship:['💞','pareja ficticia','aceptaron aparecer como pareja ficticia'],marry:['💍','matrimonio virtual','celebraron un matrimonio virtual']};
const verbs=new Set(Object.keys(labels));
const instantLabels={hug:['🤗','Abrazo virtual','envía un abrazo virtual a'],kiss:['💜','Beso virtual','envía un beso virtual a'],slap:['✋','Bofetada de broma','lanza una bofetada ficticia a'],ship:['💞','Ship ficticio','imagina una pareja ficticia con']};
class SocialCenter{
 constructor(store,clock=Date.now){this.store=store;this.clock=clock;this.pending=new ExpiringCache(10*60000,3000);this.limit=new ExpiringCache(15000,3000);this.incoming=new ExpiringCache(60000,5000);this.pairs=new ExpiringCache(10*60000,5000);this.instantSender=new ExpiringCache(10000,5000);this.instantTarget=new ExpiringCache(20000,5000);}
 enabled(g){if(!this.store.guild(g).socialEnabled)throw new UserError('Social Center está desactivado en este servidor. El dueño puede activarlo con >socialconfig on o desde el panel.');}
 optedOut(g,u){return this.store.guild(g).socialOptOut?.[u]===true;}
 preference(g,u,mode){
  if(mode==='status')return this.optedOut(g,u)?'No recibes interacciones sociales.':'Puedes recibir interacciones sociales.';
  if(!['off','on'].includes(mode))throw new UserError('Usa on, off o status.');
  const preferences={...this.store.guild(g).socialOptOut};
  if(mode==='off')preferences[u]=true;else delete preferences[u];
  this.store.patchGuild(g,{socialOptOut:preferences});
  return mode==='off'?'Interacciones sociales desactivadas para ti.':'Interacciones sociales activadas para ti.';
 }
 instant(g,from,to,verb){
  this.enabled(g);
  if(!Object.hasOwn(instantLabels,verb))throw new UserError('Esta interacción requiere una solicitud.');
  if(from===to)throw new UserError('No puedes mencionarte a ti mismo.');
  if(this.optedOut(g,from)||this.optedOut(g,to))throw new UserError('Esta interacción no está disponible con esos miembros.');
  if(this.instantSender.get(g+':'+from))throw new UserError('Espera 10 segundos entre interacciones.');
  if(this.instantTarget.get(g+':'+to))throw new UserError('Espera antes de interactuar con esa persona nuevamente.');
  const [emoji,title,action]=instantLabels[verb];
  const card=new EmbedBuilder().setColor(0xb8a5ff).setTitle(emoji+' '+title).setDescription('<@'+from+'> '+action+' <@'+to+'>.').setFooter({text:'Timmy Max · Interacción ficticia · /socialprivacy off'});
  this.instantSender.set(g+':'+from,true);this.instantTarget.set(g+':'+to,true);
  return {embeds:[card],allowedMentions:{parse:[]}};
 }
 pair(g,u){return this.store.guild(g).socialMarriages?.[u]||null;}
 request(g,from,to,verb,channel=null){
  this.enabled(g);
  if(from===to)throw new UserError('No puedes enviarte esta interacción a ti mismo. Menciona a otra persona.');
  if(!verbs.has(verb))throw new UserError('Interacción desconocida.');
  if(this.optedOut(g,from)||this.optedOut(g,to))throw new UserError('Esta interacción no está disponible con esos miembros.');
  const pair=g+':'+from+':'+to;
  if(this.pairs.get(pair))throw new UserError('Ya tienes una solicitud pendiente para esta persona.');
  const until=this.limit.get(g+':'+from);
  if(until&&until>this.clock())throw new UserError('Espera '+Math.ceil((until-this.clock())/1000)+' segundos antes de otra solicitud.');
  if(this.incoming.get(g+':'+to))throw new UserError('Esta persona recibió una solicitud recientemente. Intenta más tarde.');
  if(verb==='marry'&&(this.pair(g,from)||this.pair(g,to)))throw new UserError('Ya existe un matrimonio virtual.');
  const id=randomUUID().slice(0,12);this.pending.set(g+':'+id,{from,to,verb,channel});this.pairs.set(pair,id);this.limit.set(g+':'+from,this.clock()+15000);this.incoming.set(g+':'+to,true);return id;
 }
 lookup(g,u,id){
  this.enabled(g);const p=this.pending.get(g+':'+id);if(!p||p.to!==u||this.optedOut(g,p.from)||this.optedOut(g,p.to))throw new UserError('No hay solicitud vigente para ti. Puede haber caducado o ya haberse respondido.');return p;
 }
 cancel(g,id){
  const p=this.pending.get(g+':'+id);if(p){this.pending.delete(g+':'+id);const key=g+':'+p.from+':'+p.to;if(this.pairs.get(key)===id)this.pairs.delete(key);}
 }
 respond(g,u,id,accept){
  const p=this.lookup(g,u,id);
  if(accept&&p.verb==='marry'){if(this.pair(g,p.from)||this.pair(g,p.to))throw new UserError('Uno ya tiene matrimonio virtual.');const pairs={...this.store.guild(g).socialMarriages,[p.from]:p.to,[p.to]:p.from};this.store.patchGuild(g,{socialMarriages:pairs});}
  this.cancel(g,id);return accept?p:null;
 }
 invitation(g,id,verb,sender,server){
  const [emoji,label]=labels[verb];
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tm:social:'+g+':'+id+':yes').setLabel('Aceptar y mostrar').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('tm:social:'+g+':'+id+':no').setLabel('Rechazar').setStyle(ButtonStyle.Secondary));
  return {content:'Solicitud privada de '+sender+' en '+server+'. Si aceptas, Timmy podrá mostrar el resultado en el canal original. Rechazar es privado. Caduca en 10 minutos.',embeds:[new EmbedBuilder().setColor(0xb8a5ff).setTitle(emoji+' '+label).setDescription('Tú decides si quieres participar.')],components:[row],allowedMentions:{parse:[]}};
 }
 async complete(guild,user,id,accept){
  const p=this.lookup(guild.id,user,id);
  // Revalidate both members before accepting. No publication to another guild/channel.
  const target=await guild.members.fetch({user,force:true}).catch(()=>null);
  const sender=accept?await guild.members.fetch({user:p.from,force:true}).catch(()=>null):null;
  if(!target||accept&&!sender)throw new UserError('Uno de los miembros ya no está disponible.');
  const result=this.respond(guild.id,user,id,accept);
  if(!result)return 'Solicitud rechazada en privado.';
  const [emoji,label,description]=labels[result.verb];
  let published=false;
  if(result.channel&&guild.channels?.fetch){
    try{
      const ch=await guild.channels.fetch(result.channel),me=await guild.members.fetchMe({force:true});
      if(ch?.guild?.id===guild.id&&ch.isTextBased()&&ch.permissionsFor(target)?.has(P.ViewChannel)&&ch.permissionsFor(sender)?.has(P.ViewChannel)&&ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])){
        const embed=new EmbedBuilder().setColor(0xb8a5ff).setTitle(emoji+' '+label).setDescription('<@'+result.from+'> y <@'+result.to+'> '+description+'.').setFooter({text:'Timmy Max · Social Center'});
        await ch.send({embeds:[embed],allowedMentions:{parse:[]}});published=true;
      }
    }catch{}
  }
  await sender.user.send({content:'Tu solicitud de '+label+' fue aceptada.'+(published?'':' El resultado quedó en privado.'),allowedMentions:{parse:[]}}).catch(()=>{});
  return published?'Interacción aceptada. Timmy mostró el resultado en el canal original.':'Interacción aceptada en privado. No se pudo publicar en el canal original.';
 }
 async handle(i,client){
  if(!i.isButton()||!i.customId?.startsWith('tm:social:'))return false;
  const m=/^tm:social:(\d{17,20}):([a-f0-9]{8}-[a-f0-9]{3}):(yes|no)$/.exec(i.customId);
  if(!m||i.guildId||i.message?.author?.id!==client.user?.id)throw new UserError('Solicitud inválida.');
  this.lookup(m[1],i.user.id,m[2]);
  await i.deferUpdate();
  const guild=client.guilds.cache.get(m[1]);if(!guild){await i.editReply({content:'El servidor no está disponible.',components:[],embeds:[]});return true;}
  try{const text=await this.complete(guild,i.user.id,m[2],m[3]==='yes');await i.editReply({content:text,components:[],embeds:[],allowedMentions:{parse:[]}});}
  catch(e){await i.editReply({content:e instanceof UserError?e.message:'No se pudo completar la solicitud.',components:[],embeds:[],allowedMentions:{parse:[]}});}
  return true;
 }
 divorce(g,u){const p=this.pair(g,u);if(!p)throw new UserError('No tienes matrimonio virtual.');const pairs={...this.store.guild(g).socialMarriages};delete pairs[u];if(pairs[p]===u)delete pairs[p];this.store.patchGuild(g,{socialMarriages:pairs});}
}
module.exports={SocialCenter};
