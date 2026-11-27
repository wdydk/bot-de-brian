'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChannelType, PermissionsBitField, Collection, ActivityType } = require('discord.js');
const { createAudioPlayer, NoSubscriberBehavior, VoiceConnectionStatus } = require('@discordjs/voice');
const { buildBot } = require('../index');
const { Store } = require('../src/core');
const { Assistant } = require('../src/ai');
const { toneBuffer } = require('../src/music');

const G='110000000000000001', OWNER='210000000000000001', OTHER='210000000000000002', BOT='210000000000000003';
const CHANNEL='310000000000000001', CATEGORY='310000000000000002', VOICE='310000000000000003', ROLE='410000000000000001';
const SPOTIFY='https://open.spotify.com/intl-es/track/5DdWTn9Snp801vg4bm0EXP?si=prueba';
const SUPPORT='410000000000000002', ANNOUNCEMENTS='310000000000000004';
const avatar='https://cdn.discordapp.com/embed/avatars/0.png';
const noop=async()=>{};

// Only the transport is replaced. Selection, FFmpeg, the Opus player and the command handlers run normally.
function prepareAudio(dir) {
    const root=path.join(dir,'music-library');
    fs.mkdirSync(root,{recursive:true});
    const pcm=toneBuffer(3), header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);
    header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);
    header.writeUInt32LE(48000,24);header.writeUInt32LE(192000,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);
    header.write('data',36);header.writeUInt32LE(pcm.length,40);
    fs.writeFileSync(path.join(root,'tono.wav'),Buffer.concat([header,pcm]));
    fs.writeFileSync(path.join(root,'manifest.json'), JSON.stringify([
        {id:'tono',title:'Tono sintético',artist:'Prueba',file:'tono.wav',rights:'Tono generado para la prueba',spotifyUrl:SPOTIFY}
    ]));
}

function fixture(t) {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-commands-'));
    const store=new Store(directory);
    prepareAudio(directory);
    const replies=[], messages=new Collection();
    let now=Date.now(), sequence=0;
    t.mock.method(Date,'now',()=>now);
    t.mock.method(globalThis,'fetch',async input=>{
        const url=String(input);
        if(url==='https://users.roblox.com/v1/users/42')return Response.json({id:42,name:'Test',displayName:'Test'});
        if(url==='https://friends.roblox.com/v1/users/42/friends/count')return Response.json({count:3});
        throw Error('Unexpected HTTP request in command test');
    });
    const guild={id:G,ownerId:OWNER,name:'Servidor de prueba',memberCount:3,iconURL:()=>null,fetch:async()=>guild};
    const client=Object.assign(new EventEmitter(),{
        user:{id:BOT}, ws:{ping:12}, guilds:{cache:new Collection([[G,guild]]),fetch:async()=>guild},
        application:{fetch:async()=>({owner:{id:OWNER}})},fetchInvite:async()=>({guild}),destroy:noop
    });
    function send(value) {
        const data=typeof value==='string'?{content:value}:value;
        replies.push(JSON.parse(JSON.stringify(data)));
        const m={id:String(510000000000000000n+BigInt(++sequence)),author:client.user,edit:send,delete:noop};
        messages.set(m.id,m);
        return Promise.resolve(m);
    }
    const members=new Collection();
    function member(id,position,admin) {
        const user={id,username:'usuario'+position,createdTimestamp:now,displayAvatarURL:()=>avatar,bannerURL:()=>avatar,send};
        const m={id,user,guild,displayName:user.username,displayAvatarURL:()=>avatar,joinedTimestamp:now,premiumSinceTimestamp:now,
            permissions:new PermissionsBitField(admin?['Administrator']:['ViewChannel','SendMessages','ReadMessageHistory']),
            roles:{cache:new Collection(),highest:{position,comparePositionTo:other=>position-other.position},add:noop,remove:noop},
            moderatable:true,kickable:true,bannable:true,setNickname:noop,timeout:noop,kick:noop,ban:noop};
        members.set(id,m);return m;
    }
    const owner=member(OWNER,100,true), bot=member(BOT,90,true);
    member(OTHER,1,false);
    client.users={fetch:async id=>members.get(id).user};
    guild.members={me:bot,fetchMe:async()=>bot,fetch:async value=>members.get(value?.user||value),ban:noop};
    guild.presences={cache:new Collection([[OWNER,{activities:[{name:'Spotify',type:ActivityType.Listening,details:'Tono',state:'Prueba'}]}]])};
    const role={id:ROLE,guild,name:'Voluntario',position:5,editable:true,permissions:new PermissionsBitField()};
    guild.roles={cache:new Collection([[ROLE,role],[SUPPORT,{...role,id:SUPPORT,name:'Soporte'}]]),fetch:async id=>guild.roles.cache.get(id)};
    const text={id:CHANNEL,guildId:G,guild,type:ChannelType.GuildText,name:'pruebas',send,sendTyping:noop,isThread:()=>false,
        isTextBased:()=>true,permissionsFor:m=>m.permissions,bulkDelete:async n=>({size:n}),setRateLimitPerUser:noop,
        permissionOverwrites:{cache:new Collection(),async edit(id,{SendMessages}){
            this.cache.set(id,{allow:new PermissionsBitField(SendMessages===true?['SendMessages']:[]),
                deny:new PermissionsBitField(SendMessages===false?['SendMessages']:[])});
        }},
        messages:{fetch:async ref=>typeof ref==='string'?messages.get(ref):new Collection(),edit:(id,data)=>messages.get(id).edit(data)}};
    const category={id:CATEGORY,type:ChannelType.GuildCategory,guildId:G,guild};
    const voice={id:VOICE,type:ChannelType.GuildVoice,parentId:CATEGORY,guildId:G,guild,permissionsFor:m=>m.permissions,setUserLimit:noop};
    const announcements={...text,id:ANNOUNCEMENTS,name:'avisos',permissionOverwrites:{...text.permissionOverwrites,cache:new Collection()}};
    guild.channels={cache:new Collection([[CHANNEL,text],[CATEGORY,category],[VOICE,voice],[ANNOUNCEMENTS,announcements]]),
        fetch:async id=>id?guild.channels.cache.get(id):guild.channels.cache};
    for(const m of members.values())m.voice={channelId:VOICE,channel:voice,serverMute:false};
    const ai=new Assistant({key:'',generate:async req=>({text:
        req.config.systemInstruction.includes('borrador de anuncio')?'{embed}$v{description: Hola}':'Respuesta de prueba'
    })});
    const app=buildBot({store,client,ai});
    app.music.legacyLocal=true; // Historical audio compatibility is tested explicitly.
    const cfg=store.guild(G);
    cfg.prefix='!';
    cfg.levels.enabled=true;
    cfg.temporaryVoice={[VOICE]:{owner:OWNER,category:CATEGORY}};
    cfg.warnings[OTHER]=[{id:'previa',reason:'Ejemplo',moderator:OWNER}];
    app.music._connect=async ctx=>{
        await app.music.access(ctx);
        let session=app.music.sessions.get(G);
        if(!session){
            const connection={state:{status:VoiceConnectionStatus.Ready},destroy:noop};
            const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});
            session={guildId:G,voiceId:VOICE,text,queue:[],current:null,volume:.65,loop:'off',player,connection};
            app.music.sessions.set(G,session);
        }
        return session;
    };
    t.after(async()=>{await app.shutdown();fs.rmSync(directory,{recursive:true,force:true});});

    async function invoke(surface,name,definition,values,raw,who=OWNER) {
        const actor=members.get(who);
        now+=45000;
        replies.length=0;
        if(surface==='slash'){
            const options={
                get(key){const i=definition.params.findIndex(p=>p.name===key);if(i<0||values[i]===undefined)return null;
                    return {value:definition.params[i].type===4?Number(values[i]):values[i]};},
                getSubcommandGroup:()=>'fakepermissions',getSubcommand:()=>'list',getRole:()=>null,getString:()=>null,getAttachment:()=>null
            };
            const interaction={guild,guildId:G,channel:text,channelId:CHANNEL,user:actor.user,member:actor,commandName:name,
                isButton:()=>false,isChatInputCommand:()=>true,options,editReply:send,followUp:send,reply:send,
                async deferReply(options){this.deferred=true;this.ephemeral=Boolean(options.flags);}};
            await client.listeners('interactionCreate')[0](interaction);
            assert.equal(interaction.deferred,true,name);
        }else{
            const content=surface==='bare' ? raw : '>'+name+' '+(raw??values.join(' '));
            await client.listeners('messageCreate')[0]({guild,channel:text,member:actor,author:actor.user,content,attachments:new Collection()});
        }
        return replies;
    }
    async function publishDraw(customId) {
        const common={guild,guildId:G,channelId:CHANNEL,user:owner.user,reply:send,editReply:send,deferReply:noop,message:{edit:noop}};
        await app.giveaways.handle({...common,customId});
        const id=customId.split(':').at(-1), message=messages.get(app.giveaways.find(id).message);
        for(const user of [owner.user,members.get(OTHER).user]){
            await app.giveaways.handle({...common,customId:'tm:draw:join:'+id,user,message});
        }
        return message.id;
    }
    function deletedAndEditedMessages(){
        const old={guild,channel:text,author:members.get(OTHER).user,content:'Texto de prueba'};
        client.emit('messageDelete',old);
        client.emit('messageUpdate',old,{...old,content:'Texto editado'});
    }
    return {app,store,invoke,publishDraw,deletedAndEditedMessages};
}

test('a single shared link reaches the play handler once in the music channel', async t => {
    const {app,invoke,store}=fixture(t);
    const channel=app.client.guilds.cache.get(G).channels.cache.get(CHANNEL);
    const played=[];
    const audius='https://audius.co/Artist/track';
    app.music.play=async(ctx,query)=>{played.push(query);return {title:'Pista',requestStatus:'started'};};
    await invoke('bare','',null,[],audius);
    assert.deepEqual(played,[]);
    channel.name='🎶・Music 24/7';
    const replies=await invoke('bare','',null,[],audius);
    assert.equal(replies.filter(r=>r.content?.includes('Reproducción iniciada')).length,1);
    await invoke('bare','',null,[],SPOTIFY);
    await invoke('bare','',null,[],'Mira esta canción '+audius);
    store.guild(G).verificationTickets[CHANNEL]={};
    await invoke('bare','',null,[],audius);
    assert.deepEqual(played,[audius,SPOTIFY]);
});

const inputs={
    help:['play'],official:['plan'],levelmessage:['view'],boostmessage:['view'],ask:['¿Qué es una playlist?'],
    cumple:['31/12'],giveaway:[CHANNEL,'5 horas','premio','1'],staffconfig:['list'],
    customcmd:['text saludo Hola'],dado:['6'],'8ball':['¿Jugamos?'],vc:['limit 3'],socialconfig:['on'],
    hug:[OTHER],kiss:[OTHER],slap:[OTHER],ship:[OTHER],marry:[OTHER],socialprivacy:['status'],
    roblox:['42'],translate:['es','hello'],support:['Cómo uso play'],recuerda:['lista'],
    welcome:['list'],goodbye:['list'],embed:['{embed}$v{title: Prueba}'],embedai:[CHANNEL+' Haz un anuncio'],ticketdesign:['reset'],
    ticketstyle:['buttons'],ticketoption:['list'],autorole:['off'],logs:['off'],djrole:['off'],prefix:['>'],
    snipeconfig:['on'],automod:['off'],aiconfig:['on'],knowledge:['add reglas Reglas del servidor'],
    autoreact:['list'],responder:['list'],rolebutton:[ROLE+' Prueba'],purge:['2'],
    timeout:[OTHER,'10m','Prueba'],untimeout:[OTHER],kick:[OTHER,'Prueba'],ban:[OTHER,'Prueba'],warn:[OTHER,'Prueba'],
    warnings:[OTHER],clearwarn:[OTHER,'previa'],lockdownall:['lock CONFIRMAR '+ANNOUNCEMENTS],nick:[OTHER,'Apodo'],
    role:[OTHER,ROLE,'add'],slowmode:['5'],say:['Hola mundo'],ticketsetup:[CATEGORY+' '+SUPPORT],
    play:[SPOTIFY],volume:['25'],loop:['off']
};
const prefixForms={access:'fakepermissions list',giveaway:'<#'+CHANNEL+'> hours: 5 prize: premio winners: 1'};
const musicOrder=['join','spotify','play','queue','nowplaying','pause','resume','volume','loop','shuffle','skip','audiotest','stop','musicdiag'];
for(const surface of ['prefix','slash']){
    test('ejecuta el catálogo completo por '+surface+' con los transportes de prueba',async t=>{
        const config={WEB_BASE_URL:'https://timmy.example',WEB_ENABLED:'true',DISCORD_CLIENT_ID:BOT,DISCORD_CLIENT_SECRET:'test',
            SPOTIFY_CLIENT_ID:'test',SPOTIFY_CLIENT_SECRET:'test',ROBLOX_CLIENT_ID:'test',ROBLOX_CLIENT_SECRET:'test'};
        t.mock.property(process,'env',{...process.env,...config});
        const {app,store,invoke,publishDraw,deletedAndEditedMessages}=fixture(t), failures=[];
        const values={...inputs};
        const names=[...app.commands.keys()].filter(n=>!musicOrder.includes(n)).concat(musicOrder);
        assert.equal(new Set(names).size,app.commands.size);
        assert.deepEqual(app.slashDefinitions().map(d=>d.name),[...app.commands.keys()]);
        for(const name of names){
            if(name==='close'||name==='transcript')store.data.tickets[CHANNEL]={guildId:G,ownerId:OWNER};
            if(name==='join')delete store.data.tickets[CHANNEL];
            if(name==='snipe')deletedAndEditedMessages();
            try{
                const out=await invoke(surface,name,app.commands.get(name),values[name]||[],prefixForms[name],name==='socialreply'?OTHER:OWNER);
                assert.ok(out.length,'sin respuesta');
                const errors=out.filter(p=>p.content?.startsWith('❌')).map(p=>p.content).join('\n');
                assert.equal(errors,'');
                if(name==='giveaway'){
                    const id=await publishDraw(out.at(-1).components[0].components[0].custom_id);
                    values.gend=[id];values.greroll=[id];
                }
                if(name==='gend'||name==='greroll')assert.match(out.at(-1).content,/Sorteo terminado|Ganadores reemplazados/);
                if(name==='lockdownall')assert.ok(out.some(p=>p.content?.includes('avisos: OK')));
                if(name==='marry'){
                    const invitation=out.find(p=>p.components?.length);
                    values.socialreply=['aceptar '+invitation.components[0].components[0].custom_id.split(':')[3]];
                }
                if(name==='prefix')assert.equal(store.guild(G).prefix,'>');
                if(name==='play'){
                    assert.ok(out.some(p=>p.content?.includes('Reproducción iniciada')));
                    assert.ok(app.music.sessions.get(G).current.bytes>0);
                }
                if(name==='audiotest')assert.equal(app.music.sessions.get(G).current.track.test,true);
            }catch(error){failures.push(name+' — '+error.message);}
        }
        assert.deepEqual(failures,[]);
    });
}
test('cada alias por prefijo despacha el mismo comando canónico', async t=>{
    const {app,invoke}=fixture(t);
    const seen=new Set();
    for(const d of app.definitions){
        t.mock.method(d,'handler',ctx=>ctx.reply(d.name));
        for(const alias of d.aliases){
            assert.ok(!seen.has(alias)&&!app.commands.has(alias),alias);
            seen.add(alias);
            const out=await invoke('prefix',alias,d,[]);
            assert.equal(out.at(-1)?.content,d.name,alias);
        }
    }
    assert.ok(seen.size>0);
});
