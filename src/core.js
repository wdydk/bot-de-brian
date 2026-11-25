'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class UserError extends Error {}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cut = (value, n = 1024) => String(value ?? '').slice(0, n) || '—';
const idOf = value => {
    const id = String(value || '').replace(/[<@!&#>]/g, '');
    if (!/^\d{17,20}$/.test(id)) throw new UserError('Usa una mención o un ID exacto.');
    return id;
};
function integer(value, min, max) {
    if (!/^\d+$/.test(String(value))) throw new UserError(`Escribe un entero entre ${min} y ${max}.`);
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new UserError(`El valor debe estar entre ${min} y ${max}.`);
    return n;
}
function duration(value) {
    const match = /^(\d+)(s|m|h|d)$/i.exec(String(value || ''));
    if (!match) throw new UserError('Usa una duración como 30s, 10m, 2h o 1d.');
    const ms = Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
    if (!Number.isSafeInteger(ms) || ms < 1000 || ms > 28 * 86400000) throw new UserError('La duración debe ser de 1 segundo a 28 días.');
    return ms;
}
function tokenize(text) {
    return [...String(text).matchAll(/"([^"\n]*)"|'([^'\n]*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}
function render(text, member) {
    const values = {
        user: `<@${member.id}>`, username: member.user.username,
        server: member.guild.name, count: String(member.guild.memberCount)
    };
    return String(text).replace(/\{(user|username|server|count)\}/g, (_, key) => values[key]).slice(0, 1900);
}
function guildDefaults() {
    return {
        prefix: process.env.PREFIX || '>', welcome: null, goodbye: null,
        autorole: null, logChannel: null, djRole: null, snipe: false,
        automod: false, bansEnabled: true, ai: true, knowledge: '', knowledgePages: {}, knowledgeRevision: 0, reactions: [],
        custom: {}, customActions: {}, staffPolicy: {mode:'off',staff:null,mod:null,admin:null,channel:null,minutes:10,whitelist:[],revision:0}, chatRules: [], delegatedRoles: {}, warnings: {}, roleButtons: {},
        ticketCategory: null, supportRole: null, ticketPanelChannel: null, ticketPanelMessage: null,
        levels: { enabled: false, channelId: null, template: '', revision: 0 }, levelRoles: {},
        boosts: { enabled: false, channelId: null, template: '', perks: '', roleId: null, revision: 0 }, boostMembers: {}, personalRoles: {},
        birthday: { enabled: false, channelId: null, roleId: null, timezone: 'UTC', hour: '00:00', text: '🎂 ¡Feliz cumpleaños, {user}! Que tengas un gran día.', revision: 0 }, birthdays: {}, birthdayDeliveries: {},
        verification: { enabled: false, channelId: null, categoryId: null, roleId: null, removeRoleId: null,
            applicantRole: null, questions: ['¿Por qué quieres entrar al servidor?'], denyReason: true,
            title: 'Verifica tu cuenta', text: 'Abre una solicitud privada para presentarte al equipo.', color: '#84b9a6', banner: '',
            messageId: null, nonce: null, revision: 0 }, verificationTickets: {},
        protection: { enabled: false, gate: false, revision: 0 }, gateUntil: 0, pendingWelcomeRoles: {}, locks: {},
        setupAt: null
    };
}
class Store {
    constructor(directory) {
        this.directory = directory;
        fs.mkdirSync(directory, { recursive: true });
        this.file = path.join(directory, 'timmy-v3.json');
        this.data = { version: 3, guilds: {}, tickets: {} };
        if (fs.existsSync(this.file)) {
            // Nunca reemplaza un archivo ilegible por uno vacío.
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (parsed.version !== 3 || !isObject(parsed.guilds) || !isObject(parsed.tickets)) {
                throw new Error('Memoria incompatible. Conserva timmy-v3.json y restaura una copia válida.');
            }
            this.data = parsed;
        } else this.save();
    }
    guild(id) {
        if (!this.data.guilds[id]) this.data.guilds[id] = guildDefaults();
        // Añade campos nuevos sin borrar la configuración de v3.
        const cfg = this.data.guilds[id];
        for (const [key, value] of Object.entries(guildDefaults())) {
            if (!Object.hasOwn(cfg, key)) cfg[key] = value;
        }
        return this.data.guilds[id];
    }
    patchGuild(id, changes) {
        const cfg = this.guild(id);
        const before = Object.fromEntries(Object.keys(changes).map(key => [key, cfg[key]]));
        Object.assign(cfg, changes);
        try { this.save(); }
        catch (error) { Object.assign(cfg, before); throw error; }
    }
    save() {
        const tmp = `${this.file}.tmp`;
        const body = JSON.stringify(this.data, null, 2);
        const fd = fs.openSync(tmp, 'w', 0o600);
        try { fs.writeFileSync(fd, body, 'utf8'); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
        fs.renameSync(tmp, this.file);
    }
    warn(guild, user, moderator, reason) {
        const cfg = this.guild(guild);
        const list = cfg.warnings[user] ||= [];
        const entry = { id: randomUUID().slice(0, 8), moderator, reason: cut(reason, 500), at: Date.now() };
        list.push(entry);
        if (list.length > 100) list.shift();
        this.save();
        return entry;
    }
}
class Serial {
    constructor() { this.jobs = new Map(); }
    run(key, task) {
        const next = (this.jobs.get(key) || Promise.resolve()).catch(() => {}).then(task);
        this.jobs.set(key, next);
        const cleanup = () => { if (this.jobs.get(key) === next) this.jobs.delete(key); };
        next.then(cleanup, cleanup);
        return next;
    }
}
class ExpiringCache {
    constructor(ttl, limit = 1000) { this.ttl = ttl; this.limit = limit; this.items = new Map(); }
    set(key, value) {
        this.items.delete(key);
        this.items.set(key, { value, expires: Date.now() + this.ttl });
        while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value);
    }
    get(key) {
        const item = this.items.get(key);
        if (!item || item.expires < Date.now()) { this.items.delete(key); return undefined; }
        return item.value;
    }
    delete(key) { this.items.delete(key); }
}
function knowledgeText(cfg) {
    return [cfg.knowledge || '', ...Object.entries(cfg.knowledgePages || {}).map(([name, text]) => `[${name}]\n${text}`)]
        .filter(Boolean).join('\n\n');
}
function updateKnowledge(store, guildId, action, name, text) {
    const cfg = store.guild(guildId);
    const next = { knowledge: cfg.knowledge, knowledgePages: { ...cfg.knowledgePages } };
    if (action === 'clear') {
        next.knowledge = ''; next.knowledgePages = {};
    } else if (action === 'general') {
        if (!text || text.length > 4000) throw new UserError('Uso: >knowledge add reglas Texto de las reglas');
        next.knowledge = text;
    } else {
        name = (name || '').toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(name) || ['__proto__','constructor','prototype'].includes(name)) throw new UserError('Nombre de ficha: 1–32 letras sin acentos, números, _ o -.');
        if (action === 'remove') {
            if (!Object.hasOwn(next.knowledgePages,name)) throw new UserError('Esa ficha no existe en este servidor.');
            delete next.knowledgePages[name];
        } else {
            if (action !== 'add' || !text || text.length > 4000) throw new UserError('Cada ficha admite 1–4000 caracteres.');
            next.knowledgePages[name] = text;
        }
    }
    if (Object.keys(next.knowledgePages).length > 20) throw new UserError('Máximo 20 fichas por servidor.');
    if (knowledgeText(next).length > 16000) throw new UserError('La información de este servidor admite 16000 caracteres en total.');
    store.patchGuild(guildId,{...next,knowledgeRevision:cfg.knowledgeRevision+1,setupAt:cfg.setupAt || Date.now()});
}
module.exports = { updateKnowledge, UserError, cut, idOf, integer, duration, tokenize, render, Store, Serial, ExpiringCache, knowledgeText };
