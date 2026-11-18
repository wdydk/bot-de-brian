'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { Collection, PermissionsBitField } = require('discord.js');
const { Store, knowledgeText } = require('../src/core');
const { P } = require('../src/permissions');
const { buildBot } = require('../index');
const { parseRequest, matchingRule, saveRequest } = require('../src/memory');
const { emojiChoice, EmojiPack, catalog } = require('../src/emojis');
const { guardCommunityRole, accessArguments } = require('../src/delegation');

const ids = {
    guild: '110000000000000001', owner: '210000000000000001', mod: '210000000000000002',
    member: '210000000000000003', bot: '210000000000000004', role: '310000000000000001'
};
function harness(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-comunidad-'));
    const store = new Store(dir);
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const seen = [], reactions = [], questions = [], nicks = [];
    const client = Object.assign(new EventEmitter(), { user: { id: ids.bot }, destroy: async () => {} });
    const ai = { ask: async (...args) => { questions.push(args); return 'Te explico. [[emoji:nerdcat]]'; } };
    const app = buildBot({ store, client, ai });
    t.after(async () => { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
    const guild = { id: ids.guild, ownerId: ids.owner, name: 'DYNASTY' };
    const role = { id: ids.role, guild, name: 'Moderador', position: 10 };
    guild.roles = { cache: new Collection([[role.id, role]]), fetch: async id => guild.roles.cache.get(id) };
    const members = new Map();
    function member(id, position, bits) {
        const user = { id, username: id, send: async payload => seen.push(payload) };
        const highest = { position, comparePositionTo: other => position - other.position };
        const m = { id, user, guild, roles: { highest, cache: new Collection() },
            permissions: new PermissionsBitField([P.ViewChannel, P.SendMessages, ...bits]),
            setNickname: async name => nicks.push(name) };
        members.set(id, m); return m;
    }
    const owner = member(ids.owner, 100, []), mod = member(ids.mod, 10, []);
    const normal = member(ids.member, 2, []), bot = member(ids.bot, 20, [P.ManageNicknames, P.KickMembers]);
    mod.roles.cache.set(role.id, role);
    guild.members = { fetch: async arg => members.get(arg?.user || arg), fetchMe: async () => bot, me: bot };
    const channel = { id: '414141414141414141', send: async data => seen.push(data), sendTyping: async () => {},
        permissionsFor: m => m.permissions, isThread: () => false };
    async function send(who, text, extra = {}) {
        now += 9000; seen.length = 0; reactions.length = 0;
        const message = { author: who.user, member: who, content: text, guild, channel,
            react: async emoji => reactions.push(emoji), ...extra };
        await client.listeners('messageCreate')[0](message);
        return seen.map(data => typeof data === 'string' ? data : data.content || '').join('\n');
    }
    return { app, store, client, guild, channel, owner, mod, normal, bot, role, send, seen, reactions, questions, nicks, dir };
}
test('el ejemplo de Brian funciona por mensaje normal, mención y >ask sin Gemini, también al reiniciar', async t => {
    const h = harness(t);
    assert.match(await h.send(h.owner, '>ask si alguien dice brian dile ola soy yo'), /ola soy yo/);
    assert.equal(await h.send(h.normal, '¡BRIAN!'), 'ola soy yo');
    assert.equal(await h.send(h.normal, '>ask brian'), 'ola soy yo');
    assert.equal(await h.send(h.normal, '<@' + ids.bot + '> brian'), 'ola soy yo');
    assert.equal(await h.send(h.normal, 'Briana'), '');
    assert.equal(h.questions.length, 0);
    const restored = new Store(h.dir);
    assert.equal(matchingRule(restored.guild(ids.guild), 'Hola, Brian.').response, 'ola soy yo');
    assert.equal(matchingRule(restored.guild('otro'), 'Brian'), null);
});
test('las reglas de reacción y respuesta coexisten, se editan y se borran', async t => {
    const h = harness(t);
    await h.send(h.owner, '>recuerda si alguien dice "hay tarea", reacciona con nerd');
    await h.send(h.owner, '>ask cuando alguien escriba «hay tarea», responde con "Abre el libro"');
    assert.equal(await h.send(h.normal, 'mañana hay tarea?'), 'Abre el libro');
    assert.deepEqual(h.reactions, ['🤓']);
    await h.send(h.owner, '>recuerda quitar "hay tarea"');
    assert.equal(await h.send(h.normal, 'hay tarea'), '');
    assert.deepEqual(h.reactions, []);
});
test('un miembro no instala reglas o notas y las reglas excluyen bots, webhooks, tickets y DMs', async t => {
    const h = harness(t);
    assert.match(await h.send(h.normal, '>ask si alguien dice x dile hola'), /administrador/);
    assert.match(await h.send(h.normal, '>ask recuerda que cobro por ayudar'), /administrador/);
    await h.send(h.owner, '>recuerda si alguien dice brian dile ola');
    assert.equal(await h.send(h.bot, 'brian', { author: { id: ids.bot, bot: true } }), '');
    assert.equal(await h.send(h.normal, 'brian', { webhookId: 'webhook' }), '');
    h.store.data.tickets[h.channel.id] = { guildId: ids.guild, ownerId: ids.member, aiActive: false };
    assert.equal(await h.send(h.normal, 'brian'), '');
    assert.match(await h.send(h.normal, 'brian', { guild: null }), /Te explico/);
    assert.equal(h.questions.at(-1)[3], '');
});
test('recuerda un dato solo del servidor y al quitarlo invalida el contexto anterior', async t => {
    const h = harness(t), cfg = h.store.guild(ids.guild);
    const msg = await h.send(h.owner, '>ask recuerda que los tryouts son los viernes');
    const id = msg.match(/nota_[a-f0-9]{8}/)[0];
    assert.match(knowledgeText(cfg), /los viernes/);
    assert.equal(h.questions.length, 0);
    await h.send(h.normal, '>ask ¿cuándo son los tryouts?');
    assert.match(h.questions[0][3], /viernes/);
    assert.equal(knowledgeText(h.store.guild('otro')), '');
    assert.equal(await h.send(h.owner, '>recuerda quitar ' + id), 'Recuerdo eliminado.');
    assert.equal(knowledgeText(cfg), '');
    assert.equal(cfg.knowledgeRevision, 2);
});
test('responder de versiones anteriores admite brian, >brian y >ask brian', async t => {
    const h = harness(t);
    h.store.guild(ids.guild).custom.brian = 'ola soy yo';
    for (const text of ['brian', '>brian', '>ask brian']) assert.equal(await h.send(h.normal, text), 'ola soy yo');
    assert.equal(await h.send(h.normal, 'le escribí a brian'), '');
});
test('los fallos de disco no dejan reglas ni autorizaciones en memoria', async t => {
    const h = harness(t);
    t.mock.method(h.store, 'save', () => { throw Error('disco'); });
    assert.throws(() => saveRequest(h.store, ids.guild, parseRequest('si alguien dice brian dile hola')), /disco/);
    assert.equal(matchingRule(h.store.guild(ids.guild), 'brian'), null);
    assert.throws(() => h.store.patchGuild(ids.guild, { delegatedRoles: { [ids.role]: ['kick_members'] } }));
    assert.deepEqual(h.store.guild(ids.guild).delegatedRoles, {});
    h.store.save.mock.restore();
});
test('la elección de emoji respeta el tema, los silencios y los nombres del pack', () => {
    const cache = new Collection([['123', { name: 'tm_nerdcat', toString: () => '<:tm_nerdcat:123>' }]]);
    const pack = new EmojiPack({ application: { emojis: { cache } } });
    assert.equal(Object.keys(catalog).length, 22);
    assert.match(pack.style('Así funciona. [[emoji:nerdcat]]', '¿qué es Node?'), /<:tm_nerdcat:123>$/);
    assert.match(pack.style('¡Bien jugado!', 'ganamos'), /🙌$/);
    assert.equal(pack.style('Estoy contigo. [[emoji:bostezo]]', 'sufrí acoso'), 'Estoy contigo.');
    assert.equal(pack.style('Sí. [[emoji:nerd]]', 'sin emojis'), 'Sí.');
    assert.match(pack.style('Es código. [[emoji:bostezo]]', 'qué es Node'), /<:tm_nerdcat:123>/);
    assert.equal(pack.style('Sí. [[emoji:none]]', '¿qué es?'), 'Sí.');
    assert.equal(pack.style('Listo. [[emoji:inventado]]', 'hola'), 'Listo.');
    assert.equal(pack.style('Lo reviso. [[emoji:nerd]]', 'hola', true), 'Lo reviso.');
    assert.equal(emojiChoice(':tm_nerd:'), 'nerd'); assert.equal(emojiChoice('👨‍💻'), '👨‍💻');
    assert.throws(() => emojiChoice('tres letras'), /Elige un emoji/);
});
test('la importación solo crea los emojis pendientes y puede reanudarse', async () => {
    const cache = new Collection();
    let fail = true, created = 0;
    const manager = { cache, fetch: async () => cache, create: async ({ name }) => {
        if (name === 'tm_nerdcat' && fail) throw Error('fallo simulado');
        assert.ok(!cache.has(name));
        cache.set(name, { name }); created++;
    } };
    const pack = new EmojiPack({ application: { emojis: manager, owner: { id: 'dueño' } } });
    await assert.rejects(pack.importForOwner({ guild: null, user: { id: 'otro' } }), /dueño/);
    await assert.rejects(pack.importForOwner({ guild: {}, user: { id: 'dueño' } }), /por DM/);
    const first = await pack.install(catalog);
    assert.equal(first.ready, 21); assert.deepEqual(first.failed, ['nerdcat']);
    fail = false;
    assert.equal((await pack.install(catalog)).ready, 22);
    assert.equal((await pack.install(catalog)).ready, 22);
    assert.equal(created, 22);
});
test('un moderador puede usar nick con su rol, pierde acceso al retirarlo y no puede moderar al dueño', async t => {
    const h = harness(t);
    const grant = '>access fakepermissions add <@&' + ids.role + '> manage_messages, moderate_members, manage_nicknames, kick_members';
    assert.match(await h.send(h.normal, grant), /Solo el dueño/);
    assert.match(await h.send(h.owner, grant), /manage_nicknames/);
    assert.deepEqual(h.store.guild(ids.guild).delegatedRoles[ids.role], ['manage_messages', 'moderate_members', 'manage_nicknames', 'kick_members']);
    assert.equal(await h.send(h.mod, '>nick <@' + ids.member + '> Papu'), 'Apodo actualizado.');
    assert.deepEqual(h.nicks, ['Papu']);
    assert.equal(h.mod.permissions.has(P.ManageNicknames), false);
    assert.match(await h.send(h.mod, '>nick <@' + ids.owner + '> nada'), /dueño/);
    assert.match(await h.send(h.mod, '>panel'), /Solo el dueño/);
    assert.match(await h.send(h.mod, '>access fakepermissions reset'), /Solo el dueño/);
    h.mod.roles.cache.delete(ids.role);
    assert.match(await h.send(h.mod, '>nick <@' + ids.member + '> Otro'), /No tienes el permiso/);
    assert.deepEqual(h.nicks, ['Papu']);
});
test('add, list, remove y reset comparten permisos en slash y prefijo; las delegaciones no cruzan servidores', async t => {
    const h = harness(t);
    const root = h.app.slashDefinitions().find(d => d.name === 'access');
    assert.equal(root.default_member_permissions, P.Administrator.toString());
    assert.deepEqual(root.options[0].options.map(o => o.name), ['add', 'list', 'remove', 'reset']);
    const options = { getSubcommandGroup: () => 'fakepermissions', getSubcommand: () => 'add',
        getRole: () => h.role, getString: () => 'manage_nicknames,kick_members' };
    assert.deepEqual(accessArguments(options), ['fakepermissions', 'add', ids.role, 'manage_nicknames,kick_members']);
    let result;
    await h.client.listeners('interactionCreate')[0]({ isButton: () => false, isModalSubmit: () => false,
        isStringSelectMenu: () => false, isChatInputCommand: () => true, guild: h.guild, guildId: ids.guild,
        channel: h.channel, user: h.owner.user, commandName: 'access', options,
        deferReply: async () => {}, editReply: async data => { result = data.content; } });
    assert.match(result, /kick_members/);
    assert.deepEqual(h.store.guild('otro').delegatedRoles, {});
    await h.send(h.owner, '>access fakepermissions remove <@&' + ids.role + '> kick_members');
    assert.deepEqual(h.store.guild(ids.guild).delegatedRoles[ids.role], ['manage_nicknames']);
    await h.send(h.owner, '>access fakepermissions reset');
    assert.match(await h.send(h.mod, '>nick <@' + ids.member + '> Otro'), /No tienes el permiso/);
});
test('un rol de autorrol o de botón no puede recibir permisos delegados ni convertirse en rol voluntario', async t => {
    const h = harness(t), cfg = h.store.guild(ids.guild);
    const grant = '>access fakepermissions add <@&' + ids.role + '> kick_members';
    cfg.autorole = ids.role;
    assert.match(await h.send(h.owner, grant), /manualmente/);
    cfg.autorole = null; cfg.roleButtons.panel = ids.role;
    assert.match(await h.send(h.owner, grant), /manualmente/);
    delete cfg.roleButtons.panel;
    assert.match(await h.send(h.owner, grant), /kick_members/);
    assert.throws(() => guardCommunityRole(h.role, cfg), /staff/);
    const denied = await h.send(h.owner, '>access fakepermissions add <@&' + ids.role + '> administrator');
    assert.match(denied, /Permisos disponibles/);
    assert.deepEqual(cfg.delegatedRoles[ids.role], ['kick_members']);
});
test('un verbo citado es parte de la frase y se conserva el texto elegido por el administrador', () => {
    assert.deepEqual(parseRequest('si alguien dice "brian dile a max", responde:¡Voy!'), {
        kind: 'response', trigger: 'brian dile a max', value: '¡Voy!'
    });
    assert.equal(parseRequest('Si alguien dice brian, ¿qué significa?'), null);
});
test('la ayuda del rol es privada y un comando delegado también comprueba el permiso real del bot', async t => {
    const h = harness(t);
    await h.send(h.owner, '>access fakepermissions add <@&' + ids.role + '> manage_nicknames');
    await h.send(h.mod, '>help Moderación');
    const help = JSON.stringify(h.seen[0]);
    assert.match(help, />nick/); assert.doesNotMatch(help, />kick|>panel|>timeout/);
    h.bot.permissions.remove(P.ManageNicknames);
    assert.match(await h.send(h.mod, '>nick <@' + ids.member + '> Papu'), /Al bot le falta/);
    assert.deepEqual(h.nicks, []);
});
