'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {locale,t,saveLocale}=require('../src/panel-locale');
const {parse,matches,change}=require('../src/automation-rules');
test('language is per guild, owner-only, and rejects invalid locale',()=>{
 const configs={a:{},b:{}},store={guild:g=>configs[g],patchGuild:(g,c)=>Object.assign(configs[g],c)},g={id:'a',ownerId:'owner'};
 assert.throws(()=>saveLocale(store,g,{id:'user'},'en'));saveLocale(store,g,{id:'owner'},'pt');
 assert.equal(locale(configs.a),'pt');assert.equal(locale(configs.b),'es');assert.equal(t('pt','polls'),'Enquetes');assert.throws(()=>saveLocale(store,g,{id:'owner'},'constructor'));
});
test('rules are bounded, declarative, scoped, owner-controlled and revision guarded',async()=>{
 const cfg={},store={guild:()=>cfg,patchGuild:(_,x)=>Object.assign(cfg,x)},g={id:'a',ownerId:'owner'};
 const f=new URLSearchParams({event:'join',condition:'young',age:'7',ruleAction:'log',revision:'0',action:'rule-add'}),now=10*86400000;
 const rule=parse(f);assert.equal(matches(rule,'join',{user:{createdTimestamp:now-1000}},now),true);assert.equal(matches(rule,'leave',{user:{createdTimestamp:now-1000}},now),false);
 assert.equal(matches(rule,'join',{user:{bot:true,createdTimestamp:now}},now),false);
 await assert.rejects(change(store,g,{id:'other'},f));await change(store,g,{id:'owner'},f);await assert.rejects(change(store,g,{id:'owner'},f));
 f.set('ruleAction','exec');assert.throws(()=>parse(f));
});
