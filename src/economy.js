'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomInt}=require('node:crypto');
const path=require('node:path');
const {UserError,integer}=require('./core');
const DAY=86400000;
function economyConfig(cfg){return {enabled:false,shop:[],revision:0,...cfg.virtualEconomy};}
function parseShop(text){
    const list=String(text||'').split(/\r?\n/).filter(x=>x.trim()).map(line=>{
        const [id,name,price,...rest]=line.split('|').map(x=>x.trim());
        if(rest.length||!/^[a-z0-9_-]{1,24}$/.test(id||'')||!name||name.length>60)throw new UserError('Cada artículo: id | nombre | precio.');
        return {id,name,price:integer(price,1,100000)};
    });
    if(list.length>30||new Set(list.map(x=>x.id)).size!==list.length)throw new UserError('Máximo 30 artículos, sin IDs repetidos.');
    return list;
}
class Economy{
    constructor(store,clock=Date.now){this.store=store;this.clock=clock;}
    config(g){const c=economyConfig(this.store.guild(g));if(!c.enabled)throw new UserError('La economía virtual está desactivada.');return c;}
    db(){
        if(!this.database){
            this.database=new DatabaseSync(path.join(this.store.directory,'virtual-economy.sqlite'));
            this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS profiles(g TEXT,u TEXT,balance INTEGER NOT NULL DEFAULT 0,daily INTEGER,work INTEGER,rep INTEGER NOT NULL DEFAULT 0,repAt INTEGER,PRIMARY KEY(g,u)); CREATE TABLE IF NOT EXISTS inventory(g TEXT,u TEXT,item TEXT,label TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(g,u,item)); CREATE TABLE IF NOT EXISTS marriages(g TEXT,u TEXT,partner TEXT NOT NULL,PRIMARY KEY(g,u)); CREATE TABLE IF NOT EXISTS proposals(g TEXT,sender TEXT,target TEXT,expires INTEGER,PRIMARY KEY(g,sender));');
        }return this.database;
    }
    transaction(fn){const db=this.db();db.exec('BEGIN IMMEDIATE');try{const value=fn(db);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
    ensure(db,g,u){db.prepare('INSERT OR IGNORE INTO profiles(g,u) VALUES(?,?)').run(g,u);}
    profile(g,u){this.config(g);const db=this.db();return {balance:0,rep:0,...db.prepare('SELECT balance,rep FROM profiles WHERE g=? AND u=?').get(g,u),partner:db.prepare('SELECT partner FROM marriages WHERE g=? AND u=?').get(g,u)?.partner||null};}
    earn(g,u,kind){
        this.config(g);if(!['daily','work'].includes(kind))throw new UserError('Acción inválida.');
        const now=this.clock(),cooldown=kind==='daily'?DAY:3600000,amount=kind==='daily'?100:randomInt(20,61);
        return this.transaction(db=>{
            this.ensure(db,g,u);
            const p=db.prepare('SELECT * FROM profiles WHERE g=? AND u=?').get(g,u);
            if(p[kind]!==null&&now-p[kind]<cooldown)throw new UserError('Recompensa disponible nuevamente en '+Math.ceil((cooldown-now+p[kind])/60000)+' minutos.');
            if(p.balance+amount>1000000000)throw new UserError('Límite de monedas alcanzado.');
            db.prepare('UPDATE profiles SET balance=balance+?,'+kind+'=? WHERE g=? AND u=?').run(amount,now,g,u);return amount;
        });
    }
    buy(g,u,id){
        const c=this.config(g),item=c.shop.find(x=>x.id===id);
        if(!item)throw new UserError('Artículo no disponible.');
        return this.transaction(db=>{
            this.ensure(db,g,u);
            const changed=db.prepare('UPDATE profiles SET balance=balance-? WHERE g=? AND u=? AND balance>=?').run(item.price,g,u,item.price);
            if(!changed.changes)throw new UserError('No tienes suficientes monedas.');
            db.prepare('INSERT INTO inventory VALUES(?,?,?,?,1) ON CONFLICT(g,u,item) DO UPDATE SET quantity=quantity+1').run(g,u,item.id,item.name);return item;
        });
    }
    inventory(g,u){this.config(g);return this.db().prepare('SELECT label,quantity FROM inventory WHERE g=? AND u=? ORDER BY item LIMIT 50').all(g,u);}
    reputation(g,actor,target){
        this.config(g);if(actor===target)throw new UserError('No puedes darte reputación.');
        const now=this.clock();
        return this.transaction(db=>{
            this.ensure(db,g,actor);this.ensure(db,g,target);
            const p=db.prepare('SELECT repAt FROM profiles WHERE g=? AND u=?').get(g,actor);
            if(p.repAt!==null&&now-p.repAt<DAY)throw new UserError('Puedes dar reputación una vez al día.');
            db.prepare('UPDATE profiles SET repAt=? WHERE g=? AND u=?').run(now,g,actor);
            db.prepare('UPDATE profiles SET rep=rep+1 WHERE g=? AND u=?').run(g,target);
        });
    }
    relationship(g,actor,target,action){
        this.config(g);const now=this.clock();
        return this.transaction(db=>{
            const partner=u=>db.prepare('SELECT partner FROM marriages WHERE g=? AND u=?').get(g,u)?.partner;
            if(action==='divorce'){
                const p=partner(actor);if(!p)throw new UserError('No tienes matrimonio virtual.');
                db.prepare('DELETE FROM marriages WHERE g=? AND u IN (?,?)').run(g,actor,p);return;
            }
            if(!target||actor===target)throw new UserError('Elige otro miembro.');
            if(action==='decline'){
                db.prepare('DELETE FROM proposals WHERE g=? AND sender=? AND target=?').run(g,target,actor);return;
            }
            if(partner(actor)||partner(target))throw new UserError('Uno de los dos ya tiene matrimonio virtual.');
            if(action==='propose'){
                const old=db.prepare('SELECT expires FROM proposals WHERE g=? AND sender=?').get(g,actor);
                if(old&&old.expires>now)throw new UserError('Ya tienes una propuesta pendiente.');
                db.prepare('INSERT INTO proposals VALUES(?,?,?,?) ON CONFLICT(g,sender) DO UPDATE SET target=excluded.target,expires=excluded.expires').run(g,actor,target,now+3600000);return;
            }
            if(action!=='accept')throw new UserError('Acción inválida.');
            const p=db.prepare('SELECT expires FROM proposals WHERE g=? AND sender=? AND target=?').get(g,target,actor);
            if(!p||p.expires<=now)throw new UserError('No hay propuesta vigente de esa persona.');
            db.prepare('INSERT INTO marriages VALUES(?,?,?),(?,?,?)').run(g,actor,target,g,target,actor);
            db.prepare('DELETE FROM proposals WHERE g=? AND (sender IN (?,?) OR target IN (?,?))').run(g,actor,target,actor,target);
        });
    }
    overview(g){const db=this.db();return db.prepare('SELECT count(*) AS users,COALESCE(sum(balance),0) AS coins FROM profiles WHERE g=?').get(g);}
    close(){this.database?.close();}
}
module.exports={Economy,economyConfig,parseShop};
