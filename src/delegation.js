'use strict';

const { UserError } = require('./core');
const { P } = require('./permissions');

const scopes = new Map([
    [P.ManageMessages, 'manage_messages'], [P.ModerateMembers, 'moderate_members'],
    [P.ManageNicknames, 'manage_nicknames'], [P.KickMembers, 'kick_members'],
    [P.ManageChannels, 'manage_channels'], [P.ManageRoles, 'manage_roles']
]);
const supported = new Set(scopes.values());
const describeScopes = names => names.map(name => name === 'ban_members' ? 'ban_members (anterior, sin efecto)' : name).join(', ');
function delegated(def, ctx) {
    if (def.adminOnly || def.category !== 'Moderación' || !ctx.guild || !ctx.member) return false;
    const key = scopes.get(def.permission);
    if (!key) return false;
    const channelPerms = ctx.channel?.permissionsFor?.(ctx.member);
    if (channelPerms && !channelPerms.has([P.ViewChannel, P.SendMessages])) return false;
    return Object.entries(ctx.delegatedRoles || {}).some(([id, grants]) =>
        id !== ctx.guild.id && ctx.member.roles?.cache?.has(id) && grants.includes(key));
}
function guardGrantRole(role, member) {
    if (!role || role.id === role.guild.id || role.managed) throw new UserError('Elige un rol del servidor asignado a personas.');
    if (member.id !== role.guild.ownerId && member.roles.highest.comparePositionTo(role) <= 0) {
        throw new UserError('Elige un rol por debajo de tu rol más alto.');
    }
}
function guardSelfAssignable(roleId, cfg) {
    if (cfg.autorole === roleId || Object.values(cfg.roleButtons).includes(roleId)) {
        throw new UserError('Ese rol se entrega automáticamente o con un botón. Usa un rol de staff que se asigne manualmente.');
    }
}
function guardCommunityRole(role, cfg) {
    if (role && (cfg.delegatedRoles[role.id]?.length || cfg.supportRole === role.id)) {
        throw new UserError('Ese rol da acceso a moderación o soporte. Asigna los roles de staff desde Discord.');
    }
}
function readScopes(input, removable = []) {
    const names = [...new Set(input.trim().toLowerCase().split(/[\s,]+/).filter(Boolean))];
    if (!names.length || names.some(p => !supported.has(p) && !removable.includes(p))) {
        throw new UserError('Permisos disponibles: ' + [...supported].join(', ') + '.');
    }
    return names;
}
const roleOption = (required = true) => ({ type: 8, name: 'role', description: 'Rol de este servidor', required });
const permissionsOption = (required = true) => ({
    type: 3, name: 'permissions', description: 'Permisos de Timmy separados por comas', required, max_length: 250
});
const group = { type: 2, name: 'fakepermissions', description: 'Permisos internos de Timmy por rol', options: [
    { type: 1, name: 'add', description: 'Añade permisos al rol', options: [roleOption(), permissionsOption()] },
    { type: 1, name: 'list', description: 'Consulta los permisos guardados', options: [roleOption(false)] },
    { type: 1, name: 'remove', description: 'Retira permisos o todo el acceso del rol', options: [roleOption(), permissionsOption(false)] },
    { type: 1, name: 'reset', description: 'Retira todos los permisos delegados de este servidor' }
] };
function accessArguments(options) {
    const args = [options.getSubcommandGroup(), options.getSubcommand()];
    const role = options.getRole('role', false);
    if (role) args.push(role.id);
    const selected = options.getString('permissions', false);
    if (selected) args.push(selected);
    return args;
}
function installAccess({ add, store, getRole, privateReply, log }) {
    add('access', 'Delega comandos de moderación a un rol', '>access fakepermissions add|list|remove|reset [@rol] [permisos]',
        { category: 'Configuración', private: true, params: [group] }, async (ctx, args) => {
        const [kind, action, input, ...rest] = args;
        const cfg = store.guild(ctx.guild.id);
        if (kind !== 'fakepermissions' || !['add', 'list', 'remove', 'reset'].includes(action)) {
            throw new UserError('Usa /access fakepermissions y selecciona add, list, remove o reset.');
        }
        if (action === 'reset') {
            if (input) throw new UserError('Para quitar un solo rol usa remove @rol.');
            if (ctx.member.id !== ctx.guild.ownerId) {
                for (const id of Object.keys(cfg.delegatedRoles)) {
                    const role = ctx.guild.roles.cache.get(id);
                    if (role) guardGrantRole(role, ctx.member);
                }
            }
            store.patchGuild(ctx.guild.id, { delegatedRoles: {} });
            await log(ctx.guild, 'Permisos de Timmy', ctx.user.id + ' retiró todas las delegaciones.');
            return ctx.reply('Delegaciones de este servidor eliminadas.');
        }
        const role = input ? await getRole(ctx, input) : null;
        if (action === 'list') {
            const rows = Object.entries(cfg.delegatedRoles).filter(([id]) => !role || role.id === id)
                .map(([id, names]) => `<@&${id}> → ${describeScopes(names)}`);
            const body = rows.join('\n') || 'Todavía no hay permisos delegados para esta selección.';
            return privateReply(ctx, body.length <= 1900 ? body : { files: [{ attachment: Buffer.from(body), name: 'permisos.txt' }] });
        }
        guardGrantRole(role, ctx.member);
        const next = { ...cfg.delegatedRoles };
        const current = next[role.id] || [];
        if (action === 'add') {
            guardSelfAssignable(role.id, cfg);
            next[role.id] = [...new Set([...current, ...readScopes(rest.join(' '))])];
        } else {
            const remove = rest.length ? readScopes(rest.join(' '), current) : current;
            const remaining = current.filter(p => !remove.includes(p));
            if (remaining.length) next[role.id] = remaining;
            else delete next[role.id];
        }
        store.patchGuild(ctx.guild.id, { delegatedRoles: next });
        const result = describeScopes(next[role.id] || []) || 'ninguno';
        await log(ctx.guild, 'Permisos de Timmy', `${ctx.user.id} · rol ${role.id} · ${result}`);
        return ctx.reply(`Permisos de Timmy para <@&${role.id}>: ${result}.`);
    });
}
module.exports = { delegated, guardCommunityRole, guardSelfAssignable, accessArguments, installAccess };
