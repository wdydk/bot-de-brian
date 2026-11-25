'use strict';
require('dotenv').config({ quiet: true });
const path = require('node:path');
const {
    Client, GatewayIntentBits: I, Partials, EmbedBuilder, ActivityType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder, MessageFlags
} = require('discord.js');
const { UserError, cut, idOf, integer, duration, tokenize, render, ExpiringCache, knowledgeText, updateKnowledge } = require('./src/core');
const { P, requirePermission, requireHierarchy, safeRole } = require('./src/permissions');
const { isAdmin, canUse, canShow, BASIC } = require('./src/access');
const { Rewards, boostTypes, installRewards } = require('./src/rewards');
const { Birthdays } = require('./src/birthdays');
const { BoosterRoles, instructions: roleInstructions } = require('./src/booster-roles');
const { intake } = require('./src/ticket-intake');
const { Giveaways } = require('./src/giveaways');
const { parsePublication } = require('./src/giveaway-request');
const { Verification } = require('./src/verification');
const { Protection } = require('./src/protection');
const { communitySetup } = require('./src/community-setup');
const { topicOf, communityAnswer, accessLabel } = require('./src/community-help');
const { installSetup } = require('./src/setup');
const { moderationTopic, banAdvice, autoModInfo } = require('./src/moderation');
const { installAccess, accessArguments, guardCommunityRole, guardEarnedRole, guardSelfAssignable } = require('./src/delegation');
const { EmojiPack, emojiChoice, catalog } = require('./src/emojis');
const { parseRequest, saveRequest, removeMemory, listMemory, matchingRule } = require('./src/memory');
const { Music, generateDependencyReport } = require('./src/music');
const { Assistant } = require('./src/ai');
const { Tickets } = require('./src/tickets');
const { Studio } = require('./src/studio');
const { installDesignCommands, sendGreeting } = require('./src/design-commands');

const { openStore } = require('./src/persistence');
const { rank, policyOf, savePolicy, installAudit } = require('./src/staff-policy');
const { validateCustom, saveCustom } = require('./src/custom-commands');
const { randomInt } = require('node:crypto');

function buildBot({ store, client, ai } = {}) {
    store ||= openStore(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data'), {
        onFailure: error => {
            console.error('[PERSISTENCIA] Escritura no confirmada; se detiene Timmy para proteger los datos.');
            // Remote errors are sanitized by the persistence adapter. Other errors may contain paths.
            if (typeof error?.message === 'string' && /^Supabase \[(lectura|escritura)\]/.test(error.message)) console.error(error.message);
            if (require.main === module) process.exit(1);
            throw error;
        }
    });
    client ||= new Client({
        intents: [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent,
            I.GuildPresences, I.GuildVoiceStates, I.DirectMessages, I.GuildModeration, I.GuildMessageReactions],
        partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction],
        allowedMentions: { parse: [], repliedUser: false }
    });
    ai ||= new Assistant();
    const emojis = new EmojiPack(client);
    const banPrompts = new ExpiringCache(120000, 1000);
    const moderationChats = new ExpiringCache(5 * 60000, 1000);
    const replyCooldown = new ExpiringCache(5000, 5000);
    const music = new Music(client, store);
    const snipes = new ExpiringCache(5 * 60000, 1000);
    const edits = new ExpiringCache(5 * 60000, 1000);
    const cooldown = new ExpiringCache(1500, 10000);
    const reactionCooldown = new ExpiringCache(5000, 5000);
    const spam = new ExpiringCache(8000, 5000);
    const autoSanctions = new ExpiringCache(60000, 1000);
    const commands = new Map();
    const aliases = new Map();
    const definitions = [];
    const {OfficialRuntime}=require('./src/official-runtime');
    const officialRuntime=new OfficialRuntime({client,store,music,ai,defs:definitions,origin:require('./src/web').publicOrigin(process.env)});
    let stopping = false;
    let webServer = null;

    const embed = (title, text) => new EmbedBuilder().setColor(0x7c83ff).setTitle(cut(title, 256)).setDescription(cut(text, 4000));
    async function log(guild, title, text) {
        const id = store.guild(guild.id).logChannel;
        if (!id) return;
        try {
            const channel = await guild.channels.fetch(id);
            if (channel?.isTextBased()) await channel.send({ embeds: [embed(title, text).setTimestamp()] });
        } catch (error) { console.error('[LOG]', error.code || error.name); }
    }
    const tickets = new Tickets(client, store, log);
    const studio = new Studio();
    const giveaways = new Giveaways(store, client, studio);
    const rewards = new Rewards(store, log);
    const boosterRoles = new BoosterRoles(store);
    const birthdays = new Birthdays(store,client);
    const verification = new Verification(store, tickets, log);
    const protection = new Protection(store, log, assignWelcomeRole);
    const roblox=new (require('./src/roblox-integration').Roblox)(store);
    const utilityCenter=new (require('./src/utility-center').UtilityCenter)(ai);
    const voiceMaster=new (require('./src/voice-master').VoiceMaster)(store);
    const socialCenter=new (require('./src/social-center').SocialCenter)(store);
    client.on('voiceStateUpdate',(old,next)=>voiceMaster.update(old,next).catch(e=>console.warn('[VOICE MASTER]',e.code||e.name)));
    const communityExpansion=new (require('./src/community-expansion').CommunityExpansion)(store);
    client.on('messageReactionAdd',(reaction,user)=>communityExpansion.reaction(reaction,user).catch(e=>console.warn('[COMMUNITY REACTION]',e.code||e.name)));
    const security=new (require('./src/security-expansion').SecurityExpansion)(store,log);
    client.on('guildAuditLogEntryCreate',(entry,guild)=>security.audit(entry,guild,client.user?.id).catch(e=>console.warn('[ANTI NUKE]',e.code||e.name)));
    const community = communitySetup({ store, rewards, verification, protection, getChannel, getRole, setSnipe });
    function add(name, description, usage, options, handler) {
        const def = { name, description, usage, guild: options.guild !== false,
            permission: options.permission, adminOnly: Boolean(options.adminOnly || options.category === 'Configuración'),
            private: Boolean(options.private), raw: Boolean(options.raw), handler, category: options.category || 'Utilidades',
            params: options.params || [], aliases: options.aliases || [] };
        definitions.push(def); commands.set(name, def);
        for (const alias of def.aliases) aliases.set(alias, name);
    }
    const textParam = (name, description, required = true) => ({ type: 3, name, description, required });
    const userParam = (name = 'usuario', required = true) => ({ type: 6, name, description: 'Miembro del servidor', required });
    const numParam = (name, description, min, max, required = true) => ({ type: 4, name, description, min_value: min, max_value: max, required });
    const optConfig = (permission = P.ManageGuild) => ({ permission, private: true, category: 'Configuración', params: [textParam('opciones', 'Opciones según >help. Admite menciones y IDs.')] });
    async function getMember(ctx, input = ctx.user.id, fresh = false) {
        const id = idOf(input);
        return ctx.guild.members.fetch(fresh ? { user: id, force: true } : id).catch(() => { throw new UserError('No encontré ese miembro en este servidor.'); });
    }
    async function getChannel(ctx, input, category = false) {
        const channel = await ctx.guild.channels.fetch(idOf(input)).catch(() => null);
        if (!channel || (category ? channel.type !== ChannelType.GuildCategory : channel.type !== ChannelType.GuildText)) {
            throw new UserError(category ? 'Indica el ID de una categoría.' : 'Indica un canal de texto con #canal o su ID.');
        }
        if (!category && !channel.permissionsFor(ctx.member)?.has([P.ViewChannel, P.SendMessages])) throw new UserError('No tienes acceso para escribir en ese canal.');
        return channel;
    }
    async function getRole(ctx, input, force = false) {
        const role = await ctx.guild.roles.fetch(idOf(input), { force }).catch(() => null);
        if (!role) throw new UserError('No encontré ese rol.');
        return role;
    }
    async function setLogChannel(ctx, input) {
        let id = null;
        if (input !== 'off') {
            const channel = await getChannel(ctx, input);
            const me = await ctx.guild.members.fetchMe();
            if (channel.guildId !== ctx.guild.id || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
                throw new UserError('Para guardar registros aquí, Timmy necesita Ver canal, Enviar mensajes e Insertar enlaces en el canal elegido.');
            }
            id = channel.id;
        }
        store.patchGuild(ctx.guild.id, { logChannel: id });
    }
    async function botPermission(ctx, permission) {
        if (permission === P.BanMembers) {
            const me = await ctx.guild.members.fetchMe({ force: true });
            if (!me.permissions.has(P.BanMembers)) throw new UserError('A Timmy le falta el permiso Banear miembros en este servidor.');
            return me;
        }
        const me = await ctx.guild.members.fetchMe();
        const perms = ctx.channel?.permissionsFor?.(me) || me.permissions;
        if (!perms.has(permission)) throw new UserError('Al bot le falta el permiso necesario para esta acción.');
        return me;
    }
    async function modTarget(ctx, input, permission) {
        if (permission === P.BanMembers) requireBansEnabled(ctx.guild);
        const target = await getMember(ctx, input, Boolean(ctx.source));
        const me = await botPermission(ctx, permission);
        requireHierarchy(ctx.member, target, me);
        if (!ctx.member.permissions.has(permission) && !isAdmin(ctx.member, ctx.guild) && isAdmin(target, ctx.guild)) {
            throw new UserError('Los permisos delegados no permiten moderar a un administrador.');
        }
        return target;
    }
    function checkStaff(member) { return isAdmin(member) || member.permissions.has(P.ManageMessages) || member.permissions.has(P.ModerateMembers); }
    const aiKey = ctx => `${ctx.guild?.id || 'dm'}:${ctx.channel.id}:${ctx.user.id}:${ctx.guild ? store.guild(ctx.guild.id).knowledgeRevision : 0}`;
    async function remember(ctx, request) {
        if (!ctx.guild) throw new UserError('Las notas y reglas compartidas se configuran dentro de su servidor.');
        if (ctx.source) ctx.member = await ctx.guild.members.fetch({ user: ctx.user.id, force: true });
        if (!isAdmin(ctx.member, ctx.guild)) throw new UserError('Solo el dueño o un administrador puede guardar reglas y notas para este servidor.');
        return ctx.reply(saveRequest(store, ctx.guild.id, request));
    }
    async function applyRule(rule, ctx) {
        if (rule.response) await ctx.reply(render(rule.response, ctx.member));
        if (rule.reaction) {
            const icon = emojis.resolve(rule.reaction, true);
            if (!ctx.source?.react) {
                // Una interacción slash no tiene un mensaje del usuario al que poner reacción.
                await ctx.reply(String(emojis.resolve(rule.reaction)));
            } else {
                try { await ctx.source.react(icon); }
                catch {
                    if (Object.hasOwn(catalog, rule.reaction) && icon !== catalog[rule.reaction].icon) {
                        try { await ctx.source.react(catalog[rule.reaction].icon); return; } catch {}
                    }
                    throw new UserError('No pude reaccionar en este canal. Revisa Añadir reacciones, Leer el historial y el emoji.');
                }
            }
        }
    }
    async function respondAI(ctx, text, { allowMemory = false, attachments = [] } = {}) {
        const cfg = ctx.guild ? store.guild(ctx.guild.id) : null;
        const candidate = ctx.guild && tickets.get(ctx.channel.id);
        const ticket = candidate?.guildId === ctx.guild?.id ? candidate : null;
        if (ticket && !ticket.aiActive) return;
        if (ticket && cfg?.ai && ctx.user.id === ticket.ownerId) {
            const hasFiles = Boolean(ctx.source?.attachments?.size || attachments.length);
            const readImage = attachments.length > 0 && /\b(?:lee(?:me)?|transcrib\w*|describ\w*|analiz\w*|traduc\w*|que (?:dice|pone|ves|muestra|aparece|hay|se ve)|puedes (?:leer|ver))\b/.test(normalise(text));
            const answer = intake(ticket, text, { hasFiles, readImage }, () => store.save());
            if (answer) return ctx.reply(answer);
            if (!text.trim() && !attachments.length) return;
        }
        const communityTopic = cfg && !attachments.length ? topicOf(text) : null;
        if (allowMemory && !ticket && !attachments.length && communityTopic !== 'giveaways') {
            const publication = giveaways.request(ctx,text);
            if (publication && (publication.type !== 'notice' || publication.channel)) {
                if (cfg && !cfg.ai) throw new UserError('La IA está desactivada en este servidor.');
                return giveaways.prepare(ctx, publication);
            }
        }
        if (!attachments.length) {
            const memory = allowMemory && parseRequest(text);
            if (memory) return remember(ctx, memory);
            const rule = cfg && !ticket && matchingRule(cfg, text, true);
            if (rule) return applyRule(rule, ctx);
            if (ctx.guild && /^(?:haz|crea|crear|diseña|genera|redacta)\b[\s\S]{0,100}\bembed\b/i.test(text.trim())) return draftAI(ctx,text);
        }
        if (cfg && !cfg.ai) throw new UserError('La IA está desactivada en este servidor.');
        if (!ctx.guild && process.env.AI_DM_ENABLED === 'false') throw new UserError('El administrador desactivó la IA por DM.');
        if (cfg && ctx.source) ctx.member = await ctx.guild.members.fetch({ user: ctx.user.id, force: true });
        const chat = aiKey(ctx);
        if (cfg && !attachments.length) {
            const topic = moderationTopic(normalise(text), moderationChats.get(chat));
            if (topic === 'ban') {
                moderationChats.set(chat, true);
                const me = await ctx.guild.members.fetchMe({ force: true }).catch(() => null);
                const answer = banAdvice(ctx.member, ctx.guild, me, cfg);
                return ctx.reply(/\bobliter/i.test(text) ? '¿Te refieres a un baneo? ' + answer : answer);
            }
            moderationChats.delete(chat);
            if (topic === 'automod') return ctx.reply(autoModInfo(cfg));
            if (communityTopic === 'personal-role') {
                if (ctx.isSlash) return ctx.reply(roleInstructions);
                try { await ctx.user.send({content:roleInstructions,allowedMentions:{parse:[]}}); return; }
                catch { return ctx.reply('Para ver tus instrucciones en privado, usa **/rc** o habilita los mensajes directos de este servidor.'); }
            }
            if (communityTopic && !(ticket && ticket.report)) {
                if (communityTopic === 'giveaways') return privateReply(ctx, giveaways.active(ctx.guild, ctx.member));
                const answer = communityAnswer(ctx, cfg, text, communityTopic, rewards);
                for (const chunk of answer.match(/[\s\S]{1,1900}/g) || []) await ctx.reply(chunk);
                return;
            }
        }
        const knowledge = cfg ? knowledgeText(cfg) : '';
        let capabilities = 'Chat privado. Puedes responder preguntas generales.';
        if (cfg) {
            const access = { ...ctx, delegatedRoles: cfg.delegatedRoles, supportRole: cfg.supportRole, staffPolicy:cfg.staffPolicy };
            const allowed = definitions.filter(d => canShow(d, access, ticket)).map(d => d.usage);
            const botBan = ctx.guild.members?.me?.permissions?.has(P.BanMembers);
            capabilities = [
                'Servidor: ' + ctx.guild.name,
                'Acceso actual: ' + accessLabel(ctx),
                'Niveles: ' + (cfg.levels.enabled ? 'activos, 15 XP por minuto y 100 XP por nivel. /level enseña el progreso.' : 'apagados'),
                'Boosts: ' + (cfg.boosts.enabled ? 'activos. Los beneficios de este servidor se consultan preguntando qué se recibe por boostear.' : 'apagados'),
                'Verificación: ' + (cfg.verification.enabled ? 'panel en <#' + cfg.verification.channelId + '>, revisión privada por dueño o administrador.' : 'apagada'),
                'La persona es dueña del servidor: ' + (ctx.user.id === ctx.guild.ownerId ? 'sí' : 'no'),
                'Puede usar el panel y solicitar baneos como dueño o administrador: ' + (isAdmin(ctx.member, ctx.guild) ? 'sí' : 'no'),
                'Baneos desde Timmy en este servidor: ' + (cfg.bansEnabled ? 'habilitados' : 'desactivados'),
                'Permiso BanMembers de Timmy: ' + (botBan === undefined ? 'desconocido' : botBan ? 'sí' : 'no'),
                'Comandos disponibles para esta persona: ' + allowed.join(' | '),
                ticket ? 'El usuario YA está dentro de un ticket privado de este servidor. Atiende el caso aquí. Identifica qué se ha facilitado y pregunta solo por el próximo dato necesario. El personal puede leer este canal. Resumen inicial y datos aportados (texto citado): ' + JSON.stringify([ticket.category, ticket.summary, ticket.report]) : '',
                'Los dueños y administradores pueden preparar sorteos y eventos con una mención o >ask; los miembros participan con Entrar.',
                autoModInfo(cfg)
            ].join('\n');
        }
        let generated;
        try { generated = await ai.ask(chat, ctx.user.id, text, knowledge, false, capabilities, attachments); }
        catch (error) {
            if (ticket && !allowMemory && error.code === 'AI_BUSY') return;
            throw error;
        }
        const answer = emojis.style(generated, text, Boolean(ticket)) || 'No pude redactar la respuesta. ¿Puedes reformular la pregunta?';
        for (const chunk of answer.match(/[\s\S]{1,1900}/g) || []) await ctx.reply(chunk);
    }

    async function privateReply(ctx, payload) {
        if (ctx.isSlash || !ctx.guild) return ctx.reply(payload);
        try { await ctx.user.send({ ...(typeof payload === 'string' ? { content: payload } : payload), allowedMentions: { parse: [] } }); }
        catch { throw new UserError('No pude enviarte el DM. Activa mensajes privados o usa la versión con / de este comando para recibir la respuesta en privado.'); }
        return ctx.reply('Te envié la información por DM.');
    }
    const normalise = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    add('help', 'Ayuda breve según tus permisos', '>help [categoría o comando]', { guild: false, private: true, aliases: ['ayuda'], params: [textParam('categoria', 'Una categoría o un comando', false)] }, async (ctx, args) => {
        const category = normalise(args.join(' '));
        const cfg = ctx.guild ? store.guild(ctx.guild.id) : null;
        const context = { ...ctx, supportRole: cfg?.supportRole, delegatedRoles: cfg?.delegatedRoles, staffPolicy:cfg?.staffPolicy };
        const allowed = definitions.filter(d => canShow(d, context, tickets.get(ctx.channel.id)));
        const available = [...new Set(allowed.map(d => d.category))];
        const selected = category ? allowed.filter(d => normalise(d.category) === category || d.name === category || d.aliases.includes(category))
            : allowed.filter(d => BASIC.includes(d.name));
        if (!selected.length) throw new UserError('No hay ayuda disponible para esa opción con tus permisos. Usa >help.');
        let body = selected.map(d => `\`${d.usage}\` — ${d.description}`).join('\n');
        if (!category) {
            body += `\n\n**Ver una categoría:** ${available.map(c => `\`>help ${c}\``).join(' · ')}`;
            if (isAdmin(ctx.member, ctx.guild)) body += '\n\n**Administración:** >setup muestra los pasos de este servidor. >panel te envía la página privada de comandos.';
        }
        const data = { embeds: [embed(category ? `Timmy Max • ${selected[0].category}` : 'Timmy Max • Tu ayuda', body)
            .setFooter({ text: 'Solo aparecen comandos disponibles para ti. Los tickets se abren desde el panel de soporte.' })] };
        // Nunca publica catálogos de administración/moderación en un canal público.
        if (isAdmin(ctx.member, ctx.guild) || selected.some(d => d.permission || d.adminOnly)) return privateReply(ctx, data);
        await ctx.reply(data);
    });
    add('panel', 'Editor web de los módulos del servidor', '>panel', { adminOnly: true, private: true, category: 'Configuración', aliases: ['web', 'dashboard'] }, async ctx => {
        const { publicOrigin } = require('./src/web');
        const origin = publicOrigin(process.env);
        if (process.env.WEB_ENABLED !== 'true' || !origin || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
            return privateReply(ctx, 'La página aún no está activada. Sigue PAGINA_Y_ACTUALIZACION.md del paquete para configurar el dominio y OAuth2 en Railway.');
        }
        await privateReply(ctx, { content: 'Edita las bienvenidas, despedidas, niveles, boosts y ajustes de Snipe del servidor.',
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Configurar servidor').setStyle(ButtonStyle.Link).setURL(`${origin}/servers/${ctx.guild.id}/panel`))] });
    });
    add('official','Gestiona el servidor oficial de Timmy','>official plan | create CONFIRMAR | publish info|setup|directory|status | update texto | auto on/off/status | voice on/off/status',{adminOnly:true,private:true,category:'Configuración',params:[textParam('opciones','Plan, creación confirmada, panel o actualización',false)]},async(ctx,args)=>{
        const {publicOrigin}=require('./src/web');
        const result=await require('./src/official-community').run({client,store,ctx,defs:definitions,origin:publicOrigin(process.env),args,runtime:officialRuntime});
        return privateReply(ctx,result);
    });
    const handleSetup = installSetup({ add, store, getRole, setLogChannel, community });
    installAudit(client,store);
    installRewards({ add, optConfig, getChannel, rewards, store, studio, saveConfig: community.save, privateReply });
    add('ping', 'Comprueba conexión y latencia', '>ping', { guild: false }, async ctx => ctx.reply(`🏓 Pong • Gateway: ${client.ws.ping} ms`));
    add('avatar', 'Muestra un avatar', '>avatar [@usuario]', { aliases: ['av', 'pfp'], params: [userParam('usuario', false)] }, async (ctx, args) => {
        const target = await getMember(ctx, args[0] || ctx.user.id);
        await ctx.reply({ embeds: [embed(`Avatar de ${target.user.username}`, `[Abrir imagen](${target.user.displayAvatarURL({ size: 1024 })})`).setImage(target.user.displayAvatarURL({ size: 1024 }))] });
    });
    add('banner', 'Muestra el banner de un usuario', '>banner [@usuario]', { params: [userParam('usuario', false)] }, async (ctx, args) => {
        const user = await client.users.fetch(idOf(args[0] || ctx.user.id), { force: true });
        const url = user.bannerURL({ size: 1024 });
        if (!url) throw new UserError('Ese usuario no tiene un banner.');
        await ctx.reply({ embeds: [embed(`Banner de ${user.username}`, `[Abrir imagen](${url})`).setImage(url)] });
    });
    add('userinfo', 'Consulta un miembro', '>userinfo [@usuario]', { aliases: ['ui', 'whois'], params: [userParam('usuario', false)] }, async (ctx, args) => {
        const m = await getMember(ctx, args[0] || ctx.user.id);
        await ctx.reply({ embeds: [embed(m.user.username, `ID: ${m.id}\nCuenta: <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>\nIngreso: ${m.joinedTimestamp ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : '—'}\nRoles: ${m.roles.cache.filter(r => r.id !== ctx.guild.id).map(r => `<@&${r.id}>`).slice(0, 20).join(' ') || 'Ninguno'}`).setThumbnail(m.user.displayAvatarURL())] });
    });
    add('serverinfo', 'Consulta el servidor', '>serverinfo', { aliases: ['si'] }, async ctx => {
        const g = ctx.guild;
        const e = embed(g.name, `ID: ${g.id}\nDueño: <@${g.ownerId}>\nMiembros: ${g.memberCount}\nBoosts: ${g.premiumSubscriptionCount || 0}`);
        if (g.iconURL()) e.setThumbnail(g.iconURL());
        await ctx.reply({ embeds: [e] });
    });
    add('sf', 'Muestra Spotify compartido en Discord', '>sf [@usuario]', { params: [userParam('usuario', false)] }, async (ctx, args) => {
        const m = await getMember(ctx, args[0] || ctx.user.id);
        const a = ctx.guild.presences.cache.get(m.id)?.activities.find(a => a.name === 'Spotify' && a.type === ActivityType.Listening);
        if (!a) throw new UserError('No detecto Spotify. Vincula tu cuenta y activa Mostrar Spotify como tu estado; evita el estado invisible.');
        const e = embed('🎧 Spotify', `${cut(a.details, 200)}\n**Artista:** ${cut(a.state, 500)}\n**Álbum:** ${cut(a.assets?.largeText, 500)}`)
            .setAuthor({ name: m.user.username, iconURL: m.user.displayAvatarURL() }).setColor(0x1db954);
        const image = a.assets?.largeImageURL(); if (image) e.setThumbnail(image);
        await ctx.reply({ embeds: [e] });
    });
    add('ask', 'Pregunta a Timmy sobre texto o fotos', '>ask [pregunta] [foto adjunta]', {
        guild: false, aliases: ['ia'], category: 'IA', params: [
            textParam('pregunta', 'Tu consulta (no compartas claves)', false),
            { type: 11, name: 'imagen', description: 'Foto que quieres consultar con Gemini (JPG, PNG o WebP)', required: false }
        ]
    }, async (ctx, args) => {
        const attachments = ctx.isSlash ? [ctx.source.options.getAttachment('imagen')].filter(Boolean) : messageFiles(ctx.source);
        return respondAI(ctx, ctx.rawArgs ?? args.join(' '), { allowMemory: true, attachments });
    });
    add('cumple', 'Registra tu día y mes para la celebración del servidor', '>cumple [DD/MM | borrar]', { category: 'Comunidad', private: true,aliases:['birthday'],params:[textParam('fecha','Día/mes o borrar',false)] }, async (ctx,args) => privateReply(ctx,birthdays.register(ctx.guild.id,ctx.user.id,args.join(' '))));
    add('rc', 'Diseña el nombre y el color de tu rol de booster', '>rc', { category: 'Comunidad', private: true }, ctx => boosterRoles.opener(ctx));
    add('sorteos', 'Consulta los sorteos abiertos que puedes ver', '>sorteos', { category: 'Comunidad', private: true },
        ctx => privateReply(ctx, giveaways.active(ctx.guild, ctx.member)));
    add('giveaway', 'Prepara un sorteo con entradas privadas y cierre automático', '>giveaway #canal hours: 5 prize: 5k Robux winners: 2',
        { category: 'Comunidad', adminOnly: true, private: true, aliases: ['sorteo'], params: [
            { type: 7, name: 'canal', description: 'Canal del sorteo', required: true, channel_types: [0, 5] },
            textParam('duracion','30 minutos, 5 horas o 2 días'), textParam('premio','Premio que se sortea'),
            numParam('ganadores','Cantidad de ganadores',1,100),
            { type: 7, name: 'aviso', description: 'Canal opcional para anunciar el sorteo', required: false, channel_types: [0, 5] }
        ] }, async (ctx, args) => {
            const request = ctx.isSlash ? { type: 'draw', channel: args[0], fields: { duration: args[1], prize: args[2], winners: args[3] },
                notice: args[4] ? { channel: args[4] } : null } : parsePublication(ctx.rawArgs ?? args.join(' '), true);
            if (!request) throw new UserError('Usa >giveaway #canal hours: 5 prize: 5k Robux winners: 2');
            return giveaways.prepare(ctx, request);
        });
    for (const [name,action,alias] of [['gend','end','endsorteo'],['greroll','reroll','reroll']]) add(name, action==='end'?'Termina un sorteo':'Vuelve a elegir ganadores', '>'+name+' ID_mensaje', {category:'Comunidad',adminOnly:true,private:true,aliases:action==='end'?[alias,'end']: [alias],params:[textParam('mensaje','ID o enlace del mensaje del sorteo')]},async(ctx,args)=>{
        const result=await giveaways.control(ctx,action,args[0]);
        await ctx.reply(result);
    });
    add('staffconfig','Configura la jerarquía del staff','>staffconfig staff|mod|admin|channel|mode|minutes|whitelist [valor]',optConfig(),async(ctx,args)=>{
        if(ctx.user.id!==ctx.guild.ownerId) throw new UserError('Solo el dueño puede modificar la jerarquía.');
        const [field,value,extra]=args, p=policyOf(store.guild(ctx.guild.id));
        if(!field||field==='list') return privateReply(ctx,'Staff: '+(p.staff||'—')+' · Mod: '+(p.mod||'—')+' · Admin: '+(p.admin||'—')+' · Avisos: '+(p.channel||'—')+' · Modo: '+p.mode+' · Whitelist: '+(p.whitelist.join(', ')||'vacía'));
        let next;
        if(['staff','mod','admin','channel'].includes(field)) next={[field]:idOf(value)};
        else if(field==='mode') next={mode:value};
        else if(field==='minutes') next={minutes:value};
        else if(field==='whitelist'&&['add','remove'].includes(value)) {
            const id=idOf(extra);
            next={whitelist:value==='add'?[...p.whitelist,id]:p.whitelist.filter(x=>x!==id)};
        } else throw new UserError('Usa >staffconfig staff @rol, mod @rol, admin @rol, channel #aviso, mode off|audit|enforce, minutes 10 o whitelist add|remove @usuario.');
        await savePolicy({store,guild:ctx.guild,member:ctx.member,next,expected:p.revision});
        await privateReply(ctx,'Jerarquía guardada. Usa /setup o el panel para revisar los ajustes.');
    });
    add('customcmd','Crea respuestas o acciones permitidas','>customcmd text nombre respuesta | timeout nombre minutos | remove nombre | ai descripción',optConfig(),async(ctx,args)=>{
        const [type,name,...rest]=args;
        if(type==='ai') {
            if(!store.guild(ctx.guild.id).ai) throw new UserError('La IA está desactivada.');
            const d=await ai.customDraft(ctx.user.id,[name,...rest].filter(Boolean).join(' '));
            const draft=validateCustom(d?.name,d?.type,d?.text,d?.minutes,definitions);
            return privateReply(ctx,'Borrador (no guardado): '+(draft.type==='text'?'>customcmd text '+draft.name+' '+draft.text:'>customcmd timeout '+draft.name+' '+draft.minutes)+'\nRevísalo y ejecuta el comando para guardarlo.');
        }
        if(type==='remove') {
            const d=validateCustom(name,'text','remove',null,definitions);saveCustom(store,ctx.guild.id,d,true);
        } else {const d=validateCustom(name,type,rest.join(' '),rest[0],definitions);saveCustom(store,ctx.guild.id,d);}
        await privateReply(ctx,'Comandos personalizados actualizados.');
    });
    add('dado','Lanza un dado','>dado [caras]',{category:'Diversión',aliases:['roll'],params:[numParam('caras','Caras del dado',2,100,false)]},async(ctx,args)=>ctx.reply('🎲 '+randomInt(1,integer(args[0]||'6',2,100)+1)));
    add('moneda','Lanza una moneda','>moneda',{category:'Diversión',aliases:['coinflip']},async ctx=>ctx.reply('🪙 '+(randomInt(2)?'Cara':'Cruz')));
    add('8ball','Pregunta a la bola mágica','>8ball pregunta',{category:'Diversión',params:[textParam('pregunta','Pregunta divertida')]},async(ctx,args)=>{
        if(!args.join(' ').trim()) throw new UserError('Escribe una pregunta.');
        const answers=['Sí, sin duda.','Quizá...','No parece probable.','Pregúntame mañana.','El destino dice que sí.','Mis poderes están en mantenimiento.'];
        await ctx.reply('🎱 '+answers[randomInt(answers.length)]);
    });
    add('vc','Administra tu sala temporal','>vc name|limit|lock|unlock|hide|show|transfer [valor]',{category:'Comunidad',params:[textParam('opciones','Acción y valor')]},async(ctx,args)=>ctx.reply(await voiceMaster.command(ctx,args)));
    add('socialconfig','Activa o desactiva las solicitudes sociales','>socialconfig on|off|status',{adminOnly:true,private:true,category:'Configuración',params:[textParam('opciones','on, off o status')]},async(ctx,args)=>{
        const guild=await ctx.guild.fetch();
        if(ctx.user.id!==guild.ownerId)throw new UserError('Solo el dueño del servidor configura Social Center.');
        if(args[0]==='status')return ctx.reply('Social Center: '+(store.guild(guild.id).socialEnabled?'activado':'desactivado'));
        if(!['on','off'].includes(args[0]))throw new UserError('Usa on, off o status.');
        store.patchGuild(guild.id,{socialEnabled:args[0]==='on'});
        return ctx.reply('Social Center '+(args[0]==='on'?'activado. Las interacciones de juego son instantáneas; marry requiere aceptación.':'desactivado.'));
    });
    for(const verb of ['hug','kiss','slap','ship','marry'])add(verb,verb==='marry'?'Solicita un matrimonio virtual':'Envía una interacción ficticia instantánea','>'+verb+' @usuario',{category:'Diversión',params:[userParam()]},async(ctx,args)=>{
       const target=await getMember(ctx,args[0],true);if(target.user.bot)throw new UserError('Elige un miembro humano.');
       if(verb!=='marry'){
          if(!ctx.channel.permissionsFor?.(target)?.has(P.ViewChannel))throw new UserError('Elige un miembro con acceso a este canal.');
          return ctx.reply(socialCenter.instant(ctx.guild.id,ctx.user.id,target.id,verb));
       }
       const id=socialCenter.request(ctx.guild.id,ctx.user.id,target.id,verb,ctx.channel.id);
       try{await target.user.send(socialCenter.invitation(ctx.guild.id,id,verb,ctx.user.username,ctx.guild.name));}catch{socialCenter.cancel(ctx.guild.id,id);throw new UserError('No pude enviar la solicitud privada. La otra persona debe permitir mensajes del servidor.');}
       return ctx.reply('Solicitud privada enviada. La otra persona puede aceptar o rechazar con los botones del mensaje privado.');
    });
    add('socialprivacy','Elige si recibes interacciones sociales','>socialprivacy on|off|status',{category:'Diversión',private:true,params:[textParam('opciones','on, off o status',false)]},async(ctx,args)=>privateReply(ctx,socialCenter.preference(ctx.guild.id,ctx.user.id,args[0]||'status')));
    add('socialreply','Acepta o rechaza una solicitud social','>socialreply aceptar|rechazar ID',{category:'Diversión',private:true,params:[textParam('opciones','aceptar o rechazar e ID')]},async(ctx,args)=>{
      if(!['aceptar','rechazar'].includes(args[0]))throw new UserError('Elige aceptar o rechazar.');
      const p=socialCenter.lookup(ctx.guild.id,ctx.user.id,args[1]);
      // Legacy text acceptance remains private; the explicit DM button authorizes public display.
      const result=socialCenter.respond(ctx.guild.id,ctx.user.id,args[1],args[0]==='aceptar');
      if(result){const sender=await ctx.guild.members.fetch(p.from).catch(()=>null);await sender?.user.send({content:'Tu solicitud virtual '+p.verb+' fue aceptada en privado.',allowedMentions:{parse:[]}}).catch(()=>{});}
      return privateReply(ctx,result?'Interacción virtual aceptada en privado.':'Solicitud rechazada.');
    });
    add('divorce','Termina tu matrimonio virtual','>divorce',{category:'Diversión',private:true},async ctx=>{socialCenter.divorce(ctx.guild.id,ctx.user.id);return privateReply(ctx,'Matrimonio virtual disuelto.');});
    add('roblox','Consulta un perfil público por ID','>roblox ID',{guild:false,category:'Utilidades',params:[textParam('id','ID numérico de Roblox')]},async(ctx,args)=>{
       const p=await roblox.profile(args[0]);return ctx.reply({embeds:[embed('Roblox · '+p.name,'Nombre: '+p.display+'\nCuenta creada: '+(p.created||'—')+'\nConexiones: '+(p.friends??'No disponible')+'\n'+p.url)]});
    });
    add('robloxlink','Vincula o desvincula tu cuenta de Roblox','>robloxlink',{guild:false,category:'Utilidades',private:true},async ctx=>{
        const origin=require('./src/web').publicOrigin();if(!origin||process.env.WEB_ENABLED!=='true'||!roblox.ready())throw new UserError('La consulta /roblox ID funciona sin vinculación; para vincular, el propietario del bot debe configurar ROBLOX_CLIENT_ID, ROBLOX_CLIENT_SECRET y la web.');
        return privateReply(ctx,'Administra tu propia vinculación con Roblox en '+origin+'/roblox. Nunca compartas contraseñas ni cookies.');
    });
    add('translate','Detecta idioma y traduce texto suministrado','>translate es|en|pt|fr|zh|ja|ko|de texto',{guild:false,category:'IA',private:true,params:[textParam('idioma','Idioma destino'),textParam('texto','Texto a traducir')]},async(ctx,args)=>{
        if(ctx.guild&&!store.guild(ctx.guild.id).ai)throw new UserError('IA desactivada en este servidor.');
        return privateReply(ctx,await utilityCenter.translate(ctx.user.id,args[0],args.slice(1).join(' ')));
    });
    add('support','Pregunta sobre los comandos de Timmy','>support pregunta',{guild:false,category:'IA',private:true,params:[textParam('pregunta','Pregunta de soporte',false)]},async(ctx,args)=>{
        if(!args.length||ctx.guild&&!store.guild(ctx.guild.id).ai){const origin=require('./src/web').publicOrigin();return privateReply(ctx,(origin?'Documentación: '+origin+'/guia · ':'Consulta /help · ')+'Soporte humano: '+require('./src/official-community').INVITE);}
        return privateReply(ctx,await utilityCenter.support(ctx.user.id,args.join(' '),definitions));
    });
    add('forget', 'Borra tu contexto de IA de este chat', '>forget', { guild: false, category: 'IA', aliases: ['clearmem'], private: true }, async ctx => {
        const chat = aiKey(ctx);
        ai.forget(chat); moderationChats.delete(chat);
        await ctx.reply('Tu contexto de IA de este chat se ha borrado.');
    });
    add('privacy', 'Qué recuerda Timmy y durante cuánto tiempo', '>privacy', { guild: false, category: 'IA', private: true }, async ctx =>
        ctx.reply({ embeds: [embed('Tu privacidad en Timmy', [
            '**💬 Conversación con IA**\nGemini recibe tu pregunta y hasta 6 turnos tuyos con Timmy en este chat. En un servidor también recibe sus fichas de información.',
            '**📷 Fotos**\nAl escribir por DM, mencionarme o usar ask, las fotos de tu consulta se envían a Gemini en ese turno. En tickets, usa una mención o ask para compartir fotos con la IA.',
            '**🧠 Memoria del chat**\nEl historial de IA guarda solo texto, incluida mi respuesta sobre la foto. Caduca tras 2 horas sin uso o al reiniciar. Puedes borrarlo con `>forget`.',
            '**📝 Reglas y notas**\nUn administrador puede guardar frases y respuestas para este servidor. Timmy compara los mensajes de chat con esas reglas localmente. Las reglas duran hasta que se quitan.',
            '**🎫 Tickets y moderación**\nLas transcripciones de tickets son privadas. El administrador decide cuánto conservarlas. Si se activa snipe, el staff autorizado puede consultar texto durante 5 minutos.'
        ].join('\n\n'))] }));
    add('emojis', 'Muestra la colección de Timmy', '>emojis', { guild: false, category: 'IA', private: true, params: [
        textParam('accion', 'Ver la colección o importar por DM', false),
        { type: 11, name: 'archivo', description: 'ZIP de la colección para importar por DM', required: false }
    ] }, async (ctx, args) => {
        if (args[0]?.toLowerCase() === 'importar') return emojis.importForOwner(ctx);
        return ctx.reply({ embeds: [embed('Los emojis de Timmy', emojis.list())] });
    });
    add('recuerda', 'Guarda notas y reglas de chat de este servidor', '>recuerda si alguien dice brian, dile ola soy yo | lista | quitar frase',
        { ...optConfig(), raw: true }, async (ctx, args) => {
        const input = (ctx.rawArgs ?? args.join(' ')).trim();
        if (/^(?:lista|list)$/i.test(input)) {
            const body = listMemory(store.guild(ctx.guild.id));
            return privateReply(ctx, body.length > 1900 ? { files: [new AttachmentBuilder(Buffer.from(body), { name: 'recuerdos.txt' })] } : body);
        }
        const remove = /^(?:quitar|remove|olvida)\s+([\s\S]+)/i.exec(input);
        if (remove) return ctx.reply(removeMemory(store, ctx.guild.id, remove[1]));
        return remember(ctx, parseRequest(input, true));
    });
    installAccess({ add, store, getRole, privateReply, log });

    const { draftAI } = installDesignCommands({ add, store, studio, ai, tickets, getChannel, optConfig });
    add('autorole', 'Rol automático para nuevos miembros', '>autorole @rol | off', optConfig(P.ManageRoles), async (ctx, args) => {
        const cfg = store.guild(ctx.guild.id);
        if (args[0] === 'off') cfg.autorole = null;
        else {
            const role = await getRole(ctx, args[0]);
            safeRole(role, await botPermission(ctx, P.ManageRoles), ctx.member);
            guardCommunityRole(role, cfg); guardEarnedRole(role, cfg); cfg.autorole = role.id;
        }
        store.save(); await ctx.reply('Autorrol actualizado.');
    });
    add('logs', 'Canal de registros', '>logs #canal | off', optConfig(), async (ctx, args) => {
        await setLogChannel(ctx, args[0]); await ctx.reply('Configuración guardada.');
    });
    add('djrole', 'Restringe controles al rol DJ', '>djrole @rol | off', optConfig(), async (ctx, args) => {
        const djRole = args[0] === 'off' ? null : (await getRole(ctx, args[0])).id;
        store.patchGuild(ctx.guild.id, { djRole }); await ctx.reply('Configuración guardada.');
    });
    add('prefix', 'Cambia el prefijo del servidor', '>prefix <prefijo>', optConfig(), async (ctx, args) => {
        const p = args[0];
        if (!p || p.length > 3 || /[\s<>@/]/.test(p)) throw new UserError('Usa entre 1 y 3 caracteres, sin espacios, /, <, > o @. El prefijo > siempre sigue disponible.');
        store.guild(ctx.guild.id).prefix = p; store.save(); await ctx.reply(`Prefijo guardado: ${p}`);
    });
    for (const [name, key] of [['snipeconfig', 'snipe'], ['automod', 'automod'], ['aiconfig', 'ai']]) {
        add(name, `Activa o desactiva ${key}`, `>${name} on | off`, optConfig(), async (ctx, args) => {
            if (!['on', 'off'].includes(args[0])) throw new UserError(`Uso: >${name} on | off`);
            if (key === 'snipe') setSnipe(ctx.guild, args[0] === 'on');
            else store.patchGuild(ctx.guild.id, { [key]: args[0] === 'on' });
            await ctx.reply(`${key}: ${args[0]}.`);
        });
    }
    add('knowledge', 'Fichas de información IA de este servidor', '>knowledge add nombre <texto> | remove nombre | list | clear', optConfig(), async (ctx, args) => {
        const cfg = store.guild(ctx.guild.id);
        if (args[0] === 'list') return privateReply(ctx, `Información de ${ctx.guild.name}:\n${cfg.knowledge ? '• general (texto anterior)\n' : ''}${Object.entries(cfg.knowledgePages).map(([k,v]) => `• ${k}: ${v.length} caracteres`).join('\n') || 'Sin fichas.'}`);
        const action = ['clear','add','remove'].includes(args[0]) ? args[0] : 'general';
        updateKnowledge(store,ctx.guild.id,action,args[1],action === 'general' ? args.join(' ') : args.slice(2).join(' '));
        await ctx.reply(`Información actualizada solo para ${ctx.guild.name}. Las próximas respuestas usarán el contenido nuevo.`);
    });
    add('config', 'Muestra la configuración actual', '>config', { permission: P.ManageGuild, category: 'Configuración', private: true }, async ctx => {
        const c = store.guild(ctx.guild.id);
        await privateReply(ctx, { embeds: [embed(`Configuración • ${ctx.guild.name}`, `Prefijo: ${c.prefix}\nBienvenida: ${c.welcome ? `<#${c.welcome.channelId}>` : 'off'}\nDespedida: ${c.goodbye ? `<#${c.goodbye.channelId}>` : 'off'}\nAutorrol: ${c.autorole ? `<@&${c.autorole}>` : 'off'}\nLogs: ${c.logChannel ? `<#${c.logChannel}>` : 'off'}\nSnipe: ${c.snipe}\nAntispam: ${c.automod}\nBaneos: ${c.bansEnabled ? 'activados' : 'desactivados'}\nIA: ${c.ai}\nFichas IA: ${Object.keys(c.knowledgePages).length}\nRespuestas: ${Object.keys(c.custom).length}\nReacciones: ${c.reactions.length}\nCategoría tickets: ${c.ticketCategory || 'sin configurar'}\nRol soporte: ${c.supportRole || 'sin configurar'}\n\nEstos ajustes pertenecen solo a este servidor.`)] });
    });
    add('autoreact', 'Reacciona a palabras o frases', '>autoreact add "frase" emoji | remove "frase" | list', optConfig(), async (ctx, args) => {
        const cfg = store.guild(ctx.guild.id);
        if (args[0] === 'list') return ctx.reply(cfg.reactions.map(r => `${r.trigger} → ${r.emoji}`).join('\n') || 'Sin reacciones.');
        const trigger = args[1]?.toLocaleLowerCase('es');
        if (!trigger || trigger.length > 80) throw new UserError('Indica una frase de hasta 80 caracteres. Usa comillas si contiene espacios.');
        if (args[0] === 'remove') cfg.reactions = cfg.reactions.filter(r => r.trigger !== trigger);
        else if (args[0] === 'add') {
            if (cfg.reactions.length >= 25 && !cfg.reactions.some(r => r.trigger === trigger)) throw new UserError('Máximo 25 reacciones.');
            const emoji = emojiChoice(args[2]);
            const testMessage = await ctx.channel.send('Comprobando emoji…');
            try { await testMessage.react(emojis.resolve(emoji, true)); }
            catch { throw new UserError('No puedo usar ese emoji. Revisa el emoji y Añadir reacciones.'); }
            finally { await testMessage.delete().catch(() => {}); }
            cfg.reactions = cfg.reactions.filter(r => r.trigger !== trigger);
            cfg.reactions.push({ trigger, emoji });
        } else throw new UserError('Usa add, remove o list.');
        store.save(); await ctx.reply('Reacciones actualizadas.');
    });
    add('responder', 'Responde a una palabra sola o con prefijo', '>responder add nombre <texto> | remove nombre | list', optConfig(), async (ctx, args) => {
        const cfg = store.guild(ctx.guild.id);
        if (args[0] === 'list') return ctx.reply([...new Set([...Object.keys(cfg.custom),...Object.keys(cfg.customActions||{})])].map(k => `>${k}`).join(', ') || 'Sin respuestas.');
        const name = args[1]?.toLowerCase();
        if (!/^[a-z0-9_-]{1,24}$/.test(name || '') || ['__proto__', 'constructor', 'prototype'].includes(name) || commands.has(name) || aliases.has(name)) throw new UserError('Nombre inválido o reservado.');
        if (Object.hasOwn(cfg.customActions||{},name)) throw new UserError('Ese nombre es una acción personalizada. Edítala con >customcmd o el panel web.');
        if (args[0] === 'remove') delete cfg.custom[name];
        else if (args[0] === 'add') {
            const content = args.slice(2).join(' ');
            if (!content || content.length > 1800) throw new UserError('La respuesta debe tener de 1 a 1800 caracteres.');
            if (Object.keys(cfg.custom).length + Object.keys(cfg.customActions||{}).length >= 50 && !Object.hasOwn(cfg.custom, name)) throw new UserError('Máximo 50 comandos personalizados.');
            cfg.custom[name] = content;
        } else throw new UserError('Usa add, remove o list.');
        store.save();
        await ctx.reply(args[0] === 'remove' ? 'Respuesta eliminada.' : 'Listo. Prueba escribiendo `' + name + '` o `>' + name + '` en este servidor.');
    });
    add('rolebutton', 'Publica un botón para obtener un rol', '>rolebutton @rol <etiqueta>', optConfig(P.ManageRoles), async (ctx, args) => {
        const role = await getRole(ctx, args[0]);
        safeRole(role, await botPermission(ctx, P.ManageRoles), ctx.member);
        guardCommunityRole(role, store.guild(ctx.guild.id)); guardEarnedRole(role, store.guild(ctx.guild.id));
        const label = cut(args.slice(1).join(' ') || role.name, 80);
        const sent = await ctx.channel.send({ embeds: [embed('Roles de la comunidad', `Pulsa para obtener o quitar **${role.name}**.`)],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tm:role:${role.id}`).setLabel(label).setStyle(ButtonStyle.Secondary))] });
        store.guild(ctx.guild.id).roleButtons[sent.id] = role.id; store.save(); await ctx.reply('Panel de rol creado.');
    });

    for (const [name, cache] of [['snipe', snipes], ['editsnipe', edits]]) add(name, name === 'snipe' ? 'Último texto eliminado (staff)' : 'Último texto editado (staff)', `>${name}`, { permission: P.ManageMessages, category: 'Moderación', private: true, aliases: name === 'snipe' ? ['s'] : ['es'] }, async ctx => {
        if (!store.guild(ctx.guild.id).snipe) throw new UserError('Snipe está desactivado. Un administrador puede usar >snipeconfig on.');
        const entry = cache.get(ctx.channel.id);
        if (!entry) throw new UserError('No hay un texto registrado en los últimos 5 minutos.');
        await privateReply(ctx, { embeds: [embed(`${name} • ${entry.author}`, entry.text).setFooter({ text: 'Caduca a los 5 minutos. No se guarda en disco.' })] });
    });
    add('purge', 'Borra mensajes recientes', '>purge <1-100>', { aliases: ['clear', 'c'], permission: P.ManageMessages, category: 'Moderación', private: true, params: [numParam('cantidad', 'Cantidad de mensajes', 1, 100)] }, async (ctx, args) => {
        await botPermission(ctx, P.ManageMessages);
        const count = integer(args[0], 1, 100);
        const deleted = await ctx.channel.bulkDelete(count, true);
        await ctx.reply(`Borrados ${deleted.size} mensajes. Los antiguos que Discord no permite borrar en lote se omiten.`);
        await log(ctx.guild, 'Limpieza', `${ctx.user.id}: ${deleted.size} mensajes en ${ctx.channel.id}.`);
    });
    add('timeout', 'Aplica un timeout con motivo', '>timeout @usuario 10m <motivo>', { permission: P.ModerateMembers, category: 'Moderación', params: [userParam(), textParam('duracion', 'Ej.: 10m, 2h, 1d'), textParam('motivo', 'Motivo de la sanción')] }, async (ctx, args) => {
        const target = await modTarget(ctx, args[0], P.ModerateMembers);
        const ms = duration(args[1]); const reason = args.slice(2).join(' ');
        if (!reason) throw new UserError('Indica un motivo.');
        if (!target.moderatable) throw new UserError('Discord no permite aislar a este miembro. No se quitarán sus roles.');
        await target.timeout(ms, cut(`${ctx.user.id}: ${reason}`, 500));
        security.safeRecord(ctx.guild.id,ctx.user.id,target.id,'timeout',reason);
        await ctx.reply(`Timeout aplicado a ${target.user.username} durante ${args[1]}.`);
        await log(ctx.guild, 'Timeout', `${ctx.user.id} → ${target.id}: ${cut(reason, 500)} (${args[1]})`);
    });
    add('untimeout', 'Retira un timeout', '>untimeout @usuario', { permission: P.ModerateMembers, category: 'Moderación', params: [userParam()] }, async (ctx, args) => {
        const target = await modTarget(ctx, args[0], P.ModerateMembers);
        if (!target.moderatable) throw new UserError('No puedo moderar ese miembro.');
        await target.timeout(null, `Solicitado por ${ctx.user.id}`); await ctx.reply('Timeout retirado.');
        await log(ctx.guild, 'Timeout retirado', `${ctx.user.id} → ${target.id}`);
    });
    function requireBansEnabled(guild) {
        if (!store.guild(guild.id).bansEnabled) throw new UserError('Los baneos están desactivados en este servidor. Puedes activarlos en /setup → Moderación.');
    }
    for (const name of ['kick', 'ban']) add(name, name === 'kick' ? 'Expulsa a un miembro' : 'Banea a un miembro', `>${name} @usuario <motivo>`, { adminOnly: name === 'ban', permission: name === 'kick' ? P.KickMembers : P.BanMembers, category: 'Moderación', params: [userParam(), textParam('motivo', 'Motivo de la sanción')] }, async (ctx, args) => {
        const target = await modTarget(ctx, args[0], name === 'kick' ? P.KickMembers : P.BanMembers);
        const reason = args.slice(1).join(' '); if (!reason) throw new UserError('Indica un motivo.');
        if (name === 'kick' && !target.kickable || name === 'ban' && !target.bannable) throw new UserError('Discord no permite esa acción sobre el miembro.');
        if (name === 'kick') await target.kick(cut(`${ctx.user.id}: ${reason}`, 500));
        else {
            requireBansEnabled(ctx.guild);
            await target.ban({ reason: cut(`${ctx.user.id}: ${reason}`, 500) });
        }
        security.safeRecord(ctx.guild.id,ctx.user.id,target.id,name,reason);
        await ctx.reply(`${name === 'kick' ? 'Expulsado' : 'Baneado'}: ${target.user.username}.`);
        await log(ctx.guild, name, `${ctx.user.id} → ${target.id}: ${cut(reason, 500)}`);
    });
    add('warn', 'Guarda una advertencia', '>warn @usuario <motivo>', { permission: P.ModerateMembers, category: 'Moderación', params: [userParam(), textParam('motivo', 'Motivo de la advertencia')] }, async (ctx, args) => {
        const target = await modTarget(ctx, args[0], P.ModerateMembers);
        const reason = args.slice(1).join(' '); if (!reason) throw new UserError('Indica un motivo.');
        const entry = store.warn(ctx.guild.id, target.id, ctx.user.id, reason);
        security.safeRecord(ctx.guild.id,ctx.user.id,target.id,'warn',reason,entry.id);
        await ctx.reply(`Advertencia ${entry.id} guardada para ${target.user.username}.`);
        await log(ctx.guild, 'Advertencia', `${ctx.user.id} → ${target.id}: ${entry.reason}`);
    });
    add('warnings', 'Consulta advertencias', '>warnings @usuario', { permission: P.ModerateMembers, category: 'Moderación', private: true, params: [userParam()] }, async (ctx, args) => {
        const target = await getMember(ctx, args[0]);
        const list = store.guild(ctx.guild.id).warnings[target.id] || [];
        await privateReply(ctx, { embeds: [embed(`Advertencias: ${target.user.username}`, list.slice(-10).map(w => `${w.id} • ${w.reason} • <@${w.moderator}>`).join('\n') || 'Sin advertencias.')] });
    });
    add('clearwarn', 'Elimina una advertencia por ID', '>clearwarn @usuario <id>', { permission: P.ModerateMembers, category: 'Moderación', params: [userParam(), textParam('id', 'ID de la advertencia')] }, async (ctx, args) => {
        const target = ctx.member.permissions.has(P.ModerateMembers) || isAdmin(ctx.member, ctx.guild)
            ? await getMember(ctx, args[0]) : await modTarget(ctx, args[0], P.ModerateMembers);
        const cfg = store.guild(ctx.guild.id); const list = cfg.warnings[target.id] || [];
        if (!list.some(w => w.id === args[1])) throw new UserError('Advertencia no encontrada.');
        cfg.warnings[target.id] = list.filter(w => w.id !== args[1]); store.save();
        await ctx.reply('Advertencia eliminada.'); await log(ctx.guild, 'Advertencia eliminada', `${ctx.user.id} → ${target.id}: ${args[1]}`);
    });
    add('cases','Consulta tus casos o presenta una apelación','>cases [appeal ID motivo]',{private:true,category:'Comunidad',params:[textParam('opciones','Lista personal o appeal ID motivo',false)]},async(ctx,args)=>{
        if(args[0]==='appeal'){security.change(ctx.guild.id,args[1],ctx.user.id,'appeal',args.slice(2).join(' '));return privateReply(ctx,'Apelación registrada. No revierte sanciones automáticamente.');}
        return privateReply(ctx,security.cases(ctx.guild.id).filter(c=>c.target===ctx.user.id&&c.kind!=='audit-alert').slice(-10).map(c=>c.id+' · '+c.kind+' · '+c.reason+' · '+(c.appeal?.status||'sin apelación')).join('\n').slice(0,1800)||'No hay casos nuevos registrados.');
    });
    add('lockdownall','Bloquea o restaura varios canales de texto','>lockdownall lock|unlock CONFIRMAR all|ID ...',{adminOnly:true,private:true,category:'Configuración',params:[textParam('opciones','lock o unlock CONFIRMAR y all o IDs')]},async(ctx,args)=>{
        if(!['lock','unlock'].includes(args[0])||args[1]!=='CONFIRMAR'||!args[2])throw new UserError('Confirma acción y canales.');
        const result=await security.bulk(ctx,protection,args[2]==='all'?'all':args.slice(2),args[0]==='lock');return privateReply(ctx,result.join('\n').slice(0,1900));
    });
    add('nick', 'Cambia o restablece un apodo', '>nick @usuario <nuevo apodo | reset>', { permission: P.ManageNicknames,
        category: 'Moderación', params: [userParam(), textParam('apodo', 'Nuevo apodo o reset')] }, async (ctx, args) => {
        const target = await modTarget(ctx, args[0], P.ManageNicknames);
        const nick = args.slice(1).join(' ').trim();
        if (!nick || nick.length > 32) throw new UserError('El apodo debe tener de 1 a 32 caracteres. Usa reset para quitarlo.');
        await target.setNickname(nick === 'reset' ? null : nick, 'Solicitado por ' + ctx.user.id);
        await log(ctx.guild, 'Cambio de apodo', ctx.user.id + ' → ' + target.id);
        await ctx.reply(nick === 'reset' ? 'Apodo restablecido.' : 'Apodo actualizado.');
    });
    add('role', 'Añade o quita un rol sin privilegios', '>role @usuario @rol add|remove', { permission: P.ManageRoles, category: 'Moderación', params: [userParam(), { type: 8, name: 'rol', description: 'Rol sin privilegios', required: true }, textParam('accion', 'add o remove')] }, async (ctx, args) => {
        const target = await getMember(ctx, args[0]); const role = await getRole(ctx, args[1]);
        const me = await botPermission(ctx, P.ManageRoles); safeRole(role, me, ctx.member);
        const cfg = store.guild(ctx.guild.id);
        guardCommunityRole(role, cfg);
        if (!isAdmin(ctx.member, ctx.guild) && rank(ctx.member,ctx.guild,policyOf(cfg)) !== 'mod' && !ctx.member.permissions.has(P.ManageRoles) &&
            cfg.autorole !== role.id && !Object.values(cfg.roleButtons).includes(role.id)) {
            throw new UserError('Con permisos delegados puedes gestionar los roles que un administrador ya habilitó como voluntarios o de bienvenida.');
        }
        if (target.id !== ctx.user.id) requireHierarchy(ctx.member, target, me);
        if (!['add', 'remove'].includes(args[2])) throw new UserError('Usa add o remove.');
        await target.roles[args[2]](role, `Solicitado por ${ctx.user.id}`);
        await ctx.reply('Rol actualizado.'); await log(ctx.guild, 'Rol actualizado', `${ctx.user.id}: ${args[2]} ${role.id} → ${target.id}`);
    });
    for (const name of ['lock', 'unlock']) add(name, name === 'lock' ? 'Bloquea el canal para @everyone' : 'Restaura el permiso anterior', `>${name}`, { permission: P.ManageChannels, category: 'Moderación' }, async ctx => {
        await ctx.reply(await protection.lock(ctx, ctx.channel, name === 'lock'));
    });
    add('slowmode', 'Configura el modo lento', '>slowmode <0-21600>', { permission: P.ManageChannels, category: 'Moderación', params: [numParam('segundos', '0 para desactivar', 0, 21600)] }, async (ctx, args) => {
        await botPermission(ctx, P.ManageChannels);
        await ctx.channel.setRateLimitPerUser(integer(args[0], 0, 21600)); await ctx.reply('Modo lento actualizado.');
    });
    add('say', 'Publica un texto con el bot', '>say <texto>', { permission: P.ManageMessages, category: 'Moderación', private: true, params: [textParam('texto', 'Mensaje para este canal')] }, async (ctx, args) => {
        const body = args.join(' '); if (!body || body.length > 1900) throw new UserError('Usa de 1 a 1900 caracteres.');
        await ctx.channel.send({ content: body, allowedMentions: { parse: [] } });
        await ctx.reply('Mensaje enviado.'); await log(ctx.guild, 'Mensaje del bot', `Solicitado por ${ctx.user.id} en ${ctx.channel.id}.`);
    });

    add('ticketsetup', 'Configura categoría y rol de soporte', '>ticketsetup <id-categoría> @soporte', optConfig(P.ManageChannels), async (ctx, args) => {
        if (args.length < 2) throw new UserError('Uso: >ticketsetup ID_CATEGORIA @Soporte. Copia el ID del encabezado de una categoría, no el de un canal.');
        const parent = await getChannel(ctx, args[0], true); const role = await getRole(ctx, args[1]);
        if (role.id === ctx.guild.id || role.managed) throw new UserError('Usa un rol específico de soporte.');
        const cfg = store.guild(ctx.guild.id); guardSelfAssignable(role.id, cfg);
        cfg.ticketCategory = parent.id; cfg.supportRole = role.id;
        store.save(); await ctx.reply('Tickets configurados. Usa >ticketpanel en el canal donde quieras el panel.');
    });
    add('ticketpanel', 'Publica el panel de tickets', '>ticketpanel', { adminOnly: true, private: true, category: 'Tickets' }, async ctx => {
        const cfg = store.guild(ctx.guild.id);
        if (!cfg.ticketCategory || !cfg.supportRole) throw new UserError('Primero usa >ticketsetup <id-categoría> @soporte.');
        const sent = await tickets.panel(ctx.channel, ctx.member);
        cfg.ticketPanelChannel = ctx.channel.id; cfg.ticketPanelMessage = sent.id; cfg.setupAt ||= Date.now(); store.save();
        await ctx.reply('Panel publicado. Los miembros pueden usar >ticket para encontrarlo.');
    });
    add('ticket', 'Indica dónde abrir tu ticket', '>ticket', { category: 'Tickets', private: true, aliases: ['tickets'] }, async ctx => {
        const c = store.guild(ctx.guild.id);
        if (!c.ticketPanelChannel || !c.ticketPanelMessage) return ctx.reply('El equipo todavía no ha publicado el panel de soporte de este servidor. Pídeles que lo configuren.');
        const channel = await ctx.guild.channels.fetch(c.ticketPanelChannel).catch(() => null);
        if (!channel?.permissionsFor(ctx.member)?.has([P.ViewChannel, P.ReadMessageHistory])) throw new UserError('El panel de soporte no está disponible para ti. Contacta al equipo del servidor.');
        if (!await channel.messages.fetch(c.ticketPanelMessage).catch(() => null)) throw new UserError('El panel fue eliminado. Pide al equipo que publique uno nuevo.');
        await ctx.reply(`Abre tu ticket en el panel de soporte: https://discord.com/channels/${ctx.guild.id}/${c.ticketPanelChannel}/${c.ticketPanelMessage}`);
    });
    add('close', 'Muestra confirmación para cerrar el ticket', '>close', { category: 'Tickets', aliases: ['cerrar'] }, async ctx => {
        const ticket = tickets.get(ctx.channel.id);
        if (!ticket || ticket.guildId !== ctx.guild.id || (ticket.ownerId !== ctx.user.id && !tickets.staff(ctx.member, store.guild(ctx.guild.id)))) throw new UserError('Solo el autor o soporte pueden cerrar un ticket registrado.');
        await ctx.reply({ content: 'Confirma para guardar la transcripción y eliminar este canal.',
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tm:ticket:confirm:${ctx.user.id}`).setLabel('Cerrar ticket').setStyle(ButtonStyle.Danger))] });
    });
    add('transcript', 'Descarga la transcripción del ticket', '>transcript', { category: 'Tickets', private: true }, async ctx => {
        const ticket = tickets.get(ctx.channel.id);
        if (!ticket || ticket.guildId !== ctx.guild.id || (ticket.ownerId !== ctx.user.id && !tickets.staff(ctx.member, store.guild(ctx.guild.id)))) throw new UserError('Solo el autor o soporte pueden exportar este ticket.');
        await ctx.reply({ files: [new AttachmentBuilder(await tickets.transcript(ctx.channel), { name: `ticket-${ctx.channel.id}.txt` })] });
    });

    const musicOptions = { category: 'Música' };
    add('join', 'Conecta al canal de voz', '>join', musicOptions, async ctx => { await music.join(ctx); await ctx.reply('Conectado al canal de voz.'); });
    add('spotify', 'Vincula tu cuenta para reproducir tus playlists', '>spotify', { ...musicOptions,private:true,guild:false }, async ctx => {
        const origin = require('./src/web').publicOrigin();
        if (!origin || process.env.WEB_ENABLED !== 'true' || !music.catalog.ready()) throw new UserError('El administrador debe configurar Spotify y el panel en Railway.');
        return privateReply(ctx,'Vincula tu cuenta en ' + origin + '/musica/spotify y después escribe >play seguido del enlace de tu playlist.');
    });
    add('play', 'Reproduce canciones o playlists de YouTube y Spotify', '>play <nombre o enlace>', { ...musicOptions, aliases: ['p'], params: [textParam('cancion', 'Nombre, YouTube, Spotify o local:ID')] }, async (ctx, args) => {
        const track = await music.play(ctx, args.join(' '));
        await ctx.reply(`Solicitud procesada: **${track.title}**. El reproductor publicará el inicio o el error en este canal.`);
    });
    for (const name of ['stop', 'skip', 'pause', 'resume', 'shuffle']) add(name, { stop: 'Detiene y desconecta', skip: 'Salta la pista', pause: 'Pausa la música', resume: 'Reanuda la música', shuffle: 'Mezcla la cola' }[name], `>${name}`, { ...musicOptions, aliases: name === 'stop' ? ['leave', 'disconnect'] : name === 'skip' ? ['next'] : [] }, async ctx => {
        await music.action(ctx, name); await ctx.reply(`✅ ${name}`);
    });
    add('volume', 'Ajusta el volumen de 0 a 100', '>volume <0-100>', { ...musicOptions, aliases: ['vol'], params: [numParam('porcentaje', 'Volumen', 0, 100)] }, async (ctx, args) => {
        const n = integer(args[0], 0, 100); await music.action(ctx, 'volume', n); await ctx.reply(`Volumen: ${n}%.`);
    });
    add('loop', 'Cambia el modo de repetición', '>loop off|song|queue', { ...musicOptions, params: [textParam('modo', 'off, song o queue')] }, async (ctx, args) => {
        if (!['off', 'song', 'queue'].includes(args[0])) throw new UserError('Usa off, song o queue.');
        await music.action(ctx, 'loop', args[0]); await ctx.reply(`Repetición: ${args[0]}.`);
    });
    add('queue', 'Muestra las siguientes canciones', '>queue', { ...musicOptions, aliases: ['q'] }, async ctx => {
        const s = music.sessions.get(ctx.guild.id);
        await ctx.reply({ embeds: [embed('Cola musical', `**Actual:** ${s?.current?.track.title || 'Ninguna'}\n\n${s?.queue.slice(0, 15).map((t, i) => `${i + 1}. ${t.title}`).join('\n') || 'Cola vacía.'}`)] });
    });
    add('nowplaying', 'Muestra la pista actual', '>nowplaying', { ...musicOptions, aliases: ['np'] }, async ctx => {
        const s = music.sessions.get(ctx.guild.id);
        if (!s?.current) throw new UserError('No hay música activa.');
        await ctx.reply({ embeds: [embed('Ahora', `${s.current.track.title}\nEstado: ${s.player.state.status}\nVolumen: ${Math.round(s.volume * 100)}%`)] });
    });
    add('audiotest', 'Prueba la voz con un tono suave', '>audiotest', { ...musicOptions, adminOnly: true }, async ctx => {
        await music.test(ctx); await ctx.reply('Prueba enviada. Si no la oyes, revisa >musicdiag.');
    });
    add('musicdiag', 'Diagnóstico de la sesión de audio', '>musicdiag', { ...musicOptions, adminOnly: true, private: true }, async ctx => privateReply(ctx, { embeds: [embed('Diagnóstico de audio', music.diagnostic(ctx.guild))] }));

    function slashDefinitions() {
        return definitions.map(d => ({ name: d.name, description: d.description.slice(0, 100),
            default_member_permissions: d.adminOnly ? P.Administrator.toString() : d.permission && !['snipe','editsnipe'].includes(d.name) ? d.permission.toString() : null,
            contexts: d.guild ? [0] : [0, 1], integration_types: [0], options: d.params }));
    }
    async function makeContext(source, isSlash = false) {
        const guild = source.guild;
        const user = isSlash ? source.user : source.author;
        const member = guild ? await guild.members.fetch(user.id) : null;
        let replied = false;
        return { guild, member, user, channel: source.channel, source, isSlash,
            async reply(payload) {
                const data = typeof payload === 'string' ? { content: payload } : payload;
                if (isSlash) {
                    if (!replied) { replied = true; return source.editReply(data); }
                    return source.followUp({ ...data, ...(source.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
                }
                return source.channel.send({ ...data, allowedMentions: data.allowedMentions || { parse: [], repliedUser: false } });
            }
        };
    }
    async function execute(ctx, name, args) {
        if (stopping) return;
        const actual = aliases.get(name) || name;
        const d = commands.get(actual);
        if (!d) {
            const cfg=ctx.guild && store.guild(ctx.guild.id);
            const action=cfg && Object.hasOwn(cfg.customActions||{},name) && cfg.customActions[name];
            if(action?.type==='timeout') {
                if(!args[0] || !args.slice(1).join(' ').trim()) throw new UserError('Usa el comando con @usuario y motivo.');
                return execute(ctx,'timeout',[args[0],String(action.minutes)+'m',...args.slice(1)]);
            }
            if (ctx.guild && Object.hasOwn(store.guild(ctx.guild.id).custom, name)) {
                await ctx.reply(render(store.guild(ctx.guild.id).custom[name], ctx.member));
            }
            return;
        }
        if (d.guild && !ctx.guild) throw new UserError('Este comando solo funciona dentro de un servidor.');
        if (ctx.guild && ctx.channel.isThread?.() && !['help', 'ping', 'ask', 'forget', 'privacy', 'sorteos'].includes(actual)) throw new UserError('Usa este comando en un canal de texto normal.');
        if (ctx.guild) {
            if (ctx.source && (d.adminOnly || d.permission)) ctx.member = await ctx.guild.members.fetch({ user: ctx.user.id, force: true });
            ctx.snipeRole = store.guild(ctx.guild.id).snipeRole;
            ctx.delegatedRoles = store.guild(ctx.guild.id).delegatedRoles;
            ctx.staffPolicy = policyOf(store.guild(ctx.guild.id));
        }
        if (!canUse(d, ctx)) throw new UserError(d.adminOnly ? 'Solo el dueño del servidor o alguien con Administrador puede usar este comando.' : 'No tienes el permiso necesario para esta acción.');
        const key = `${ctx.guild?.id || 'dm'}:${ctx.user.id}`;
        if (cooldown.get(key)) throw new UserError('Espera un momento antes del siguiente comando.');
        cooldown.set(key, true);
        return d.handler(ctx, args);
    }
    async function reportError(source, error, isInteraction = false) {
        const safe = error instanceof UserError ? error.message : 'La operación falló. Revisa los permisos del bot y los logs.';
        if (!(error instanceof UserError)) console.error('[ERROR]', error.code || '', error.message?.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 1000));
        const data = { content: `❌ ${safe}`, allowedMentions: { parse: [], repliedUser: false } };
        try {
            if (isInteraction) {
                if (source.deferred || source.replied) await source.editReply(data);
                else await source.reply({ ...data, flags: MessageFlags.Ephemeral });
            } else await source.channel.send(data);
        } catch { /* Puede haberse eliminado el canal o cerrado el DM. */ }
    }
    async function autoModerate(message) {
        const cfg = store.guild(message.guild.id);
        if (!cfg.automod || !message.member || checkStaff(message.member) || message.author.bot) return false;
        const key = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
        const times = (spam.get(key) || []).filter(t => Date.now() - t < 5000);
        times.push(Date.now()); spam.set(key, times);
        if (times.length < 6) return false;
        await message.delete().catch(() => {});
        const sanctionKey = `${message.guild.id}:${message.author.id}`;
        if (autoSanctions.get(sanctionKey)) return true;
        autoSanctions.set(sanctionKey, true);
        let result = 'Se detectó spam; no fue posible aplicar timeout.';
        if (message.member.moderatable && message.guild.members.me?.permissions.has(P.ModerateMembers)) {
            try { await message.member.timeout(60000, 'Antispam: 6 mensajes en 5 segundos'); result = 'Timeout de 1 minuto aplicado.'; } catch {}
        }
        await log(message.guild, 'Antispam', `${message.author.id} en ${message.channel.id}. ${result}`);
        return true;
    }
    async function handleBanRequest(message) {
        if (!message.guild) return false;
        const key = [message.guild.id, message.channel.id, message.author.id].join(':');
        const pending = banPrompts.get(key);
        const answering = pending && message.reference?.messageId === pending.promptId;
        const request = /^<@!?(\d+)>[,\s]+(?:ban[eé]ame|banea)(?:\s+a)?\s+<@!?(\d{17,20})>(?:[.!]?|\s+motivo\b\s*:?\s*([\s\S]*))$/iu.exec(message.content.trim());
        if (!answering && (!request || request[1] !== client.user.id)) return false;
        const ctx = await makeContext(message);
        ctx.member = await ctx.guild.members.fetch({ user: ctx.user.id, force: true });
        if (!isAdmin(ctx.member, ctx.guild) || ['staff','mod'].includes(rank(ctx.member,ctx.guild,policyOf(store.guild(ctx.guild.id))))) {
            banPrompts.delete(key);
            throw new UserError('Solo el dueño o un miembro con Administrador puede solicitar un baneo por mención.');
        }
        if (answering) {
            if (banPrompts.get(key) !== pending) return true;
            const reason = message.content.trim();
            if (!reason || reason.length > 450) throw new UserError('Responde al mensaje original con un motivo de 1 a 450 caracteres.');
            banPrompts.delete(key);
            if (/^cancelar$/i.test(reason)) await ctx.reply('Solicitud cancelada.');
            else await commands.get('ban').handler(ctx, [pending.targetId, reason]);
            return true;
        }
        const inlineReason = request[3]?.trim();
        if (inlineReason) {
            if (inlineReason.length > 450) throw new UserError('El motivo puede tener hasta 450 caracteres.');
            banPrompts.delete(key);
            await commands.get('ban').handler(ctx, [request[2], inlineReason]);
            return true;
        }
        const target = await modTarget(ctx, request[2], P.BanMembers);
        if (!target.bannable) throw new UserError('Discord no permite que Timmy banee a este miembro.');
        const prompt = await ctx.reply('¿Cuál es el motivo para banear a <@' + target.id + '>? Usa **Responder** en este mensaje y escribe el motivo para ejecutar el baneo, o escribe **cancelar** como respuesta. Tienes 2 minutos.');
        banPrompts.set(key, { promptId: prompt.id, targetId: target.id });
        return true;
    }
    function messageFiles(message) {
        return Array.from(message?.attachments?.values() ?? []);
    }
    client.on('messageCreate', async message => {
        if (message.author.bot || message.webhookId || stopping) return;
        try {
            if (message.guild && boostTypes.has(message.type)) {
                if (store.guild(message.guild.id).boosts.enabled) {
                    const member = await message.guild.members.fetch({ user: message.author.id, force: true });
                    await rewards.syncBoost(member, { systemId: message.id, systemTime: message.createdTimestamp });
                }
                return;
            }
            if (message.guild && await autoModerate(message)) return;
            if (await handleBanRequest(message)) return;
            const cfg = message.guild ? store.guild(message.guild.id) : null;
            const prefixes = [...new Set([cfg?.prefix, process.env.PREFIX, '>', ','].filter(Boolean))].sort((a, b) => b.length - a.length);
            const prefix = prefixes.find(p => message.content.startsWith(p));
            if (prefix) {
                const args = tokenize(message.content.slice(prefix.length).trim());
                const name = args.shift()?.toLowerCase(); if (!name) return;
                const ctx = await makeContext(message);
                ctx.rawArgs = message.content.slice(prefix.length).trim().replace(/^\S+\s*/, '');
                await execute(ctx, name, args); return;
            }
            if (!message.guild) {
                const attachments = messageFiles(message);
                if (!message.content.trim() && !attachments.length) return message.channel.send('Escribe tu consulta o adjunta una foto JPG, PNG o WebP.');
                await message.channel.sendTyping().catch(() => {});
                await respondAI(await makeContext(message), message.content, { attachments }); return;
            }
            const ticket = tickets.get(message.channel.id);
            const mention = new RegExp(`<@!?${client.user.id}>`, 'g');
            const directlyMentioned = message.content.match(mention);
            const verificationTicket = cfg.verificationTickets[message.channel.id];
            if (!ticket && !verificationTicket && !directlyMentioned && cfg.levels.enabled) {
                await rewards.award(message).catch(error => console.warn('[NIVELES]', error.code || error.message));
            }
            if (verificationTicket && !directlyMentioned) return;
            let savedReaction;
            if (!ticket && !directlyMentioned) {
                const rule = matchingRule(cfg, message.content);
                if (rule) {
                    savedReaction = rule.reaction;
                    const key = `${message.guild.id}:${message.channel.id}:${message.author.id}:${rule.trigger}`;
                    if (!replyCooldown.get(key)) {
                        replyCooldown.set(key, true);
                        await applyRule(rule, await makeContext(message));
                    }
                }
            }
            if (cfg.reactions.length && !reactionCooldown.get(`${message.guild.id}:${message.author.id}`)) {
                const matches = cfg.reactions.filter(r => r.emoji !== savedReaction && message.content.toLocaleLowerCase('es').includes(r.trigger)).slice(0, 3);
                if (matches.length) reactionCooldown.set(`${message.guild.id}:${message.author.id}`, true);
                for (const rule of matches) await message.react(emojis.resolve(rule.emoji, true)).catch(() => {});
            }
            if (directlyMentioned || ticket?.guildId === message.guild.id && ticket.aiActive && ticket.ownerId === message.author.id) {
                const text = message.content.replace(mention, '').trim();
                // Ticket evidence is for staff unless the sender addresses Timmy.
                const attachments = directlyMentioned ? messageFiles(message) : [];
                if (!text && !attachments.length) {
                    if (!directlyMentioned && message.attachments?.size) {
                        if (ticket?.aiActive) await respondAI(await makeContext(message), '', { attachments: [] });
                        return;
                    }
                    return message.channel.send('Escribe tu pregunta o adjunta una foto al mencionarme.');
                }
                await message.channel.sendTyping().catch(() => {});
                await respondAI(await makeContext(message), text, { allowMemory: Boolean(directlyMentioned && !ticket), attachments });
            }
        } catch (error) { await reportError(message, error); }
    });
    client.on('interactionCreate', async interaction => {
        try {
            if (await socialCenter.handle(interaction,client)) return;
            if (await communityExpansion.interaction(interaction)) return;
            if (await giveaways.handle(interaction) || await boosterRoles.handle(interaction)) return;
            if (await community.handle(interaction) || await verification.handle(interaction)) return;
            if (await handleSetup(interaction)) return;
            if (await studio.handle(interaction)) return;
            if (await tickets.handle(interaction)) return;
            if (interaction.isButton() && interaction.customId.startsWith('tm:role:')) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (!interaction.guild) throw new UserError('Solo funciona en el servidor.');
                const cfg = store.guild(interaction.guildId);
                const roleId = interaction.customId.split(':')[2];
                if (cfg.roleButtons[interaction.message.id] !== roleId) throw new UserError('Este panel ya no está registrado.');
                const role = await interaction.guild.roles.fetch(roleId);
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const me = await interaction.guild.members.fetchMe();
                requirePermission(me, P.ManageRoles); safeRole(role, me);
                guardCommunityRole(role, cfg); guardEarnedRole(role, cfg);
                const remove = member.roles.cache.has(roleId);
                await member.roles[remove ? 'remove' : 'add'](role, 'Panel de roles voluntario');
                await interaction.editReply({ content: remove ? 'Rol retirado.' : 'Rol añadido.' }); return;
            }
            if (!interaction.isChatInputCommand()) return;
            const d = commands.get(interaction.commandName);
            if (!d) return interaction.reply({ content: 'Comando antiguo. Vuelve a abrir el menú / y usa /help.', flags: MessageFlags.Ephemeral });
            const askTopic = d.name === 'ask' && topicOf(String(interaction.options.get('pregunta')?.value || ''));
            const privateAnswer = d.private || askTopic === 'personal-role' || askTopic === 'giveaways';
            await interaction.deferReply(privateAnswer ? { flags: MessageFlags.Ephemeral } : {});
            const args = [];
            if (d.name === 'access') args.push(...accessArguments(interaction.options));
            else for (const p of d.params) {
                const value = interaction.options.get(p.name)?.value;
                if (value !== undefined && value !== null) {
                    if (p.name === 'opciones') args.push(...tokenize(String(value)));
                    else args.push(String(value));
                }
            }
            const ctx = await makeContext(interaction, true);
            if (d.raw) ctx.rawArgs = interaction.options.get('opciones')?.value || '';
            if (d.name === 'ask') ctx.rawArgs = interaction.options.get('pregunta')?.value || '';
            await execute(ctx, d.name, args);
        } catch (error) { await reportError(interaction, error, true); }
    });
    client.on('guildCreate', guild => {
        store.guild(guild.id); store.save();
        console.log(`[SERVIDOR] Configuración independiente lista: ${guild.id}`);
    });
    function setSnipe(guild, enabled, roleId) {
        store.patchGuild(guild.id, { snipe: enabled, ...(roleId !== undefined && {snipeRole:roleId}) });
        if (!enabled) for (const ch of guild.channels.cache.values()) { snipes.delete(ch.id); edits.delete(ch.id); }
    }
    async function assignWelcomeRole(member) {
        const cfg = store.guild(member.guild.id);
        if (!cfg.autorole || member.user.bot) return;
        const role = await member.guild.roles.fetch(cfg.autorole);
        const me = await member.guild.members.fetchMe();
        requirePermission(me, P.ManageRoles); safeRole(role, me);
        guardCommunityRole(role, cfg); guardEarnedRole(role, cfg);
        await member.roles.add(role, 'Autorrol de bienvenida');
    }
    client.on('guildMemberUpdate', async (before, member) => {
        if (member.user.bot || before.premiumSinceTimestamp === member.premiumSinceTimestamp) return;
        await Promise.resolve(boosterRoles.cleanup(member.guild, member.id)).catch(error => console.warn('[ROL BOOST]', error.code || error.name));
        await rewards.syncBoost(member).catch(error => console.warn('[BOOST]', error.code || error.name));
    });
    client.on('guildMemberAdd', async member => {
        try {
            await protection.joined(member).catch(error => console.warn('[AUTOROLE]', error.code || error.message));
            await sendGreeting(member, store, 'welcome');
            await log(member.guild, 'Miembro nuevo', `${member.user.username} (${member.id})`);
        } catch (error) { console.error('[WELCOME]', error.message); }
    });
    client.on('guildMemberRemove', async member => {
        try {
            await Promise.resolve(boosterRoles.cleanup(member.guild, member.id, true)).catch(error => console.warn('[ROL BOOST]', error.code || error.name));
            await rewards.departed(member.guild, member.id);
            await sendGreeting(member, store, 'goodbye');
            await log(member.guild, 'Miembro salió', `${member.id}`);
        } catch (error) { console.error('[GOODBYE]', error.message); }
    });
    client.on('messageDelete', message => {
        if (!message.guild || !message.author || message.author.bot || !message.content || !store.guild(message.guild.id).snipe) return;
        snipes.set(message.channel.id, { author: message.author.username, text: cut(message.content, 3500) });
    });
    client.on('messageUpdate', (old, next) => {
        if (!old.guild || !old.author || old.author.bot || !old.content || old.content === next.content || !store.guild(old.guild.id).snipe) return;
        edits.set(old.channel.id, { author: old.author.username, text: `**Antes:**\n${cut(old.content, 1700)}\n\n**Después:**\n${cut(next.content, 1700)}` });
    });
    client.on('channelDelete', channel => {
        snipes.delete(channel.id); edits.delete(channel.id);
        if (channel.guild) {
            if (store.guild(channel.guild.id).verificationTickets[channel.id]) verification.record(channel.guild, channel.id, null);
            protection.observe(channel.guild, 'deletions').catch(error => console.warn('[PROTECTION]', error.code || error.name));
        }
        if (store.data.tickets[channel.id]) { delete store.data.tickets[channel.id]; store.save(); }
    });
    client.on('roleDelete', role => protection.observe(role.guild, 'deletions').catch(error => console.warn('[PROTECTION]', error.code || error.name)));
    const emptyVoiceTimers = new Map();
    client.on('voiceStateUpdate', (old, next) => {
        const s = music.sessions.get(next.guild.id); if (!s) return;
        if (next.id === client.user.id && next.channelId !== s.voiceId) {
            music.serial.run(s.guildId, () => music._destroy(s)).catch(console.error); return;
        }
        const channel = next.guild.channels.cache.get(s.voiceId);
        if (!channel) return;
        if(music.isPinned(s)){clearTimeout(emptyVoiceTimers.get(s.guildId));emptyVoiceTimers.delete(s.guildId);return;}
        if (channel.members.some(m => !m.user.bot)) {
            clearTimeout(emptyVoiceTimers.get(s.guildId)); emptyVoiceTimers.delete(s.guildId); return;
        }
        if (emptyVoiceTimers.has(s.guildId)) return;
        const timer = setTimeout(() => {
            emptyVoiceTimers.delete(s.guildId);
            music.serial.run(s.guildId, () => {
                if (music.sessions.get(s.guildId) === s && !music.isPinned(s) && !channel.members.some(m => !m.user.bot)) music._destroy(s);
            }).catch(console.error);
        }, 30000); timer.unref(); emptyVoiceTimers.set(s.guildId, timer);
    });
    client.on('error', error => console.error('[CLIENT]', error.message));
    client.once('clientReady', async () => {
        console.log(`✅ Timmy Max v3.3 conectado como ${client.user.tag}`);
        giveaways.start(); birthdays.start();
        emojis.refresh().catch(error => console.warn('[EMOJI] Usando los equivalentes de teclado:', error.code || error.name));
        for (const guild of client.guilds.cache.values()) {
            store.guild(guild.id);
            protection.schedule(guild);
            voiceMaster.reconcile(guild).catch(e=>console.warn('[VOICE MASTER]',e.code||e.name));
            for (const id of Object.keys(store.guild(guild.id).personalRoles)) Promise.resolve(boosterRoles.cleanup(guild,id)).catch(error => console.warn('[ROL BOOST]',error.code || error.name));
            rewards.reconcile(guild).catch(error => console.warn('[BOOST]', error.code || error.name));
        }
        store.save();
        console.log(`🧠 Archivo de memoria: ${store.file}`);
        if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_VOLUME_MOUNT_PATH) console.warn('⚠️ Conecta un volumen /data para conservar los datos.');
        console.log(generateDependencyReport());
        client.user.setPresence({ activities: [{ name: '>help • Soporte, comunidad y música', type: ActivityType.Listening }], status: 'online' });
        if (process.env.REGISTER_SLASH !== 'false') {
            try {
                await client.application.commands.set(slashDefinitions());
                if (process.env.GUILD_ID) {
                    const guild = await client.guilds.fetch(process.env.GUILD_ID);
                    const local = slashDefinitions().map(({ contexts, integration_types, ...d }) => d);
                    await guild.commands.set(local);
                }
                console.log(`✅ ${definitions.length} comandos / registrados.`);
            } catch (error) { console.error('[SLASH] Revisa GUILD_ID e invitación con applications.commands:', error.message); }
        }
        officialRuntime.start();
    });
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        for (const timer of emptyVoiceTimers.values()) clearTimeout(timer);
        await giveaways.close(); await birthdays.close();
        await officialRuntime.close();roblox.close();music.closeAll(); protection.close(); rewards.close(); store.save();
        if (webServer) await webServer.close();
        await client.destroy();
    }
    async function startWeb() {
        if (process.env.WEB_ENABLED !== 'true' || webServer) return;
        const { createWeb } = require('./src/web');
        webServer = createWeb({ client, store, definitions, rewards, community, birthdays, ai, music, security, communityExpansion, voiceMaster, roblox, catalog: music.catalog });
        const port = Number(process.env.PORT || 8080);
        await webServer.listen(port);
        console.log(`[WEB] Página de comandos escuchando en ${port}.`);
    }
    return { client, store, music, ai, tickets, studio, giveaways, rewards, birthdays, boosterRoles, commands, definitions, slashDefinitions, execute, startWeb, shutdown };
}
if (require.main === module) {
    if (!process.env.DISCORD_TOKEN) {
        console.error('Falta DISCORD_TOKEN en Variables de Railway o .env.'); process.exit(1);
    }
    let app;
    try { app = buildBot(); }
    catch (error) { console.error('[INICIO]', error.message); process.exit(1); }
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        app.shutdown().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
    });
    process.on('unhandledRejection', error => {
        console.error('[FATAL]', error?.message || 'Promesa no atendida');
        app.shutdown().finally(() => process.exit(1));
    });
    app.startWeb().then(() => app.client.login(process.env.DISCORD_TOKEN)).catch(error => {
        console.error('No se pudo iniciar:', error.message); process.exit(1);
    });
}
module.exports = { buildBot };
