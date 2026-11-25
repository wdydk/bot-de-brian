'use strict';
// Only construct CDN addresses for the authenticated bot, never accept a visitor URL.
function avatarURL(user, expectedId) {
    if (!user || user.id !== expectedId || !/^\d{17,20}$/.test(user.id)) return null;
    if (/^(?:a_)?[a-f0-9]{32}$/.test(user.avatar || '')) {
        const format = user.avatar.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/avatars/'+user.id+'/'+user.avatar+'.'+format+'?size=256';
    }
    return null;
}
function createAvatarResolver(client, now=Date.now) {
    let cached=null, next=0, observed, botId, pending;
    return async function resolve() {
        const user=client?.user;
        if (!user?.id) return null;
        // Use gateway changes immediately; periodically refresh REST in case the
        // developer portal did not deliver a user update to this process.
        if (botId!==user.id || observed!==user.avatar) {
            botId=user.id;observed=user.avatar;cached=avatarURL(user,botId);next=0;
        }
        if (pending) return pending;
        if (now()<next || !client.users?.fetch) return cached;
        next=now()+60000;
        const expected=botId, previous=observed;
        pending=Promise.resolve().then(()=>client.users.fetch(expected,{force:true})).then(fresh=>{
            if (client.user?.id===expected && client.user?.avatar===previous && fresh?.id===expected) cached=avatarURL(fresh,expected);
            return cached;
        }).catch(()=>cached).finally(()=>{pending=null;});
        return pending;
    };
}
const placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="52" fill="#7864be"/><path d="M66 68h124v27h-47v104h-30V95H66z" fill="#fff"/></svg>';
module.exports={avatarURL,createAvatarResolver,placeholder};
