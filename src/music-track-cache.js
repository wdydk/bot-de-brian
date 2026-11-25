'use strict';

// Only public track metadata is cached, never audio, signed media URLs or user tokens.
class TrackCache {
    constructor({ ttl = 10 * 60000, limit = 500, clock = Date.now } = {}) {
        this.ttl = ttl;
        this.limit = limit;
        this.clock = clock;
        this.entries = new Map();
        this.pending = new Map();
        this.hits = 0;
        this.shared = 0;
        this.misses = 0;
    }
    async get(key, load, check = () => {}) {
        check();
        const entry = this.entries.get(key);
        if (entry && entry.until > this.clock()) {
            this.entries.delete(key);
            this.entries.set(key, entry);
            this.hits++;
            return { ...entry.track };
        }
        this.entries.delete(key);
        let pending = this.pending.get(key);
        if (pending) this.shared++;
        else {
            this.misses++;
            pending = Promise.resolve().then(() => {
                check();
                return load();
            }).then(track => {
                // Never save a result obtained while a source-wide restriction is active.
                check();
                const { title, url, duration, thumbnail, spotify } = track;
                const clean = { title, url, duration, thumbnail, spotify };
                this.entries.set(key, { track: clean, until: this.clock() + this.ttl });
                while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
                return clean;
            }).finally(() => this.pending.delete(key));
            this.pending.set(key, pending);
        }
        const track = await pending;
        check();
        return { ...track };
    }
    snapshot() {
        return { hits: this.hits, shared: this.shared, misses: this.misses };
    }
}
module.exports = { TrackCache };
