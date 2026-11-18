'use strict';
const { randomBytes } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder, ChannelType } = require('discord.js');
const { UserError, ExpiringCache, Serial } = require('./core');
const { isAdmin } = require('./access');
const { P } = require('./permissions');
const { validateTemplate, renderTemplate, serializeTemplate } = require('./templates');
class Studio {
    constructor() { this.drafts = new ExpiringCache(15 * 60000, 100); this.serial = new Serial(); }
    controls(id, draft) {
        const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`tm:studio:${id}:${action}`).setLabel(label).setStyle(style);
        const rows = [new ActionRowBuilder().addComponents(button('basic','Texto y color'), button('author','Autor'), button('footer','Pie'), button('images','Imágenes'), button('code','Código')),
            new ActionRowBuilder().addComponents(button('commit',draft.save ? 'Guardar diseño' : 'Publicar',ButtonStyle.Success), button('cancel','Cancelar',ButtonStyle.Danger), button('export','Exportar código'))];
        if (!draft.save) rows[1].addComponents(button('ping',`@everyone: ${draft.everyone ? 'sí' : 'no'}`));
        if (draft.model.embeds.length > 1) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`tm:studio:${id}:select`).setPlaceholder('Embed que quieres editar').addOptions(draft.model.embeds.map((e,i)=>({label:`Embed ${i+1}`,value:String(i),default:i===draft.index})))));
        return rows;
    }
    preview(id, draft, member) {
        const p = renderTemplate(draft.model, member);
        return { ...p, content: p.content || null, components: [...p.components, ...this.controls(id,draft)], allowedMentions: { parse: [], repliedUser: false } };
    }
    async create(ctx, source, { channelId = ctx.channel.id, save } = {}) {
        if (!isAdmin(ctx.member, ctx.guild)) throw new UserError('Solo el dueño o un administrador puede crear diseños.');
        const model = validateTemplate(source, ctx.member);
        const id = randomBytes(10).toString('hex');
        const draft = { guildId: ctx.guild.id, userId: ctx.user.id, channelId, model, index: 0, everyone: false, save };
        this.drafts.set(id, draft);
        await ctx.reply(`Borrador para <#${channelId}>. ${save ? 'Pulsa Guardar diseño para aplicarlo a la configuración.' : 'Pulsa Publicar para enviarlo al canal.'} Puedes editarlo durante 15 minutos. La vista previa no envía menciones.`);
        await ctx.reply(this.preview(id,draft,ctx.member));
        return id;
    }
    async authorise(interaction, id) {
        const draft = this.drafts.get(id);
        if (!draft || draft.done) throw new UserError('Este borrador expiró o ya fue utilizado. Crea otro con >embed.');
        if (draft.guildId !== interaction.guildId || draft.userId !== interaction.user.id) throw new UserError('Este editor pertenece a otra persona o servidor.');
        const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
        if (!isAdmin(member, interaction.guild)) throw new UserError('Ya no tienes permiso de administrador.');
        return { draft, member };
    }
    async destination(interaction, draft, member) {
        const ch = await interaction.guild.channels.fetch(draft.channelId).catch(()=>null);
        const me = await interaction.guild.members.fetchMe();
        if (ch?.type !== ChannelType.GuildText || !ch.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]) || !ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw new UserError('Revisa Ver canal, Enviar mensajes e Insertar enlaces en el canal de destino.');
        if (draft.everyone && (!ch.permissionsFor(member).has(P.MentionEveryone) || !ch.permissionsFor(me).has(P.MentionEveryone))) throw new UserError('Para mencionar @everyone, tú y el bot necesitan Mencionar a todos en ese canal.');
        return ch;
    }
    modal(id, action, draft) {
        const e = draft.model.embeds[draft.index] || {};
        const fields = {
            basic: [['content','Mensaje fuera del embed',draft.model.content,2000],['title','Título',e.title,256],['description','Descripción',e.description,4000],['color','Color hexadecimal (ej. #b8a5ff)',e.color,7]],
            author: [['text','Nombre del autor',e.author?.text,256],['icon','URL del icono o {user.avatar}',e.author?.icon,1000],['url','Enlace del autor',e.author?.url,1000]],
            footer: [['text','Texto del pie',e.footer?.text,2048],['icon','URL del icono',e.footer?.icon,1000]],
            images: [['thumbnail','Miniatura: URL o {user.avatar}',e.thumbnail,1000],['image','Imagen grande: URL o GIF',e.image,1000]],
            code: [['code','Plantilla completa (hasta 4000 caracteres)',serializeTemplate(draft.model),4000]]
        }[action];
        if (!fields) throw new UserError('Acción de editor desconocida.');
        if (fields.some(([, ,value,max]) => (value?.length || 0) > max)) throw new UserError('Ese texto es demasiado largo para el formulario. Exporta el código y edítalo con el comando completo.');
        return new ModalBuilder().setCustomId(`tm:studio:${id}:edit-${action}:${draft.index}`).setTitle(`Editar ${action} · Embed ${draft.index + 1}`).addComponents(fields.map(([key,label,value,max])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(['description','content','code','text'].includes(key) ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(max).setValue(value || ''))));
    }
    async handle(i) {
        if (!i.customId?.startsWith('tm:studio:')) return false;
        const [, ,id,action] = i.customId.split(':');
        if (!i.guild) throw new UserError('El editor se usa dentro del servidor.');
        return this.serial.run(id, async () => {
            const { draft, member } = await this.authorise(i,id);
            if (i.isModalSubmit()) {
                await i.deferUpdate();
                const index = Number(i.customId.split(':')[4]);
                if (!Number.isInteger(index) || index < 0 || index > Math.max(0,draft.model.embeds.length - 1)) throw new UserError('El embed ya no existe. Abre de nuevo el editor.');
                const next = structuredClone(draft.model), e = next.embeds[index] ||= {};
                const value = key => i.fields.getTextInputValue(key).trim();
                const group = action.replace('edit-','');
                if (group === 'code') {
                    const model = validateTemplate(value('code'),member);
                    draft.model = model; draft.index = 0;
                } else {
                    if (group === 'basic') { next.content = value('content'); for (const key of ['title','description','color']) e[key] = value(key); }
                    else if (['author','footer'].includes(group)) { e[group] = { text:value('text'), icon:value('icon'), ...(group === 'author' ? { url:value('url') } : {}) }; }
                    else if (group === 'images') for (const key of ['thumbnail','image']) e[key] = value(key);
                    else throw new UserError('Acción inválida.');
                    validateTemplate(next,member); draft.model = next;
                }
                await i.editReply(this.preview(id,draft,member)); return true;
            }
            if (i.isStringSelectMenu() && action === 'select') {
                const n = Number(i.values[0]);
                if (!Number.isInteger(n) || !draft.model.embeds[n]) throw new UserError('Embed inválido.');
                draft.index=n; await i.update(this.preview(id,draft,member)); return true;
            }
            if (!i.isButton()) return true;
            if (['basic','author','footer','images','code'].includes(action)) { await i.showModal(this.modal(id,action,draft)); return true; }
            if (action === 'export') {
                await i.reply({ flags: MessageFlags.Ephemeral, files:[new AttachmentBuilder(Buffer.from(serializeTemplate(draft.model)), {name:'embed.txt'})] }); return true;
            }
            if (action === 'ping') {
                if (draft.save) throw new UserError('Esta plantilla no admite menciones masivas.');
                draft.everyone = !draft.everyone;
                await i.update(this.preview(id,draft,member)); return true;
            }
            if (action === 'cancel') { draft.done=true; await i.update({content:'Borrador cancelado.',embeds:[],components:[]}); return true; }
            if (action !== 'commit') throw new UserError('Acción inválida.');
            await i.deferUpdate();
            const channel = await this.destination(i,draft,member);
            validateTemplate(serializeTemplate(draft.model),member);
            if (draft.save) {
                await draft.save(serializeTemplate(draft.model));
                draft.done=true;
                await i.editReply({content:'Diseño guardado para este servidor. Usa el comando de prueba o publica el panel para verlo.',embeds:[],components:[]});
            } else {
                const payload = renderTemplate(draft.model,member,{everyone:draft.everyone});
                if (draft.everyone && !payload.content.includes('@everyone')) payload.content = '@everyone\n' + payload.content;
                if (payload.content.length > 2000) throw new UserError('Reduce el mensaje para añadir @everyone.');
                const sent = await channel.send(payload);
                draft.done=true;
                await i.editReply({content:`Publicado: https://discord.com/channels/${draft.guildId}/${channel.id}/${sent.id}`,embeds:[],components:[]});
            }
            return true;
        });
    }
}
module.exports = { Studio };
