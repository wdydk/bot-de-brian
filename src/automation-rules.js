'use strict';
const {randomUUID}=require('node:crypto');
const {UserError,integer,idOf}=require('./core');
const {ChannelType}=require('discord.js');
const {P}=require('./permissions');
function config(cfg){return {revision:0,rules:[],...cfg.automationRules};}
function parse(form){
 const event=form.get('event'),condition=form.get('condition'),action=form.get('ruleAction');
 if(!['join','leave'].includes(event)||!['any','young'].includes(condition)||!['notice','log'].includes(action))throw new UserError('Regla inválida.');
 return {event,condition,age:integer(form.get('age')||'7',1,30),action,channel:action==='notice'?idOf(form.get('channel')):null};
}
async function change(store,guild,member,form){
 if(member.id!==guild.ownerId)throw new UserError('Solo el dueño puede configurar automatizaciones.');
 const old=config(store.guild(guild.id));
 if(String(old.revision)!==form.get('revision'))throw new UserError('Las reglas cambiaron. Recarga.');
 let rules=old.rules.slice();
 if(form.get('action')==='rule-delete'){
    if(!rules.some(x=>x.id===form.get('id')))throw new UserError('Regla no encontrada.');
    rules=rules.filter(x=>x.id!==form.get('id'));
 }else if(form.get('action')==='rule-add'){
    if(rules.length>=10)throw new UserError('Máximo 10 reglas.');
    const rule=parse(form);
    if(rule.action==='notice'){
        const ch=await guild.channels.fetch(rule.channel),me=await guild.members.fetchMe();
        if(ch?.type!==ChannelType.GuildText||!ch.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages])||!ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))throw new UserError('Revisa permisos del canal.');
    }
    if(rules.some(x=>JSON.stringify({...x,id:undefined})===JSON.stringify(rule)))throw new UserError('Ya existe esta regla.');
    rules.push({...rule,id:randomUUID()});
 }else throw new UserError('Acción inválida.');
 if(config(store.guild(guild.id)).revision!==old.revision)throw new UserError('Las reglas cambiaron.');
 store.patchGuild(guild.id,{automationRules:{revision:old.revision+1,rules}});
}
function matches(rule,event,member,now){return !member.user?.bot&&rule.event===event&&(rule.condition==='any'||rule.condition==='young'&&Number.isFinite(member.user?.createdTimestamp)&&now-member.user.createdTimestamp>=0&&now-member.user.createdTimestamp<rule.age*86400000);}
module.exports={config,parse,change,matches};
