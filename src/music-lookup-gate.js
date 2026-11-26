'use strict';
const { UserError } = require('./core');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));

// Serializes metadata and playlist lookups across guilds. No audio, retries or bypass.
class RemoteLookupGate {
    constructor({ gap = 2000, limit = 4, clock = Date.now, wait = sleep } = {}) {
        this.gap = gap;
        this.limit = limit;
        this.clock = clock;
        this.wait = wait;
        this.tail = Promise.resolve();
        this.pending = 0;
        this.active = false;
        this.nextAt = 0;
        this.completed = 0;
        this.rejected = 0;
    }
    async run(task, check = () => {}) {
        check();
        if (this.pending >= this.limit) {
            this.rejected++;
            throw Object.assign(new UserError('Hay demasiadas consultas musicales. Inténtalo en unos segundos.'),{code:'MUSIC_LOOKUP_BUSY'});
        }
        this.pending++;
        const job = this.tail.then(async () => {
            check();
            const delay = Math.max(0,this.nextAt-this.clock());
            if (delay) await this.wait(delay);
            check();
            this.active = true;
            try { return await task(); }
            finally {
                this.active = false;
                this.nextAt = this.clock()+this.gap;
                this.completed++;
            }
        }).finally(() => { this.pending--; });
        this.tail = job.catch(() => {});
        return job;
    }
    snapshot() {
        return {active:Number(this.active),waiting:this.pending-Number(this.active),completed:this.completed,rejected:this.rejected};
    }
}
module.exports = { RemoteLookupGate };
