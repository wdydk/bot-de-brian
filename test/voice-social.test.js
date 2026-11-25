'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SocialCenter}=require('../src/social-center');const {VoiceMaster,config}=require('../src/voice-master');
test('social requests require recipient consent, stay scoped and divorce clears both',()=>{
 const data={},store={guild:g=>data[g]||={socialEnabled:true},patchGuild:(g,p)=>Object.assign(data[g],p)},s=new SocialCenter(store);
 const id=s.request('g','a','b','marry');assert.equal(s.pair('g','a'),null);assert.throws(()=>s.respond('g','c',id,true));assert.throws(()=>s.respond('other','b',id,true));
 s.respond('g','b',id,true);assert.equal(s.pair('g','a'),'b');assert.equal(s.pair('g','b'),'a');s.divorce('g','b');assert.equal(s.pair('g','a'),null);
});
test('voice configuration is disabled by default and cannot be edited by other admins',async()=>{
 assert.equal(config({}).enabled,false);const v=new VoiceMaster({guild:()=>({})});
 await assert.rejects(v.configure({ownerId:'owner'},{id:'other'},new URLSearchParams()));
 await assert.rejects(v.command({guild:{id:'g',members:{fetch:async()=>({id:'u',voice:{channelId:'unknown'}})}},user:{id:'u'}},['lock']));
});

test('voice lock restores explicit owner and everyone values; external change is not overwritten',async()=>{
 const {PermissionsBitField}=require('discord.js'),{P}=require('../src/permissions');
 const cfg={temporaryVoice:{v:{owner:'u',category:'cat',locked:null,hidden:null}}},store={guild:()=>cfg,patchGuild:(_,p)=>Object.assign(cfg,p)},v=new VoiceMaster(store),state={g:null,u:false};
 const ow={get:id=>state[id]===null?undefined:{allow:new PermissionsBitField(state[id]?P.Connect:0n),deny:new PermissionsBitField(state[id]?0n:P.Connect)}};
 const ch={id:'v',type:2,parentId:'cat',permissionsFor:()=>({has:()=>true}),permissionOverwrites:{cache:ow,edit:async(id,value)=>{state[id]=value.Connect;}}};
 const guild={id:'g',members:{fetch:async()=>({id:'u',voice:{channelId:'v'}}),fetchMe:async()=>({})},channels:{fetch:async()=>ch}};
 const ctx={guild,user:{id:'u'}};
 await v.command(ctx,['lock']);assert.deepEqual(state,{g:false,u:true});
 state.g=true;await assert.rejects(v.command(ctx,['unlock']));assert.equal(state.g,true);
 state.g=false;await v.command(ctx,['unlock']);assert.deepEqual(state,{g:null,u:false});
});

test('social errors distinguish self, cooldown and pending; only recipient consents',()=>{
 const s=new SocialCenter({guild:()=>({socialEnabled:true})});
 assert.throws(()=>s.request('g','a','a','kiss'),/ti mismo/);
 const id=s.request('g','a','b','kiss');
 assert.throws(()=>s.request('g','a','b','kiss'),/pendiente/);
 assert.throws(()=>s.request('g','a','c','kiss'),/segundos/);
 assert.throws(()=>s.request('g','c','b','kiss'),/recibió/);
 assert.throws(()=>s.respond('g','c',id,true));
 const invite=s.invitation('123456789012345678',id,'kiss','User','Guild');
 assert.match(invite.components[0].toJSON().components[0].custom_id,/tm:social:/);
 assert.match(invite.content,/canal original/);
 s.cancel('g',id);assert.throws(()=>s.lookup('g','b',id));
});
test('accepted social buttons publish only once to original visible channel; rejection stays private',async()=>{
 const s=new SocialCenter({guild:()=>({socialEnabled:true})}),g='123456789012345678',sent=[],dm=[];
 const member=id=>({id,user:{send:async x=>dm.push(x)}});
 const ch={guild:{id:g},isTextBased:()=>true,permissionsFor:()=>({has:()=>true}),send:async p=>sent.push(p)};
 const guild={id:g,members:{fetch:async ({user})=>member(user),fetchMe:async()=>member('bot')},channels:{fetch:async id=>{assert.equal(id,'original');return ch;}}};
 const id=s.request(g,'a','b','kiss','original');
 assert.match(await s.complete(guild,'b',id,true),/canal original/);assert.equal(sent.length,1);
 assert.deepEqual(sent[0].allowedMentions,{parse:[]});await assert.rejects(s.complete(guild,'b',id,true));
 const other=s.request(g,'c','d','hug','original');assert.match(await s.complete(guild,'d',other,false),/privado/);assert.equal(sent.length,1);
});

test('instant social is non-mutual fiction, no pings, no pending request or marriage, respects opt-out and limits',()=>{
 const data={},store={guild:g=>data[g]||={socialEnabled:true},patchGuild:(g,p)=>Object.assign(data[g],p)},s=new SocialCenter(store);
 const a=s.instant('g','a','b','kiss');
 assert.match(a.embeds[0].toJSON().description,/envía un beso virtual a/);
 assert.deepEqual(a.allowedMentions,{parse:[]});assert.equal(s.pair('g','a'),null);
 assert.throws(()=>s.instant('g','a','c','hug'),/10 segundos/);
 assert.throws(()=>s.instant('g','c','b','hug'),/Espera/);
 assert.throws(()=>s.instant('g','c','d','marry'),/solicitud/);
 s.preference('g','d','off');assert.throws(()=>s.instant('g','c','d','ship'),/no está disponible/);
 assert.throws(()=>s.request('g','c','d','marry'),/no está disponible/);
 assert.ok(s.instant('other','c','d','ship').embeds.length);
 s.preference('g','d','on');assert.ok(s.instant('g','c','d','hug').embeds.length);
});
