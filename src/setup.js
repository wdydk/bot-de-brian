'use strict';

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    EmbedBuilder, MessageFlags, RoleSelectMenuBuilder, StringSelectMenuBuilder
} = require('discord.js');
const { isAdmin } = require('./access');
const { UserError } = require('./core');
const { P } = require('./permissions');
const { policyOf, savePolicy } = require('./staff-policy');
const { botRoleInfo, autoModInfo } = require('./moderation');
const { greetings } = require('./templates');
const { sections: communitySections } = require('./community-setup');

const sections = [
    { value: 'moderation', label: 'Moderación', description: 'Baneos, roles, antispam y canal de registros' },
    ...communitySections,
    {value:'staffpolicy',label:'Jerarquía de Staff',description:'Staff, Mod, Admin, avisos y protección'},
    { value: 'tickets', label: 'Tickets', description: 'Categoría, equipo de soporte y panel publicado' },
    { value: 'greetings', label: 'Bienvenidas y despedidas', description: 'Revisa los canales y edita el diseño' },
    { value: 'assistant', label: 'Asistente', description: 'Activa la IA y revisa las fichas del servidor' }
];
const switches = {
    bans: { key: 'bansEnabled', page: 'moderation', label: 'baneos' },
    spam: { key: 'automod', page: 'logs', label: 'antispam' },
    ai: { key: 'ai', page: 'assistant', label: 'IA' }
};

const row = (...controls) => new ActionRowBuilder().addComponents(controls);
const idFor = (ctx, action) => ['tm', 'setup', ctx.guild.id, ctx.user.id, action].join(':');
const button = (ctx, action, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(idFor(ctx, action)).setLabel(label).setStyle(style);
const channelName = id => id ? '<#' + id + '>' : 'sin configurar';
const roleName = id => id ? '<@&' + id + '>' : 'sin configurar';
const greetingChannels = (cfg, kind) => greetings(cfg, kind).map(entry => channelName(entry.channelId)).join(', ') || 'sin configurar';

function switchButton(ctx, cfg, name) {
    const { key, label } = switches[name];
    const enabled = cfg[key];
    return button(ctx, name + (enabled ? '-off' : '-on'), (enabled ? 'Desactivar ' : 'Activar ') + label,
        enabled ? ButtonStyle.Secondary : ButtonStyle.Primary);
}

function setupPage(ctx, cfg, page = 'home', notice = '') {
    const card = new EmbedBuilder().setColor(0x7188ef);
    const rows = [];
    const close = button(ctx, 'close', 'Cerrar');
    if (page === 'home') {
        card.setTitle('Configuración de ' + ctx.guild.name).setDescription([
            '**Moderación** · Baneos ' + (cfg.bansEnabled ? 'activados' : 'desactivados'),
            '**Antispam** · ' + (cfg.automod ? 'Activo' : 'Apagado'),
            '**Registros** · ' + channelName(cfg.logChannel),
            '**Tickets** · ' + (cfg.ticketPanelMessage ? 'Panel publicado' : cfg.ticketCategory && cfg.supportRole ? 'Falta publicar el panel' : 'Pendiente de configurar'),
            '**Bienvenida** · ' + greetingChannels(cfg, 'welcome'),
            '**Despedida** · ' + greetingChannels(cfg, 'goodbye'),
            '**Asistente** · ' + (cfg.ai ? 'Habilitado' : 'Apagado'),
            ...communitySections.map(s => '**' + s.label + '** · ' + (s.value === 'lockdown' ? Object.keys(cfg.locks).length + ' canales bloqueados' : (s.value === 'snipe' ? cfg.snipe : cfg[s.value].enabled) ? 'Activo' : 'Apagado'))
        ].join('\n')).setFooter({ text: 'Prefijo de este servidor · ' + cfg.prefix });
        rows.push(row(new StringSelectMenuBuilder().setCustomId(idFor(ctx, 'section'))
            .setPlaceholder('Elige una función').addOptions(sections)));
        rows.push(row(button(ctx, 'moderation', 'Configurar moderación', ButtonStyle.Primary), close));
    } else if (page === 'moderation') {
        card.setTitle('Quién puede banear').setFooter({ text: 'Moderación · Paso 1 de 2' });
        const me = ctx.guild.members.me;
        const botStatus = me ? (me.permissions.has(P.BanMembers) ? 'Tengo **Banear miembros**.' : 'A mi rol le falta **Banear miembros**.') : 'Permisos del bot pendientes de comprobar.';
        card.setDescription([
            'El dueño y los miembros con **Administrador** pueden solicitar baneos.',
            ctx.user.id === ctx.guild.ownerId ? 'Discord te identifica como dueño de este servidor.' : 'Tu cuenta tiene **Administrador**.',
            [botStatus, botRoleInfo(me, ctx.guild)].filter(Boolean).join(' '),
            'Baneos ' + (cfg.bansEnabled ? 'activados' : 'desactivados') + '. Para ver el acceso de un rol, selecciónalo abajo.'
        ].join('\n\n'));
        rows.push(row(new RoleSelectMenuBuilder().setCustomId(idFor(ctx, 'inspect-role')).setPlaceholder('Comprobar un rol')));
        rows.push(row(switchButton(ctx, cfg, 'bans')));
        rows.push(row(button(ctx, 'home', 'Inicio'), button(ctx, 'logs', 'Siguiente', ButtonStyle.Primary), close));
    } else if (page === 'staffpolicy') {
        const p=policyOf(cfg);
        card.setTitle('Jerarquía de Staff').setDescription('Staff: '+roleName(p.staff)+' · Mod: '+roleName(p.mod)+' · Admin: '+roleName(p.admin)+'\nAvisos: '+channelName(p.channel)+'\nModo: '+p.mode+' · Timeout: '+p.minutes+' min\nSolo el dueño puede modificar esta configuración. Usa /staffconfig o el panel web para editar whitelist y duración.');
        if(ctx.user.id===ctx.guild.ownerId) {
            for(const [key,label] of [['staff','Staff'],['mod','Mod'],['admin','Admin']]) rows.push(row(new RoleSelectMenuBuilder().setCustomId(idFor(ctx,'staff-'+key)).setPlaceholder('Elegir rol '+label)));
            rows.push(row(new ChannelSelectMenuBuilder().setCustomId(idFor(ctx,'staff-channel')).setPlaceholder('Elegir canal de avisos').addChannelTypes(ChannelType.GuildText)));
            rows.push(row(button(ctx,'staff-audit','Solo avisos'),button(ctx,'staff-enforce','Sancionar'),button(ctx,'staff-off','Apagar'),button(ctx,'home','Inicio')));
        }else rows.push(row(button(ctx,'home','Inicio'),close));
    } else if (page === 'logs') {
        card.setTitle('Registros y antispam').setFooter({ text: 'Moderación · Paso 2 de 2' })
            .setDescription('Canal de registros: ' + channelName(cfg.logChannel) + '\n\n' + autoModInfo(cfg));
        rows.push(row(new ChannelSelectMenuBuilder().setCustomId(idFor(ctx, 'set-log'))
            .setPlaceholder('Elegir canal de registros').addChannelTypes(ChannelType.GuildText)));
        const controls = [switchButton(ctx, cfg, 'spam')];
        if (cfg.logChannel) controls.push(button(ctx, 'remove-log', 'Desactivar registros'));
        rows.push(row(...controls), row(button(ctx, 'moderation', 'Atrás'), button(ctx, 'home', 'Inicio'), close));
    } else {
        if (page === 'tickets') {
            card.setTitle('Tickets').setDescription([
                'Categoría: ' + channelName(cfg.ticketCategory), 'Equipo: ' + roleName(cfg.supportRole),
                'Panel: ' + (cfg.ticketPanelMessage ? channelName(cfg.ticketPanelChannel) : 'pendiente de publicar'),
                '', '1. Configura la categoría y el rol con `>ticketsetup ID_CATEGORIA @Soporte`.',
                '2. Escribe `>ticketpanel` en el canal donde se abrirán los tickets.'
            ].join('\n'));
        } else if (page === 'greetings') {
            card.setTitle('Bienvenidas y despedidas').setDescription([
                'Bienvenida: ' + greetingChannels(cfg, 'welcome'), 'Despedida: ' + greetingChannels(cfg, 'goodbye'),
                '', 'Guarda un mensaje con `>welcome add #canal ¡Hola {user.mention}!`.',
                'Usa `>goodbye add #canal Hasta pronto, {user.name}` para las salidas.'
            ].join('\n'));
        } else if (page === 'assistant') {
            card.setTitle('Asistente').setDescription('IA ' + (cfg.ai ? 'habilitada' : 'apagada') +
                '. Fichas guardadas: ' + (Object.keys(cfg.knowledgePages).length + Number(Boolean(cfg.knowledge))) +
                '.\n\nUsa `>knowledge add reglas Texto de las reglas` para añadir información de tu comunidad.');
            rows.push(row(switchButton(ctx, cfg, 'ai')));
        } else throw new UserError('Sección desconocida. Vuelve a abrir /setup.');
        rows.push(row(button(ctx, 'home', 'Inicio'), close));
    }
    return { content: notice || null, embeds: [card], components: rows, allowedMentions: { parse: [] } };
}

function installSetup({ add, store, getRole, setLogChannel, community }) {
    add('setup', 'Configura la moderación y consulta los módulos del servidor', '>setup',
        { adminOnly: true, private: true, category: 'Configuración' }, async ctx => {
            if (ctx.isSlash) return ctx.reply(setupPage(ctx, store.guild(ctx.guild.id)));
            return ctx.reply({ content: 'Abre tu panel privado de Timmy Max.',
                components: [row(button(ctx, 'open', 'Abrir configuración', ButtonStyle.Primary))] });
        });

    return async function handleSetup(i) {
        if (!i.customId?.startsWith('tm:setup:')) return false;
        const [, , guildId, userId, action] = i.customId.split(':');
        if (!i.guild || i.guild.id !== guildId || i.user.id !== userId) {
            await i.reply({ content: 'Este panel pertenece a otra persona o servidor.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (action === 'open') await i.deferReply({ flags: MessageFlags.Ephemeral });
        else await i.deferUpdate();
        const member = await i.guild.members.fetch({ user: userId, force: true });
        const authorized = isAdmin(member, i.guild);
        if (!authorized || action === 'close') {
            const content = authorized ? 'Panel cerrado.' : 'Solo el dueño o un administrador puede usar este panel.';
            await i.editReply({ content, embeds: [], components: [] });
            return true;
        }
        const ctx = { guild: i.guild, user: i.user, member };
        let page = action;
        let notice = '';
        if (action === 'open') page = 'home';
        if (action === 'section' && i.isStringSelectMenu()) page = i.values[0];
        if(/^staff-(staff|mod|admin|channel|audit|enforce|off)$/.test(action)) {
            const key=action.slice(6), p=policyOf(store.guild(guildId));
            if(!(['staff','mod','admin'].includes(key)&&i.isRoleSelectMenu() || key==='channel'&&i.isChannelSelectMenu() || ['audit','enforce','off'].includes(key)&&i.isButton())) throw new UserError('Control inválido.');
            await savePolicy({store,guild:i.guild,member,next:['audit','enforce','off'].includes(key)?{mode:key}:{[key]:i.values[0]},expected:p.revision});
            page='staffpolicy';notice='Jerarquía guardada.';
        }
        if (action === 'inspect-role' && i.isRoleSelectMenu()) {
            const role = await getRole(ctx, i.values[0], true);
            notice = roleName(role.id) + (role.permissions.has(P.Administrator)
                ? ' concede **Administrador**. Sus miembros pueden abrir este panel y solicitar baneos.'
                : ' por sí solo no concede **Administrador**.');
            page = 'moderation';
        }
        if ((action === 'set-log' && i.isChannelSelectMenu()) || action === 'remove-log') {
            const destination = action === 'remove-log' ? 'off' : i.values[0];
            await setLogChannel(ctx, destination);
            notice = destination === 'off' ? 'Registros desactivados.' : 'Canal de registros guardado.';
            page = 'logs';
        }
        const change = /^(bans|spam|ai)-(on|off)$/.exec(action);
        if (change && i.isButton()) {
            const { key, page: target } = switches[change[1]];
            store.patchGuild(guildId, { [key]: change[2] === 'on' });
            page = target;
            notice = 'Ajuste guardado.';
        }
        const screen = communitySections.some(section => section.value === page)
            ? community.open(ctx, page) : setupPage(ctx, store.guild(guildId), page, notice);
        await i.editReply(screen);
        return true;
    };
}

module.exports = { installSetup };
