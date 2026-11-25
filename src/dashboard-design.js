'use strict';
const { UserError }=require('./core');
const presets=['default','lavender','mint','pink','ocean'];
function design(cfg){return {accent:'default',theme:'auto',banner:'',compact:false,revision:0,...cfg.dashboardDesign};}
function validateDesign(input){
    if(!presets.includes(input.accent)||!['auto','dark','light'].includes(input.theme))throw new UserError('Elige un tema y color disponibles.');
    const banner=String(input.banner||'').trim();
    if(banner){
        let u;try{u=new URL(banner);}catch{throw new UserError('Usa una URL HTTPS de imagen de Discord.');}
        if(u.origin!=='https://cdn.discordapp.com'||u.username||u.password||!/^\/(?:attachments|banners|icons)\/[a-zA-Z0-9_./%-]+$/.test(u.pathname)||banner.length>1000)throw new UserError('Usa una imagen del CDN de Discord (HTTPS).');
    }
    return {accent:input.accent,theme:input.theme,banner,compact:Boolean(input.compact)};
}
function simulateCustom(item,prefix='>'){
    return item.type==='timeout'
        ? {command:prefix+item.name+' @usuario motivo',result:'Simulación: timeout de '+item.minutes+' minutos. Al ejecutar en Discord se comprobarán permisos, rango y motivo. Ninguna sanción aplicada.'}
        : {command:prefix+item.name,result:item.text};
}
module.exports={design,validateDesign,simulateCustom,presets};
