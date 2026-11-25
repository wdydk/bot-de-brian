'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SecurityExpansion,challenge,evidence}=require('../src/security-expansion');
const {AuditLogEvent}=require('discord.js');
test('cases stay guild scoped, only target appeals and evidence must belong to guild',()=>{
 const c={},store={guild:g=>c[g]||={},patchGuild:(g,p)=>Object.assign(c[g]||={},p)},s=new SecurityExpansion(store,async()=>{});
 const a=s.record('a','mod','user','warn','reason');assert.equal(s.cases('b').length,0);
 assert.throws(()=>s.change('a',a.id,'other','appeal','no'));s.change('a',a.id,'user','appeal','review');assert.throws(()=>s.change('a',a.id,'user','appeal','again'));
 s.change('a',a.id,'mod','accept','');assert.equal(s.cases('a')[0].appeal.status,'accept');assert.throws(()=>evidence('a','https://example.com'));
 assert.match(challenge().answer,/^\d+$/);
});
test('nuke alert is actor and guild scoped, deduplicated and whitelist exempt',async()=>{
 const data={},store={guild:g=>data[g]||={securityExpansion:{nuke:true,threshold:2},staffPolicy:{whitelist:['trusted']}},patchGuild:(g,p)=>Object.assign(data[g],p)},alerts=[],s=new SecurityExpansion(store,async(...a)=>alerts.push(a),()=>1000);
 const g={id:'a',ownerId:'owner'},e=(id,actor='mod')=>({id,executorId:actor,action:AuditLogEvent.WebhookCreate,createdTimestamp:1000});
 await s.audit(e('1'),g,'bot');await s.audit(e('1'),g,'bot');await s.audit(e('2'),{...g,id:'b'},'bot');assert.equal(alerts.length,0);
 await s.audit(e('3'),g,'bot');await s.audit(e('4'),g,'bot');assert.equal(alerts.length,1);
 await s.audit(e('5','trusted'),g,'bot');await s.audit(e('6','trusted'),g,'bot');assert.equal(alerts.length,1);
});
