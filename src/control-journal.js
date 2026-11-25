'use strict';
const {DatabaseSync}=require('node:sqlite');
const {createHash,randomUUID}=require('node:crypto');
const path=require('node:path');
const {UserError}=require('./core');
const {validateCustom}=require('./custom-commands');
const {design,validateDesign}=require('./dashboard-design');
const day=()=>new Date().toISOString().slice(0,10);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Only explicitly reversible settings; never restore permissions, live tickets,
// sanctions, balances, role IDs, or another guild's configuration.
function snapshot(cfg){return structuredClone({custom:cfg.custom||{},customActions:cfg.customActions||{},dashboardDesign:design(cfg)});}
function restorePatch(payload, cfg, definitions){
    const custom={},customActions={};
    if(!payload||typeof payload!=='object'||!payload.custom||!payload.customActions)throw new UserError('Copia incompatible.');
    for(const [name,value] of Object.entries(payload.custom)){const v=validateCustom(name,'text',value,null,definitions);custom[v.name]=v.text;}
    for(const [name,value] of Object.entries(payload.customActions)){const v=validateCustom(name,value?.type,null,value?.minutes,definitions);if(v.type!=='timeout'||Object.hasOwn(custom,v.name))throw new UserError('Copia incompatible.');customActions[v.name]={type:v.type,minutes:v.minutes};}
    if(Object.keys(custom).length+Object.keys(customActions).length>50)throw new UserError('Demasiados comandos.');
    return {custom,customActions,dashboardDesign:{...validateDesign(payload.dashboardDesign),revision:design(cfg).revision+1}};
}
function changedKeys(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).sort();}
class Journal{
    constructor(store){this.store=store;}
    db(){
        if(!this.database){this.database=new DatabaseSync(path.join(this.store.directory,'control-center.sqlite'));
            this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,guild TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,summary TEXT NOT NULL); CREATE INDEX IF NOT EXISTS event_guild ON events(guild,at); CREATE TABLE IF NOT EXISTS metrics(guild TEXT NOT NULL,day TEXT NOT NULL,messages INTEGER DEFAULT 0,commands INTEGER DEFAULT 0,joins INTEGER DEFAULT 0,leaves INTEGER DEFAULT 0,members INTEGER,PRIMARY KEY(guild,day)); CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,guild TEXT NOT NULL,at INTEGER NOT NULL,actor TEXT NOT NULL,payload TEXT NOT NULL);');
        }return this.database;
    }
    event(guild,kind,actor,summary){const db=this.db();db.prepare('INSERT INTO events(guild,at,kind,actor,summary) VALUES(?,?,?,?,?)').run(guild,Date.now(),kind,String(actor||''),String(summary).slice(0,600));db.prepare('DELETE FROM events WHERE guild=? AND id NOT IN (SELECT id FROM events WHERE guild=? ORDER BY id DESC LIMIT 500)').run(guild,guild);}
    safeEvent(...args){try{this.event(...args);}catch(e){console.warn('[CONTROL JOURNAL]',e.code||e.name);}}
    metric(guild,kind,members){if(!['messages','commands','joins','leaves'].includes(kind))return;try{const db=this.db();db.prepare('INSERT INTO metrics(guild,day,'+kind+',members) VALUES(?,?,1,?) ON CONFLICT(guild,day) DO UPDATE SET '+kind+'='+kind+'+1,members=COALESCE(excluded.members,members)').run(guild,day(),Number.isSafeInteger(members)?members:null);}catch(e){console.warn('[CONTROL METRIC]',e.code||e.name);}}
    events(guild,kind){return kind?this.db().prepare('SELECT * FROM events WHERE guild=? AND kind=? ORDER BY id DESC LIMIT 100').all(guild,kind):this.db().prepare('SELECT * FROM events WHERE guild=? ORDER BY id DESC LIMIT 100').all(guild);}
    metrics(guild){return this.db().prepare('SELECT * FROM metrics WHERE guild=? ORDER BY day DESC LIMIT 30').all(guild).reverse();}
    backups(guild){return this.db().prepare('SELECT id,at,actor FROM backups WHERE guild=? ORDER BY at DESC LIMIT 20').all(guild);}
    backup(guild,actor){const id=randomUUID(),db=this.db();db.prepare('INSERT INTO backups VALUES(?,?,?,?,?)').run(id,guild,Date.now(),actor,JSON.stringify(snapshot(this.store.guild(guild))));return id;}
    read(guild,id){const row=this.db().prepare('SELECT * FROM backups WHERE guild=? AND id=?').get(guild,id);if(!row)throw new UserError('Copia no encontrada.');return JSON.parse(row.payload);}
    restore(guild,actor,id,expected,definitions){const cfg=this.store.guild(guild);if(expected!==hash(snapshot(cfg)))throw new UserError('Los ajustes cambiaron. Recarga antes de restaurar.');const patch=restorePatch(this.read(guild,id),cfg,definitions);this.backup(guild,actor);this.store.patchGuild(guild,patch);this.safeEvent(guild,'activity',actor,'Restauración de comandos y diseño; copia previa creada.');}
    close(){this.database?.close();}
}
module.exports={Journal,hash,snapshot,restorePatch,changedKeys};
