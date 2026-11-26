'use strict';
const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { UserError, Serial, ExpiringCache } = require('./core');
const videoUrl = id => 'https://www.youtube.com/watch?v=' + id;
class MusicCatalog {
    constructor(store, env = process.env, request = fetch) {
        this.store = store; this.env = env; this.request = request;
        this.tokens = new ExpiringCache(60 * 60000); this.locks = new Serial();
    }
    db() {
        if (!this.database) {
            this.database = new DatabaseSync(path.join(this.store.directory,'music-links.sqlite'));
            this.database.exec('CREATE TABLE IF NOT EXISTS spotify (user TEXT PRIMARY KEY, secret TEXT NOT NULL)');
        }
        return this.database;
    }
    ready() { return Boolean(this.env.SPOTIFY_CLIENT_ID && this.env.SPOTIFY_CLIENT_SECRET); }
    connectURL(origin,state) {
        if (!this.ready()) throw new UserError('Configura SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en Railway para vincular Spotify.');
        const url = new URL('https://accounts.spotify.com/authorize');
        url.search = new URLSearchParams({ client_id:this.env.SPOTIFY_CLIENT_ID, response_type:'code', redirect_uri:origin+'/musica/spotify/callback',
            state, scope:'playlist-read-private playlist-read-collaborative', show_dialog:'true' });
        return url.href;
    }
    async exchange(params) {
        const secret = Buffer.from(this.env.SPOTIFY_CLIENT_ID+':'+this.env.SPOTIFY_CLIENT_SECRET).toString('base64');
        const response = await this.request('https://accounts.spotify.com/api/token',{method:'POST',headers:{ Authorization:'Basic '+secret },body:new URLSearchParams(params),signal:AbortSignal.timeout(12000)});
        if (!response.ok) throw new UserError(response.status === 400 ? 'La autorización de Spotify expiró. Vuelve a vincular tu cuenta con >spotify.' : 'Spotify no aceptó la conexión. Revisa la aplicación y sus credenciales.');
        return response.json();
    }
    save(user, data) {
        if (!data.access_token) throw new UserError('Spotify no devolvió una autorización válida.');
        if (data.refresh_token) {
            const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',this.key(),iv);
            cipher.setAAD(Buffer.from(user));
            const encrypted = Buffer.concat([cipher.update(data.refresh_token,'utf8'),cipher.final()]);
            const packed = Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
            this.db().prepare('INSERT INTO spotify VALUES (?,?) ON CONFLICT(user) DO UPDATE SET secret=excluded.secret').run(user,packed);
        }
        this.tokens.set(user,{access:data.access_token,expires:Date.now() + (data.expires_in - 30)*1000});
        return data.access_token;
    }
    key() { return createHash('sha256').update('timmy-spotify\0'+this.env.SPOTIFY_CLIENT_SECRET).digest(); }
    async connect(user, code, origin) {
        return this.locks.run(user,async () => {
            const data = await this.exchange({grant_type:'authorization_code',code,redirect_uri:origin+'/musica/spotify/callback'});
            if (!data.refresh_token) throw new UserError('Spotify no completó la vinculación. Vuelve a autorizar.');
            this.save(user,data);
        });
    }
    unlink(user) {
        return this.locks.run(user,() => { this.tokens.delete(user); this.db().prepare('DELETE FROM spotify WHERE user=?').run(user); });
    }
    linked(user) { return Boolean(this.db().prepare('SELECT 1 FROM spotify WHERE user=?').get(user)); }
    access(user) {
        return this.locks.run(user,async () => {
            const cached = this.tokens.get(user);
            if (cached && cached.expires > Date.now()) return cached.access;
            const row = this.db().prepare('SELECT secret FROM spotify WHERE user=?').get(user);
            if (!row || !this.ready()) throw new UserError('Para poner tus playlists, vincula tu cuenta con >spotify.');
            const packed = Buffer.from(row.secret,'base64');
            let token;
            try {
                const cipher = createDecipheriv('aes-256-gcm',this.key(),packed.subarray(0,12));
                cipher.setAAD(Buffer.from(user)); cipher.setAuthTag(packed.subarray(12,28));
                token = Buffer.concat([cipher.update(packed.subarray(28)),cipher.final()]).toString('utf8');
            } catch { throw new UserError('Vuelve a vincular tu cuenta con >spotify.'); }
            return this.save(user,await this.exchange({grant_type:'refresh_token',refresh_token:token}));
        });
    }
    async youtube(resource, params) {
        if (!this.env.YOUTUBE_API_KEY) throw new UserError('Falta YOUTUBE_API_KEY en Railway para cargar listas de YouTube.');
        const url = new URL('https://www.googleapis.com/youtube/v3/'+resource);
        url.search = new URLSearchParams({...params,key:this.env.YOUTUBE_API_KEY});
        const response = await this.request(url,{signal:AbortSignal.timeout(12000)});
        if (!response.ok) {
            const error=new UserError(response.status===429?'YouTube Data API: HTTP 429.':response.status===403?'YouTube Data API: HTTP 403; revisa la clave o cuota.':'No pude leer ese contenido de YouTube. Comprueba que esté disponible.');
            error.musicSource='YOUTUBE_DATA_API';
            if(response.status===429)error.musicCode='RATE_LIMIT';
            if(response.status===403)error.musicCode='FORBIDDEN';
            throw error;
        }
        return response.json();
    }
    async video(query) {
        const data = await this.youtube('search',{part:'id',type:'video',maxResults:'1',q:query});
        const id = data.items?.[0]?.id?.videoId;
        if (!/^[\w-]{11}$/.test(id || '')) throw new UserError('No encontré un video para esa canción.');
        return videoUrl(id);
    }
    async page(list, user, cursor = '') {
        if (list.spotify) {
            const token = await this.access(user);
            const url = 'https://api.spotify.com/v1/playlists/'+list.playlist+'/items?limit=50&offset='+Number(cursor || 0);
            const response = await this.request(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
            if (!response.ok) throw new UserError(response.status === 403 ? 'Spotify solo da acceso a listas que tú creaste o en las que colaboras. Comprueba también el acceso de tu cuenta a la app.' : response.status === 429 ? 'Spotify alcanzó su límite temporal. Inténtalo después.' : 'No pude leer la playlist de Spotify. Revisa el enlace y tu vinculación.');
            const data = await response.json(), items = data.items || [];
            return { tracks:items.map(entry => entry.item || entry.track).filter(t => t?.type === 'track' && !t.is_local && t.is_playable !== false && t.name)
                .map(t => ({ title:t.name, query:[t.name,...(t.artists || []).map(a=>a.name)].join(' '), spotify:true })),
                next:data.next && items.length ? String(Number(cursor || 0)+items.length) : null };
        }
        const data = await this.youtube('playlistItems',{part:'snippet,status',playlistId:list.playlist,maxResults:'50',...(cursor ? {pageToken:cursor} : {})});
        return { tracks:(data.items || []).filter(t => t.status?.privacyStatus !== 'private' && /^[\w-]{11}$/.test(t.snippet?.resourceId?.videoId || '') && !['Deleted video','Private video'].includes(t.snippet.title))
            .map(t => ({title:t.snippet.title,query:videoUrl(t.snippet.resourceId.videoId)})),next:data.nextPageToken || null };
    }
    close() { this.database?.close(); }
}
module.exports = { MusicCatalog };
