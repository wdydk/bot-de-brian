'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CommunityExpansion,starConfig}=require('../src/community-expansion');
test('existing responder rules remain intact and owner-only editing',async()=>{
 const cfg={chatRules:[{trigger:'hola',reaction:'⭐'}]},store={guild:()=>cfg,patchGuild:(_,p)=>Object.assign(cfg,p)},c=new CommunityExpansion(store),g={id:'g',ownerId:'owner'};
 const f=new URLSearchParams({section:'responders',action:'save',trigger:'Hola',response:'Bienvenido'});
 await assert.rejects(c.save(g,{id:'other'},f));await c.save(g,{id:'owner'},f);assert.deepEqual(cfg.chatRules,[{trigger:'hola',reaction:'⭐',response:'Bienvenido'}]);
 assert.equal(starConfig({}).enabled,false);
 await assert.rejects(c.grant(g,'user',{id:'missing'},'add','button'));
});
