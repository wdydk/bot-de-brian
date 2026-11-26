'use strict';
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus,
    NoSubscriberBehavior, StreamType, entersState, VoiceConnectionStatus,
    generateDependencyReport
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { MusicCatalog } = require('./music-catalog');
const { TrackCache } = require('./music-track-cache');
const { RemoteLookupGate } = require('./music-lookup-gate');
const { parseControl, assertCurrentPanel, nextVolume, nextLoop, playerPayload } = require('./music-player');
const { UserError, Serial, cut } = require('./core');
const { P } = require('./permissions');
const { classify,unavailableReason,message:audioMessage,typed,MusicSafety,AudioLibrary,localTrackMatch,errorSource,sourced }=require('./music-safety');

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const BASE = ['--ignore-config', '--no-playlist', '--no-colors', '--socket-timeout', '15',
    '--retries', '0', '--extractor-retries', '0', '--js-runtimes', 'node'];
function requestStatus(session,requestId) {
    if (!session || session.destroyed) return 'failed';
    if (session.current?.track?.requestId === requestId) return 'started';
    if (session.queue.some(track => track.requestId === requestId)) return 'queued';
    return 'failed';
}
function musicQuery(input) {
    const text = String(input || '').trim();
    if (!text || text.length > 300) throw new UserError('Escribe un nombre o enlace de hasta 300 caracteres.');
    if (!/^https?:\/\//i.test(text)) {
        if (/^[\w+.-]+:/.test(text)) throw new UserError('Usa un nombre de canción o un enlace HTTPS de YouTube/Spotify.');
        return { source: `ytsearch1:${text}`, spotify: false };
    }
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new UserError('Solo se aceptan enlaces HTTPS normales.');
    }
    const playlist = url.pathname.match(/^\/(?:intl-[\w-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/);
    if (url.hostname === 'open.spotify.com' && playlist) return { playlist:playlist[1],spotify:true };
    if (url.hostname === 'open.spotify.com' && /^\/(?:intl-[\w-]+\/)?track\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
        return { source: url.href, spotify: true };
    }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
        throw new UserError('Usa el nombre de la canción o el enlace completo de una canción o playlist de YouTube o Spotify.');
    }
    const listId = url.searchParams.get('list');
    if (listId && /^[\w-]{5,100}$/.test(listId) && (url.pathname === '/playlist' || url.pathname === '/watch' || url.hostname === 'youtu.be')) return { playlist:listId,spotify:false };
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) :
        url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
    if (!/^[\w-]{11}$/.test(id || '')) throw new UserError('Usa un enlace de video de YouTube o de playlist con una lista válida.');
    return { source: `https://www.youtube.com/watch?v=${id}`, spotify: false };
}
function processResult(executable, args, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '', settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) { child.kill('SIGKILL'); reject(error); } else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('Tiempo de espera agotado')), timeout);
        child.on('error', error => finish(error));
        child.stdout.on('data', data => {
            out += data;
            if (out.length > 4 * 1024 * 1024) finish(new Error('Respuesta demasiado grande'));
        });
        child.stderr.on('data', data => { err = (err + data).slice(-6000); });
        child.on('close', code => finish(code === 0 ? null : new Error(err || `Proceso terminó con código ${code}`), out));
    });
}
function explainAudioError(error) { return audioMessage(classify(error)); }
async function resolveTrack(query, catalog) {
    let source = musicQuery(query);
    let spotify = false;
    if (source.spotify) {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(source.source)}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new UserError('No pude leer esa canción de Spotify. Usa título y artista.');
        const data = await response.json();
        if (!data.title) throw new UserError('Spotify no devolvió el título. Usa título y artista.');
        source = { source: `ytsearch1:${String(data.title).slice(0, 250)} audio` };
        spotify = true;
    }
    if (catalog?.env.YOUTUBE_API_KEY && source.source.startsWith('ytsearch1:')) source.source = await catalog.video(source.source.slice('ytsearch1:'.length));
    let info;
    try {
        info = JSON.parse(await processResult(YTDLP, [...BASE, '--dump-single-json', '--skip-download', '--', source.source], 40000));
    } catch (error) {
        const code=classify(error), safe=sourced(typed(code),'YTDLP_METADATA');
        if(code==='UNAVAILABLE')safe.musicDetail=unavailableReason(error);
        console.warn('[YT-DLP SEARCH]',code,safe.musicDetail||'');
        throw safe;
    }
    const video = info.entries ? info.entries.find(Boolean) : info;
    if (!video?.id || !/^[\w-]{11}$/.test(video.id)) throw new UserError('No encontré un video reproducible.');
    if (video.is_live || video.live_status === 'is_live' || !Number.isFinite(video.duration) || video.duration > 1800) {
        throw new UserError('Usa una canción de hasta 30 minutos; esta versión no admite directos.');
    }
    return { title: cut(video.title, 200), url: `https://www.youtube.com/watch?v=${video.id}`,
        duration: video.duration, thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`, spotify };
}
function toneBuffer(seconds = 3) {
    const samples = seconds * 48000;
    const buffer = Buffer.alloc(samples * 4);
    for (let i = 0; i < samples; i++) {
        const fade = Math.min(1, i / 2400, (samples - i) / 2400);
        const value = Math.round(Math.sin(2 * Math.PI * 440 * i / 48000) * 2200 * fade);
        buffer.writeInt16LE(value, i * 4); buffer.writeInt16LE(value, i * 4 + 2);
    }
    return buffer;
}
class Music {
    constructor(client, store) {
        this.client = client; this.store = store;
        this.sessions = new Map(); this.serial = new Serial();
        this.searches = new Set(); this.catalog = new MusicCatalog(store);
        this.safety=new MusicSafety();this.library=new AudioLibrary(store.directory);
        this.trackCache = new TrackCache();
        this.lookupGate = new RemoteLookupGate();
    }
    lookupTrack(query) {
        const source = musicQuery(query);
        if (source.playlist) throw new UserError('Selecciona una canción individual.');
        const key = source.spotify ? 'spotify:' + new URL(source.source).pathname : source.source;
        return this.trackCache.get(key, () => this.remoteLookup(() => resolveTrack(query, this.catalog)), () => this.safety.check());
    }
    remoteLookup(task) {
        return this.lookupGate.run(async () => {
            try{return await task();}
            catch(error){this.safety.observeRestriction(error);throw error;}
        }, () => this.safety.check());
    }
    async access(ctx) {
        if (!ctx.guild) throw new UserError('La música se usa dentro de un servidor.');
        const member = await ctx.guild.members.fetch({user:ctx.user.id,force:true});
        const voice = member.voice.channel;
        const pinned=this.store.guild(ctx.guild.id).officialRuntime?.voice;
        if(pinned&&pinned.owner!==ctx.user.id)throw new UserError('La radio oficial está reservada al propietario mientras esté activa.');
        if (!voice || voice.type !== 2) throw new UserError('Entra en un canal de voz normal (no escenario).');
        const me = await ctx.guild.members.fetchMe();
        const permissions = voice.permissionsFor(me);
        if (!permissions?.has([P.ViewChannel, P.Connect, P.Speak])) throw new UserError('Necesito Ver canal, Conectar y Hablar en ese canal.');
        if (me.voice.serverMute) throw new UserError('El servidor tiene al bot silenciado. Quita el silencio del bot.');
        const active = this.sessions.get(ctx.guild.id);
        if (active && active.voiceId !== voice.id) throw new UserError('Debes estar en el mismo canal de voz que el bot.');
        return voice;
    }
    async control(ctx) {
        await this.access(ctx);
        const role = this.store.guild(ctx.guild.id).djRole;
        const member=await ctx.guild.members.fetch({user:ctx.user.id,force:true});
        if (role && !member.roles.cache.has(role) && !member.permissions.has(P.ManageGuild)) {
            throw new UserError('Los controles están reservados al rol DJ configurado.');
        }
        const session = this.sessions.get(ctx.guild.id);
        if (!session) throw new UserError('No hay una sesión de música. Usa >play o >join.');
        return session;
    }
    async _connect(ctx,officialVoice=null) {
        const voice = officialVoice||await this.access(ctx);
        let session = this.sessions.get(ctx.guild.id);
        if (session) { if(session.voiceId!==voice.id)throw new UserError('Ya hay una sesión en otro canal.');session.text = ctx.channel; return session; }
        const connection = joinVoiceChannel({ channelId: voice.id, guildId: ctx.guild.id,
            adapterCreator: ctx.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
        session = { connection, player, guildId: ctx.guild.id, voiceId: voice.id, text: ctx.channel,
            queue: [], current: null, volume: 0.65, loop: 'off', destroyed: false, idleTimer: null };
        this.sessions.set(ctx.guild.id, session);
        connection.subscribe(player);
        player.on('stateChange', (old, state) => {
            if (state.status === AudioPlayerStatus.Playing && old.status !== AudioPlayerStatus.Playing && session.current?.token === state.resource?.metadata?.token) {
                session.current.lastByte = Date.now();
            }
            if (state.status === AudioPlayerStatus.Idle && old.status !== AudioPlayerStatus.Idle) {
                this._scheduleFinish(session, old.resource?.metadata?.token, 'end');
            }
        });
        player.on('error', error => {
            this._scheduleFinish(session, error.resource?.metadata?.token, 'error', error);
        });
        connection.on('error', error => {
            console.error('[VOICE]', error.message);
            this.serial.run(session.guildId, () => this._destroy(session)).catch(console.error);
        });
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000)
                ]);
                await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            } catch {
                this.serial.run(session.guildId, () => this._destroy(session)).catch(console.error);
            }
        });
        try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); }
        catch { this._destroy(session); throw new UserError('No pude conectar la voz. Revisa permisos y la conexión UDP del hosting.'); }
        this._idleTimer(session);
        return session;
    }
    isPinned(s){return Boolean(s?.officialPinned&&this.store.guild(s.guildId).officialRuntime?.voice?.channel===s.voiceId);}
    async ensureOfficialVoice(guild,cfg){
        return this.serial.run(guild.id,async()=>{
            const live=this.store.guild(guild.id).officialRuntime?.voice;if(!live||live.channel!==cfg.channel||live.owner!==cfg.owner)return;
            const existing=this.sessions.get(guild.id);if(existing&&existing.voiceId!==cfg.channel)return;
            const voice=await guild.channels.fetch(cfg.channel),text=await guild.channels.fetch(cfg.text),me=await guild.members.fetchMe({force:true});
            if(voice?.type!==2||!voice.permissionsFor(me)?.has([P.ViewChannel,P.Connect,P.Speak])||me.voice.serverMute||!text?.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new UserError('Radio sin permisos.');
            if(me.voice.channelId&&me.voice.channelId!==voice.id)return;
            const latest=this.store.guild(guild.id).officialRuntime?.voice;if(!latest||latest.channel!==cfg.channel||latest.owner!==cfg.owner||latest.text!==cfg.text||latest.playlist!==cfg.playlist)return;
            const s=await this._connect({guild,channel:text},voice);s.officialPinned=true;clearTimeout(s.idleTimer);
            if(!cfg.playlist||s.autoPaused||s.current||s.queue.length||Date.now()<(s.autoRetryAt||0))return;
            const p=this.library.managed.info().playlists.find(p=>p.id===cfg.playlist);
            if(!p?.tracks.length)return;
            const requestId=randomUUID();s.loop='off';s.queue=p.tracks.map(id=>({...this.library.track(id),requester:cfg.owner,requestId,officialAuto:true,officialPlaylist:cfg.playlist}));
            await this._start(s);
        });
    }
    _idleTimer(s) {
        clearTimeout(s.idleTimer);
        if(this.isPinned(s))return;
        s.idleTimer = setTimeout(() => {
            this.serial.run(s.guildId, () => { if (!s.current&&!this.isPinned(s)) this._destroy(s); }).catch(console.error);
        }, s.remoteQueueHeld ? 30*60000 : 120000);
        s.idleTimer.unref();
    }
    async refreshPanel(s) {
        const current = s.current;
        if (!current?.panel?.edit) return;
        try { await current.panel.edit(playerPayload(s,current)); }
        catch { /* Deleted panels and lost text permissions must not stop audio. */ }
    }
    async retirePanel(s,current,reason='end') {
        if (!current?.panel?.edit) return;
        const panel = current.panel; current.panel = null;
        try { await panel.edit(playerPayload(s,current,reason)); } catch {}
    }
    _cleanup(current) {
        if (!current || current.stopped) return;
        current.stopped = true;
        clearInterval(current.watchdog);
        for (const child of current.children || []) {
            child.stdout?.unpipe();
            child.kill('SIGKILL');
        }
        current.meter?.destroy();
    }
    _destroy(s) {
        if (!s || s.destroyed) return;
        s.destroyed = true; s.remoteQueueHeld=false; clearTimeout(s.idleTimer);
        void this.retirePanel(s,s.current,'stop');
        this._cleanup(s.current); s.current = null; s.queue = [];
        s.player.stop(true);
        if (s.connection.state.status !== VoiceConnectionStatus.Destroyed) s.connection.destroy();
        if (this.sessions.get(s.guildId) === s) this.sessions.delete(s.guildId);
    }
    _scheduleFinish(s, token, reason, error) {
        const current = s.current;
        if (!token || s.destroyed || current?.token !== token || current.stopped) return;
        // An extractor/decoder failure must take precedence over a simultaneous Idle event.
        if (reason === 'error' && !current.failure) current.failure = error || new Error('Fallo de audio');
        if (current.finishScheduled) return;
        current.finishScheduled = true;
        this.serial.run(s.guildId, () => this._finish(s, token, reason, error)).catch(e => console.warn('[MUSIC FINISH]', e.name));
    }
    async reportFailure(s,error,track){
        if(error?.code==='MUSIC_LOOKUP_BUSY'){
            console.warn('[MUSIC LOOKUP] BUSY');
            await s.text.send({content:'❌ '+error.message,allowedMentions:{parse:[]}}).catch(()=>{});
            return;
        }
        if(track?.officialAuto){s.queue=s.queue.filter(t=>!t.officialAuto);s.autoRetryAt=Date.now()+10*60000;s.loop='off';}
        const remote=!track?.local&&!track?.test;
        const d=this.safety.record(s.guildId,error,remote);
        if(d.stop){
            if(remote&&this.safety.blocked()) {
                if(s.queue.some(t=>!t.local&&!t.test)) s.remoteQueueHeld=true;
            } else { s.queue=[]; s.remoteQueueHeld=false; }
            s.loop='off';
        }
        // Only a bounded diagnostic is emitted; never include stderr, URL, cookies or tokens.
        console.warn('[MUSIC FAILURE]',d.code,errorSource(error)||'UNKNOWN_SOURCE');
        if(d.notice)await s.text.send({content:'❌ '+audioMessage(d.code)+(d.stop?(s.remoteQueueHeld?' Pistas remotas pendientes conservadas; usa >resume cuando termine la restricción.':' Cola afectada detenida para evitar más solicitudes.'):' Los errores repetidos se agrupan.'),allowedMentions:{parse:[]}}).catch(()=>{});
    }
    async _finish(s, token, reason, error) {
        if (s.destroyed || s.current?.token !== token) return;
        const old = s.current;
        if (old.failure) { reason = 'error'; error = old.failure; }
        s.current = null; this._cleanup(old); s.player.stop(true);
        await this.retirePanel(s,old,reason);
        if (reason === 'error') {
            await this.reportFailure(s,error,old.track);
        }
        if (reason === 'end' && !old.track.test) {
            if(old.track.officialAuto){if(this.isPinned(s)&&!s.autoPaused&&this.store.guild(s.guildId).officialRuntime?.voice?.playlist===old.track.officialPlaylist)s.queue.push(old.track);}
            else if (s.loop === 'song') s.queue.unshift(old.track);
            else if (s.loop === 'queue') s.queue.push(old.track);
        } else if (reason === 'skip' && s.loop === 'queue' && !old.track.test) s.queue.push(old.track);
        await this._start(s);
    }
    async _start(s) {
        if (s.current || s.destroyed) return;
        clearTimeout(s.idleTimer);
        // Un fallo de extracción no bloquea ni repite infinitamente la pista.
        while (s.queue.length && !s.destroyed) {
            if(this.safety.blocked() && s.queue.some(t=>!t.local&&!t.test)) { s.remoteQueueHeld=true; s.loop='off'; }
            const index = s.remoteQueueHeld ? s.queue.findIndex(t=>t.local||t.test) : 0;
            if(index<0) break;
            const [track] = s.queue.splice(index,1);
            if (track.page) {
                try {
                    const data = await this.remoteLookup(() => this.catalog.page(track.page,track.requester,track.cursor));
                    s.queue.unshift(...this.pageEntries(track.page,data,track.requester,track.requestId));
                } catch (e) { await this.reportFailure(s,e,track); }
                continue;
            }
            const current = { track, token: randomUUID(), children: [], bytes: 0, lastByte: Date.now(), stopped: false };
            s.current = current;
            try {
                if (track.query) {
                    const mapped = await this.lookupTrack(track.query);
                    Object.assign(track,mapped,{spotify:Boolean(track.spotify || mapped.spotify)});
                    delete track.query;
                }
                await entersState(s.connection, VoiceConnectionStatus.Ready, 15000);
                let stream;
                let failedReject;
                const failed = new Promise((_, reject) => { failedReject = reject; });
                const fail = error => {
                    if (current.stopped) return;
                    this.safety.observeRestriction(error,!track.local&&!track.test);
                    failedReject(error);
                    this._scheduleFinish(s, current.token, 'error', error);
                };
                // Este catch mantiene atendido el rechazo también después de iniciar.
                failed.catch(() => {});
                if (track.test) stream = Readable.from([toneBuffer()]);
                else if(track.local){
                    const entry=this.library.file(track.localId);
                    const ffmpeg=spawn(FFMPEG,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f',entry.format,'-i',entry.file,'-t','1800','-vn','-f','s16le','-ar','48000','-ac','2','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
                    current.children=[ffmpeg];ffmpeg.stderr.resume();ffmpeg.on('error',fail);ffmpeg.stdout.on('error',fail);
                    ffmpeg.on('close',code=>{if(code!==0&&!current.stopped)fail(new Error('Audio local no disponible'));});stream=ffmpeg.stdout;
                } else {
                    this.safety.check();
                    const ytdlp = spawn(YTDLP, [...BASE, '-f', 'bestaudio/best', '-o', '-', '--', track.url],
                        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
                    const ffmpeg = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
                        '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
                        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
                    current.children = [ytdlp, ffmpeg];
                    for (const child of current.children) {
                        let stderr = '';
                        child.stderr.on('data', data => { stderr = (stderr + data).slice(-3000); });
                        const source=child===ytdlp?'YTDLP_AUDIO':'FFMPEG';
                        child.on('error', error=>fail(sourced(error,source)));
                        child.on('close', code => { if (code !== 0 && !current.stopped) fail(sourced(new Error(stderr || `Proceso terminó: ${code}`),source)); });
                        child.stdout.on('error', fail);
                    }
                    ffmpeg.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
                    ytdlp.stdout.pipe(ffmpeg.stdin);
                    stream = ffmpeg.stdout;
                }
                const meter = new Transform({ transform(chunk, encoding, cb) {
                    current.bytes += chunk.length; current.lastByte = Date.now(); cb(null, chunk);
                } });
                current.meter = meter;
                meter.on('error', fail);
                stream.pipe(meter);
                const resource = createAudioResource(meter, { inputType: StreamType.Raw,
                    inlineVolume: true, metadata: { token: current.token } });
                resource.volume.setVolume(s.volume);
                current.resource = resource;
                s.player.play(resource);
                await Promise.race([entersState(s.player, AudioPlayerStatus.Playing, 35000), failed]);
                if (current.failure) throw current.failure;
                if (!current.bytes) throw new Error('No se recibieron bytes de audio');
                if(!track.test)this.safety.success(s.guildId);
                current.watchdog = setInterval(() => {
                    if (s.player.state.status === AudioPlayerStatus.Playing && Date.now() - current.lastByte > 25000) {
                        fail(new Error('La fuente de audio dejó de enviar datos'));
                    }
                }, 5000);
                current.watchdog.unref();
                const embed = new EmbedBuilder().setColor(0x7c83ff).setTitle(track.test ? '🔊 Prueba de voz: tono de 3 segundos' : '🎶 Reproduciendo')
                    .setDescription(track.test ? 'Si oyes el tono, la ruta de voz funciona. Si YouTube falla, revisa la extracción.' : track.local ? track.title : `[${track.title.replace(/[\[\]]/g, '')}](${track.url})`)
                    .setFooter({ text: `Volumen ${Math.round(s.volume * 100)}% • >musicdiag para diagnóstico` });
                if(track.local)embed.addFields({name:'Fuente',value:'Biblioteca autorizada del operador.'});
                if (track.thumbnail) embed.setThumbnail(track.thumbnail);
                if (track.spotify) embed.addFields({ name: 'Fuente', value: 'Resultado aproximado de YouTube buscado a partir de Spotify.' });
                if (!track.officialAuto) {
                    if (track.test) await s.text.send({ embeds: [embed] }).catch(() => {});
                    else {
                        try { current.panel = await s.text.send(playerPayload(s,current)); }
                        catch { /* Missing text permissions do not interrupt audio. */ }
                    }
                }
                return;
            } catch (error) {
                this._cleanup(current); s.current = null; s.player.stop(true);
                await this.retirePanel(s,current,'error');
                await this.reportFailure(s,current.failure || error,track);
                if (s.queue.length) {
                    // Release the voice queue between failed tracks so stop/skip can run.
                    setImmediate(() => this.serial.run(s.guildId, () => this._start(s)).catch(e => console.warn('[MUSIC]', e.name)));
                    return;
                }
            }
        }
        this._idleTimer(s);
    }
    async join(ctx) { return this.serial.run(ctx.guild.id, () => this._connect(ctx)); }
    pageEntries(list, data, user, requestId) {
        const entries = data.tracks.map(t => ({...t, requester:user, requestId}));
        if (data.next) entries.push({ title:'Más canciones de la playlist',page:list,cursor:data.next,requester:user,requestId });
        return entries;
    }
    async play(ctx, query) {
        await this.access(ctx);
        if (this.searches.has(ctx.user.id) || this.searches.size >= 3) throw new UserError('Hay búsquedas en curso. Espera unos segundos.');
        const local=/^local:([a-z0-9_-]{1,40})$/.exec(String(query||'').trim());
        const playlist=/^local-playlist:([a-z0-9_-]{1,40})$/.exec(String(query||'').trim());
        const localId=local?.[1]||(!playlist?localTrackMatch(this.library.list(),query):null);
        const authorized=Boolean(localId||playlist);
        const source=authorized?{local:true}:musicQuery(query),user=ctx.user.id,requestId=randomUUID();
        if(!authorized)this.safety.check();
        this.searches.add(ctx.user.id);
        let tracks;
        try {
            if(localId)tracks=[{...this.library.track(localId),requester:user,requestId}];
            else if(playlist){const p=this.library.managed.info().playlists.find(p=>p.id===playlist[1]);if(!p||!p.tracks.length)throw new UserError('Playlist local vacía o no disponible.');tracks=p.tracks.map(id=>({...this.library.track(id),requester:user,requestId}));source.localTitle=p.title;}
            else if (source.playlist) {
                const page = await this.remoteLookup(() => this.catalog.page(source,user));
                tracks = this.pageEntries(source,page,user,requestId);
                if (!tracks.length) throw new UserError('Esta playlist está vacía o no contiene canciones disponibles.');
            } else tracks = [{ ...await this.lookupTrack(query), requester:user, requestId }];
        } catch(error){
            if(!authorized && error?.code!=='MUSIC_LOOKUP_BUSY'){
                const d=this.safety.record(ctx.guild.id,error,true);
                console.warn('[MUSIC LOOKUP]',d.code,errorSource(error)||'UNKNOWN_SOURCE');
                if(!d.notice)throw new UserError('La fuente no está disponible. Consulta >musicdiag.');
            }
            throw error;
        } finally { this.searches.delete(user); }
        return this.serial.run(ctx.guild.id, async () => {
            if(!authorized)this.safety.check();
            const s = await this._connect(ctx);
            if (new Set(s.queue.map(t => t.requestId)).size >= 50) throw new UserError('La cola admite hasta 50 solicitudes pendientes.');
            if (new Set(s.queue.filter(t => t.requester === user).map(t => t.requestId)).size >= 10) throw new UserError('Ya tienes 10 solicitudes pendientes.');
            if(authorized&&s.queue.length+tracks.length>250)throw new UserError('La cola está llena.');
            if(authorized)for(const t of tracks)this.library.file(t.localId);
            const previous = s.current;
            s.queue.push(...tracks); await this._start(s);
            if (previous && s.current === previous) await this.refreshPanel(s);
            const result = playlist ? {title:source.localTitle,playlist:true} : source.playlist ? { title:'Playlist de ' + (source.spotify ? 'Spotify' : 'YouTube'), playlist:true } : tracks[0];
            return {...result, requestStatus: requestStatus(s,requestId)};
        });
    }
    async test(ctx) {
        await this.access(ctx);
        return this.serial.run(ctx.guild.id, async () => {
            const s = await this._connect(ctx);
            if (s.current || s.queue.length) throw new UserError('Primero detén la música con >stop.');
            s.queue.push({ title: 'Tono de prueba', test: true, requester: ctx.user.id });
            await this._start(s);
        });
    }
    async panelAction(ctx, customId, message) {
        const {token,action} = parseControl(customId);
        if (!ctx.guild || ctx.channel?.isThread?.()) throw new UserError('Usa los controles en el canal de texto del reproductor.');
        return this.action(ctx,action,undefined,{token,messageId:message?.id,channelId:ctx.channel.id});
    }
    async action(ctx, action, value, panel) {
        return this.serial.run(ctx.guild.id, async () => {
            const s = await this.control(ctx);
            if (panel) {
                assertCurrentPanel(s,panel);
                if (action === 'queue') {
                    const upcoming = s.queue.filter(t=>!t.page).slice(0,10);
                    return (s.remoteQueueHeld?'**Cola remota retenida.** Usa `>resume` cuando termine la restricción y no haya una pista activa.\n':'')+(upcoming.length ? '**Próximas canciones**\n'+upcoming.map((t,i)=>(i+1)+'. '+String(t.title||'Pista').slice(0,150)).join('\n') : 'No hay canciones pendientes en la cola.');
                }
                if (action === 'down' || action === 'up') { value=nextVolume(s.volume,action==='up'?10:-10); action='volume'; }
                if (action === 'loop') value=nextLoop(s.loop);
            }
            if (action === 'stop') { if(this.isPinned(s)){s.autoPaused=true;s.queue=[];s.remoteQueueHeld=false;s.loop='off';await this.retirePanel(s,s.current,'stop');this._cleanup(s.current);s.current=null;s.player.stop(true);return 'Reproducción detenida.';}this._destroy(s);return 'Reproducción detenida.'; }
            if (action === 'volume') { if(!Number.isInteger(value)||value<0||value>100)throw new UserError('Volumen de 0 a 100.'); const next=value/100; if(s.current){if(!s.current.resource?.volume)throw new UserError('La pista aún no tiene un control de volumen activo.');s.current.resource.volume.setVolume(next);} s.volume=next; await this.refreshPanel(s); return 'Volumen: '+Math.round(s.volume*100)+'%.'; }
            if (action === 'loop') { s.loop = value; await this.refreshPanel(s); return 'Repetición: '+({off:'desactivada',song:'canción',queue:'cola'})[value]+'.'; }
            if (action === 'shuffle') {
                for (let i = s.queue.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
                }
                await this.refreshPanel(s);
                return 'Cola mezclada.';
            }
            if (action === 'resume' && !s.current && s.remoteQueueHeld) {
                this.safety.check();
                s.remoteQueueHeld=false;
                await this._start(s);
                if(s.current) return 'Cola reanudada.';
                if(s.remoteQueueHeld) return 'La cola sigue retenida por una restricción.';
                return s.queue.length ? 'Se continuará con las pistas pendientes.' : 'No se pudo iniciar ninguna pista pendiente.';
            }
            if (!s.current) throw new UserError('No hay una pista activa.');
            if (action === 'skip') { await this._finish(s, s.current.token, 'skip'); return 'Canción saltada.'; }
            if (action === 'pause') { const changed = s.player.pause(); await this.refreshPanel(s); return changed ? 'Música pausada.' : 'No se pudo pausar en el estado actual.'; }
            if (action === 'resume') { const changed = s.player.unpause(); if (changed) s.current.lastByte = Date.now(); await this.refreshPanel(s); return changed ? 'Música reanudada.' : 'No se pudo reanudar en el estado actual.'; }
        });
    }
    snapshot(guild){
        const s=this.sessions.get(guild.id),diag=this.safety.snapshot(guild.id);
        return {active:Boolean(s),voice:s?.connection.state.status||'—',player:s?.player.state.status||'idle',volume:Math.round((s?.volume??.65)*100),current:s?.current?.track.title||null,queue:(s?.queue||[]).slice(0,50).map(t=>String(t.title||'Pista').slice(0,150)),total:s?.queue.length||0,diag,library:this.library.list().map(({id,title,rights,artist,cover,managed,duration})=>({id,title,rights,artist,cover,managed,duration})),spotify:this.catalog.ready(),youtubeApi:Boolean(this.catalog.env.YOUTUBE_API_KEY)};
    }
    async webAction(ctx,action,value){
        // All web controls require an already active voice session and current DJ/access checks.
        await this.control(ctx);
        if(action==='local'||action==='local-playlist'){
            if(!/^[a-z0-9_-]{1,40}$/.test(value||''))throw new UserError('Elige un audio de la biblioteca.');
            return this.play(ctx,action+':'+value);
        }
        if(!['stop','skip','pause','resume','shuffle','volume','loop'].includes(action))throw new UserError('Control inválido.');
        if(action==='volume'){if(!/^\d{1,3}$/.test(value||'')||Number(value)>100)throw new UserError('Volumen de 0 a 100.');value=Number(value);}
        if(action==='loop'&&!['off','song','queue'].includes(value))throw new UserError('Modo de repetición inválido.');
        return this.action(ctx,action,value);
    }
    diagnostic(guild) {
        const s = this.sessions.get(guild.id),diag=this.safety.snapshot(guild.id);
        const gate = this.lookupGate.snapshot();
        return [
            'Spotify API: ' + (this.catalog.ready() ? 'configurada' : 'pendiente'),
            'YouTube Data API: ' + (this.catalog.env.YOUTUBE_API_KEY ? 'configurada' : 'pendiente'),
            `Sesión: ${s ? 'activa' : 'no conectada'}`,
            `Conexión: ${s?.connection.state.status || '—'}`,
            `Reproductor: ${s?.player.state.status || '—'}`,
            `PCM recibido: ${s?.current?.bytes || 0} bytes`,
            `Volumen: ${Math.round((s?.volume ?? .65) * 100)}%`,
            `Silenciado por servidor: ${Boolean(guild.members.me?.voice.serverMute)}`,
            `Pistas pendientes: ${s?.queue.length || 0}`,
            `Cola remota retenida: ${s?.remoteQueueHeld ? s.queue.filter(t=>!t.local&&!t.test).length+' entradas · >resume cuando termine la restricción' : 'no'}`,
            `Último error: ${diag.last||'ninguno'}`,
            `Detalle de disponibilidad: ${diag.lastDetail||'—'}`,
            `Origen del último error: ${diag.lastSource||'no identificado'}`,
            `Pausa YouTube: ${diag.cooldownSeconds}s`,
            `Origen de la restricción activa: ${diag.globalSource||'—'}`,
            `Errores agrupados: ${diag.suppressed}`,
            `Biblioteca autorizada: ${this.library.list().length} pistas`,
            `Caché musical: ${this.trackCache.hits} aciertos · ${this.trackCache.shared} compartidas · ${this.trackCache.misses} búsquedas nuevas`,
            `Control de consultas: ${gate.active} activa · ${gate.waiting} en espera · ${gate.completed} terminadas · ${gate.rejected} rechazadas por capacidad`,
            '', 'Prueba >audiotest sin música activa. Si no oyes el tono: revisa volumen del bot en tu Discord, silencio y permisos de voz.'
        ].join('\n');
    }
    closeAll() { for (const s of this.sessions.values()) this._destroy(s); this.catalog.close(); }
}
module.exports = { Music, requestStatus, musicQuery, processResult, resolveTrack, toneBuffer, explainAudioError, generateDependencyReport };
