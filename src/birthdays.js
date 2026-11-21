'use strict';
const { createHash } = require('node:crypto');
const { ChannelType } = require('discord.js');
const { UserError, Serial, render } = require('./core');
const { P, safeRole } = require('./permissions');
const { checkedRole } = require('./rewards');
const { isAdmin } = require('./access');
const { guardCommunityRole } = require('./delegation');
const DAY = 86400000;
function birthDate(input) {
    const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(input);
    if (!m) throw new UserError('Escribe solo día y mes, por ejemplo 21/11.');
    const date = new Date(Date.UTC(2000,Number(m[2])-1,Number(m[1])));
    if (date.getUTCDate() !== +m[1] || date.getUTCMonth()+1 !== +m[2]) throw new UserError('Esa fecha no existe.');
    return m[1].padStart(2,'0')+'/'+m[2].padStart(2,'0');
}
function localTime(now,zone) {
    const fmt = new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const f = Object.fromEntries(fmt.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
    return {day:f.day+'/'+f.month,year:f.year,hour:f.hour+':'+f.minute};
}
class Birthdays {
    constructor(store,client) { this.store=store; this.client=client; this.locks=new Serial(); }
    register(guildId,userId,input) {
        const cfg=this.store.guild(guildId), dates={...cfg.birthdays};
        if (!input) return dates[userId] ? 'Tu cumpleaños aquí es el '+dates[userId]+'. Puedes retirarlo con >cumple borrar.' : 'Registra tu día y mes con >cumple 21/11. El equipo puede celebrar tu cumpleaños en el canal configurado.';
        if (/^(borrar|quitar|off)$/i.test(input)) delete dates[userId];
        else dates[userId]=birthDate(input);
        this.store.patchGuild(guildId,{birthdays:dates});
        return dates[userId] ? 'Guardé el '+dates[userId]+' como tu cumpleaños en este servidor.' : 'Retiré tu fecha de este servidor.';
    }
    save(ctx,s,expected) {
        return this.locks.run('settings:'+ctx.guild.id,async()=>{
            const {guild,member}=ctx, cfg=this.store.guild(guild.id);
            if (!isAdmin(member,guild)) throw new UserError('Solo el dueño o un administrador puede guardar cumpleaños.');
            if (expected!==cfg.birthday.revision) throw new UserError('Los ajustes cambiaron. Actualiza la página antes de guardar.');
            try { localTime(Date.now(),s.timezone); } catch { throw new UserError('Escribe una zona horaria válida, por ejemplo America/Los_Angeles.'); }
            if (!s.timezone || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.hour) || !s.text.trim() || s.text.length>1800) throw new UserError('Comprueba la hora y escribe un mensaje de 1 a 1800 caracteres.');
            if (s.enabled && !s.roleId && !s.channelId) throw new UserError('Elige un rol o un canal de cumpleaños.');
            const me=await guild.members.fetchMe();
            if (s.channelId) {
                const ch=await guild.channels.fetch(s.channelId);
                if (ch?.type!==ChannelType.GuildText || !ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]) || !ch.permissionsFor(member)?.has(P.ViewChannel)) throw new UserError('Timmy necesita poder escribir en el canal elegido.');
            }
            let created;
            if (s.roleId === 'create') {
                if (!me.permissions.has(P.ManageRoles)) throw new UserError('Timmy necesita Gestionar roles para crear el rol de cumpleaños.');
                created = await guild.roles.create({name:'Cumpleaños 🎂',colors:{primaryColor:0xf5a3bc},permissions:[],hoist:false,mentionable:false,reason:'Rol de cumpleaños configurado por '+member.id});
            } else if (s.roleId) await checkedRole(guild,s.roleId,cfg,member,'birthday');
            try { this.store.patchGuild(guild.id,{birthday:{...s,roleId:created?.id || s.roleId,revision:expected+1}}); }
            catch (error) { if (created) await created.delete('La configuración de cumpleaños no se guardó'); throw error; }
        });
    }
    record(guild,id,state) {
        const states={...this.store.guild(guild.id).birthdayDeliveries};
        if (state) states[id]=state; else delete states[id];
        this.store.patchGuild(guild.id,{birthdayDeliveries:states});
    }
    async member(guild,id) {
        return guild.members.fetch({user:id,force:true}).catch(e=>{if(e.code===10007) return null;throw e;});
    }
    async visit(guild,id,today,now) {
        const cfg=this.store.guild(guild.id), s=cfg.birthday;
        let record=cfg.birthdayDeliveries[id];
        const due=s.enabled && cfg.birthdays[id]===today.day && today.hour>=s.hour;
        const expire=record?.roleId && (record.until<=now || !s.enabled || !cfg.birthdays[id] || s.roleId!==record.roleId);
        if (!expire && (!due || (record?.year===today.year && record.done))) return;
        const member=await this.member(guild,id);
        if (!member) {
            const dates={...cfg.birthdays}; delete dates[id]; this.store.patchGuild(guild.id,{birthdays:dates}); this.record(guild,id,null); return;
        }
        if (expire) {
            const role=await guild.roles.fetch(record.roleId).catch(e=>{if(e.code===10011)return null;throw e;});
            if (role && member.roles.cache.has(role.id)) {
                safeRole(role,await guild.members.fetchMe()); guardCommunityRole(role,cfg);
                await member.roles.remove(role,'Final de la celebración de cumpleaños');
            }
            record={...record,roleId:null}; this.record(guild,id,record);
        }
        if (!due || (record?.year===today.year && record.done)) return;
        if (record?.year!==today.year) {
            record={year:today.year,until:now+DAY,roleId:null,done:false};
            this.record(guild,id,record);
        }
        if (s.roleId && !member.roles.cache.has(s.roleId) && record.until>now) {
            const role=await checkedRole(guild,s.roleId,cfg,null,'birthday');
            this.record(guild,id,record={...record,roleId:role.id});
            await member.roles.add(role,'Celebración de cumpleaños por 24 horas');
        }
        if (s.channelId) {
            const ch=await guild.channels.fetch(s.channelId);
            const nonce=createHash('sha256').update([guild.id,id,today.year].join(':')).digest('hex').slice(0,24);
            await ch.send({content:render(s.text,member),allowedMentions:{parse:[],users:[id]},nonce,enforceNonce:true});
        }
        this.record(guild,id,{...record,done:true});
    }
    async tick(now=Date.now()) {
        if (this.work) return this.work;
        this.work=(async()=>{
            for (const guild of this.client.guilds.cache.values()) {
                const cfg=this.store.guild(guild.id);
                const ids=new Set([...Object.keys(cfg.birthdayDeliveries),...(cfg.birthday.enabled ? Object.keys(cfg.birthdays) : [])]);
                if (!ids.size) continue;
                const today=localTime(now,cfg.birthday.timezone);
                for (const id of ids) try { await this.visit(guild,id,today,now); } catch(e) { console.warn('[CUMPLE]',e.code || e.name); }
            }
        })().finally(()=>{this.work=null;});
        return this.work;
    }
    start() { const run=()=>this.tick().catch(e=>console.warn('[CUMPLE]',e.code || e.name)); run(); this.timer=setInterval(run,60000); this.timer.unref(); }
    async close() { clearInterval(this.timer); await this.work; }
}
module.exports={Birthdays,birthDate,localTime};
