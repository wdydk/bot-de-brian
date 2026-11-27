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
    constructor(message, { reference, search } = {}) {
        super(message);
        this.reference = reference;
        const url = search && 'https://open.spotify.com/search/' + encodeURIComponent(search.toWellFormed());
        this.spotifyUrl = reference?.url || (url && url.length <= 512 ? url : null);
    }
}

function parseVoiceInput(input, { allowLocal = true } = {}) {
    const raw = String(input || '').trim();
    const ref = parseSpotifyLink(raw);
    if (!raw || (!ref && raw.length > 300)) throw new UserError('Escribe un título de hasta 300 caracteres o pega un enlace de Spotify.');
    const local = /^(local|local-playlist):([a-z0-9_-]{1,40})$/.exec(raw);
    if (!ref && !(allowLocal && local) && /^(?:<?[\w+.-]+:)|[/\\\x00-\x1f]/.test(raw)) {
        throw new UserError('La reproducción de enlaces externos está desactivada. Usa un enlace de Spotify asociado a la biblioteca autorizada o el título de una grabación.');
    }
    return { raw, ref, local };
}

function selectVoiceInput(input, library) {
    const { raw, ref, local } = parseVoiceInput(input);
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
    let hint;
    if (ref?.type === 'track' || playlist) {
        hint = 'Para que suene en el canal, el dueño del bot puede asociar este enlace a ' +
            (playlist ? 'una playlist local' : 'su archivo de audio') + ' en Music Center.';
    } else if (ref) {
        hint = ref.type === 'short' ? 'Para buscarla en voz, copia el enlace completo de la canción o playlist desde Spotify.' :
            'Para pedir audio en voz, usa el enlace de una canción o playlist asociada en Music Center.';
    } else {
        hint = entries.length ? 'Prueba con el título y el artista o busca en Spotify.' :
            'El dueño del bot puede subir una grabación propia o con permiso desde Music Center.';
    }
    const message = ref ? 'Este enlace no tiene audio asociado en la biblioteca autorizada. Puedes abrirlo en Spotify. ' :
        entries.length ? 'Esa canción no aparece en la biblioteca autorizada. ' : 'La biblioteca autorizada de voz está vacía. ';
    throw new MusicSelectionError(message + hint, ref ? { reference: ref } : { search: raw });
}

module.exports = { parseSpotifyLink, spotifyField, supportsSpotifyPlayback, localTrackMatches, parseVoiceInput, selectVoiceInput, MusicSelectionError };
