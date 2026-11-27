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
test('catálogo histórico de YouTube conserva orden, pero Music 4.0 rechaza su reproducción',async()=>{
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
    const before=calls.length;
    await assert.rejects(music.play(ctx,'https://www.youtube.com/playlist?list=PL1234567'),/enlace de una canción de Audius o Spotify/);
    assert.equal(calls.length,before);assert.deepEqual(s.queue,[]);
});

test('Spotify Connect applies only to the clicking account and confirms only a successful play response',async()=>{
    const {MusicCatalog}=require('../src/music-catalog');
    const requests=[],users=[],id='5DdWTn9Snp801vg4bm0EXP';
    let status=204;
    const catalog=new MusicCatalog({}, {SPOTIFY_CLIENT_ID:'app',SPOTIFY_CLIENT_SECRET:'test'},async(url,opts)=>{
        requests.push({url,method:opts.method,body:JSON.parse(opts.body),auth:opts.headers.Authorization});
        return status===204 ? new Response(null,{status}) : Response.json({error:{message:'insufficient scope'}},{status,headers:{'Retry-After':'45'}});
    });
    catalog.access=async user=>{users.push(user);return 'access-'+user;};
    assert.match(new URL(catalog.connectURL('https://timmy.example','state')).searchParams.get('scope'),/user-modify-playback-state/);
    await catalog.playOnDevice('listener-a','spotify:track:'+id);
    await catalog.playOnDevice('listener-b','spotify:playlist:'+id);
    assert.deepEqual(users,['listener-a','listener-b']);
    assert.deepEqual(requests.map(r=>r.body),[{uris:['spotify:track:'+id]},{context_uri:'spotify:playlist:'+id}]);
    assert.ok(requests.every(r=>r.method==='PUT' && r.url==='https://api.spotify.com/v1/me/player/play'));
    assert.equal(requests[1].auth,'Bearer access-listener-b');
    await assert.rejects(catalog.playOnDevice('listener-b','https://example.com/track/'+id));
    for(const [failure,expected] of [[401,/autorización/],[403,/Actualizar permisos/],[404,/celular/],[500,/no confirmó/],[429,/límite temporal/]]) {
        status=failure;await assert.rejects(catalog.playOnDevice('listener-b','spotify:track:'+id),expected);
    }
    const count=requests.length;
    await assert.rejects(catalog.playOnDevice('listener-b','spotify:track:'+id),/límite temporal/);
    assert.equal(requests.length,count);
});

test('simultaneous idle and error events finalize once and never repeat a failed track',async()=>{
    const m=new Music({},{}), jobs=[], reported=[], retired=[];
    m.serial={run:(key,task)=>{jobs.push(task);return Promise.resolve();}};
    m._start=async()=>{};
    m.reportFailure=async(s,error,track)=>reported.push({error,track});
    m.retirePanel=async(s,track,reason)=>retired.push(reason);
    const s={guildId:'g',destroyed:false,current:{token:'old',track:{title:'A'},children:[]},
        queue:[{title:'B'}],loop:'song',player:{stop(){}}};
    const err=Error('HTTP 429');
    m._scheduleFinish(s,'old','end');
    m._scheduleFinish(s,'old','error',err);
    m._scheduleFinish(s,'old','error',Error('secondary'));
    assert.equal(jobs.length,1);
    await jobs[0]();
    assert.equal(reported.length,1);
    assert.equal(reported[0].error,err);
    assert.deepEqual(retired,['error']);
    assert.deepEqual(s.queue,[{title:'B'}]);
    assert.equal(s.current,null);
});
test('late events from a retired resource cannot alter the next track',async()=>{
    const m=new Music({},{});let queued=0;
    m.serial={run:()=>{queued++;return Promise.resolve();}};
    const s={guildId:'g',current:{token:'new',track:{title:'B'}},destroyed:false};
    m._scheduleFinish(s,'old','error',Error('429'));
    assert.equal(queued,0);
    assert.equal(s.current.failure,undefined);
});
test('cleanup only tears down a playback resource once',()=>{
    const m=new Music({},{});let kills=0,unpipes=0,destroys=0;
    const current={children:[{kill:()=>kills++,stdout:{unpipe:()=>unpipes++}}],meter:{destroy:()=>destroys++}};
    m._cleanup(current);m._cleanup(current);
    assert.deepEqual([kills,unpipes,destroys],[1,1,1]);
});
