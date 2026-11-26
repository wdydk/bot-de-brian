'use strict';
const { UserError } = require('./core');
const { randomUUID } = require('node:crypto');
const SIMPLE = new Set(['pause','resume','skip','stop','shuffle','queue','nowplaying']);
const ACTIONS = ['play','play_recent',...SIMPLE,'volume','loop'];
const declaration = {
    name:'music_action',
    description:'Proponer una sola acción musical que el autor solicita explícitamente ahora. Nunca usar para preguntas informativas, citas, ejemplos, negaciones, hipótesis o peticiones ambiguas.',
    parameters:{type:'OBJECT',properties:{
        action:{type:'STRING',enum:ACTIONS},
        query:{type:'STRING',description:'Solo para play: nombre y artista o enlace explícito de la canción o playlist.'},
        volume:{type:'INTEGER',description:'Solo para volume: nivel absoluto de 0 a 100.'},
        loop:{type:'STRING',enum:['off','song','queue'],description:'Solo para loop: modo solicitado.'}
    },required:['action']}
};
function isMusicCandidate(text){
    const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    if(!t||t.length>500||/[\r\n]/.test(t))return false;
    return /^(?:[¿¡]\s*)?(?:(?:por favor[,\s]+|oye[,\s]+|timmy[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias)\s+))*\b(?:pon(?:me|la|lo)?|poner|reproduce(?:me|la)?|reproducir|play|pausa(?:la|r)?|reanuda(?:la|r)?|continua(?:r)?|salta(?:r|la)?|skip|deten(?:la|er)?|para(?:r|la)?|mezcla(?:r)?|repite|repetir|quita|desactiva|activa|ajusta|cambia|sube|baja|deja|muestra(?:me)?|ensena(?:me)?|dime|que)\b/.test(t)
      && (/\b(?:musica|cancion(?:es)?|tema(?:s)?|pista(?:s)?|volumen|cola|playlist|spotify|youtube|loop|sonando|repeticion|reproduccion|audio|skip|shuffle)\b/.test(t)||/^(?:[¿¡]\s*)?(?:(?:por favor[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias)\s+))*\b(?:ponme|reproduceme|reproduce|play)\s+\S/.test(t));
}
function validateCall(response,recentQuery){
    const calls=response?.functionCalls;
    if(!Array.isArray(calls)||calls.length!==1)return null;
    const call=calls[0], a=call?.args;
    if(call?.name!=='music_action'||!a||typeof a!=='object'||Array.isArray(a)||!ACTIONS.includes(a.action))return null;
    const keys=Object.keys(a);
    if(SIMPLE.has(a.action))return keys.length===1?{command:a.action,args:[]}:null;
    if(a.action==='play_recent'){
        if(keys.length!==1)return null;
        if(!recentQuery)return {missingRecent:true};
        return {command:'play',args:[recentQuery]};
    }
    if(a.action==='play'){
        const q=typeof a.query==='string'?a.query.trim():'';
        if(keys.length!==2||!Object.hasOwn(a,'query')||!q||q.length>300||/[\x00-\x1f\x7f]/.test(q)||/^(?:local(?:-playlist)?):/i.test(q))return null;
        return {command:'play',args:[q]};
    }
    if(a.action==='volume')return keys.length===2&&Number.isInteger(a.volume)&&a.volume>=0&&a.volume<=100?{command:'volume',args:[String(a.volume)]}:null;
    if(a.action==='loop')return keys.length===2&&['off','song','queue'].includes(a.loop)?{command:'loop',args:[a.loop]}:null;
    return null;
}
class MusicApprovals{
    constructor(cache){this.cache=cache;}
    create(ctx,intent){
        const token=randomUUID();
        this.cache.set(token,{guild:ctx.guild.id,channel:ctx.channel.id,user:ctx.user.id,intent:{command:intent.command,args:[...intent.args]}});
        return token;
    }
    take(ctx,token,cancel=false){
        const p=this.cache.get(token);
        if(!p||p.guild!==ctx.guild?.id||p.channel!==ctx.channel?.id||p.user!==ctx.user?.id)throw new UserError('Esta solicitud no es tuya o ya expiró.');
        this.cache.delete(token);
        return cancel?null:p.intent;
    }
}
module.exports={declaration,isMusicCandidate,validateCall,MusicApprovals};
