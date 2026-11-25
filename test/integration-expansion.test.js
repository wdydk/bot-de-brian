'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Roblox}=require('../src/roblox-integration');const {UtilityCenter}=require('../src/utility-center');
test('Roblox link uses PKCE, rejects wrong state, keeps no tokens and unlinks',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-rbx-'));const user='123456789012345678',other='223456789012345678',calls=[];
 const r=new Roblox({directory:dir},{ROBLOX_CLIENT_ID:'client',ROBLOX_CLIENT_SECRET:'secret'},async(url,opt)=>{calls.push({url,opt});return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'token',refresh_token:'refresh'}:{sub:'12345'}};});
 t.after(()=>{r.close();fs.rmSync(dir,{recursive:true,force:true});});
 const {pending,url}=r.begin('https://timmy.example',user);assert.match(url,/code_challenge_method=S256/);assert.doesNotMatch(url,/secret/);
 await assert.rejects(r.connect('https://timmy.example',user,pending,'bad','code',async()=>{}));assert.equal(calls.length,0);
 await r.connect('https://timmy.example',user,pending,pending.state,'code',async()=>{});assert.equal(r.linked(user).roblox,'12345');
 assert.deepEqual(Object.keys(r.linked(user)).sort(),['at','roblox']);
 const p=r.begin('https://timmy.example',other).pending;await assert.rejects(r.connect('https://timmy.example',other,p,p.state,'code',async()=>{}));assert.equal(r.linked(other),null);r.unlink(user);assert.equal(r.linked(user),null);
});
test('translation and support have bounded input and no admin commands in support catalogue',async()=>{
 let input;const s=new UtilityCenter({available:true,model:'test',generate:async x=>{input=x;return {text:'Respuesta'};}});
 await assert.rejects(async()=>s.translate('u','bad','hi'));assert.equal(await s.translate('u','es','hello'),'Respuesta');
 const result=await s.support('v','help',[{name:'ping',usage:'>ping',description:'Ping'},{name:'ban',usage:'>ban',adminOnly:true}]);assert.match(result,/discord\.gg/);assert.doesNotMatch(input.contents,/>ban/);
});
