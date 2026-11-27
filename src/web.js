'use strict';
const { toneWav, TEST_PATH }=require('./lavalink-voice');
let diagnosticTone;
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { ExpiringCache, UserError } = require('./core');
const { tabs,settingsView,saveSettings,testMessage } = require('./dashboard');
const { validateCustom } = require('./custom-commands');
const { simulateCustom }=require('./dashboard-design');
const { isAdmin } = require('./access');
const publicCenter=require('./public-center');
const official=require('./official-community');
const { P } = require('./permissions');
const { homeContent, guideContent } = require('./guide');
const { createAvatarResolver, placeholder } = require('./bot-avatar');
const {isBotOwner}=require('./music-library');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const id = value => /^\d{17,20}$/.test(value || '');
class WebError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function publicOrigin(env = process.env) {
    const input = env.WEB_BASE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '');
    if (!input) return '';
    try {
        const url = new URL(input);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return '';
        if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return '';
        return url.origin;
    } catch { return ''; }
}
const permissionName = value => Object.keys(P).find(key => P[key] === value) || 'Permiso específico';
function guildBadge(guild) {
    const hash=typeof guild.icon === 'string' ? guild.icon : null;
    const url=id(guild.id) && /^(?:a_)?[a-f0-9]{32}$/.test(hash || '') ? `https://cdn.discordapp.com/icons/${guild.id}/${hash}.png?size=128` : null;
    return `<span class="server-badge">${url ? `<img src="${url}" alt="" loading="lazy" width="56" height="56">` : escape(guild.name.slice(0,2).toUpperCase())}</span>`;
}
function appearance() {
    return `<dialog id="appearance"><form method="dialog"><div class="section-label"><h2>A tu gusto</h2><button aria-label="Cerrar apariencia" class="quiet">✕</button></div><p>Personaliza esta página en tu navegador.</p><label>Tema<select id="pref-theme"><option value="dark">Oscuro</option><option value="light">Claro</option></select></label><label>Acento<select id="pref-accent"><option value="default">Del sitio</option><option value="pink">Rosa</option><option value="mint">Menta</option><option value="lavender">Lavanda</option></select></label><label>Lista de comandos<select id="pref-view"><option value="list">Lista compacta</option><option value="cards">Tarjetas</option></select></label><p class="micro">Se recuerda en este dispositivo. Para cambiar el diseño para todos, edita web/theme.css en GitHub.</p><button class="button" type="button" id="reset-appearance">Restablecer</button></form></dialog>`;
}
function layout(title, content, session, configured = true) {
    const account = session?.user ? `<span class="account">${escape(session.user.username)}</span><form action="/logout" method="post"><input type="hidden" name="csrf" value="${escape(session.csrf)}"><button class="quiet" type="submit">Salir</button></form>` : (configured ? '<a href="/servers">Mi panel</a>' : '');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="Timmy Max: moderación, música, inteligencia artificial y herramientas para tu comunidad de Discord."><meta name="theme-color" content="#10121c"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/timmy-icon.svg"><title>${escape(title)} · Timmy Max</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/community.css"><link rel="stylesheet" href="/dashboard.css"><link rel="stylesheet" href="/refresh.css"><script src="/app.js" defer></script></head><body><a class="tm-skip" href="#main-content">Ir al contenido</a><header class="top"><a href="/" class="brand"><span class="mark tm-brand-avatar"><img src="/bot-avatar" data-bot-avatar alt="" width="36" height="36"></span> Timmy Max<span class="version">CONTROL CENTER</span></a><nav aria-label="Navegación"><a href="/guia">Guía rápida</a><a href="/status">Estado</a><a href="/commands">Comandos</a><a href="/support">Soporte</a><a href="/updates">Novedades</a><button type="button" class="tm-quick-open quiet" data-quick-open hidden>Buscar <kbd>Ctrl K</kbd></button><button type="button" class="quiet" id="open-appearance">Apariencia</button>${account}</nav></header><main id="main-content" tabindex="-1">${content}</main><dialog class="tm-quick-dialog" aria-labelledby="tm-quick-title" id="tm-quick-dialog"><div class="tm-quick-head"><h2 id="tm-quick-title">Ir a una sección</h2><button type="button" class="quiet" data-quick-close aria-label="Cerrar búsqueda">✕</button></div><label class="tm-quick-search"><span>Buscar páginas y módulos de esta vista</span><input type="search" data-quick-search placeholder="Escribe para navegar…" autocomplete="off"></label><p class="tm-quick-count" role="status" data-quick-count></p><div class="tm-quick-results" data-quick-results></div><p class="tm-quick-hint">↑ ↓ para elegir · Enter para abrir · Esc para cerrar</p></dialog>${appearance()}<footer class="tm-footer"><div class="tm-footer-brand"><strong>Timmy Max</strong><p>Una plataforma para tu comunidad de Discord.</p><small>© Timmy Max · Beta</small></div><nav aria-label="Producto"><strong>Producto</strong><a href="/commands">Comandos</a><a href="/guia">Documentación</a><a href="/updates">Novedades</a></nav><nav aria-label="Comunidad"><strong>Comunidad</strong><a href="/support">Soporte oficial</a><a href="/status">Estado del bot</a><a href="/privacy">Privacidad</a></nav></footer><p class="toast" id="toast" role="status" hidden></p></body></html>`;
}
function countText(n) { return Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString('es') : '—'; }
function publicStats(client) {
    if (!client?.isReady()) return { servers: null, members: null, online: false };
    const guilds = [...client.guilds.cache.values()];
    return { servers: guilds.length, members: guilds.every(g => Number.isSafeInteger(g.memberCount) && g.memberCount >= 0) ? guilds.reduce((n,g)=>n+g.memberCount,0) : null, online: true };
}
function inviteURL(env, guildId) {
    if (!id(env.DISCORD_CLIENT_ID)) return null;
    // Basic permissions only by default; server owners can grant more for enabled modules.
    const basic = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.EmbedLinks | P.AttachFiles;
    const raw = env.DISCORD_INVITE_PERMISSIONS;
    let permissions = basic;
    if (raw !== undefined) {
        if (!/^\d{1,20}$/.test(raw)) return null;
        permissions = BigInt(raw);
        if (permissions > (1n << 64n) - 1n || (permissions & P.Administrator) !== 0n) return null;
    }
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, scope: 'bot applications.commands', permissions: permissions.toString(), integration_type: '0', ...(id(guildId) ? { guild_id: guildId, disable_guild_select: 'true' } : {}) }).toString();
    return url.toString();
}
function landing(configured, client, canInvite, session) {
    const stats = publicStats(client);
    return layout('Comunidad', homeContent(configured, canInvite, stats), session, configured);
}
function overview(guild, cfg, store, client) {
    const modules = [
        ['Bienvenidas', Boolean(cfg.welcome), 'welcome'],
        ['Despedidas', Boolean(cfg.goodbye), 'goodbye'],
        ['Niveles', Boolean(cfg.levels?.enabled), 'xp'],
        ['Boosts', Boolean(cfg.boosts?.enabled), 'boosts'],
        ['Verificación', Boolean(cfg.verification?.enabled), null],
        ['Tickets', Boolean(cfg.ticketCategory && cfg.supportRole && cfg.ticketPanelMessage), null]
    ];
    const active = modules.filter(m => m[1]).length;
    const open = store ? Object.values(store.data.tickets || {}).filter(t => t.guildId === guild.id && !t.closedAt && t.status !== 'closed').length : null;
    const pending = Object.values(cfg.verificationTickets || {}).filter(t=>t && !t.closedAt && ['pendiente','aprobando'].includes(t.status)).length;
    const panel = '/servers/' + escape(guild.id) + '/panel';
    const metric = (label, value) => '<div class="tm-metric"><span>'+label+'</span><strong>'+countText(value)+'</strong></div>';
    return '<section class="tm-overview" aria-label="Resumen del servidor"><div class="tm-overview-head"><div><span class="eyebrow">RESUMEN / TIMMY MAX</span><h1>'+escape(guild.name)+'</h1><p>'+countText(guild.memberCount)+' miembros · '+(client?.isReady() ? 'Timmy conectado' : 'Estado no disponible')+'</p></div><div class="tm-actions"><a class="button" href="https://discord.com/channels/'+escape(guild.id)+'">Abrir en Discord</a><a class="button primary" href="'+panel+'">Configurar servidor</a></div></div><div class="tm-metrics">'+metric('Miembros',guild.memberCount)+metric('Tickets registrados abiertos',open)+metric('Verificaciones pendientes',pending)+ '<div class="tm-metric"><span>Módulos configurados</span><strong>'+active+'<small> / '+modules.length+'</small></strong></div></div><div class="tm-module-status"><h2>Estado de módulos</h2>'+modules.map(([label,enabled,section])=>'<div class="tm-module-row"><span>'+label+'</span><span class="tm-module-state">'+(enabled?'Configurado':'Por configurar')+'</span>'+(section?'<a href="'+panel+'?seccion='+section+'">Abrir →</a>':'<a href="/guia">Guía →</a>')+'</div>').join('')+'</div></section>';
}
function serversPage(guilds, session, client, canInvite) {
    const cards = guilds.map(g => {
        const cached = client.guilds.cache.get(g.id);
        const link = '/servers/' + escape(g.id);
        return '<article class="tm-server-card">'+guildBadge(g)+'<h2>'+escape(g.name)+'</h2><p>'+countText(cached?.memberCount)+' miembros</p><span class="tag">'+(g.owner?'Dueño':'Administrador')+'</span><div class="tm-actions"><a class="button primary" href="'+link+'">Abrir panel →</a><a class="button" href="'+link+'/panel">Ajustes</a></div></article>';
    }).join('');
    return layout('Mis servidores','<section class="servers tm-servers"><span class="eyebrow">TU ESPACIO / TIMMY MAX</span><h1>Hola, '+escape(session.user.username)+'.</h1><p class="lead">Elige un servidor donde administras Timmy. Los permisos se verifican antes de abrir el panel.</p><div class="server-grid">'+(cards||'<p class="notice">No encontramos servidores con acceso.</p>')+(canInvite?'<a class="tm-add-card" href="/invite"><span>+</span><strong>Agregar Timmy a otro servidor</strong><small>Autoriza la instalación en Discord →</small></a>':'')+'</div></section>',session);
}
function commandCard(d, prefix) {
    const usage = d.usage.replace(/^>/, prefix);
    const rule = d.adminOnly ? 'Administrador / dueño' : d.permission ? permissionName(d.permission) + (d.category === 'Moderación' ? ' · nativo o delegado' : '') : ['close', 'transcript'].includes(d.name) ? 'Autor del ticket / soporte' : 'Miembros';
    return `<article class="command" data-category="${escape(d.category)}" data-search="${escape(`${d.name} ${d.description} ${d.aliases.join(' ')} ${usage}`)}"><div class="command-name"><span class="category">${escape(d.category)}</span><h3>${escape(prefix+d.name)}</h3></div><div class="command-body"><p>${escape(d.description)}</p><span class="access">${escape(rule)}</span></div><button class="copy command-copy" type="button" data-copy="${escape(usage)}" aria-label="Copiar comando ${escape(d.name)}">Copiar</button><details class="command-details"><summary>Uso y alias</summary><div class="code-line"><code>${escape(usage)}</code></div>${d.aliases.length ? `<p class="aliases">También: ${escape(d.aliases.map(a=>prefix+a).join(', '))}</p>` : ''}</details></article>`;
}
function serverPage(guild, cfg, defs, session, store, client) {
    const pages = Object.keys(cfg.knowledgePages || {});
    const ready = [Boolean(cfg.ticketCategory && cfg.supportRole), Boolean(cfg.ticketPanelMessage), Boolean(cfg.knowledge || pages.length), Boolean(cfg.welcome)];
    const steps = [['Prepara soporte', '>ticketsetup ID_CATEGORIA @Soporte', 'Usa el ID de la categoría que agrupará los tickets.'], ['Publica el panel', '>ticketpanel', 'Escríbelo en el canal donde tus miembros pedirán ayuda.'], ['Añade información', '>knowledge add reglas Escribe aquí tus reglas', 'Puedes añadir más fichas: rangos, eventos, horarios…'], ['Recibe a tus miembros', '>welcome #bienvenidas ¡Hola {user}, bienvenido a {server}!', 'El mensaje y el canal pertenecen a este servidor.']];
    const moduleSummary = [['niveles', 'Niveles', cfg.levels?.enabled], ['boosts', 'Boosts', cfg.boosts?.enabled], ['verificacion', 'Verificación', cfg.verification?.enabled]]
        .map(([anchor, label, active]) => '<a href="/guia#' + anchor + '">' + label + ' <strong>' + (active ? 'Activo' : 'Apagado') + '</strong></a>').join('');
    const cards = defs.map(d => commandCard(d, cfg.prefix)).join('');
    return layout(guild.name, `<div class="workspace"><aside><a class="back" href="/servers">← Mis servidores</a>${guildBadge(guild)}<h2>${escape(guild.name)}</h2><p class="micro">ID ${escape(guild.id)}</p><span class="tag green">ADMINISTRACIÓN</span><nav class="side-nav" aria-label="Secciones"><a href="/servers/${escape(guild.id)}/panel?seccion=xp">Experiencia y ajustes</a><a href="#catalogo">Comandos <span>${defs.length}</span></a><a href="#inicio">Primeros pasos <span>${ready.filter(Boolean).length}/4</span></a><a href="#info">Información IA <span>${pages.length}</span></a></nav><div class="aside-note">Los cambios se guardan en Discord con /setup. La guía incluye ejemplos que puedes copiar.</div></aside><div class="workspace-main">${overview(guild,cfg,store,client)}<div class="heading"><div><span class="eyebrow">TU SERVIDOR</span><h1>Comandos <span class="accent">/</span></h1><p>Encuentra el comando, copia y úsalo en ${escape(guild.name)}.</p></div><span class="prefix">Prefijo <b>${escape(cfg.prefix)}</b></span></div><nav class="module-summary" aria-label="Módulos de comunidad">${moduleSummary}<a href="/guia">Guía rápida →</a></nav><details class="onboarding" id="inicio"><summary>Configurar tu servidor <span>${ready.filter(Boolean).length} de 4 listos</span></summary><div class="step-grid">${steps.map(([title, cmd, text], i) => `<div class="step"><span class="step-number ${ready[i] ? 'done' : ''}">${ready[i] ? '✓' : `0${i + 1}`}</span><h3>${title}</h3><p>${text}</p><button class="text-button" type="button" data-copy="${escape(cmd.replace(/^>/, cfg.prefix))}">Copiar comando ↗</button></div>`).join('')}</div></details><section id="catalogo"><div class="section-label"><h2>Explorar comandos</h2><span id="result-count">${defs.length} comandos</span></div><label class="search"><span>⌕</span><input id="search" type="search" placeholder="Buscar un comando, una función…" autocomplete="off" aria-label="Buscar comandos"><kbd>/</kbd></label><div class="filters" role="group" aria-label="Filtrar categoría"><button class="active" data-filter="" aria-pressed="true">Todos</button>${[...new Set(defs.map(d => d.category))].map(c => `<button data-filter="${escape(c)}" aria-pressed="false">${escape(c)}</button>`).join('')}</div><div class="command-grid">${cards}</div><p class="empty" id="no-results" hidden>No hay comandos con esa búsqueda. Prueba otra palabra.</p></section><section class="knowledge" id="info"><div class="section-label"><h2>Información de este servidor</h2><span>IA ${cfg.ai ? 'activa' : 'desactivada'}</span></div><p>Estas fichas ayudan a responder a tus miembros. No guardes secretos: la IA puede usar su contenido al atender preguntas de este servidor.</p><div class="chips">${cfg.knowledge ? '<span class="pill">general</span>' : ''}${pages.map(n => `<span class="pill">${escape(n)}</span>`).join('') || (cfg.knowledge ? '' : '<span class="micro">Aún no hay fichas. Empieza con las reglas de tu comunidad.</span>')}</div><div class="code-line"><code>${escape(cfg.prefix)}knowledge add eventos Torneo el sábado a las 18:00</code><button class="copy" data-copy="${escape(cfg.prefix)}knowledge add eventos Torneo el sábado a las 18:00">Copiar</button></div><p class="micro">20 fichas como máximo · 16 000 caracteres en total · Los DMs del bot ofrecen ayuda general.</p></section></div></div>`, session);
}
function createWeb({ client, store, definitions, rewards, community, birthdays, ai, music, security, communityExpansion, voiceMaster, roblox, catalog, env = process.env, fetchImpl = fetch } = {}) {
    const origin = publicOrigin(env);
    if (!origin) throw new Error('Define WEB_BASE_URL con el dominio HTTPS de Railway (sin rutas).');
    const configured = Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
    const secure = origin.startsWith('https:');
    const cookieName = secure ? '__Host-timmy' : 'timmy_dev';
    const sessions = new ExpiringCache(3600000, 2000);
    const limits = new ExpiringCache(60000, 5000);
    const cleanup = setInterval(() => {
        for (const [key, item] of sessions.items) {
            if (item.expires <= Date.now() || (item.value.expires && item.value.expires <= Date.now())) sessions.delete(key);
        }
    }, 30000); cleanup.unref();
    const resolveAvatar = createAvatarResolver(client);
    const assets = new Map(['style.css', 'theme.css', 'community.css', 'dashboard.css', 'refresh.css', 'app.js', 'manifest.webmanifest', 'timmy-icon.svg', 'sw.js'].map(file => ['/' + file, fs.readFileSync(path.join(__dirname, '../web', file))]));
    const cookie = (value, age = 3600) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const sessionId = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const reply = (res, status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    const redirect = (res, dest) => { res.writeHead(303, { Location: dest }); res.end(); };
    async function discord(endpoint, token, options = {}) {
        let response;
        try {
            response = await fetchImpl(`https://discord.com/api/${endpoint}`, { ...options, signal: AbortSignal.timeout(12000),
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
        } catch { throw new WebError(503, 'Discord no respondió. Inténtalo de nuevo en unos momentos.'); }
        if (!response.ok) throw new WebError(response.status === 401 ? 401 : 503, response.status === 401 ? 'Tu acceso expiró. Vuelve a iniciar sesión.' : 'No se pudo verificar tu acceso con Discord. Inténtalo de nuevo.');
        return response.json();
    }
    async function userGuilds(session) {
        const list = await discord('v10/users/@me/guilds?limit=200', session.token);
        return list.filter(g => client.guilds.cache.has(g.id) && (g.owner || (BigInt(g.permissions || '0') & P.Administrator) !== 0n));
    }
    async function authorisedGuild(session, guildId) {
        const list = await userGuilds(session);
        if (!list.some(g => g.id === guildId)) throw new WebError(403, 'Necesitas ser dueño o tener Administrador en este servidor.');
        let guild, member;
        try {
            guild = await client.guilds.cache.get(guildId).fetch();
            await guild.roles.fetch();
            member = await guild.members.fetch({ user: session.user.id, force: true });
        } catch { throw new WebError(403, 'No se pudo confirmar tu acceso actual a este servidor.'); }
        if (!isAdmin(member, guild)) throw new WebError(403, 'Ya no tienes permiso de administrador en este servidor.');
        return guild;
    }
    async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self' https://accounts.spotify.com; frame-ancestors 'none'; base-uri 'none'");
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
        let sid = sessionId(req), session = sessions.get(sid);
        try {
            const url = new URL(req.url, origin);
            const route = url.pathname;
            if(route===TEST_PATH&&['GET','HEAD'].includes(req.method)&&env.LAVALINK_HOST){
                diagnosticTone ||= toneWav();
                res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':diagnosticTone.length,'Cache-Control':'public, max-age=3600'});
                res.end(req.method==='HEAD'?undefined:diagnosticTone);return;
            }
            if (!['GET', 'POST'].includes(req.method)) throw new WebError(405, 'Método no permitido.');
            const image=route.match(/^\/imagenes\/(\d{17,20})\/([a-f0-9]{64}\.(png|jpeg|webp|gif))$/);
            if (req.method==='GET' && image) {
                const file=path.join(store.directory,'imagenes',image[1],image[2]);
                if (!fs.existsSync(file)) throw new WebError(404,'Imagen no encontrada.');
                res.writeHead(200,{'Content-Type':'image/'+image[3]}); fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res); return;
            }
            if (route === '/healthz') { res.writeHead(client.isReady() ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ready: client.isReady() })); return; }
            if (req.method === 'GET' && assets.has(route)) { res.writeHead(200, { 'Content-Type': route.endsWith('.css') ? 'text/css; charset=utf-8' : route.endsWith('.webmanifest') ? 'application/manifest+json' : route.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript; charset=utf-8' }); res.end(assets.get(route)); return; }
            // No se confía en un X-Forwarded-For enviado por el visitante.
            const bucket = session ? sid : req.socket.remoteAddress;
            let rate = limits.get(bucket);
            if (!rate) { rate = { count: 0 }; limits.set(bucket, rate); }
            if (++rate.count > 120) throw new WebError(429, 'Demasiadas solicitudes. Espera un minuto.');
            if (req.method==='GET' && route==='/bot-avatar') {
                const avatar=await resolveAvatar();
                if(avatar) return redirect(res,avatar);
                res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8'});
                res.end(placeholder);return;
            }
            if (req.method === 'GET' && route === '/panel/sesion') {
                if (!session?.user || session.expires <= Date.now()) throw new WebError(401, 'Tu sesión expiró. Inicia sesión de nuevo.');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ user: session.user.id, csrf: session.csrf }));
                return;
            }
            const panelGuild = route.match(/^\/servers\/(\d{17,20})\/panel$/)?.[1];
            if (req.method === 'POST') {
                const source = req.headers.origin;
                const sameOriginForm = (!source || source === 'null') && req.headers['sec-fetch-site'] === 'same-origin';
                if (source !== origin && !sameOriginForm) throw new WebError(403, 'Abre el panel desde su enlace oficial y vuelve a guardar.');
                if (!session?.user || session.expires <= Date.now()) throw new WebError(401, 'Tu sesión expiró. Inicia sesión de nuevo.');
                if (!panelGuild && !['/logout','/musica/spotify','/musica/spotify/quitar','/roblox','/roblox/quitar'].includes(route)) throw new WebError(403,'Solicitud no válida.');
                if(panelGuild&&url.searchParams.has('musicUpload')){
                    if(!music?.legacyLocal)throw new WebError(403,'Las cargas de audio están desactivadas. Usa enlaces en Discord.');
                    if(!music?.library?.managed||!client.isReady())throw new WebError(503,'Biblioteca no disponible.');
                    if(!equal(req.headers['x-csrf-token'],session.csrf))throw new WebError(403,'Sesión inválida.');
                    const verify=async()=>{
                        if(session.expires<=Date.now()||sessions.get(sid)!==session||!await isBotOwner(client,session.user.id))throw new WebError(403,'Solo el propietario de la aplicación de Discord puede administrar la biblioteca.');
                        await authorisedGuild(session,panelGuild);
                    };
                    await verify();
                    if(req.headers['content-type']!=='application/octet-stream')throw new WebError(400,'Formato de solicitud inválido.');
                    let input;try{const value=req.headers['x-music-meta'];if(typeof value!=='string'||value.length>6000)throw Error();input=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(!input||typeof input!=='object')throw Error();}catch{throw new UserError('Metadatos inválidos.');}
                    let result;
                    if(url.searchParams.get('musicUpload')==='audio')result=await music.library.managed.upload(req,input,verify);
                    else if(url.searchParams.get('musicUpload')==='cover'){if(input.confirm!=='yes')throw new UserError('Confirma el permiso para utilizar la portada.');await music.library.managed.uploadCover(req,input.id,verify);}
                    else throw new WebError(400,'Carga inválida.');
                    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:result||input.id}));return;
                }
                if (panelGuild && url.searchParams.has('imagen')) {
                    if (!equal(req.headers['x-csrf-token'],session.csrf)) throw new WebError(403,'Sesión inválida.');
                    await authorisedGuild(session,panelGuild);
                    let bytes=0; const parts=[];
                    for await (const chunk of req) { bytes+=chunk.length; if(bytes>4*1024*1024) throw new WebError(413,'La imagen supera 4 MB.'); parts.push(chunk); }
                    const data=Buffer.concat(parts), hex=data.subarray(0,12).toString('hex');
                    const ext=hex.startsWith('89504e470d0a1a0a')?'png':hex.startsWith('ffd8ff')?'jpeg':/^474946383[79]61/.test(hex)?'gif':/^52494646.{8}57454250/.test(hex)?'webp':null;
                    if (!ext) throw new WebError(400,'Usa una imagen PNG, JPG, GIF o WebP.');
                    const dir=path.join(store.directory,'imagenes',panelGuild), name=createHash('sha256').update(data).digest('hex')+'.'+ext;
                    fs.mkdirSync(dir,{recursive:true});
                    if (!fs.existsSync(path.join(dir,name))) {
                        if (fs.readdirSync(dir).length>=100) throw new WebError(400,'Este servidor ya guardó 100 imágenes. Puedes usar una URL.');
                        fs.writeFileSync(path.join(dir,name),data);
                    }
                    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({url:origin+'/imagenes/'+panelGuild+'/'+name})); return;
                }
                let size=0; const chunks=[];
                for await (const chunk of req) { size+=chunk.length; if (size>100000) throw new WebError(413,'Solicitud demasiado grande.'); chunks.push(chunk); }
                const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
                if (!equal(form.get('csrf'), session.csrf)) throw new WebError(403, 'Solicitud no válida.');
                if (panelGuild) {
                    if (!client.isReady()) throw new WebError(503,'Timmy se está conectando.');
                    const guild=await authorisedGuild(session,panelGuild);
                    const member=await guild.members.fetch({user:session.user.id,force:true});
                    if (!isAdmin(member,guild)) throw new WebError(403,'Necesitas Administrador.');
                    if(form.get('section')==='voiceMaster'){if(!voiceMaster)throw new WebError(503,'Módulo no disponible.');await voiceMaster.configure(guild,member,form);return redirect(res,route+'?seccion=voiceMaster');}
                    if(form.get('section')==='social'){if(member.id!==guild.ownerId)throw new WebError(403,'Solo el dueño configura Social Center.');store.patchGuild(guild.id,{socialEnabled:form.has('enabled')});return redirect(res,route+'?seccion=social');}
                    if(['responders','volunteer','starboard'].includes(form.get('section'))){if(!communityExpansion)throw new WebError(503,'Módulo no disponible.');await communityExpansion.save(guild,member,form);return redirect(res,route+'?seccion='+form.get('section'));}
                    if(['securityPlus','cases','delegation'].includes(form.get('section'))){
                        if(!security)throw new WebError(503,'Módulo no disponible.');
                        const section=form.get('section');
                        if(section==='securityPlus')await security.configure(guild,member,form);
                        else if(section==='delegation')await security.delegate(guild,member,form);
                        else if(['evidence','accept','reject'].includes(form.get('action')))security.change(guild.id,form.get('id'),member.id,form.get('action'),String(form.get('value')||''));
                        else throw new UserError('Acción inválida.');
                        return redirect(res,route+'?seccion='+section);
                    }
                    if(form.get('section')==='public-page'){publicCenter.save(store,guild,member,form);const dest=route+'?seccion=public-page&guardado=1';if(req.headers.accept==='application/json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({dest}));return;}return redirect(res,dest);}
                    if(form.get('section')==='music-library'){
                        if(!music?.legacyLocal)throw new WebError(403,'La biblioteca local está desactivada.');
                        if(!music?.library?.managed||!await isBotOwner(client,session.user.id))throw new WebError(403,'Solo el propietario de la aplicación de Discord puede administrar la biblioteca.');
                        music.library.managed.change(form.get('action'),Object.fromEntries(form),new Set(music.library.list().map(t=>t.id)));
                        return redirect(res,route+'?seccion=music');
                    }
                    if(form.get('section')==='music'){
                        if(!music)throw new WebError(503,'Reproductor no disponible.');
                        const s=music.sessions.get(guild.id);
                        if(!s?.text||s.text.guild?.id!==guild.id||!s.text.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]))throw new WebError(403,'Abre una sesión musical desde Discord y verifica el acceso al canal.');
                        await music.webAction({guild,member,user:member.user||{id:member.id},channel:s.text},form.get('action'),form.get('value'));
                        return redirect(res,route+'?seccion=music');
                    }
                    if(form.get('intent')==='custom-test') {
                        if(form.get('section')!=='custom')throw new UserError('Sección inválida.');
                        const item=validateCustom(form.get('name'),form.get('type'),form.get('copy'),form.get('minutes'),definitions);
                        res.writeHead(200,{'Content-Type':'application/json'});
                        res.end(JSON.stringify(simulateCustom(item,store.guild(guild.id).prefix)));return;
                    }
                    if(form.get('intent')==='custom-draft') {
                        if(form.get('section')!=='custom'||!store.guild(guild.id).ai||!ai?.customDraft) throw new UserError('IA no disponible en este servidor.');
                        const generated=await ai.customDraft(member.id,String(form.get('prompt')||''));
                        const draft=validateCustom(generated?.name,generated?.type,generated?.text,generated?.minutes,definitions);
                        // Generation may take time: verify the administrator again before displaying.
                        await authorisedGuild(session,panelGuild);
                        return reply(res,200,layout(tabs.custom,settingsView({guild,cfg:store.guild(guild.id),section:'custom',session,url,rewards,draft,music}),session));
                    }
                    if (form.get('intent')==='test') {
                        await testMessage({form,guild,member,cfg:store.guild(guild.id)});
                        res.writeHead(204); res.end(); return;
                    }
                    await saveSettings({form,guild,member,store,rewards,community,birthdays,definitions});
                    const dest = route + '?seccion=' + encodeURIComponent(form.get('section')) + '&guardado=1';
                    if (req.headers.accept === 'application/json') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ dest }));
                        return;
                    }
                    return redirect(res, dest);
                }
                if(route==='/roblox/quitar'){if(!roblox)throw new WebError(503,'Roblox no disponible.');roblox.unlink(session.user.id);delete session.roblox;delete session.robloxInFlight;return redirect(res,'/roblox');}
                if(route==='/roblox'){if(!roblox?.ready())throw new WebError(503,'Roblox OAuth no configurado.');const request=roblox.begin(origin,session.user.id);delete session.robloxInFlight;session.roblox=request.pending;return redirect(res,request.url);}
                if (route==='/musica/spotify/quitar') { await catalog.unlink(session.user.id); return redirect(res,'/musica/spotify'); }
                if (route==='/musica/spotify') {
                    session.spotify={state:random(),at:Date.now()};
                    return redirect(res,catalog.connectURL(origin,session.spotify.state));
                }
                sessions.delete(sid); res.setHeader('Set-Cookie',cookie('',0)); return redirect(res,'/');
            }
            if(route==='/roblox'||route==='/roblox/callback'){
                if(!session?.user||session.expires<=Date.now())return redirect(res,'/auth/login?roblox=1');
                if(!roblox)throw new WebError(503,'Roblox no disponible.');
                if(route.endsWith('/callback')){
                    const pending=session.roblox;delete session.roblox;
                    const flight=random();session.robloxInFlight=flight;
                    try{await roblox.connect(origin,session.user.id,pending,url.searchParams.get('state'),url.searchParams.get('code'),async()=>{
                        if(sessions.get(sid)!==session||session.expires<=Date.now()||session.roblox||session.robloxInFlight!==flight)throw new WebError(403,'La sesión cambió. Vuelve a iniciar.');
                    });}finally{if(session.robloxInFlight===flight)delete session.robloxInFlight;}
                    return redirect(res,'/roblox');
                }
                const linked=roblox.linked(session.user.id),ready=roblox.ready();
                return reply(res,200,layout('Roblox','<section class="plain"><h1>Tu cuenta Roblox</h1><p>Vinculación voluntaria de identidad mediante OAuth oficial. Guardamos tu ID de Roblox y la fecha, no contraseñas ni tokens. No entrega roles automáticamente.</p>'+(linked?'<p>Vinculado: '+escape(linked.roblox)+'</p>':'')+(linked||ready?'<form method="post" action="/roblox'+(linked?'/quitar':'')+'"><input type="hidden" name="csrf" value="'+escape(session.csrf)+'"><button class="button">'+(linked?'Desvincular':'Vincular Roblox')+'</button></form>':'<p>El propietario debe configurar Roblox OAuth.</p>')+'</section>',session));
            }
            if (route==='/musica/spotify' || route==='/musica/spotify/callback') {
                if (!session?.user || session.expires<=Date.now()) return redirect(res,'/auth/login?musica=1');
                if (!catalog?.ready()) throw new WebError(503,'El equipo debe configurar las credenciales de Spotify en Railway.');
                if (route.endsWith('/callback')) {
                    const pending=session.spotify; delete session.spotify;
                    if (!pending || Date.now()-pending.at>600000 || !equal(pending.state,url.searchParams.get('state'))) throw new WebError(403,'Vuelve a iniciar la vinculación de Spotify.');
                    const code=url.searchParams.get('code');
                    if (!code || code.length>2048) throw new WebError(400,'La vinculación fue cancelada.');
                    await catalog.connect(session.user.id,code,origin);
                    return redirect(res,'/musica/spotify');
                }
                const linked=catalog.linked(session.user.id);
                const csrf='<input type="hidden" name="csrf" value="'+escape(session.csrf)+'">';
                const linkForm='<form method="post" action="/musica/spotify">'+csrf+'<button class="button">'+(linked?'Actualizar permisos':'Vincular Spotify')+'</button></form>';
                const unlinkForm=linked?'<form method="post" action="/musica/spotify/quitar">'+csrf+'<button class="quiet">Desvincular Spotify</button></form>':'';
                return reply(res,200,layout('Spotify','<section class="plain"><h1>Tu Spotify</h1><p>'+(linked?'Tu cuenta está vinculada. ':'')+
                    'El botón «Reproducir en mi Spotify» inicia la música en tu dispositivo activo. Necesitas Spotify Premium para este control. Puedes abrir los enlaces directamente sin vincular tu cuenta.</p>'+linkForm+unlinkForm+'</section>',session));
            }
            if(route==='/status'||route==='/status.json'){
                const s=publicCenter.status(client);
                if(route.endsWith('.json')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(s));return;}
                return reply(res,200,layout('Estado','<section class="plain tm-status-page"><span class="eyebrow">TIMMY MAX / ESTADO</span><h1>Estado de Timmy</h1><p>Información de la instancia actual del bot.</p><div class="tm-status-head"><span class="tm-status-dot '+(s.ready?'is-ready':'')+'" aria-hidden="true"></span><div><strong>Discord: '+(s.ready?'Conectado':'No disponible')+'</strong><p>Conexión gateway</p></div><a class="button" href="/status">Actualizar</a></div><div class="tm-status-metrics"><article><span>Latencia gateway</span><strong>'+escape(s.ping??'—')+' <small>ms</small></strong></article><article><span>Tiempo activo del proceso</span><strong>'+escape(Math.floor(s.uptimeSeconds/3600))+' h '+escape(Math.floor(s.uptimeSeconds%3600/60))+' min</strong></article><article><span>Servidores</span><strong>'+escape(s.servers??'—')+'</strong></article></div><p class="tm-status-note">Esta página no verifica Supabase ni proveedores de música. Los datos corresponden al momento de la consulta.</p><a href="/support" class="text-button">Contactar con soporte →</a></section>',session,configured));
            }
            const publicGuild=route.match(/^\/community\/(\d{17,20})$/)?.[1];
            if(publicGuild){
                const g=client.isReady()&&client.guilds.cache.get(publicGuild);
                const cfg=g&&store.data.guilds[publicGuild],body=cfg&&publicCenter.page(cfg,g,escape);
                if(!body)throw new WebError(404,'Comunidad no publicada.');
                return reply(res,200,layout('Comunidad',body,null,configured));
            }
            if(route==='/updates'){
                const notes=require('./official-release.json'),sha=require('./official-runtime').deployment(env);
                return reply(res,200,layout('Novedades','<section class="plain tm-release-page"><span class="eyebrow">TIMMY MAX / CHANGELOG</span><h1>Últimas novedades documentadas</h1><p>Notas incluidas en esta versión del sitio. No certifican la disponibilidad de todos los módulos.</p><div class="tm-release-card"><h2>Nuevas funciones</h2><ul>'+notes.features.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul></div><div class="tm-release-card"><h2>Mejoras</h2><ul>'+notes.fixes.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul></div>'+(sha?'<p>Revisión instalada: '+sha.slice(0,12)+'</p>':'')+'<a href="/support">Comunidad oficial</a></section>',session,configured));
            }
            if(route==='/support')return reply(res,200,layout('Soporte oficial','<section class="plain tm-support-page"><span class="eyebrow">TIMMY MAX / COMUNIDAD OFICIAL</span><h1>¿Necesitas ayuda?</h1><p>Encuentra guías, actualizaciones, sugerencias y soporte en el Discord oficial de Timmy Max.</p><div class="tm-actions"><a class="button primary" href="'+official.INVITE+'" rel="noopener noreferrer">Unirse al servidor oficial ↗</a><a class="button" href="/commands">Directorio de comandos</a><a class="button" href="/guia">Guía de configuración</a></div><div class="tm-support-grid"><a href="/guia#inicio"><strong>Primeros pasos</strong><span>Instala y configura Timmy.</span></a><a href="/guia#errores"><strong>Solución de problemas</strong><span>Consulta errores frecuentes.</span></a><a href="/status"><strong>Estado del servicio</strong><span>Comprueba la conexión del bot.</span></a></div><p class="tm-status-note">No compartas tokens, contraseñas ni información privada.</p></section>',session,configured));
            if(route==='/commands'){
                const defs=official.publicDefinitions(definitions||[]),groups=official.categories(defs);
                return reply(res,200,layout('Comandos públicos','<section class="plain"><span class="eyebrow">TIMMY MAX / DOCUMENTACIÓN</span><h1>Directorio de comandos</h1><p>Comandos de uso general del código instalado. La disponibilidad depende del servidor y de tus permisos. Los comandos administrativos se consultan desde el panel privado.</p><div class="tm-actions"><a class="button" href="/support">Soporte oficial</a><a class="button" href="/servers">Panel privado</a></div>'+groups.map(group=>'<h2>'+escape(group)+'</h2><div class="commands">'+defs.filter(d=>d.category===group).map(d=>commandCard(d,'>')).join('')+'</div>').join('')+'</section>',session,configured));
            }
            if (route === '/invite') {
                const target = inviteURL(env);
                if (!target) throw new WebError(503, 'La invitación de Timmy no está configurada.');
                return redirect(res,target);
            }
            if (route === '/') return reply(res, 200, landing(configured, client, Boolean(inviteURL(env)), session?.expires > Date.now() ? session : null));
            if (route === '/guia') return reply(res, 200, layout('Guía rápida', guideContent(), session, configured));
            if (route === '/privacy') return reply(res, 200, layout('Privacidad', '<section class="plain"><span class="eyebrow">TU ACCESO</span><h1>Privacidad.</h1><p>El inicio de sesión solicita tu identidad básica de Discord y la lista de servidores para comprobar dónde eres administrador. No solicita tu correo ni acceso a tus mensajes privados.</p><p>La sesión y el token OAuth se guardan en memoria, como máximo una hora; se pierden al reiniciar. El navegador recibe una cookie de sesión HttpOnly. Al salir se elimina el acceso local. Puedes revocar la autorización en Discord, Ajustes → Aplicaciones autorizadas.</p><p>El panel permite al dueño y a sus administradores editar los mensajes, los beneficios y la XP de su servidor. Si registras tu cumpleaños, Timmy guarda solo el día y el mes. Si vinculas Spotify, Timmy conserva una autorización cifrada para tus playlists hasta que la retires. No publica conversaciones, pruebas ni transcripciones de tickets. Roblox OAuth guarda solo el ID vinculado y fecha; puedes desvincular en /roblox. El traductor y el soporte de IA envían únicamente tu consulta explícita a Gemini. La información que añadas a la IA se envía a Gemini al atender consultas de ese servidor.</p><p>Si adjuntas fotos en un DM, al mencionar a Timmy o al usar ask, Gemini las recibe junto con tu pregunta. El historial de IA de Timmy conserva el texto de la conversación, incluida su respuesta sobre las fotos.</p><p>Si se activan los niveles, Timmy guarda por servidor tu ID, XP y la hora del último mensaje que puntuó. Con boosts activos, recuerda las recompensas que entrega. Las solicitudes de verificación son privadas y su transcripción se conserva en el volumen del servidor al cerrar el ticket.</p><a class="button" href="/">Volver</a></section>', session));
            if (route === '/auth/login') {
                if (!configured) throw new WebError(503, 'El propietario del bot debe completar OAuth2 en Railway.');
                if (sid) sessions.delete(sid);
                sid = random(); session = { csrf: random(), pending: { state: random(), verifier: random(), at: Date.now(), panel: url.searchParams.get('panel') === '1', music: url.searchParams.get('musica') === '1', roblox: url.searchParams.get('roblox') === '1', guild: id(url.searchParams.get('guild')) ? url.searchParams.get('guild') : null } };
                sessions.set(sid, session); res.setHeader('Set-Cookie', cookie(sid));
                const auth = new URL('https://discord.com/oauth2/authorize');
                auth.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: origin + '/auth/callback', scope: 'identify guilds', state: session.pending.state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(session.pending.verifier).digest('base64url') }).toString();
                redirect(res, auth.toString()); return;
            }
            if (route === '/auth/callback') {
                const pending = session?.pending;
                if (!pending || Date.now() - pending.at > 5 * 60000 || !equal(pending.state, url.searchParams.get('state'))) throw new WebError(403, 'La verificación de acceso expiró o no coincide. Inicia sesión otra vez.');
                delete session.pending;
                if (url.searchParams.has('error')) throw new WebError(403, 'Se canceló el inicio de sesión.');
                const code = url.searchParams.get('code');
                if (!code || code.length > 2048) throw new WebError(400, 'Falta el código de acceso.');
                const token = await discord('oauth2/token', null, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: origin + '/auth/callback' }).toString() });
                if (!token.access_token || !token.scope?.split(' ').includes('guilds')) throw new WebError(403, 'Autoriza identidad y servidores para continuar.');
                const user = await discord('v10/users/@me', token.access_token);
                if (!id(user.id)) throw new WebError(403, 'Discord no devolvió una identidad válida.');
                sessions.delete(sid); sid = random();
                session = { user: { id: user.id, username: user.username }, token: token.access_token, csrf: random(), expires: Date.now() + Math.min(Number(token.expires_in) || 3600, 3600) * 1000 };
                sessions.set(sid, session); res.setHeader('Set-Cookie', cookie(sid));
                redirect(res, pending.roblox ? '/roblox' : pending.music ? '/musica/spotify' : pending.guild ? `/servers/${pending.guild}${pending.panel ? '/panel' : ''}` : '/servers'); return;
            }
            const selected = panelGuild || route.match(/^\/servers\/(\d{17,20})$/)?.[1];
            if (route !== '/servers' && !selected) throw new WebError(404, 'Esta página no existe.');
            if (!session?.user || session.expires <= Date.now()) {
                if (sid) sessions.delete(sid);
                redirect(res, '/auth/login' + (selected ? `?guild=${selected}${panelGuild ? '&panel=1' : ''}` : '')); return;
            }
            if (!client.isReady()) throw new WebError(503, 'El bot se está conectando. Vuelve en unos momentos.');
            if (selected) {
                const guild = await authorisedGuild(session, selected);
                if (panelGuild) {
                    const section=url.searchParams.get('seccion') || 'welcome';
                    if (!Object.hasOwn(tabs,section)) throw new WebError(404,'Sección no encontrada.');
                    if(section==='music'&&url.searchParams.has('musicCover')){
                        if(!music?.legacyLocal)throw new WebError(404,'Portada no disponible.');
                        const file=music?.library?.managed?.cover(url.searchParams.get('musicCover'));
                        if(!file)throw new WebError(404,'Portada no disponible.');
                        res.writeHead(200,{'Content-Type':'image/jpeg'});fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;
                    }
                    const musicOwner=section==='music'&&Boolean(music?.legacyLocal&&music?.library?.managed)&&await isBotOwner(client,session.user.id);
                    res.setHeader('Referrer-Policy', 'same-origin');
                    return reply(res,200,layout(tabs[section],settingsView({guild,cfg:store.guild(guild.id),section,session,url,rewards,music,musicOwner,security,communityExpansion}),session));
                }
                return reply(res, 200, serverPage(guild, store.guild(guild.id), definitions, session, store, client));
            }
            const guilds = await userGuilds(session);
            reply(res, 200, serversPage(guilds, session, client, Boolean(inviteURL(env))));
        } catch (error) {
            const status = error instanceof WebError ? error.status : error instanceof UserError ? 400 : 500;
            if (status === 401 && session?.user) { sessions.delete(sid); res.setHeader('Set-Cookie', cookie('', 0)); }
            // No registra URLs de callback, códigos OAuth, tokens ni secretos.
            console.warn('[WEB]', status, error instanceof WebError ? 'Acceso no completado' : error.name);
            if (!res.headersSent && req.headers.accept === 'application/json') {
                const message = error instanceof WebError || error instanceof UserError ? error.message : 'No se pudo guardar. Vuelve a intentarlo.';
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message }));
                return;
            }
            if (!res.headersSent) reply(res, status, layout('Revisa tu acceso', `<section class="plain"><span class="eyebrow">${status}</span><h1>No pudimos abrir esta página.</h1><p class="lead">${escape(error instanceof WebError || error instanceof UserError ? error.message : 'Ocurrió un error. Inténtalo de nuevo más tarde.')}</p><a class="button" href="/">Volver al inicio</a> <a class="text-button" href="/auth/login">Cambiar de cuenta</a></section>`, session?.user ? session : null));
            else res.end();
        }
    }
    const server = http.createServer((req, res) => { handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
    server.requestTimeout = 30000; server.headersTimeout = 15000;
    return { server, async listen(port = 8080) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); }); return server.address(); }, async close() { clearInterval(cleanup); sessions.items.clear(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { createWeb, publicOrigin, layout, landing, serverPage };
