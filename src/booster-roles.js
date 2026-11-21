'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { UserError, Serial } = require('./core');
const { P, safeRole } = require('./permissions');
const { guardCommunityRole } = require('./delegation');

const instructions = '1. Con tu boost activo, escribe **>rc** en el servidor.\n2. Pulsa **Diseñar mi rol**.\n3. Elige el nombre y un color (por ejemplo, **#B59BFF**) y envía el formulario. Timmy te asignará el rol. Usa el mismo comando para editarlo.';
const colorNames = { rojo: 0xe74c3c, amarillo: 0xf1c40f, verde: 0x2ecc71, negro: 0x010101, morado: 0x9b59b6, azul: 0x3498db, rosa: 0xff92bf, blanco: 0xffffff };
function parseColor(value) {
    const key = value.trim().toLowerCase();
    if (Object.hasOwn(colorNames,key)) return colorNames[key];
    if (!/^#?[a-f\d]{6}$/i.test(key)) throw new UserError('Usa un color como #B59BFF, azul, morado o rosa.');
    return parseInt(key.replace('#',''),16) || 0x010101;
}
class BoosterRoles {
    constructor(store) { this.store = store; this.serial = new Serial(); }
    remember(guild, user, role) {
        const roles = { ...this.store.guild(guild.id).personalRoles };
        if (role) roles[user] = role; else delete roles[user];
        this.store.patchGuild(guild.id,{ personalRoles: roles });
    }
    async known(guild, user) {
        const roleId = this.store.guild(guild.id).personalRoles[user];
        if (!roleId) return null;
        return guild.roles.fetch(roleId,{force:true}).catch(e => { if (e.code !== 10011) throw e; return null; });
    }
    async opener(ctx) {
        const member = await ctx.guild.members.fetch({user:ctx.user.id,force:true});
        if (!member.premiumSinceTimestamp) throw new UserError('Discord reserva este rol para quienes están boosteando este servidor.');
        return ctx.reply({ embeds:[{ color:0xff91c4, title:'💎 Tu rol de booster', description:'Elige cómo se verá tu nombre en la comunidad. Puedes cambiar el diseño mientras mantengas el boost.' }],
            components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tm:rc:open:'+member.id).setLabel('Diseñar mi rol').setStyle(ButtonStyle.Primary))] });
    }
    async handle(i) {
        if (!i.customId?.startsWith('tm:rc:')) return false;
        const [,,action,id] = i.customId.split(':');
        if (!i.guild || id !== i.user.id) throw new UserError('Este formulario pertenece a otro miembro. Abre el tuyo con /rc.');
        if (action === 'open' && i.isButton()) {
            const field = (key,label,max) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(label).setRequired(true).setMaxLength(max).setStyle(TextInputStyle.Short));
            await i.showModal(new ModalBuilder().setCustomId('tm:rc:save:'+id).setTitle('Tu rol de booster').addComponents(field('name','Nombre del rol',100),field('color','Color · #B59BFF o morado',16)));
        } else if (action === 'save' && i.isModalSubmit()) {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            await this.serial.run(i.guild.id+':'+id, async () => {
                const member = await i.guild.members.fetch({ user:id,force:true });
                if (!member.premiumSinceTimestamp) throw new UserError('Necesitas un boost activo en este servidor para guardar tu rol.');
                const me = await i.guild.members.fetchMe();
                if (!me.permissions.has(P.ManageRoles)) throw new UserError('Timmy necesita Gestionar roles para crear tu rol.');
                const name = i.fields.getTextInputValue('name').trim(), color = parseColor(i.fields.getTextInputValue('color'));
                if (!name || name.length > 100) throw new UserError('Elige un nombre de 1 a 100 caracteres.');
                const options = { name, colors:{primaryColor:color}, reason:'Rol personal de booster '+id };
                let role = await this.known(i.guild,id);
                if (role) {
                    safeRole(role,me); guardCommunityRole(role,this.store.guild(i.guild.id));
                    if (role.permissions.bitfield !== 0n) throw new UserError('El equipo cambió los permisos del rol. Pide que revise tu rol personal.');
                    await role.edit(options);
                } else {
                    role = await i.guild.roles.create({ ...options, permissions:[], hoist:false, mentionable:false });
                    try { this.remember(i.guild,id,role.id); } catch (e) { await role.delete('No se pudo guardar el rol personal'); throw e; }
                }
                if (!member.roles.cache.has(role.id)) await member.roles.add(role,'Boost activo');
                await i.editReply({ content:'Tu rol <@&'+role.id+'> está listo.',allowedMentions:{parse:[]} });
            });
        }
        return true;
    }
    cleanup(guild,id,departed=false) {
        if (!this.store.guild(guild.id).personalRoles[id]) return;
        return this.serial.run(guild.id+':'+id,async () => {
            if (!departed) {
                const member = await guild.members.fetch({user:id,force:true}).catch(e => { if (e.code !== 10007) throw e; return null; });
                if (member?.premiumSinceTimestamp) return;
            }
            const role = await this.known(guild,id);
            if (role) {
                safeRole(role,await guild.members.fetchMe()); guardCommunityRole(role,this.store.guild(guild.id));
                if (role.permissions.bitfield !== 0n) throw new UserError('El rol personal cambió de permisos y requiere revisión.');
                await role.delete('Fin del rol personal de booster');
            }
            this.remember(guild,id,null);
        });
    }
}
module.exports = { BoosterRoles, instructions, parseColor };
