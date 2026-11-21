'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { UserError, Serial, cut } = require('./core');
const { isAdmin } = require('./access');
const { P } = require('./permissions');
const { checkedRole } = require('./rewards');

const row = (...controls) => new ActionRowBuilder().addComponents(controls);
const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId('tm:verify:' + action).setLabel(label).setStyle(style);
const input = (key, label, max) => new TextInputBuilder().setCustomId(key).setLabel(label)
    .setStyle(TextInputStyle.Paragraph).setMaxLength(max).setRequired(true);
const silent = { parse: [], repliedUser: false };
const hidden = { flags: MessageFlags.Ephemeral };

function panel(settings, nonce) {
    const card = new EmbedBuilder().setColor(settings.color || '#84B9A6')
        .setTitle(settings.title).setDescription(settings.text);
    if (settings.banner) card.setImage(settings.banner);
    return { embeds: [card], components: [row(button('apply:' + nonce, 'Solicitar verificación', ButtonStyle.Primary))], allowedMentions: silent };
}
class Verification {
    constructor(store, tickets, log) {
        this.store = store; this.tickets = tickets; this.log = log;
        this.serial = new Serial();
    }
    async publish(ctx, settings, channel) {
        const old = this.store.guild(ctx.guild.id).verification;
        const nonce = randomBytes(8).toString('hex');
        const data = panel(settings, nonce);
        let msg;
        if (old.channelId === channel.id && old.messageId) {
            try { msg = await channel.messages.fetch(old.messageId); }
            catch (e) { if (e.code !== 10008) throw e; }
        }
        const sent = msg ? await msg.edit(data) : await channel.send(data);
        return { messageId: sent.id, nonce };
    }
    async retire(guild, previous) {
        if (!previous.enabled || !previous.channelId || !previous.messageId) return;
        try {
            const channel = await guild.channels.fetch(previous.channelId);
            const message = await channel.messages.fetch(previous.messageId);
            await message.edit({ content: 'Este panel de verificación está cerrado.', embeds: [], components: [], allowedMentions: silent });
        } catch (e) { if (![10003, 10008].includes(e.code)) console.warn('[VERIFICACIÓN]', e.code || e.name); }
    }
    record(guild, channelId, ticket) {
        const records = { ...this.store.guild(guild.id).verificationTickets };
        if (ticket) records[channelId] = ticket;
        else delete records[channelId];
        this.store.patchGuild(guild.id, { verificationTickets: records });
    }
    current(guild, nonce) {
        const settings = this.store.guild(guild.id).verification;
        if (!settings.enabled || settings.nonce !== nonce) throw new UserError('Este panel ya no está activo. Abre el panel actual de verificación.');
        return settings;
    }
    async open(i, nonce) {
        const guild = i.guild, uid = i.user.id;
        await this.serial.run(guild.id + ':' + uid, async () => {
            const settings = this.current(guild, nonce);
            const cfg = this.store.guild(guild.id);
            const member = await guild.members.fetch({ user: uid, force: true });
            if (member.roles.cache.has(settings.roleId)) throw new UserError('Ya tienes el rol de verificación.');
            if (settings.applicantRole && !member.roles.cache.has(settings.applicantRole)) throw new UserError('Para solicitar verificación necesitas el rol de acceso indicado en el panel.');
            for (const [id, record] of Object.entries(cfg.verificationTickets)) {
                if (record.userId !== uid) continue;
                const existing = await guild.channels.fetch(id).catch(error => { if (error.code === 10003) return null; throw error; });
                if (existing) { await i.editReply({ content: 'Tu ticket ya está abierto en <#' + id + '>.' }); return; }
                this.record(guild, id, null);
            }
            const parent = await guild.channels.fetch(settings.categoryId);
            if (parent?.type !== ChannelType.GuildCategory) throw new UserError('La categoría de verificación ya no está disponible.');
            const me = await guild.members.fetchMe();
            const permissions = parent.permissionsFor(me);
            if (!permissions?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) throw new UserError('Revisa los permisos de Timmy para crear tickets privados en la categoría.');
            const answers = settings.questions.map((q, n) => ({ name: q, value: cut(i.fields.getTextInputValue('q' + n), 900) }));
            const channel = await guild.channels.create({
                name: 'verificar-' + uid, type: ChannelType.GuildText, parent: parent.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [P.ViewChannel] },
                    { id: uid, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
                    { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageChannels] }
                ], reason: 'Solicitud de verificación de ' + uid
            });
            try {
                const card = new EmbedBuilder().setTitle('Verificación pendiente').setColor(0xe5b65b)
                    .setDescription('Solicitud de <@' + uid + '>. Al aprobar se entrega <@&' + settings.roleId + '>' +
                        (settings.removeRoleId ? ' y se retira <@&' + settings.removeRoleId + '>' : '') + '.').addFields(answers);
                const first = await channel.send({ embeds: [card], allowedMentions: silent, components: [
                    row(button('approve', 'Aprobar', ButtonStyle.Success), button('deny', 'Denegar', ButtonStyle.Danger), button('close', 'Cerrar ticket'))] });
                this.record(guild, channel.id, { userId: uid, firstId: first.id, roleId: settings.roleId, removeRoleId: settings.removeRoleId,
                    denyReason: settings.denyReason, status: 'pendiente' });
            } catch (error) { await channel.delete('No se pudo completar la apertura del ticket').catch(() => {}); throw error; }
            await i.editReply({ content: 'Tu solicitud está en <#' + channel.id + '>. Allí puedes hablar con el equipo.' });
            await this.log(guild, 'Verificación solicitada', uid + ' · ticket ' + channel.id);
        });
    }
    async handle(i) {
        if (!i.customId?.startsWith('tm:verify:')) return false;
        if (!i.guild) throw new UserError('La verificación se realiza en el servidor.');
        const [, , action, nonce] = i.customId.split(':');
        if (action === 'apply' || action === 'form') {
            const settings = this.current(i.guild, nonce);
            if (settings.channelId !== i.channelId) throw new UserError('Usa el canal de verificación de este servidor.');
            if (action === 'form') { await i.deferReply(hidden); await this.open(i, nonce); return true; }
            if (i.message.id !== settings.messageId) throw new UserError('Abre el panel de verificación actual.');
            if (!settings.questions.length) { await i.deferReply(hidden); await this.open(i, nonce); return true; }
            const form = new ModalBuilder().setCustomId('tm:verify:form:' + nonce).setTitle('Tu verificación');
            settings.questions.forEach((q, n) => form.addComponents(row(input('q' + n, q, 900))));
            await i.showModal(form); return true;
        }
        const cfg = this.store.guild(i.guild.id), id = i.channelId;
        let entry = cfg.verificationTickets[id];
        if (!entry) throw new UserError('Este ticket ya está cerrado.');
        const member = await i.guild.members.fetch({ user: i.user.id, force: true });
        if (!isAdmin(member, i.guild)) throw new UserError('Solo el dueño o un administrador puede revisar y cerrar verificaciones.');
        if (action === 'deny' && entry.denyReason) {
            const form = new ModalBuilder().setCustomId('tm:verify:reason').setTitle('Denegar verificación')
                .addComponents(row(input('reason', 'Motivo para la persona solicitante', 500)));
            await i.showModal(form); return true;
        }
        await i.deferReply(hidden);
        await this.serial.run(id, async () => {
            entry = cfg.verificationTickets[id];
            if (!entry) throw new UserError('El ticket ya está cerrado.');
            const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
            if (!isAdmin(actor, i.guild)) throw new UserError('Se necesita Administrador para continuar.');
            if (action === 'close') {
                const body = await this.tickets.transcript(i.channel);
                fs.writeFileSync(path.join(this.tickets.directory, id + '.txt'), body, { mode: 0o600 });
                await i.editReply({ content: 'Transcripción guardada. Cerrando este ticket.' });
                await i.channel.delete('Verificación cerrada por ' + actor.id);
                this.record(i.guild, id, null); return;
            }
            if (entry.status !== 'pendiente' && !(entry.status === 'aprobando' && action === 'approve')) throw new UserError('Esta solicitud ya tiene una decisión.');
            if (!['approve', 'deny', 'reason'].includes(action)) throw new UserError('Acción desconocida.');
            let notice;
            if (action === 'approve') {
                if (!cfg.verification.enabled || cfg.verification.roleId !== entry.roleId || cfg.verification.removeRoleId !== entry.removeRoleId) {
                    throw new UserError('La configuración cambió. Cierra este ticket y usa el panel actual para una nueva solicitud.');
                }
                const target = await i.guild.members.fetch({ user: entry.userId, force: true });
                const grant = await checkedRole(i.guild, entry.roleId, cfg, actor, 'verification');
                const remove = entry.removeRoleId && await checkedRole(i.guild, entry.removeRoleId, cfg, actor, 'verification-remove');
                // Once Discord accepts the grant, retries must finish the same decision.
                if (entry.status !== 'aprobando') this.record(i.guild, id, { ...entry, status: 'aprobando' });
                if (!target.roles.cache.has(grant.id)) await target.roles.add(grant, 'Verificación aprobada por ' + actor.id);
                if (remove && target.roles.cache.has(remove.id)) await target.roles.remove(remove, 'Verificación aprobada por ' + actor.id);
                notice = 'Verificación aprobada. Se te asignó <@&' + grant.id + '>.';
            } else {
                if (entry.denyReason && action !== 'reason') throw new UserError('Indica el motivo de la denegación.');
                notice = 'Verificación denegada.' + (action === 'reason' ? ' Motivo: ' + cut(i.fields.getTextInputValue('reason'), 500) : '');
            }
            const status = action === 'approve' ? 'aprobada' : 'denegada';
            this.record(i.guild, id, { ...entry, status });
            await i.channel.send({ content: '<@' + entry.userId + '> ' + notice, allowedMentions: { users: [entry.userId], parse: [] },
                components: [row(button('close', 'Cerrar y guardar transcripción'))] });
            await this.log(i.guild, 'Verificación ' + status, entry.userId + ' · revisó ' + actor.id);
            await i.editReply({ content: 'Decisión guardada.' });
        });
        return true;
    }
}
module.exports = { Verification };
