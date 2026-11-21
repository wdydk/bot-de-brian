'use strict';

const { P } = require('./permissions');
const { isAdmin } = require('./access');

function moderationTopic(text, recent) {
    const q = text.replace(/[¿?¡!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/\b(?:automod|auto mod|antispam)\b/.test(q) && /\b(?:que hace|como funciona|activ[oa]|encendido|apagado|filtra|protege)\b/.test(q)) return 'automod';
    if (/\b(?:ban|bane\w*|obliter\w*)\b/.test(q) &&
        /\b(?:puedes|podrias|puedo|podria|harias|te pidiera|te pido|te digo|tienes permiso|como (?:te pido|baneo))\b|^(?:banea\w*|oblitera\w*)\b/.test(q)) return 'ban';
    if (/\b(?:tienes el rol mas alto|tienes permisos? de admin\w*|que permisos tienes|para que tengas acceso)\b/.test(q)) return 'ban';
    if (recent && /^(?:(?:y|pero) )?(?:(?:yo )?te doy permiso|(?:y )?si (?:yo )?soy (?:el )?(?:owner|dueno|admin\w*))(?: del (?:servidor|server))?$/.test(q)) return 'ban';
    return null;
}

function botRoleInfo(me, guild) {
    const role = me?.roles?.highest;
    if (!role?.id) return '';
    const highest = guild.roles?.highest;
    if (highest?.id === role.id) return 'Mi rol <@&' + role.id + '> es el más alto del servidor.';
    return 'Mi rol más alto es <@&' + role.id + '>.' + (highest ? ' Hay roles por encima.' : '');
}

function banAdvice(member, guild, me, cfg) {
    if (!isAdmin(member, guild)) return 'Solo el dueño de este servidor o alguien con el permiso **Administrador** puede pedirme un baneo.';
    const owner = member.id === guild.ownerId;
    const who = owner ? 'Eres el dueño de este servidor.' : 'Tienes el permiso **Administrador** en este servidor.';
    if (!cfg.bansEnabled) return who + ' Los baneos están desactivados. Puedes activarlos en `/setup` → **Moderación**.';
    if (!me) return who + ' Ahora mismo no pude comprobar si mi rol tiene **Banear miembros**. Vuelve a consultar en `/setup`.';
    const role = botRoleInfo(me, guild);
    if (!me.permissions.has(P.BanMembers)) {
        return [who, role, 'A mi rol le falta **Banear miembros**. Puedes activarlo en los ajustes de roles de Discord.'].filter(Boolean).join(' ');
    }
    const hierarchy = owner ? 'Puedo banear a miembros por debajo de mi rol.' : 'El miembro debe estar por debajo de tu rol y del mío.';
    const permission = me.permissions.has(P.Administrator) ? 'Mi permiso **Administrador** incluye **Banear miembros**.' : 'Tengo **Banear miembros**.';
    return [who, role, permission, hierarchy, 'Para solicitarlo, escribe `@Timmy Max banea a @usuario` y te pediré el motivo.'].filter(Boolean).join(' ');
}

function autoModInfo(cfg) {
    return 'El antispam está **' + (cfg.automod ? 'activo' : 'apagado') + '**. Al detectar 6 mensajes de una persona en el mismo canal en 5 segundos, intenta borrar los mensajes desde el sexto y aplicar un timeout de 1 minuto. Excluye bots y staff con Gestionar mensajes o Moderar miembros.';
}

module.exports = { moderationTopic, botRoleInfo, banAdvice, autoModInfo };
