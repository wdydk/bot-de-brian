'use strict';
const { UserError } = require('./core');

const idPattern = '[A-Za-z0-9]{22}';
const kinds = '(track|playlist|album|artist|episode|show)';
const uriPattern = new RegExp('^spotify:' + kinds + ':(' + idPattern + ')$');
const pathPattern = new RegExp('^/(?:intl-[\\w-]+/)?(?:embed/)?' + kinds + '/(' + idPattern + ')/?$');

function parseSpotifyLink(value) {
    const raw = String(value || '').trim().replace(/^<([^<>]+)>$/, '$1');
    if (!raw || raw.length > 2048 || /[\s\\<>]/.test(raw)) return null;
    let match = uriPattern.exec(raw);
    if (!match) {
        let url;
        try { url = new URL(raw); } catch { return null; }
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        if (['spotify.link', 'spoti.fi', 'spotify.app.link'].includes(url.hostname) && /^\/[A-Za-z0-9_-]{1,100}\/?$/.test(url.pathname)) {
            return { type: 'short', url: url.origin + url.pathname };
        }
        if (url.hostname !== 'open.spotify.com') return null;
        match = pathPattern.exec(url.pathname);
        if (!match) return null;
    }
    const [, type, id] = match;
    return { type, id, url: 'https://open.spotify.com/' + type + '/' + id };
}

function spotifyField(value, type) {
    // Older forms omit this field. Preserve any link saved by a newer form.
    if (value === undefined) return {};
    if (typeof value === 'string' && !value.trim()) return { spotifyUrl: '' };
    const ref = parseSpotifyLink(value);
    if (ref?.type !== type) throw new UserError('Pega el enlace completo de Spotify de ' +
        (type === 'track' ? 'la canción' : 'la playlist') + '.');
    return { spotifyUrl: ref.url };
}

function parseAudiusLink(value) {
    const raw = String(value || '').trim().replace(/^<([^<>]+)>$/, '$1');
    if (!/^https:\/\/(?:www\.)?audius\.co\//i.test(raw) || raw.length > 2048 || /[\s\\<>]/.test(raw)) return null;
    let url;
    try { url = new URL(raw); } catch { return null; }
    const match = /^\/([\w.-]+)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match || ['search','feed','explore','playlist','playlists','album','albums','tracks','settings'].includes(match[1].toLowerCase())) return null;
    let slug;
    try { slug = decodeURIComponent(match[2]); } catch { return null; }
    if (!/^[\p{L}\p{N}._~!$'()&+,=@-]+$/u.test(slug)) return null;
    const permalink = '/' + match[1] + '/' + encodeURIComponent(slug);
    return { permalink, url: 'https://audius.co' + permalink };
}

function musicLinkInChannel(message, session) {
    const voiceId = message.member?.voice?.channelId;
    if (!voiceId || !message.channel || message.channel.isThread?.()) return false;
    const name = (message.channel.name || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
    const inMusicChannel = /^(?:music|musica)(?:247)?$/.test(name);
    if (!inMusicChannel && message.channel.id !== voiceId && !(session && session.text?.id === message.channel.id && session.voiceId === voiceId)) return false;
    return Boolean(parseAudiusLink(message.content) || parseSpotifyLink(message.content));
}

function supportsSpotifyPlayback(ref) {
    return ['track', 'playlist', 'album', 'artist'].includes(ref?.type);
}

function localTrackMatches(entries, input) {
    const raw = String(input || '').trim();
    if (!raw || raw.length > 300 || /^[\w+.-]+:|[/\\\x00-\x1f]/.test(raw)) return [];
    const exact = s => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const folded = s => exact(s).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const normalize of [exact, folded]) {
        const query = normalize(raw);
        if (!query) continue;
        const matches = entries.filter(({title, artist}) => {
            if (!title) return false;
            const names = artist ? [title, title + ' ' + artist, artist + ' ' + title,
                title + ' - ' + artist, artist + ' - ' + title, title + ' de ' + artist] : [title];
            return names.some(name => normalize(name) === query);
        });
        if (matches.length) return matches;
    }
    return [];
}

class MusicSelectionError extends UserError {
    constructor(message, { reference, search, lookup = false } = {}) {
        super(message);
        this.reference = reference;
        this.lookup = lookup;
        const url = search && 'https://open.spotify.com/search/' + encodeURIComponent(search.toWellFormed());
        this.spotifyUrl = reference?.url || (url && url.length <= 512 ? url : null);
    }
}

function parseVoiceInput(input, { allowLocal = true } = {}) {
    const raw = String(input || '').trim();
    const ref = parseSpotifyLink(raw);
    const audius = parseAudiusLink(raw);
    if (!raw || (!ref && !audius && raw.length > 300)) throw new UserError('Escribe un título de hasta 300 caracteres o pega un enlace de Spotify o Audius.');
    const local = /^(local|local-playlist):([a-z0-9_-]{1,40})$/.exec(raw);
    if (!ref && !audius && !(allowLocal && local) && /^(?:<?[\w+.-]+:)|[/\\\x00-\x1f]/.test(raw)) {
        throw new UserError('Pega el enlace de una canción de Audius o Spotify, o escribe su título y artista.');
    }
    return { raw, ref, local, audius };
}

function selectVoiceInput(input, library) {
    const { raw, ref, local, audius } = parseVoiceInput(input);
    if (audius) return { audius };
    if (local) return { playlist: local[1] === 'local-playlist', id: local[2] };
    const playlist = ref?.type === 'playlist';
    const entries = playlist ? library.managed.info().playlists : library.list();
    const matches = ref ? entries.filter(item => item.spotifyUrl === ref.url) : localTrackMatches(entries, raw);
    if (matches.length === 1) return { playlist, id: matches[0].id };
    if (matches.length > 1) {
        const prefix = playlist ? 'local-playlist:' : 'local:';
        const choices = matches.slice(0, 5).map(t => t.title.slice(0, 80) + (t.artist ? ' · ' + t.artist.slice(0, 60) : '') + ' — ' + prefix + t.id);
        throw new MusicSelectionError('Hay varias coincidencias. Usa uno de estos IDs con >play.\n' + choices.join('\n'), { reference: ref });
    }
    if (ref && ref.type !== 'track') {
        const message = playlist ? 'Esta playlist no está asociada en Music Center. Puedes pedir una canción individual de Spotify o Audius.' :
            'Copia el enlace completo de una canción desde Spotify o Audius para pedirla en voz.';
        throw new MusicSelectionError(message, { reference: ref });
    }
    const message = ref ? 'No encontré una versión completa que pueda identificar como esa misma grabación. Si la ves en Audius, pega su enlace.' :
        'No encontré una grabación única con ese título. Prueba con el título y el artista, o pega el enlace de la canción de Audius.';
    throw new MusicSelectionError(message, { reference: ref, search: ref ? null : raw, lookup: true });
}

module.exports = { parseSpotifyLink, parseAudiusLink, musicLinkInChannel, spotifyField, supportsSpotifyPlayback, localTrackMatches, parseVoiceInput, selectVoiceInput, MusicSelectionError };
