'use strict';
// Presentation only. Never hides modules based on assumed permissions.
const groups=[
 ['Comunidad',['welcome','goodbye','boosts','boosterCenter','birthday','volunteer','starboard','responders','public-page']],
 ['Seguridad',['securityPlus','cases','staff','delegation','snipe']],
 ['Actividad y entretenimiento',['xp','levels','music','voiceMaster','social']],
 ['Herramientas',['knowledge','custom','integrations']],
 ['Personalización',['design']]
];
const featureGroups=[
 ['Seguridad y moderación',['proteccion','verificacion','staff','securityplus']],
 ['Comunidad y crecimiento',['bienvenidas','boosts','niveles','cumpleanos','sorteos','communityplus']],
 ['Música y entretenimiento',['musica','voicesocial']],
 ['IA y herramientas',['ask','embeds','custom','integraciones','errores']]
];
const glyphs={proteccion:'shield',verificacion:'shield',staff:'users',securityplus:'shield',bienvenidas:'message',boosts:'star',niveles:'chart',cumpleanos:'star',sorteos:'gift',communityplus:'users',musica:'music',voicesocial:'users',ask:'spark',embeds:'message',custom:'code',integraciones:'code',errores:'help'};
const paths={
 shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11"/><path d="m9 12 2 2 4-4"/>',
 users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
 message:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.7-4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 10h8m-8 4h5"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
 chart:'<path d="M3 3v18h18M8 16v-4m5 4V8m5 8V5"/>',
 gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8H8a2.5 2.5 0 1 1 2.5-2.5L12 8Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5L12 8Z"/>',
 music:'<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
 spark:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z"/>',
 code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 3 3v2m0 3h.01"/>'
};
function groupItems(entries,layout){
 const byKey=new Map(entries.map(x=>[x[0],x])),out=[];
 for(const [label,keys] of layout){
   const items=[];
   for(const key of keys){if(byKey.has(key)){items.push(byKey.get(key));byKey.delete(key);}}
   if(items.length)out.push([label,items]);
 }
 if(byKey.size)out.push(['Otros módulos',[...byKey.values()]]);
 return out;
}
function icon(key){return '<span class="tm-feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">'+paths[glyphs[key]||'help']+'</svg></span>';}
module.exports={groups,featureGroups,groupItems,icon};
