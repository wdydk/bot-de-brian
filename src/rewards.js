'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MessageType } = require('discord.js');
const { UserError, Serial, ExpiringCache } = require('./core');
const { P, safeRole } = require('./permissions');
const { guardCommunityRole } = require('./delegation');
const { renderTemplate, parseTemplate, validateTemplate } = require('./templates');

const MILESTONES = [
    { level: 5, color: 0xe34c4c, label: 'rojo' },
    { level: 10, color: 0xf5c940, label: 'amarillo' },
    { level: 20, color: 0x3ba765, label: 'verde' },
    { level: 50, color: 0x010101, label: 'negro' },
    { level: 100, color: 0x9359da, label: 'morado' }
];
const roleName = level => '𝑙𝑒𝑣𝑒𝑙 ' + level;
const XP_PER_MESSAGE = 15, XP_PER_LEVEL = 100, COOLDOWN = 60000;
const levelOf = xp => Math.floor(xp / XP_PER_LEVEL);
const DEFAULT_MESSAGES = {
    levels: '{embed}$v{message: {user.mention}}$v{author: {user.name} && {user.avatar}}$v{title: ¡Subiste de nivel!}$v{description: Llegaste al **nivel {level}** en {guild.name}. Ya tienes **{xp} XP**.}$v{thumbnail: {user.avatar}}$v{color: #9381ff}',
    boosts: '{embed}$v{message: {user.mention}}$v{title: ¡Gracias por el boost, {user.name}!}$v{description: Tu boost apoya a **{guild.name}**.\\n\\n{boost.perks}}$v{thumbnail: {user.avatar}}$v{color: #ec89bd}'.replaceAll('\\n', '\n')
};
const boostTypes = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);
const perksText = settings => settings.perks || '¡Gracias por apoyar a la comunidad!';
const eventValues = (section, settings, xp = 500) => section === 'levels'
    ? { level: levelOf(xp), xp } : { 'boost.perks': perksText(settings) };

async function checkedRole(guild, roleId, cfg, actor, kind) {
    const role = await guild.roles.fetch(roleId, { force: true });
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has(P.ManageRoles)) throw new UserError('Timmy necesita Gestionar roles en este servidor.');
    safeRole(role, bot, actor);
    guardCommunityRole(role, cfg);
    if (role.permissions.any([P.ViewAuditLog, P.ManageGuildExpressions, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.PinMessages])) {
        throw new UserError('Elige un rol de comunidad sin permisos reservados al staff.');
    }
    const automatic = [...Object.values(cfg.roleButtons), ...Object.values(cfg.personalRoles || {})];
    if (kind !== 'birthday') automatic.push(cfg.birthday?.roleId);
    if (kind !== 'verification-remove') automatic.push(cfg.autorole);
    if (kind !== 'levels') automatic.push(...Object.values(cfg.levelRoles));
    if (kind !== 'boosts') automatic.push(cfg.boosts.roleId);
    if (!kind.startsWith('verification')) automatic.push(cfg.verification.roleId, cfg.verification.removeRoleId);
    if (automatic.includes(role.id)) throw new UserError('Elige un rol distinto de los que ya entrega otro módulo.');
    return role;
}

class Rewards {
    constructor(store, log) {
        this.store = store;
        this.log = log;
        this.serial = new Serial();
        this.roleAlerts = new ExpiringCache(600000);
    }
    progress() {
        if (!this.db) {
            this.db = new DatabaseSync(path.join(this.store.directory, 'timmy-xp.sqlite'));
            this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS xp (guild TEXT NOT NULL, user TEXT NOT NULL, total INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY(guild,user))');
            this.getXp = this.db.prepare('SELECT total FROM xp WHERE guild = ? AND user = ?');
            this.addXp = this.db.prepare('INSERT INTO xp VALUES(?,?,?,?) ON CONFLICT(guild,user) DO UPDATE SET total = xp.total + excluded.total, last_at = excluded.last_at WHERE excluded.last_at - xp.last_at >= ? RETURNING total');
        }
        return this;
    }
    close() { if (this.db) { this.db.close(); this.db = null; } }
    xp(guildId, userId) { return this.progress().getXp.get(guildId, userId)?.total || 0; }

    leaderboard(guildId, page = 0, userId = '') {
        const db = this.progress().db;
        const rows = userId ? db.prepare('SELECT user,total FROM xp WHERE guild=? AND user=?').all(guildId,userId) :
            db.prepare('SELECT user,total FROM xp WHERE guild=? ORDER BY total DESC,user LIMIT 26 OFFSET ?').all(guildId,page*25);
        return { rows:rows.slice(0,25),more:rows.length>25 };
    }
    async setXp(guild, userId, total, expected) {
        return this.serial.run('xp:'+guild.id+':'+userId, async () => {
            const member = await guild.members.fetch({user:userId,force:true}).catch(()=>null);
            if (!member || member.user.bot) throw new UserError('Elige un miembro de este servidor.');
            const old = this.xp(guild.id,userId);
            if (expected !== null && expected !== old) throw new UserError('La XP cambió desde que abriste la página. Actualízala antes de guardar.');
            if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new UserError('Indica una XP entre 0 y 2147483647.');
            this.progress().db.prepare('INSERT INTO xp VALUES(?,?,?,0) ON CONFLICT(guild,user) DO UPDATE SET total=excluded.total').run(guild.id,userId,total);
            const cfg = this.store.guild(guild.id);
            if (!cfg.levels.enabled) return;
            for (const {level} of MILESTONES) {
                const id = cfg.levelRoles[level], earned = levelOf(total)>=level;
                if (!id || earned === member.roles.cache.has(id)) continue;
                try {
                    const role = await checkedRole(guild,id,cfg,null,'levels');
                    await member.roles[earned ? 'add' : 'remove'](role,'Ajuste de XP del panel');
                } catch { throw new UserError('XP guardada. Revisa la jerarquía de roles y vuelve a guardar el mismo total para sincronizarlos.'); }
            }
        });
    }
    async provision(guild, actor) {
        const cfg = this.store.guild(guild.id);
        const me = await guild.members.fetchMe();
        if (!me.permissions.has(P.ManageRoles)) throw new UserError('Timmy necesita Gestionar roles para preparar los cinco roles de nivel.');
        const roles = await guild.roles.fetch();
        // Never adopt an unrelated role by its display name; it may grant private channel access.
        for (const { level } of MILESTONES) {
            if (!roles.has(cfg.levelRoles[level]) && [...roles.values()].some(role => role.name === roleName(level))) {
                throw new UserError('Ya existe otro rol llamado ' + roleName(level) + '. Cámbiale el nombre y vuelve a guardar.');
            }
        }
        for (const { level, color } of [...MILESTONES].reverse()) {
            let role = roles.get(cfg.levelRoles[level]);
            if (!role) {
                role = await guild.roles.create({ name: roleName(level), colors: { primaryColor: color }, permissions: [], mentionable: false,
                    reason: 'Recompensa de nivel configurada por ' + actor.id });
                this.store.patchGuild(guild.id, { levelRoles: { ...cfg.levelRoles, [level]: role.id } });
            }
            await checkedRole(guild, role.id, cfg, actor, 'levels');
        }
    }
    async award(message) {
        const { guild, member, channel } = message;
        if (!member || member.user.bot || message.webhookId || message.system || !message.content?.trim()) return;
        const cfg = this.store.guild(guild.id);
        if (!cfg.levels.enabled || (message.type !== undefined && ![MessageType.Default, MessageType.Reply].includes(message.type))) return;
        return this.serial.run('xp:' + guild.id + ':' + member.id, async () => {
            if (!cfg.levels.enabled) return;
            const row = this.progress().addXp.get(guild.id, member.id, XP_PER_MESSAGE, message.createdTimestamp ?? Date.now(), COOLDOWN);
            if (!row) return;
            const level = levelOf(row.total);
            if (level > levelOf(row.total - XP_PER_MESSAGE)) {
                const dest = cfg.levels.channelId ? await guild.channels.fetch(cfg.levels.channelId).catch(() => null) : channel;
                try {
                    if (dest) await dest.send(this.payload('levels', member, row.total));
                } catch (error) { await this.log(guild, 'Aviso de nivel pendiente de revisar', String(error.code || error.name)); }
            }
            for (const milestone of MILESTONES) {
                const id = cfg.levelRoles[milestone.level];
                if (milestone.level > level || !id || member.roles.cache.has(id)) continue;
                try {
                    const role = await checkedRole(guild, id, cfg, null, 'levels');
                    await member.roles.add(role, 'Nivel ' + milestone.level + ' alcanzado');
                } catch {
                    const key = guild.id + ':' + id;
                    if (!this.roleAlerts.get(key)) {
                        this.roleAlerts.set(key, true);
                        await this.log(guild, 'Revisa los roles de nivel', 'No pude entregar ' + roleName(milestone.level) + '. Revisa la jerarquía y guarda Niveles en /setup.');
                    }
                }
            }
        });
    }
    payload(section, member, xp, settings = this.store.guild(member.guild.id)[section], preview = false) {
        const source = settings.template || DEFAULT_MESSAGES[section];
        const values = eventValues(section, settings, xp);
        return renderTemplate(parseTemplate(source), member, { values, pingUser: !preview });
    }
    async syncBoost(member, { systemId, systemTime, reconcile = false } = {}) {
        const guild = member.guild;
        return this.serial.run('boost:' + guild.id + ':' + member.id, async () => {
            const cfg = this.store.guild(guild.id), settings = cfg.boosts;
            let old = cfg.boostMembers[member.id];
            if (!settings.enabled && !old) return;
            const since = member.premiumSinceTimestamp;
            const save = entry => {
                const entries = { ...cfg.boostMembers };
                if (entry) entries[member.id] = entry;
                else delete entries[member.id];
                this.store.patchGuild(guild.id, { boostMembers: entries });
            };
            if (old?.roleId && (!since || !settings.enabled || settings.roleId !== old.roleId)) {
                const role = await guild.roles.fetch(old.roleId, { force: true }).catch(error => {
                    if (error.code === 10011) return null;
                    throw error;
                });
                if (role && member.roles.cache.has(role.id)) {
                    await checkedRole(guild, role.id, cfg, null, 'boosts');
                    await member.roles.remove(role, 'Fin de la recompensa de boost');
                }
                old = { ...old, roleId: null }; save(old);
            }
            if (!since || !settings.enabled) { if (old) save(null); return; }
            const newPeriod = old?.since !== since;
            const state = { since, roleId: old?.roleId || null, lastMessage: newPeriod ? null : old?.lastMessage || null,
                pendingNotice: newPeriod ? !reconcile : Boolean(old?.pendingNotice) };
            if (systemId && (!state.lastMessage || BigInt(systemId) > BigInt(state.lastMessage))) {
                // The initial system message and member update describe the same boost, in either order.
                const additional = !newPeriod && (state.lastMessage || systemTime - since > COOLDOWN);
                state.lastMessage = systemId;
                if (additional) state.pendingNotice = true;
                save(state);
            } else if (newPeriod) save(state);
            if (settings.roleId && !member.roles.cache.has(settings.roleId)) {
                try {
                    const role = await checkedRole(guild, settings.roleId, cfg, null, 'boosts');
                    await member.roles.add(role, 'Recompensa por boost');
                    state.roleId = role.id; save({ ...state });
                } catch (error) {
                    await this.log(guild, 'Revisa el rol de boost', 'No se pudo entregar el rol a ' + member.id + '. Comprueba los permisos y la jerarquía.');
                }
            }
            if (state.pendingNotice && settings.channelId) {
                const channel = await guild.channels.fetch(settings.channelId);
                if (channel) {
                    await channel.send(this.payload('boosts', member));
                    save({ ...state, pendingNotice: false });
                }
            }
        });
    }
    async reconcile(guild, discover = true) {
        const cfg = this.store.guild(guild.id);
        const ids = new Set(Object.keys(cfg.boostMembers));
        if (discover && cfg.boosts.enabled && cfg.boosts.roleId && guild.premiumSubscriptionCount !== 0) {
            // A boost may have started while Timmy was offline or before this module was enabled.
            let after;
            try {
                for (;;) {
                    const page = await guild.members.list({ limit: 1000, after, cache: false });
                    for (const member of page.values()) if (member.premiumSinceTimestamp) ids.add(member.id);
                    if (page.size < 1000) break;
                    after = page.lastKey();
                }
            } catch (error) { console.warn('[BOOST]', error.code || error.name); }
        }
        for (const id of ids) {
            try {
                const member = await guild.members.fetch({ user: id, force: true });
                await this.syncBoost(member, { reconcile: true });
            } catch (error) {
                if (error.code === 10007) await this.departed(guild, id);
                else console.warn('[BOOST]', error.code || error.name);
            }
        }
    }
    departed(guild, id) {
        return this.serial.run('boost:' + guild.id + ':' + id, () => {
            const cfg = this.store.guild(guild.id);
            if (!cfg.boostMembers[id]) return;
            const entries = { ...cfg.boostMembers }; delete entries[id];
            this.store.patchGuild(guild.id, { boostMembers: entries });
        });
    }
}

function installRewards({ add, optConfig, getChannel, rewards, store, studio, saveConfig, privateReply }) {
    add('level', 'Consulta tu nivel y cuánta experiencia falta para el siguiente', '>level',
        { aliases: ['nivel', 'lvl'], category: 'Comunidad' }, async ctx => {
            const settings = store.guild(ctx.guild.id).levels;
            if (!settings.enabled) return ctx.reply('Los niveles están apagados en este servidor.');
            const xp = rewards.xp(ctx.guild.id, ctx.user.id);
            await ctx.reply('Estás en el **nivel ' + levelOf(xp) + '** con **' + xp + ' XP**. Te faltan ' + (XP_PER_LEVEL - xp % XP_PER_LEVEL) + ' XP para subir.');
        });
    for (const [section, name] of [['levels', 'levelmessage'], ['boosts', 'boostmessage']]) {
        add(name, 'Diseña y prueba el anuncio de ' + (section === 'levels' ? 'nivel' : 'boost'), '>' + name + ' add #canal <plantilla> | test | edit | view',
            { ...optConfig(), raw: true }, async (ctx, args) => {
                const cfg = store.guild(ctx.guild.id);
                const settings = cfg[section];
                const raw = ctx.rawArgs ?? args.join(' ');
                const [action, tail = ''] = raw.trim().split(/^\s*(\S+)\s*/).slice(1);
                const save = async (text, channelId, revision) => {
                    const next = { ...cfg[section], template: text, channelId };
                    validateTemplate(text, ctx.member, { values: eventValues(section, next) });
                    await saveConfig(ctx, section, next, revision, { designOnly: true });
                };
                if (action === 'add') {
                    const match = /^(\S+)\s+([\s\S]+)$/.exec(tail);
                    if (!match) throw new UserError('Usa >' + name + ' add #canal <plantilla>.');
                    const ch = await getChannel(ctx, match[1]);
                    await save(match[2], ch.id, settings.revision);
                    return ctx.reply('Diseño guardado para <#' + ch.id + '>.' + (settings.enabled ? '' : ' Activa el módulo desde /setup.'));
                }
                if (action === 'test') return privateReply(ctx, rewards.payload(section, ctx.member, 500, settings, true));
                if (action === 'view') return privateReply(ctx, { files: [{ attachment: Buffer.from(settings.template || DEFAULT_MESSAGES[section]), name: name + '.txt' }] });
                if (action === 'edit') {
                    const channelId = settings.channelId || ctx.channel.id;
                    return studio.create(ctx, settings.template || DEFAULT_MESSAGES[section], { channelId, values: eventValues(section, settings),
                        save: text => save(text, channelId, settings.revision) });
                }
                throw new UserError('Usa add, edit, view o test con >' + name + '.');
            });
    }
}
module.exports = { Rewards, MILESTONES, roleName, DEFAULT_MESSAGES, perksText, eventValues, checkedRole, boostTypes, installRewards, levelOf, XP_PER_LEVEL };
