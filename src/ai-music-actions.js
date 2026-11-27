'use strict';
const { UserError } = require('./core');
const { parseSpotifyLink } = require('./music-selection');
const { randomUUID } = require('node:crypto');
const SIMPLE = new Set(['pause','resume','skip','stop','shuffle','queue','nowplaying']);
const ACTIONS = ['play','play_recent',...SIMPLE,'volume','loop','no_action'];
const declaration = {
    name:'music_action',
    description:'Clasificar una sola solicitud. Usa no_action para preguntas informativas, citas, ejemplos, negaciones, hipótesis o peticiones ambiguas; no propone una ejecución.',
    parameters:{type:'OBJECT',properties:{
        action:{type:'STRING',enum:ACTIONS},
        query:{type:'STRING',description:'Solo para play: nombre y artista o enlace explícito de la canción o playlist.'},
        volume:{type:'INTEGER',description:'Solo para volume: nivel absoluto de 0 a 100.'},
        loop:{type:'STRING',enum:['off','song','queue'],description:'Solo para loop: modo solicitado.'}
    },required:['action']}
};
function isExplanation(input){
    const t=normalizeRequest(input);
    return /^(?:(?:dime|explicame|muestrame|ensename)\s+)?(?:que (?:es|son|significa[n]?|diferencia)|como (?:se|funciona[n]?)|para que (?:sirve[n]?|se usa[n]?))\b/.test(t)
        || /^(?:pon(?:me)?|da(?:me)?|muestra(?:me)?|ensena(?:me)?) (?:un(?:a)? |otro |otra )?(?:ejemplo|explicacion|definicion)\b/.test(t);
}
function isMusicCandidate(text){
    const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    if(!t||t.length>500||/[\r\n]/.test(t)||isExplanation(t))return false;
    return /^(?:[¿¡]\s*)?(?:(?:por favor[,\s]+|oye[,\s]+|timmy[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias)\s+))*\b(?:pon(?:me|la|lo)?|poner|reproduce(?:me|la)?|reproducir|play|pausa(?:la|r)?|reanuda(?:la|r)?|continua(?:r)?|salta(?:r|la)?|skip|deten(?:la|er)?|para(?:r|la)?|mezcla(?:r)?|repite|repetir|quita|desactiva|activa|ajusta|cambia|sube|baja|deja|muestra(?:me)?|ensena(?:me)?|dime|que)\b/.test(t)
      && (/\b(?:musica|cancion(?:es)?|tema(?:s)?|pista(?:s)?|volumen|cola|playlist|spotify|youtube|loop|sonando|repeticion|reproduccion|audio|skip|shuffle)\b/.test(t)||/^(?:[¿¡]\s*)?(?:(?:por favor[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias)\s+))*\b(?:ponme|reproduceme|reproduce|play)\s+\S/.test(t));
}
// Conservative local parser for common explicit requests. All results still require confirmation.
const units=['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'];
function spanishNumber(value){
    if(/^\d{1,3}$/.test(value))return Number(value);
    if(value==='un')return 1;
    if(value==='cien'||value==='ciento')return 100;
    const small=['diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve'];
    if(units.includes(value))return units.indexOf(value);
    if(small.includes(value))return small.indexOf(value)+10;
    const tens=['treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const [base,unit,...extra]=value.split(' y ');
    return tens.includes(base)&&!extra.length&&(!unit||units.indexOf(unit)>0)?30+tens.indexOf(base)*10+(unit?units.indexOf(unit):0):NaN;
}
function normalizeRequest(input){
    return String(input||'').trim().replace(/\s+/g,' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/^[¿¡]\s*/,'').replace(/[?!.,]+$/,'').trim()
        .replace(/^(?:(?:por favor[,\s]+|oye[,\s]+|timmy[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias|please|can you|could you)\s+))+/,'')
        .replace(/,?\s+(?:por favor|please)$/,'');
}
function explicitControl(input,recentQuery){
    const t=normalizeRequest(input);
    if(!t||t.length>500||/[;\x00-\x1f]/.test(String(input).replace(/\r?\n/g,' ')))return null;
    // Control syntax wins over play syntax. Invalid values must never become track searches.
    const volume=/^(?:(?:pon(?:me)?|poner|ajusta(?:r)?|cambia(?:r)?|deja(?:r)?|sube|baja|set|change|lower|raise)\s+)?(?:(?:el|the)\s+)?(?:volumen|volume|vol)(?:\s+(?:a|al|en|to|at))?(?:\s+(.+))?$/.exec(t);
    if(volume){
        const raw=(volume[1]||'').replace(/\s*(?:%|por ciento|percent)$/,'').trim();
        const n=spanishNumber(raw);
        return Number.isInteger(n)&&n>=0&&n<=100?{command:'volume',args:[String(n)]}:{clarify:'¿A qué volumen quieres que lo ajuste? Indica un número del 0 al 100.'};
    }
    const direct={
        'pause':'pause','pause music':'pause','pause the music':'pause','pausala':'pause','pausa':'pause',
        'resume':'resume','resume music':'resume','continue':'resume','reanuda':'resume','continua':'resume',
        'skip':'skip','next':'skip','next song':'skip','siguiente':'skip','saltala':'skip',
        'stop':'stop','stop music':'stop','stop the music':'stop','deten la musica':'stop',
        'queue':'queue','show queue':'queue','cola':'queue','shuffle':'shuffle','mezcla':'shuffle',
        'nowplaying':'nowplaying','now playing':'nowplaying','what is playing':'nowplaying',
    };
    if(Object.hasOwn(direct,t))return {command:direct[t],args:[]};
    const repeat=/^(?:loop|repeat)\s+(off|song|queue)$/.exec(t);
    if(repeat)return {command:'loop',args:[repeat[1]]};
    if(/^(?:ponla|reproducela|ponlo|reproducelo|play it)(?:\s+(?:para escuchar(?:la|lo)|para oir(?:la|lo)|ahora|por favor))?$/.test(t)||
       /^(?:pon|ponme|reproduce|play) (?:esa|esta|la misma|la anterior) (?:cancion|pista|tema|musica)$/.test(t)){
        return recentQuery?{command:'play',args:[recentQuery]}:{missingRecent:true};
    }
    return null;
}
function isMusicCandidateV2(input){
    return Boolean(explicitControl(input))||isMusicCandidate(String(input||'').replace(/\s+/g,' '));
}
function routeLocal(input,recentQuery){
    const direct=explicitControl(input,recentQuery);
    if(direct)return direct;
    // Whitespace from Discord line breaks is not part of a title. Reject separate commands.
    const raw=String(input||'').trim();
    if(/[\r\n]\s*(?:[>,/]|(?:pon(?:me)?|play|volume|volumen|pause|skip|stop|baja|sube|cambia|ajusta)\b)/i.test(raw))return null;
    return localMusicIntent(raw.replace(/\s+/g,' '),recentQuery);
}
function safeProposal(intent,input){
    if(!intent?.command)return intent;
    // Never allow a model to reinterpret an explicit control as a track name.
    if(intent.command==='play'&&/^(?:(?:el|the)\s+)?(?:volumen|volume|vol)\b/i.test(intent.args[0]||''))return {clarify:'¿A qué volumen quieres que lo ajuste? Indica un número del 0 al 100.'};
    return intent;
}
function localMusicIntent(input,recentQuery){
    const raw=String(input||'').trim();
    if(!raw||raw.length>500||/[\r\n;]|[\x00-\x1f]/.test(raw)||isExplanation(raw))return null;
    const t=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/^[¿¡]\s*/,'').replace(/[?!.,]+$/,'').trim()
        .replace(/^(?:(?:por favor[,\s]+|oye[,\s]+|timmy[,\s]+|(?:puedes|podrias|quiero que|me puedes|me podrias)\s+))+/,'')
        .replace(/,?\s+por favor$/,'').replace(/\s+/g,' ');
    const play=/^(?:[¿¡]\s*)?(?:(?:por favor[,\s]+|oye[,\s]+|timmy[,\s]+|(?:puedes|podr[ií]as|quiero que|me puedes|me podr[ií]as)\s+))*(?:ponme|pon|reproduce|reprod[uú]ceme|play)\s+(.+)$/i.exec(raw);
    const q=play?.[1].replace(/,?\s+por favor[.!?]*$/i,'').replace(/[?!]+$/,'').trim();
    if(q && parseSpotifyLink(q))return {command:'play',args:[q]};
    if(/\b(?:no|nunca|ejemplo|hipoteticamente|si te digo|y luego|despues|ademas)\b/.test(t))return null;
    const volume=/^(?:pon|ponme|poner|ajusta|ajustar|cambia|cambiar|deja|dejar|sube|baja) (?:el )?volumen (?:a(?:l)? |en )?(.+?)(?:\s*(?:%|por ciento))?$/.exec(t);
    if(volume){const n=spanishNumber(volume[1].trim());return Number.isInteger(n)&&n>=0&&n<=100?{command:'volume',args:[String(n)]}:null;}
    const simple=[
        ['shuffle',/^(?:mezcla|mezclar|baraja|shuffle)(?: (?:la cola|las canciones(?: pendientes)?|la playlist))?$/],
        ['nowplaying',/^(?:(?:muestra(?:me)?|ensena(?:me)?|dime) )?(?:que (?:esta )?sonando|que cancion (?:esta sonando|suena)|la cancion actual|nowplaying)$/],
        ['queue',/^(?:muestra(?:me)?|ensena(?:me)?|dime|ver) (?:la cola(?: de canciones)?|las canciones pendientes)$/],
        ['pause',/^(?:pausa|pausala|pausar)(?: (?:la musica|la cancion|la pista|el audio))?$/],
        ['resume',/^(?:reanuda|reanudala|continua|continuar)(?: (?:la musica|la cancion|la pista|el audio|la reproduccion))?$/],
        ['skip',/^(?:skip|siguiente(?: cancion| pista)?|salta(?: la cancion| esta cancion| la pista)?)$/],
        ['stop',/^(?:stop|deten|para) (?:la musica|la reproduccion|el audio)$/]
    ];
    for(const [command,pattern] of simple)if(pattern.test(t))return {command,args:[]};
    if(/^(?:repite|repetir|pon en loop) (?:esta|la|esa) (?:cancion|pista|tema)$/.test(t))return {command:'loop',args:['song']};
    if(/^(?:repite|repetir|pon en loop) (?:la cola|la playlist)$/.test(t))return {command:'loop',args:['queue']};
    if(/^(?:quita|desactiva) (?:el loop|la repeticion)$/.test(t))return {command:'loop',args:['off']};
    if(/^(?:ponme|pon|reproduce|reproduceme|play) (?:esa|esta|la misma) (?:cancion|pista|tema)$/.test(t))return recentQuery?{command:'play',args:[recentQuery]}:{missingRecent:true};
    // Keep original title casing and accents; no guessing, local paths or command chains.
    if(play){
        if(q.length>0&&q.length<=300&&!/^(?:local(?:-playlist)?\s*:|>|,|\/|el volumen\b|volumen\b|la musica\b|musica\b|una cancion\b|algo\b|esa\b|esta\b|la misma\b|en loop\b)/i.test(q)&&!/\b(?:y (?:pon|reproduce|baja|sube|cambia|ajusta|pausa|salta|deten|repite)|como funciona)\b/i.test(q)){
            // A play request without a music keyword must name a track or artist, or contain a supported URL.
            if(/^(?:ponme|reproduce(?:me)?|play)\b/.test(t)||/\b(?:cancion|tema|pista|de)\b/.test(t)||/^https:\/\//i.test(q))return {command:'play',args:[q]};
        }
    }
    return null;
}
function validateCall(response,recentQuery){
    const calls=response?.functionCalls ?? response?.candidates?.[0]?.content?.parts?.filter(p=>p.functionCall).map(p=>p.functionCall);
    if(!Array.isArray(calls)||calls.length!==1)return null;
    const call=calls[0], a=call?.args;
    if(call?.name!=='music_action'||!a||typeof a!=='object'||Array.isArray(a)||!ACTIONS.includes(a.action))return null;
    const keys=Object.keys(a);
    if(a.action==='no_action')return keys.length===1?{conversational:true}:null;
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
module.exports={declaration,isMusicCandidate,isMusicCandidateV2,localMusicIntent,routeLocal,explicitControl,safeProposal,validateCall,MusicApprovals};
