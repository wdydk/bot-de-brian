'use strict';
const { UserError, integer } = require('./core');
function validateCustom(name,type,text,minutes,definitions=[]) {
    name=String(name||'').trim().toLowerCase();
    if(!/^[a-z0-9_-]{1,24}$/.test(name)||['__proto__','constructor','prototype'].includes(name)||definitions.some(d=>d.name===name||d.aliases?.includes(name))) throw new UserError('Nombre inválido o reservado por Timmy.');
    if(type==='text') {
        text=String(text||'').trim();
        if(!text||text.length>1800) throw new UserError('Escribe una respuesta de 1–1800 caracteres.');
        return {name,type,text};
    }
    if(type==='timeout') return {name,type,minutes:integer(String(minutes),1,1440)};
    throw new UserError('Tipo de comando no permitido.');
}
function saveCustom(store,guildId,definition,remove=false) {
    const cfg=store.guild(guildId), custom={...cfg.custom}, actions={...cfg.customActions};
    const {name,type}=definition;
    if(!remove && new Set([...Object.keys(custom),...Object.keys(actions),name]).size>50) throw new UserError('Máximo 50 comandos personalizados por servidor.');
    delete custom[name];delete actions[name];
    if(!remove) {
        if(type==='text') custom[name]=definition.text;
        else actions[name]={type:'timeout',minutes:definition.minutes};
    }
    store.patchGuild(guildId,{custom,customActions:actions});
}
module.exports={validateCustom,saveCustom};
