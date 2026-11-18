'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { UserError } = require('./core');
const MAX_SOURCE = 12000;
const DEFAULT_TEMPLATE = '{embed}$v{title: Bienvenido a {guild.name}}$v{description: ¡Hola {user.mention}! Nos alegra verte aquí.}$v{thumbnail: {user.avatar}}$v{color: #b8a5ff}$v{footer: Ahora somos {guild.count} miembros}';
function parseTemplate(input) {
    const text = String(input || '').trim().replace(/^```(?:\w+)?\s*\n?/, '').replace(/\n?```$/, '').trim();
    if (!text || text.length > MAX_SOURCE) throw new UserError(`La plantilla debe tener entre 1 y ${MAX_SOURCE} caracteres.`);
    if (!/^\{(?:embed\}|message\s*:)/i.test(text)) return { content: text, embeds: [], buttons: [] };
    const model = { content: '', embeds: [], buttons: [] };
    let current;
    for (let i = 0; i < text.length;) {
        if (/\s/.test(text[i])) { i++; continue; }
        if (text.startsWith('$v', i)) { i += 2; continue; }
        if (text[i] !== '{') throw new UserError('Separa los bloques con $v. Ejemplo: {embed}$v{description: Hola}');
        const start = ++i; let depth = 1;
        while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
        if (depth) throw new UserError('Falta cerrar una llave } en la plantilla.');
        const block = text.slice(start, i - 1), colon = block.indexOf(':');
        const key = (colon < 0 ? block : block.slice(0, colon)).trim().toLowerCase();
        const value = colon < 0 ? '' : block.slice(colon + 1).trim();
        if (key === 'embed') {
            current = {}; model.embeds.push(current);
            if (model.embeds.length > 3) throw new UserError('Máximo 3 embeds por plantilla.');
        } else if (key === 'message') model.content = value;
        else if (key === 'button') {
            const [label, url, emoji, ...extra] = value.split('&&').map(x => x.trim());
            if (!label || !url || extra.length || model.buttons.length >= 5) throw new UserError('Botón: {button: Texto && https://enlace && 🎵}. Máximo 5 botones de enlace.');
            model.buttons.push({ label, url, ...(emoji ? { emoji } : {}) });
        } else {
            if (!current) { current = {}; model.embeds.push(current); }
            if (['title', 'description', 'color', 'url', 'thumbnail', 'image', 'timestamp'].includes(key)) current[key] = value;
            else if (['footer', 'author'].includes(key)) {
                const [text, icon, url, ...extra] = value.split('&&').map(x => x.trim());
                if (extra.length || (key === 'footer' && url)) throw new UserError('Usa texto && URL del icono (author admite también && enlace).');
                current[key] = { text, icon, ...(url ? { url } : {}) };
            } else if (key === 'field') {
                const [name, fieldValue, inline = 'false', ...extra] = value.split('&&').map(x => x.trim());
                if (!name || !fieldValue || extra.length || !['true','false'].includes(inline)) throw new UserError('Campo: {field: Nombre && Valor && true|false}');
                (current.fields ||= []).push({ name, value: fieldValue, inline: inline === 'true' });
            } else throw new UserError(`Propiedad de embed desconocida: ${key.slice(0, 40)}.`);
        }
    }
    return model;
}
function variables(member, now = new Date()) {
    const user = member.user || member, guild = member.guild;
    return {
        'user.mention': `<@${member.id}>`, 'user.name': user.username || 'usuario',
        'user.username': user.username || 'usuario', 'user.id': member.id,
        'user.avatar': user.displayAvatarURL?.({ size: 1024 }) || '',
        'guild.name': guild.name, 'guild.id': guild.id, 'guild.count': String(guild.memberCount ?? 0),
        'guild.icon': guild.iconURL?.({ size: 1024 }) || '', 'date.now': now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        user: `<@${member.id}>`, username: user.username || 'usuario', server: guild.name, count: String(guild.memberCount ?? 0)
    };
}
function expand(text, values) { return String(text || '').replace(/\{([a-z.]+)\}/g, (match, key) => Object.hasOwn(values, key) ? values[key] : match); }
function httpURL(value) {
    try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || value.length > 2048) throw new Error();
        return u.href;
    } catch { throw new UserError('Las imágenes y botones necesitan un enlace completo http:// o https://.'); }
}
function renderTemplate(model, member, { pingUser = false, everyone = false, now = new Date() } = {}) {
    const v = variables(member, now), text = value => expand(value, v);
    const content = text(model.content);
    if (content.length > 2000) throw new UserError('El mensaje fuera del embed supera 2000 caracteres.');
    if (model.embeds.length > 3 || model.buttons.length > 5) throw new UserError('Máximo 3 embeds y 5 enlaces.');
    const embeds = model.embeds.map(raw => {
        const e = new EmbedBuilder();
        if (raw.color) {
            if (!/^#?[0-9a-f]{6}$/i.test(raw.color)) throw new UserError('Color inválido. Usa un hexadecimal como #b8a5ff.');
            e.setColor(parseInt(raw.color.replace('#', ''), 16));
        }
        if (raw.title) e.setTitle(text(raw.title));
        if (raw.description) e.setDescription(text(raw.description));
        if (raw.url) e.setURL(httpURL(text(raw.url)));
        for (const field of ['thumbnail','image']) if (raw[field] && text(raw[field])) e[field === 'image' ? 'setImage' : 'setThumbnail'](httpURL(text(raw[field])));
        if (raw.footer?.text) e.setFooter({ text: text(raw.footer.text), ...(raw.footer.icon && text(raw.footer.icon) ? { iconURL: httpURL(text(raw.footer.icon)) } : {}) });
        if (raw.author?.text) e.setAuthor({ name: text(raw.author.text), ...(raw.author.icon && text(raw.author.icon) ? { iconURL: httpURL(text(raw.author.icon)) } : {}), ...(raw.author.url ? { url: httpURL(text(raw.author.url)) } : {}) });
        if (raw.timestamp === 'true') e.setTimestamp(now);
        else if (raw.timestamp && raw.timestamp !== 'false') throw new UserError('timestamp admite true o false.');
        if (raw.fields?.length) e.addFields(raw.fields.map(f => ({ name: text(f.name), value: text(f.value), inline: f.inline })));
        const json = e.toJSON();
        if (!json.title && !json.description && !json.image && !json.thumbnail && !json.fields?.length && !json.author && !json.footer) throw new UserError('El embed está vacío. Añade título, descripción o imagen.');
        return json;
    });
    const total = embeds.reduce((sum,e) => sum + (e.title?.length||0) + (e.description?.length||0) + (e.footer?.text.length||0) + (e.author?.name.length||0) + (e.fields||[]).reduce((s,f)=>s+f.name.length+f.value.length,0),0);
    if (total > 6000) throw new UserError('Los textos de todos los embeds juntos superan 6000 caracteres.');
    if (!content && !embeds.length) throw new UserError('El mensaje está vacío.');
    const components = model.buttons.length ? [new ActionRowBuilder().addComponents(model.buttons.map(b => {
        const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text(b.label)).setURL(httpURL(text(b.url)));
        if (b.emoji) button.setEmoji(b.emoji);
        return button;
    })).toJSON()] : [];
    return { content, embeds, components, allowedMentions: { parse: everyone ? ['everyone'] : [], users: pingUser ? [member.id] : [], repliedUser: false } };
}
function validateTemplate(input, member) {
    const model = typeof input === 'string' ? parseTemplate(input) : input;
    try { renderTemplate(model, member); }
    catch (e) { if (e instanceof UserError) throw e; throw new UserError('Un campo excede los límites de Discord o tiene un formato inválido. Título: 256; descripción: 4096; footer: 2048; botón: 80.'); }
    return model;
}
function serializeTemplate(model) {
    const blocks = [];
    if (model.content) blocks.push(`{message: ${model.content}}`);
    for (const e of model.embeds) {
        blocks.push('{embed}');
        for (const k of ['color','title','description','url','thumbnail','image','timestamp']) if (e[k]) blocks.push(`{${k}: ${e[k]}}`);
        for (const k of ['author','footer']) if (e[k]?.text) blocks.push(`{${k}: ${[e[k].text, e[k].icon || '', e[k].url || ''].join(' && ').replace(/(?: && )+$/, '')}}`);
        for (const f of e.fields || []) blocks.push(`{field: ${f.name} && ${f.value} && ${f.inline}}`);
    }
    for (const b of model.buttons) blocks.push(`{button: ${b.label} && ${b.url}${b.emoji ? ` && ${b.emoji}` : ''}}`);
    return blocks.join('$v\n');
}
function greetings(cfg, kind) {
    return Object.hasOwn(cfg, `${kind}Messages`) ? cfg[`${kind}Messages`] : (cfg[kind] ? [cfg[kind]] : []);
}
function saveGreetings(cfg, kind, entries) {
    cfg[`${kind}Messages`] = entries; cfg[kind] = entries[0] || null;
}
module.exports = { parseTemplate, validateTemplate, renderTemplate, serializeTemplate, greetings, saveGreetings, DEFAULT_TEMPLATE, MAX_SOURCE, httpURL };
