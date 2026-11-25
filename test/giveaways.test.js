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

test('al sorteo que solo espera ganadores se le puede responder con un número', async t => {
    const h = setup(t);
    await h.service.prepare(h.ctx, parsePublication('crea un sorteo en #giveaway con 5 horas y el premio es de 5k Robux'));
    assert.match(h.previews.at(-1), /número de ganadores/);
    assert.equal(h.service.request({ ...h.ctx, user: h.member }, '2'), null);
    assert.equal(h.service.request(h.ctx, '¿qué hora es?'), null);
    assert.throws(() => h.service.request(h.ctx, '0'), /1 a 100/);
    const followup = h.service.request(h.ctx, '2');
    assert.ok(followup);
    await h.service.prepare(h.ctx, followup);
    assert.equal(h.previews.at(-1).embeds[0].title, '🎉 5k Robux');
    assert.equal(h.previews.at(-1).embeds[0].fields[0].value, '2');
    assert.equal(h.sends.length, 0);
});

test('la lista privada contiene solo mensajes de sorteos vigentes y visibles, ordenados por cierre', t => {
    const h = setup(t), now = Date.now(), publicId = '555555555555555555', hiddenId = '666666666666666666';
    h.guild.channels.cache.get(publicId).permissionsFor = () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]);
    h.guild.channels.cache.get(hiddenId).permissionsFor = () => new PermissionsBitField([P.ViewChannel]);
    const insert = h.service.db().prepare('INSERT INTO draws (id,guild,channel,prize,ends,message,result,finished,winners) VALUES (?,?,?,?,?,?,?,?,2)');
    function draw(prize, opts = {}) {
        const {guild = guildId, channel = publicId, end = 10000, message = prize, result = null, finished = 0} = opts;
        insert.run(prize, guild, channel, prize, now + end, message, result, finished);
    }
    draw('Más tarde', {end: 30000, message: '99'});
    draw('Primero', {end: 20000, message: '98'});
    draw('Canal privado', {channel: hiddenId});
    draw('Otro servidor', {guild: 'otro'});
    draw('Borrador', {message: null});
    draw('Cerrado', {finished: 1});
    draw('Resultado listo', {result: '[]'});
    draw('Ya venció', {end: -1000});
    const response = h.service.active(h.guild, h.member);
    assert.deepEqual(response.embeds[0].fields.map(f => f.name), ['Primero','Más tarde']);
    assert.ok(response.embeds[0].fields[0].value.includes('https://discord.com/channels/' + guildId + '/' + publicId + '/98'));
    assert.deepEqual(response.allowedMentions.parse, []);
    for (let n = 0; n < 12; n++) draw('Sorteo ' + n, {end: 60000 + n});
    const next = h.service.active(h.guild, h.member).embeds[0].fields;
    assert.equal(next.length, 10);
    assert.equal(next.at(-1).name, 'Sorteo 7');
});

test('el organizador da solo el premio y puede corregir el canal sin repetir los datos', async t => {
    const h = setup(t);
    await h.service.prepare(h.ctx, parsePublication('crea un sorteo en #equivocado con 5 horas y 2 ganadores'));
    assert.match(h.previews.at(-1), /Me falta el premio/);
    const withPrize = h.service.request(h.ctx, '5k Robux');
    assert.equal(withPrize.details.prize, '5k Robux');
    await assert.rejects(h.service.prepare(h.ctx, withPrize), /Selecciona el canal/);
    const corrected = h.service.request(h.ctx, '#giveaway');
    assert.ok(corrected);
    await h.service.prepare(h.ctx, corrected);
    assert.equal(h.previews.at(-1).embeds[0].title, '🎉 5k Robux');
    assert.equal(h.sends.length, 0);
    assert.equal(h.service.request(h.ctx, '2'), null);
});

test('el canal del aviso se puede corregir y la duración del premio no cambia la del sorteo', async t => {
    const h = setup(t);
    const request = parsePublication('crea un sorteo en #giveaway con 5 horas y 2 ganadores y anúncialo en #otro');
    await h.service.prepare(h.ctx, request);
    const withPrize = h.service.request(h.ctx, 'Pase VIP de 2 días');
    await assert.rejects(h.service.prepare(h.ctx, withPrize), /canal del aviso/);
    const corrected = h.service.request(h.ctx, '#evento');
    const id = await h.service.prepare(h.ctx, corrected);
    const draft = h.service.drafts.get(id);
    assert.equal(draft.channel, '555555555555555555');
    assert.equal(draft.notice, '666666666666666666');
    assert.equal(draft.prize, 'Pase VIP de 2 días');
    assert.equal(draft.ms, 5 * 3600000);
});

test('manual end and reroll update the existing panel and persist a reroll audit',async t=>{
    const h=setup(t);
    const ctx={...h.ctx,member:h.admin};
    const id=await h.service.prepare(h.ctx,parsePublication('crea un sorteo en #giveaway premio: VIP minutes: 2 winners: 1'));
    await h.service.handle(h.click('publish',id));
    const message='777777777777777777';
    const db=h.service.db();
    db.prepare('UPDATE draws SET message=? WHERE id=?').run(message,id);
    for(const uid of ['888888888888888888','999999999999999999']) db.prepare('INSERT INTO entries(draw,user) VALUES (?,?)').run(id,uid);
    await assert.rejects(h.service.control({...ctx,member:h.member},'end',message),/administrador/);
    await assert.rejects(h.service.control(ctx,'reroll',message),/Primero termina/);
    await h.service.control(ctx,'end',message);
    const first=h.service.find(id);assert.equal(first.finished,1);
    assert.equal(JSON.parse(first.result).length,1);
    await h.service.control(ctx,'reroll',message);
    const next=h.service.find(id);
    assert.equal(next.finished,1);assert.notEqual(first.result,next.result);
    assert.equal(db.prepare('SELECT count(*) n FROM rerolls WHERE draw=?').get(id).n,1);
    assert.equal(h.edits.length,2);assert.ok(h.edits.every(x=>x.message===message));
});

test('web giveaway publish is idempotent and uses the same draw storage',async t=>{
 const h=setup(t),ctx={...h.ctx,member:h.admin};
 const request={channel:'555555555555555555',fields:{duration:'5 horas',prize:'VIP',winners:'1'}},nonce='a'.repeat(18);
 const first=await h.service.publishWeb(ctx,request,nonce);
 assert.equal(await h.service.publishWeb(ctx,request,nonce),first);
 assert.equal(h.sends.length,1);
 assert.equal(h.service.listForWeb(h.guild.id).length,1);
 assert.equal(h.service.listForWeb('other').length,0);
});
