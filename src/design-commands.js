'use strict';
const { AttachmentBuilder } = require('discord.js');
const { UserError } = require('./core');
const { isAdmin } = require('./access');
const { validateTemplate, renderTemplate, greetings, saveGreetings, DEFAULT_TEMPLATE } = require('./templates');
function take(text) { const m = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(text || ''); return [m?.[1] || '', m?.[2] || '']; }
function raw(ctx,args) { return ctx.rawArgs ?? args.join(' '); }
function installDesignCommands({add,store,studio,ai,tickets,getChannel,optConfig}) {
    for (const kind of ['welcome','goodbye']) add(kind, kind === 'welcome' ? 'Bienvenidas con texto, embeds y editor' : 'Despedidas con texto, embeds y editor', `>${kind} add #canal <plantilla> | edit|view|test|remove #canal | list | off`, {...optConfig(),raw:true}, async (ctx,args)=>{
        const cfg=store.guild(ctx.guild.id);
        const [action,tail]=take(raw(ctx,args));
        const entries=greetings(cfg,kind);
        if(action==='off') { saveGreetings(cfg,kind,[]); store.save(); return ctx.reply('Mensajes automáticos desactivados en este servidor.'); }
        if(action==='list') return ctx.reply(entries.map(e=>`• <#${e.channelId}>`).join('\n') || 'No hay mensajes configurados.');
        if(['view','test','edit','remove'].includes(action)) {
            const ch=await getChannel(ctx,tail.trim() || entries[0]?.channelId);
            const entry=entries.find(e=>e.channelId===ch.id);
            if (!entry && action!=='edit') throw new UserError('Ese canal no tiene un mensaje configurado.');
            if(action==='remove') { saveGreetings(cfg,kind,entries.filter(e=>e.channelId!==ch.id)); store.save(); return ctx.reply('Mensaje automático eliminado de ese canal.'); }
            if(action==='view') return ctx.reply({files:[new AttachmentBuilder(Buffer.from(entry.text),{name:`${kind}.txt`})]});
            if(action==='test') { await ch.send(renderTemplate(validateTemplate(entry.text,ctx.member),ctx.member,{pingUser:kind==='welcome'})); return ctx.reply('Prueba enviada.'); }
            return studio.create(ctx,entry?.text || defaultSource(kind),{channelId:ch.id,save:text=>save(ch.id,text)});
        }
        const [channelInput,source]=action==='add' ? take(tail) : [action,tail];
        if(!channelInput) throw new UserError(`Usa >${kind} add #canal {embed}$v{description: Hola {user.mention}}`);
        const ch=await getChannel(ctx,channelInput);
        const text=source || defaultSource(kind);
        validateTemplate(text,ctx.member); save(ch.id,text);
        await ctx.reply(`Guardado en <#${ch.id}>. Prueba con >${kind} test <#${ch.id}> o abre el editor con >${kind} edit <#${ch.id}>.`);
        function save(channelId,text) {
            validateTemplate(text,ctx.member);
            const current=greetings(cfg,kind).filter(e=>e.channelId!==channelId);
            if(current.length>=5) throw new UserError('Máximo 5 canales por bienvenida o despedida.');
            saveGreetings(cfg,kind,[...current,{channelId,text}]); store.save();
        }
    });
    const opts={...optConfig(),category:'Diseño',adminOnly:true,raw:true};
    add('embed','Crea un borrador con editor y publicación','>embed [#canal] [plantilla]',{...opts,aliases:['ce'],params:[{type:3,name:'opciones',description:'Canal opcional y plantilla {embed}$v{description: texto}',required:false}]},async(ctx,args)=>{
        let source=raw(ctx,args), channelId=ctx.channel.id;
        const [first,rest]=take(source);
        if (/^(?:<#\d{17,20}>|\d{17,20})$/.test(first)) { channelId=(await getChannel(ctx,first)).id; source=rest; }
        await studio.create(ctx,source || DEFAULT_TEMPLATE,{channelId});
    });
    async function draftAI(ctx,text) {
        if(!isAdmin(ctx.member,ctx.guild)) throw new UserError('Solo el dueño o un administrador puede preparar anuncios con el bot.');
        if(!store.guild(ctx.guild.id).ai) throw new UserError('La IA está desactivada en este servidor.');
        const mentioned=text.match(/<#(\d{17,20})>/)?.[1];
        const channel=mentioned ? await getChannel(ctx,mentioned) : ctx.channel;
        const source=await ai.draft(ctx.user.id,text);
        let model;
        try { model=validateTemplate(source,ctx.member); if(!model.embeds.length) throw new Error(); }
        catch { throw new UserError('La IA devolvió un formato inválido. Prueba de nuevo o usa >embed para escribirlo tú.'); }
        // The model only drafts content. The caller, not the model, selects destination and pings.
        await studio.create(ctx,model,{channelId:channel.id});
    }
    add('embedai','Diseña un anuncio con IA antes de publicarlo','>embedai #canal <instrucciones>',opts,async(ctx,args)=>draftAI(ctx,raw(ctx,args)));
    add('ticketdesign','Edita el aspecto del panel de tickets','>ticketdesign [plantilla | reset]',{...opts,category:'Tickets',params:[{type:3,name:'opciones',description:'Plantilla opcional o reset',required:false}]},async(ctx,args)=>{
        const cfg=store.guild(ctx.guild.id), source=raw(ctx,args);
        if(source==='reset') { cfg.ticketTemplate=null; store.save(); return ctx.reply('Diseño predeterminado restaurado. Usa >ticketpanel para publicarlo.'); }
        await studio.create(ctx,source || cfg.ticketTemplate || '{embed}$v{title: Abrir un ticket}$v{description: Selecciona el motivo para hablar con el equipo de {guild.name}.}$v{color: #b8a5ff}',{save:text=>{cfg.ticketTemplate=text;store.save();}});
    });
    add('ticketstyle','Elige menú o botones para abrir tickets','>ticketstyle menu|buttons',{...opts,category:'Tickets'},async(ctx,args)=>{
        const style=args[0]; if(!['menu','buttons'].includes(style)) throw new UserError('Usa menu o buttons.');
        store.guild(ctx.guild.id).ticketStyle=style;store.save();await ctx.reply('Estilo guardado. Usa >ticketpanel para publicar el panel actualizado.');
    });
    add('ticketoption','Configura las opciones y preguntas del ticket','>ticketoption add clave "Etiqueta" "Emoji" "Pregunta" | remove clave | list | reset',{...optConfig(),category:'Tickets',adminOnly:true},async(ctx,args)=>{
        const cfg=store.guild(ctx.guild.id), options=tickets.options(cfg);
        if(args[0]==='list') return ctx.reply(options.map(o=>`• ${o.key}: ${o.label} — ${o.question}`).join('\n'));
        if(args[0]==='reset') cfg.ticketOptions=null;
        else if(args[0]==='remove') {
            if(!options.some(o=>o.key===args[1])) throw new UserError('Esa opción no existe.');
            if(options.length===1) throw new UserError('Conserva al menos una opción.');
            cfg.ticketOptions=options.filter(o=>o.key!==args[1]);
        } else if(args[0]==='add') {
            const [,key,label,emoji,question]=args;
            if(!/^[a-z0-9_-]{1,24}$/.test(key || '') || !label || label.length>45 || !question || question.length>45 || args.length!==5) throw new UserError('Usa add clave "Etiqueta (máx. 45)" "Emoji o -" "Pregunta (máx. 45)".');
            const next=[...options.filter(o=>o.key!==key),{key,label,question,...(emoji!=='-'?{emoji}: {})}];
            if(next.length>5) throw new UserError('Máximo 5 opciones.');
            tickets.menu({...cfg,ticketOptions:next}); // Validate emoji and component limits before saving.
            cfg.ticketOptions=next;
        } else throw new UserError('Usa add, remove, list o reset.');
        store.save();await ctx.reply('Opciones guardadas para este servidor. Vuelve a publicar con >ticketpanel.');
    });
    return {draftAI};
}
function defaultSource(kind) { return kind==='welcome' ? DEFAULT_TEMPLATE : '{embed}$v{description: {user.name} salió de {guild.name}.}$v{thumbnail: {user.avatar}}$v{footer: Quedamos {guild.count} miembros}'; }
async function sendGreeting(member,store,kind) {
    for(const entry of greetings(store.guild(member.guild.id),kind)) {
        try {
            const ch=await member.guild.channels.fetch(entry.channelId);
            await ch.send(renderTemplate(validateTemplate(entry.text,member),member,{pingUser:kind==='welcome'}));
        } catch(error) { console.error(`[${kind.toUpperCase()}]`,entry.channelId,error.message); }
    }
}
module.exports={installDesignCommands,sendGreeting,take};
