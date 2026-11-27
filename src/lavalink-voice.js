'use strict';
const WebSocket = require('ws');
const { UserError } = require('./core');
const { setTimeout: sleep } = require('node:timers/promises');
const TEST_PATH='/music/test-tone.wav';
function config(env=process.env) {
    const host=String(env.LAVALINK_HOST||'').trim(), password=env.LAVALINK_PASSWORD;
    const port=Number(env.LAVALINK_PORT||2333);
    if(!host||!password||!/^[a-z0-9.-]+$/i.test(host)||!Number.isInteger(port)||port<1||port>65535)throw new UserError('Lavalink no está configurado. Usa >musicdiag.');
    return {origin:new URL((env.LAVALINK_SECURE==='true'?'https':'http')+'://'+host+':'+port),password};
}
function httpsUrl(value) {
    try { const u=new URL(value); if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash)return u.href; }catch{}
    return null;
}
// Exact URLs supplied by the operator only, after checking rights and redirect safety.
// Never pass arbitrary Discord user URLs, Spotify identifiers or search prefixes to Lavalink.
function approvedUrl(input,env=process.env) {
    const url=httpsUrl(String(input||'').trim()); if(!url)return null;
    return String(env.LAVALINK_AUTHORIZED_URLS||'').split(/\s*,\s*/).some(v=>v&&httpsUrl(v)===url)?url:null;
}
function testUrl(env=process.env) {
    const base=httpsUrl(env.WEB_BASE_URL);
    if(!base||env.WEB_ENABLED!=='true')throw new UserError('La prueba Lavalink requiere el panel HTTPS de Timmy.');
    return new URL(TEST_PATH,base).href;
}
function toneWav() {
    const samples=48000*5, pcm=Buffer.alloc(samples*2), head=Buffer.alloc(44);
    for(let i=0;i<samples;i++)pcm.writeInt16LE(Math.round(2200*Math.sin(2*Math.PI*440*i/48000)*Math.min(1,i/2400,(samples-i)/2400)),i*2);
    head.write('RIFF');head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);
    head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);
    head.writeUInt32LE(48000,24);head.writeUInt32LE(96000,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);
    head.write('data',36);head.writeUInt32LE(pcm.length,40);
    return Buffer.concat([head,pcm]);
}
class LavaApi {
    constructor({env=process.env,request=fetch}={}) { Object.assign(this,config(env));this.request=request; }
    async call(path,method='GET',body) {
        try {
            const response=await this.request(new URL(path,this.origin),{method,headers:{Authorization:this.password,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(8000)});
            if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status);}
            return response.status===204?null:await response.json();
        } catch {throw new UserError('Lavalink no respondió correctamente. Consulta >musicdiag.');}
    }
    async load(url,{test=false}={}) {
        const data=await this.call('/v4/loadtracks?identifier='+encodeURIComponent(url));
        const t=data?.loadType==='track'?data.data:null,i=t?.info;
        if(!t||typeof t.encoded!=='string'||t.encoded.length>65536||i?.sourceName!=='http'||(!test&&(i.isStream||!Number.isFinite(i.length)||i.length<=0||i.length>1800000)))throw new UserError('Lavalink no obtuvo una pista HTTP completa y compatible.');
        return {lavaEncoded:t.encoded,lavaTest:test,title:test?'Tono de prueba Lavalink':String(i.title||'Audio autorizado').slice(0,200),duration:test?5:i.length/1000,url,artist:test?'Timmy':String(i.author||'').slice(0,100)};
    }
}
class LavaVoice {
    constructor({api,guild,voiceId,userId,onEvent,onLost,Socket=WebSocket}) {
        Object.assign(this,{api,guild,voiceId,userId,onEvent,onLost,Socket});this.closed=false;this.state={status:'connecting'};
    }
    async wait(predicate,ms) {
        const end=Date.now()+ms;
        while(!this.closed&&Date.now()<end){if(predicate())return;await sleep(50);}
        throw new UserError('Lavalink no confirmó la conexión o el inicio a tiempo.');
    }
    async connect() {
        const url=new URL('/v4/websocket',this.api.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
        this.ws=new this.Socket(url,{headers:{Authorization:this.api.password,'User-Id':this.userId,'Client-Name':'TimmyMax/5.0'},handshakeTimeout:8000,maxPayload:1024*1024,followRedirects:false});
        this.ws.on('error',()=>this.lost());
        this.ws.on('close',()=>this.lost());
        this.ws.on('message',raw=>{try{this.message(JSON.parse(String(raw)));}catch{}});
        try {
            await this.wait(()=>this.sessionId,10000);
            this.adapter=this.guild.voiceAdapterCreator({
                onVoiceStateUpdate:p=>{
                    if(p.user_id!==this.userId)return;
                    if(p.channel_id!==this.voiceId){if(this.voiceSession)this.lost();return;}
                    if(this.voiceSession&&this.voiceSession!==p.session_id){this.lost();return;}
                    this.voiceSession=p.session_id;
                },
                onVoiceServerUpdate:p=>{
                    if(!p.endpoint||!p.token){if(this.voiceServer)this.lost();return;}
                    if(this.voiceServer&&(this.voiceServer.token!==p.token||this.voiceServer.endpoint!==p.endpoint)){this.lost();return;}
                    this.voiceServer={endpoint:p.endpoint,token:p.token};
                },
                destroy:()=>this.lost()
            });
            if(!this.sendVoice(this.voiceId))throw new UserError('Discord no aceptó la conexión de voz.');
            await this.wait(()=>this.voiceSession&&this.voiceServer,12000);
            const result=await this.patch({voice:{...this.voiceServer,sessionId:this.voiceSession,channelId:this.voiceId},volume:65});
            if(result?.state?.connected)this.connected=true;
            await this.wait(()=>this.connected,15000);
            this.state.status='ready';
            return this;
        }catch(e){this.destroy();throw e;}
    }
    sendVoice(channelId) {return this.adapter?.sendPayload({op:4,d:{guild_id:this.guild.id,channel_id:channelId,self_mute:false,self_deaf:true}});}
    message(event) {
        if(this.closed)return;
        if(event.op==='ready'&&typeof event.sessionId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(event.sessionId)){this.sessionId=event.sessionId;return;}
        if(event.guildId!==this.guild.id)return;
        if(event.op==='playerUpdate'){this.connected=event.state?.connected===true;return;}
        if(event.op!=='event')return;
        if(event.type==='WebSocketClosedEvent'){this.lost();return;}
        const token=event.track?.userData?.timmyToken;
        if(!token||token!==this.token)return;
        if(event.type==='TrackStartEvent')this.started=true;
        if(event.type==='TrackExceptionEvent'||event.type==='TrackStuckEvent'||(event.type==='TrackEndEvent'&&event.reason==='loadFailed')){
            this.failed=true;this.onEvent?.(token,'error',new Error('Lavalink no pudo reproducir la pista HTTP.'));
        }else if(event.type==='TrackEndEvent'&&event.reason==='finished')this.onEvent?.(token,'end');
    }
    path(){return '/v4/sessions/'+encodeURIComponent(this.sessionId)+'/players/'+encodeURIComponent(this.guild.id);}
    patch(body){if(this.closed||!this.sessionId)throw new UserError('La sesión Lavalink ya no está conectada.');return this.api.call(this.path(),'PATCH',body);}
    async play(track,token,volume) {
        this.token=token;this.started=false;this.failed=false;
        await this.patch({track:{encoded:track.lavaEncoded,userData:{timmyToken:token}},paused:false,volume:Math.round(volume*100),...(track.lavaTest?{endTime:5000}:{})});
        await this.wait(()=>this.started||this.failed,15000);
        if(this.failed)throw new UserError('Lavalink rechazó el audio.');
    }
    async stop(){this.token=null;if(!this.closed)await this.patch({track:{encoded:null}});}
    lost(){if(this.closed)return;this.destroy();this.onLost?.();}
    destroy(){
        if(this.closed)return;
        this.closed=true;this.state.status='destroyed';this.token=null;
        try{this.sendVoice(null);}catch{}
        try{this.adapter?.destroy();}catch{}
        if(this.sessionId)void this.api.call(this.path(),'DELETE').catch(()=>{});
        try{this.ws?.terminate();}catch{}
    }
}
module.exports={LavaApi,LavaVoice,approvedUrl,testUrl,toneWav,TEST_PATH};
