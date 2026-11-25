'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,ChannelType}=require('discord.js');
const {UserError,Serial,idOf}=require('./core');
const {P}=require('./permissions');
const {isAdmin}=require('./access');
const kinds=['poll','event','application'];
function parse(kind,form,now=Date.now()){
 const title=String(form.get('title')||'').trim(),description=String(form.get('description')||'').trim();
 if(!kinds.includes(kind)||!title||title.length>150||description.length>500)throw new UserError('Revisa título y descripción.');
 let items=[],due=null,eventType=null;
 if(kind!=='event'){
   items=String(form.get('items')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
   if(items.length<(kind==='poll'?2:1)||items.length>5||items.some(x=>x.length>45)||new Set(items).size!==items.length)throw new UserError('Usa opciones o preguntas únicas, máximo cinco y 45 caracteres cada una.');
 }else{
   const date=form.get('due');due=/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(date||'')?Date.parse(date+'Z'):NaN;
   if(!Number.isFinite(due)||due<now+15*60000||due>now+90*86400000)throw new UserError('Programa el evento entre 15 minutos y 90 días.');
   eventType=form.get('eventType');if(!['meeting','tournament'].includes(eventType))throw new UserError('Tipo inválido.');
 }
 return {title,description,items,due,eventType};
}
class Engagement{
 constructor(client,store,clock=Date.now){this.client=client;this.store=store;this.clock=clock;this.serial=new Serial();this.sweeping=false;}
 db(){if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'engagement-center.sqlite'));this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS panels(id TEXT PRIMARY KEY,g TEXT NOT NULL,kind TEXT NOT NULL,channel TEXT NOT NULL,message TEXT,actor TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,due INTEGER,reminded INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS responses(panel TEXT NOT NULL,user TEXT NOT NULL,value TEXT NOT NULL,at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',PRIMARY KEY(panel,user));');}return this.database;}
 find(g,id){return this.db().prepare('SELECT * FROM panels WHERE g=? AND id=?').get(g,id);}
 rows(g,kind){return this.db().prepare('SELECT * FROM panels WHERE g=? AND kind=? ORDER BY rowid DESC LIMIT 30').all(g,kind);}
 responses(g,id){if(!this.find(g,id))throw new UserError('Panel no disponible.');return this.db().prepare('SELECT user,value,at,status FROM responses WHERE panel=? ORDER BY at DESC LIMIT 100').all(id);}
 counts(row){
 const db=this.db(),data=JSON.parse(row.data);
 if(row.kind==='poll')return data.items.map((_,i)=>db.prepare('SELECT count(*) n FROM responses WHERE panel=? AND value=?').get(row.id,String(i)).n);
 return [db.prepare('SELECT count(*) n FROM responses WHERE panel=?').get(row.id).n];
 }
 payload(row){
 const d=JSON.parse(row.data),counts=this.counts(row),active=row.state==='open';
 const prefix='tm:eng:'+row.id+':';
 const button=(action,label)=>new ButtonBuilder().setCustomId(prefix+action).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(!active);
 const heading='**'+d.title.replace(/[*_~\x60]/g,'')+'**\n'+d.description;
 const summary=row.kind==='poll'?d.items.map((x,i)=>(i+1)+'. '+x+' — '+counts[i]+' voto(s)').join('\n'):row.kind==='event'?'Fecha UTC: '+new Date(d.due).toISOString()+'\nInscritos: '+counts[0]+'\nTipo: '+(d.eventType==='tournament'?'Torneo':'Evento'):'Postulaciones recibidas: '+counts[0];
 const buttons=row.kind==='poll'?d.items.map((x,i)=>button('vote'+i,x)):row.kind==='event'?[button('join','Inscribirme'),button('leave','Retirar inscripción')]:[button('apply','Postularme')];
 return {content:heading+'\n\n'+summary+(active?'':'\nPanel cerrado.'),components:[new ActionRowBuilder().addComponents(buttons)],allowedMentions:{parse:[]}};
 }
 async create(guild,member,kind,form){
 if(!isAdmin(member,guild)||form.get('confirm')!=='yes')throw new UserError('Confirma la publicación.');
 const d=parse(kind,form,this.clock()),channel=await guild.channels.fetch(idOf(form.get('channel'))),me=await guild.members.fetchMe();
 if(channel?.type!==ChannelType.GuildText||!channel.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages])||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))throw new UserError('Revisa permisos del canal.');
 const db=this.db(),nonce=form.get('nonce');
 if(!/^[a-f0-9]{24}$/.test(nonce||''))throw new UserError('Solicitud inválida.');
 const old=this.find(guild.id,nonce);if(old){if(old.actor!==member.id||old.kind!==kind||!old.message)throw new UserError('Publicación anterior sin confirmar. Revisa Discord.');return;}
 if(db.prepare("SELECT count(*) n FROM panels WHERE g=? AND state IN ('open','publishing')").get(guild.id).n>=30)throw new UserError('Máximo 30 paneles activos.');
 db.prepare('INSERT INTO panels(id,g,kind,channel,actor,data,state,due) VALUES(?,?,?,?,?,?,?,?)').run(nonce,guild.id,kind,channel.id,member.id,JSON.stringify(d),'publishing',d.due);
 const row=this.find(guild.id,nonce);
 const sent=await channel.send({...this.payload({...row,state:'open'}),nonce,enforceNonce:true});
 db.prepare("UPDATE panels SET message=?,state='open' WHERE id=? AND state='publishing'").run(sent.id,nonce);
 }
 async refresh(guild,row){
 try{const ch=await guild.channels.fetch(row.channel);if(ch?.type===ChannelType.GuildText&&row.message)await ch.messages.edit(row.message,this.payload(row));}catch{}
 }
 async closePanel(guild,id){return this.serial.run(id,async()=>{const row=this.find(guild.id,id);if(!row||row.state!=='open')throw new UserError('Panel no disponible.');this.db().prepare("UPDATE panels SET state='closed' WHERE g=? AND id=?").run(guild.id,id);await this.refresh(guild,this.find(guild.id,id));});}
 review(g,id,user,decision){
 const row=this.find(g,id);if(row?.kind!=='application'||!['accepted','rejected'].includes(decision))throw new UserError('Postulación no válida.');
 if(!this.db().prepare("UPDATE responses SET status=? WHERE panel=? AND user=? AND status='pending'").run(decision,id,idOf(user)).changes)throw new UserError('No hay postulación pendiente.');
 }
 async handle(i){
 if(!i.customId?.startsWith('tm:eng:'))return false;
 if(!i.guild||i.user.bot)throw new UserError('Solo miembros del servidor.');
 const [, ,id,action]=i.customId.split(':');
 const row=this.find(i.guildId,id),modal=i.isModalSubmit();
 if(!row||row.state!=='open'||i.channelId!==row.channel||(!modal&&i.message?.id!==row.message)||(row.kind==='event'&&this.clock()>=row.due))throw new UserError('Este panel ya no está activo.');
 const member=await i.guild.members.fetch({user:i.user.id,force:true});
 if(!member||!i.channel?.permissionsFor(member)?.has(P.ViewChannel))throw new UserError('No tienes acceso a este panel.');
 if(action==='apply'&&i.isButton()&&row.kind==='application'){
   const d=JSON.parse(row.data);
   const modal=new ModalBuilder().setCustomId('tm:eng:'+id+':submit').setTitle(d.title.slice(0,45));
   modal.addComponents(d.items.map((x,n)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q'+n).setLabel(x).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true))));
   await i.showModal(modal);return true;
 }
 await i.deferReply({flags:MessageFlags.Ephemeral});
 return this.serial.run(id,async()=>{
   const live=this.find(i.guildId,id);if(live?.state!=='open'||(live.kind==='event'&&this.clock()>=live.due))throw new UserError('Panel cerrado.');
   const db=this.db(),d=JSON.parse(live.data),now=this.clock();
   if(i.isButton()&&live.kind==='poll'&&/^vote[0-4]$/.test(action)&&Number(action.slice(4))<d.items.length){
      db.prepare("INSERT INTO responses(panel,user,value,at) VALUES(?,?,?,?) ON CONFLICT(panel,user) DO UPDATE SET value=excluded.value,at=excluded.at").run(id,i.user.id,action.slice(4),now);
   }else if(i.isButton()&&live.kind==='event'&&['join','leave'].includes(action)){
      if(action==='join')db.prepare('INSERT OR IGNORE INTO responses(panel,user,value,at) VALUES(?,?,?,?)').run(id,i.user.id,'joined',now);
      else db.prepare('DELETE FROM responses WHERE panel=? AND user=?').run(id,i.user.id);
   }else if(modal&&live.kind==='application'&&action==='submit'){
      const answers=d.items.map((_,n)=>String(i.fields.getTextInputValue('q'+n)).trim());
      if(answers.some(x=>!x||x.length>500))throw new UserError('Completa las respuestas.');
      if(!db.prepare('INSERT OR IGNORE INTO responses(panel,user,value,at) VALUES(?,?,?,?)').run(id,i.user.id,JSON.stringify(answers),now).changes)throw new UserError('Ya enviaste una postulación.');
   }else throw new UserError('Acción inválida.');
   await i.editReply({content:live.kind==='application'?'Postulación recibida de forma privada.':'Respuesta registrada.'});
   await this.refresh(i.guild,live);return true;
 });
 }
 async sweep(){
 if(this.sweeping||!this.client.isReady())return;this.sweeping=true;
 try{const db=this.db(),now=this.clock();for(const row of db.prepare("SELECT * FROM panels WHERE kind='event' AND state='open' AND reminded=0 AND due<=? LIMIT 10").all(now+15*60000)){
    if(!db.prepare('UPDATE panels SET reminded=1 WHERE id=? AND reminded=0').run(row.id).changes)continue;
    if(row.due<=now)continue;
    const g=this.client.guilds.cache.get(row.g),ch=await g?.channels.fetch(row.channel).catch(()=>null);
    if(ch?.type===ChannelType.GuildText)await ch.send({content:'Recordatorio: '+JSON.parse(row.data).title+' empieza pronto (<t:'+Math.floor(row.due/1000)+':R>).',allowedMentions:{parse:[]}}).catch(()=>{});
 }}finally{this.sweeping=false;}
 }
 start(){this.timer=setInterval(()=>this.sweep().catch(e=>console.warn('[ENGAGEMENT]',e.code||e.name)),30000);this.timer.unref();}
 async close(){clearInterval(this.timer);while(this.sweeping)await new Promise(r=>setTimeout(r,25));this.database?.close();}
}
module.exports={Engagement,parse};
