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
