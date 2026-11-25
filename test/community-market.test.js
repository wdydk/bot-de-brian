'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Market,parseShop,bannerURL}=require('../src/community-market');
test('daily, inventory, private profiles and opt-in rankings survive restart and stay scoped',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-market-')),cfg={communityMarket:{enabled:true,items:parseShop('star | Star | 70')}};let now=1,m=new Market({directory:dir,guild:()=>cfg},()=>now);
 t.after(()=>{m.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(m.daily('a','u'),100);assert.throws(()=>m.daily('a','u'));assert.equal(m.buy('a','u','star').price,70);assert.throws(()=>m.buy('a','u','star'));
 assert.equal(m.profile('b','u').balance,0);assert.throws(()=>m.profile('a','u','v'));assert.equal(m.ranking('a','balance').length,0);
 m.customize('a','u','visible','on');m.observe('a','u');m.observe('a','u');assert.equal(m.ranking('a','activity')[0].value,1);
 m.giveRep('a','v','u');assert.throws(()=>m.giveRep('a','v','u'));m.close();m=new Market({directory:dir,guild:()=>cfg},()=>now);
 assert.equal(m.inventory('a','u')[0].quantity,1);assert.equal(m.profile('a','u','v').rep,1);
 m.customize('a','u','visible','off');assert.equal(m.ranking('a','balance').length,0);
 assert.throws(()=>bannerURL('https://evil.example/a.png'));assert.throws(()=>parseShop('x | X | -1'));
});
