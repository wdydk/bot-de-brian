'use strict';
const {UserError}=require('./core');
const {P}=require('./permissions');
const {ChannelType}=require('discord.js');
const {validateTemplate}=require('./templates');
const {guardSelfAssignable}=require('./delegation');
const snow=x=>/^\d{17,20}$/.test(x||'');
function optionsFromText(text,style){
    const rows=String(text||'').split(/\r?\n/).filter(x=>x.trim()).map(line=>{
        const [key,label,question,...extra]=line.split('|').map(x=>x.trim());
        if(extra.length||!/^[a-z0-9_-]{1,24}$/.test(key||'')||!label||label.length>45||!question||question.length>45)throw new UserError('Cada categoría: clave | nombre (máx. 45) | pregunta (máx. 45).');
        return {key,label,question};
    });
    if(!rows.length||rows.length>(style==='buttons'?5:25)||new Set(rows.map(x=>x.key)).size!==rows.length)throw new UserError('Categorías repetidas o demasiadas: 5 botones o 25 opciones.');
    return rows;
}
function ticketSettings(cfg){return {ticketCategory:cfg.ticketCategory||null,supportRole:cfg.supportRole||null,ticketTemplate:cfg.ticketTemplate||'',ticketStyle:cfg.ticketStyle||'select',ticketOptions:cfg.ticketOptions||null,ticketPanelChannel:cfg.ticketPanelChannel||null,ticketPanelMessage:cfg.ticketPanelMessage||null};}
async function saveTicketStudio({guild,member,store,form,version}){
    const cfg=store.guild(guild.id), old=ticketSettings(cfg);
    if(version(old)!==form.get('revision'))throw new UserError('Los tickets cambiaron. Recarga el panel.');
    const category=form.get('category'),roleId=form.get('support'),style=form.get('style'),template=String(form.get('template')||'').trim();
    if(!snow(category)||!snow(roleId)||!['buttons','select'].includes(style))throw new UserError('Selecciona categoría, soporte y tipo.');
    const parent=await guild.channels.fetch(category),role=await guild.roles.fetch(roleId),me=await guild.members.fetchMe();
    if(parent?.type!==ChannelType.GuildCategory||!role||role.id===guild.id||role.managed)throw new UserError('Categoría o rol no válido.');
    if(!me.permissions.has(P.ManageChannels))throw new UserError('Timmy necesita Gestionar canales.');
    guardSelfAssignable(role.id,cfg);
    if(template)validateTemplate(template,member);
    const ticketOptions=optionsFromText(form.get('options'),style);
    if(version(ticketSettings(store.guild(guild.id)))!==form.get('revision'))throw new UserError('Los tickets cambiaron. Recarga.');
    store.patchGuild(guild.id,{ticketCategory:category,supportRole:roleId,ticketStyle:style,ticketTemplate:template,ticketOptions});
}
module.exports={optionsFromText,ticketSettings,saveTicketStudio};
