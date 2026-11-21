'use strict';

const { randomBytes } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
    MessageFlags, ModalBuilder, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { UserError, ExpiringCache, Serial } = require('./core');
const { isAdmin } = require('./access');
const { P } = require('./permissions');
const { validateTemplate, httpURL } = require('./templates');
const { MILESTONES, DEFAULT_MESSAGES, eventValues, checkedRole, roleName } = require('./rewards');

const features = {
    levels: ['Niveles', 'XP por chat, avisos personalizados y cinco roles de recompensa', ['Canal y actividad', 'Mensaje de nivel', 'Revisión']],
    boosts: ['Boosts', 'Agradece el boost y explica qué gana la persona', ['Canal de agradecimientos', 'Beneficios del boost', 'Mensaje de boost', 'Revisión']],
    verification: ['Verificación', 'Preguntas en un ticket privado y revisión por tu equipo', ['Canal y categoría', 'Roles de verificación', 'Preguntas y panel', 'Revisión']],
    protection: ['Protección', 'Alertas por entradas o eliminaciones rápidas y pausa de autorrol', ['Alertas y entradas', 'Revisión']],
    snipe: ['Snipe', 'Consulta privada del último texto eliminado o editado', ['Historial temporal', 'Revisión']],
    lockdown: ['Lockdown', 'Bloquea un canal o restaura su permiso anterior', ['Canal y acción', 'Revisión']]
};
const sections = Object.entries(features).map(([value, [label, description]]) => ({ value, label, description }));
const row = (...items) => new ActionRowBuilder().addComponents(items);
const channelLabel = id => id ? '<#' + id + '>' : 'sin elegir';
const roleLabel = id => id ? '<@&' + id + '>' : 'ninguno';
const isDesign = kind => Object.hasOwn(DEFAULT_MESSAGES, kind);
const status = enabled => enabled ? 'Activado' : 'Apagado';
const rankList = MILESTONES.map(m => roleName(m.level) + ' · ' + m.label).join('\n');
const formFields = {
    template: [['template', 'Plantilla del mensaje', 4000]],
    perks: [['perks', '¿Qué recibe quien boostea?', 500]],
    panel: [['title', 'Título del panel', 120], ['text', 'Instrucciones para tus miembros', 1000],
        ['questions', 'Preguntas, una por línea (máximo 3)', 140], ['color', 'Color hexadecimal', 7], ['banner', 'Enlace del banner (opcional)', 1000]]
};
function editForm(id, action, draft) {
    const fields = formFields[action];
    const modal = new ModalBuilder().setCustomId('tm:community:' + id + ':submit-' + action).setTitle(
        { template: 'Editar mensaje', perks: 'Beneficios del boost', panel: 'Panel de verificación' }[action]);
    for (const [key, label, max] of fields) {
        let value = draft.settings[key];
        if (key === 'template') value ||= DEFAULT_MESSAGES[draft.kind];
        if (key === 'questions') value = value.join('\n');
        if ((value?.length || 0) > max) throw new UserError('Este diseño es demasiado largo para el formulario. Usa el comando de mensaje para editarlo.');
        const field = new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(max)
            .setStyle(['title', 'color', 'banner'].includes(key) ? TextInputStyle.Short : TextInputStyle.Paragraph)
            .setRequired(['title', 'text', 'template'].includes(key));
        if (value) field.setValue(value);
        modal.addComponents(row(field));
    }
    return modal;
}
function summary(kind, s) {
    switch (kind) {
        case 'levels': return [status(s.enabled), 'Avisos · ' + (s.channelId ? channelLabel(s.channelId) : 'canal del mensaje'),
            '15 XP por minuto de conversación. Cada 100 XP subes un nivel.', 'Roles acumulables\n' + rankList];
        case 'boosts': return [status(s.enabled), 'Agradecimientos · ' + channelLabel(s.channelId), 'Rol mientras dure el boost · ' + roleLabel(s.roleId),
            'Beneficios anunciados · ' + (s.perks || 'solo el agradecimiento')];
        case 'verification': return [status(s.enabled), 'Panel · ' + channelLabel(s.channelId), 'Categoría de tickets privados · ' + channelLabel(s.categoryId),
            'Pueden solicitar · ' + (s.applicantRole ? roleLabel(s.applicantRole) : 'todos los miembros sin verificar'),
            'Revisan · dueño y administradores', 'Al aprobar · entrega ' + roleLabel(s.roleId) + (s.removeRoleId ? ' y retira ' + roleLabel(s.removeRoleId) : ''),
            'Motivo al denegar · ' + (s.denyReason ? 'obligatorio' : 'opcional'), 'Preguntas · ' + (s.questions.join(' / ') || 'ninguna'),
            'Panel · **' + s.title + '**\n' + s.text, 'Color · ' + s.color + (s.banner ? ' · con banner' : ''), 'Cierre manual con transcripción privada'];
        case 'snipe': return [status(s.enabled), 'El staff con acceso consulta el último texto eliminado o editado en ese canal durante 5 minutos. Apagarlo borra la memoria de este servidor.'];
        case 'lockdown': return [channelLabel(s.channelId), s.locked ? 'Bloquear Enviar mensajes para @everyone.' : 'Restaurar el permiso anterior del canal.'];
        case 'protection': return [status(s.enabled), 'Aviso en registros desde 5 entradas o 3 eliminaciones de canales o roles en 10 segundos.',
            'Pausa del autorrol · ' + (s.gate ? 'hasta un minuto de calma' : 'apagada')];
    }
}
function render(id, draft, member, rewards) {
    const { kind, settings: s, step } = draft, [label, , steps] = features[kind];
    const custom = action => 'tm:community:' + id + ':' + action;
    const button = (action, text, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(custom(action)).setLabel(text).setStyle(style);
    const channels = (key, title, type = ChannelType.GuildText, optional = false) => {
        const control = new ChannelSelectMenuBuilder().setCustomId(custom(key)).setPlaceholder(title).addChannelTypes(type).setMinValues(optional ? 0 : 1);
        if (s[key]) control.setDefaultChannels(s[key]);
        return row(control);
    };
    const roles = (key, title, optional = false) => {
        const control = new RoleSelectMenuBuilder().setCustomId(custom(key)).setPlaceholder(title).setMinValues(optional ? 0 : 1);
        if (s[key]) control.setDefaultRoles(s[key]);
        return row(control);
    };
    const review = step === steps.length - 1;
    const lines = [], rows = [], embeds = [];
    const card = new EmbedBuilder().setColor(0x8194ec).setTitle(steps[step])
        .setFooter({ text: label + ' · Paso ' + (step + 1) + ' de ' + steps.length });
    if (review) {
        lines.push('Revisa lo que se aplicará al guardar.', ...summary(kind, s));
    } else if (step === 0) {
        if (kind !== 'lockdown') rows.push(row(button('enabled', s.enabled ? 'Desactivar ' + label : 'Activar ' + label,
            s.enabled ? ButtonStyle.Secondary : ButtonStyle.Primary)));
        if (kind === 'levels') {
            lines.push('El chat da 15 XP por minuto y 100 XP equivalen a un nivel. Al activar se preparan estos roles.', rankList,
                'Elige un canal de avisos o deja la selección vacía para responder donde se subió de nivel.');
            rows.push(channels('channelId', 'Canal para anunciar el nivel (opcional)', ChannelType.GuildText, true));
        } else if (kind === 'boosts') {
            lines.push('Elige dónde agradecer a quien impulse el servidor. En el siguiente paso podrás escribir los beneficios.');
            rows.push(channels('channelId', 'Canal de agradecimientos'));
        } else if (kind === 'verification') {
            lines.push('Elige dónde publicar el botón para miembros y la categoría donde Timmy abrirá sus tickets privados.');
            rows.push(channels('channelId', 'Canal del panel'), channels('categoryId', 'Categoría para tickets privados', ChannelType.GuildCategory));
        } else if (kind === 'protection') {
            lines.push(...summary(kind, s), 'Elige el canal de registros en Moderación → Siguiente.');
            rows.push(row(button('gate', s.gate ? 'Quitar pausa de autorrol' : 'Pausar autorrol durante una oleada')));
        } else if (kind === 'snipe') lines.push(...summary(kind, s));
        else {
            lines.push('Elige el canal y la acción. Timmy guardará el permiso anterior de @everyone para poder restaurarlo.');
            rows.push(channels('channelId', 'Canal que quieres cambiar'), row(button('locked', s.locked ? 'Acción actual · Bloquear' : 'Acción actual · Desbloquear')));
        }
    } else if (kind === 'verification' && step === 1) {
        lines.push('Timmy necesita Gestionar roles. El rol de verificación debe estar por debajo del suyo.');
        rows.push(roles('roleId', 'Rol que recibe al aprobar'), roles('removeRoleId', 'Rol que se retira al aprobar (opcional)', true),
            roles('applicantRole', 'Quién puede solicitar (vacío = todos)', true));
    } else if (kind === 'verification') {
        lines.push('Personaliza el panel y escribe hasta tres preguntas de 45 caracteres. Si las dejas vacías, el ticket se abre directamente.');
        rows.push(row(button('panel', 'Editar panel y preguntas'), button('denyReason', s.denyReason ? 'Motivo obligatorio · Sí' : 'Motivo obligatorio · No')));
    } else if (kind === 'boosts' && step === 1) {
        lines.push('Escribe los beneficios que verá la persona al boostear.', s.perks || 'Puedes añadir una nota o dejar solo el agradecimiento.',
            'Si quieres que Timmy entregue un rol mientras dure el boost, selecciónalo aquí.');
        rows.push(row(button('perks', 'Editar beneficios')), roles('roleId', 'Rol temporal de recompensa (opcional)', true));
    } else {
        lines.push('Usa la misma plantilla que en las bienvenidas. El ejemplo de abajo te muestra cómo quedará.',
            kind === 'levels' ? 'Variables · {user.mention}, {user.avatar}, {level}, {xp}, {guild.name}' : 'Variables · {user.mention}, {user.avatar}, {boost.perks}, {guild.name}');
        rows.push(row(button('template', 'Editar mensaje')));
    }
    card.setDescription(lines.join('\n\n')); embeds.push(card);
    let example = '';
    if (isDesign(kind) && (review || step === steps.length - 2)) {
        const preview = rewards.payload(kind, member, 500, s, true);
        const chars = e => (e.title?.length || 0) + (e.description?.length || 0) + (e.author?.name?.length || 0)
            + (e.footer?.text?.length || 0) + (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
        if ([card.toJSON(), ...preview.embeds].reduce((n, e) => n + chars(e), 0) <= 6000) {
            example = preview.content || ''; embeds.push(...preview.embeds);
        } else example = 'El diseño completo se puede previsualizar con >' + (kind === 'levels' ? 'levelmessage' : 'boostmessage') + ' test después de guardar.';
    }
    const nav = [];
    if (step > 0) nav.push(button('back', 'Atrás'));
    nav.push(review ? button('save', 'Guardar', ButtonStyle.Success) : button('next', 'Siguiente', ButtonStyle.Primary));
    nav.push(button('cancel', 'Cerrar')); rows.push(row(...nav));
    return { content: example || null, embeds, components: rows, allowedMentions: { parse: [], repliedUser: false } };
}

function communitySetup({ store, rewards, verification, protection, getChannel, getRole, setSnipe }) {
    const drafts = new ExpiringCache(15 * 60000, 500);
    const serial = new Serial();
    function settings(guildId, kind) {
        const cfg = store.guild(guildId);
        if (kind === 'lockdown') return { channelId: null, locked: true };
        if (kind === 'snipe') return { enabled: cfg.snipe, revision: Number(cfg.snipe) };
        return structuredClone(cfg[kind]);
    }
    async function save(ctx, kind, s, revision, { designOnly = false } = {}) {
        return serial.run('save:' + ctx.guild.id, async () => {
            const { guild } = ctx, cfg = store.guild(guild.id);
            ctx.member = await guild.members.fetch({ user: ctx.user.id, force: true });
            if (!isAdmin(ctx.member, guild)) throw new UserError('Se necesita Administrador para guardar.');
            const current = settings(guild.id, kind);
            if (revision !== current.revision) throw new UserError('Otra persona cambió este módulo. Abre /setup otra vez para revisar su versión.');
            if (kind === 'snipe') { setSnipe(guild, s.enabled, s.roleId); return; }
            if (kind === 'lockdown') {
                if (!s.channelId) throw new UserError('Selecciona un canal antes de guardar.');
                return protection.lock(ctx, await getChannel(ctx, s.channelId), s.locked);
            }
            const next = { ...s, revision: revision + 1 };
            const me = await guild.members.fetchMe();
            let channel;
            if (isDesign(kind) || kind === 'verification') {
                if (s.channelId && (s.enabled || designOnly)) {
                    channel = await getChannel(ctx, s.channelId);
                    if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) throw new UserError('Timmy necesita Ver canal, Enviar mensajes e Insertar enlaces en el destino.');
                }
                if (s.enabled && kind !== 'levels' && !channel) throw new UserError('Elige el canal del módulo antes de guardar.');
            }
            if (isDesign(kind)) validateTemplate(s.template || DEFAULT_MESSAGES[kind], ctx.member, { values: eventValues(kind, s) });
            if (!designOnly && s.enabled) {
                if (kind === 'levels') await rewards.provision(guild, ctx.member);
                if (kind === 'boosts' && s.roleId) await checkedRole(guild, s.roleId, cfg, ctx.member, kind);
                if (kind === 'protection' && !cfg.logChannel) throw new UserError('Elige primero un canal en /setup → Moderación → Registros.');
                if (kind === 'verification') {
                    if (!s.roleId || !s.categoryId) throw new UserError('Elige la categoría y el rol de verificación antes de guardar.');
                    const category = await getChannel(ctx, s.categoryId, true);
                    if (!category.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) throw new UserError('Timmy necesita ver la categoría, Gestionar canales y Gestionar roles para abrir tickets privados.');
                    if (s.roleId === s.removeRoleId || s.roleId === s.applicantRole) throw new UserError('Distingue el rol que recibe la persona del que ya tiene al solicitar.');
                    await checkedRole(guild, s.roleId, cfg, ctx.member, kind);
                    if (s.removeRoleId) await checkedRole(guild, s.removeRoleId, cfg, ctx.member, 'verification-remove');
                    if (s.applicantRole) await getRole(ctx, s.applicantRole, true);
                    Object.assign(next, await verification.publish(ctx, s, channel));
                }
            }
            store.patchGuild(guild.id, { [kind]: next });
            if (kind === 'verification' && (!next.enabled || next.channelId !== current.channelId)) await verification.retire(guild, current);
            if (kind === 'protection') protection.schedule(guild);
            if (kind === 'boosts' && !designOnly) {
                const discover = next.enabled && (!current.enabled || next.roleId !== current.roleId);
                rewards.reconcile(guild, discover).catch(error => console.warn('[BOOST]', error.code || error.name));
            }
        });
    }
    function open(ctx, kind) {
        const id = randomBytes(8).toString('hex');
        const draft = { kind, guildId: ctx.guild.id, userId: ctx.user.id, settings: settings(ctx.guild.id, kind), step: 0 };
        drafts.set(id, draft); return render(id, draft, ctx.member, rewards);
    }
    async function handle(i) {
        if (!i.customId?.startsWith('tm:community:')) return false;
        const [, , id, action] = i.customId.split(':');
        const draft = drafts.get(id);
        if (!draft || !i.guild || draft.guildId !== i.guild.id || draft.userId !== i.user.id) {
            await i.reply({ content: 'Este asistente venció o pertenece a otra cuenta. Abre /setup.', flags: MessageFlags.Ephemeral }); return true;
        }
        const modal = Object.hasOwn(formFields, action);
        if (!modal) await i.deferUpdate();
        return serial.run('draft:' + id, async () => {
            if (!drafts.get(id)) throw new UserError('Este asistente ya se cerró. Abre /setup.');
            const ctx = { guild: i.guild, user: i.user, member: await i.guild.members.fetch({ user: i.user.id, force: true }), channel: i.channel };
            if (!isAdmin(ctx.member, ctx.guild)) throw new UserError('Solo el dueño o un administrador puede configurar el servidor.');
            const s = draft.settings, kind = draft.kind, last = features[kind][2].length - 1;
            if (modal) { await i.showModal(editForm(id, action, draft)); return true; }
            if (action === 'cancel' || action === 'save') {
                let content = 'Asistente cerrado. Se descartó el borrador.';
                if (action === 'save') {
                    if (draft.step !== last) throw new UserError('Revisa el resumen antes de guardar.');
                    const result = await save(ctx, kind, s, s.revision);
                    content = result || features[kind][0] + ' · Configuración guardada.';
                    if (kind === 'verification' && s.enabled) content += ' Panel listo en ' + channelLabel(s.channelId) + '.';
                }
                drafts.delete(id); await i.editReply({ content, embeds: [], components: [], allowedMentions: { parse: [] } }); return true;
            }
            if (action === 'next') draft.step = Math.min(last, draft.step + 1);
            else if (action === 'back') draft.step = Math.max(0, draft.step - 1);
            else if (['enabled', 'gate', 'locked', 'denyReason'].includes(action) && Object.hasOwn(s, action)) s[action] = !s[action];
            else if (['channelId', 'categoryId', 'roleId', 'removeRoleId', 'applicantRole'].includes(action) && Object.hasOwn(s, action)) s[action] = i.values[0] || null;
            else if (i.isModalSubmit() && action.startsWith('submit-')) {
                const group = action.slice(7), changes = {};
                for (const [key, , max] of formFields[group] || []) {
                    const value = i.fields.getTextInputValue(key).trim();
                    if (value.length > max) throw new UserError('El texto es demasiado largo.');
                    changes[key] = value;
                }
                if (group === 'panel') {
                    changes.questions = changes.questions.split('\n').map(v => v.trim()).filter(Boolean);
                    if (changes.questions.length > 3 || changes.questions.some(q => q.length > 45)) throw new UserError('Usa hasta tres preguntas de 45 caracteres cada una.');
                    changes.color ||= '#84b9a6';
                    if (!/^#[0-9a-f]{6}$/i.test(changes.color)) throw new UserError('Escribe un color como #84b9a6.');
                    if (changes.banner) changes.banner = httpURL(changes.banner);
                }
                if (isDesign(kind)) {
                    const proposed = { ...s, ...changes };
                    validateTemplate(proposed.template || DEFAULT_MESSAGES[kind], ctx.member, { values: eventValues(kind, proposed) });
                }
                Object.assign(s, changes);
            } else throw new UserError('Control desconocido. Abre /setup.');
            await i.editReply(render(id, draft, ctx.member, rewards)); return true;
        });
    }
    return { open, handle, save, sections };
}
module.exports = { communitySetup, sections };
