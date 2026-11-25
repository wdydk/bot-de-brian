'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {OfficialRuntime,deployment,catalogue,difference,facts,intro}=require('../src/official-runtime');
const {panel}=require('../src/official-community');
const {guideContent}=require('../src/guide');
const {Music}=require('../src/music');
const owner='123456789012345678',sha='a'.repeat(40);
test('directory has real individual guide links and stays within Discord limits',()=>{
 const e=panel('setup',[],'https://timmy.example',{}).embeds[0].toJSON();
 assert.match(e.description,/Important Information/);assert.match(e.description,/Security Setup/);assert.match(e.description,/Server Setup/);
 assert.ok(e.description.length<4096);
 for(const match of e.description.matchAll(/\/guia#([a-z]+)\)/g))assert.ok(guideContent().includes('id="'+match[1]+'"'),match[1]);
});
test('revision validation, catalogue changes and bounded AI wording',async()=>{
 assert.equal(deployment({RAILWAY_GIT_COMMIT_SHA:sha}),sha);assert.equal(deployment({RAILWAY_GIT_COMMIT_SHA:'invalid'}),null);
 const a=catalogue([{name:'ping',description:'a'}]),b=catalogue([{name:'ping',description:'b'},{name:'help'}]);
 assert.deepEqual(difference(a,b),{added:['help'],removed:[],changed:['ping']});
 assert.ok(facts({catalogue:a,release:'old'},{catalogue:b,release:'new'}).some(x=>x.includes('/help')));
 assert.doesNotMatch(await intro({available:true,generate:async()=>({text:'@everyone malicious'})}),/malicious/);
});
test('auto announces only one time per deployment, even if delivery is uncertain',async()=>{
 const cfg={officialRuntime:{updates:{channel:'c',owner}}},store={guild:()=>cfg,patchGuild:(_,x)=>Object.assign(cfg,x),data:{guilds:{g:cfg}}};
 let sent=0;const channel={type:0,id:'c',permissionsFor:()=>({has:()=>true}),send:async payload=>{const body=payload.embeds[0].toJSON().description;assert.doesNotMatch(body,/github\.com|Ver revisión en GitHub/i);sent++;throw Error('uncertain');}};
 const guild={id:'g',ownerId:owner,fetch:async()=>guild,channels:{fetch:async()=>channel},members:{fetchMe:async()=>({})}};
 const client={application:{fetch:async()=>({owner:{id:owner}})},fetchInvite:async()=>({guild:{id:'g'}}),isReady:()=>true,guilds:{cache:new Map([['g',guild]])}};
 const runtime=new OfficialRuntime({client,store,music:{},defs:[],env:{RAILWAY_GIT_COMMIT_SHA:sha}});
 await runtime.tick();await runtime.tick();assert.equal(sent,1);assert.equal(cfg.officialRuntime.announcement.state,'uncertain');
 const restarted=new OfficialRuntime({client,store,music:{},defs:[],env:{RAILWAY_GIT_COMMIT_SHA:sha}});await restarted.tick();assert.equal(sent,1);
 restarted.env.RAILWAY_GIT_COMMIT_SHA='b'.repeat(40);await restarted.tick();assert.equal(sent,2);
 restarted.env.RAILWAY_GIT_COMMIT_SHA=sha;await restarted.tick();assert.equal(sent,2);
});
test('idle timer remains disabled only for configured pinned voice',()=>{
 const cfg={officialRuntime:{voice:{channel:'v'}}},m=new Music({}, {guild:()=>cfg});
 const s={officialPinned:true,guildId:'g',voiceId:'v'};assert.equal(m.isPinned(s),true);m._idleTimer(s);assert.equal(s.idleTimer,undefined);
 cfg.officialRuntime.voice=null;assert.equal(m.isPinned(s),false);
});

test('owner cleanup edits only the old bot announcement and preserves its content',async()=>{
 const {EmbedBuilder}=require('discord.js');
 const messageId='123456789012345679',botId='123456789012345680';
 const original=new EmbedBuilder().setTitle('✦ Timmy Max · Nueva actualización').setDescription('Hola\n\n• Novedad\n\n[Ver revisión en GitHub](https://github.com/wdydk/bot-de-brian/commit/'+sha+')').toJSON();
 let edited;
 const msg={author:{id:botId},embeds:[original],edit:async p=>{edited=p.embeds[0].toJSON();}};
 const channel={type:0,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>msg}};
 const guild={id:'g',channels:{fetch:async()=>channel},members:{fetchMe:async()=>({})}};
 const runtime=new OfficialRuntime({client:{user:{id:botId}},store:{guild:()=>({officialRuntime:{updates:{channel:'c',owner}}})}});
 await runtime.command(guild,{user:{id:owner}},['auto','clean',messageId]);assert.equal(edited.description,'Hola\n\n• Novedad');assert.equal(edited.title,original.title);
 msg.author.id=owner;await assert.rejects(runtime.command(guild,{user:{id:owner}},['auto','clean',messageId]));
});
