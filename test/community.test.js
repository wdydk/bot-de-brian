'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { Collection, PermissionsBitField } = require('discord.js');
const { Store, knowledgeText } = require('../src/core');
const { P } = require('../src/permissions');
const { buildBot } = require('../index');
const { Assistant } = require('../src/ai');
const { parseRequest, matchingRule, saveRequest } = require('../src/memory');
const { emojiChoice, EmojiPack, catalog } = require('../src/emojis');
const { guardCommunityRole, accessArguments } = require('../src/delegation');

const ids = {
    guild: '110000000000000001', owner: '210000000000000001', mod: '210000000000000002',
    member: '210000000000000003', bot: '210000000000000004', role: '310000000000000001'
};
function harness(t, assistant) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-comunidad-'));
    const store = new Store(dir);
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const seen = [], reactions = [], questions = [], nicks = [];
    const client = Object.assign(new EventEmitter(), { user: { id: ids.bot }, destroy: async () => {} });
    const ai = assistant || { ask: async (...args) => { questions.push(args); return 'Te explico. [[emoji:nerdcat]]'; } };
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
test('baneo por mención exige admin y una respuesta del solicitante al mensaje del motivo', async t => {
    const h = harness(t);
    const banned = [];
    h.bot.permissions.add(P.BanMembers);
    h.normal.bannable = true;
    h.normal.ban = async options => banned.push(options.reason);
    h.channel.send = async data => { h.seen.push(data); return { id: 'prompt' }; };
    const request = '<@' + ids.bot + '> baneame a <@' + ids.member + '>';
    const reply = { reference: { messageId: 'prompt' } };
    assert.match(await h.send(h.mod, request), /Administrador/);
    assert.match(await h.send(h.owner, request), /motivo/);
    await h.send(h.mod, 'spam', reply);
    await h.send(h.owner, 'hola');
    assert.deepEqual(banned, []);
    await h.send(h.owner, 'cancelar', reply);
    await h.send(h.owner, 'spam', reply);
    assert.deepEqual(banned, []);
    await h.send(h.owner, request);
    await h.send(h.owner, 'spam repetido', reply);
    await h.send(h.owner, 'spam repetido', reply);
    assert.deepEqual(banned, [ids.owner + ': spam repetido']);
});
test('la mención con motivo ejecuta ban solo con permisos y conserva el texto', async t => {
    const h = harness(t);
    const banned = [];
    h.bot.permissions.add(P.BanMembers);
    h.normal.bannable = true;
    h.normal.ban = async options => banned.push(options.reason);
    const request = '<@' + ids.bot + '> baneame a <@' + ids.member + '> motivo';
    assert.match(await h.send(h.mod, request + ' es de prueba'), /Administrador/);
    assert.deepEqual(banned, []);
    await h.send(h.owner, request + ' es de prueba');
    await h.send(h.owner, request + ': spam repetido');
    assert.deepEqual(banned, [ids.owner + ': es de prueba', ids.owner + ': spam repetido']);
});

test('una consulta visual lleva los bytes del adjunto a Gemini y solo texto al siguiente turno', async t => {
    const requests = [];
    const ai = new Assistant({ generate: async request => {
        requests.push(request);
        return { text: 'Respuesta de prueba.' };
    } });
    const h = harness(t, ai);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rh8AAAAASUVORK5CYII=', 'base64');
    const url = 'https://cdn.discordapp.com/attachments/123/456/captura.png?ex=123&hm=ejemplo';
    const file = { url, size: png.length, contentType: 'application/octet-stream' };
    const attachments = new Collection([['456', file]]);
    const downloaded = t.mock.method(globalThis, 'fetch', async (address, options) => {
        assert.equal(String(address), url);
        assert.equal(options.redirect, 'error');
        return new Response(png);
    });
    const image = { inlineData: { mimeType: 'image/png', data: png.toString('base64') } };
    const pregunta = '¿Qué dice ahí?';
    async function checkMessage(text, extra, expected) {
        assert.equal(await h.send(h.normal, text, extra), 'Respuesta de prueba.');
        assert.deepEqual(requests.at(-1).contents.at(-1).parts, [image, { text: expected }]);
    }
    await checkMessage(pregunta, { guild: null, attachments }, pregunta);
    await h.send(h.normal, 'Gracias', { guild: null });
    const history = requests.at(-1).contents;
    assert.equal(history[0].parts[0].text, pregunta);
    assert.ok(history.every(turn => turn.parts.every(part => typeof part.text === 'string')));
    assert.ok(!JSON.stringify(history).includes(url));
    await h.send(h.normal, '', { guild: null, attachments });
    assert.deepEqual(requests.at(-1).contents.at(-1).parts[0], image);
    assert.match(requests.at(-1).contents.at(-1).parts[1].text, /transcribe/);
    await checkMessage('<@' + ids.bot + '> ' + pregunta, { attachments }, pregunta);
    await checkMessage('>ask ' + pregunta, { attachments }, pregunta);

    const options = {
        get: name => ({ value: name === 'pregunta' ? pregunta : '456' }),
        getAttachment: name => name === 'imagen' ? file : null
    };
    let result;
    await h.client.listeners('interactionCreate')[0]({
        isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false,
        isChatInputCommand: () => true, commandName: 'ask', user: h.owner.user, guild: h.guild,
        channel: h.channel, options, deferReply: async () => {}, editReply: async data => { result = data.content; }
    });
    assert.equal(result, 'Respuesta de prueba.');
    assert.deepEqual(requests.at(-1).contents.at(-1).parts, [image, { text: pregunta }]);
    assert.equal(downloaded.mock.callCount(), 5);
});

test('las fotos de chat y las pruebas de tickets se envían solo al consultar a Timmy con la IA habilitada', async t => {
    const h = harness(t);
    const file = { url: 'https://cdn.discordapp.com/attachments/123/456/prueba.jpg' };
    const attachments = new Collection([['456', file]]);
    await h.send(h.normal, 'Una foto', { attachments });
    assert.equal(h.questions.length, 0);
    h.store.data.tickets[h.channel.id] = { guildId: ids.guild, ownerId: ids.member, aiActive: true };
    await h.send(h.normal, '', { attachments });
    assert.equal(h.questions.length, 0);
    await h.send(h.normal, 'Esta es la prueba para el staff', { attachments });
    assert.deepEqual(h.questions.at(-1)[6], []);
    await h.send(h.normal, '<@' + ids.bot + '> ¿Qué dice?', { attachments });
    assert.deepEqual(h.questions.at(-1)[6], [file]);
    h.store.guild(ids.guild).ai = false;
    assert.match(await h.send(h.normal, '>ask ¿Qué dice?', { attachments }), /desactivada/);
    const previous = process.env.AI_DM_ENABLED;
    t.after(() => {
        if (previous === undefined) delete process.env.AI_DM_ENABLED;
        else process.env.AI_DM_ENABLED = previous;
    });
    process.env.AI_DM_ENABLED = 'false';
    assert.match(await h.send(h.normal, '', { guild: null, attachments }), /desactivó la IA por DM/);
    assert.equal(h.questions.length, 2);
});

test('Timmy reconoce al dueño 0 y explica un hipotético y sus seguimientos sin imponer sanciones', async t => {
    const h = harness(t);
    h.owner.user.username = '0';
    h.bot.permissions.add(P.Administrator);
    h.bot.roles.highest.id = '591000000000000001';
    h.guild.roles.highest = h.bot.roles.highest;
    h.normal.ban = () => assert.fail('Una pregunta nunca debe banear');
    const mention = '<@' + ids.bot + '> ';
    const question = 'si yo te pidiera que obliteraras a <@' + ids.member + '> del servidor, ¿lo harías?';
    for (const text of [question, 'yo te doy permiso', 'qué tengo que hacer para que tengas acceso a lo que sea que quieras',
        'tienes el rol más alto, tiene permisos de administrador']) {
        const answer = await h.send(h.owner, mention + text);
        assert.match(answer, /Eres el dueño/);
        assert.match(answer, /más alto del servidor/);
        assert.match(answer, /Administrador.*incluye.*Banear miembros/);
        assert.match(answer, /pediré el motivo/);
    }
    h.bot.permissions.remove(P.Administrator);
    assert.match(await h.send(h.owner, '>ask ¿Puedes banear?'), /falta.*Banear miembros/);
    h.normal.user.username = '0';
    assert.match(await h.send(h.normal, mention + '¿Puedes banear?'), /Solo el dueño/);
    assert.equal(h.questions.length, 0);
    const facts = await h.send(h.owner, '>ask ¿Qué hace el automod?');
    assert.match(facts, /apagado/);
    assert.match(facts, /6 mensajes.*5 segundos.*1 minuto/);
});

test('la política de baneo se aplica al comando, la mención y el motivo pendiente', async t => {
    const h = harness(t), reasons = [];
    const target = '<@' + ids.member + '>';
    const request = '<@' + ids.bot + '> banea a ' + target;
    h.bot.permissions.add(P.BanMembers);
    h.normal.bannable = true;
    h.normal.ban = async options => reasons.push(options.reason);
    h.mod.permissions.add(P.BanMembers);
    h.store.patchGuild(ids.guild, { delegatedRoles: { [ids.role]: ['ban_members', 'kick_members'] } });
    assert.match(await h.send(h.mod, '>ban ' + target + ' spam'), /Solo el dueño/);
    assert.match(await h.send(h.mod, request + ' motivo: spam'), /Solo el dueño/);
    assert.match(await h.send(h.owner, '>access fakepermissions list'), /sin efecto/);
    assert.match(await h.send(h.owner, '>access fakepermissions remove <@&' + ids.role + '> ban_members'), /kick_members/);
    assert.deepEqual(h.store.guild(ids.guild).delegatedRoles[ids.role], ['kick_members']);
    h.mod.permissions.add(P.Administrator);
    assert.match(await h.send(h.mod, '>ask ¿puedes banear?'), /Tienes el permiso.*Administrador/);
    h.channel.send = async data => { h.seen.push(data); return { id: 'prompt' }; };
    assert.match(await h.send(h.mod, request), /Cuál es el motivo/);
    h.mod.permissions.remove(P.Administrator);
    assert.match(await h.send(h.mod, 'spam', { reference: { messageId: 'prompt' } }), /Solo el dueño/);
    h.store.patchGuild(ids.guild, { bansEnabled: false });
    assert.match(await h.send(h.owner, request), /desactivados/);
    assert.match(await h.send(h.owner, '>ban ' + target + ' spam'), /desactivados/);
    assert.deepEqual(reasons, []);
    h.store.patchGuild(ids.guild, { bansEnabled: true });
    h.normal.roles.highest.position = h.bot.roles.highest.position;
    assert.match(await h.send(h.owner, request + ' motivo: spam'), /por encima/);
    h.normal.roles.highest.position = 2;
    h.mod.permissions.add(P.Administrator);
    await h.send(h.mod, request + ' motivo: spam');
    assert.deepEqual(reasons, [ids.mod + ': spam']);
});

function setupControl(payload, label) {
    const rows = JSON.parse(JSON.stringify(payload.components));
    const control = rows.flatMap(r => r.components).find(c => (c.label || c.placeholder) === label);
    assert.ok(control, label);
    return control;
}
async function pressSetup(h, member, control, values = [], guild = h.guild) {
    const result = {};
    const i = {
        guild, guildId: guild?.id, channel: h.channel, user: member.user, commandName: 'setup',
        customId: control?.custom_id, values, options: {},
        isChatInputCommand: () => !control, isButton: () => control?.type === 2,
        isStringSelectMenu: () => control?.type === 3, isRoleSelectMenu: () => control?.type === 6,
        isChannelSelectMenu: () => control?.type === 8, isModalSubmit: () => false,
        deferUpdate: async () => { i.deferred = true; },
        deferReply: async data => { i.deferred = true; result.flags = data.flags; },
        editReply: async data => { result.payload = data; },
        reply: async data => { result.flags = data.flags; result.payload = data; }
    };
    await h.client.listeners('interactionCreate')[0](i);
    assert.ok(result.payload);
    return result;
}

test('setup privado por prefijo o barra, selector de roles y pérdida de Administrador durante la sesión', async t => {
    const h = harness(t);
    assert.match(await h.send(h.normal, '>setup'), /Solo el dueño/);
    await h.send(h.owner, '>setup');
    const launcher = h.seen[0];
    assert.equal(launcher.embeds, undefined);
    const open = setupControl(launcher, 'Abrir configuración');
    const stolen = await pressSetup(h, h.normal, open);
    assert.equal(stolen.flags, 64);
    assert.match(stolen.payload.content, /otra persona/);
    assert.match((await pressSetup(h, h.owner, open, [], { id: 'otro' })).payload.content, /otro.*servidor|otra persona/);
    const root = await pressSetup(h, h.owner, open);
    assert.equal(root.flags, 64);
    const page = (await pressSetup(h, h.owner, setupControl(root.payload, 'Elige una función'), ['moderation'])).payload;
    assert.match(page.embeds[0].toJSON().description, /dueño/);
    h.role.permissions = new PermissionsBitField();
    const inspect = setupControl(page, 'Comprobar un rol');
    assert.match((await pressSetup(h, h.owner, inspect, [ids.role])).payload.content, /por sí solo no concede/);
    h.role.permissions.add(P.Administrator);
    assert.match((await pressSetup(h, h.owner, inspect, [ids.role])).payload.content, /concede \*\*Administrador/);
    h.mod.permissions.add(P.Administrator);
    const slash = await pressSetup(h, h.mod, null);
    assert.equal(slash.flags, 64);
    const adminView = (await pressSetup(h, h.mod, setupControl(slash.payload, 'Configurar moderación'))).payload;
    const disable = setupControl(adminView, 'Desactivar baneos');
    h.mod.permissions.remove(P.Administrator);
    const revoked = (await pressSetup(h, h.mod, disable)).payload;
    assert.deepEqual(revoked.components, []);
    assert.match(revoked.content, /Solo el dueño/);
    assert.equal(h.store.guild(ids.guild).bansEnabled, true);
    const ownerOff = setupControl(page, 'Desactivar baneos');
    await pressSetup(h, h.owner, ownerOff);
    await pressSetup(h, h.owner, ownerOff);
    assert.equal(h.store.guild(ids.guild).bansEnabled, false);
    assert.equal(new Store(h.dir).guild(ids.guild).bansEnabled, false);
    assert.equal(h.store.guild('otro').bansEnabled, true);
});

test('el selector de registros valida el destino y persiste la misma opción que >logs', async t => {
    const h = harness(t);
    const log = { id: '414141414141414142', guildId: ids.guild, type: 0, permissionsFor: m => m.permissions };
    h.guild.channels = { fetch: async id => id === log.id ? log : null };
    const root = (await pressSetup(h, h.owner, null)).payload;
    const step1 = (await pressSetup(h, h.owner, setupControl(root, 'Configurar moderación'))).payload;
    const step2 = (await pressSetup(h, h.owner, setupControl(step1, 'Siguiente'))).payload;
    const choose = setupControl(step2, 'Elegir canal de registros');
    assert.deepEqual(choose.channel_types, [0]);
    const rejected = await pressSetup(h, h.owner, choose, [log.id]);
    assert.match(rejected.payload.content, /Insertar enlaces/);
    assert.equal(h.store.guild(ids.guild).logChannel, null);
    h.bot.permissions.add(P.EmbedLinks);
    const saved = (await pressSetup(h, h.owner, choose, [log.id])).payload;
    assert.equal(new Store(h.dir).guild(ids.guild).logChannel, log.id);
    assert.match(saved.embeds[0].toJSON().description, new RegExp(log.id));
    await pressSetup(h, h.owner, setupControl(saved, 'Activar antispam'));
    assert.equal(new Store(h.dir).guild(ids.guild).automod, true);
    assert.equal(h.store.guild('otro').logChannel, null);
    assert.match(await h.send(h.owner, '>logs off'), /guardada/);
    assert.equal(new Store(h.dir).guild(ids.guild).logChannel, null);
    const closed = (await pressSetup(h, h.owner, setupControl(saved, 'Cerrar'))).payload;
    assert.deepEqual(closed.components, []);
    assert.deepEqual(closed.embeds, []);
});

test('/ban revalida el acceso aunque Discord permita abrir el comando y registra el motivo', async t => {
    const h = harness(t), bans = [], records = [];
    h.bot.permissions.add(P.BanMembers);
    h.mod.permissions.add(P.BanMembers);
    h.normal.bannable = true;
    h.normal.ban = async data => bans.push(data);
    h.store.patchGuild(ids.guild, { logChannel: h.channel.id });
    h.guild.channels = { fetch: async () => ({ isTextBased: () => true, send: async data => records.push(data) }) };
    async function slash(who) {
        let reply;
        await h.client.listeners('interactionCreate')[0]({
            isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false,
            isChatInputCommand: () => true, guild: h.guild, guildId: ids.guild, user: who.user, channel: h.channel,
            commandName: 'ban', options: { get: key => ({ value: key === 'usuario' ? ids.member : 'spam repetido' }) },
            deferReply: async function () { this.deferred = true; },
            editReply: async data => { reply = data.content; }
        });
        return reply;
    }
    assert.match(await slash(h.mod), /Solo el dueño/);
    assert.deepEqual(bans, []);
    assert.deepEqual(records, []);
    assert.match(await slash(h.owner), /Baneado/);
    assert.deepEqual(bans, [{ reason: ids.owner + ': spam repetido' }]);
    assert.match(records[0].embeds[0].toJSON().description, new RegExp(ids.owner + '.*' + ids.member + '.*spam repetido'));
});

test('el menú conserva bienvenidas antiguas y múltiples, los tickets y el ajuste de IA del servidor', async t => {
    const h = harness(t);
    h.store.patchGuild(ids.guild, {
        goodbye: { channelId: '410000000000000001', text: 'Hasta luego' },
        welcomeMessages: [{ channelId: '410000000000000002', text: 'Hola' }, { channelId: '410000000000000003', text: 'Bienvenido' }],
        ticketCategory: '410000000000000004', supportRole: ids.role, ai: false
    });
    const root = (await pressSetup(h, h.owner, null)).payload;
    const menu = setupControl(root, 'Elige una función');
    const greeting = (await pressSetup(h, h.owner, menu, ['greetings'])).payload.embeds[0].toJSON();
    for (const id of ['410000000000000001', '410000000000000002', '410000000000000003']) assert.ok(greeting.description.includes(id));
    const ticket = (await pressSetup(h, h.owner, menu, ['tickets'])).payload.embeds[0].toJSON();
    assert.match(ticket.description, /410000000000000004/);
    assert.match(ticket.description, new RegExp(ids.role));
    const assistant = (await pressSetup(h, h.owner, menu, ['assistant'])).payload;
    await pressSetup(h, h.owner, setupControl(assistant, 'Activar IA'));
    assert.equal(new Store(h.dir).guild(ids.guild).ai, true);
});
