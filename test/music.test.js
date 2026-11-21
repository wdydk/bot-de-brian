'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Music, musicQuery, toneBuffer, processResult } = require('../src/music');
test('fuentes rechazan URLs no admitidas y listas con ID inválido', () => {
    for (const query of ['http://127.0.0.1/x', 'https://localhost/x', 'https://youtube.com.evil.test/watch?v=aaaaaaaaaaa', 'file:///etc/passwd', 'https://youtube.com/playlist?list=x']) assert.throws(() => musicQuery(query));
    assert.equal(musicQuery('--exec whoami').source, 'ytsearch1:--exec whoami');
    assert.equal(musicQuery('https://youtu.be/abcdefghijk').source, 'https://www.youtube.com/watch?v=abcdefghijk');
});
test('tono PCM tiene duración esperada y amplitud no nula', () => {
    const b = toneBuffer(1); assert.equal(b.length, 48000 * 4);
    assert.ok(b.some(v => v !== 0));
});
test('proceso faltante o fallido devuelve error, no éxito', async () => {
    await assert.rejects(processResult('timmy-no-such-bin', [], 1000));
    await assert.rejects(processResult(process.execPath, ['-e', 'process.exit(1)'], 2000));
});
test('ruta real PCM -> Opus -> AudioPlayer entra en Playing antes del anuncio', async t => {
    const sent = [];
    const m = new Music({}, { guild: () => ({}) });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const s = { player, connection: { state: { status: VoiceConnectionStatus.Ready } },
        guildId: 'g', queue: [{ title: 'Test', test: true }], current: null, volume: .65,
        destroyed: false, text: { send: async payload => { sent.push({ payload, status: player.state.status }); } } };
    t.after(() => { m._cleanup(s.current); player.stop(true); clearTimeout(s.idleTimer); });
    await m._start(s);
    assert.equal(player.state.status, AudioPlayerStatus.Playing);
    assert.ok(s.current.bytes > 0);
    assert.equal(sent[0].status, AudioPlayerStatus.Playing);
});
test('eventos atrasados no saltan dos pistas', async () => {
    const m = new Music({}, {}); let starts = 0;
    m._start = async () => { starts++; };
    const s = { destroyed: false, current: { token: 'old', track: { title: 'A' }, children: [] },
        queue: [], loop: 'queue', player: { stop() {} } };
    await m._finish(s, 'old', 'skip'); await m._finish(s, 'old', 'end');
    assert.equal(starts, 1); assert.equal(s.queue.length, 1);
});
test('FFmpeg genera PCM estéreo a 48 kHz sin silenciar errores', async () => {
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']);
        const chunks = []; let stderr = '';
        child.stdout.on('data', c => chunks.push(c));
        child.stderr.on('data', c => { stderr += c; });
        child.on('error', reject);
        child.on('close', code => code ? reject(Error(stderr)) : resolve(Buffer.concat(chunks)));
    });
    assert.equal(result.length, 48000 * 2 * 2);
    assert.ok(result.some(byte => byte !== 0));
});

test('Spotify vincula solo la cuenta solicitante, renueva al reiniciar y carga sus pistas por páginas',async t=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const {MusicCatalog}=require('../src/music-catalog');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-playlist-'));
    const env={SPOTIFY_CLIENT_ID:'app',SPOTIFY_CLIENT_SECRET:'prueba-solamente'}, calls=[];
    let status=200;
    const request=async(url,opts)=>{
        const parsed=new URL(url);calls.push(parsed);
        if(parsed.pathname==='/api/token') {
            if(opts.body.get('grant_type')==='authorization_code') return Response.json({access_token:'acceso1',refresh_token:'sintetico-refresh',expires_in:3600});
            assert.equal(opts.body.get('refresh_token'),'sintetico-refresh');return Response.json({access_token:'acceso2',expires_in:3600});
        }
        assert.equal(opts.headers.Authorization,'Bearer acceso2');
        if(status!==200) return new Response('',{status});
        return Response.json({next:parsed.searchParams.get('offset')==='0'?'siguiente':null,items:[
            {item:{type:'track',name:'Luna',artists:[{name:'Cielo'}]}},{track:{type:'episode',name:'Podcast'}},{item:null}
        ]});
    };
    const c=new MusicCatalog({directory:dir},env,request);
    const auth=new URL(c.connectURL('https://timmy.example','aleatorio'));
    assert.equal(auth.searchParams.get('redirect_uri'),'https://timmy.example/musica/spotify/callback');
    assert.match(auth.searchParams.get('scope'),/playlist-read-private/);
    await c.connect('alice','codigo','https://timmy.example');
    assert.ok(!c.db().prepare('select secret from spotify').get().secret.includes('sintetico-refresh'));
    c.close();
    const restored=new MusicCatalog({directory:dir},env,request);t.after(()=>{restored.close();fs.rmSync(dir,{recursive:true,force:true});});
    const list=musicQuery('https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=ejemplo');
    await assert.rejects(restored.page(list,'bob'),/vincula/);
    const page=await restored.page(list,'alice');assert.equal(page.tracks.length,1);assert.equal(page.tracks[0].query,'Luna Cielo');
    await restored.page(list,'alice',page.next);assert.equal(calls.at(-1).searchParams.get('offset'),'3');
    status=403;await assert.rejects(restored.page(list,'alice'),/creaste o en las que colaboras/);
    await restored.unlink('alice');assert.equal(restored.linked('alice'),false);
});
test('YouTube conserva el orden de la playlist, reconoce el enlace watch con list y omite vídeos privados',async()=>{
    const {MusicCatalog}=require('../src/music-catalog');
    const calls=[], id='abcdefghijk';
    const catalog=new MusicCatalog({}, {YOUTUBE_API_KEY:'ejemplo'},async url=>{
        calls.push(url);assert.equal(url.searchParams.get('key'),'ejemplo');
        if(url.pathname.endsWith('/search')) return Response.json({items:[{id:{videoId:id}}]});
        return Response.json({items:[{status:{privacyStatus:'private'},snippet:{title:'privado',resourceId:{videoId:id}}},
            {status:{privacyStatus:'public'},snippet:{title:'Primero',resourceId:{videoId:id}}}],nextPageToken:'segunda'});
    });
    const list=musicQuery('https://www.youtube.com/watch?v=abcdefghijk&list=PL1234567');
    const page=await catalog.page(list,'bob');
    assert.deepEqual(page.tracks,[{title:'Primero',query:'https://www.youtube.com/watch?v='+id}]);
    await catalog.page(list,'bob',page.next);assert.equal(calls.at(-1).searchParams.get('pageToken'),'segunda');
    assert.equal(await catalog.video('Luna Cielo'),'https://www.youtube.com/watch?v='+id);
    const music=new Music({},{});music.catalog=catalog;music.access=async()=>{};const s={queue:[]};
    music._connect=async()=>s;music._start=async()=>{};
    const ctx={guild:{id:'g'},user:{id:'bob'}};
    await assert.rejects(music.play(ctx,'file:///nope'));
    await music.play(ctx,'https://www.youtube.com/playlist?list=PL1234567');
    assert.deepEqual(s.queue.map(t=>t.title),['Primero','Más canciones de la playlist']);
    assert.equal(s.queue[1].cursor,'segunda');
});
