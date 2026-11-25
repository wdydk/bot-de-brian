'use strict';
const { AuditLogEvent, ChannelType } = require('discord.js');
const { UserError, ExpiringCache, Serial, idOf, integer } = require('./core');
const { P } = require('./permissions');
const rank = (member, guild, policy) => {
    if (!member || !guild || policy?.mode === 'off' || !policy?.mode) return null;
    if (member.id === guild.ownerId) return 'owner';
    for (const level of ['admin','mod','staff']) if (policy[level] && member.roles?.cache?.has(policy[level])) return level;
    return null;
};
const grants = {
    staff: [P.ModerateMembers,P.ManageMessages],
    mod: [P.ModerateMembers,P.ManageMessages,P.KickMembers,P.ManageRoles],
    admin: [P.ModerateMembers,P.ManageMessages,P.KickMembers,P.ManageRoles,P.BanMembers]
};
function restriction(def, ctx) {
    const level = rank(ctx.member,ctx.guild,ctx.staffPolicy);
    if (!['staff','mod'].includes(level)) return null;
    if (def.adminOnly || def.category === 'Configuración') return false;
    if (def.category !== 'Moderación' || !def.permission) return null;
    // Only the explicitly requested actions (not every command with these bits).
    const names = level === 'staff' ? ['timeout','untimeout','purge'] : ['timeout','untimeout','purge','kick','role'];
    return names.includes(def.name) && grants[level].includes(def.permission);
}
const defaults = () => ({mode:'off', staff:null,mod:null,admin:null,channel:null,minutes:10,whitelist:[],revision:0});
function policyOf(cfg) { return {...defaults(), ...cfg.staffPolicy}; }
function isProtected(cfg,id) { return ['staff','mod','admin'].some(k=>policyOf(cfg)[k]===id); }
async function savePolicy({store,guild,member,next,expected}) {
    if (member.id !== guild.ownerId) throw new UserError('Solo el dueño real puede cambiar la jerarquía, whitelist o sanciones.');
    const cfg=store.guild(guild.id), old=policyOf(cfg);
    if (expected !== undefined && String(old.revision)!==String(expected)) throw new UserError('La configuración cambió. Recarga el panel.');
    const p={...old,...next};
    if (!['off','audit','enforce'].includes(p.mode)) throw new UserError('Modo inválido.');
    p.minutes=integer(p.minutes,1,1440);
    const ids=['staff','mod','admin'].map(k=>p[k]).filter(Boolean);
    if (new Set(ids).size!==ids.length) throw new UserError('Selecciona tres roles diferentes.');
    const me=await guild.members.fetchMe({force:true});
    for(const level of ['staff','mod','admin']) {
        if (!p[level]) continue;
        const role=await guild.roles.fetch(idOf(p[level]));
        if (!role || role.id===guild.id || role.managed) throw new UserError('Selecciona roles normales de este servidor.');
        if (level==='admin') {
            if (!role.permissions.has(P.Administrator)) throw new UserError('El rol Admin necesita el permiso nativo Administrador para abrir todo el panel.');
        } else {
            if (role.permissions.has(P.Administrator)) throw new UserError('Staff y Mod no pueden tener Administrador.');
            if (!role.editable || me.roles.highest.comparePositionTo(role)<=0) throw new UserError('El rol de Timmy debe estar por encima de Staff y Mod.');
        }
        const auto=[cfg.autorole,cfg.supportRole,cfg.birthday?.roleId,cfg.boosts?.roleId,cfg.verification?.roleId,cfg.verification?.removeRoleId,cfg.verification?.applicantRole,...Object.values(cfg.roleButtons||{}),...Object.values(cfg.levelRoles||{}),...Object.values(cfg.personalRoles||{})];
        if(auto.includes(role.id)) throw new UserError('No uses roles de soporte, autorrol, recompensas o botones como rangos de esta jerarquía.');
    }
    p.whitelist=[...new Set(p.whitelist||[])];
    if(p.whitelist.length>50 || p.whitelist.some(x=>!/^\d{17,20}$/.test(x))) throw new UserError('Whitelist: máximo 50 IDs de usuarios válidos.');
    if(p.channel) {
        const ch=await guild.channels.fetch(idOf(p.channel));
        if(ch?.type!==ChannelType.GuildText || !ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages])) throw new UserError('Timmy necesita acceso al canal de avisos.');
    }
    if(p.mode!=='off' && (ids.length!==3 || !p.channel || !me.permissions.has(P.ViewAuditLog))) throw new UserError('Completa los tres roles, canal de avisos y permiso Ver registro de auditoría.');
    if(p.mode==='enforce' && !me.permissions.has([P.ManageRoles,P.ModerateMembers])) throw new UserError('Para sancionar Timmy necesita Gestionar roles y Moderar miembros.');
    // Check revision again after asynchronous Discord permission checks.
    if(policyOf(store.guild(guild.id)).revision!==old.revision) throw new UserError('La configuración cambió. Recarga el panel.');
    p.revision=old.revision+1;
    store.patchGuild(guild.id,{staffPolicy:p});
    return p;
}
function auditAction(entry) {
    switch(entry.action) {
        case AuditLogEvent.MemberBanAdd: return ['banear',P.BanMembers];
        case AuditLogEvent.MemberBanRemove: return ['desbanear',P.BanMembers];
        case AuditLogEvent.MemberKick: return ['expulsar',P.KickMembers];
        case AuditLogEvent.MemberRoleUpdate: return entry.changes?.some(c=>['$add','$remove'].includes(c.key)) ? ['asignar o retirar roles',P.ManageRoles] : null;
        case AuditLogEvent.MemberUpdate: return entry.changes?.some(c=>c.key==='communication_disabled_until') ? ['aplicar o retirar timeout',P.ModerateMembers] : null;
        case AuditLogEvent.MessageDelete:
        case AuditLogEvent.MessageBulkDelete: return ['eliminar mensajes',P.ManageMessages];
        default: return null;
    }
}
function installAudit(client,store) {
    const seen=new ExpiringCache(10*60000,10000), serial=new Serial();
    client.on('guildAuditLogEntryCreate',(entry,guild)=>{
        serial.run(guild.id,async()=>{
            const p=policyOf(store.guild(guild.id));
            if(p.mode==='off' || !entry.id || seen.get(entry.id) || !entry.executorId || entry.executorId===guild.ownerId || entry.executorId===client.user?.id || p.whitelist.includes(entry.executorId)) return;
            if(!Number.isFinite(entry.createdTimestamp) || Math.abs(Date.now()-entry.createdTimestamp)>120000) return;
            const action=auditAction(entry); if(!action) return;
            seen.set(entry.id,true);
            const actor=await guild.members.fetch({user:entry.executorId,force:true}).catch(()=>null);
            if(!actor || actor.user?.bot) return;
            const level=rank(actor,guild,p);
            if(!['staff','mod'].includes(level) || grants[level].includes(action[1])) return;
            const reason='Rango '+level+' no autorizado para '+action[0]+'. Registro de auditoría '+entry.id+'.';
            const ch=await guild.channels.fetch(p.channel).catch(()=>null);
            if(!ch?.isTextBased()) return;
            // Never punish if we cannot first deliver a traceable warning.
            await ch.send({content:'⚠️ Timmy · Incidente confirmado por auditoría\nUsuario: <@'+actor.id+'>\nMotivo: '+reason,allowedMentions:{parse:[]}});
            if(p.mode!=='enforce') return;
            if(policyOf(store.guild(guild.id)).revision!==p.revision) return;
            const me=await guild.members.fetchMe({force:true});
            if(actor.permissions.has(P.Administrator) || !actor.manageable || !actor.moderatable || !me.permissions.has([P.ManageRoles,P.ModerateMembers])) {
                await ch.send({content:'No apliqué sanción automática: permisos o jerarquía insuficientes. Revisión del dueño necesaria.',allowedMentions:{parse:[]}}); return;
            }
            const removable=[p.staff,p.mod].filter(id=>id && actor.roles.cache.has(id));
            if(!removable.length || removable.some(id=>!guild.roles.cache.get(id)?.editable)) return;
            try {
                // Timeout first: if it fails, do not remove roles.
                await actor.timeout(p.minutes*60000,reason);
                await actor.roles.remove(removable,reason);
                await ch.send({content:'Timmy · Timeout de '+p.minutes+' min y retirada de rangos Staff/Mod confirmados. Motivo: '+reason,allowedMentions:{parse:[]}});
            } catch {
                await ch.send({content:'Timmy · Sanción incompleta; revisa el timeout y los roles manualmente. Motivo: '+reason,allowedMentions:{parse:[]}}).catch(()=>{});
            }
        }).catch(e=>console.warn('[STAFF AUDIT]',e.code||e.name));
    });
}
module.exports={rank,restriction,policyOf,isProtected,savePolicy,auditAction,installAudit};
