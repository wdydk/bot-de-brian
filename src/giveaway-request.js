'use strict';
const { UserError } = require('./core');

const channelPattern = /<#\d{17,20}>|#[\p{L}\p{N}_-]+/gu;
const channelIn = text => text.match(channelPattern)?.[0];
const order = /^(?:[¿¡]\s*)?(?:por favor[,\s]+)?(?:(?:me\s+)?puedes\s+)?(?:haz(?:me)?|hacer(?:me)?|cr[eé]a(?:me)?|crear(?:me)?|organ[ií]za(?:me)?|prepara(?:me)?|publica(?:me)?|escr[ií]be(?:me)?|manda(?:me)?|env[ií]a(?:me)?|anuncia(?:me)?)\s+(?:un[ao]?\s+|el\s+)?(give\s*away|sorteo|evento|mensaje|anuncio)\b/i;
const unit = '(minutos?|minutes?|mins?|m|horas?|hours?|hrs?|h|d[ií]as?|days?|d)';
const amount = '(-?\\d+(?:[.,]\\d+)?)';
const period = new RegExp('(?:^|\\s)'+amount+'\\s*'+unit+'\\b','i');
const labeledPeriod = new RegExp('\\b'+unit+'\\s*:\\s*'+amount+'\\b','i');
const clock = n => /^m/i.test(n) ? 60000 : /^h/i.test(n) ? 3600000 : 86400000;
const example = 'Ejemplo: >giveaway #giveaway hours: 5 prize: 5k Robux winners: 2';
function checkedPrize(prize) {
    if (prize.length > 220) throw new UserError('El premio debe tener hasta 220 caracteres.');
    return prize;
}
function winnerCount(text) {
    return text.match(/\b(?:ganador(?:es)?|winners?)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i)
        || text.match(/(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(?:ganador(?:es)?|winners?)\b/i);
}
function draftFields(text, fields) {
    text = String(fields ? fields.duration : text || '').trim();
    const labels = text.match(labeledPeriod);
    const time = text.match(period);
    const quantity = value => Number(value.replace(',', '.'));
    const ms = labels ? quantity(labels[2]) * clock(labels[1]) : time ? quantity(time[1]) * clock(time[2]) : 0;
    const count = fields ? [null, fields.winners] : winnerCount(text);
    const raw = text.replace(channelPattern, ' ').replace(labeledPeriod, ' | ').replace(period, ' | ');
    const label = raw.match(/\b(?:premio|prize)\b\s*(?:[:=]|(?:es|ser[áa])(?:\s+de)?(?=\s|$)|de\b)?\s*/i);
    const prize = fields ? String(fields.prize || '').trim() : (label ? raw.slice(label.index + label[0].length) :
        raw.match(/\b(?:give\s*away|sorteo)\s+de\s+(.+)/is)?.[1] || '')
        .split(/\||\b(?:con\s+)?(?:\d+\s+)?(?:ganador(?:es)?|winners?)\b/i)[0]
        .replace(/(?:\s+(?:y|de|en|con|durante|por|para|al canal|en el canal))+(?:\s*[,;])?\s*$/i,'').replace(/[\s,;.]+$/,'').trim();
    const details = {};
    if (labels || time) {
        if (!Number.isSafeInteger(ms) || ms < 60000 || Date.now()+ms > Date.UTC(9999,11,31)) throw new UserError('Indica una duración válida en minutos, horas o días.');
        details.ms = ms;
    }
    if (count) {
        const winners = Number(count[1]);
        if (!Number.isInteger(winners) || winners < 1 || winners > 100) throw new UserError('Elige de 1 a 100 ganadores por sorteo.');
        details.winners = winners;
    }
    if (prize) details.prize = checkedPrize(prize);
    return details;
}
function missingDetails({prize,ms,winners}) {
    return [!prize && 'el premio', !ms && 'la duración', !winners && 'el número de ganadores'].filter(Boolean);
}
function replyFields(text, pending) {
    const reply = text.trim();
    if (pending && missingDetails(pending).length === 1) {
        if (!pending.winners && /^-?\d+(?:[.,]\d+)?$/.test(reply)) return draftFields('ganadores: ' + reply);
        const explicitField = /^(?:premio|prize)\b/i.test(reply) || winnerCount(reply) || labeledPeriod.test(reply);
        const onlyDuration = reply.match(period)?.[0].trim() === reply;
        if (!pending.prize && !explicitField && !onlyDuration) {
            if (/^(?:gracias|hola|ok|vale)[!.]?$/i.test(reply)) return {};
            return { prize: checkedPrize(reply) };
        }
    }
    return draftFields(reply);
}
function messageText(text, kind) {
    const explicit = text.match(/\b(?:diciendo(?:\s+que)?|que diga|con (?:el )?texto|titulado)\s*[:“"]?\s*(.+)/is);
    if (explicit) return explicit[1].replace(/[”"]$/,'').trim();
    return text.replace(order, '').replace(/(?:\s+y\s+(?:m[aá]ndalo|env[ií]alo|publ[ií]calo))?\s*(?:(?:en|a|al|para)\s+(?:(?:el\s+)?canal\s+)?)?(?:<#\d{17,20}>|#[\p{L}\p{N}_-]+)/u,'')
        .replace(/^[\s,:–-]*(?:de\s+)?/i,'').trim() || (kind === 'event' ? '' : null);
}
function parsePublication(text, manual = false) {
    const clauses = String(text).trim().split(/\s*(?:\by\s+(?:tambi[eé]n\s+)?|[;,]\s*|\.\s+)(?=(?:(?:haz|cr[eé]a|organiza|prepara|publica|escribe|manda|env[ií]a)(?:me)?\s+(?:(?:un[ao]?|el)\s+)?(?:sorteo|give\s*away|evento|mensaje|anuncio)\b|an[uú]ncialo\b|avisa\b))/i);
    let draw, notice;
    for (const [idx, part] of clauses.entries()) {
        const kind = idx === 0 && manual ? 'sorteo' : part.match(order)?.[1]?.toLowerCase();
        if (!kind && !(idx && /^(?:an[uú]ncialo|avisa)\b/i.test(part))) return null;
        if (kind === 'sorteo' || /^give\s*away$/.test(kind || '')) {
            if (draw) throw new UserError('Prepara un sorteo por solicitud.');
            draw = { text: part, channel: channelIn(part) };
        } else {
            if (notice) throw new UserError('Elige un canal para el anuncio.');
            const type = kind === 'evento' ? 'event' : 'notice';
            notice = { type, channel: channelIn(part), text: kind ? messageText(part, type) : '' };
        }
    }
    if (draw) return { type: 'draw', ...draw, notice };
    return notice;
}
module.exports = { parsePublication, draftFields, replyFields, missingDetails, channelIn, example };
