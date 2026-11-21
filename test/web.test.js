'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PermissionsBitField } = require('discord.js');
const { createWeb, publicOrigin, serverPage } = require('../src/web');
const { Store } = require('../src/core');
const { P } = require('../src/permissions');
const A = '11111111111111111', B = '22222222222222222', U = '33333333333333333';
async function harness(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-web-'));
    const store = new Store(dir);
    store.guild(A).knowledgePages = { 'solo-a': 'INFORMACION_A' };
    store.guild(B).knowledgePages = { 'solo-b': 'INFORMACION_B' };
    const controls = { permission: P.Administrator, oauth: P.Administrator, owner: false, tokenCalls: 0 };
    const makeGuild = id => ({ id, name: id === A ? 'Servidor A' : 'Servidor B', ownerId: '99999999999999999',
        async fetch() { return this; }, roles: { fetch: async () => {} },
        members: { fetch: async () => ({ id: U, permissions: new PermissionsBitField([controls.permission]) }) } });
    const client = { isReady: () => true, guilds: { cache: new Map([[A, makeGuild(A)], [B, makeGuild(B)]]) } };
    const fetchImpl = async (url, options) => {
        if (url.endsWith('/oauth2/token')) {
            controls.tokenCalls++;
            const params = new URLSearchParams(options.body);
            assert.equal(params.get('client_secret'), 'fake-secret');
            assert.ok(params.get('code_verifier').length >= 43);
            return Response.json({ access_token: 'fake-user-token', scope: 'identify guilds', expires_in: 86400 });
        }
        assert.equal(options.headers.Authorization, 'Bearer fake-user-token');
        if (url.endsWith('/users/@me')) return Response.json({ id: U, username: 'Usuario de prueba' });
        if (url.includes('/users/@me/guilds')) return Response.json([{ id: A, name: 'Servidor A', permissions: controls.oauth.toString(), owner: controls.owner }, { id: B, name: 'Servidor B', permissions: '0', owner: false }]);
        throw Error('Unexpected URL');
    };
    const definitions = [{ name: 'ticketpanel', description: 'Publica tickets', usage: '>ticketpanel', category: 'Tickets', adminOnly: true, aliases: [] }];
    const web = createWeb({ client, store, definitions, fetchImpl, env: { WEB_BASE_URL: 'https://timmy.example', DISCORD_CLIENT_ID: A, DISCORD_CLIENT_SECRET: 'fake-secret', NODE_ENV: 'production' } });
    const address = await web.listen(0);
    t.after(async () => { await web.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${address.port}`;
    const request = (route, cookie, extra = {}) => fetch(base + route, { redirect: 'manual', ...extra, headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra.headers } });
    async function login() {
        const begin = await request(`/auth/login?guild=${A}`);
        const cookie = begin.headers.get('set-cookie').split(';')[0];
        const location = new URL(begin.headers.get('location'));
        assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
        const state = location.searchParams.get('state');
        const finish = await request(`/auth/callback?code=code123&state=${state}`, cookie);
        assert.equal(finish.status, 303);
        assert.equal(finish.headers.get('location'), `/servers/${A}`);
        const auth = finish.headers.get('set-cookie').split(';')[0];
        assert.notEqual(auth, cookie);
        return { cookie: auth, state, anonymous: cookie, finish };
    }
    return { web, store, controls, client, request, login };
}
test('URL pública rechaza protocolos inseguros, rutas y credenciales en producción', () => {
    for (const url of ['http://localhost:8080', 'https://user:password@example.com', 'https://example.com/path', 'javascript:alert(1)']) assert.equal(publicOrigin({ WEB_BASE_URL: url, NODE_ENV: 'production' }), '');
    assert.equal(publicOrigin({ RAILWAY_PUBLIC_DOMAIN: 'mybot.up.railway.app', NODE_ENV: 'production' }), 'https://mybot.up.railway.app');
});
test('visitante sin sesión no recibe catálogo, configuración ni archivos privados', async t => {
    const h = await harness(t);
    const landing = await h.request('/'); const body = await landing.text();
    assert.equal(landing.status, 200); assert.ok(!body.includes('ticketpanel')); assert.ok(!body.includes('solo-a'));
    const page = await h.request(`/servers/${A}`);
    assert.equal(page.status, 303); assert.match(page.headers.get('location'), /auth\/login/);
    for (const target of ['/src/web.js', '/.env', '/data/timmy-v3.json', '/COMMANDS.md', '/transcripts/123.txt']) assert.equal((await h.request(target)).status, 404);
});
test('OAuth exige estado vinculado a cookie y rechaza reutilizar un callback', async t => {
    const h = await harness(t);
    const begin = await h.request('/auth/login');
    const cookie = begin.headers.get('set-cookie').split(';')[0];
    const state = new URL(begin.headers.get('location')).searchParams.get('state');
    assert.equal((await h.request(`/auth/callback?code=x&state=${state}`)).status, 403);
    assert.equal((await h.request('/auth/callback?code=x&state=invalid', cookie)).status, 403);
    assert.equal(h.controls.tokenCalls, 0);
    const complete = await h.request(`/auth/callback?code=x&state=${state}`, cookie);
    assert.equal(complete.status, 303);
    assert.equal((await h.request(`/auth/callback?code=x&state=${state}`, cookie)).status, 403);
    assert.equal(h.controls.tokenCalls, 1);
    assert.match(complete.headers.get('set-cookie'), /HttpOnly/); assert.match(complete.headers.get('set-cookie'), /Secure/); assert.match(complete.headers.get('set-cookie'), /SameSite=Lax/);
});
test('admin A puede ver A; cambiar URL a B no revela datos de B', async t => {
    const h = await harness(t), { cookie } = await h.login();
    const response = await h.request(`/servers/${A}`, cookie), body = await response.text();
    assert.equal(response.status, 200); assert.match(body, /ticketpanel/); assert.match(body, /solo-a/);
    assert.ok(!body.includes('solo-b')); assert.ok(!body.includes('INFORMACION_B'));
    const other = await h.request(`/servers/${B}`, cookie); assert.equal(other.status, 403);
    assert.ok(!(await other.text()).includes('solo-b'));
    const servers = await (await h.request('/servers', cookie)).text();
    assert.match(servers, /Servidor A/); assert.ok(!servers.includes('Servidor B'));
});
test('quitar Administrador bloquea siguiente petición aunque la sesión siga abierta', async t => {
    const h = await harness(t), { cookie } = await h.login();
    assert.equal((await h.request(`/servers/${A}`, cookie)).status, 200);
    h.controls.permission = P.ManageGuild;
    assert.equal((await h.request(`/servers/${A}`, cookie)).status, 403);
    h.controls.oauth = P.ManageGuild;
    assert.equal((await h.request(`/servers/${A}`, cookie)).status, 403);
});
test('dueño sin bit Administrador explícito también entra', async t => {
    const h = await harness(t), { cookie } = await h.login();
    h.controls.permission = 0n; h.controls.oauth = 0n; h.controls.owner = true;
    h.client.guilds.cache.get(A).ownerId = U;
    assert.equal((await h.request(`/servers/${A}`, cookie)).status, 200);
});
test('salir exige origen y token CSRF; luego la sesión deja de funcionar', async t => {
    const h = await harness(t), { cookie } = await h.login();
    const body = await (await h.request(`/servers/${A}`, cookie)).text();
    const csrf = body.match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await h.request('/logout', cookie, { method: 'POST', body: `csrf=${csrf}`, headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await h.request('/logout', cookie, { method: 'POST', body: 'csrf=wrong', headers: { Origin: 'https://timmy.example' } })).status, 403);
    assert.equal((await h.request('/logout', cookie, { method: 'POST', body: `csrf=${csrf}`, headers: { Origin: 'https://timmy.example' } })).status, 303);
    assert.equal((await h.request(`/servers/${A}`, cookie)).status, 303);
});
test('contenido del servidor escapa HTML y catálogo no muestra textos de fichas', async t => {
    const h = await harness(t);
    const html = serverPage({ id: A, name: '<img src=x onerror=alert(1)>' }, h.store.guild(A), [], { user: { username: '<script>alert(1)</script>' }, csrf: 'x' });
    assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<script>alert'));
    assert.ok(!html.includes('INFORMACION_A'));
});
test('la portada y guía públicas muestran los ejemplos sin exponer ajustes ni ofrecer una instalación', async t => {
    const h = await harness(t);
    const home = await (await h.request('/')).text();
    const response = await h.request('/guia'), guide = await response.text();
    assert.equal(response.status, 200);
    assert.equal((home.match(/role="tab"/g) || []).length, 3);
    for (const id of ['niveles', 'boosts', 'verificacion', 'proteccion', 'bienvenidas', 'ask']) {
        assert.ok(home.includes('href="/guia#' + id + '"')); assert.ok(guide.includes('id="' + id + '"'));
    }
    for (const text of ['{boost.perks}', '{level}', '{xp}', '𝑙𝑒𝑣𝑒𝑙 100', 'Guía rápida']) assert.ok(guide.includes(text));
    for (const page of [home, guide]) {
        assert.doesNotMatch(page, /INFORMACION_A|solo-a|discord\.gg\/|oauth2\/authorize|Agregar (a Discord|al servidor)/i);
        assert.match(page, /name="viewport"/);
    }
    const css = await h.request('/community.css');
    assert.match(css.headers.get('content-type'), /text\/css/); assert.match(await css.text(), /max-width: 580px/);
    const login = await h.request('/auth/login');
    assert.equal(new URL(login.headers.get('location')).searchParams.get('scope'), 'identify guilds');
    const { cookie } = await h.login();
    h.store.guild(A).levels.enabled = true;
    h.store.guild(B).boosts.enabled = true;
    const dashboard = await (await h.request('/servers/' + A, cookie)).text();
    assert.match(dashboard, /Niveles <strong>Activo/);
    assert.match(dashboard, /Boosts <strong>Apagado/);
});
