'use strict';
const { Readable } = require('node:stream');
const { UserError } = require('./core');
const { parseAudiusLink, parseSpotifyLink, localTrackMatches } = require('./music-selection');

const api = 'https://api.audius.co';
const userAgent = 'TimmyMax/1.0 (https://github.com/wdydk/bot-de-brian)';
const maxBytes = 100 * 1024 * 1024;
const trackId = /^[A-Za-z0-9]{1,32}$/;
const unavailable = () => new UserError('Audius no ofrece esta pista completa para reproducción pública en voz.');

function recordingCode(value) {
    const code = String(value || '').toUpperCase().replace(/-/g, '');
    return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : null;
}

function publicTrack(row) {
    if (!row || !trackId.test(row.id || '') || typeof row.title !== 'string' || !row.title.trim() ||
        row.is_streamable !== true || row.is_available !== true || row.access?.stream !== true ||
        row.is_stream_gated !== false || row.stream_conditions || row.allowed_api_keys?.length ||
        row.is_unlisted || row.is_delete || !Number.isFinite(row.duration) || row.duration <= 0 || row.duration > 1800) return null;
    const link = parseAudiusLink('https://audius.co' + row.permalink);
    if (!link) return null;
    return { audiusId: row.id, title: row.title.trim().slice(0, 200), artist: String(row.user?.name || '').slice(0, 120),
        duration: row.duration, url: link.url, isrc: recordingCode(row.isrc) };
}

function unique(tracks) {
    const matches = new Map(tracks.filter(Boolean).map(track => [track.audiusId, track]));
    return matches.size === 1 ? matches.values().next().value : null;
}

function apiUrl(path, params = {}) {
    const url = new URL('/v1' + path, api);
    url.search = new URLSearchParams({ ...params, app_name: 'TimmyMax' });
    return url;
}

function allowedMediaUrl(url) {
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        (url.hostname === 'api.audius.co' || url.hostname.endsWith('.audius.co') ||
         url.hostname.endsWith('.audius.network') || url.hostname.endsWith('.r2.cloudflarestorage.com'));
}

class Audius {
    constructor({ request = (...args) => fetch(...args), musicfetchToken = process.env.MUSICFETCH_TOKEN } = {}) {
        this.request = request;
        this.musicfetchToken = musicfetchToken;
    }
    async json(url, headers = {}, signal) {
        const timeout = AbortSignal.timeout(8000);
        const response = await this.request(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: { 'User-Agent': userAgent, Accept: 'application/json', ...headers } });
        if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 404) return null;
            throw new UserError('El servicio de búsqueda de música no respondió. Inténtalo de nuevo en un momento.');
        }
        return response.json();
    }
    async list(path, params) {
        const data = (await this.json(apiUrl(path, params)))?.data;
        return Array.isArray(data) ? data : data ? [data] : [];
    }
    async expandSpotify(shared) {
        const signal = AbortSignal.timeout(6000);
        let current = shared;
        try {
            for (let i = 0; i < 4 && current?.type === 'short'; i++) {
                const response = await this.request(new URL(current.url), {redirect:'manual',signal,headers:{'User-Agent':userAgent}});
                const next = response.headers.get('location');
                await response.body?.cancel();
                if (!next || ![301,302,303,307,308].includes(response.status)) return null;
                current = parseSpotifyLink(new URL(next, current.url).href);
                if (current && current.type !== 'short') return current;
            }
        } catch { /* Some share pages only expand inside the Spotify app. */ }
        return null;
    }
    async byLink(link) {
        const rows = await this.list('/tracks', { permalink: decodeURIComponent(link.permalink) });
        const samePath = url => url?.toLowerCase() === link.url.toLowerCase();
        const result = unique(rows.map(publicTrack).filter(t => samePath(t?.url)));
        if (!result) throw unavailable();
        return result;
    }
    async byCode(code) {
        const rows = await this.list('/tracks', { isrc: code, limit: '20' });
        return unique(rows.map(publicTrack).filter(t => t && t.isrc === code));
    }
    async spotify(ref) {
        if (this.musicfetchToken) {
            const url = new URL('https://api.musicfetch.io/url');
            url.search = new URLSearchParams({ url: ref.url, services: 'audius' });
            // The optional resolver handles identifiers only. Credentials stay on its fixed origin.
            try {
                const metadata = (await this.json(url, { 'x-token': this.musicfetchToken }))?.result;
                if (metadata?.type === 'track') {
                    const code = recordingCode(metadata.isrc);
                    const link = parseAudiusLink(metadata.services?.audius?.link);
                    if (link) {
                        const track = await this.byLink(link);
                        if (!code || !track.isrc || track.isrc === code) return track;
                    }
                    if (code) {
                        const track = await this.byCode(code);
                        if (track) return track;
                    }
                }
            } catch { /* Independent public lookup also works without a subscription. */ }
        }
        if (!/^[A-Za-z0-9]{22}$/.test(ref.id)) return null;
        const url = new URL('https://query.wikidata.org/sparql');
        const query = 'SELECT DISTINCT ?isrc WHERE { ?recording wdt:P2207 "' + ref.id + '"; wdt:P1243 ?isrc . } LIMIT 10';
        url.search = new URLSearchParams({ query, format: 'json' });
        const data = await this.json(url);
        const codes = new Set((data?.results?.bindings || []).map(b => recordingCode(b.isrc?.value)).filter(Boolean));
        return codes.size === 1 ? this.byCode([...codes][0]) : null;
    }
    async lookup({ audius, ref, raw }) {
        try {
            if (audius) return await this.byLink(audius);
            if (ref) return await this.spotify(ref);
            const rows = await this.list('/tracks/search', { query: raw, limit: '20' });
            return unique(localTrackMatches(rows.map(publicTrack).filter(Boolean), raw));
        } catch (error) {
            if (error instanceof UserError) throw error;
            throw new UserError('No pude consultar el catálogo de música en este momento. Vuelve a pegar el enlace en unos segundos.');
        }
    }
    async open(track, controller) {
        if (!trackId.test(track.audiusId || '')) throw unavailable();
        const path = '/tracks/' + track.audiusId;
        const fresh = publicTrack((await this.json(apiUrl(path), {}, controller.signal))?.data);
        if (!fresh || fresh.audiusId !== track.audiusId) throw unavailable();
        let url = apiUrl(path + '/stream');
        for (let count = 0; count < 6; count++) {
            if (!allowedMediaUrl(url)) throw unavailable();
            // Bound connection time without cutting off a song once its headers arrive.
            const timer = setTimeout(() => controller.abort(), 10000);
            let response;
            try { response = await this.request(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': userAgent } }); }
            finally { clearTimeout(timer); }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const next = response.headers.get('location');
                await response.body?.cancel();
                if (!next) throw unavailable();
                url = new URL(next, url);
                continue;
            }
            const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (response.status !== 200 || !response.body || !['audio/mpeg','audio/mp3','application/octet-stream'].includes(type) ||
                Number(response.headers.get('content-length')) > maxBytes) {
                await response.body?.cancel();
                throw unavailable();
            }
            return Readable.from((async function* () {
                let bytes = 0;
                for await (const chunk of response.body) {
                    bytes += chunk.length;
                    if (bytes > maxBytes) throw unavailable();
                    yield chunk;
                }
            })(), { objectMode: false });
        }
        throw unavailable();
    }
}
module.exports = { Audius };
