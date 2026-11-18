'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PermissionsBitField, Collection } = require('discord.js');
const { Store } = require('../src/core');
const { P } = require('../src/permissions');
const { isAdmin } = require('../src/access');
const { buildBot } = require('../index');
const guildId = '11111111111111111', userId = '33333333333333333';
function harness(t, ai) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-access-'));
    const app = buildBot({ store: new Store(dir), ai });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    return app;
}
function context({ perms = [], guild = guildId, user = userId, channel = '44444444444444444', dmClosed = false } = {}) {
    const sent = [], privateSent = [];
    const g = guild ? { id: guild, name: 'Servidor ' + guild, ownerId: '99999999999999999' } : null;
    const ctx = { guild: g, member: g ? { id: user, guild: g, permissions: new PermissionsBitField(perms), roles: { cache: new Collection() } } : null,
        user: { id: user, send: async data => { if (dmClosed) throw Error('DM closed'); privateSent.push(data); } },
        channel: { id: channel }, reply: async data => sent.push(data) };
    return { ctx, sent, privateSent, output: () => JSON.stringify(sent), privateOutput: () => JSON.stringify(privateSent) };
}
test('miembro recibe una ayuda breve, sin config, moderación ni enlace de admin', async t => {
    const app = harness(t), h = context();
    await app.execute(h.ctx, 'help', []);
    assert.equal(h.sent.length, 1);
    assert.match(h.output(), /play/); assert.match(h.output(), /ticket/);
    for (const value of ['ticketpanel', 'knowledge', 'ban', 'musicdiag', '>panel', 'Configuración', 'Moderación']) assert.ok(!h.output().includes(value), value);
    assert.equal(h.privateSent.length, 0);
});
test('ayuda detallada también filtra permisos; no hay bypass con categoría o alias', async t => {
    const app = harness(t);
    for (const item of ['Configuración', 'Moderación', 'ticketpanel', 'panel', 'web', 'audiotest']) {
        const h = context({ user: '5' + item });
        await assert.rejects(app.execute(h.ctx, 'help', [item]), /No hay ayuda/);
    }
    const h = context(); await app.execute(h.ctx, 'help', ['Música']);
    assert.match(h.output(), /shuffle/); assert.ok(!h.output().includes('musicdiag'));
});
test('staff ve solo su permiso y la ayuda sensible se envía por DM', async t => {
    const app = harness(t), h = context({ perms: [P.ManageMessages] });
    await app.execute(h.ctx, 'help', ['Moderación']);
    assert.equal(h.sent.length, 1); assert.equal(h.privateSent.length, 1);
    assert.match(h.privateOutput(), /snipe/); assert.match(h.privateOutput(), /purge/);
    assert.ok(!h.privateOutput().includes('>ban')); assert.ok(!h.privateOutput().includes('>timeout'));
    assert.ok(!h.output().includes('>snipe'));
});
test('config, publicación de tickets y enlace exigen admin o dueño incluso con ManageGuild', async t => {
    const app = harness(t), h = context({ perms: [P.ManageGuild, P.ManageChannels, P.ManageMessages] });
    for (const command of ['panel', 'web', 'dashboard', 'setup', 'ticketpanel', 'knowledge', 'config']) await assert.rejects(app.execute(h.ctx, command, []), /Solo el dueño/);
    const defs = app.slashDefinitions();
    for (const name of ['ticketpanel', 'panel', 'setup', 'knowledge', 'config']) assert.equal(defs.find(d => d.name === name).default_member_permissions, P.Administrator.toString());
    assert.equal(isAdmin({ id: 'owner', permissions: new PermissionsBitField() }, { ownerId: 'owner' }), true);
    assert.equal(isAdmin({ permissions: new PermissionsBitField() }, {}), false);
});
test('DM cerrado no provoca envío público de ayuda de admin', async t => {
    const app = harness(t), h = context({ perms: [P.Administrator], dmClosed: true });
    await assert.rejects(app.execute(h.ctx, 'help', ['Configuración']), /No pude enviarte/);
    assert.equal(h.sent.length, 0); assert.equal(h.privateSent.length, 0);
});
test('ticket de miembro dirige al panel; no lo crea y no copia otro servidor', async t => {
    const app = harness(t), h = context();
    await app.execute(h.ctx, 'ticket', []);
    assert.match(h.output(), /todavía no ha publicado/);
    assert.ok(!h.output().includes('ticketsetup'));
    app.store.guild(guildId).ticketPanelChannel = '55555555555555555';
    app.store.guild(guildId).ticketPanelMessage = '66666666666666666';
    const second = context({ guild: '22222222222222222' });
    await app.execute(second.ctx, 'ticket', []); assert.match(second.output(), /todavía no ha publicado/);
    const third = context({ user: '44444444444444444' });
    third.ctx.guild.channels = { fetch: async () => ({ permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]), messages: { fetch: async () => ({ id: '66666666666666666' }) } }) };
    await app.execute(third.ctx, 'ticket', []); assert.match(third.output(), /11111111111111111\/55555555555555555\/66666666666666666/);
});
test('fichas se guardan por servidor, sobreviven al reinicio y no llegan a DMs', async t => {
    const calls = [];
    const app = harness(t, { ask: async (...args) => { calls.push(args); return 'OK'; }, forget() {} });
    const h = context({ perms: [P.Administrator] });
    await app.execute(h.ctx, 'knowledge', ['add','reglas','NORMAS_SOLO_A']);
    const second = context({ perms: [P.Administrator], guild: '22222222222222222' });
    await app.execute(second.ctx, 'knowledge', ['add','eventos','EVENTOS_SOLO_B']);
    const newStore = new Store(app.store.directory);
    assert.equal(newStore.guild(guildId).knowledgePages.reglas, 'NORMAS_SOLO_A');
    assert.deepEqual(newStore.guild('77777777777777777').knowledgePages, {});
    assert.equal(newStore.guild('77777777777777777').ticketCategory, null);
    const a = context({ user: '44444444444444444' }), b = context({ user: '44444444444444444', guild: '22222222222222222' }), dm = context({ guild: null });
    await app.execute(a.ctx, 'ask', ['¿Reglas?']); await app.execute(b.ctx, 'ask', ['¿Reglas?']); await app.execute(dm.ctx, 'ask', ['¿Reglas?']);
    assert.match(calls[0][3], /NORMAS_SOLO_A/); assert.ok(!calls[0][3].includes('EVENTOS_SOLO_B'));
    assert.match(calls[1][3], /EVENTOS_SOLO_B/); assert.ok(!calls[1][3].includes('NORMAS_SOLO_A'));
    assert.equal(calls[2][3], ''); assert.notEqual(calls[0][0], calls[1][0]);
});
test('carga memoria v3 previa sin borrar ajustes ni tickets y añade campos nuevos', async t => {
    const app = harness(t);
    const c = app.store.guild(guildId); c.knowledge = 'Contenido anterior'; c.welcome = { channelId: 'ch', text: 'Hola' };
    delete c.knowledgePages; delete c.knowledgeRevision;
    app.store.data.tickets.t = { guildId, ownerId: userId }; app.store.save();
    const restored = new Store(app.store.directory);
    assert.equal(restored.guild(guildId).knowledge, 'Contenido anterior');
    assert.equal(restored.guild(guildId).welcome.text, 'Hola');
    assert.deepEqual(restored.guild(guildId).knowledgePages, {});
    assert.equal(restored.data.tickets.t.guildId, guildId);
});
