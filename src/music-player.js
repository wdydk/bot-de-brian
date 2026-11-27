'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { UserError } = require('./core');

const actions = new Set(['pause','resume','skip','stop','down','up','shuffle','loop','queue']);
function parseControl(id) {
    const match = /^tm:music:([a-f0-9-]{36}):([a-z]+)$/.exec(String(id));
    if (!match || !actions.has(match[2])) throw new UserError('Control musical inválido.');
    return { token: match[1], action: match[2] };
}
function assertCurrentPanel(session, panel) {
    if (!session || session.destroyed || !session.current || session.current.track.test ||
        session.current.token !== panel.token || session.current.panel?.id !== panel.messageId ||
        session.current.panel?.channelId !== panel.channelId) {
        throw new UserError('Este reproductor ya no está activo. Usa el panel de la canción actual.');
    }
}
function nextVolume(volume, step) {
    return Math.max(0, Math.min(100, Math.round(volume * 100) + step));
}
function nextLoop(mode) {
    return mode === 'off' ? 'song' : mode === 'song' ? 'queue' : 'off';
}
function durationText(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const whole = Math.floor(seconds);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2,'0');
}
function playerPayload(session, current, ended = false) {
    const t = current.track;
    const paused = session.player.state.status === 'paused' || session.player.state.status === 'autopaused';
    const volume = Math.round(session.volume * 100);
    const label = ended ? ({error:'Error de reproducción',skip:'Canción saltada',stop:'Detenida'})[ended] || 'Finalizada' : paused ? 'En pausa' : 'Reproduciendo';
    const source = t.audiusId ? 'Audius' : t.local ? 'Biblioteca autorizada' : t.spotify ? 'YouTube · resultado aproximado de Spotify' : 'YouTube';
    const e = new EmbedBuilder().setColor(ended === 'error' ? 0xdc565b : ended ? 0x6b7280 : paused ? 0xf0b35c : 0x7c83ff)
        .setAuthor({ name:'Timmy Max • Music Player' })
        .setTitle(String(t.title || 'Pista').slice(0,256))
        .setDescription('**'+label+'** · '+source)
        .addFields(
            { name:'Duración',value:durationText(t.duration),inline:true },
            { name:'Volumen',value:'▰'.repeat(Math.round(volume/10))+'▱'.repeat(10-Math.round(volume/10))+' '+volume+'%',inline:true },
            { name:'Cola',value:String(session.queue.filter(x=>!x.page).length)+(session.remoteQueueHeld?' · Remota retenida':''),inline:true },
            { name:'Repetición',value:({off:'Desactivada',song:'Canción',queue:'Cola'})[session.loop] || 'Desactivada',inline:true })
        .setFooter({text:'Controles de voz y DJ • >musicdiag'});
    if (t.url && !t.local) e.setURL(t.url);
    if (t.audiusId && t.artist) e.addFields({name:'Artista en Audius',value:t.artist,inline:true});
    if (t.thumbnail) e.setThumbnail(t.thumbnail);
    if (t.requester && /^\d{17,20}$/.test(t.requester)) e.addFields({name:'Solicitada por',value:'<@'+t.requester+'>',inline:true});
    if (ended) return {embeds:[e],components:[],allowedMentions:{parse:[]}};
    const button = (action,label,emoji,style=ButtonStyle.Secondary,disabled=false) =>
        new ButtonBuilder().setCustomId('tm:music:'+current.token+':'+action).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
    return {embeds:[e],components:[
        new ActionRowBuilder().addComponents(
            button(paused?'resume':'pause',paused?'Resume':'Pause',paused?'▶️':'⏸️',ButtonStyle.Primary),
            button('skip','Skip','⏭️'),button('stop','Stop','⏹️',ButtonStyle.Danger),button('queue','Queue','📋')),
        new ActionRowBuilder().addComponents(
            button('down','Vol −','🔉',ButtonStyle.Secondary,volume===0),
            button('up','Vol +','🔊',ButtonStyle.Secondary,volume===100),
            button('shuffle','Shuffle','🔀'),button('loop','Loop','🔁',session.loop==='off'?ButtonStyle.Secondary:ButtonStyle.Success))
    ],allowedMentions:{parse:[]}};
}
module.exports = {parseControl,assertCurrentPanel,nextVolume,nextLoop,playerPayload};
