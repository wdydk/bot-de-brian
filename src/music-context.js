'use strict';

// Only explicit, allowlisted music requests can trigger actions.
// Song metadata is data, never a command or an AI instruction.
function musicContextKey(ctx, replyId) {
    return [ctx.guild.id, ctx.channel.id, ctx.user.id, replyId || 'latest'].join(':');
}

function spotifyQuery(activity) {
    const clean = (value, limit) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
    const title = clean(activity?.details, 180);
    const artist = clean(activity?.state, 110);
    if (!title) return null;
    const query = [title, artist].filter(Boolean).join(' ');
    // Never let presence metadata become a URL or a local library command.
    return /^[\w+.-]+:/i.test(query) ? 'audio ' + query : query;
}

function musicIntent(input) {
    const text = String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim().replace(/^[¡¿]+/, '').replace(/[?!.,;:)]+$/, '').trim()
        .replace(/\s+/g, ' ').replace(/^(?:por favor,?\s+|(?:puedes|podrias)\s+)/, '')
        .replace(/^(?:puedes|podrias)\s+/, '').replace(/,?\s+por favor$/, '');
    if (/^(?:(?:pon(?:me)?|poner(?:me)?|reproduce(?:me)?|reproducir(?:me)?|play) (?:esa|esta|la anterior|la ultima|la misma) (?:cancion|musica|pista|tema)|(?:ponla|reproducela|ponerla|reproducirla)|(?:pon(?:me)?|poner(?:me)?|reproduce|reproducir) (?:esa|esta|la cancion que (?:me mostraste|acabas de mostrar|estoy escuchando)))$/.test(text)) {
        return { command: 'play', contextual: true, args: [] };
    }
    const controls = [
        ['pause', /^(?:pausa|pausar) (?:la )?(?:musica|cancion|pista)$/],
        ['resume', /^(?:continua|continuar|reanuda|reanudar) (?:la )?(?:musica|cancion|pista)$/],
        ['skip', /^(?:siguiente (?:cancion|pista)|salta(?:r)? (?:la |esta )?(?:cancion|pista))$/],
        ['stop', /^(?:deten|detener|para|parar) (?:la )?(?:musica|reproduccion)$/],
        ['queue', /^(?:muestra(?:me)?|mostrar(?:me)?|enseña(?:me)?|ensena(?:me)?|ensenar(?:me)?|ver) (?:la )?cola(?: de (?:musica|canciones))?$/]
    ];
    for (const [command, pattern] of controls) if (pattern.test(text)) return { command, args: [] };
    const volume = /^(?:pon|poner|ajusta|ajustar|cambia|cambiar) (?:el )?volumen (?:a(?:l)? )?(\d{1,3})\s*%?$/.exec(text);
    if (volume) return { command: 'volume', args: [volume[1]] };
    return null;
}

module.exports = { musicContextKey, spotifyQuery, musicIntent };
