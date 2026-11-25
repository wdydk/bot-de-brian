'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {UserError}=require('./core');
const exec=promisify(execFile);
const MB=1024*1024, AUDIO_MAX=25*MB, COVER_MAX=3*MB, QUOTA=1024*MB;
const idOK=x=>typeof x==='string'&&/^[a-z0-9_-]{1,40}$/.test(x);
const managedId=x=>typeof x==='string'&&/^w-[a-f0-9]{32}$/.test(x);
const formats=new Set(['mp3','wav','flac','ogg']);
function field(value,max,required=true){
    const s=String(value??'').trim();
    if((required&&!s)||s.length>max||/[\u0000-\u001f\u007f]/.test(s))throw new UserError('Revisa el título, artista o declaración de derechos.');
    return s;
}
function metadata(input){return {title:field(input.title,150),artist:field(input.artist,100,false),rights:field(input.rights,300)};}
async function isBotOwner(client,userId){
    if(!/^\d{17,20}$/.test(userId||'')||!client?.application?.fetch)return false;
    try{
        const app=await client.application.fetch();
        const owner=app?.owner;
        // Discord returns a User or a Team. Only the team owner, never all team members.
        return Boolean(owner && (owner.ownerId||owner.id)===userId);
    }catch{return false;}
}
async function receive(req,file,limit){
    const declared=req.headers?.['content-length'];
    if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw new UserError('Archivo demasiado grande.');
    const handle=await fs.promises.open(file,'wx',0o600);
    let size=0;
    try{
        for await(const chunk of req){
            size+=chunk.length;
            if(size>limit)throw new UserError('Archivo demasiado grande.');
            await handle.writeFile(chunk);
        }
        if(!size)throw new UserError('Archivo vacío.');
        await handle.sync();
        return size;
    }finally{await handle.close();}
}
async function probe(file,format){
    try{
        const {stdout}=await exec(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-f',format,'-i',file,'-show_entries','format=duration:stream=codec_type','-of','json'],{timeout:15000,maxBuffer:65536,windowsHide:true});
        const info=JSON.parse(stdout),duration=Number(info.format?.duration);
        if(!info.streams?.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>1800)throw Error();
        return Math.ceil(duration);
    }catch{throw new UserError('Audio inválido, duración desconocida o superior a 30 minutos. Revisa también FFprobe en el hosting.');}
}
async function makeCover(input,output){
    const b=Buffer.alloc(12), fd=fs.openSync(input,'r');
    try{fs.readSync(fd,b,0,12,0);}finally{fs.closeSync(fd);}
    const hex=b.toString('hex');
    const format=hex.startsWith('89504e470d0a1a0a')?'png_pipe':hex.startsWith('ffd8ff')?'jpeg_pipe':/^52494646.{8}57454250/.test(hex)?'webp_pipe':null;
    if(!format)throw new UserError('Usa una portada PNG, JPEG o WebP.');
    try{
        await exec(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-max_pixels','16000000','-f',format,'-i',input,'-map','0:v:0','-frames:v','1','-vf','scale=512:512:force_original_aspect_ratio=decrease','-map_metadata','-1','-c:v','mjpeg','-f','image2','-update','1',output],{timeout:15000,maxBuffer:65536,windowsHide:true});
        if(!fs.statSync(output).size||fs.statSync(output).size>COVER_MAX)throw Error();
    }catch{throw new UserError('No pude convertir la portada a una imagen segura.');}
}
class ManagedLibrary{
    constructor(directory,{probeAudio=probe,convertCover=makeCover}={}){
        this.parent=directory?path.join(directory,'music-library'):null;
        this.probeAudio=probeAudio;this.convertCover=convertCover;this.busy=false;
    }
    root(create=false){
        if(!this.parent)throw new UserError('No hay almacenamiento para música.');
        if(create)fs.mkdirSync(this.parent,{recursive:true,mode:0o700});
        const parent=fs.realpathSync(this.parent);
        if(parent!==path.join(fs.realpathSync(path.dirname(this.parent)),'music-library'))throw new UserError('Ruta de biblioteca no válida.');
        const root=path.join(parent,'web-managed');
        if(create)fs.mkdirSync(root,{recursive:true,mode:0o700});
        if(fs.realpathSync(root)!==root||!fs.lstatSync(root).isDirectory())throw new UserError('Ruta de biblioteca no válida.');
        return root;
    }
    read(create=false){
        if(!create&&(!this.parent||!fs.existsSync(path.join(this.parent,'web-managed'))))return {version:1,revision:0,tracks:[],playlists:[]};
        const root=this.root(create),file=path.join(root,'index.json');
        if(!fs.existsSync(file)){
            if(fs.readdirSync(root).some(n=>!n.startsWith('.tmp-')))throw new UserError('Falta el catálogo musical; restaura la copia antes de escribir.');
            return {version:1,revision:0,tracks:[],playlists:[]};
        }
        if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>512*1024)throw new UserError('Catálogo musical inválido.');
        let d;try{d=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new UserError('Catálogo musical inválido. No se sobrescribió.');}
        if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||!Array.isArray(d.tracks)||d.tracks.length>200||!Array.isArray(d.playlists)||d.playlists.length>50||
           d.tracks.some(t=>!t||!managedId(t.id)||!formats.has(t.format)||typeof t.title!=='string'||typeof t.artist!=='string'||typeof t.rights!=='string'||typeof t.deleted!=='boolean'||!(t.cover===null||/^c-[a-f0-9]{32}\.jpg$/.test(t.cover)))||
           new Set(d.tracks.map(t=>t.id)).size!==d.tracks.length||
           d.playlists.some(p=>!p||!managedId(p.id)||typeof p.title!=='string'||!Array.isArray(p.tracks)||p.tracks.length>30||p.tracks.some(x=>!idOK(x)))||new Set(d.playlists.map(p=>p.id)).size!==d.playlists.length)throw new UserError('Catálogo musical inválido. No se sobrescribió.');
        return d;
    }
    save(d){
        const root=this.root(true),file=path.join(root,'index.json'),tmp=path.join(root,'.tmp-'+randomUUID());
        d.revision++;
        const fd=fs.openSync(tmp,'wx',0o600);
        try{fs.writeFileSync(fd,JSON.stringify(d,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(tmp,file);}
        catch(e){try{fs.closeSync(fd);}catch{};throw e;}
        finally{fs.rmSync(tmp,{force:true});}
        // Flush directory entry for durability on Railway's Linux volume.
        try{const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{}
    }
    usage(root){return fs.readdirSync(root).reduce((n,name)=>{const s=fs.lstatSync(path.join(root,name));return n+(s.isFile()?s.size:0);},0);}
    regular(root,name){
        const file=path.join(root,name);
        try{const s=fs.lstatSync(file);return s.isFile()&&s.size>0&&fs.realpathSync(file)===file?file:null;}catch{return null;}
    }
    list(){
        const d=this.read();if(!d.tracks.length)return [];
        const root=this.root();
        return d.tracks.filter(t=>!t.deleted).flatMap(t=>{
            const file=this.regular(root,t.id+'.'+t.format);
            return file?[{...t,file,managed:true,cover:Boolean(t.cover&&this.regular(root,t.cover))}]:[];
        });
    }
    info(){const d=this.read();return {revision:d.revision,playlists:d.playlists,trash:d.tracks.filter(t=>t.deleted).map(({id,title,artist})=>({id,title,artist})),usage:this.parent&&fs.existsSync(path.join(this.parent,'web-managed'))?this.usage(this.root()):0,quota:QUOTA};}
    cover(id){
        if(!managedId(id))return null;
        const t=this.read().tracks.find(t=>t.id===id&&!t.deleted);
        return t?.cover?this.regular(this.root(),t.cover):null;
    }
    async exclusive(fn){if(this.busy)throw new UserError('Hay una carga en curso. Inténtalo después.');this.busy=true;try{return await fn();}finally{this.busy=false;}}
    async upload(req,input,verify){
        const meta=metadata(input),format=input.format;
        if(!formats.has(format)||input.confirm!=='yes')throw new UserError('Elige MP3, WAV, FLAC u OGG y confirma los derechos de retransmisión.');
        return this.exclusive(async()=>{
            const root=this.root(true),initial=this.read(true);
            if(initial.tracks.length>=200||this.usage(root)+AUDIO_MAX>QUOTA)throw new UserError('Límite de biblioteca alcanzado (200 pistas o 1 GiB).');
            const id='w-'+randomUUID().replace(/-/g,''),tmp=path.join(root,'.tmp-'+id),dest=path.join(root,id+'.'+format);
            try{
                await receive(req,tmp,AUDIO_MAX);
                const duration=await this.probeAudio(tmp,format);
                await verify();
                const d=this.read(true);
                if(d.tracks.length>=200||this.usage(root)>QUOTA)throw new UserError('Límite de biblioteca alcanzado.');
                fs.renameSync(tmp,dest);
                try{d.tracks.push({id,...meta,format,duration,cover:null,deleted:false});this.save(d);}
                catch(e){fs.rmSync(dest,{force:true});throw e;}
                return id;
            }finally{fs.rmSync(tmp,{force:true});}
        });
    }
    async uploadCover(req,id,verify){
        if(!managedId(id))throw new UserError('Pista no válida.');
        return this.exclusive(async()=>{
            const root=this.root(),d=this.read();
            if(!d.tracks.some(t=>t.id===id&&!t.deleted)||this.usage(root)+2*COVER_MAX>QUOTA)throw new UserError('Pista no disponible o almacenamiento lleno.');
            const tmp=path.join(root,'.tmp-'+randomUUID()),out=tmp+'.jpg',name='c-'+randomUUID().replace(/-/g,'')+'.jpg';
            try{
                await receive(req,tmp,COVER_MAX);await this.convertCover(tmp,out);await verify();
                const next=this.read(),t=next.tracks.find(t=>t.id===id&&!t.deleted);
                if(!t)throw new UserError('La pista ya no está disponible.');
                const old=t.cover;fs.renameSync(out,path.join(root,name));t.cover=name;
                try{this.save(next);}catch(e){fs.rmSync(path.join(root,name),{force:true});throw e;}
                if(old&&!next.tracks.some(x=>x.cover===old))fs.rmSync(path.join(root,old),{force:true});
            }finally{fs.rmSync(tmp,{force:true});fs.rmSync(out,{force:true});}
        });
    }
    change(action,input,available){
        if(this.busy)throw new UserError('Hay una carga en curso.');
        const d=this.read(true);
        if(String(d.revision)!==String(input.revision))throw new UserError('La biblioteca cambió. Recarga la página.');
        if(action==='edit'||action==='delete'||action==='restore'){
            if(!managedId(input.id))throw new UserError('Pista no válida.');
            const t=d.tracks.find(t=>t.id===input.id);
            if(!t)throw new UserError('Pista no encontrada.');
            if(action==='edit'){if(t.deleted)throw new UserError('Restaura la pista primero.');Object.assign(t,metadata(input));}
            if(action==='delete'){if(input.confirm!=='yes'||t.deleted)throw new UserError('Confirma mover a la papelera.');t.deleted=true;for(const p of d.playlists)p.tracks=p.tracks.filter(id=>id!==t.id);}
            if(action==='restore'){if(!t.deleted)throw new UserError('La pista no está en la papelera.');t.deleted=false;}
        }else if(action==='playlist-save'){
            const tracks=String(input.tracks||'').split(/[\s,]+/).filter(Boolean);
            if(!tracks.length||tracks.length>30||new Set(tracks).size!==tracks.length||tracks.some(id=>!idOK(id)||!available.has(id)))throw new UserError('Selecciona entre 1 y 30 pistas disponibles, sin repetir.');
            const title=field(input.title,100);
            if(input.id){
                const p=d.playlists.find(p=>p.id===input.id);if(!p)throw new UserError('Playlist no encontrada.');Object.assign(p,{title,tracks});
            }else{if(d.playlists.length>=50)throw new UserError('Máximo 50 playlists.');d.playlists.push({id:'w-'+randomUUID().replace(/-/g,''),title,tracks});}
        }else if(action==='playlist-delete'){
            if(input.confirm!=='yes'||!d.playlists.some(p=>p.id===input.id))throw new UserError('Confirma eliminar la playlist.');
            d.playlists=d.playlists.filter(p=>p.id!==input.id);
        }else throw new UserError('Acción inválida.');
        this.save(d);
    }
}
module.exports={ManagedLibrary,isBotOwner,metadata,AUDIO_MAX,COVER_MAX,probe};
