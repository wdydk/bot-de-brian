'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {groups,featureGroups,groupItems,icon}=require('../src/web-design');
const {tabs}=require('../src/dashboard'),{homeContent}=require('../src/guide');
test('dashboard groups preserve every existing module exactly once and future modules remain visible',()=>{
 const entries=[...Object.entries(tabs),['future-module','Future Module']];
 const result=groupItems(entries,groups).flatMap(([,items])=>items);
 assert.equal(result.length,entries.length);assert.deepEqual(new Map(result),new Map(entries));
 assert.ok(groupItems(entries,groups).at(-1)[1].some(x=>x[0]==='future-module'));
});
test('professional landing retains real stats, live avatar, documented links and grouped modules',()=>{
 const html=homeContent(true,true,{servers:8,members:344,online:true});
 assert.match(html,/data-bot-avatar/);assert.match(html,/>344</);assert.match(html,/href="\/invite"/);assert.match(html,/href="\/servers"/);
 assert.match(html,/tm-workflow/);assert.match(html,/tm-feature-group/);assert.match(html,/href="\/guia#voicesocial"/);
 assert.equal((html.match(/class="module-index"/g)||[]).length,featureGroups.length);
 assert.doesNotMatch(icon('<script>'),/<script>/);
 const offline=homeContent(false,false,{online:false});assert.match(offline,/Estado no disponible/);assert.doesNotMatch(offline,/href="\/invite"/);
});
