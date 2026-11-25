'use strict';
const {UserError}=require('./core');
const labels={
 es:{page:'Comunidad',members:'Miembros',join:'Unirse a Discord',status:'Estado',online:'Conectado',offline:'No disponible'},
 en:{page:'Community',members:'Members',join:'Join Discord',status:'Status',online:'Connected',offline:'Unavailable'},
 pt:{page:'Comunidade',members:'Membros',join:'Entrar no Discord',status:'Estado',online:'Conectado',offline:'Indisponível'}
};
function config(cfg){return {enabled:false,title:'',description:'',invite:'',language:'es',revision:0,...cfg.publicPage};}
function validate(form){
 const get=k=>String(form.get(k)||'').trim(),title=get('title'),description=get('description'),invite=get('invite'),language=get('language');
 if(!Object.hasOwn(labels,language)||title.length>100||description.length>2000)throw new UserError('Revisa el título, descripción e idioma.');
 if(invite&&!/^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]{2,64}$/.test(invite))throw new UserError('Usa un enlace oficial de invitación Discord.');
 if(form.has('enabled')&&!title)throw new UserError('Escribe un título público.');
 return {enabled:form.has('enabled'),title,description,invite,language};
}
function save(store,guild,member,form){
 if(member.id!==guild.ownerId)throw new UserError('Solo el dueño puede publicar la página de su comunidad.');
 const old=config(store.guild(guild.id));
 if(String(old.revision)!==form.get('revision'))throw new UserError('La página cambió. Recarga.');
 store.patchGuild(guild.id,{publicPage:{...validate(form),revision:old.revision+1}});
}
function status(client,started=process.uptime()){
 const ready=Boolean(client?.isReady?.());
 const ping=client?.ws?.ping;
 return {ready,ping:ready&&Number.isFinite(ping)&&ping>=0?Math.round(ping):null,uptimeSeconds:Math.floor(started),servers:ready?client.guilds.cache.size:null};
}
function page(cfg,guild,esc){
 const p=config(cfg);if(!p.enabled)return null;
 const l=labels[p.language]||labels.es;
 return '<section class="plain" lang="'+esc(p.language)+'"><span class="eyebrow">'+l.page+'</span><h1>'+esc(p.title)+'</h1><p class="community-description">'+esc(p.description)+'</p><p>'+l.members+': '+esc(Number.isSafeInteger(guild.memberCount)?guild.memberCount:'—')+'</p>'+(p.invite?'<a class="button primary" rel="noopener noreferrer" href="'+esc(p.invite)+'">'+l.join+'</a>':'')+'</section>';
}
module.exports={config,validate,save,status,page,labels};
