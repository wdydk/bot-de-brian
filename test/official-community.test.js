'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authorize,createStructure,publicDefinitions,plan,INVITE}=require('../src/official-community');
const {P}=require('../src/permissions');
const owner='123456789012345678',other='234567890123456789';
test('official management requires app owner, guild owner and exact invite guild',async()=>{
 const guild={id:'official',ownerId:owner,fetch:async()=>guild};
 const client={application:{fetch:async()=>({owner:{id:owner}})},fetchInvite:async()=>({guild:{id:'official'}})};
 await authorize(client,{guild,user:{id:owner}});
 await assert.rejects(authorize(client,{guild,user:{id:other}}));
 guild.ownerId=other;await assert.rejects(authorize(client,{guild,user:{id:owner}}));guild.ownerId=owner;
 client.fetchInvite=async()=>({guild:{id:'elsewhere'}});await assert.rejects(authorize(client,{guild,user:{id:owner}}));
});
test('structure creates missing channels, preserves existing ones and protects development',async()=>{
 const cache=new Map(),calls=[],guild={id:'guild',members:{fetchMe:async()=>({id:'bot',permissions:{has:()=>true}})},channels:{cache,fetch:async()=>{},create:async o=>{calls.push(o);const c={...o,id:String(calls.length),parentId:o.parent};cache.set(c.id,c);return c;}}};
 const r=await createStructure(guild);assert.equal(r.partial,false);assert.ok(r.made.includes('command-directory'));
 assert.ok(calls.find(c=>c.name==='security-logs').permissionOverwrites[0].deny.includes(P.ViewChannel));
 const initial=calls.length;const again=await createStructure(guild);assert.equal(again.made.length,0);assert.equal(calls.length,initial);
 assert.match(plan(),/command-directory/);
});
test('public directory excludes privileged and private commands',()=>{
 const defs=[{name:'ping'},{name:'ban',permission:P.BanMembers},{name:'setup',adminOnly:true},{name:'secret',private:true}];
 assert.deepEqual(publicDefinitions(defs).map(x=>x.name),['ping']);assert.equal(INVITE,'https://discord.gg/qaXbDZyK3z');
});
