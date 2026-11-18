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
