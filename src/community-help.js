'use strict';

const { isAdmin } = require('./access');
const { MILESTONES, roleName, levelOf, XP_PER_LEVEL } = require('./rewards');

function accessLabel(ctx) {
    if (ctx.user.id === ctx.guild.ownerId) return 'dueño';
    return isAdmin(ctx.member, ctx.guild) ? 'administrador' : 'miembro';
}
function topicOf(text) {
    const q = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/\b(?:redact\w*|tradu\w*|cuento|poema|cancion|programa(?:r|cion)|roblox|minecraft|fortnite|videojuego|gimnasio|nitro classic)\b/.test(q)) return null;
    const question = q.trim().replace(/^[¿¡]\s*|[?!.]+$/g, '').trim();
    if (/^(?:que|cuales(?: son)?|hay|quedan?|tenemos|muestrame|lista(?:me)?) (?:los |algun(?:os)? |un )?(?:sorteos?|give\s*aways?)(?: (?:hay|tenemos|quedan|estan|siguen|disponibles?|activos?|abiertos?|vigentes?|ahora|hoy|en (?:este|el) servidor))*$/.test(question)) return 'giveaways';
    if (/\b(?:que (?:puedes|puedo) hacer|en que (?:me )?puedes ayudar|que (?:comandos|permisos) tengo|que puedo configurar)\b/.test(q)) return 'access';
    if (/\b(?:proteccion|antiraid|anti raid)\b/.test(q)) return 'protection';
    if (/\b(?:como|quiero|puedo|pasos|ayuda|donde)\b/.test(q) && /\b(?:(?:mi|su) (?:propio )?rol(?:e)?|rol(?:e)? (?:personalizado|personal|de booster))\b/.test(q) && /\b(?:cre\w*|diseñ\w*|disen\w*|reclam\w*|edit\w*|color)\b/.test(q) && !/\b(?:beneficios?|ficha|knowledge)\b/.test(q)) return 'personal-role';
    if (/\b(?:boost(?:s|ear\w*|e[oa]\w*|er\w*|ing)?|impulsar (?:este |el )?servidor)\b/.test(q)) return 'boosts';
    if (/\b(?:snipe|editsnipe)\b/.test(q)) return 'snipe';
    if (/\b(?:nivel(?:es)?|level(?:s)?|lvl|xp)\b/.test(q) && /\b(?:que|cual|como|mi|tengo|sub\w*|gan\w*|conf\w*|activ\w*|desactiv\w*|cuant\w*|recompens\w*|rol\w*|puntos|falta\w*)\b/.test(q)) return 'levels';
    if (/\b(?:verific(?:acion|arme|ame|arse|o|ar)|me verifico)\b/.test(q) && !/\b(?:roles?|goles?|identidad de|cuentas? de)\b/.test(q)) return 'verification';
    return null;
}
function communityAnswer(ctx, cfg, q, topic, rewards) {
    const access = accessLabel(ctx), admin = access !== 'miembro';
    const normalized = q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const asksStatus = /\b(?:estan?|siguen?|tengo|tenemos) (?:(?:el|la|los|las|ya|modulo|de|avisos|anuncios|boosts?) ){0,6}(?:activ|encendid|apagad|habilitad|desactiv|deshabilitad)/.test(normalized);
    const config = !asksStatus && /\b(?:configur\w*|activ\w*|desactiv\w*|editar?|cambi\w*|pon(?:me)?|personaliz\w*|agreg\w*|crea\w*|habilit\w*)\b/.test(normalized);
    if (topic === 'access') {
        if (admin) return 'Discord te reconoce como **' + access + '** de este servidor. Con /setup puedes configurar niveles, boosts y verificación. También puedes preparar un anuncio con /embed y revisar sus detalles antes de publicarlo.';
        return 'Como **miembro** puedes consultar tu progreso con /level, abrir un ticket desde el panel de soporte y preguntarme por las reglas o los beneficios de boost de este servidor.';
    }
    const label = { levels: 'Niveles', boosts: 'Boosts', verification: 'Verificación', snipe: 'Snipe', protection: 'Protección' }[topic];
    if (topic === 'boosts' && admin && /(?:cuando (?:digan|pregun\w*)|que (?:digas|respondas))/.test(normalized)) {
        return 'Guarda la respuesta con **>knowledge add reclamar-boost** seguido del texto que quieres que diga. Por ejemplo: `>knowledge add reclamar-boost Con un boost activo, escribe >rc para elegir el nombre y el color de tu rol.` Para explicar qué incluye el boost, guarda otra ficha llamada **beneficios-boost**.';
    }
    if (topic === 'boosts' && /^¿?\s*(?:soy (?:un )?booster|(?:estoy|sigo) boosteando|tengo (?:un |el )?boost(?: activo)?|(?:esta|sigue) activo mi boost|mi boost (?:esta|sigue) activo)[?!. ]*$/.test(normalized)) {
        return ctx.member.premiumSinceTimestamp ? 'Tu boost está activo en este servidor. Puedes diseñar tu rol con **>rc**.' : 'Discord no registra un boost activo de tu cuenta en este servidor.';
    }
    if (topic === 'boosts' && asksStatus && !/benefici|reclam|ventaja/.test(normalized)) {
        return 'Los anuncios de boosts están **' + (cfg.boosts.enabled ? 'activos' : 'apagados') + '** en este servidor.';
    }
    if (topic === 'boosts' && (!config || /benefici|reclam|ventaja|que (?:dan|recib)|ficha|knowledge/.test(normalized))) {
        const pages = cfg.knowledgePages || {};
        const claim = /reclam|canje/.test(normalized);
        const preferred = claim ? ['reclamar-boost','beneficios-boost','boost'] : ['beneficios-boost','boost','reclamar-boost'];
        const keys = [...new Set([...preferred, ...Object.keys(pages).filter(k => /boost/.test(k))])];
        const card = keys.find(k => pages[k]);
        const lines = [card && pages[card], cfg.boosts.perks && cfg.boosts.perks !== pages[card] ? cfg.boosts.perks : null];
        if (!card && !cfg.boosts.enabled) lines.push('El módulo de anuncios de boosts está apagado en este servidor.');
        if (cfg.boosts.enabled && cfg.boosts.roleId) lines.push('Mientras mantengas el boost, Timmy entrega <@&' + cfg.boosts.roleId + '>.');
        lines.push('Con un boost activo puedes diseñar tu rol personal con **>rc**.');
        return lines.filter(Boolean).join('\n');
    }
    if (config) return admin ? 'Como **' + access + '** puedes hacerlo en /setup → **' + label + '**. Elige los ajustes, avanza hasta **Revisión** y pulsa **Guardar**.'
        : 'Configurar ' + label + ' requiere ser dueño o tener Administrador. ' + (topic === 'levels' ? 'Tú puedes consultar tu nivel con /level.' : 'Puedes preguntarme cómo funciona en este servidor.');
    if (topic === 'snipe') return 'Snipe está **' + (cfg.snipe ? 'activo' : 'apagado') + '**. El staff autorizado puede consultar en privado el último texto eliminado o editado de ese canal durante 5 minutos.';
    if (topic === 'protection') return 'Protección está **' + (cfg.protection.enabled ? 'activa' : 'apagada') + '**. Avisa al equipo desde 5 entradas o 3 eliminaciones de canales o roles en 10 segundos.' +
        (cfg.protection.enabled && cfg.protection.gate ? ' Durante una oleada se aplaza el autorrol de bienvenida.' : '');
    const s = cfg[topic];
    if (!s.enabled) return '**' + label + '** está apagado en este servidor.' + (admin ? ' Puedes activarlo en /setup → ' + label + '.' : '');
    if (topic === 'verification') {
        if (ctx.member.roles.cache.has(s.roleId)) return 'Ya tienes el rol de verificación de este servidor.';
        if (s.applicantRole && !ctx.member.roles.cache.has(s.applicantRole)) return 'Para abrir la solicitud necesitas <@&' + s.applicantRole + '>. El equipo del servidor puede revisar tu acceso.';
        return 'En <#' + s.channelId + '> pulsa **Solicitar verificación**. ' + (s.questions.length ? 'Responde el formulario. ' : '') + 'El dueño o un administrador revisará tu ticket.';
    }
    const xp = rewards.xp(ctx.guild.id, ctx.user.id);
    const next = MILESTONES.find(m => m.level > levelOf(xp));
    return 'Tienes **' + xp + ' XP** y estás en el **nivel ' + levelOf(xp) + '**. Te faltan ' + (XP_PER_LEVEL - xp % XP_PER_LEVEL) +
        ' XP para subir. Cada mensaje de chat que cuenta da 15 XP, como máximo una vez por minuto.' +
        (next ? ' Tu próximo rol es **' + roleName(next.level) + '**.' : ' Ya alcanzaste el último rol de nivel.');
}
module.exports = { topicOf, communityAnswer, accessLabel };
