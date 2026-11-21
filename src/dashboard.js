'use strict';
const { createHash } = require('node:crypto');
const { ChannelType } = require('discord.js');
const { UserError, integer, idOf, Serial, updateKnowledge } = require('./core');
const { P } = require('./permissions');
const { greetings, parseTemplate, renderTemplate, serializeTemplate, validateTemplate } = require('./templates');
const { DEFAULT_MESSAGES, XP_PER_LEVEL, levelOf } = require('./rewards');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tabs = { welcome:'Bienvenidas', goodbye:'Despedidas', levels:'Avisos de nivel', xp:'Experiencia', snipe:'Snipe y roles', boosts:'Boosts', birthday:'Cumpleaños', knowledge:'Información de la IA' };
const hidden = (k,v) => `<input type="hidden" name="${k}" value="${esc(v)}">`;
const input = (name,label,value,max=100) => `<label>${label}<input name="${name}" value="${esc(value)}" maxlength="${max}"></label>`;
const area = (name,label,value,max=4000) => `<label>${label}<textarea rows="4" name="${name}" maxlength="${max}">${esc(value)}</textarea></label>`;
const versions = list => createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0,24);
const captures = new Serial();
function choices(name,label,items,value,empty) {
    return `<label>${label}<select name="${name}"><option value="">${empty}</option>${items.map(i=>`<option value="${esc(i.id)}" ${i.id===value?'selected':''}>${esc(i.name)}</option>`).join('')}</select></label>`;
}
function collection(kind,label,rows) {
    const field=kind==='field';
    function row(item) {
        return `<div class="form-pair" data-row>${input(kind+'Name',field?'Nombre':'Texto del botón',item.name || item.label,field?256:80)}${input(kind+'Value',field?'Valor':'URL',item.value || item.url,field?1024:2048)}
        ${field?`<label>Disposición<select name="fieldInline"><option value="false">En bloque</option><option value="true" ${item.inline?'selected':''}>En línea</option></select></label>`:input('linkEmoji','Emoji opcional',item.emoji,80)}
        <button type="button" class="quiet" data-remove>Quitar</button></div>`;
    }
    return `<fieldset data-collection data-limit="${field?25:5}"><legend>${label}</legend><div data-rows>${rows.map(row).join('')}</div><template>${row({})}</template><button type="button" class="quiet" data-add>Añadir ${field?'campo':'botón'}</button><input type="hidden" name="${kind}Editor" value="1"></fieldset>`;
}
const upload = target => `<label>Subir imagen<input type="file" data-upload="${target}" accept="image/png,image/jpeg,image/gif,image/webp"></label><small role="status"></small>`;
function editor(source) {
    const model = parseTemplate(source || 'Escribe tu mensaje.');
    const first = model.embeds[0];
    const simpleImage=model.content && model.embeds.length===1 && Object.keys(first).every(k=>k==='image') && !model.buttons.length;
    const card=!model.content && model.embeds.length===1 && first.image && Object.keys(first).every(k=>['image','title','description'].includes(k)) && !model.buttons.length;
    return `<section class="editor-block"><h2>Mensaje</h2><label>Formato<select name="format"><option value="simple" ${!first||simpleImage?'selected':''}>Texto simple</option><option value="embed" ${first&&!simpleImage&&!card?'selected':''}>Embed enriquecido</option><option value="card" ${card?'selected':''}>Tarjeta con imagen</option><option value="raw">Plantilla completa</option></select></label>
        <div data-edit="simple">${area('plain','Mensaje de texto',model.content,2000)}${input('plainImage','Imagen opcional (URL)',simpleImage?first.image:'',2048)}${upload('plainImage')}</div>
        <div data-edit="embed">${area('outside','Mensaje encima del embed',model.content,2000)}${input('author','Nombre del autor',first?.author?.text,256)}${input('title','Título',first?.title,256)}${area('description','Descripción',first?.description,4096)}
        <div class="form-pair"><label>Color<input type="color" name="color" value="${esc('#'+(first?.color || 'aa93ff').replace(/^#/,''))}"></label>${input('image','Imagen o GIF (URL)',first?.image,2048)}${upload('image')}</div>
        ${input('thumbnail','Miniatura (URL o {user.avatar})',first?.thumbnail,2048)}${input('footer','Pie del embed',first?.footer?.text,2048)}
        ${collection('field','Campos',first?.fields || [])}${collection('link','Botones de enlace',model.buttons)}</div>
        <div data-edit="card">${input('cardTitle','Título de la tarjeta',first?.title,256)}${area('cardText','Mensaje',first?.description)}${input('cardImage','Imagen de la tarjeta (URL)',first?.image,2048)}${upload('cardImage')}</div><div data-edit="raw">${area('raw','Código de la plantilla',source,12000)}</div></section>`;
}
function valueFromForm(form,original) {
    const get=k=>(form.get(k)||'').trim(), format=get('format');
    if (format==='raw') return get('raw');
    if (format==='simple') {
        if (!get('plain')) throw new UserError('Escribe el texto del mensaje.');
        return get('plainImage') ? serializeTemplate({content:get('plain'),embeds:[{image:get('plainImage')}],buttons:[]}) : get('plain');
    }
    if (format==='card') {
        if (!get('cardImage')) throw new UserError('Elige una imagen para la tarjeta.');
        return serializeTemplate({content:'',buttons:[],embeds:[{title:get('cardTitle'),description:get('cardText'),image:get('cardImage')}]});
    }
    if (format!=='embed') throw new UserError('Selecciona un formato válido.');
    const model=original ? parseTemplate(original) : {content:'',embeds:[],buttons:[]};
    if (!model.embeds.length) { model.content=''; model.embeds.push({}); }
    if (form.has('outside')) model.content=get('outside');
    Object.assign(model.embeds[0],{title:get('title'),description:get('description'),color:get('color'),image:get('image'),thumbnail:get('thumbnail')});
    if (form.has('author')) model.embeds[0].author={...model.embeds[0].author,text:get('author')};
    if (form.has('fieldEditor')) model.embeds[0].fields=form.getAll('fieldName').map((name,i)=>({name,value:form.getAll('fieldValue')[i],inline:form.getAll('fieldInline')[i]==='true'}));
    if (form.has('linkEditor')) model.buttons=form.getAll('linkName').map((label,i)=>({label,url:form.getAll('linkValue')[i],emoji:form.getAll('linkEmoji')[i]}));
    if (form.has('footer')) model.embeds[0].footer = {...model.embeds[0].footer,text:get('footer')};
    return serializeTemplate(model);
}
function settingsView({guild,cfg,section,session,url,rewards}) {
    const base='/servers/'+guild.id+'/panel';
    const go=k=>base+'?seccion='+k;
    const form=(content,revision,preview=false)=>`<form class="module-form" method="post" action="${base}" ${preview?'data-composer':''}>${hidden('csrf',session.csrf)}${hidden('section',section)}${hidden('revision',revision)}<div class="save-row">${preview?'<button class="quiet" type="button" data-jump>Vista previa</button>':''}<button class="button" type="submit">Guardar cambios</button></div>${content}</form>`;
    const channels=[...(guild.channels?.cache?.values() || [])].filter(c=>c.type===ChannelType.GuildText).map(c=>({id:c.id,name:'#'+c.name}));
    const roles=[...(guild.roles?.cache?.values() || [])].filter(r=>r.id!==guild.id && !r.managed && r.editable);
    const selectCh=(value,empty='Elige un canal')=>choices('channel','Canal de anuncios',channels,value,empty);
    const selectRole=value=>choices('role','Rol de recompensa',roles,value,'Sin rol adicional');
    const toggle=value=>`<label class="checkline"><input name="enabled" type="checkbox" ${value?'checked':''}> Módulo activo</label>`;
    const preview=`<aside class="panel-preview"><h3>Vista previa</h3><div class="preview-author"><span class="tm-icon">T</span><strong>Timmy Max</strong></div><p data-preview-outside></p><div class="preview-body"><span data-preview-avatar hidden aria-label="Avatar de ejemplo">A</span><img data-preview-thumb alt="Miniatura" hidden referrerpolicy="no-referrer"><small data-preview-author></small><strong data-preview-title></strong><p data-preview-text></p><div data-preview-extras></div><img data-preview-image alt="Imagen del embed" hidden referrerpolicy="no-referrer"><small data-preview-footer></small></div><small>Ejemplo con Alex</small>${section==='birthday'?'':`<details><summary>Probar en Discord</summary>${choices('testChannel','Canal de prueba',channels,null,'Selecciona un canal')}<button class="quiet" type="button" data-test>Enviar prueba</button><p role="status" data-test-status></p></details>`}</aside>`;
    let body;
    if (section==='snipe') {
        const available=[...(guild.roles?.cache?.values() || [])].filter(r=>r.id!==guild.id && !r.managed);
        body=form(`<section class="editor-block"><h2>Mensajes eliminados y editados</h2><p>El staff puede consultar el último texto del canal durante cinco minutos. Puedes dar acceso a un rol adicional.</p>${toggle(cfg.snipe)}${choices('role','Rol con acceso a Snipe',available,cfg.snipeRole,'Solo staff con permisos')}</section>`,versions([cfg.snipe,cfg.snipeRole]));
    } else if (section==='xp') {
        const query=(url.searchParams.get('usuario') || '').trim();
        if (query && !/^\d{17,20}$/.test(query)) throw new UserError('Busca por el ID de Discord del miembro.');
        const page=integer(url.searchParams.get('p') || '0',0,1000000), board=rewards.leaderboard(guild.id,page,query);
        const table=board.rows.map((r,j)=>`<tr><td>${query?'—':page*25+j+1}</td><td>${esc(guild.members.cache?.get(r.user)?.displayName || 'Miembro')}<small>${esc(r.user)}</small></td><td>${levelOf(r.total)}</td><td>${r.total}</td><td><button type="button" class="quiet" data-xp-user="${r.user}" data-xp-total="${r.total}">Editar</button></td></tr>`).join('');
        body=`<section class="editor-block"><h2>Clasificación del servidor</h2><form class="find-member" method="get">${hidden('seccion','xp')}<label>ID de Discord<input name="usuario" value="${esc(query)}" placeholder="Buscar miembro"></label><button class="quiet">Buscar</button></form>
            <div class="xp-scroll"><table><thead><tr><th>Puesto</th><th>Miembro</th><th>Nivel</th><th>XP total</th><th></th></tr></thead><tbody>${table}</tbody></table></div>${table?'':'<p>Todavía no hay XP para esta consulta.</p>'}
            <nav class="page-nav">${page?`<a href="${go('xp')}&amp;p=${page-1}">Anterior</a>`:''}${board.more?`<a href="${go('xp')}&amp;p=${page+1}">Siguiente</a>`:''}</nav></section>`+
            form(`<section class="editor-block"><h2>Ajustar experiencia</h2><p>Cada ${XP_PER_LEVEL} XP equivalen a un nivel. El total que guardes actualizará los roles de nivel del miembro.</p><div class="form-pair">${input('user','ID del miembro',query,20)}<label>Nuevo total de XP<input type="number" name="total" min="0" max="2147483647" required></label></div>${hidden('expected','')}</section>`,'');
    } else if (section==='knowledge') {
        const key=url.searchParams.get('ficha') || '', pages=cfg.knowledgePages;
        const list=Object.keys(pages).map(k=>`<a class="pill" href="${go(section)}&amp;ficha=${encodeURIComponent(k)}">${esc(k)}</a>`).join(' ');
        body=form(`<section class="editor-block"><h2>Fichas de tu comunidad</h2><p>Para explicar cómo se reclaman los beneficios, guarda una ficha llamada <code>reclamar-boost</code>.</p><div class="chips">${list}</div>${input('name','Nombre de la ficha',key,32)}${area('copy','Lo que Timmy debe explicar',Object.hasOwn(pages,key)?pages[key]:'')}</section>`,cfg.knowledgeRevision);
    } else if (section==='birthday') {
        const s=cfg.birthday;
        body=form(`<section class="editor-block"><h2>Celebración automática</h2>${toggle(s.enabled)}<p>Los miembros registran su día y mes con <code>&gt;cumple 21/11</code>. El rol dura 24 horas.</p><div class="form-pair">${selectCh(s.channelId,'Solo entregar el rol')}${choices('role','Rol de cumpleaños',[...roles, {id:'create',name:'Crear rol Cumpleaños 🎂'}],s.roleId,'Solo enviar el mensaje')}</div><div class="form-pair">${input('timezone','Zona horaria',s.timezone)}<label>Hora local<input type="time" name="hour" value="${esc(s.hour)}" required></label></div></section><section class="editor-block"><h2>Mensaje de celebración</h2>${area('birthdayText','Texto para el canal',s.text,1800)}<small>Usa {user} para mencionar al cumpleañero.</small></section>${preview}`,s.revision,true);
    } else {
        const isGreeting=section==='welcome'||section==='goodbye', entries=isGreeting?greetings(cfg,section):[];
        const requested=url.searchParams.get('canal'), current=entries.find(e=>e.channelId===requested)||(!requested?entries[0]:null);
        const s=isGreeting?{}:cfg[section], source=isGreeting?current?.text:s.template || DEFAULT_MESSAGES[section];
        const links=entries.map(e=>`<a class="pill" href="${go(section)}&amp;canal=${e.channelId}">#${esc(guild.channels.cache.get(e.channelId)?.name || e.channelId)}</a>`).join(' ');
        const dest=isGreeting ? `<div class="chips">${links} <a href="${go(section)}&amp;canal=nuevo">Nuevo mensaje</a></div>${hidden('original',current?.channelId || '')}${selectCh(current?.channelId)}<label class="checkline"><input name="ignoreBots" type="checkbox" ${current?.ignoreBots?'checked':''}> Ignorar cuentas de bots</label>` :
            toggle(s.enabled)+selectCh(s.channelId,section==='levels'?'Canal donde se ganó la XP':'Elige un canal')+
            (section==='boosts'?selectRole(s.roleId)+area('perks','Beneficios que recibe el booster',s.perks,1000):'');
        const tokens=section==='levels'?'{user.mention} · {level.new_rank} · {level.user_xp}':section==='boosts'?'{user.mention} · {boost.perks}':'{user.mention} · {guild.name}';
        body=form(`<section class="editor-block"><h2>Destino del mensaje</h2>${dest}</section>${editor(source || '')}<p class="token-guide">Variables <code>${tokens}</code></p>${preview}`,isGreeting?versions(entries):s.revision,true);
    }
    return `<div class="control-layout"><aside class="control-nav"><a class="back" href="/servers/${guild.id}">← Comandos</a><h2>${esc(guild.name)}</h2><nav aria-label="Ajustes del servidor">${Object.entries(tabs).map(([k,v])=>`<a href="${go(k)}" ${k===section?'aria-current="page"':''}>${v}</a>`).join('')}</nav></aside><section class="control-main"><h1>${tabs[section]}</h1>${url.searchParams.get('guardado')==='1'?'<p class="saved" role="status">Cambios guardados en este servidor.</p>':''}${body}</section></div>`;
}
async function saveSettings({form,guild,member,store,community,birthdays,rewards}) {
    const section=form.get('section'), get=k=>(form.get(k)||'').trim();
    if (!Object.hasOwn(tabs,section)) throw new UserError('Sección desconocida.');
    const ctx={guild,member,user:member.user || {id:member.id}};
    return captures.run(guild.id+':'+section, async()=>{
        const cfg=store.guild(guild.id), channelId=get('channel')||null, roleId=get('role')||null;
        const revision=get('revision');
        if (section==='snipe') {
            const role=roleId && guild.roles.cache.get(roleId);
            if (roleId && (!role || role.managed || role.id===guild.id)) throw new UserError('Elige un rol de este servidor.');
            if (revision!==versions([cfg.snipe,cfg.snipeRole])) throw new UserError('Snipe cambió. Recarga la página.');
            return community.save(ctx,'snipe',{enabled:form.has('enabled'),roleId},Number(cfg.snipe));
        }
        if (section==='xp') return rewards.setXp(guild,idOf(get('user')),integer(get('total'),0,2147483647),get('expected') ? integer(get('expected'),0,2147483647):null);
        if (section==='knowledge') {
            if (revision!==String(cfg.knowledgeRevision)) throw new UserError('Las fichas cambiaron. Recarga la página.');
            return updateKnowledge(store,guild.id,'add',get('name'),get('copy'));
        }
        if (section==='birthday') return birthdays.save(ctx,{enabled:form.has('enabled'),channelId,roleId,timezone:get('timezone'),hour:get('hour'),text:get('birthdayText')},Number(revision));
        if (section==='welcome'||section==='goodbye') {
            const entries=greetings(cfg,section), original=get('original');
            if (!channelId) throw new UserError('Selecciona un canal para el mensaje.');
            const ch=await guild.channels.fetch(idOf(channelId)), me=await guild.members.fetchMe();
            if (ch?.type!==ChannelType.GuildText || !ch.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]) || !ch.permissionsFor(member)?.has(P.ViewChannel)) throw new UserError('Revisa los permisos del canal elegido.');
            if (versions(greetings(cfg,section))!==revision) throw new UserError('Los mensajes cambiaron. Recarga la página.');
            if (channelId!==original && entries.some(e=>e.channelId===channelId)) throw new UserError('Ya hay un mensaje en ese canal. Selecciónalo para editarlo.');
            const text=valueFromForm(form,entries.find(e=>e.channelId===original)?.text);
            validateTemplate(text,member);
            const list=entries.filter(e=>e.channelId!==original).concat({channelId,text,ignoreBots:form.has('ignoreBots')});
            if (list.length>5) throw new UserError('Puedes tener hasta cinco canales por tipo de mensaje.');
            return store.patchGuild(guild.id,{[section+'Messages']:list,[section]:list[0]});
        }
        const s=cfg[section], template=valueFromForm(form,s.template || DEFAULT_MESSAGES[section]);
        const next={...s,template,channelId,enabled:form.has('enabled')};
        if (section==='boosts') {
            next.perks=get('perks'); next.roleId=roleId;
            if (next.perks.length>1000) throw new UserError('Los beneficios admiten hasta 1000 caracteres.');
        }
        return community.save(ctx,section,next,Number(revision));
    });
}
async function testMessage({form,guild,member,cfg}) {
    const kind=form.get('section');
    if (!['welcome','goodbye','levels','boosts'].includes(kind)) throw new UserError('Elige un módulo de mensajes.');
    const channel=await guild.channels.fetch(idOf(form.get('testChannel')));
    const me=await guild.members.fetchMe();
    if (channel?.type!==ChannelType.GuildText || !channel.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]) || !channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw new UserError('Revisa los permisos del canal de prueba.');
    const source=['welcome','goodbye'].includes(kind)?greetings(cfg,kind).find(e=>e.channelId===form.get('original'))?.text:cfg[kind].template || DEFAULT_MESSAGES[kind];
    const values={level:5,xp:500,'boost.perks':form.get('perks') || ''};
    const payload=renderTemplate(validateTemplate(valueFromForm(form,source),member,{values}),member,{values});
    await channel.send({...payload,allowedMentions:{parse:[]}});
}
module.exports={testMessage,tabs,settingsView,saveSettings,esc};
