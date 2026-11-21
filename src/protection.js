'use strict';

const { ExpiringCache, Serial, UserError } = require('./core');
const { P } = require('./permissions');

class Protection {
    constructor(store, log, welcomeRole) {
        this.store = store; this.log = log; this.welcomeRole = welcomeRole;
        this.windows = new ExpiringCache(10000);
        this.alerts = new ExpiringCache(60000);
        this.timers = new Map(); this.serial = new Serial();
    }
    async observe(guild, kind) {
        const cfg = this.store.guild(guild.id);
        if (!cfg.protection.enabled) return;
        const key = guild.id + ':' + kind, now = Date.now(), joins = kind === 'joins';
        const events = (this.windows.get(key) || []).filter(t => now - t < 10000);
        events.push(now); this.windows.set(key, events.slice(-5));
        const wave = events.length >= (joins ? 5 : 3);
        if (joins && cfg.protection.gate && cfg.autorole && (wave || cfg.gateUntil > now)) {
            this.store.patchGuild(guild.id, { gateUntil: now + 60000 });
            this.schedule(guild);
        }
        if (!wave) return;
        if (this.alerts.get(key)) return;
        this.alerts.set(key, true);
        await this.log(guild, joins ? 'Entradas rápidas' : 'Eliminaciones rápidas', joins
            ? 'Al menos 5 personas entraron en 10 segundos.' + (cfg.protection.gate && cfg.autorole ? ' Se aplaza el autorrol por un minuto de calma.' : '')
            : 'Se eliminaron al menos 3 canales o roles en 10 segundos. Revisa el registro de auditoría de Discord.');
    }
    async joined(member) {
        if (member.user.bot) return;
        await this.observe(member.guild, 'joins');
        const cfg = this.store.guild(member.guild.id);
        if (!cfg.autorole) return;
        if (cfg.protection.enabled && cfg.protection.gate && cfg.gateUntil > Date.now()) {
            const pending = { ...cfg.pendingWelcomeRoles, [member.id]: true };
            this.store.patchGuild(member.guild.id, { pendingWelcomeRoles: pending });
            this.schedule(member.guild);
        } else await this.welcomeRole(member);
    }
    schedule(guild) {
        clearTimeout(this.timers.get(guild.id));
        this.timers.delete(guild.id);
        const cfg = this.store.guild(guild.id);
        const pending = Object.values(cfg.pendingWelcomeRoles);
        if (!pending.length) return;
        const nextRetry = pending.reduce((min, retry) => Math.min(min, retry === true ? 0 : retry), Infinity);
        const gateEnd = cfg.protection.enabled && cfg.protection.gate ? cfg.gateUntil : 0;
        const wait = Math.max(gateEnd, nextRetry) - Date.now();
        const timer = setTimeout(() => {
            this.timers.delete(guild.id);
            this.release(guild).catch(error => console.warn('[PROTECTION]', error.code || error.name));
        }, Math.max(1000, wait + 100));
        timer.unref(); this.timers.set(guild.id, timer);
    }
    async release(guild) {
        return this.serial.run('gate:' + guild.id, async () => {
            const cfg = this.store.guild(guild.id);
            for (const id of Object.keys(cfg.pendingWelcomeRoles || {})) {
                if (cfg.protection.enabled && cfg.protection.gate && cfg.gateUntil > Date.now()) break;
                const retry = cfg.pendingWelcomeRoles[id];
                if (retry !== true && retry > Date.now()) continue;
                try {
                    const member = await guild.members.fetch({ user: id, force: true });
                    if (cfg.autorole) await this.welcomeRole(member);
                } catch (error) {
                    if (error.code !== 10007) {
                        this.store.patchGuild(guild.id, { pendingWelcomeRoles: { ...cfg.pendingWelcomeRoles, [id]: Date.now() + 300000 } });
                        if (retry === true) await this.log(guild, 'Revisa el autorrol', 'Timmy volverá a intentar entregar el autorrol pendiente a ' + id + '.');
                        continue;
                    }
                }
                const pending = { ...cfg.pendingWelcomeRoles }; delete pending[id];
                this.store.patchGuild(guild.id, { pendingWelcomeRoles: pending });
            }
            this.schedule(guild);
        });
    }
    async lock(ctx, channel, locked) {
        return this.serial.run('lock:' + channel.id, async () => {
            const cfg = this.store.guild(ctx.guild.id), key = ctx.guild.id;
            const me = await ctx.guild.members.fetchMe();
            if (!channel.permissionsFor(me)?.has(P.ManageRoles)) throw new UserError('Timmy necesita Gestionar roles en ese canal para editar sus permisos.');
            const exists = Object.hasOwn(cfg.locks, channel.id);
            if (locked === exists) throw new UserError(locked ? 'Este canal ya tiene un bloqueo registrado.' : 'Este canal no tiene un bloqueo de Timmy.');
            if (locked) {
                const overwrite = channel.permissionOverwrites.cache.get(key);
                const previous = overwrite?.allow.has(P.SendMessages) ? true : overwrite?.deny.has(P.SendMessages) ? false : null;
                this.store.patchGuild(key, { locks: { ...cfg.locks, [channel.id]: previous } });
                try { await channel.permissionOverwrites.edit(key, { SendMessages: false }); }
                catch (err) {
                    // Keep the original overwrite recoverable if Discord applied an ambiguous request.
                    throw new UserError('Discord no confirmó el bloqueo. Usa Desbloquear para restaurar el permiso anterior.');
                }
            } else {
                await channel.permissionOverwrites.edit(key, { SendMessages: cfg.locks[channel.id] });
                const next = { ...cfg.locks }; delete next[channel.id]; this.store.patchGuild(key, { locks: next });
            }
            await this.log(ctx.guild, locked ? 'Bloqueo de canal' : 'Canal restaurado', ctx.user.id + ' · ' + channel.id);
            return locked ? 'Canal bloqueado para @everyone. Los permisos explícitos de otros roles pueden permitir escribir.' : 'Permiso anterior restaurado.';
        });
    }
    close() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
module.exports = { Protection };
