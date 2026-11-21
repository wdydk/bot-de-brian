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
        return value.replace(/\{([\w.]+)\}/g,(token,key)=>key==='boost.perks' ? get('perks') : examples[key] || token);
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
        const title = format==='embed' ? get('title') : format==='raw' ? field('title') : '';
        const text = format==='embed' ? get('description') : format==='raw' ? field('description') || field('message') || raw : get('birthdayText') || get('plain');
        form.querySelector('[data-preview-title]').textContent = sample(title);
        richText(form.querySelector('[data-preview-text]'),text);
        const previewValue = key => format === 'embed' ? get(key) : format === 'raw' ? field(key) : '';
        const thumbnail = previewValue('thumbnail');
        form.querySelector('[data-preview-avatar]').hidden = thumbnail !== '{user.avatar}';
        previewImage('[data-preview-thumb]',thumbnail); previewImage('[data-preview-image]',previewValue('image'));
        form.querySelector('[data-preview-footer]').textContent=sample(previewValue('footer').split('&&')[0]);
        const color = format==='embed' ? get('color') : field('color');
        form.querySelector('.preview-body').style.borderLeftColor = /^#?[0-9a-f]{6}$/i.test(color) ? '#'+color.replace('#','') : '';
    }
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
