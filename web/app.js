'use strict';
const normalise = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const input = document.getElementById('search');
const cards = [...document.querySelectorAll('.command')];
let selected = '';
function filter() {
    const term = normalise(input?.value || '');
    let count = 0;
    for (const card of cards) {
        const show = (!selected || card.dataset.category === selected) && normalise(card.dataset.search).includes(term);
        card.hidden = !show; if (show) count++;
    }
    const label = document.getElementById('result-count');
    if (label) label.textContent = `${count} comando${count === 1 ? '' : 's'}`;
    const empty = document.getElementById('no-results'); if (empty) empty.hidden = count !== 0;
}
input?.addEventListener('input', filter);
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    selected = button.dataset.filter;
    for (const item of document.querySelectorAll('[data-filter]')) {
        item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button));
    }
    filter();
});
let toastTimer;
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click', async () => {
    const toast = document.getElementById('toast');
    try { await navigator.clipboard.writeText(button.dataset.copy); toast.textContent = 'Copiado. Completa los datos y úsalo en Discord.'; }
    catch { toast.textContent = 'No se pudo copiar. Selecciona el comando y cópialo manualmente.'; }
    clearTimeout(toastTimer); toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
});
document.addEventListener('keydown', event => {
    if (event.key === '/' && input && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); input.focus(); }
});

// Cosmetic preferences only; no server configuration or OAuth data in localStorage.
const preferences = { theme:['dark','light'], accent:['default','pink','mint','lavender'], view:['list','cards'] };
const defaults = {theme:'dark',accent:'default',view:'list'};
let prefs = {...defaults};
try { const saved=JSON.parse(localStorage.getItem('timmy-appearance') || '{}'); for(const key of Object.keys(preferences)) if(preferences[key].includes(saved[key])) prefs[key]=saved[key]; } catch {}
function appearance() {
    for(const key of Object.keys(preferences)) {
        document.documentElement.dataset[key]=prefs[key];
        const field=document.getElementById(`pref-${key}`); if(field) field.value=prefs[key];
    }
}
appearance();
for(const key of Object.keys(preferences)) document.getElementById(`pref-${key}`)?.addEventListener('change',event=>{
    if(!preferences[key].includes(event.target.value)) return;
    prefs[key]=event.target.value; appearance();
    try {localStorage.setItem('timmy-appearance',JSON.stringify(prefs));} catch {}
});
const dialog=document.getElementById('appearance');
document.getElementById('open-appearance')?.addEventListener('click',()=>dialog.showModal());
document.getElementById('reset-appearance')?.addEventListener('click',()=>{prefs={...defaults};appearance();try{localStorage.removeItem('timmy-appearance');}catch{}});

const tabs = [...document.querySelectorAll('.demo-tabs [role="tab"]')];
function showExample(tab) {
    for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
}
for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => showExample(tab));
    tab.addEventListener('keydown', event => {
        const destinations = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
        if (!Object.hasOwn(destinations, event.key)) return;
        event.preventDefault();
        const next = tabs[destinations[event.key]];
        showExample(next); next.focus();
    });
}
const guideLinks = [...document.querySelectorAll('.guide-index a')];
function markSection() {
    for (const link of guideLinks) {
        if (link.hash === (location.hash || '#inicio')) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    }
}
if (guideLinks.length) { markSection(); window.addEventListener('hashchange', markSection); }

for (const form of document.querySelectorAll('[data-composer]')) {
    const get = key => form.elements.namedItem(key)?.value || '';
    const examples = {
        user:'@Alex', 'user.mention':'@Alex','user.name':'Alex',username:'Alex','guild.name':'Tu comunidad',server:'Tu comunidad',
        level:'5',xp:'500','level.new_rank':'5','level.user_xp':'500'
    };
    function sample(value) {
        return value.replace(/\{\{([\w.]+)\}\}/g,'{$1}').replace(/\{([\w.]+)\}/g,(token,key)=>key==='boost.perks' ? get('perks') : examples[key] || token);
    }
    function previewImage(selector,value) {
        const img = form.querySelector(selector);
        const usable = /^https:\/\/[^/\s]+(?:\/|$)/i.test(value);
        if (usable) { if (img.getAttribute('src') !== value) img.src=value; }
        else img.removeAttribute('src');
        img.hidden=!usable;
    }
    function richText(node, value) {
        node.replaceChildren();
        for (const part of sample(value).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
            if (part.startsWith('**') && part.endsWith('**') && part.length>4) {
                const b=document.createElement('strong'); b.textContent=part.slice(2,-2); node.append(b);
            } else if (part.startsWith('`') && part.endsWith('`') && part.length>2) {
                const code=document.createElement('code'); code.textContent=part.slice(1,-1); node.append(code);
            } else node.append(document.createTextNode(part));
        }
    }
    function update() {
        const format = get('format');
        for (const group of form.querySelectorAll('[data-edit]')) group.hidden = group.dataset.edit !== format;
        const raw = get('raw');
        const field = key => raw.match(new RegExp('\\{'+key+':\\s*((?:[^{}]|\\{[^{}]*\\})*)\\}','i'))?.[1] || '';
        const title = format==='card' ? get('cardTitle') : format==='embed' ? get('title') : format==='raw' ? field('title') : '';
        const text = format==='card' ? get('cardText') : format==='embed' ? get('description') : format==='raw' ? field('description') || field('message') || raw : get('birthdayText') || get('plain');
        form.querySelector('[data-preview-title]').textContent = sample(title);
        richText(form.querySelector('[data-preview-text]'),text);
        const previewValue = key => format==='simple' && key==='image' ? get('plainImage') : format==='card' && key==='image' ? get('cardImage') : format === 'embed' ? get(key) : format === 'raw' ? field(key) : '';
        form.querySelector('[data-preview-author]').textContent=sample(previewValue('author'));
        richText(form.querySelector('[data-preview-outside]'),format==='embed'?get('outside'):'');
        const extras=form.querySelector('[data-preview-extras]');
        extras.replaceChildren();
        if (format==='embed') for (const row of form.querySelectorAll('[data-row]')) {
            const line=document.createElement('p');
            richText(line,[...row.querySelectorAll('input')].map(i=>i.value).filter(Boolean).join(' · '));
            extras.append(line);
        }
        const thumbnail = previewValue('thumbnail');
        form.querySelector('[data-preview-avatar]').hidden = thumbnail !== '{user.avatar}';
        previewImage('[data-preview-thumb]',thumbnail); previewImage('[data-preview-image]',previewValue('image'));
        form.querySelector('[data-preview-footer]').textContent=sample(previewValue('footer').split('&&')[0]);
        const color = format==='embed' ? get('color') : field('color');
        form.querySelector('.preview-body').style.borderLeftColor = /^#?[0-9a-f]{6}$/i.test(color) ? '#'+color.replace('#','') : '';
    }
    for (const group of form.querySelectorAll('[data-collection]')) {
        const rows=group.querySelector('[data-rows]'), add=group.querySelector('[data-add]');
        group.addEventListener('click',event=>{
            if (event.target===add && rows.children.length<Number(group.dataset.limit)) {
                rows.append(group.querySelector('template').content.cloneNode(true));
                rows.lastElementChild.querySelector('input').focus();
            } else if (event.target.matches('[data-remove]')) event.target.closest('[data-row]').remove();
            add.disabled=rows.children.length>=Number(group.dataset.limit); update();
        });
    }
    form.querySelector('[data-jump]')?.addEventListener('click',()=>form.querySelector('.panel-preview').scrollIntoView({block:'center'}));
    form.addEventListener('input',update); update();
}
for (const b of document.querySelectorAll('[data-xp-user]')) b.addEventListener('click',()=>{
    const f = document.querySelector('.module-form');
    f.elements.user.value=b.dataset.xpUser; f.elements.total.value=b.dataset.xpTotal;
    f.elements.expected.value=b.dataset.xpTotal; f.elements.total.focus(); f.elements.total.select();
});
document.querySelector('[name="user"]')?.addEventListener('input',e=>{
    const f=e.target.form; if(f.elements.expected) f.elements.expected.value='';
});

for (const form of document.querySelectorAll('[data-composer]')) {
    const test=form.querySelector('[data-test]');
    test?.addEventListener('click',async()=>{
        const status=form.querySelector('[data-test-status]');
        if (!form.elements.testChannel.value) { status.textContent='Selecciona el canal de prueba.'; return; }
        test.disabled=true;
        try {
            const body=new URLSearchParams(new FormData(form)); body.set('intent','test');
            const response=await fetch(form.action,{method:'POST',body});
            status.textContent=response.status===204?'Prueba enviada.':'No se pudo enviar. Revisa el diseño y los permisos del canal.';
        } catch { status.textContent='Falló la conexión.'; }
        finally { test.disabled=false; }
    });
    for (const file of form.querySelectorAll('[data-upload]')) file.addEventListener('change',async()=>{
        const selected=file.files[0]; if (!selected) return;
        const status=file.parentElement.nextElementSibling;
        if (selected.size>4194304) { status.textContent='El máximo es 4 MB.'; return; }
        file.disabled=true; status.textContent='Subiendo imagen…';
        try {
            const res=await fetch(form.action+'?imagen=1',{method:'POST',headers:{'X-CSRF-Token':form.elements.csrf.value},body:selected});
            if (!res.ok) throw Error();
            form.elements[file.dataset.upload].value=(await res.json()).url;
            form.dispatchEvent(new Event('input')); status.textContent='Imagen lista.';
        } catch { status.textContent='No se pudo subir. Usa PNG, JPG, GIF o WebP, o pega una URL.'; }
        finally { file.disabled=false; }
    });
}
for (const select of document.querySelectorAll('.module-form select[name="channel"],.module-form select[name="testChannel"],.module-form select[name="role"]')) {
    const search=document.createElement('input');
    search.type='search';search.placeholder=select.name==='role'?'Buscar rol…':'Buscar canal…';
    search.setAttribute('aria-label',search.placeholder);
    select.before(search);
    const options=Array.from(select.options);
    search.addEventListener('input',()=>{
        const selected=select.value, query=search.value.trim().toLocaleLowerCase();
        select.replaceChildren(...options.filter(option=>option.value===selected || !option.value || option.text.toLocaleLowerCase().includes(query)));
        select.value=selected;
    });
}

function showPanelLogin(status, message) {
    const link = document.createElement('a');
    link.href = '/auth/login';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Iniciar sesión en otra pestaña';
    status.replaceChildren(message + ' ', link, '. Luego vuelve aquí y pulsa Guardar cambios.');
}

for (const form of document.querySelectorAll('.module-form[data-user]')) {
    const save = form.querySelector('[type="submit"]');
    const status = form.querySelector('[data-save-status]');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        status.textContent = 'Guardando…';
        const headers = { Accept: 'application/json' };
        try {
            const session = await fetch('/panel/sesion', { headers, cache: 'no-store' });
            if (session.status === 401) {
                showPanelLogin(status, 'Tu sesión expiró. El borrador sigue aquí.');
                return;
            }
            const current = await session.json();
            if (!session.ok) {
                status.textContent = current.message;
                return;
            }
            if (current.user !== form.dataset.user) {
                showPanelLogin(status, 'La cuenta cambió. Usa la cuenta que abrió este borrador.');
                return;
            }
            form.elements.csrf.value = current.csrf;
            const data = new URLSearchParams();
            for (const [key, value] of new FormData(form)) {
                if (typeof value === 'string') data.append(key, value);
            }
            const result = await fetch(form.action, { method: 'POST', headers, body: data });
            if (result.status === 401) {
                showPanelLogin(status, 'Tu sesión expiró. El borrador sigue aquí.');
                return;
            }
            const reply = await result.json();
            if (result.ok) location.assign(reply.dest);
            else status.textContent = reply.message;
        } catch {
            status.textContent = 'No se confirmó el guardado. Tu borrador sigue aquí.';
        } finally {
            save.disabled = false;
        }
    });
}

// Refresh only the public avatar, never reload the editor or lose unsaved changes.
const botAvatars=[...document.querySelectorAll('[data-bot-avatar]')];
if(botAvatars.length) {
    let lastAvatarCheck=Date.now();
    const refreshAvatar=()=>{
        if(document.hidden || Date.now()-lastAvatarCheck<60000)return;
        lastAvatarCheck=Date.now();
        const src='/bot-avatar?v='+lastAvatarCheck;
        // Keep the previous image visible until the replacement loads successfully.
        const next=new Image();
        next.onload=()=>{for(const img of botAvatars)img.src=src;};
        next.src=src;
    };
    setInterval(refreshAvatar,60000);
    document.addEventListener('visibilitychange',refreshAvatar);
}

const menuToggle=document.querySelector('.control-menu-toggle');
if(menuToggle){
    menuToggle.addEventListener('click',()=>{
        const open=menuToggle.getAttribute('aria-expanded')!=='true';
        menuToggle.setAttribute('aria-expanded',String(open));
        document.getElementById('control-menu').classList.toggle('menu-open',open);
    });
}
for(const btn of document.querySelectorAll('[data-custom-test]'))btn.addEventListener('click',async()=>{
    const form=btn.closest('form'), out=form.querySelector('[data-custom-result]');
    const body=new URLSearchParams(new FormData(form));body.set('intent','custom-test');
    btn.disabled=true;out.textContent='Validando…';
    try{
        const res=await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body});
        const data=await res.json();out.textContent=res.ok?data.command+'\n\n'+data.result:(data.message||'No se pudo validar.');
    }catch{out.textContent='No se pudo validar. Reintenta.';}finally{btn.disabled=false;}
});

for(const search of document.querySelectorAll('[data-library-search]'))search.addEventListener('input',()=>{
    const q=search.value.trim().toLocaleLowerCase();
    for(const row of document.querySelectorAll('[data-music-search]'))row.hidden=!row.dataset.musicSearch.toLocaleLowerCase().includes(q);
});
for(const zone of document.querySelectorAll('[data-music-drop]')){
    const input=zone.querySelector('input[type=file]');
    for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.add('dragging');});
    for(const name of ['dragleave','drop'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('dragging');});
    zone.addEventListener('drop',e=>{if(e.dataTransfer.files.length===1)input.files=e.dataTransfer.files;});
}
async function sendMusic(form,kind,file,meta){
    const max=(kind==='audio'?25:3)*1024*1024;
    if(!file||!file.size||file.size>max)throw Error('Archivo vacío o demasiado grande.');
    const encoded=btoa(Array.from(new TextEncoder().encode(JSON.stringify(meta)),c=>String.fromCharCode(c)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const response=await fetch(form.action+'?musicUpload='+kind,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/octet-stream','X-CSRF-Token':form.elements.csrf.value,'X-Music-Meta':encoded},body:file});
    const data=await response.json();if(!response.ok)throw Error(data.message||'No se pudo guardar.');return data;
}
for(const form of document.querySelectorAll('[data-music-upload],[data-music-cover]'))form.addEventListener('submit',async e=>{
    e.preventDefault();if(!form.reportValidity())return;
    const btn=form.querySelector('button'),status=form.querySelector('[data-upload-status]');btn.disabled=true;
    let saved=false;
    try{
        status.textContent='Subiendo y validando archivo…';
        if(form.hasAttribute('data-music-upload')){
            const audio=form.elements.audio.files[0],cover=form.elements.cover.files[0],format=audio.name.split('.').pop().toLowerCase();
            const data=await sendMusic(form,'audio',audio,{format,title:form.elements.title.value,artist:form.elements.artist.value,rights:form.elements.rights.value,confirm:'yes'});
            saved=true;status.textContent='Audio guardado. Procesando portada…';
            if(cover)await sendMusic(form,'cover',cover,{id:data.id,confirm:'yes'});
        }else await sendMusic(form,'cover',form.elements.cover.files[0],{id:form.dataset.musicCover,confirm:'yes'});
        location.reload();
    }catch(err){status.textContent=(saved?'El audio ya se guardó; no lo subas de nuevo. Recarga para editar la portada. ':'')+err.message;if(!saved)btn.disabled=false;}
});

if('serviceWorker' in navigator && window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});


// Aurora: cosmetic motion control and progressive navigation. Never change server data.
(()=>{
    const root=document.documentElement,top=document.querySelector('.top'),nav=top?.querySelector('nav');
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused=false;
    try{paused=localStorage.getItem('timmy-motion')==='off';}catch{}
    const motion=document.createElement('button');motion.type='button';motion.className='quiet tm-motion-toggle';
    const apply=()=>{const off=paused||reduced.matches;root.dataset.motion=off?'off':'on';motion.textContent=reduced.matches?'Movimiento reducido (sistema)':paused?'Activar animaciones':'Pausar animaciones';motion.setAttribute('aria-pressed',String(off));motion.disabled=reduced.matches;};
    motion.addEventListener('click',()=>{paused=!paused;try{localStorage.setItem('timmy-motion',paused?'off':'on');}catch{}apply();});
    reduced.addEventListener?.('change',apply);apply();nav?.append(motion);
    if(top&&nav){
        const toggle=document.createElement('button');toggle.type='button';toggle.className='tm-mobile-nav';toggle.textContent='☰ Menú';nav.id='tm-main-nav';toggle.setAttribute('aria-controls',nav.id);
        top.insertBefore(toggle,nav);top.dataset.mobileMenu='ready';
        const mobile=window.matchMedia('(max-width: 740px)');
        const open=value=>{nav.hidden=!value;toggle.setAttribute('aria-expanded',String(value));toggle.textContent=value?'✕ Cerrar':'☰ Menú';};
        const sync=()=>{toggle.hidden=!mobile.matches;open(!mobile.matches);};
        toggle.addEventListener('click',()=>open(nav.hidden));
        top.addEventListener('keydown',e=>{if(e.key==='Escape'&&mobile.matches&&!nav.hidden){open(false);toggle.focus();}});
        mobile.addEventListener?.('change',sync);sync();
    }
    const online=document.querySelector('.tm-public-stats>div:last-child');
    if(online?.querySelector('strong')?.textContent.trim()==='Online')online.dataset.online='';
    if('IntersectionObserver' in window&&!paused&&!reduced.matches){
        const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){if(root.dataset.motion!=='off')entry.target.classList.add('tm-animate-once');observer.unobserve(entry.target);}}},{threshold:.12});
        for(const item of document.querySelectorAll('.module-index a,.tm-server-card,.tm-faq details'))observer.observe(item);
    }
    // Public catalogue search, without disturbing the existing private dashboard filters.
    const catalogue=document.querySelector('.plain .commands')?.closest('.plain');
    if(catalogue&&!document.getElementById('search')){
        const list=[...catalogue.querySelectorAll('.commands .command')];
        if(list.length){
            const label=document.createElement('label');label.className='search tm-public-search';
            const field=document.createElement('input');field.type='search';field.placeholder='Buscar comandos…';field.setAttribute('aria-label','Buscar comandos públicos');field.autocomplete='off';
            label.append(field);
            const count=document.createElement('p');count.className='tm-public-count';count.setAttribute('role','status');
            const firstGroup=catalogue.querySelector('h2')||catalogue.querySelector('.commands');firstGroup.before(label,count);
            const refresh=()=>{let visible=0;const q=normalise(field.value.trim());for(const card of list){card.hidden=!normalise(card.dataset.search||'').includes(q);if(!card.hidden)visible++;}for(const group of catalogue.querySelectorAll('.commands')){group.hidden=![...group.querySelectorAll('.command')].some(c=>!c.hidden);const heading=group.previousElementSibling;if(heading?.tagName==='H2')heading.hidden=group.hidden;}count.textContent=visible+' comandos encontrados';};
            field.addEventListener('input',refresh);refresh();
        }
    }
})();
