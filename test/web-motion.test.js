'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('motion styles are local, finite and respect reduced motion',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/refresh.css'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/data-motion="off"/);assert.match(css,/@keyframes tm-aurora/);
 assert.doesNotMatch(css,/animation:[^;{}]*\binfinite\b/);assert.doesNotMatch(css,/@import/);assert.match(css,/max-width:740px/);
 assert.match(js,/tm-main-nav/);assert.match(js,/IntersectionObserver/);assert.match(js,/timmy-motion/);
 assert.doesNotThrow(()=>new vm.Script(js));
});
