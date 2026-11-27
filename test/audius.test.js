'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createAudioPlayer, NoSubscriberBehavior, VoiceConnectionStatus } = require('@discordjs/voice');
const { Audius } = require('../src/audius');
const { Music } = require('../src/music');
const { parseAudiusLink, parseSpotifyLink, musicLinkInChannel } = require('../src/music-selection');
const { routeLocal } = require('../src/ai-music-actions');

const link = 'https://audius.co/Artist/track';
const spotify = 'https://open.spotify.com/intl-es/track/5DdWTn9Snp801vg4bm0EXP?si=example';
const ref = parseSpotifyLink(spotify);
const row = { id:'valid1', title:'Test recording', user:{name:'Artist'}, permalink:'/Artist/track', duration:4,
    isrc:'USAAA2600001', is_available:true, is_streamable:true, is_stream_gated:false, access:{stream:true} };
const json = data => Response.json({data});
const wiki = (...codes) => Response.json({results:{bindings:codes.map(value=>({isrc:{value}}))}});

test('single links preserve recording identity and run only in an intended voice or music chat', () => {
    assert.equal(parseAudiusLink('<' + link + '?utm_source=share>').url, link);
    assert.deepEqual(routeLocal('ponme ' + link), {command:'play',args:[link]});
    for (const input of [link + ' more', 'https://audius.co.example/Artist/track',
        'https://audius.co/Artist/playlist/mix','https://audius.co/Artist/p%2Fsecret','https://name@audius.co/Artist/track']) {
        assert.equal(parseAudiusLink(input), null);
    }
    const message = {content:link, member:{voice:{channelId:'voice'}}, channel:{id:'c',name:'🎵 Music 24/7'}};
    assert.equal(musicLinkInChannel(message), true);
    message.channel.name = 'general'; assert.equal(musicLinkInChannel(message), false);
    assert.equal(musicLinkInChannel(message, {voiceId:'voice',text:{id:'c'}}), true);
    message.channel.id = 'voice'; message.content = spotify; assert.equal(musicLinkInChannel(message), true);
    message.channel.isThread = () => true; assert.equal(musicLinkInChannel(message), false);
    message.channel.isThread = () => false; message.member.voice = {}; assert.equal(musicLinkInChannel(message), false);
});

test('Spotify matches a unique recording code, without a Spotify or YouTube media request', async () => {
    let codes = ['US-AAA-26-00001'], rows = [row];
    const requests = [];
    const provider = new Audius({musicfetchToken:'', request:async url => {
        requests.push(url.hostname);
        if (url.hostname === 'query.wikidata.org') {
            assert.ok(url.searchParams.get('query').includes(ref.id));
            return wiki(...codes);
        }
        assert.equal(url.hostname, 'api.audius.co');
        assert.equal(url.searchParams.get('isrc'), row.isrc);
        return json(rows);
    }});
    assert.equal((await provider.lookup({ref})).audiusId, row.id);
    assert.deepEqual(requests, ['query.wikidata.org','api.audius.co']);
    rows = [{...row,isrc:'USAAA2600002'}]; assert.equal(await provider.lookup({ref}), null);
    rows = [row,{...row,id:'other'}]; assert.equal(await provider.lookup({ref}), null);
    codes.push('USAAA2600002'); requests.length=0;
    assert.equal(await provider.lookup({ref}), null);
    assert.deepEqual(requests, ['query.wikidata.org']);
});

test('configured cross-service lookup uses the supplied track URL and confines its token to the metadata service', async () => {
    const provider = new Audius({musicfetchToken:'fixture', request:async (url, options) => {
        if (url.hostname === 'api.musicfetch.io') {
            assert.equal(options.headers['x-token'], 'fixture'); assert.equal(options.redirect, 'error');
            assert.equal(url.searchParams.get('url'), ref.url);
            return Response.json({result:{type:'track',isrc:row.isrc,services:{audius:{link}}}});
        }
        assert.equal(url.hostname, 'api.audius.co'); assert.equal(options.headers['x-token'], undefined);
        return json([row]);
    }});
    assert.equal((await provider.lookup({ref})).audiusId, row.id);
});

test('a short Spotify share expands once and still prefers a registered local track', async () => {
    const music = new Music({},{}), requests = [];
    let target = spotify;
    music.online = new Audius({request:async url=>{
        requests.push(url.hostname);
        return new Response(null,{status:302,headers:{location:target}});
    }});
    music.onlineLookups.gap = 0;
    music.library.list = () => [{id:'mine',title:'Mi pista',spotifyUrl:ref.url}];
    assert.equal((await music.resolveVoice('https://spotify.link/example')).id,'mine');
    target = 'https://unknown.example/track';
    await assert.rejects(music.resolveVoice('https://spoti.fi/example'),/enlace completo/);
    assert.deepEqual(requests,['spotify.link','spoti.fi']);
});

test('title search requires a unique match and public full-track access', async () => {
    let rows = [row];
    const provider = new Audius({request:async()=>json(rows)});
    assert.equal((await provider.lookup({raw:'Test recording Artist'})).audiusId, row.id);
    assert.equal(await provider.lookup({raw:'Test'}), null);
    rows.push({...row,id:'other'}); assert.equal(await provider.lookup({raw:'Test recording'}), null);
    for (const restriction of [{is_available:false},{is_stream_gated:true},{is_unlisted:true},{allowed_api_keys:['restricted']},
        {access:{stream:false}},{is_streamable:false},{stream_conditions:{follow_user_id:1}},{duration:1801}]) {
        rows = [{...row,...restriction}];
        await assert.rejects(provider.lookup({audius:parseAudiusLink(link)}), /pista completa/);
    }
});

test('audio access is rechecked on dequeue; partial responses and untrusted media redirects are rejected', async () => {
    let metadata = {...row,access:{stream:false}}, result, mediaCalls = 0;
    const provider = new Audius({request:async url => {
        assert.equal(url.hostname, 'api.audius.co');
        if (url.pathname.endsWith('/stream')) { mediaCalls++; return result; }
        return json(metadata);
    }});
    const track = {audiusId:row.id};
    await assert.rejects(provider.open(track, new AbortController()), /pista completa/);
    assert.equal(mediaCalls, 0);
    metadata = row;
    for (const response of [new Response(null,{status:302,headers:{location:'https://unknown.example/media'}}),
        new Response('html',{headers:{'content-type':'text/html'}}),
        new Response('x',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-0/500000'}})]) {
        result = response;
        await assert.rejects(provider.open(track, new AbortController()), /pista completa/);
    }
    assert.equal(mediaCalls, 3);
});

test('an empty library streams to a real Opus player, supports controls and isolates a revoked song', async t => {
    const media = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-f','mp3','pipe:1']);
    const music = new Music({},{});
    const connection = new EventEmitter();
    connection.state = {status:VoiceConnectionStatus.Ready};
    connection.destroy = () => {connection.state = {status:VoiceConnectionStatus.Destroyed};};
    const player = createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});
    const messages = [], signals = [];
    const session = {guildId:'g',voiceId:'voice',connection,player,queue:[],loop:'off',volume:.65,
        text:{id:'c',send:async payload => {messages.push(payload);return {id:'panel',channelId:'c',edit:async()=>{}};}}};
    music.sessions.set('g',session);
    t.after(() => music.closeAll());
    music.access = async () => {};
    music.control = async () => session;
    music._connect = async () => session;
    music.onlineLookups.gap = 0;
    let revoked = false;
    music.online = new Audius({request:async (url, options) => {
        if (url.pathname === '/v1/tracks') return json([row]);
        if (url.pathname === '/v1/tracks/'+row.id) return json({...row,is_available:!revoked});
        if (url.hostname === 'api.audius.co') return new Response(null,{status:302,headers:{location:'https://creatornode.audius.co/music'}});
        assert.equal(url.hostname, 'creatornode.audius.co'); signals.push(options.signal);
        return new Response(media,{headers:{'content-type':'audio/mpeg'}});
    }});
    const ctx = {guild:{id:'g'},user:{id:'u'}};
    assert.equal((await music.play(ctx,link)).requestStatus, 'started');
    const first = session.current;
    assert.ok(first.bytes > 0);
    assert.equal(first.resource.playStream.readableObjectMode, true);
    const panel = messages[0].embeds[0].toJSON();
    assert.equal(panel.url, link); assert.match(panel.description,/Audius/);
    assert.ok(panel.fields.some(f=>f.value === row.user.name));
    const control = action => music.panelAction(ctx, 'tm:music:'+first.token+':'+action, {id:'panel'});
    ctx.channel={id:'c'};
    await control('pause'); assert.equal(player.state.status,'paused');
    await control('resume'); assert.equal(player.state.status,'playing');
    assert.equal((await music.play(ctx,link)).requestStatus, 'queued');
    revoked = true; await control('skip');
    assert.ok(signals[0].aborted); assert.equal(signals.length,1);
    assert.equal(session.current,null); assert.equal(music.safety.blocked(),false);
    assert.equal(music.safety.snapshot('g').lastSource,'AUDIUS');
    assert.ok(messages.some(p=>p.content?.includes('Audius')));
});
