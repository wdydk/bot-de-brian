'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('motion styles are local, finite and respect reduced motion',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/refresh.css'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/data-motion="off"/);assert.match(css,/@keyframes tm-aurora/);
 assert.doesNotMatch(css,/animation:[^;{}]*\binfinite\b/);assert.doesNotMatch(css,/@import/);assert.match(css,/max-width:740px/);
 assert.match(js,/tm-main-nav/);assert.match(js,/IntersectionObserver/);assert.match(js,/timmy-motion/);
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('showcase has five keyboard-compatible examples and decorative motion is removable',()=>{
 const html=require('../src/guide').homeContent(true,true,{online:true});
 const css=fs.readFileSync(path.join(__dirname,'../web/refresh.css'),'utf8');
 assert.match(html,/class="tm-motion-scene" aria-hidden="true"/);
 assert.match(html,/href="#modulos"/);
 assert.equal((html.match(/role="tab"/g)||[]).length,5);
 for(let n=0;n<5;n++){assert.match(html,new RegExp('aria-controls="example-'+n+'"'));assert.match(html,new RegExp('id="example-'+n+'"'));}
 assert.match(html,/Tu música, en Discord/);assert.match(html,/Tu propia sala de voz/);
 assert.match(css,/@keyframes tm-demo-enter/);assert.match(css,/data-motion="off"\] \.tm-motion-scene\{display:none\}/);
});
