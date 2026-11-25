'use strict';
const {ChannelType}=require('discord.js');
const {UserError}=require('./core');
const {P}=require('./permissions');
function text(v,max=80){if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new UserError('Nombre inválido.');return v.trim();}
function parse(source){
 let raw;try{raw=JSON.parse(source);}catch{throw new UserError('Plantilla JSON inválida.');}
 if(!raw||typeof raw!=='object'||Object.keys(raw).some(k=>!['categories','roles'].includes(k))||!Array.isArray(raw.categories)||!Array.isArray(raw.roles)||raw.categories.length>8||raw.roles.length>12)throw new UserError('Usa categories y roles: máximo 8 categorías y 12 roles.');
 const categories=raw.categories.map(c=>{
    if(!c||Object.keys(c).some(k=>!['name','channels'].includes(k))||!Array.isArray(c.channels)||c.channels.length>10)throw new UserError('Cada categoría necesita name y channels.');
    const channels=c.channels.map(n=>{const v=text(n);if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v))throw new UserError('Canales: minúsculas, números, guiones o guion bajo.');return v;});
    if(new Set(channels).size!==channels.length)throw new UserError('Canales repetidos.');
    return {name:text(c.name),channels};
 });
 const roles=raw.roles.map(n=>text(n));
 if(roles.some(n=>n==='@everyone'||n==='@here')||new Set(roles).size!==roles.length||new Set(categories.map(c=>c.name)).size!==categories.length||categories.reduce((n,c)=>n+c.channels.length,0)>24)throw new UserError('Nombres repetidos/reservados o más de 24 canales.');
 return {categories,roles};
}
function planFor(guild){
 const categories=[...guild.channels.cache.values()].filter(c=>c.type===ChannelType.GuildCategory).map(c=>({name:c.name,channels:[...guild.channels.cache.values()].filter(x=>x.type===ChannelType.GuildText&&x.parentId===c.id&&/^[a-z0-9][a-z0-9_-]{0,79}$/.test(x.name)).map(x=>x.name)}));
 const roles=[...guild.roles.cache.values()].filter(r=>r.id!==guild.id&&!r.managed).map(r=>r.name);
 // Explicitly fail if snapshot exceeds the safe creation limits or has ambiguous names.
 return parse(JSON.stringify({categories,roles}));
}
async function apply(guild,actorId,plan){
 if(actorId!==guild.ownerId)throw new UserError('Solo el dueño real del servidor puede crear estructura.');
 const me=await guild.members.fetchMe({force:true});
 if(!me.permissions.has([P.ManageChannels,P.ManageRoles]))throw new UserError('Timmy necesita Gestionar canales y roles.');
 await guild.channels.fetch();await guild.roles.fetch();
 const safe=parse(JSON.stringify(plan)),out={created:[],skipped:[],failed:null};
 const roles=()=>[...guild.roles.cache.values()],channels=()=>[...guild.channels.cache.values()];
 // Never select an ambiguous category. Existing roles are not modified.
 for(const c of safe.categories)if(channels().filter(x=>x.type===ChannelType.GuildCategory&&x.name===c.name).length>1)throw new UserError('Categoría existente ambigua: '+c.name);
 try{
    for(const name of safe.roles){
        if(roles().some(r=>r.name===name)){out.skipped.push('Rol '+name);continue;}
        await guild.roles.create({name,permissions:0n,mentionable:false,hoist:false,reason:'Timmy Server Builder: aprobación del dueño'});out.created.push('Rol '+name);
    }
    for(const c of safe.categories){
        let parent=channels().find(x=>x.type===ChannelType.GuildCategory&&x.name===c.name);
        if(!parent){parent=await guild.channels.create({name:c.name,type:ChannelType.GuildCategory,permissionOverwrites:[{id:guild.id,deny:[P.ViewChannel]},{id:me.id,allow:[P.ViewChannel,P.SendMessages]}],reason:'Timmy Server Builder: categoría privada de revisión'});out.created.push('Categoría '+c.name);}
        else out.skipped.push('Categoría '+c.name);
        for(const name of c.channels){
            if(channels().some(x=>x.type===ChannelType.GuildText&&x.parentId===parent.id&&x.name===name)){out.skipped.push('#'+name);continue;}
            // Always private by default, including under an existing public category.
            await guild.channels.create({name,type:ChannelType.GuildText,parent:parent.id,permissionOverwrites:[{id:guild.id,deny:[P.ViewChannel]},{id:me.id,allow:[P.ViewChannel,P.SendMessages]}],reason:'Timmy Server Builder: canal privado de revisión'});out.created.push('#'+name);
        }
    }
 }catch{out.failed='Operación parcial. Revisa lo creado antes de repetir. No se borró nada.';}
 return out;
}
module.exports={parse,planFor,apply};
