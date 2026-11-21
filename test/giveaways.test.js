'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PermissionsBitField, ChannelType, MessageFlags, Collection } = require('discord.js');
const { Store } = require('../src/core');
const { P } = require('../src/permissions');
const { Giveaways } = require('../src/giveaways');
const { parsePublication, draftFields: settings } = require('../src/giveaway-request');

const sentence = 'hazme un mensaje en #evento diciendo que hay un give away en el canal #giveaway y créame un give away en el canal #giveaway con 5 horas y premio 5k Robux y ganadores 2';
const guildId = '111111111111111111', owner = '222222222222222222', bot = '333333333333333333';
function setup(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'timmy-draw-'));
    const guild = { id:guildId, ownerId:owner };
    const admin = {id:owner,permissions:new PermissionsBitField([])}, member = {id:'444444444444444444',permissions:new PermissionsBitField([])};
    guild.members = {fetch:async ({user})=>user===owner?admin:member,fetchMe:async()=>({id:bot})};
    const channels = new Map(), sends=[], edits=[], previews=[];
    let sequence=0;
    for (const [name,id] of [['giveaway','555555555555555555'],['evento','666666666666666666']]) {
        const channel={name,id,type:name==='evento'?ChannelType.GuildAnnouncement:ChannelType.GuildText,
            permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks]),
            send:async data=>{sends.push({channel:id,data});return {id:String(++sequence)};},
            messages:{edit:async (message,data)=>edits.push({message,data}),fetch:async()=>new Collection()}};
        channels.set(id,channel);
    }
    guild.channels={cache:channels,fetch:async id=>channels.get(id)};
    const client={user:{id:bot},guilds:{cache:new Map([[guildId,guild]])}};
    const store=new Store(directory), studio={create:async(...args)=>previews.push(args)};
    const current=()=>new Giveaways(store,client,studio);
    const service=current();
    t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
    const ctx={guild,user:admin,reply:async data=>previews.push(data)};
    function click(action,id,user=admin,message='preview') {
        const replies=[];
        return {customId:'tm:draw:'+action+':'+id,user,guild,guildId,channelId:'555555555555555555',
            message:{id:message,author:{id:bot},edit:async()=>{}},replies,reply:async data=>replies.push(data),
            deferReply:async data=>replies.push(data),editReply:async data=>replies.push(data)};
    }
    return {ctx,admin,member,service,current,guild,click,sends,edits,previews,store};
}
test('el pedido de dos canales conserva premio, duración, ganadores y texto del aviso',()=>{
    const r=parsePublication(sentence);
    assert.deepEqual(settings(r.text),{ms:18000000,winners:2,prize:'5k Robux'});
    assert.equal(r.channel,'#giveaway');assert.equal(r.notice.channel,'#evento');assert.match(r.notice.text,/hay un give away/);
    for(const [duration,ms] of [['15 minutos',900000],['days: 2',172800000],['1,5 horas',5400000]]) {
        assert.deepEqual(settings(duration+' prize: Pase VIP winners: 2'),{ms,winners:2,prize:'Pase VIP'});
    }
    assert.deepEqual(settings('',{duration:'5 horas',prize:'Desafío de ganadores',winners:2}),{ms:18000000,winners:2,prize:'Desafío de ganadores'});
    assert.throws(()=>settings('0 horas premio: VIP ganadores: 2'));
    assert.throws(()=>settings('1h premio: VIP ganadores: -1'));
    assert.equal(parsePublication('¿cómo se hace un giveaway?'),null);
});
test('borrador, aprobación por su dueño, dos canales y una entrada privada por persona',async t=>{
    const h=setup(t), r=parsePublication(sentence);
    await assert.rejects(h.service.prepare({...h.ctx,user:h.member},r),/dueño o un administrador/);
    const id=await h.service.prepare(h.ctx,r);
    assert.equal(h.sends.length,0);
    await assert.rejects(h.service.handle(h.click('publish',id,h.member)),/otra persona/);
    const publishes=await Promise.allSettled([h.service.handle(h.click('publish',id)),h.service.handle(h.click('publish',id))]);
    assert.equal(publishes.filter(p=>p.status==='fulfilled').length,1);
    assert.deepEqual(h.sends.map(m=>m.channel),['555555555555555555','666666666666666666']);
    assert.equal(h.sends[0].data.components[0].components[0].label,'Entrar');
    assert.match(h.sends[1].data.components[0].components[0].url,/555555555555555555\/1$/);
    const join=()=>h.click('join',id,h.member,'1'), first=join(),second=join();
    await Promise.all([h.service.handle(first),h.service.handle(second)]);
    assert.equal(first.replies[0].flags,MessageFlags.Ephemeral);
    assert.match(first.replies[0].content,new RegExp('<@'+h.member.id+'>'));
    assert.match(second.replies[0].content,/Ya estás/);
    const wrong=join();wrong.guildId='otro';
    await h.service.handle(wrong);assert.match(wrong.replies[0].content,/no corresponde/);
    assert.equal(h.sends.length,2);
    const event=parsePublication('hazme un evento en #evento diciendo que el torneo empieza el sábado');
    await h.service.prepare(h.ctx,event);
    assert.equal(h.previews.at(-1)[1].embeds[0].description,'el torneo empieza el sábado');
});
test('un fallo en el aviso se reintenta y el cierre conserva los ganadores durante un reinicio',async t=>{
    const h=setup(t), ch=h.guild.channels.cache.get('666666666666666666'), original=ch.send;
    ch.send=async()=>{throw Error('temporal');};
    const id=await h.service.prepare(h.ctx,parsePublication(sentence));
    await h.service.handle(h.click('publish',id));
    assert.equal(h.service.find(id).announced,0);
    ch.send=original;await h.service.sweep();await h.service.sweep();
    assert.equal(h.sends.length,2);assert.equal(h.service.find(id).announced,1);
    await h.service.handle(h.click('join',id,h.member,'1'));
    h.service.db().prepare('UPDATE draws SET ends=? WHERE id=?').run(Date.now()-1000,id);
    const board=h.guild.channels.cache.get('555555555555555555'), edit=board.messages.edit;
    board.messages.edit=async()=>{throw Error('temporal');};
    await h.service.sweep();
    const snapshot=h.service.find(id);assert.equal(snapshot.finished,0);assert.deepEqual(JSON.parse(snapshot.result),[h.member.id]);
    const restarted=h.current();try {
        board.messages.edit=edit;await restarted.sweep();await restarted.sweep();
        assert.equal(h.edits.length,1);assert.equal(h.edits[0].data.components[0].components[0].disabled,true);
        assert.equal(restarted.find(id).result,snapshot.result);
        const late=h.click('join',id,h.admin,'1');await restarted.handle(late);assert.match(late.replies[0].content,/terminó/);
    } finally {await restarted.close();}
});
test('cancela un borrador y finaliza sorteos vacíos o con dos personas distintas',async t=>{
    const h=setup(t), r=parsePublication('crea un sorteo en #giveaway premio: VIP minutes: 2 winners: 2');
    const cancel=await h.service.prepare(h.ctx,r);
    await h.service.handle(h.click('cancel',cancel));assert.equal(h.sends.length,0);
    for (const size of [0,3]) {
        const id=await h.service.prepare(h.ctx,r);
        await h.service.handle(h.click('publish',id));
        const d=h.service.find(id);
        for(let n=0;n<size;n++) await h.service.handle(h.click('join',id,{id:'person'+n},d.message));
        h.service.db().prepare('UPDATE draws SET ends=1 WHERE id=?').run(id);
        await h.service.sweep();const winners=JSON.parse(h.service.find(id).result);
        assert.equal(new Set(winners).size,Math.min(size,2));
    }
});
