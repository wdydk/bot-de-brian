'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {UserError}=require('./core');
const {ManagedLibrary}=require('./music-library');
const formats={mp3:'mp3',wav:'wav',flac:'flac',ogg:'ogg'};
const labels={
    RATE_LIMIT:'YouTube limitó las solicitudes (HTTP 429). Se suspenden nuevas consultas durante 15 minutos.',
    BOT_CHECK:'YouTube exige verificación de acceso. Se suspenden nuevas consultas durante 15 minutos.',
    FORBIDDEN:'La fuente rechazó el acceso (HTTP 403). No se intentará eludir la restricción.',
    DEPENDENCY:'Falta FFmpeg o yt-dlp. Revisa el despliegue.',
    TLS:'Falló la verificación TLS. No desactives la validación de certificados.',
    UNAVAILABLE:'La pista no está disponible para reproducción.',
    TIMEOUT:'Tiempo de espera de audio agotado.',
    OTHER:'No llegaron datos de audio. Revisa el diagnóstico.',
    COOLDOWN:'YouTube está en pausa temporal por una restricción previa. Usa la biblioteca autorizada o inténtalo después.'
};
function classify(error){
    if(Object.hasOwn(labels,error?.musicCode))return error.musicCode;
    const text=String(error?.message||error||'');
    if(/\b429\b|too many requests/i.test(text))return 'RATE_LIMIT';
    if(/sign in|not a bot|confirm your age|visitor data|PO Token|cookies/i.test(text))return 'BOT_CHECK';
    if(/\b403\b/i.test(text))return 'FORBIDDEN';
    if(/ENOENT/.test(text))return 'DEPENDENCY';
    if(/CERTIFICATE_VERIFY_FAILED|certificate verify failed/i.test(text))return 'TLS';
    if(/private|unavailable|removed|copyright|not available/i.test(text))return 'UNAVAILABLE';
    if(/timeout|tiempo de espera|timed out/i.test(text))return 'TIMEOUT';
    return 'OTHER';
}
function unavailableReason(error){
    const allowed=['REGION_RESTRICTED','PRIVATE_VIDEO','REMOVED_VIDEO','MEMBERS_ONLY','AGE_RESTRICTED','NO_FORMAT','COPYRIGHT_RESTRICTION','GENERIC_UNAVAILABLE'];
    if(allowed.includes(error?.musicDetail))return error.musicDetail;
    const text=String(error?.message||error||'');
    if(/(?:not available|blocked|unavailable) in (?:your|this) (?:country|region)|geo.?restrict/i.test(text))return 'REGION_RESTRICTED';
    if(/private video|video is private/i.test(text))return 'PRIVATE_VIDEO';
    if(/removed|deleted|no longer available/i.test(text))return 'REMOVED_VIDEO';
    if(/members.only|join this channel|paid content/i.test(text))return 'MEMBERS_ONLY';
    if(/age.restrict|confirm your age/i.test(text))return 'AGE_RESTRICTED';
    if(/requested format is not available|no (?:video |audio )?formats|no suitable formats/i.test(text))return 'NO_FORMAT';
    if(/copyright/i.test(text))return 'COPYRIGHT_RESTRICTION';
    return 'GENERIC_UNAVAILABLE';
}
function message(code){return labels[code]||labels.OTHER;}
function typed(code){const e=new UserError(message(code));e.musicCode=code;return e;}
class MusicSafety{
    constructor(clock=Date.now){this.clock=clock;this.until=0;this.globalCode=null;this.guilds=new Map();}
    blocked(){return this.clock()<this.until;}
    check(){if(this.blocked())throw typed('COOLDOWN');}
    state(id){
        if(!this.guilds.has(id)){
            if(this.guilds.size>=2000)this.guilds.delete(this.guilds.keys().next().value);
            this.guilds.set(id,{last:null,lastDetail:null,at:0,consecutive:0,lastNotice:null,suppressed:0});
        }return this.guilds.get(id);
    }
    record(id,error,remote=true){
        const code=classify(error),now=this.clock(),s=this.state(id);
        if(remote&&['RATE_LIMIT','BOT_CHECK'].includes(code)){
            this.until=Math.max(this.until,now+15*60000);this.globalCode=code;
        }
        s.last=code;s.lastDetail=code==='UNAVAILABLE'?unavailableReason(error):null;s.at=now;s.consecutive++;
        const notice=s.lastNotice===null||now-s.lastNotice>=60000;
        if(notice)s.lastNotice=now;else s.suppressed++;
        return {code,notice,stop:s.consecutive>=3||remote&&this.blocked()};
    }
    success(id){this.state(id).consecutive=0;}
    snapshot(id){const s=this.guilds.get(id);return {last:s?.last||null,lastDetail:s?.lastDetail||null,at:s?.at||0,consecutive:s?.consecutive||0,suppressed:s?.suppressed||0,cooldownSeconds:Math.max(0,Math.ceil((this.until-this.clock())/1000)),globalCode:this.blocked()?this.globalCode:null};}
}
// Match only unambiguous, exact names in the operator-authorized library.
function localTrackMatch(entries,query){
    const raw=String(query||'').trim();
    if(!raw||raw.length>300||/^[\w+.-]+:|[\/\\\x00-\x1f]/.test(raw))return null;
    const normalize=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
    const q=normalize(raw);
    const matches=entries.filter(t=>{
        const title=normalize(t.title),artist=normalize(t.artist);
        return title && (q===title || artist && [title+' '+artist,artist+' '+title,title+' - '+artist,artist+' - '+title,title+' de '+artist].includes(q));
    });
    return matches.length===1?matches[0].id:null;
}
// Operator-managed, finite local media only. No uploads, arbitrary URLs or paths.
class AudioLibrary{
    constructor(directory){this.root=directory?path.join(directory,'music-library'):null;this.managed=new ManagedLibrary(directory);}
    list(){const manual=this.manualList();let web=[];try{web=this.managed.list();}catch{}return [...manual,...web.filter(t=>!manual.some(m=>m.id===t.id))];}
    manualList(){
        if(!this.root)return [];
        try{
            const root=fs.realpathSync(this.root);
            if(root!==path.join(fs.realpathSync(path.dirname(this.root)),'music-library'))return [];
            const manifest=path.join(root,'manifest.json');
            if(!fs.lstatSync(manifest).isFile()||fs.statSync(manifest).size>128*1024)return [];
            const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
            if(!Array.isArray(data)||data.length>200)return [];
            const seen=new Set(),out=[];
            for(const e of data){
                if(!e||typeof e.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(e.id)||seen.has(e.id)||typeof e.title!=='string'||!e.title.trim()||e.title.length>150||typeof e.rights!=='string'||!e.rights.trim()||e.rights.length>300||typeof e.file!=='string'||!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,120}\.(mp3|wav|flac|ogg)$/.test(e.file))continue;
                const file=path.join(root,e.file);
                try{
                    const stat=fs.lstatSync(file);
                    if(!stat.isFile()||stat.size<1||stat.size>100*1024*1024||fs.realpathSync(file)!==file)continue;
                    seen.add(e.id);out.push({id:e.id,title:e.title,rights:e.rights,file,format:formats[path.extname(file).slice(1)]});
                }catch{}
            }return out;
        }catch{return [];}
    }
    track(id){const e=this.list().find(x=>x.id===id);if(!e)throw new UserError('Audio no disponible. Consulta la biblioteca autorizada en el panel.');return {local:true,localId:e.id,title:e.title,spotify:false};}
    file(id){const e=this.list().find(x=>x.id===id);if(!e)throw new UserError('El archivo autorizado ya no está disponible.');return e;}
}
module.exports={classify,unavailableReason,message,typed,MusicSafety,AudioLibrary,localTrackMatch};
