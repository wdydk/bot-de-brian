'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,apply}=require('../src/server-builder');
const {P}=require('../src/permissions');
test('builder rejects permissions, destructive actions, duplicate names and excess resources',()=>{
 const good={categories:[{name:'General',channels:['chat']}],roles:['Member']};
 assert.deepEqual(parse(JSON.stringify(good)),good);
 for(const x of [{...good,delete:true},{...good,roles:[{name:'Admin',permissions:8}]},{...good,categories:[{name:'A',channels:['chat','chat']}]},{...good,roles:['@everyone']}])assert.throws(()=>parse(JSON.stringify(x)));
});
test('only owner creates nonprivileged roles and private channels; existing objects remain untouched',async()=>{
 const roles=new Map(),channels=new Map(),calls=[],guild={id:'guild',ownerId:'owner',members:{fetchMe:async()=>({id:'bot',permissions:{has:()=>true}})},roles:{cache:roles,fetch:async()=>{},create:async o=>{calls.push(o);roles.set(o.name,o);return o;}},channels:{cache:channels,fetch:async()=>{},create:async o=>{calls.push(o);const c={...o,id:o.name,parentId:o.parent};channels.set(c.id,c);return c;}}};
 const plan={roles:['Member'],categories:[{name:'General',channels:['chat']}]};
 await assert.rejects(apply(guild,'other',plan));assert.equal(calls.length,0);
 const a=await apply(guild,'owner',plan);assert.equal(a.created.length,3);assert.equal(calls[0].permissions,0n);assert.ok(calls[1].permissionOverwrites[0].deny.includes(P.ViewChannel));assert.ok(calls[2].permissionOverwrites[0].deny.includes(P.ViewChannel));
 const b=await apply(guild,'owner',plan);assert.equal(b.created.length,0);assert.equal(calls.length,3);
});
