'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PermissionsBitField, ChannelType, Collection, MessageFlags } = require('discord.js');
const { P } = require('../src/permissions');
const { Store } = require('../src/core');
const { BoosterRoles } = require('../src/booster-roles');
const { Birthdays, birthDate, localTime } = require('../src/birthdays');
const { Rewards, eventValues } = require('../src/rewards');
const { parseTemplate, renderTemplate } = require('../src/templates');
function fixture(t) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-member-')), store=new Store(dir);
    const guild={id:'110000000000000001',ownerId:'220000000000000002',name:'DYNASTY',memberCount:4};
    const user={id:'330000000000000003',username:'Alex',displayAvatarURL:()=> 'https://cdn.discordapp.com/avatar.png'};
    const messages=[], roles=new Collection();
    const member={id:user.id,user,guild,displayName:'Alex',premiumSinceTimestamp:12345,roles:{cache:new Map(),
        add:async role=>member.roles.cache.set(role.id,role),remove:async role=>member.roles.cache.delete(role.id)}};
    const me={permissions:new PermissionsBitField([P.ManageRoles]),roles:{highest:{comparePositionTo:()=>1}}};
    guild.members={fetch:async ({user:id})=>id===member.id?member:null,fetchMe:async()=>me};
    guild.roles={cache:roles,fetch:async id=>roles.get(id),create:async options=>{
        const role={id:String(400000000000000000n+BigInt(roles.size+1)),guild,position:1,editable:true,managed:false,permissions:new PermissionsBitField(options.permissions),
            ...options,edit:async change=>Object.assign(role,change),delete:async()=>roles.delete(role.id)};
        role.permissions=new PermissionsBitField(options.permissions);
        roles.set(role.id,role);return role;
    }};
    const channel={id:'550000000000000005',type:ChannelType.GuildText,permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages]),
        send:async data=>messages.push(data)};
    guild.channels={fetch:async id=>id===channel.id?channel:null};
    const client={guilds:{cache:new Map([[guild.id,guild]])}};
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    return {dir,store,guild,user,member,channel,messages,roles,client};
}
test('>rc crea un único rol sin permisos, permite editarlo y lo retira si termina el boost',async t=>{
    const h=fixture(t), service=new BoosterRoles(h.store), seen=[];
    const ctx={user:h.user,guild:h.guild,reply:async data=>seen.push(data)};
    await service.opener(ctx);const open=seen.pop().components[0].toJSON().components[0].custom_id;
    let modal;const base={guild:h.guild,user:h.user};
    await service.handle({...base,isButton:()=>true,customId:open,showModal:async m=>{modal=m.toJSON();}});
    assert.equal(modal.components.length,2);
    let name='Luna';
    const save=()=>service.handle({...base,customId:modal.custom_id,isModalSubmit:()=>true,
        fields:{getTextInputValue:key=>key==='name'?name:'#B59BFF'},deferReply:async data=>assert.equal(data.flags,MessageFlags.Ephemeral),editReply:async data=>seen.push(data)});
    await Promise.all([save(),save()]);assert.equal(h.roles.size,1);
    const role=h.roles.first();assert.ok(h.member.roles.cache.has(role.id));assert.equal(role.permissions.bitfield,0n);
    assert.equal(role.mentionable,false);assert.equal(role.colors.primaryColor,0xb59bff);
    name='Luna 2';await save();assert.equal(role.name,'Luna 2');
    await assert.rejects(service.handle({...base,customId:open,user:{id:'otro'}}),/otro miembro/);
    h.member.premiumSinceTimestamp=null;
    await assert.rejects(save(),/boost activo/);
    await service.cleanup(h.guild,h.user.id);assert.equal(h.roles.size,0);assert.deepEqual(h.store.guild(h.guild.id).personalRoles,{});
});
test('cumpleaños valida la fecha, la hora local, la entrega única y la retirada 24 horas después de reiniciar',async t=>{
    const h=fixture(t), first=new Birthdays(h.store,h.client), role=await h.guild.roles.create({permissions:[]});
    const s={enabled:true,roleId:role.id,channelId:h.channel.id,timezone:'America/Los_Angeles',hour:'09:15',text:'🎂 ¡Felicidades {user}!'};
    const owner={id:h.guild.ownerId,guild:h.guild,permissions:new PermissionsBitField([])};
    await first.save({guild:h.guild,member:owner},s,0);
    assert.throws(()=>birthDate('31/02'));assert.equal(birthDate('29/2'),'29/02');
    first.register(h.guild.id,h.user.id,'21/11');
    const at=Date.parse('2026-11-21T17:15:00Z');
    assert.deepEqual(localTime(at,s.timezone),{day:'21/11',year:'2026',hour:'09:15'});
    await first.tick(at-60000);assert.equal(h.messages.length,0);
    await first.tick(at);assert.equal(h.messages.length,1);assert.match(h.messages[0].content,new RegExp(h.user.id));
    assert.deepEqual(h.messages[0].allowedMentions.users,[h.user.id]);assert.ok(h.member.roles.cache.has(role.id));
    const restart=new Birthdays(new Store(h.dir),h.client);
    await restart.tick(at+86000000);assert.equal(h.messages.length,1);assert.ok(h.member.roles.cache.has(role.id));
    await restart.tick(at+86400000);assert.equal(h.member.roles.cache.has(role.id),false);
    assert.match(restart.register(h.guild.id,h.user.id,'borrar'),/Retiré/);
});
test('XP real sustituye las dos variables del embed y los ajustes conservan la XP de otros servidores',async t=>{
    const h=fixture(t), rewards=new Rewards(h.store,async()=>{});t.after(()=>rewards.close());
    await rewards.setXp(h.guild,h.user.id,513,0);
    const model=parseTemplate('{embed}$v{description: Ahora eres nivel {level.new_rank}.}$v{footer: XP total {level.user_xp}}');
    const data=renderTemplate(model,h.member,{values:eventValues('levels',{},rewards.xp(h.guild.id,h.user.id))});
    assert.equal(data.embeds[0].description,'Ahora eres nivel 5.');assert.equal(data.embeds[0].footer.text,'XP total 513');
    assert.equal(rewards.leaderboard(h.guild.id).rows[0].total,513);
    assert.equal(rewards.leaderboard('otro').rows.length,0);
    await assert.rejects(rewards.setXp(h.guild,h.user.id,700,500),/cambió/);
    assert.equal(rewards.xp(h.guild.id,h.user.id),513);
});
