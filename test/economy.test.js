'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/core');const {Economy,parseShop}=require('../src/economy');
test('economy enforces cooldown, purchases, consent and guild isolation after restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-economy-'));const store=new Store(dir);
 const cfg={enabled:true,shop:parseShop('star | Estrella | 70')};
 store.patchGuild('a',{virtualEconomy:cfg});store.patchGuild('b',{virtualEconomy:cfg});
 let now=100000000;let e=new Economy(store,()=>now);t.after(()=>{e.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(e.earn('a','u','daily'),100);assert.throws(()=>e.earn('a','u','daily'));
 assert.equal(e.buy('a','u','star').price,70);assert.throws(()=>e.buy('a','u','star'));
 assert.equal(e.profile('a','u').balance,30);assert.equal(e.profile('b','u').balance,0);
 assert.throws(()=>e.relationship('a','v','u','accept'));e.relationship('a','u','v','propose');
 assert.equal(e.profile('a','u').partner,null);e.relationship('a','v','u','accept');assert.equal(e.profile('a','u').partner,'v');
 e.reputation('a','u','v');assert.throws(()=>e.reputation('a','u','v'));
 e.close();e=new Economy(store,()=>now);assert.equal(e.inventory('a','u')[0].quantity,1);assert.equal(e.profile('a','v').rep,1);
 e.relationship('a','v',null,'divorce');assert.equal(e.profile('a','u').partner,null);
 now+=86400000;assert.equal(e.earn('a','u','daily'),100);
 assert.throws(()=>parseShop('x | x | -1'));assert.throws(()=>parseShop('x | x | 1\nx | y | 2'));
});
