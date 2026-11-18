'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { UserError } = require('./core');
const catalog = require('./emoji-pack.json');
const runFile = promisify(execFile);
const ZIP_LIMIT = 4 * 1024 * 1024;
const toneGuide = Object.entries(catalog).map(([name, entry]) => name + ' = ' + entry.use).join(', ');
const markerPattern = /\[\[emoji:\s*([a-z0-9_-]+)\s*\]\]/gi;
const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const sober = /\b(?:sin emojis?|sin emoticonos|no (?:uses? )?emojis?|depresion|suicid\w*|acoso|amenaz\w*|falleci\w*|murio|maltrato|bullying|abuso|denuncia\w*|harass\w*|grief|suicid\w*|emergencia)\b/;
function fallbackTone(text) {
    if (/\b(?:geografia|capital de|continente)\b/.test(text)) return 'nerdgeo';
    if (/\b(?:codigo|programar|javascript|algoritmo|por que|como funciona|que es)\b/.test(text)) return 'nerdcat';
    if (/\b(?:estudiar|tarea|libro|examen)\b/.test(text)) return 'booklove';
    if (/\b(?:ganamos|por fin gane|lo logre|victoria)\b/.test(text)) return 'wchat';
    if (/\b(?:ticket|permisos)\b/.test(text)) return text.includes('ticket') ? 'ticket' : 'shield';
    return '';
}
function stripMarker(answer) { return answer.replace(markerPattern, '').trim(); }
function emojiChoice(value) {
    const plain = String(value || '').trim();
    const alias = plain.toLowerCase().replace(/^:|:$/g, '').replace(/^tm_/, '');
    if (Object.hasOwn(catalog, alias)) return alias;
    if (/^\p{RGI_Emoji}$/v.test(plain) || /^<a?:\w{2,32}:\d{17,20}>$/.test(plain) || /^\d{17,20}$/.test(plain)) return plain;
    throw new UserError('Elige un emoji de Discord o un nombre del pack, como nerd, nerdcat o wchat.');
}
async function readAttachment(attachment) {
    if (!attachment || !/\.zip$/i.test(attachment.name || '') || attachment.size > ZIP_LIMIT) {
        throw new UserError('Adjunta el ZIP de emoji.gg al mismo mensaje que >emojis importar (máximo 4 MiB).');
    }
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ||
        !/^\/(?:ephemeral-)?attachments\//.test(url.pathname)) throw new UserError('Adjunta el ZIP directamente en este DM.');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) throw new UserError('No pude descargar el adjunto. Vuelve a adjuntarlo.');
    const blocks = [];
    let length = 0;
    for await (const block of response.body) {
        length += block.length;
        if (length > ZIP_LIMIT) throw new UserError('El archivo supera los 4 MiB.');
        blocks.push(block);
    }
    return Buffer.concat(blocks);
}
async function preparePack(buffer) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timmy-emojis-'));
    try {
        const zip = path.join(dir, 'pack.zip');
        await fs.writeFile(zip, buffer, { mode: 0o600 });
        const { stdout } = await runFile('python3', [path.join(__dirname, '../scripts/prepare-emojis.py'), zip],
            { maxBuffer: 5 * 1024 * 1024, timeout: 25000 });
        return JSON.parse(stdout);
    } catch {
        throw new UserError('No pude preparar el pack. Usa el ZIP original de 22 emojis. En Railway, Python y FFmpeg vienen en el Dockerfile.');
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
class EmojiPack {
    constructor(client) {
        this.client = client;
        this.importing = false;
    }
    async refresh() {
        await this.client.application.emojis.fetch();
    }
    find(name) {
        return this.client.application?.emojis?.cache?.find(item => item.name === 'tm_' + name);
    }
    resolve(value, forReaction = false) {
        if (!Object.hasOwn(catalog, value)) return value;
        const emoji = this.find(value);
        if (!emoji) return catalog[value].icon;
        return forReaction ? emoji : emoji.toString();
    }
    style(answer, question, quiet = false) {
        const tags = [...answer.matchAll(markerPattern)];
        const clean = stripMarker(answer);
        const input = fold(question);
        if (!clean || quiet || sober.test(input) || sober.test(fold(clean))) return clean;
        let name = tags.length ? tags.at(-1)[1].toLowerCase() : fallbackTone(input);
        const playful = /\b(?:jaja\w*|jeje\w*|xd|lol|meme|broma|troleo|jueg\w*|duelo|pvp|aburr\w*)\b/.test(input);
        if (['bostezo', 'mad', 'fight', 'hmsus'].includes(name) && !playful) name = fallbackTone(input);
        if (!Object.hasOwn(catalog, name) || (clean.match(/```/g)?.length || 0) % 2) return clean;
        return clean + (clean.endsWith('```') ? '\n' : ' ') + this.resolve(name);
    }
    async importForOwner(ctx) {
        if (ctx.guild) throw new UserError('Para importar la colección, envíame el ZIP por DM desde la cuenta dueña de la aplicación.');
        const application = this.client.application;
        const owner = (application?.owner || (await application?.fetch())?.owner);
        if (!owner || (owner.ownerId || owner.id) !== ctx.user.id) throw new UserError('Solo el dueño de la aplicación puede importar emojis de Timmy.');
        if (this.importing) throw new UserError('Ya estoy importando la colección.');
        this.importing = true;
        try {
            const attachment = ctx.source?.attachments?.first() || ctx.source?.options?.getAttachment?.('archivo');
            const images = await preparePack(await readAttachment(attachment));
            await ctx.reply('Estoy preparando los 22 emojis. Te aviso aquí al terminar.');
            const result = await this.install(images);
            const failed = result.failed.length ? ' Pendientes: ' + result.failed.join(', ') + '. Puedes repetir la importación.' : '';
            return await ctx.reply(`Listos ${result.ready}/${Object.keys(catalog).length} emojis para Timmy.${failed}`);
        } finally { this.importing = false; }
    }
    async install(images) {
        const manager = this.client.application.emojis;
        const existing = await manager.fetch();
        const names = new Set([...existing.values()].map(e => e.name));
        const failed = [];
        let ready = 0;
        for (const alias of Object.keys(catalog)) {
            const name = 'tm_' + alias;
            if (!names.has(name)) {
                try { await manager.create({ name, attachment: images[alias] }); }
                catch (err) {
                    console.warn('[EMOJI]', name, err.code || err.name);
                    failed.push(alias); continue;
                }
            }
            ready++;
        }
        return { ready, failed };
    }
    list() {
        return Object.keys(catalog).map(name => this.resolve(name) + ' `' + name + '`').join('  ');
    }
}
module.exports = { EmojiPack, emojiChoice, catalog, toneGuide, stripMarker };
