'use strict';

const { createHash } = require('node:crypto');
const { UserError, knowledgeText } = require('./core');
const { emojiChoice } = require('./emojis');

const unquote = text => text.trim().replace(/^["“«]([\s\S]*)["”»]$|^'([\s\S]*)'$/, (_, a, b) => a ?? b);
const normalize = text => text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es').replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().replace(/\s+/g, ' ');
function parseRequest(text, direct = false) {
    const raw = text.trim();
    const reminder = /^(?:recuerda|recorda|memoriza)\b\s*(?:que\s+)?/iu.exec(raw);
    const body = reminder ? raw.slice(reminder[0].length) : raw;
    const start = /^(?:si|cuando)\s+alguien\s+(?:dice|diga|escribe|escriba|pone|ponga)\s+/iu.exec(body);
    if (start) {
        const tail = body.slice(start[0].length);
        const quoted = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|«([^»]+)»)/u.exec(tail);
        const rest = quoted ? tail.slice(quoted[0].length) : tail;
        const action = /(?:\s*[,;]\s*|\s+)(?:(dile|di|responde(?:le|les)?|resp[oó]ndele|cont[eé]stale|contesta)(?:\s+con)?|(reacciona)(?:\s+con)?)(?:\s*[:=]\s*|\s+)([\s\S]+)$/iu.exec(rest);
        if (action && (!quoted || action.index === 0)) {
            const trigger = quoted ? unquote(quoted[0]) : tail.slice(0, action.index);
            return { kind: action[2] ? 'reaction' : 'response', trigger, value: unquote(action[3]) };
        }
        if (direct || reminder) throw new UserError('Prueba: >recuerda si alguien dice brian, dile ola soy yo.');
        return null;
    }
    if (reminder || direct) {
        if (!body) throw new UserError('Prueba: >recuerda que los tryouts son los viernes.');
        return { kind: 'fact', value: body };
    }
    return null;
}
function saveRequest(store, guildId, request) {
    const cfg = store.guild(guildId);
    if (request.kind === 'fact') {
        if (!request.value.trim() || request.value.length > 1000) throw new UserError('Cada recuerdo admite entre 1 y 1000 caracteres.');
        const id = 'nota_' + createHash('sha256').update(request.value).digest('hex').slice(0, 8);
        const pages = { ...cfg.knowledgePages, [id]: request.value };
        if (Object.keys(pages).length > 20 || knowledgeText({ ...cfg, knowledgePages: pages }).length > 16000) {
            throw new UserError('La memoria de este servidor está llena. Revisa >recuerda lista o >knowledge list.');
        }
        store.patchGuild(guildId, { knowledgePages: pages, knowledgeRevision: cfg.knowledgeRevision + 1, setupAt: cfg.setupAt || Date.now() });
        return '📝 Guardé ese dato para las preguntas de este servidor. Para borrarlo usa `>recuerda quitar ' + id + '`.';
    }
    const trigger = normalize(request.trigger);
    if (!trigger || trigger.length > 80) throw new UserError('Usa una palabra o frase de 1 a 80 caracteres.');
    const value = request.kind === 'reaction' ? emojiChoice(request.value) : request.value;
    if (!value || value.length > 1500) throw new UserError('El texto de la respuesta debe tener entre 1 y 1500 caracteres.');
    const rules = [...cfg.chatRules];
    const i = rules.findIndex(rule => rule.trigger === trigger);
    if (i < 0 && rules.length >= 50) throw new UserError('Ya hay 50 reglas. Puedes quitar una con >recuerda quitar "frase".');
    const updated = { ...(rules[i] || {}), trigger, [request.kind]: value };
    if (i < 0) rules.push(updated);
    else rules[i] = updated;
    store.patchGuild(guildId, { chatRules: rules });
    return request.kind === 'reaction' ? `Cuando alguien diga «${trigger}», reaccionaré con ${value}.` :
        `Cuando alguien diga «${trigger}», responderé «${value}».`;
}
function removeMemory(store, guildId, raw) {
    const cfg = store.guild(guildId);
    const name = unquote(raw).trim();
    if (Object.hasOwn(cfg.knowledgePages, name) && /^nota_[a-f0-9]{8}$/.test(name)) {
        const pages = { ...cfg.knowledgePages }; delete pages[name];
        store.patchGuild(guildId, { knowledgePages: pages, knowledgeRevision: cfg.knowledgeRevision + 1 });
        return 'Recuerdo eliminado.';
    }
    const next = cfg.chatRules.filter(rule => rule.trigger !== normalize(name));
    if (next.length === cfg.chatRules.length) throw new UserError('No encontré esa regla o nota. Revisa >recuerda lista.');
    store.patchGuild(guildId, { chatRules: next });
    return 'Regla eliminada.';
}
function listMemory(cfg) {
    const lines = cfg.chatRules.map(rule => `• ${rule.trigger} → ${[rule.response?.slice(0, 80), rule.reaction].filter(Boolean).join(' + ')}`);
    for (const [id, body] of Object.entries(cfg.knowledgePages)) {
        if (/^nota_[a-f0-9]{8}$/.test(id)) lines.push(`• ${id} → ${body.slice(0, 90)}`);
    }
    return lines.join('\n') || 'Todavía no hay reglas ni notas guardadas con >recuerda.';
}
function matchingRule(cfg, text, exact = false) {
    const needle = normalize(text);
    if (!needle) return null;
    const sentence = ' ' + needle + ' ';
    let best = null;
    for (const rule of cfg.chatRules) {
        const matches = exact ? needle === rule.trigger : sentence.includes(' ' + rule.trigger + ' ');
        if (matches && (!best || rule.trigger.length > best.trigger.length)) best = rule;
    }
    // Las respuestas personalizadas de v3 siguen funcionando con prefijo y al decir su nombre solo.
    const legacy = text.trim().toLowerCase();
    const custom = Object.hasOwn(cfg.custom, legacy) ? cfg.custom[legacy] : null;
    if (custom && (!best || !best.response)) return { ...best, response: custom, trigger: best?.trigger || legacy };
    return best;
}
module.exports = { parseRequest, saveRequest, removeMemory, listMemory, matchingRule };
