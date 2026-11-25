'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describe, validateSettings, networkDiagnostic } = require('../src/persistence-diagnostics');
const { request } = require('../src/persistence-rpc');

const config = { url: 'https://example.supabase.co', key: 'sb_secret_fake' };
const req = { operation: 'load', key: 'test' };
function reply(status, body) { return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }); }
function jwt(claims) { return 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fake'; }

test('safe HTTP diagnostics never disclose body, key or unknown codes', async () => {
    for (const [status,code] of [[401,'PGRST301'],[403,'42501'],[404,'PGRST205'],[500,'secret_untrusted_code']]) {
        const result = await request(req, { ...config, fetcher: reply(status,{code,message:'SECRET_PAYLOAD',details:config.key}) });
        assert.equal(result.ok,false);
        const text = describe('load',result.diagnostic);
        assert.match(text,new RegExp('HTTP '+status));
        assert.match(text,/lectura/);
        assert.doesNotMatch(JSON.stringify(result)+text,/SECRET_PAYLOAD|sb_secret_fake|secret_untrusted_code/);
    }
});
test('conflict and permission errors are distinguished', async () => {
    const result = await request({...req,operation:'commit'}, {...config,fetcher:reply(400,{code:'P0001',message:'Timmy revision conflict'})});
    assert.match(describe('commit',result.diagnostic),/escritura.*Conflicto de revisión/);
});
test('DNS and TLS, timeout and unknown network errors use a closed vocabulary', async () => {
    for (const code of ['ENOTFOUND','ERR_TLS_CERT_ALTNAME_INVALID','UND_ERR_CONNECT_TIMEOUT','secret-value']) {
        const result = await request(req,{...config,fetcher:async()=>{throw Object.assign(new Error('SECRET_PAYLOAD'),{cause:{code}});}});
        const text = describe('load',result.diagnostic);
        assert.match(text,/Supabase \[lectura\]/);
        if (code !== 'secret-value') assert.ok(text.includes(code));
        assert.doesNotMatch(text,/SECRET_PAYLOAD|secret-value/);
    }
    assert.match(describe('load',networkDiagnostic({name:'TimeoutError'})),/TIMEOUT/);
});
test('secret and legacy keys send appropriate headers; redirects are not followed',async()=>{
    for (const key of [config.key,jwt({role:'service_role'})]) {
        const result=await request(req,{...config,key,fetcher:async(url,options)=>{
            assert.equal(options.headers.apikey,key);
            assert.equal(options.headers.Authorization,key.startsWith('sb_secret_')?undefined:'Bearer '+key);
            assert.equal(options.redirect,'manual');
            return reply(200,[])();
        }});
        assert.deepEqual(result,{ok:true,value:null});
    }
    const redirect=await request(req,{...config,fetcher:reply(302,{})});
    assert.match(describe('load',redirect.diagnostic),/HTTP 302/);
});
test('credential checks do not expose values and reject anon, wrong project, expired and malformed JWT',()=>{
    const cases = [config.url+'/rest/v1', 'https://user:SECRET@example.supabase.co', 'invalid SECRET'];
    for(const url of cases) assert.throws(()=>validateSettings(url,config.key,'test'),e=>!/SECRET|sb_secret_fake/.test(e.message));
    for(const key of ['sb_publishable_SECRET','SECRET',jwt({role:'anon'}),jwt({role:'service_role',ref:'other'}),jwt({role:'service_role',exp:1})]) {
        assert.throws(()=>validateSettings(config.url,key,'test'),e=>!e.message.includes(key));
    }
    assert.equal(validateSettings(config.url,config.key,'test').id,'test');
    assert.equal(validateSettings(config.url,jwt({role:'service_role',ref:'example'}),'test').id,'test');
});
test('malformed remote response cannot masquerade as empty state',async()=>{
    const result=await request(req,{...config,fetcher:reply(200,{})});
    assert.equal(result.ok,false);
    assert.match(describe('load',result.diagnostic),/Respuesta inesperada/);
});
