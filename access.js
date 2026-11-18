'use strict';
const { P } = require('./permissions');

function isAdmin(member, guild = member?.guild) {
    return Boolean(member && guild && ((member.id && guild.ownerId && member.id === guild.ownerId) || member.permissions?.has(P.Administrator)));
}
function canUse(definition, ctx) {
    if (definition.guild && !ctx.guild) return false;
    if (definition.adminOnly && !isAdmin(ctx.member, ctx.guild)) return false;
    return !definition.permission || isAdmin(ctx.member, ctx.guild) || Boolean(ctx.member?.permissions?.has(definition.permission));
}
function canShow(definition, ctx, ticket) {
    if (!canUse(definition, ctx)) return false;
    if (definition.name === 'close' || definition.name === 'transcript') {
        return Boolean(ticket && ticket.guildId === ctx.guild?.id &&
            (ticket.ownerId === ctx.user.id || isAdmin(ctx.member, ctx.guild) ||
                ctx.member?.permissions?.has(P.ManageChannels) ||
                (ctx.supportRole && ctx.member?.roles?.cache?.has(ctx.supportRole))));
    }
    return true;
}
const BASIC = ['help', 'ping', 'avatar', 'sf', 'ask', 'ticket', 'play', 'queue', 'nowplaying'];
module.exports = { isAdmin, canUse, canShow, BASIC };
