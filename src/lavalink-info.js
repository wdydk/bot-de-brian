'use strict';
// Read-only connection probe. It never loads, plays, or modifies tracks.
async function lavalinkInfo({env=process.env,request=fetch}={}) {
    const host=String(env.LAVALINK_HOST||'').trim(),password=env.LAVALINK_PASSWORD;
    const port=Number(env.LAVALINK_PORT||2333);
    if(!host||!password)return {status:'missing'};
    if(!/^[a-z0-9.-]+$/i.test(host)||!Number.isInteger(port)||port<1||port>65535)return {status:'config'};
    try {
        const origin=new URL((env.LAVALINK_SECURE==='true'?'https':'http')+'://'+host+':'+port);
        const response=await request(new URL('/v4/info',origin),{headers:{Authorization:password,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
        if(!response.ok){await response.body?.cancel();return {status:response.status===401||response.status===403?'auth':'http',code:response.status};}
        const data=await response.json();
        if(!data||!Array.isArray(data.sourceManagers)||!Array.isArray(data.plugins))return {status:'invalid'};
        const safe=v=>String(v||'').replace(/[^a-zA-Z0-9._+ -]/g,'').slice(0,80);
        return {status:'ok',version:safe(data.version?.semver),sources:data.sourceManagers.slice(0,30).map(safe).filter(Boolean),plugins:data.plugins.slice(0,20).map(p=>safe(p?.name)+' '+safe(p?.version))};
    } catch {return {status:'network'};}
}
function formatLavalinkInfo(result){
    const errors={missing:'Variables no configuradas',config:'Host o puerto inválido',auth:'Contraseña rechazada',http:'Respuesta HTTP '+(result.code||''),invalid:'Respuesta incompatible con Lavalink v4',network:'No se pudo alcanzar el servidor en 5 s'};
    if(result.status!=='ok')return 'Lavalink: '+(errors[result.status]||'No disponible');
    return ['Lavalink: conectado por API REST', 'Versión: '+(result.version||'desconocida'),'Fuentes: '+(result.sources.join(', ')||'ninguna'),'Plugins: '+(result.plugins.join(', ')||'ninguno'),'Nota: esta prueba no inicia audio ni verifica permisos de retransmisión.'].join('\n').slice(0,950);
}
module.exports={lavalinkInfo,formatLavalinkInfo};
