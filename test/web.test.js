'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PermissionsBitField } = require('discord.js');
const { createWeb, publicOrigin, serverPage } = require('../src/web');
const { Store } = require('../src/core');
const { P } = require('../src/permissions');
const { Rewards } = require('../src/rewards');
const { Birthdays } = require('../src/birthdays');
const { communitySetup } = require('../src/community-setup');
const A = '11111111111111111', B = '22222222222222222', U = '33333333333333333';
async function harness(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-web-'));
    const store = new Store(dir);
    store.guild(A).knowledgePages = { 'solo-a': 'INFORMACION_A' };
    store.guild(B).knowledgePages = { 'solo-b': 'INFORMACION_B' };
    const controls = { permission: P.Administrator, oauth: P.Administrator, owner: false, tokenCalls: 0 };
    const makeGuild = id => ({ id, name: id === A ? 'Servidor A' : 'Servidor B', memberCount: id === A ? 43 : 146, ownerId: '99999999999999999',
        async fetch() { return this; }, roles: { fetch: async () => {} },
        members: { fetchMe: async () => ({}), fetch: async () => ({ id: U, user:{id:U,username:'Alex'}, permissions: new PermissionsBitField([controls.permission]) }) } });
    const client = { application:{fetch:async()=>({owner:{id:controls.botOwner||'99999999999999999'}})}, isReady: () => true, guilds: { cache: new Map([[A, makeGuild(A)], [B, makeGuild(B)]]) } };
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
    const rewards=new Rewards(store,async()=>{}), birthdays=new Birthdays(store,client);
    const linked=new Set(), catalog={ ready:()=>true, linked:id=>linked.has(id), connectURL:(origin,state)=>'https://accounts.spotify.com/authorize?state='+state,
        connect:async id=>linked.add(id), unlink:async id=>linked.delete(id) };
    const community = communitySetup({ store, rewards: { reconcile: async () => {} }, getChannel: (ctx, id) => ctx.guild.channels.fetch(id) });
    const ai={customDraft:async()=>({name:'obliterar',type:'timeout',minutes:10})};
    const musicCalls=[],music={library:{managed:{info:()=>({revision:0,playlists:[],trash:[],usage:0,quota:1073741824}),upload:async(req,input,verify)=>{await verify();for await(const chunk of req){};musicCalls.push({upload:input.title});return 'w-test';}},list:()=>[]},sessions:new Map(),snapshot:g=>({active:true,voice:'ready',player:'idle',volume:65,current:'<script>secret</script>',queue:[],total:0,diag:{last:'RATE_LIMIT',cooldownSeconds:900,suppressed:2},library:[],spotify:true,youtubeApi:false}),webAction:async(ctx,action,value)=>musicCalls.push({guild:ctx.guild.id,action,value})};
    music.sessions.set(A,{text:{guild:{id:A},permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages])}});
    const web = createWeb({ client, store, definitions, fetchImpl, rewards, birthdays, ai, music, catalog, community, env: { WEB_BASE_URL: 'https://timmy.example', DISCORD_CLIENT_ID: A, DISCORD_CLIENT_SECRET: 'fake-secret', NODE_ENV: 'production' } });
    const address = await web.listen(0);
    t.after(async () => { await web.close(); rewards.close(); fs.rmSync(dir, { recursive: true, force: true }); });
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
    return { web, store, controls, client, request, login, rewards, linked,musicCalls };
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
    const editingTab = await h.request('/panel/sesion', cookie, { headers: { Accept: 'application/json' } });
    assert.equal(editingTab.status, 401);
    assert.equal(editingTab.headers.get('set-cookie'), null);
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
    assert.equal((home.match(/role="tab"/g) || []).length, 5);
    for (const [n,label] of ['Niveles','Boosts','Verificación','Música','Voz'].entries()) {
        assert.match(home,new RegExp('id="tab-'+n+'"[^>]*>'+label+'</button>'));
        assert.match(home,new RegExp('id="example-'+n+'"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-'+n+'"'));
    }
    assert.match(home,/Tu música, en Discord/);
    assert.match(home,/Tu propia sala de voz/);
    for (const id of ['niveles', 'boosts', 'verificacion', 'proteccion', 'bienvenidas', 'ask']) {
        assert.ok(home.includes('href="/guia#' + id + '"')); assert.ok(guide.includes('id="' + id + '"'));
    }
    for (const text of ['{boost.perks}', '{level}', '{xp}', '𝑙𝑒𝑣𝑒𝑙 100', 'Guía rápida']) assert.ok(guide.includes(text));
    for (const page of [home, guide]) {
        assert.doesNotMatch(page, /INFORMACION_A|solo-a|discord\.gg\/|oauth2\/authorize/i);
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

test('el panel guarda fichas y XP del servidor; rechaza permisos revocados, otras comunidades y formularios obsoletos',async t=>{
    const h=await harness(t),{cookie}=await h.login(), route='/servers/'+A+'/panel';
    const edit=await h.request(route+'?seccion=knowledge',cookie), html=await edit.text();
    assert.equal(edit.status,200);
    const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
    const post=(dest,data,origin='https://timmy.example')=>h.request(dest,cookie,{method:'POST',headers:{Origin:origin},body:new URLSearchParams({csrf,...data})});
    const data={section:'knowledge',revision:'0',name:'reclamar-boost',copy:'Pide tu rol con >rc.'};
    assert.equal((await post(route,data,'https://otro.example')).status,403);
    assert.equal((await post(route,{...data,csrf:'otro'})).status,403);
    assert.equal((await post('/servers/'+B+'/panel',data)).status,403);
    assert.equal((await post(route,data)).status,303);
    assert.equal((await post(route,data)).status,400);assert.equal(h.store.guild(A).knowledgePages[data.name],data.copy);
    assert.equal(h.store.guild(B).knowledgePages[data.name],undefined);
    const xp={section:'xp',user:U,total:'500',expected:'0'};
    assert.equal((await post(route,xp)).status,303);
    assert.match(await (await h.request(route+'?seccion=xp',cookie)).text(),/data-xp-total="500"/);
    assert.equal((await post(route,xp)).status,400);
    h.controls.permission=P.ManageGuild;
    assert.equal((await post(route,{...xp,total:'50',expected:'500'})).status,403);assert.equal(h.rewards.xp(A,U),500);
});
test('vinculación de Spotify funciona para un miembro y valida el estado una sola vez',async t=>{
    const h=await harness(t),{cookie}=await h.login();h.controls.permission=0n;h.controls.oauth=0n;
    const route='/musica/spotify', html=await (await h.request(route,cookie)).text();
    const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
    const post=dest=>h.request(dest,cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body:new URLSearchParams({csrf})});
    assert.equal((await h.request(route+'/callback?code=prueba&state=inventado',cookie)).status,403);
    const auth=await post(route);assert.equal(auth.status,303);
    const state=new URL(auth.headers.get('location')).searchParams.get('state');
    const cb=route+'/callback?state='+state+'&code=prueba';
    assert.equal((await h.request(cb,cookie)).status,303);assert.ok(h.linked.has(U));
    assert.equal((await h.request(cb,cookie)).status,403);
    assert.equal((await post(route+'/quitar')).status,303);assert.equal(h.linked.size,0);
    assert.equal((await h.request('/servers/'+A+'/panel',cookie)).status,403);
});

test('el editor visual conserva campos adicionales, actualiza la plantilla real y rechaza sobrescribir otra versión',async t=>{
    const h=await harness(t),{cookie}=await h.login(),guild=h.client.guilds.cache.get(A);
    const {PermissionsBitField,ChannelType}=require('discord.js');
    const ch={id:'55555555555555555',name:'bienvenidas',type:ChannelType.GuildText,permissionsFor:()=>new PermissionsBitField([P.Administrator])};
    guild.channels={cache:new Map([[ch.id,ch]]),fetch:async()=>ch};
    const member={id:U,user:{id:U,username:'Alex'},guild,permissions:new PermissionsBitField([P.Administrator])};
    guild.members.fetch=async()=>member;
    const original='{embed}$v{title: Antes}$v{description: Texto}$v{author: Equipo}$v{field: Horario && Sábado && false}';
    h.store.patchGuild(A,{welcomeMessages:[{channelId:ch.id,text:original}]});
    const route='/servers/'+A+'/panel', page=await (await h.request(route+'?seccion=welcome',cookie)).text();
    const token=k=>page.match(new RegExp('name="'+k+'" value="([^"]+)"'))[1];
    const form={csrf:token('csrf'),revision:token('revision'),section:'welcome',channel:ch.id,original:ch.id,format:'embed',title:'Bienvenido',description:'Hola {user.name}',color:'#5d55ff',image:'',thumbnail:'{user.avatar}',footer:'Equipo de soporte'};
    const save=()=>h.request(route,cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body:new URLSearchParams(form)});
    assert.equal((await save()).status,303);
    const template=h.store.guild(A).welcomeMessages[0].text;
    assert.match(template,/Bienvenido/);assert.match(template,/author: Equipo/);assert.match(template,/Horario && Sábado/);assert.match(template,/footer: Equipo de soporte/);
    assert.equal((await save()).status,400);
});

test('el acceso directo abre Bienvenidas con módulos configurables',async t=>{
    const h=await harness(t), route='/servers/'+A+'/panel';
    const first=await h.request(route);
    assert.equal(first.headers.get('location'),'/auth/login?guild='+A+'&panel=1');
    const {cookie}=await h.login();
    const html=await (await h.request(route,cookie)).text();
    for (const label of ['Bienvenidas','Ignorar cuentas de bots','Tarjeta con imagen','Nombre del autor','Añadir campo','Añadir botón','Enviar prueba','Snipe y roles']) assert.ok(html.includes(label),label);
    const snipe=await h.request(route+'?seccion=snipe',cookie);
    assert.match(await snipe.text(),/Rol con acceso a Snipe/);
});

test('la prueba usa el borrador, no guarda la bienvenida y no menciona miembros',async t=>{
    const h=await harness(t), {cookie}=await h.login(), route='/servers/'+A+'/panel';
    const guild=h.client.guilds.cache.get(A), sent=[];
    const channel={id:'55555555555555555',type:0,name:'pruebas',permissionsFor:()=>new PermissionsBitField([P.Administrator]),send:async p=>sent.push(p)};
    guild.channels={cache:new Map([[channel.id,channel]]),fetch:async()=>channel};
    guild.members.fetch=async()=>({id:U,guild,user:{username:'Alex'},permissions:new PermissionsBitField([P.Administrator])});
    const page=await (await h.request(route,cookie)).text(), csrf=page.match(/name="csrf" value="([^"]+)"/)[1];
    const body=new URLSearchParams({csrf,intent:'test',section:'welcome',testChannel:channel.id,format:'embed',title:'Hola {{user}}',author:'Equipo',fieldEditor:'1',fieldName:'Reglas',fieldValue:'Lee el canal',fieldInline:'false',linkEditor:'1',linkName:'Guía',linkValue:'https://example.org'});
    assert.equal((await h.request(route,cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body})).status,204);
    assert.equal(sent[0].embeds[0].title,'Hola <@'+U+'>');
    assert.equal(sent[0].embeds[0].fields[0].name,'Reglas');
    assert.equal(sent[0].components[0].components[0].url,'https://example.org/');
    assert.deepEqual(sent[0].allowedMentions,{parse:[]});
    assert.equal(h.store.guild(A).welcome,null);
});

test('una imagen subida por el administrador se puede usar en un embed tras autenticarse',async t=>{
    const h=await harness(t),{cookie}=await h.login(), route='/servers/'+A+'/panel';
    const html=await (await h.request(route,cookie)).text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
    const headers={Origin:'https://timmy.example','X-CSRF-Token':csrf};
    const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aafkAAAAASUVORK5CYII=','base64');
    const response=await h.request(route+'?imagen=1',cookie,{method:'POST',headers,body:data});
    assert.equal(response.status,200);
    const image=await h.request(new URL((await response.json()).url).pathname);
    assert.equal(image.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()),data);
    assert.equal((await h.request('/servers/'+B+'/panel?imagen=1',cookie,{method:'POST',headers,body:data})).status,403);
});

test('Boosts permite retomar el mismo formulario tras caducar la sesión y guarda el embed y el rol', async t => {
    const h = await harness(t), { cookie } = await h.login();
    const guild = h.client.guilds.cache.get(A), route = '/servers/' + A + '/panel';
    const channelId = '44444444444444444', roleId = '55555555555555555';
    const admin = new PermissionsBitField([P.Administrator]);
    const member = { id: U, guild, user: { id: U, username: 'Alex' }, permissions: admin, roles: { highest: { comparePositionTo: () => 1 } } };
    guild.members.fetch = guild.members.fetchMe = async () => member;
    guild.roles.fetch = async () => ({ id: roleId, guild, editable: true, permissions: new PermissionsBitField() });
    guild.channels = { fetch: async () => ({ permissionsFor: () => admin }) };

    const page = await h.request(route + '?seccion=boosts', cookie);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    const html = await page.text(), csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    assert.ok(html.includes('data-user="' + U + '"'));
    const body = new URLSearchParams({ csrf, section: 'boosts', revision: '0', channel: channelId, role: roleId,
        enabled: 'on', perks: '', format: 'embed', title: 'Gracias por el boost', description: 'Gracias, {user}.' });
    const headers = { Origin: 'null', 'Sec-Fetch-Site': 'same-origin', Accept: 'application/json' };
    const submit = (cookie, overrides) => h.request(route, cookie, { method: 'POST', headers: { ...headers, ...overrides }, body });
    assert.equal((await submit(cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await submit(cookie, { Origin: 'https://otro.example' })).status, 403);

    const later = Date.now() + 3600001;
    t.mock.method(Date, 'now', () => later);
    assert.equal((await h.request('/panel/sesion', cookie, { headers })).status, 401);
    assert.equal((await submit(cookie)).status, 401);
    const renewed = await h.login();
    const session = await h.request('/panel/sesion', renewed.cookie, { headers });
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const fresh = await session.json();
    assert.equal(fresh.user, U);
    assert.notEqual(fresh.csrf, csrf);
    assert.equal((await submit(renewed.cookie)).status, 403);
    assert.equal(h.store.guild(A).boosts.revision, 0);

    body.set('csrf', fresh.csrf);
    const result = await submit(renewed.cookie);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).dest, route + '?seccion=boosts&guardado=1');
    const saved = h.store.guild(A).boosts;
    assert.equal(saved.roleId, roleId);
    assert.equal(saved.channelId, channelId);
    assert.equal(saved.perks, '');
    assert.match(saved.template, /Gracias por el boost/);
    assert.equal(saved.revision, 1);
});

test('public homepage has live aggregate counts and a safe Discord invite', async t => {
    const h = await harness(t);
    const page = await (await h.request('/')).text();
    assert.match(page, /Agregar a Discord/);
    assert.match(page, /<strong>2<\/strong>/);
    assert.match(page, /<strong>189<\/strong>/);
    assert.doesNotMatch(page, /Servidor A|Servidor B|INFORMACION_A|fake-secret/);
    const invite = await h.request('/invite');
    assert.equal(invite.status,303);
    const target = new URL(invite.headers.get('location'));
    assert.equal(target.origin,'https://discord.com');
    assert.equal(target.searchParams.get('scope'),'bot applications.commands');
    assert.equal(BigInt(target.searchParams.get('permissions')) & P.Administrator,0n);
    const {cookie}=await h.login();
    const servers=await (await h.request('/servers',cookie)).text();
    assert.match(servers,/43 miembros/);
    assert.match(servers,/Abrir panel/);
    assert.doesNotMatch(servers,/Servidor B/);
    h.store.guild(A).verificationTickets = { a: {status:'pendiente'}, b:{status:'aprobada'}, c:{status:'denegada'}, d:{status:'aprobando'} };
    const overview=await (await h.request('/servers/'+A,cookie)).text();
    assert.match(overview, /Verificaciones pendientes<\/span><strong>2<\/strong>/);
    assert.match(overview,/Abrir en Discord/);
    assert.match(overview,/Módulos configurados/);
});

test('custom editor AI is a draft only; save validates reserved names and guild isolation',async t=>{
    const h=await harness(t),{cookie}=await h.login(),route='/servers/'+A+'/panel';
    const page=await (await h.request(route+'?seccion=custom',cookie)).text();
    const csrf=page.match(/name="csrf" value="([^"]+)"/)[1];
    const revision=page.match(/name="revision" value="([^"]+)"/)[1];
    const send=(data)=>h.request(route,cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body:new URLSearchParams({csrf,section:'custom',revision,...data})});
    const draft=await send({intent:'custom-draft',prompt:'un timeout de 10 minutos'});
    assert.equal(draft.status,200);assert.match(await draft.text(),/Revisa el borrador de IA/);
    assert.equal(h.store.guild(A).customActions.obliterar,undefined);
    assert.equal((await send({name:'ticketpanel',type:'text',copy:'x'})).status,400);
    assert.equal((await send({name:'obliterar',type:'timeout',minutes:'10'})).status,303);
    assert.deepEqual(h.store.guild(A).customActions.obliterar,{type:'timeout',minutes:10});
    assert.equal(h.store.guild(B).customActions.obliterar,undefined);
    const staffPage=await (await h.request(route+'?seccion=staff',cookie)).text();
    assert.match(staffPage,/Solo el dueño/);
    const forbidden=await h.request(route,cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body:new URLSearchParams({csrf,section:'staff',revision:'0',mode:'off',minutes:'10'})});
    assert.equal(forbidden.status,400);
});

test('public bot avatar is used in the header, hero and preview and redirects only to its own CDN image',async t=>{
    const h=await harness(t);
    const page=await (await h.request('/')).text();
    assert.equal((page.match(/data-bot-avatar/g)||[]).length,3);
    assert.match(page,/class="demo-author"[^]*?data-bot-avatar/);
    const fallback=await h.request('/bot-avatar');
    assert.equal(fallback.status,200);
    assert.match(fallback.headers.get('content-type'),/image\/svg\+xml/);
    h.client.user={id:A,avatar:'a'.repeat(32)};
    const first=await h.request('/bot-avatar');
    assert.equal(first.status,303);
    assert.equal(first.headers.get('location'),'https://cdn.discordapp.com/avatars/'+A+'/'+'a'.repeat(32)+'.webp?size=256');
    assert.equal(first.headers.get('cache-control'),'no-store');
    h.client.user.avatar='b'.repeat(32);
    const changed=await h.request('/bot-avatar?v=2');
    assert.match(changed.headers.get('location'),new RegExp('b{32}'));
    h.client.user.avatar='https://evil.example/';
    assert.equal((await h.request('/bot-avatar')).status,200);
});
test('avatar resolver refreshes REST every minute and retains last good value on temporary errors',async()=>{
    const {createAvatarResolver}=require('../src/bot-avatar');
    let now=0,calls=0,hash='b'.repeat(32),fail=false;
    const client={user:{id:A,avatar:'a'.repeat(32)},users:{fetch:async(id,options)=>{
        calls++;assert.equal(id,A);assert.equal(options.force,true);
        if(fail)throw Error('offline');
        return {id:A,avatar:hash};
    }}};
    const resolve=createAvatarResolver(client,()=>now);
    assert.match(await resolve(),/b{32}/);
    hash='c'.repeat(32);now=30000;
    assert.match(await resolve(),/b{32}/);assert.equal(calls,1);
    now=60000;
    const [one,two]=await Promise.all([resolve(),resolve()]);
    assert.match(one,/c{32}/);assert.equal(one,two);assert.equal(calls,2);
    now=120000;fail=true;assert.match(await resolve(),/c{32}/);
});

test('Music Center escapes titles and enforces guild isolation, CSRF and administrator access',async t=>{
 const h=await harness(t),{cookie}=await h.login(),route='/servers/'+A+'/panel';
 const res=await h.request(route+'?seccion=music',cookie),html=await res.text();
 assert.equal(res.status,200);assert.match(html,/RATE_LIMIT/);assert.match(html,/&lt;script&gt;secret/);assert.doesNotMatch(html,/<script>secret/);
 const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
 const send=(id,token)=>h.request('/servers/'+id+'/panel',cookie,{method:'POST',headers:{Origin:'https://timmy.example'},body:new URLSearchParams({csrf:token,section:'music',action:'pause'})});
 assert.equal((await send(A,'invalid')).status,403);
 assert.equal((await send(B,csrf)).status,403);
 assert.equal((await send(A,csrf)).status,303);
 assert.deepEqual(h.musicCalls,[{guild:A,action:'pause',value:null}]);
 h.controls.permission=0n;assert.equal((await send(A,csrf)).status,403);
});

test('web library uploads require bot owner, valid CSRF and authorized guild',async t=>{
 const h=await harness(t),{cookie}=await h.login(),route='/servers/'+A+'/panel';
 const page=await (await h.request(route+'?seccion=music',cookie)).text(),csrf=page.match(/name="csrf" value="([^"]+)"/)[1];
 assert.doesNotMatch(page,/data-music-upload/);
 const upload=(id,token)=>h.request('/servers/'+id+'/panel?musicUpload=audio',cookie,{method:'POST',headers:{Origin:'https://timmy.example',Accept:'application/json','Content-Type':'application/octet-stream','X-CSRF-Token':token,'X-Music-Meta':Buffer.from(JSON.stringify({title:'Own'})).toString('base64url')},body:Buffer.from('x')});
 assert.equal((await upload(A,csrf)).status,403);
 h.controls.botOwner=U;
 assert.match(await (await h.request(route+'?seccion=music',cookie)).text(),/data-music-upload/);
 assert.equal((await upload(A,'bad')).status,403);
 assert.equal((await upload(B,csrf)).status,403);
 assert.equal((await upload(A,csrf)).status,200);
 assert.deepEqual(h.musicCalls,[{upload:'Own'}]);
});

test('public community is unpublished by default and status exposes only aggregate data',async t=>{
 const h=await harness(t);
 assert.equal((await h.request('/community/'+A)).status,404);
 h.store.patchGuild(A,{publicPage:{enabled:true,title:'Public title',description:'<script>private</script>',language:'en',invite:''}});
 const page=await (await h.request('/community/'+A)).text();assert.match(page,/Public title/);assert.match(page,/Members: 43/);assert.doesNotMatch(page,/<script>private/);assert.doesNotMatch(page,/INFORMACION_A/);
 const status=await (await h.request('/status.json')).json();assert.equal(status.servers,2);assert.equal(status.ready,true);
 assert.equal((await h.request('/manifest.webmanifest')).status,200);
});

test('official support and public directory are accessible without login and exclude privileged details',async t=>{
 const h=await harness(t);
 const support=await h.request('/support');assert.equal(support.status,200);assert.match(await support.text(),/https:\/\/discord\.gg\/qaXbDZyK3z/);
 const directory=await h.request('/commands');assert.equal(directory.status,200);const html=await directory.text();assert.match(html,/Directorio de comandos/);assert.doesNotMatch(html,/>ticketpanel</);assert.doesNotMatch(html,/INFORMACION_A/);
});

test('public changelog exposes only shipped notes and guide anchors',async t=>{
 const h=await harness(t);const response=await h.request('/updates');assert.equal(response.status,200);const body=await response.text();assert.match(body,/Últimas novedades documentadas/);assert.doesNotMatch(body,/INFORMACION_A/);assert.doesNotMatch(body,/github\.com\/wdydk\/bot-de-brian\/commit\//);
});

test('studio shell exposes accessible navigation and no private settings to anonymous users',async t=>{
 const h=await harness(t),page=await (await h.request('/')).text();
 assert.match(page,/id="main-content"/);assert.match(page,/class="tm-skip"/);assert.match(page,/class="tm-footer"/);
 assert.match(page,/tm-feature-group/);assert.doesNotMatch(page,/INFORMACION_A/);
 const {cookie}=await h.login(),dashboard=await(await h.request('/servers/'+A+'/panel?seccion=xp',cookie)).text();
 assert.match(dashboard,/data-module-search/);assert.match(dashboard,/tm-nav-group/);assert.match(dashboard,/aria-current="page"/);
});

test('polished public pages preserve honest status and real support destinations',async t=>{
 const h=await harness(t);
 const status=await(await h.request('/status')).text();assert.match(status,/tm-status-metrics/);assert.match(status,/Discord: Conectado/);assert.match(status,/no verifica Supabase/);
 const support=await(await h.request('/support')).text();assert.match(support,/tm-support-grid/);assert.match(support,/href="\/guia#errores"/);
 const releases=await(await h.request('/updates')).text();assert.match(releases,/tm-release-card/);assert.doesNotMatch(releases,/github\.com\/wdydk/);
 const home=await(await h.request('/')).text();assert.match(home,/tm-community-strip/);assert.match(home,/data-bot-avatar/);
});

test('quick navigation and feature explorer preserve the anonymous shell',async t=>{
 const h=await harness(t),home=await(await h.request('/')).text();
 assert.match(home,/data-quick-open hidden/);assert.match(home,/id="tm-quick-dialog"/);
 assert.match(home,/data-feature-search/);assert.match(home,/data-feature-count/);
 assert.doesNotMatch(home,/INFORMACION_A/);
 const guide=await(await h.request('/guia')).text();assert.match(guide,/data-guide-search/);
});
