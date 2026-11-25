'use strict';
// Installation only. Never cache sessions, HTML, APIs or private content.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
