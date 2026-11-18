'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PermissionsBitField,Collection,ChannelType}=require('discord.js');
const {Store}=require('../src/core');
const {P}=require('../src/permissions');
const {buildBot}=require('../index');
const {Studio}=require('../src/studio');
const {Assistant}=require('../src/ai');
const {parseTemplate,validateTemplate,renderTemplate,serializeTemplate,greetings,DEFAULT_TEMPLATE}=require('../src/templates');
const {sendGreeting}=require('../src/design-commands');
const A='11111111111111111',B='22222222222222222',U='33333333333333333',C='44444444444444444';
function context({guildId=A,perms=[P.Administrator]}={}) {
 const sent=[],replies=[],guild={id:guildId,name:'Mi servidor',memberCount:42,ownerId:'99999999999999999',iconURL:()=>null};
 const user={id:U,username:'Brian',displayAvatarURL:()=> 'https://cdn.discordapp.com/embed/avatars/0.png'};
 const member={id:U,user,guild,permissions:new PermissionsBitField(perms),roles:{cache:new Collection()}};
 const channel={id:C,type:ChannelType.GuildText,guild,permissionsFor:()=>new PermissionsBitField([P.Administrator]),send:async data=>{sent.push(data);return {id:'55555555555555555'};}};
 guild.channels={fetch:async()=>channel};guild.members={fetch:async()=>member,fetchMe:async()=>({id:'77777777777777777'})};
 const ctx={guild,member,user,channel,reply:async data=>replies.push(data)};
 return {ctx,guild,member,user,channel,sent,replies};
}
function app(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tm-design-'));const bot=buildBot({store:new Store(dir)});t.after(async()=>{await bot.shutdown();fs.rmSync(dir,{recursive:true,force:true});});return bot;}
function interaction(h,id,action='commit',changes={}) {return {customId:`tm:studio:${id}:${action}`,guild:h.guild,guildId:h.guild.id,user:h.user,isButton:()=>true,isModalSubmit:()=>false,isStringSelectMenu:()=>false,deferUpdate:async()=>{},editReply:async()=>{},update:async()=>{},...changes};}
test('plantilla del ejemplo conserva líneas, enlaces y variables anidadas',()=>{
 const h=context(); const source='{embed}$v{message: {user.mention}}$v{description:\n**welcome to {guild.name}**\n\n[Rules](https://discord.com/channels/1/2)\n}$v{thumbnail: {user.avatar}}$v{footer: {guild.name} now has {guild.count} members}$v{image: https://example.com/welcome.gif?a=1&b=2}';
 const p=renderTemplate(validateTemplate(source,h.member),h.member,{pingUser:true});
 assert.equal(p.content,`<@${U}>`);assert.match(p.embeds[0].description,/\n\n\[Rules\]/);assert.match(p.embeds[0].footer.text,/42 members/);assert.equal(p.embeds[0].image.url,'https://example.com/welcome.gif?a=1&b=2');assert.deepEqual(p.allowedMentions.parse,[]);assert.deepEqual(p.allowedMentions.users,[U]);
});
test('variables de usuarios no se interpretan como código de plantilla',()=>{
 const h=context();h.guild.name='x}$v{message: @everyone}';const p=renderTemplate(parseTemplate('{embed}$v{description: {guild.name}}'),h.member);assert.equal(p.content,'');assert.equal(p.embeds.length,1);assert.equal(p.embeds[0].description,h.guild.name);assert.deepEqual(p.allowedMentions.parse,[]);
});
test('valida límites, protocolo, bloques y total de embeds antes de guardar',()=>{
 const h=context();
 for(const text of ['{embed}$v{description: sin cerrar','{embed}$v{description: hola}$v{image: javascript:alert(1)}','{embed}$v{title: hola}$v{color: red}','{embed}$v{unknown: test}','{embed}$v{title: '+ 'a'.repeat(257)+'}','{embed}$v{description: '+'a'.repeat(3500)+'}$v{embed}$v{description: '+'b'.repeat(3500)+'}']) assert.throws(()=>validateTemplate(text,h.member));
});
test('exportación conserva múltiples embeds, campos y botones',()=>{
 const source='{message: hola}$v{embed}$v{author: Hola && {user.avatar} && https://example.com}$v{description: uno}$v{field: Rango && Miembro && true}$v{embed}$v{description: dos}$v{button: Reglas && https://example.com && 📄}';
 const m=parseTemplate(source); assert.deepEqual(parseTemplate(serializeTemplate(m)),m);const p=renderTemplate(m,context().member);assert.equal(p.embeds.length,2);assert.equal(p.components[0].components[0].style,5);
});
test('bienvenidas y despedidas son persistentes, separadas por canal y servidor',async t=>{
 const bot=app(t),h=context();bot.store.guild(A).welcome={channelId:'88888888888888888',text:'Hola {user}'};
 h.ctx.rawArgs=`add <#${C}> {embed}$v{description: Hola\n{user.mention}}`;
 await bot.commands.get('welcome').handler(h.ctx,[]);
 assert.equal(greetings(bot.store.guild(A),'welcome').length,2);
 assert.equal(greetings(bot.store.guild(B),'welcome').length,0);
 const restored=new Store(bot.store.directory);assert.equal(greetings(restored.guild(A),'welcome')[1].text,'{embed}$v{description: Hola\n{user.mention}}');
 await sendGreeting(h.member,restored,'welcome');assert.equal(h.sent.length,2);assert.equal(h.sent[1].embeds[0].description,`Hola\n<@${U}>`);
 h.ctx.rawArgs='off';await bot.commands.get('welcome').handler(h.ctx,[]);assert.equal(greetings(bot.store.guild(A),'welcome').length,0);
 assert.equal(greetings(bot.store.guild(A),'goodbye').length,0);
});
test('permisos de todos los nuevos comandos y alias impiden cambios por miembros',async t=>{
 const bot=app(t),h=context({perms:[P.ManageGuild,P.ManageMessages]});
 for(const name of ['welcome','goodbye','embed','ce','embedai','ticketdesign','ticketoption','ticketstyle']) await assert.rejects(bot.execute(h.ctx,name,[]),/Solo el dueño/);
 await assert.rejects(bot.commands.get('ask').handler(h.ctx,['crea un embed para #anuncios']),/Solo el dueño/);
});
test('preview no publica; otro usuario, otro servidor, permisos revocados y caducidad se rechazan',async()=>{
 const h=context(),studio=new Studio();const id=await studio.create(h.ctx,DEFAULT_TEMPLATE);
 assert.equal(h.sent.length,0);assert.deepEqual(h.replies[1].allowedMentions.parse,[]);
 await assert.rejects(studio.handle(interaction(h,id,'commit',{user:{id:'other'}})),/otra persona/);
 await assert.rejects(studio.handle(interaction(h,id,'commit',{guildId:B})),/otra persona/);
 h.member.permissions=new PermissionsBitField();await assert.rejects(studio.handle(interaction(h,id)),/Ya no tienes/);
 studio.drafts.items.get(id).expires=0;await assert.rejects(studio.handle(interaction(h,id)),/expiró/);
 assert.equal(h.sent.length,0);
});
test('doble clic publica una vez; everyone requiere botón explícito y permiso actual del bot',async()=>{
 const h=context(),studio=new Studio();const id=await studio.create(h.ctx,'{message: @everyone}$v{embed}$v{description: prueba}');
 const r=await Promise.allSettled([studio.handle(interaction(h,id)),studio.handle(interaction(h,id))]);
 assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].allowedMentions.parse,[]);
 const id2=await studio.create(h.ctx,DEFAULT_TEMPLATE);await studio.handle(interaction(h,id2,'ping'));
 h.channel.permissionsFor=()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks]);
 await assert.rejects(studio.handle(interaction(h,id2)),/Mencionar a todos/);assert.equal(h.sent.length,1);
 h.channel.permissionsFor=()=>new PermissionsBitField([P.Administrator]);await studio.handle(interaction(h,id2));assert.deepEqual(h.sent[1].allowedMentions.parse,['everyone']);assert.match(h.sent[1].content,/^@everyone/);
});
test('formularios editan el embed seleccionado; validación fallida conserva el borrador',async()=>{
 const h=context(),studio=new Studio();const id=await studio.create(h.ctx,'{embed}$v{title: Uno}$v{embed}$v{title: Dos}');
 let modal;await studio.handle(interaction(h,id,'basic',{showModal:async m=>{modal=m.toJSON();}}));assert.ok(modal.components.length<=5);
 const edit=interaction(h,id,'edit-basic:1',{isModalSubmit:()=>true,fields:{getTextInputValue:k=>({content:'',title:'Cambio',description:'Texto\nDos',color:'#ff00ff'}[k])}});
 await studio.handle(edit);const d=studio.drafts.get(id);assert.equal(d.model.embeds[0].title,'Uno');assert.equal(d.model.embeds[1].title,'Cambio');
 edit.fields.getTextInputValue=k=> k==='color'?'invalid':'';await assert.rejects(studio.handle(edit));assert.equal(d.model.embeds[1].title,'Cambio');
});
test('guardar diseño no publica; tickets personalizables no cambian los de otro servidor',async t=>{
 const bot=app(t),h=context();let saved;const id=await bot.studio.create(h.ctx,DEFAULT_TEMPLATE,{save:text=>{saved=text;}});
 await bot.studio.handle(interaction(h,id));assert.equal(h.sent.length,0);assert.match(saved,/\{guild.name\}/);
 await bot.commands.get('ticketoption').handler(h.ctx,['add','alianzas','Alianzas','🤝','¿Qué comunidad representas?']);
 assert.equal(bot.tickets.options(bot.store.guild(A)).length,5);assert.equal(bot.tickets.options(bot.store.guild(B)).length,4);
 let modal;bot.store.guild(A).ticketStyle='buttons';assert.equal(bot.tickets.menu(bot.store.guild(A)).components.length,5);
 await bot.tickets.handle({customId:'tm:ticket:open:alianzas',guild:h.guild,guildId:A,isStringSelectMenu:()=>false,isButton:()=>true,showModal:async m=>{modal=m.toJSON();}});
 assert.equal(modal.title,'Alianzas');assert.equal(modal.components[0].components[0].label,'¿Qué comunidad representas?');
 bot.store.guild(A).ticketTemplate='{embed}$v{title: Soporte de {guild.name}}$v{embed}$v{description: Tus preguntas aquí}';
 await bot.tickets.panel(h.channel,h.member);assert.equal(h.sent[0].embeds.length,2);assert.equal(h.sent[0].components[0].components.length,5);
});
test('IA de diseño no usa historial de chat ni ejecuta herramientas',async()=>{
 let call;const ai=new Assistant({generate:async x=>{call=x;return {text:'{embed}$v{description: En directo}'};}});
 const output=await ai.draft(U,'Haz un anuncio');assert.match(output,/En directo/);assert.equal(call.contents.length,1);assert.equal(call.config.tools,undefined);assert.equal(ai.history.items.size,0);assert.match(call.config.systemInstruction,/borrador/);
});
test('entrada real de prefijo y slash conserva saltos, comillas y variables',async t=>{
 const bot=app(t),h=context();const source='{embed}$v{description: Primera línea\n"Bienvenido" {user.mention}}';
 const receive=bot.client.listeners('messageCreate')[0];
 await receive({guild:h.guild,channel:h.channel,author:h.user,content:`,welcome add <#${C}> ${source}`});
 assert.equal(greetings(bot.store.guild(A),'welcome')[0].text,source);
 const other=context({guildId:B});const replies=[];
 const slash={guild:other.guild,guildId:B,channel:other.channel,user:other.user,commandName:'embed',
  isButton:()=>false,isChatInputCommand:()=>true,options:{get:name=>name==='opciones'?{value:source}:null},
  deferReply:async()=>{slash.deferred=true;slash.ephemeral=true;},editReply:async p=>replies.push(p),followUp:async p=>replies.push(p)};
 await bot.client.listeners('interactionCreate')[0](slash);
 assert.equal(replies.length,2);assert.match(replies[1].embeds[0].description,/Primera línea\n"Bienvenido"/);
 assert.equal(other.sent.length,0);assert.ok(replies[1].flags);
});
