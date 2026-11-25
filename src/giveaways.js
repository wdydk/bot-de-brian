'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomInt } = require('node:crypto');
const { ChannelType, ButtonStyle, MessageFlags } = require('discord.js');
const { UserError, ExpiringCache, Serial } = require('./core');
const { isAdmin } = require('./access');
const { P } = require('./permissions');
const { parsePublication, draftFields, replyFields, missingDetails, channelIn, example } = require('./giveaway-request');

const quiet = { parse: [], repliedUser: false };
const button = (id, label, style, disabled = false) => ({ type: 2, style, label, custom_id: id, disabled });
const row = (...components) => ({ type: 1, components });
const link = d => 'https://discord.com/channels/' + [d.guild, d.channel, d.message].join('/');
async function destination(guild, ref) {
    if (!ref) throw new UserError('Menciona el canal de destino. ' + example);
    if (ref.startsWith('#')) {
        const matches = [...guild.channels.cache.values()].filter(c => c.name === ref.slice(1));
        if (matches.length !== 1) throw new UserError('Selecciona el canal ' + ref + ' en las sugerencias de Discord.');
        ref = matches[0].id;
    }
    const id = String(ref).replace(/^<#(\d+)>$/, '$1');
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) throw new UserError('Elige un canal de texto o anuncios de este servidor.');
    return ch;
}
function authoriseChannel(ch, me, actor) {
    if (!ch.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks]) ||
        !ch.permissionsFor(actor)?.has([P.ViewChannel, P.SendMessages])) throw new UserError('Revisa Ver canal, Enviar mensajes e Insertar enlaces en <#' + ch.id + '>.');
}
function panel(d, winners = null, count = 0) {
    const end = Math.floor(d.ends / 1000), closed = winners !== null;
    const embed = { author: { name: 'Timmy Max · Sorteos' }, color: closed ? 0x39a681 : 0x9775ff,
        title: closed ? '🏆 Resultados del sorteo' : '🎉 ' + d.prize,
        description: closed ? '**Premio · ' + d.prize + '**\n\n' + (winners.length ? winners.map(id => '<@' + id + '>').join(' · ') : 'Esta vez nadie participó.')
            : 'Pulsa **Entrar** para participar. Tu confirmación es privada.',
        fields: [{ name: 'Ganadores', value: String(closed ? winners.length : d.winners), inline: true },
            { name: closed ? 'Participantes' : 'Termina', value: closed ? String(count) : '<t:' + end + ':R>', inline: true },
            { name: 'Organiza', value: '<@' + d.host + '>', inline: true }],
        footer: { text: closed ? 'Sorteo finalizado' : 'Una participación por persona' }, timestamp: new Date(d.ends).toISOString() };
    return { embeds: [embed], components: [row(button('tm:draw:join:' + d.id, closed ? 'Finalizado' : 'Entrar', ButtonStyle.Primary, closed))], allowedMentions: quiet };
}
function announcement(d) {
    return { embeds: [{ color: 0xffbd58, title: '🎁 Hay sorteo en la comunidad',
        description: (d.copy ? d.copy + '\n\n' : '') + '**' + d.prize + '** en <#' + d.channel + '> · <t:' + Math.floor(d.ends / 1000) + ':R>' }],
        components: [row({ type: 2, style: ButtonStyle.Link, label: 'Ver sorteo', url: link(d) })], allowedMentions: quiet };
}
class Giveaways {
    constructor(store, client, studio) {
        this.store = store; this.client = client; this.studio = studio;
        this.drafts = new ExpiringCache(15 * 60000, 500);
        this.questions = new ExpiringCache(10 * 60000, 500); this.serial = new Serial();
    }
    db() {
        if (!this.database) {
            this.database = new DatabaseSync(path.join(this.store.directory, 'giveaways.sqlite'));
            this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS draws(id TEXT PRIMARY KEY,guild TEXT,channel TEXT,host TEXT,prize TEXT,winners INTEGER,ends INTEGER,message TEXT,notice TEXT,copy TEXT,announced INTEGER DEFAULT 0,result TEXT,finished INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS deadlines ON draws(finished,ends); CREATE TABLE IF NOT EXISTS entries(draw TEXT,user TEXT,PRIMARY KEY(draw,user)); CREATE TABLE IF NOT EXISTS rerolls(id INTEGER PRIMARY KEY,draw TEXT NOT NULL,actor TEXT NOT NULL,previous TEXT NOT NULL,next TEXT NOT NULL,at INTEGER NOT NULL);');
        }
        return this.database;
    }
    find(id) { return this.db().prepare('SELECT * FROM draws WHERE id=?').get(id); }
    active(guild, member) {
        const draws = this.db().prepare(
            'SELECT guild, channel, message, prize, ends FROM draws ' +
            'WHERE guild=? AND finished=0 AND result IS NULL AND message IS NOT NULL AND ends>? ORDER BY ends, id'
        );
        const fields = [];
        for (const draw of draws.iterate(guild.id, Date.now())) {
            const channel = guild.channels.cache.get(draw.channel);
            if (!channel?.permissionsFor(member)?.has([P.ViewChannel, P.ReadMessageHistory])) continue;
            fields.push({ name: draw.prize, value: '[Ver sorteo](' + link(draw) + ') · Termina <t:' + Math.floor(draw.ends / 1000) + ':R>' });
            if (fields.length === 10) break;
        }
        const description = fields.length ? 'Por orden de cierre. Abre un sorteo y pulsa **Entrar** para participar.' : 'No hay sorteos activos que puedas ver en este servidor.';
        return { embeds: [{ title: '🎉 Sorteos abiertos', description, color: 0x9775ff, fields }], allowedMentions: quiet };
    }
    questionKey(ctx) { return [ctx.guild?.id,ctx.channel?.id,ctx.user.id].join(':'); }
    request(ctx, text) {
        const explicit = parsePublication(text);
        if (explicit) return explicit;
        const pending = this.questions.get(this.questionKey(ctx));
        if (!pending || !text.trim() || /[¿?]/.test(text)) return null;
        if (/^cancelar[.!]?$/i.test(text.trim())) return { type:'cancel-question' };
        const mentioned = channelIn(text);
        const channel = (pending.fixNotice ? null : mentioned) || pending.channel;
        if (pending.type !== 'draw') {
            const content = !pending.channel && mentioned ? text.replace(mentioned,'') : text;
            const copy = content.replace(/^\s*(?:diciendo que|que diga|texto:)\s*/i,'').trim();
            return { ...pending, channel, text: pending.text || copy };
        }
        const notice = mentioned && pending.fixNotice ? { ...pending.notice, channel: mentioned } : pending.notice;
        const update = replyFields(text, channel && !mentioned ? pending.details : null);
        if (!Object.keys(update).length && !mentioned) return null;
        return { ...pending, channel, notice, details: { ...pending.details, ...update } };
    }
    async prepare(ctx, request) {
        if (!ctx.guild) throw new UserError('Prepara el sorteo o el evento dentro del servidor.');
        const actor = await ctx.guild.members.fetch({ user: ctx.user.id, force: true });
        if (!isAdmin(actor, ctx.guild)) throw new UserError('Solo el dueño o un administrador puede publicar sorteos y eventos. Para participar, pulsa Entrar.');
        const key = this.questionKey(ctx);
        if (request.type === 'cancel-question') { this.questions.delete(key); return ctx.reply('Solicitud cancelada.'); }
        const details = request.type === 'draw' ? request.details || draftFields(request.text, request.fields) : null;
        const missing = details ? missingDetails(details) : request.text ? [] : ['el texto del anuncio'];
        if (!request.channel) missing.push('el canal de destino');
        const pending = { ...request, details, fixNotice: false };
        this.questions.set(key, pending);
        if (missing.length) {
            let hint = details ? example : 'Ejemplo: >ask diciendo que el torneo TSB empieza el sábado a las 6.';
            if (missing.length === 1 && details && !details.winners) hint = 'Ejemplo: >ask 2';
            if (missing.length === 1 && details && !details.prize) hint = 'Ejemplo: >ask 5k Robux';
            return ctx.reply('Me falta ' + missing.join(', ') + '. Respóndeme con una mención o con >ask. ' + hint);
        }
        const ch = await destination(ctx.guild, request.channel), me = await ctx.guild.members.fetchMe();
        authoriseChannel(ch, me, actor);
        let notice;
        if (request.notice) {
            try {
                notice = await destination(ctx.guild, request.notice.channel);
                authoriseChannel(notice, me, actor);
            } catch (error) {
                pending.fixNotice = true;
                if (error instanceof UserError) throw new UserError('Para el aviso: ' + error.message + ' Responde con el canal del aviso.');
                throw error;
            }
        }
        if (this.questions.get(key) !== pending) return;
        if (!details) {
            const preview = await this.studio.create({ ...ctx, member: actor }, { content: '', embeds: [{ title: request.type === 'event' ? '📅 Evento de la comunidad' : '📣 Anuncio', description: request.text, color: '#a98afa' }], buttons: [] }, { channelId: ch.id });
            if (this.questions.get(key) === pending) this.questions.delete(key);
            return preview;
        }
        const id = randomBytes(9).toString('hex');
        const d = { ...details, id, host: ctx.user.id, guild: ctx.guild.id, channel: ch.id, notice: notice?.id || null, copy: request.notice?.text || '' };
        this.drafts.set(id, d);
        const embed = panel({ ...d, ends: Date.now() + d.ms }).embeds[0];
        embed.fields[1] = { name: 'Duración al publicar', value: d.ms % 86400000 === 0 ? d.ms/86400000 + ' d' : d.ms % 3600000 === 0 ? d.ms/3600000 + ' h' : d.ms/60000 + ' min', inline: true };
        delete embed.timestamp;
        await ctx.reply({ content: 'Borrador para <#' + ch.id + '>.' + (notice ? ' Aviso en <#' + notice.id + '>.' : ''), embeds: [embed, ...(notice ? [{ title: '📣 Aviso', description: d.copy || 'Invitación con enlace al sorteo.' }] : [])],
            components: [row(button('tm:draw:publish:' + id,'Publicar',ButtonStyle.Success),button('tm:draw:cancel:' + id,'Cancelar',ButtonStyle.Secondary))], allowedMentions: quiet });
        if (this.questions.get(key) === pending) this.questions.delete(key);
        return id;
    }
    async handle(i) {
        if (!i.customId?.startsWith('tm:draw:')) return false;
        const [, , action, id] = i.customId.split(':');
        if (action === 'join') {
            const d = this.find(id);
            let answer = 'El sorteo ya terminó.';
            if (!d || d.guild !== i.guildId || d.channel !== i.channelId || (d.message && d.message !== i.message.id) || i.message.author.id !== this.client.user.id) answer = 'Este botón no corresponde a un sorteo activo.';
            else if (i.user.bot) answer = 'Solo los miembros pueden participar.';
            else {
                // A click on our panel also recovers its ID after an interrupted publish.
                if (!d.message) this.db().prepare('UPDATE draws SET message=? WHERE id=? AND message IS NULL').run(i.message.id,id);
                if (!d.result && d.ends > Date.now()) {
                    const joined = this.db().prepare('INSERT OR IGNORE INTO entries(draw,user) SELECT id,? FROM draws WHERE id=? AND result IS NULL AND ends>?').run(i.user.id,id,Date.now());
                    answer = joined.changes ? '🎟️ <@' + i.user.id + '>, has entrado al sorteo de **' + d.prize + '**.' : (d.ends > Date.now() ? 'Ya estás participando con una entrada.' : 'El sorteo ya terminó.');
                }
            }
            await i.reply({ content: answer, flags: MessageFlags.Ephemeral, allowedMentions: quiet }); return true;
        }
        const draft = this.drafts.get(id);
        if (!draft || draft.host !== i.user.id || draft.guild !== i.guildId) throw new UserError('Este borrador expiró o pertenece a otra persona.');
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await this.serial.run(id, async () => {
            if (!this.drafts.get(id)) throw new UserError('Este borrador ya se usó.');
            const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
            if (!isAdmin(actor, i.guild)) throw new UserError('Solo el dueño o un administrador puede publicar.');
            let d = this.find(id);
            if (action === 'cancel' && !d) { this.drafts.delete(id); await i.editReply('Borrador cancelado.'); return; }
            if (action !== 'publish') throw new UserError('El sorteo ya se está publicando.');
            const ch = await destination(i.guild, draft.channel), me = await i.guild.members.fetchMe();
            authoriseChannel(ch, me, actor);
            const notice = draft.notice && await destination(i.guild, draft.notice);
            if (notice) authoriseChannel(notice, me, actor);
            if (!d) {
                const ends = Date.now() + draft.ms;
                this.db().prepare('INSERT INTO draws(id,guild,channel,host,prize,winners,ends,notice,copy) VALUES (?,?,?,?,?,?,?,?,?)')
                    .run(id,draft.guild,draft.channel,draft.host,draft.prize,draft.winners,ends,draft.notice,draft.copy);
                d = this.find(id);
            }
            if (!d.message) {
                const sent = await ch.send({ ...panel(d), nonce: id, enforceNonce: true });
                this.db().prepare('UPDATE draws SET message=? WHERE id=?').run(sent.id,id); d.message = sent.id;
            }
            if (notice && !d.announced) {
                try { await this.sendNotice(d, notice); }
                catch { await i.editReply('El sorteo está publicado en ' + link(d) + '. El aviso sigue pendiente. Puedes volver a pulsar Publicar para reintentarlo.'); return; }
            }
            this.drafts.delete(id);
            await i.editReply('Sorteo publicado: ' + link(d) + (notice ? '\nAviso en <#' + notice.id + '>.' : ''));
        });
        if (!this.drafts.get(id)) await i.message.edit({ components: [] }).catch(() => {});
        return true;
    }
    async sendNotice(d, channel) {
        await channel.send({ ...announcement(d), nonce: 'n' + d.id, enforceNonce: true });
        this.db().prepare('UPDATE draws SET announced=1 WHERE id=?').run(d.id);
    }
    result(id) {
        const db = this.db(); db.exec('BEGIN IMMEDIATE');
        try {
            const d = this.find(id);
            if (!d.result) {
                const people = db.prepare('SELECT user FROM entries WHERE draw=?').all(id);
                const limit = Math.min(d.winners, people.length);
                for (let i = 0; i < limit; i++) {
                    const j = randomInt(i, people.length);
                    [people[i], people[j]] = [people[j], people[i]];
                }
                db.prepare('UPDATE draws SET result=? WHERE id=?').run(JSON.stringify(people.slice(0,limit).map(p => p.user)),id);
            }
            db.exec('COMMIT'); return this.find(id);
        } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    listForWeb(guild){
        return this.db().prepare('SELECT id,channel,message,prize,winners,ends,finished,result FROM draws WHERE guild=? AND message IS NOT NULL ORDER BY ends DESC LIMIT 50').all(guild);
    }
    async publishWeb(ctx,request,nonce){
        if(!/^[a-f0-9]{18}$/.test(nonce||''))throw new UserError('Solicitud caducada; recarga la página.');
        const actor=await ctx.guild.members.fetch({user:ctx.user.id,force:true});
        if(!isAdmin(actor,ctx.guild))throw new UserError('Solo un administrador puede publicar.');
        const details=draftFields('',request.fields);
        if(missingDetails(details).length)throw new UserError('Completa premio, duración y ganadores.');
        const ch=await destination(ctx.guild,request.channel),me=await ctx.guild.members.fetchMe();
        authoriseChannel(ch,me,actor);
        return this.serial.run(nonce,async()=>{
            const db=this.db(),old=this.find(nonce);
            if(old){
                if(old.guild!==ctx.guild.id||old.host!==actor.id)throw new UserError('Solicitud no válida.');
                if(old.message)return link(old);
                throw new UserError('Publicación previa sin confirmación. Revisa el canal antes de crear otra.');
            }
            db.prepare('INSERT INTO draws(id,guild,channel,host,prize,winners,ends,notice,copy) VALUES(?,?,?,?,?,?,?,?,?)').run(nonce,ctx.guild.id,ch.id,actor.id,details.prize,details.winners,Date.now()+details.ms,null,'');
            const d=this.find(nonce);
            const sent=await ch.send({...panel(d),nonce,enforceNonce:true});
            db.prepare('UPDATE draws SET message=? WHERE id=?').run(sent.id,nonce);
            return link(this.find(nonce));
        });
    }
    async control(ctx, action, ref) {
        if (!isAdmin(ctx.member,ctx.guild)) throw new UserError('Solo un administrador o dueño puede gestionar el sorteo.');
        const linkMatch=/^https:\/\/discord\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/.exec(ref||'');
        if(linkMatch && linkMatch[1]!==ctx.guild.id) throw new UserError('El sorteo pertenece a otro servidor.');
        const message=linkMatch?.[3]||ref;
        if(!/^\d{17,20}$/.test(message||'')) throw new UserError('Copia el ID o enlace del mensaje del sorteo.');
        const db=this.db();
        const found=db.prepare('SELECT id FROM draws WHERE guild=? AND message=?').get(ctx.guild.id,message);
        if(!found) throw new UserError('No encontré el sorteo en este servidor.');
        return this.serial.run(found.id,async()=>{
            let d=this.find(found.id);
            if(linkMatch && linkMatch[2]!==d.channel) throw new UserError('Canal incorrecto.');
            const ch=await destination(ctx.guild,d.channel), me=await ctx.guild.members.fetchMe();
            authoriseChannel(ch,me,ctx.member);
            if(action==='end') {
                if(d.finished) throw new UserError('El sorteo ya terminó. Usa reroll si quieres otros ganadores.');
                db.prepare('UPDATE draws SET ends=MIN(ends,?) WHERE id=?').run(Date.now(),d.id);
                d=this.result(d.id);
            } else if(action==='reroll') {
                if(!d.finished||!d.result) throw new UserError('Primero termina el sorteo y espera que se publique el resultado.');
                const previous=JSON.parse(d.result);
                const people=db.prepare('SELECT user FROM entries WHERE draw=?').all(d.id).map(x=>x.user).filter(id=>!previous.includes(id));
                if(people.length<d.winners) throw new UserError('No hay suficientes participantes distintos para reemplazar a todos los ganadores.');
                for(let i=0;i<d.winners;i++){const j=randomInt(i,people.length);[people[i],people[j]]=[people[j],people[i]];}
                const next=JSON.stringify(people.slice(0,d.winners));
                db.exec('BEGIN IMMEDIATE');
                try {
                    db.prepare('INSERT INTO rerolls(draw,actor,previous,next,at) VALUES (?,?,?,?,?)').run(d.id,ctx.user.id,d.result,next,Date.now());
                    db.prepare('UPDATE draws SET result=?,finished=0 WHERE id=?').run(next,d.id);
                    db.exec('COMMIT');
                }catch(e){db.exec('ROLLBACK');throw e;}
                d=this.find(d.id);
            } else throw new UserError('Acción desconocida.');
            const count=db.prepare('SELECT count(*) AS n FROM entries WHERE draw=?').get(d.id).n;
            try {
                await ch.messages.edit(d.message,panel(d,JSON.parse(d.result),count));
                db.prepare('UPDATE draws SET finished=1 WHERE id=?').run(d.id);
            }catch {return 'Resultado guardado; no pude editar el mensaje. Timmy reintentará con el mismo resultado.';}
            return (action==='reroll'?'Ganadores reemplazados: ':'Sorteo terminado: ')+link(d);
        });
    }
    async sweep() {
        if (this.running) return this.running;
        this.running = this.process().finally(() => { this.running = null; });
        return this.running;
    }
    async process() {
        const db = this.db();
        const rows = db.prepare('SELECT id FROM draws WHERE finished=0 AND (ends<=? OR (notice IS NOT NULL AND announced=0 AND message IS NOT NULL) OR message IS NULL)').all(Date.now());
        for (const { id } of rows) await this.serial.run(id, async () => {
            let d = this.find(id);
            const guild = this.client.guilds.cache.get(d.guild);
            if (!guild) return;
            try {
                const ch = await guild.channels.fetch(d.channel);
                if (!d.message) {
                    // Adopt only a message actually sent by Timmy. Never launch a missed draw on restart.
                    const messages = await ch.messages.fetch({ limit: 100 });
                    const sent = messages.find(m => m.author.id === this.client.user.id && m.components.some(r => r.components.some(b => b.customId === 'tm:draw:join:' + id)));
                    if (!sent) { if (d.ends <= Date.now()) db.prepare('UPDATE draws SET finished=1 WHERE id=?').run(id); return; }
                    db.prepare('UPDATE draws SET message=? WHERE id=?').run(sent.id,id); d.message = sent.id;
                }
                if (d.ends <= Date.now()) {
                    d = this.result(id);
                    const count = db.prepare('SELECT count(*) AS n FROM entries WHERE draw=?').get(id).n;
                    await ch.messages.edit(d.message,panel(d,JSON.parse(d.result),count));
                    db.prepare('UPDATE draws SET finished=1 WHERE id=?').run(id);
                } else if (d.notice && !d.announced) {
                    const target = await guild.channels.fetch(d.notice);
                    await this.sendNotice(d,target);
                }
            } catch (error) {
                if ([10003,10008].includes(error.code) && d.ends <= Date.now()) db.prepare('UPDATE draws SET finished=1 WHERE id=?').run(id);
                else console.warn('[SORTEOS]', error.code || error.name);
            }
        });
    }
    start() {
        const tick = () => this.sweep().catch(e => console.warn('[SORTEOS]',e.code || e.name));
        tick(); this.timer = setInterval(tick,15000); this.timer.unref();
    }
    async close() { clearInterval(this.timer); await this.running; this.database?.close(); }
}
module.exports = { Giveaways, panel };
