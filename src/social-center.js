'use strict';
const {randomUUID}=require('node:crypto');
const {UserError,ExpiringCache}=require('./core');
const verbs=new Set(['hug','kiss','slap','ship','marry']);
class SocialCenter{
 constructor(store,clock=Date.now){this.store=store;this.clock=clock;this.pending=new ExpiringCache(10*60000,3000);this.limit=new ExpiringCache(60000,3000);}
 enabled(g){if(!this.store.guild(g).socialEnabled)throw new UserError('Social Center está desactivado en este servidor. El dueño puede activarlo con >socialconfig on o desde el panel.');}
 pair(g,u){return this.store.guild(g).socialMarriages?.[u]||null;}
 request(g,from,to,verb){
  this.enabled(g);if(from===to||!verbs.has(verb)||this.limit.get(g+':'+from))throw new UserError('Elige otro miembro y espera antes de otra solicitud.');
  if(verb==='marry'&&(this.pair(g,from)||this.pair(g,to)))throw new UserError('Ya existe un matrimonio virtual.');
  const id=randomUUID().slice(0,12);this.pending.set(g+':'+id,{from,to,verb});this.limit.set(g+':'+from,true);return id;
 }
 respond(g,u,id,accept){
  this.enabled(g);const key=g+':'+id,p=this.pending.get(key);if(!p||p.to!==u)throw new UserError('No hay solicitud vigente para ti.');
  this.pending.delete(key);if(!accept)return null;
  if(p.verb==='marry'){if(this.pair(g,p.from)||this.pair(g,p.to))throw new UserError('Uno ya tiene matrimonio virtual.');const pairs={...this.store.guild(g).socialMarriages,[p.from]:p.to,[p.to]:p.from};this.store.patchGuild(g,{socialMarriages:pairs});}
  return p;
 }
 divorce(g,u){const p=this.pair(g,u);if(!p)throw new UserError('No tienes matrimonio virtual.');const pairs={...this.store.guild(g).socialMarriages};delete pairs[u];if(pairs[p]===u)delete pairs[p];this.store.patchGuild(g,{socialMarriages:pairs});}
}
module.exports={SocialCenter};
