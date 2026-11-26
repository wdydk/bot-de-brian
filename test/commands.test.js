'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core');
const { buildBot } = require('../index');
const { P } = require('../src/permissions');
const { PermissionsBitField, Collection } = require('discord.js');
test('menú slash completo con permisos por acción y nombres válidos', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-commands-'));
    const app = buildBot({ store: new Store(dir) });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    const defs = app.slashDefinitions();
    assert.ok(defs.length > 40 && defs.length <= 100);
    assert.equal(new Set(defs.map(d => d.name)).size, defs.length);
    for (const d of defs) {
        assert.match(d.name, /^[a-z0-9_-]{1,32}$/);
        assert.ok(d.description.length <= 100);
        let optional = false;
        for (const option of d.options) {
            if (!option.required) optional = true;
            if (optional) assert.ok(!option.required);
        }
    }
    assert.equal(defs.find(d => d.name === 'ban').default_member_permissions, P.Administrator.toString());
    assert.equal(defs.find(d => d.name === 'snipe').default_member_permissions, null);
    assert.ok(defs.find(d => d.name === 'ask').contexts.includes(1));
});
test('modal de ticket genera JSON válido sin exceder etiquetas', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-ticket-'));
    const app = buildBot({ store: new Store(dir) });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    let data;
    await app.tickets.handle({ customId: 'tm:ticket:open', guild: { id: 'g' }, isStringSelectMenu: () => true,
        values: ['soporte'], showModal: async modal => { data = modal.toJSON(); } });
    assert.ok(data.components[0].components[0].label.length <= 45);
});
test('el despachador impide banear a quien solo gestiona mensajes', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-dispatch-'));
    const app = buildBot({ store: new Store(dir) });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    let called = false;
    const ctx = { guild: { id: 'g', members: { fetch: async () => { called = true; } } },
        member: { permissions: new PermissionsBitField([P.ManageMessages]) }, user: { id: 'u' },
        channel: { id: 'c', isThread: () => false }, reply: async () => {} };
    await assert.rejects(app.execute(ctx, 'ban', ['12345678901234567', 'test']));
    assert.equal(called, false);
});
test('un miembro ajeno no puede cerrar el ticket ni por prefijo ni por botón', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-close-'));
    const app = buildBot({ store: new Store(dir) });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    app.store.data.tickets.c = { guildId: 'g', ownerId: 'owner' };
    const member = { id: 'other', roles: { cache: new Collection() }, permissions: new PermissionsBitField() };
    const guild = { id: 'g', members: { fetch: async () => member } };
    const ctx = { guild, member, user: { id: 'other' }, channel: { id: 'c' }, reply: async () => { throw Error('Should not reply'); } };
    await assert.rejects(app.execute(ctx, 'close', []), /Solo el autor/);
    await assert.rejects(app.tickets.handle({ customId: 'tm:ticket:close', guild, guildId: 'g', channelId: 'c', user: { id: 'other' },
        isStringSelectMenu: () => false, isModalSubmit: () => false, isButton: () => true }), /Solo el autor/);
});

test('natural volume requests execute the real music action, including >ask, and never report a false success',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-ai-volume-'));
    const app=buildBot({store:new Store(dir),ai:{available:false}});
    t.after(async()=>{await app.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
    app.store.guild('g').ai=true;
    let applied=.55;const replies=[];
    const session={volume:.55,current:{resource:{volume:{setVolume(v){applied=v;}}}},queue:[]};
    app.music.control=async()=>session;
    const ctx=user=>({guild:{id:'g'},member:{id:user,permissions:new PermissionsBitField()},user:{id:user},
        channel:{id:'c',isThread:()=>false},reply:async value=>{replies.push(value);return{id:'response'};}});
    assert.equal(await app.tryMusicRequest(ctx('one'),'volume 19'),true);
    assert.equal(applied,.19);assert.equal(session.volume,.19);assert.equal(replies.at(-1),'Volumen: 19%.');
    assert.equal(await app.tryMusicRequest(ctx('two'),'ponme volume 10'),true);
    assert.equal(applied,.1);assert.equal(replies.at(-1),'Volumen: 10%.');
    await app.execute(ctx('three'),'ask',['volume','30']);
    assert.equal(applied,.3);assert.equal(replies.at(-1),'Volumen: 30%.');
    await app.tryMusicRequest(ctx('four'),'volume 101');
    assert.equal(applied,.3);assert.match(replies.at(-1),/0 al 100/);
    app.music.control=async()=>{throw Error('DJ denied');};
    const before=replies.length;
    await assert.rejects(app.tryMusicRequest(ctx('five'),'volume 20'),/DJ denied/);
    assert.equal(applied,.3);assert.equal(replies.length,before);
    app.music.control=async()=>session;
    session.current.resource.volume.setVolume=()=>{throw Error('decoder unavailable');};
    await assert.rejects(app.tryMusicRequest(ctx('six'),'volume 25'),/decoder unavailable/);
    assert.equal(session.volume,.3);assert.equal(replies.length,before);
});
test('named track proposals preserve exact title and follow-up is scoped to author and reply',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-ai-context-'));
    const app=buildBot({store:new Store(dir),ai:{available:false}});
    t.after(async()=>{await app.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
    app.store.guild('g').ai=true;const replies=[],played=[];
    app.music.play=async(ctx,query)=>{played.push(query);return {title:query,requestStatus:'started'};};
    const ctx=(user,reference)=>({guild:{id:'g'},member:{id:user,permissions:new PermissionsBitField()},user:{id:user},
        channel:{id:'c',isThread:()=>false},source:reference?{reference:{messageId:reference}}:undefined,
        reply:async value=>{replies.push(value);return{id:'track-proposal'};}});
    assert.equal(await app.tryMusicRequest(ctx('one'),'ponme KUCHUBURANKO\nPlastic Tree'),true);
    assert.match(replies.at(-1).content,/KUCHUBURANKO Plastic Tree/);
    assert.equal(played.length,0);
    await app.tryMusicRequest(ctx('other','track-proposal'),'ponla para escucharla');
    assert.match(replies.at(-1),/No tengo una canción identificada/);
    assert.equal(played.length,0);
    await app.tryMusicRequest(ctx('one','track-proposal'),'ponla para escucharla');
    assert.deepEqual(played,['KUCHUBURANKO Plastic Tree']);
    assert.match(replies.at(-1),/Reproducción iniciada/);
});
