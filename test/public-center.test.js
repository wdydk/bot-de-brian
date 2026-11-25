'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate,save,status,page}=require('../src/public-center');
test('public page is opt-in, owner-only, and validates invite and locale',()=>{
 const cfg={},store={guild:()=>cfg,patchGuild:(_,x)=>Object.assign(cfg,x)},guild={id:'a',ownerId:'owner',memberCount:12};
 const f=new URLSearchParams({enabled:'1',title:'Hola',language:'pt',revision:'0',invite:'https://discord.gg/test'});
 assert.equal(page(cfg,guild,String),null);assert.throws(()=>save(store,guild,{id:'other'},f));
 save(store,guild,{id:'owner'},f);assert.match(page(cfg,guild,String),/Membros: 12/);
 assert.throws(()=>save(store,guild,{id:'owner'},f));
 f.set('invite','https://evil.example');assert.throws(()=>validate(f));
});
test('status reports measured gateway only and hides unknown values',()=>{
 assert.deepEqual(status({isReady:()=>false},12),{ready:false,ping:null,uptimeSeconds:12,servers:null});
 assert.equal(status({isReady:()=>true,ws:{ping:45},guilds:{cache:new Map()}},5).ping,45);
});
