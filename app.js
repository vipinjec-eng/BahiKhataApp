/* ── हिसाब बहीखाता ── */

// ── CONFIG ─────────────────────────────────────────────────────────────────
const APP_VERSION = 'v32';
const DEFAULT_SERVER_URL = 'https://bahikhataworker.vipinjec.workers.dev';

// Surface any JS error on screen (helps diagnose stale-cache breakage)
window.addEventListener('error', ev => {
  try {
    const t = document.getElementById('toast');
    if (t) { t.textContent = '⚠️ ' + (ev.message || 'error'); t.classList.remove('hidden'); t.classList.add('show'); }
  } catch {}
});

// ── DEVANAGARI HELPERS ─────────────────────────────────────────────────────
const DEVA_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function toDevNum(str) {
  return String(str).replace(/[0-9]/g, d => DEVA_DIGITS[+d]);
}
function fromDevNum(str) {
  return String(str).replace(/[०-९]/g, d => DEVA_DIGITS.indexOf(d));
}
function fmtAmount(n) {
  return '₹' + toDevNum(Math.abs(n).toLocaleString('en-IN'));
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return toDevNum(`${d}/${m}/${y}`);
}
function displayDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
const TYPE_LABELS = { udhar:'उधार', bikri:'बिक्री', kharidi:'खरीदी', hisab:'हिसाब' };
const WA_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="#25d366" style="vertical-align:middle;margin-right:4px"><path d="M20.52 3.48A11.94 11.94 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.12.55 4.18 1.6 6L0 24l6.17-1.58A12.04 12.04 0 0 0 12 24c6.63 0 12-5.37 12-12a11.94 11.94 0 0 0-3.48-8.52zM12 22c-1.85 0-3.64-.5-5.2-1.44l-.37-.22-3.66.94.97-3.56-.24-.38A9.97 9.97 0 0 1 2 12c0-5.52 4.48-10 10-10s10 4.48 10 10-4.48 10-10 10zm5.47-7.54c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15c-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52s-.67-1.6-.92-2.2c-.24-.58-.49-.5-.67-.5l-.57-.01c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.18-1.41-.07-.13-.27-.2-.57-.35z"/></svg>`;

// ── BACKUP CODE HELPERS (localStorage + cookie fallback) ───────────────────
function getBackupCode() {
  let code = localStorage.getItem('bahi_backup_code');
  if (!code) {
    const m = document.cookie.match(/bahi_code=([^;]+)/);
    if (m) { code = decodeURIComponent(m[1]); saveBackupCode(code); }
  }
  return code || '';
}
function saveBackupCode(code) {
  localStorage.setItem('bahi_backup_code', code);
  document.cookie = `bahi_code=${encodeURIComponent(code)};max-age=31536000;path=/;SameSite=Strict`;
}
function clearBackupCode() {
  localStorage.removeItem('bahi_backup_code');
  document.cookie = 'bahi_code=;max-age=0;path=/';
}

// ── STATE ──────────────────────────────────────────────────────────────────
let entries = JSON.parse(localStorage.getItem('bahi_entries') || '[]');
let earnings = JSON.parse(localStorage.getItem('bahi_earnings') || '[]');
let activeTab = 'entries';
let searchQuery = '';
let starOnly = false;
let editingId = null;
let pendingPhotoBase64 = null;
let pendingPhotoEntryId = null;
let scanPreviewBase64 = null;
let scanResultRows = [];
let cloudEnabled = !!getBackupCode();
let cloudDirty = false;
let cloudTimer = null;
let selectedDateFilter = '';

// ── IndexedDB PHOTO STORE ──────────────────────────────────────────────────
let photoDB = null;
function openPhotoDB() {
  return new Promise((resolve, reject) => {
    if (photoDB) return resolve(photoDB);
    const req = indexedDB.open('bahiPhotosDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = e => { photoDB = e.target.result; resolve(photoDB); };
    req.onerror = e => reject(e);
  });
}
async function savePhoto(id, base64) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id, data: base64 });
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}
async function getPhoto(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').get(id);
    req.onsuccess = () => resolve(req.result ? req.result.data : null);
    req.onerror = reject;
  });
}
async function deletePhoto(id) {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}
async function getAllPhotos() {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}

// ── IMAGE COMPRESSION ──────────────────────────────────────────────────────
function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let {width, height} = img;
        if (Math.max(width, height) > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── SAVE / RENDER ──────────────────────────────────────────────────────────
function saveEntries() {
  localStorage.setItem('bahi_entries', JSON.stringify(entries));
  render();
  schedulePushBackup();
}

function computeTotals(list) {
  let diya = 0, liya = 0;
  list.forEach(e => { if (e.direction === 'diya') diya += e.amount; else liya += e.amount; });
  return { diya, liya, baki: diya - liya };
}

function allFiltered() {
  return entries.filter(e => {
    if (starOnly && !e.star) return false;
    if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
}

function render() {
  const list = allFiltered();
  const { diya, liya, baki } = computeTotals(list);
  document.getElementById('sumDiya').textContent = fmtAmount(diya);
  document.getElementById('sumLiya').textContent = fmtAmount(liya);
  const bv = document.getElementById('sumBaki');
  bv.textContent = (baki < 0 ? '-' : '') + fmtAmount(Math.abs(baki));
  bv.style.color = baki < 0 ? 'var(--red)' : baki > 0 ? 'var(--gold)' : 'var(--muted)';

  // update name datalist
  const names = [...new Set(entries.map(e => e.name))].sort();
  document.getElementById('nameList').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
  // update address datalist
  const addrs = [...new Set(entries.map(e => e.address).filter(Boolean))].sort();
  document.getElementById('addressList').innerHTML = addrs.map(a => `<option value="${esc(a)}">`).join('');

  renderReminders();

  if (activeTab === 'entries') renderEntries(list);
  else if (activeTab === 'people') renderPeople(list);
  else if (activeTab === 'earnings') renderEarnings();
  else renderDates(list);
}

function saveEarnings() {
  localStorage.setItem('bahi_earnings', JSON.stringify(earnings));
  render();
  schedulePushBackup();
}

function monthLabel(ym) {
  const MONTHS = ['जनवरी','फ़रवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितंबर','अक्टूबर','नवंबर','दिसंबर'];
  const [y, m] = ym.split('-');
  return `${MONTHS[+m - 1]} ${toDevNum(y)}`;
}

function renderEarnings() {
  const content = document.getElementById('content');
  const today = todayISO();

  // TODAY only
  const todayEarns = earnings.filter(e => e.date === today).sort((a, b) => b.id.localeCompare(a.id));
  const todayTotal = todayEarns.reduce((s, e) => s + e.amount, 0);
  const todayEntries = entries.filter(e => e.date === today);
  const tDiya = todayEntries.filter(e => e.direction === 'diya').reduce((s, e) => s + e.amount, 0);
  const tLiya = todayEntries.filter(e => e.direction === 'liya').reduce((s, e) => s + e.amount, 0);

  const quickAdd = `<div class="earn-quick">
    <div class="earn-today-label">आज की कमाई <span class="muted">(${fmtDate(today)})</span></div>
    <div class="earn-today-val">${fmtAmount(todayTotal)}</div>
    <div class="earn-add-row">
      <input type="text" id="earnAmount" inputmode="numeric" placeholder="₹ रकम" style="text-align:right;letter-spacing:1px">
      <input type="text" id="earnNote" placeholder="नोट (वैकल्पिक)">
      <button id="earnAddBtn" class="btn-primary">➕ जोड़ें</button>
    </div>
  </div>`;

  const earnRows = todayEarns.length ? todayEarns.map(e => `<div class="earn-row" data-earn-del="${esc(e.id)}">
      <span class="earn-date">${fmtDate(e.date)}</span>
      <span class="earn-note">${e.note ? esc(e.note) : 'कमाई'}</span>
      <span class="earn-amt">${fmtAmount(e.amount)}</span>
      <button class="del-btn" title="हटाएँ">🗑️</button>
    </div>`).join('') : `<div class="muted" style="text-align:center;padding:10px;font-size:.85rem">आज कोई कमाई नहीं जोड़ी</div>`;

  const todayCard = `<div class="month-card">
    <div class="month-title">📅 आज का हिसाब</div>
    <div class="month-summary">
      <div class="ms-item ms-earn"><span>💰 कमाई</span><b>${fmtAmount(todayTotal)}</b></div>
      <div class="ms-item ms-diya"><span>दिया</span><b>${fmtAmount(tDiya)}</b></div>
      <div class="ms-item ms-liya"><span>लिया</span><b>${fmtAmount(tLiya)}</b></div>
      <div class="ms-item ms-baki"><span>बाकी</span><b>${((tDiya-tLiya)<0?'-':'')}${fmtAmount(Math.abs(tDiya-tLiya))}</b></div>
    </div>
    <div class="pd-list" style="margin-top:8px">${earnRows}</div>
  </div>`;

  // ── reminders: overdue + today + next 7 days ──
  const in7 = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const dueList = entries
    .filter(e => e.dueDate && e.dueDate <= in7)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let remindCard = '';
  if (dueList.length) {
    const rows = dueList.map(e => {
      let cls = 'r-upcoming', label = fmtDate(e.dueDate);
      if (e.dueDate < today) { cls = 'r-over'; label = 'बकाया · ' + fmtDate(e.dueDate); }
      else if (e.dueDate === today) { cls = 'r-today'; label = 'आज'; }
      return `<div class="remind-item">
        <div class="remind-info">
          <span class="remind-badge ${cls}">${label}</span>
          <span class="remind-name">${esc(e.name)} · ${fmtAmount(e.amount)} <span class="muted">(${e.direction==='diya'?'देना':'लेना'})</span></span>
        </div>
        <div class="remind-btns">
          <button data-remind-wa="${esc(e.id)}" title="WhatsApp">🟢</button>
          <button data-remind-open="${esc(e.id)}" title="खोलें">✏️</button>
        </div>
      </div>`;
    }).join('');
    remindCard = `<div class="month-card">
      <div class="month-title">🔔 रिमाइंडर (${toDevNum(dueList.length)})</div>
      <div class="remind-list">${rows}</div>
    </div>`;
  } else {
    remindCard = `<div class="month-card"><div class="month-title">🔔 रिमाइंडर</div><div class="muted" style="text-align:center;padding:10px;font-size:.85rem">कोई due तारीख़ वाली एंट्री नहीं।<br>एंट्री में "⏰ याद दिलाएँ" तारीख़ डालें।</div></div>`;
  }

  const monthlyBtn = `<button id="openMonthlyBtn" class="footer-btn" style="margin:0 14px 12px;width:calc(100% - 28px)">📊 मासिक हिसाब देखें</button>`;

  content.innerHTML = quickAdd + remindCard + todayCard + monthlyBtn;

  content.querySelectorAll('[data-remind-open]').forEach(btn =>
    btn.addEventListener('click', () => openForm(entries.find(e => e.id === btn.dataset.remindOpen))));
  content.querySelectorAll('[data-remind-wa]').forEach(btn =>
    btn.addEventListener('click', () => waRemind(entries.find(e => e.id === btn.dataset.remindWa))));

  const amtInp = document.getElementById('earnAmount');
  amtInp.addEventListener('input', e => {
    const pos = e.target.selectionStart;
    e.target.value = toDevNum(e.target.value.replace(/[^\d०-९]/g, ''));
    e.target.setSelectionRange(pos, pos);
  });
  document.getElementById('earnAddBtn').addEventListener('click', () => {
    const amount = parseFloat(fromDevNum(amtInp.value));
    if (!amount || amount <= 0) { showToast('सही रकम लिखें'); return; }
    const note = document.getElementById('earnNote').value.trim();
    earnings.push({ id: uid(), date: todayISO(), amount, note });
    saveEarnings();
    showToast('आज की कमाई जुड़ गई ✓');
  });
  content.querySelectorAll('[data-earn-del]').forEach(row => {
    row.querySelector('.del-btn').addEventListener('click', () => {
      const idx = earnings.findIndex(x => x.id === row.dataset.earnDel);
      if (idx !== -1) { earnings.splice(idx, 1); saveEarnings(); showToast('कमाई हटाई ✓'); }
    });
  });
  document.getElementById('openMonthlyBtn').addEventListener('click', openMonthlySummary);
}

function openMonthlySummary() {
  // group earnings + ledger by month (YYYY-MM)
  const months = {};
  earnings.forEach(e => {
    const ym = e.date.slice(0, 7);
    if (!months[ym]) months[ym] = { earn: 0, diya: 0, liya: 0 };
    months[ym].earn += e.amount;
  });
  entries.forEach(e => {
    const ym = e.date.slice(0, 7);
    if (!months[ym]) months[ym] = { earn: 0, diya: 0, liya: 0 };
    if (e.direction === 'diya') months[ym].diya += e.amount;
    else months[ym].liya += e.amount;
  });
  const sortedMonths = Object.keys(months).sort((a, b) => b.localeCompare(a));

  const html = sortedMonths.length ? sortedMonths.map(ym => {
    const m = months[ym];
    const baki = m.diya - m.liya;
    return `<div class="month-card" style="box-shadow:none;border:1px solid var(--border);margin:0 0 10px">
      <div class="month-title">${monthLabel(ym)}</div>
      <div class="month-summary">
        <div class="ms-item ms-earn"><span>💰 कमाई</span><b>${fmtAmount(m.earn)}</b></div>
        <div class="ms-item ms-diya"><span>दिया</span><b>${fmtAmount(m.diya)}</b></div>
        <div class="ms-item ms-liya"><span>लिया</span><b>${fmtAmount(m.liya)}</b></div>
        <div class="ms-item ms-baki"><span>बाकी</span><b>${(baki<0?'-':'')}${fmtAmount(Math.abs(baki))}</b></div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><span class="emoji">📊</span>अभी कोई हिसाब नहीं।</div>`;

  document.getElementById('monthlyList').innerHTML = html;
  document.getElementById('monthlyModal').classList.remove('hidden');
}
document.getElementById('monthlyCloseBtn')?.addEventListener('click', () => document.getElementById('monthlyModal').classList.add('hidden'));
document.getElementById('monthlyModal')?.addEventListener('click', e => { if (e.target === document.getElementById('monthlyModal')) document.getElementById('monthlyModal').classList.add('hidden'); });

function renderReminders() {
  const banner = document.getElementById('remindersBanner');
  const today = todayISO();
  // entries with a due date today or overdue, sorted by due date
  const due = entries
    .filter(e => e.dueDate && e.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!due.length) { banner.innerHTML = ''; return; }
  banner.innerHTML = `<div class="reminders-banner">
    <h3>⏰ याद दिलाने वाली ${toDevNum(due.length)} एंट्री</h3>
    ${due.map(e => {
      const over = e.dueDate < today;
      return `<div class="reminder-line">
        <span><span class="${over ? 'r-over' : 'r-today'}">${over ? 'बकाया' : 'आज'}</span> — ${esc(e.name)} · ${fmtAmount(e.amount)}</span>
        <span>
          <button data-remind-wa="${esc(e.id)}" title="WhatsApp याद दिलाएँ">🟢</button>
          <button data-remind-open="${esc(e.id)}" title="खोलें">✏️</button>
        </span>
      </div>`;
    }).join('')}
  </div>`;
  banner.querySelectorAll('[data-remind-open]').forEach(btn =>
    btn.addEventListener('click', () => openForm(entries.find(e => e.id === btn.dataset.remindOpen))));
  banner.querySelectorAll('[data-remind-wa]').forEach(btn =>
    btn.addEventListener('click', () => waRemind(entries.find(e => e.id === btn.dataset.remindWa))));
}

function waRemind(e) {
  if (!e) return;
  const dir = e.direction === 'diya' ? 'आपको मुझसे' : 'मुझे आपसे';
  const msg = `नमस्ते ${e.name} जी,\nयाद दिलाना था — ${dir} ${fmtAmount(e.amount)} का हिसाब बाकी है (तारीख़: ${fmtDate(e.dueDate)}).\nकृपया देख लें। धन्यवाद 🙏`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderEntries(list) {
  const content = document.getElementById('content');
  if (!list.length) {
    content.innerHTML = `<div class="empty-state"><span class="emoji">📒</span>कोई एंट्री नहीं है।<br>＋ दबाकर पहली एंट्री जोड़ें।</div>`;
    return;
  }
  // group by date descending
  const groups = {};
  list.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });
  const sortedDates = Object.keys(groups).sort((a,b) => b.localeCompare(a));
  content.innerHTML = sortedDates.map(date => `
    <div class="date-group">
      <div class="date-header">${fmtDate(date)}</div>
      ${groups[date].map(e => entryCard(e)).join('')}
    </div>`).join('');
  content.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openForm(entries.find(e => e.id === btn.dataset.edit)));
  });
  content.querySelectorAll('[data-photo-view]').forEach(btn => {
    btn.addEventListener('click', () => viewPhoto(btn.dataset.photoView));
  });
  content.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteEntryById(btn.dataset.del));
  });
}

function reminderChip(e) {
  if (!e.dueDate) return '';
  const today = todayISO();
  let cls = 'due-upcoming', label = 'याद';
  if (e.dueDate < today) { cls = 'due-over'; label = 'बकाया'; }
  else if (e.dueDate === today) { cls = 'due-today'; label = 'आज'; }
  return `<div class="reminder-chip ${cls}">⏰ ${label}: ${fmtDate(e.dueDate)}</div>`;
}

function entryCard(e) {
  const cls = e.star ? 'star' : e.direction;
  return `<div class="entry-card ${cls}">
    <div class="entry-info">
      <div class="entry-name">${esc(e.name)}${e.star ? ' ⭐' : ''}</div>
      <div class="entry-meta">${TYPE_LABELS[e.type] || e.type}${e.address ? ' · 📍' + esc(e.address) : ''}${e.note ? ' · ' + esc(e.note) : ''}</div>
      ${reminderChip(e)}
    </div>
    <div class="entry-amount-col">
      <div class="entry-amount">${fmtAmount(e.amount)}</div>
      <div style="font-size:.7rem;color:var(--muted)">${e.direction === 'diya' ? 'दिया' : 'लिया'}</div>
      <div class="entry-actions">
        ${e.hasPhoto ? `<button data-photo-view="${esc(e.id)}" title="फोटो देखें">📷</button>` : ''}
        <button data-edit="${esc(e.id)}" title="संपादित करें">✏️</button>
        <button data-del="${esc(e.id)}" title="हटाएँ" class="del-btn">🗑️</button>
      </div>
    </div>
  </div>`;
}

async function deleteEntryById(id) {
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  if (!confirm(`"${entries[idx].name}" की यह एंट्री हटा दें?`)) return;
  if (entries[idx].hasPhoto) await deletePhoto(id);
  entries.splice(idx, 1);
  saveEntries();
  showToast('एंट्री हटा दी ✓');
}

function renderPeople(list) {
  const content = document.getElementById('content');
  if (!list.length) {
    content.innerHTML = `<div class="empty-state"><span class="emoji">👤</span>कोई एंट्री नहीं है।</div>`;
    return;
  }
  const people = {};
  list.forEach(e => {
    if (!people[e.name]) people[e.name] = { diya:0, liya:0, count:0, address:'', items:[] };
    if (e.direction === 'diya') people[e.name].diya += e.amount;
    else people[e.name].liya += e.amount;
    people[e.name].count++;
    people[e.name].items.push(e);
    if (e.address) people[e.name].address = e.address;
  });
  const sorted = Object.entries(people).sort(([a],[b]) => a.localeCompare(b));
  content.innerHTML = sorted.map(([name, p]) => {
    const baki = p.diya - p.liya;
    const bCls = baki > 0 ? 'baki-pos' : baki < 0 ? 'baki-neg' : 'baki-zero';
    const bLabel = baki >= 0 ? `आना है: ${fmtAmount(baki)}` : `देना है: ${fmtAmount(-baki)}`;
    const detailRows = p.items
      .slice().sort((a,b) => b.date.localeCompare(a.date))
      .map(e => `<div class="pd-row" data-open-entry="${esc(e.id)}">
        <span class="pd-date">${fmtDate(e.date)}</span>
        <span class="pd-type">${TYPE_LABELS[e.type] || e.type}${e.note ? ' · ' + esc(e.note) : ''}</span>
        <span class="pd-amt" style="color:${e.direction==='diya'?'var(--green)':'var(--red)'}">${e.direction==='diya'?'दिया':'लिया'} ${fmtAmount(e.amount)}</span>
      </div>`).join('');
    return `<div class="person-card">
      <div class="person-header">
        <div class="person-name">${esc(name)}${p.address ? `<span class="person-addr">📍 ${esc(p.address)}</span>` : ''}</div>
        <div class="person-baki ${bCls}">${(baki < 0 ? '-' : '') + fmtAmount(Math.abs(baki))}</div>
        <button class="icon-btn" data-rename="${esc(name)}" title="नाम सुधारें" style="font-size:1.1rem">✏️</button>
      </div>
      <div class="person-sub">एंट्री: ${toDevNum(p.count)} · दिया ${fmtAmount(p.diya)} · लिया ${fmtAmount(p.liya)} · ${bLabel}</div>
      <details class="person-details">
        <summary>📋 सारी एंट्री देखें (${toDevNum(p.count)})</summary>
        <div class="pd-list">${detailRows}</div>
      </details>
      <div class="person-footer">
        <button class="footer-btn btn-wa" data-wa-person="${esc(name)}">${WA_SVG} WhatsApp</button>
      </div>
    </div>`;
  }).join('');
  content.querySelectorAll('[data-rename]').forEach(btn => btn.addEventListener('click', () => openRename(btn.dataset.rename)));
  content.querySelectorAll('[data-wa-person]').forEach(btn => btn.addEventListener('click', () => waSharePerson(btn.dataset.waPerson)));
  content.querySelectorAll('[data-open-entry]').forEach(row => row.addEventListener('click', () => {
    const e = entries.find(x => x.id === row.dataset.openEntry);
    if (e) openForm(e);
  }));

  // WhatsApp footer button for all
  document.getElementById('whatsAppAllBtn').onclick = waShareAll;
}

function renderDates(list) {
  const content = document.getElementById('content');

  const dateLabel = selectedDateFilter ? fmtDate(selectedDateFilter) : 'तारीख़ चुनें';
  const picker = `<div class="date-picker-bar">
    <div style="position:relative;flex:1">
      <button id="datePickerBtn" class="date-picker-btn">${selectedDateFilter ? '📅 ' + dateLabel : '📅 तारीख़ चुनें'}</button>
      <input type="date" id="datePicker" value="${selectedDateFilter}" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer">
    </div>
    ${selectedDateFilter ? `<button id="datePickerClear" class="btn-secondary" style="padding:8px 14px;white-space:nowrap">✕ सभी</button>` : ''}
  </div>`;

  if (!list.length) {
    content.innerHTML = picker + `<div class="empty-state"><span class="emoji">📅</span>कोई एंट्री नहीं है।</div>`;
  } else {
    const filtered = selectedDateFilter ? list.filter(e => e.date === selectedDateFilter) : list;
    const groups = {};
    filtered.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });
    const sortedDates = Object.keys(groups).sort((a,b) => b.localeCompare(a));

    const cardsHtml = sortedDates.length ? sortedDates.map(date => {
      const dayEntries = groups[date];
      const t = computeTotals(dayEntries);
      const baki = t.diya - t.liya;
      return `<div class="date-card">
        <div class="date-card-header">
          <div class="date-card-date">${fmtDate(date)}</div>
          <button class="footer-btn btn-wa" data-wa-date="${esc(date)}" style="width:auto;padding:6px 10px;font-size:.8rem">${WA_SVG} भेजें</button>
        </div>
        <div class="date-card-summary">दिया: ${fmtAmount(t.diya)} · लिया: ${fmtAmount(t.liya)} · बाकी: ${(baki<0?'-':'')}${fmtAmount(Math.abs(baki))}</div>
        <div class="date-card-entries">
          ${dayEntries.map(e => `<div class="date-entry-row" data-id="${esc(e.id)}" style="cursor:pointer">
            <span>${esc(e.name)}${e.star?' ⭐':''} <span class="type-tag">${TYPE_LABELS[e.type]}</span></span>
            <span style="font-weight:700;color:${e.direction==='diya'?'var(--green)':'var(--red)'}">${e.direction==='diya'?'दिया':'लिया'} ${fmtAmount(e.amount)}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('') : `<div class="empty-state"><span class="emoji">📅</span>इस तारीख़ पर कोई एंट्री नहीं।</div>`;

    content.innerHTML = picker + cardsHtml;
    content.querySelectorAll('[data-wa-date]').forEach(btn => btn.addEventListener('click', () => waShareDate(btn.dataset.waDate)));
    content.querySelectorAll('[data-id]').forEach(row => row.addEventListener('click', () => {
      const e = entries.find(x => x.id === row.dataset.id);
      if (e) openForm(e);
    }));
  }

  document.getElementById('datePicker').addEventListener('change', e => {
    selectedDateFilter = e.target.value;
    render();
  });
  const clearBtn = document.getElementById('datePickerClear');
  if (clearBtn) clearBtn.addEventListener('click', () => { selectedDateFilter = ''; render(); });
}

// ── FORM MODAL ─────────────────────────────────────────────────────────────
function openForm(entry = null) {
  editingId = entry ? entry.id : null;
  pendingPhotoBase64 = null;

  document.getElementById('formTitle').textContent = entry ? 'एंट्री सुधारें' : 'नई एंट्री';
  document.getElementById('fName').value = entry ? entry.name : '';
  document.getElementById('fAmount').value = entry ? toDevNum(entry.amount) : '';
  document.getElementById('fType').value = entry ? entry.type : 'udhar';
  const fDateVal = entry ? entry.date : todayISO();
  document.getElementById('fDate').value = fDateVal;
  document.getElementById('fDateBtn').textContent = '📅 ' + fmtDate(fDateVal);
  document.getElementById('fNote').value = entry ? (entry.note || '') : '';
  document.getElementById('fAddress').value = entry ? (entry.address || '') : '';
  document.getElementById('fStar').checked = entry ? !!entry.star : false;

  // due date / reminder
  const dueVal = entry ? (entry.dueDate || '') : '';
  document.getElementById('fDue').value = dueVal;
  document.getElementById('fDueBtn').textContent = dueVal ? '⏰ ' + fmtDate(dueVal) : '⏰ तारीख़ चुनें (वैकल्पिक)';

  // direction pills
  const dirVal = entry ? entry.direction : 'diya';
  document.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.dir === dirVal);
  });

  // photo
  const previewWrap = document.getElementById('photoPreviewWrap');
  previewWrap.classList.add('hidden');
  document.getElementById('photoInput').value = '';
  if (entry && entry.hasPhoto) {
    getPhoto(entry.id).then(base64 => {
      if (base64) {
        pendingPhotoBase64 = base64;
        document.getElementById('photoPreview').src = 'data:image/jpeg;base64,' + base64;
        previewWrap.classList.remove('hidden');
      }
    });
  }

  document.getElementById('deleteEntryBtn').classList.toggle('hidden', !entry);
  document.getElementById('formModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('fName').focus(), 100);
}

document.getElementById('cancelFormBtn').addEventListener('click', () => closeFormModal());
document.getElementById('formModal').addEventListener('click', e => { if (e.target === document.getElementById('formModal')) closeFormModal(); });
function closeFormModal() {
  pendingPhotoBase64 = null;
  document.getElementById('formModal').classList.add('hidden');
}

document.querySelectorAll('.pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
  });
});

document.getElementById('photoPickBtn').addEventListener('click', () => {
  document.getElementById('photoInput').click();
});
document.getElementById('photoInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingPhotoBase64 = await compressImage(file);
    document.getElementById('photoPreview').src = 'data:image/jpeg;base64,' + pendingPhotoBase64;
    document.getElementById('photoPreviewWrap').classList.remove('hidden');
  } catch { showToast('फोटो लोड नहीं हुई'); }
});
document.getElementById('photoRemoveBtn').addEventListener('click', () => {
  pendingPhotoBase64 = null;
  document.getElementById('photoPreviewWrap').classList.add('hidden');
  document.getElementById('photoInput').value = '';
});

document.getElementById('saveEntryBtn').addEventListener('click', async () => {
  const name = document.getElementById('fName').value.trim();
  const amount = parseFloat(fromDevNum(document.getElementById('fAmount').value));
  if (!name) { showToast('नाम ज़रूरी है'); return; }
  if (!amount || amount <= 0) { showToast('सही रकम लिखें'); return; }
  const direction = document.querySelector('.pill.active').dataset.dir;
  const type = document.getElementById('fType').value;
  const date = document.getElementById('fDate').value || todayISO();
  const note = document.getElementById('fNote').value.trim();
  const address = document.getElementById('fAddress').value.trim();
  const star = document.getElementById('fStar').checked;
  const dueDate = document.getElementById('fDue').value || '';

  if (editingId) {
    const idx = entries.findIndex(e => e.id === editingId);
    if (idx !== -1) {
      const hadPhoto = entries[idx].hasPhoto;
      entries[idx] = { ...entries[idx], name, amount, direction, type, date, note, address, star, dueDate, hasPhoto: !!pendingPhotoBase64 || (hadPhoto && pendingPhotoBase64 !== null) };
      if (pendingPhotoBase64) await savePhoto(editingId, pendingPhotoBase64);
      else if (!pendingPhotoBase64 && hadPhoto) await deletePhoto(editingId);
    }
  } else {
    const id = uid();
    const hasPhoto = !!pendingPhotoBase64;
    entries.push({ id, name, amount, direction, type, date, note, address, star, dueDate, hasPhoto });
    if (pendingPhotoBase64) await savePhoto(id, pendingPhotoBase64);
  }
  saveEntries();
  closeFormModal();
  showToast(editingId ? 'एंट्री अपडेट हुई ✓' : 'एंट्री जुड़ गई ✓');
});

document.getElementById('deleteEntryBtn').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('यह एंट्री हटा दें?')) return;
  const idx = entries.findIndex(e => e.id === editingId);
  if (idx !== -1) {
    if (entries[idx].hasPhoto) await deletePhoto(editingId);
    entries.splice(idx, 1);
  }
  saveEntries();
  closeFormModal();
  showToast('एंट्री हटा दी ✓');
});

document.getElementById('fabAdd').addEventListener('click', () => openForm());

// ── RENAME MODAL ───────────────────────────────────────────────────────────
let renamingFrom = null;
function openRename(name) {
  renamingFrom = name;
  const count = entries.filter(e => e.name === name).length;
  document.getElementById('renameInfo').textContent = `"${name}" — कुल ${toDevNum(count)} एंट्री में बदलेगा।`;
  document.getElementById('renameInput').value = name;
  document.getElementById('renameModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('renameInput').focus(), 100);
}
document.getElementById('renameCancelBtn').addEventListener('click', () => document.getElementById('renameModal').classList.add('hidden'));
document.getElementById('renameModal').addEventListener('click', e => { if (e.target === document.getElementById('renameModal')) document.getElementById('renameModal').classList.add('hidden'); });
document.getElementById('renameSaveBtn').addEventListener('click', () => {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName || newName === renamingFrom) { document.getElementById('renameModal').classList.add('hidden'); return; }
  let changed = 0;
  entries.forEach(e => { if (e.name === renamingFrom) { e.name = newName; changed++; } });
  saveEntries();
  document.getElementById('renameModal').classList.add('hidden');
  showToast(`${toDevNum(changed)} एंट्री में नाम सुधर गया ✓`);
});

// ── PHOTO VIEWER ───────────────────────────────────────────────────────────
async function viewPhoto(id) {
  const base64 = await getPhoto(id);
  if (!base64) { showToast('फोटो नहीं मिली'); return; }
  document.getElementById('photoViewerImg').src = 'data:image/jpeg;base64,' + base64;
  document.getElementById('photoViewer').classList.remove('hidden');
}
document.getElementById('photoViewerClose').addEventListener('click', () => document.getElementById('photoViewer').classList.add('hidden'));
document.getElementById('photoViewer').addEventListener('click', e => { if (e.target === document.getElementById('photoViewer')) document.getElementById('photoViewer').classList.add('hidden'); });

// ── TABS ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    render();
  });
});

// ── SEARCH & STAR ──────────────────────────────────────────────────────────
document.getElementById('searchBox').addEventListener('input', e => {
  searchQuery = e.target.value;
  render();
});
const starBtn = document.getElementById('starFilterBtn');
starBtn.addEventListener('click', () => {
  starOnly = !starOnly;
  starBtn.classList.toggle('active', starOnly);
  render();
});

// ── WHATSAPP ───────────────────────────────────────────────────────────────
function shareWhatsApp(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function waSharePerson(name) {
  const personEntries = entries.filter(e => e.name === name).sort((a,b) => a.date.localeCompare(b.date));
  const t = computeTotals(personEntries);
  const baki = t.diya - t.liya;
  const lines = personEntries.map(e =>
    `${displayDate(e.date)} — ${e.direction === 'diya' ? 'दिया' : 'लिया'} ₹${e.amount.toLocaleString('en-IN')} (${TYPE_LABELS[e.type]})${e.note ? ' — ' + e.note : ''}${e.star ? ' ⭐' : ''}`
  );
  const bLabel = baki >= 0 ? `आना है: ₹${baki.toLocaleString('en-IN')}` : `देना है: ₹${Math.abs(baki).toLocaleString('en-IN')}`;
  const text = `प्रभुति ट्रेडर्स\n\nनमस्ते ${name} जी,\nआपका हिसाब:\n\n${lines.join('\n')}\n\nकुल दिया: ₹${t.diya.toLocaleString('en-IN')}\nकुल लिया: ₹${t.liya.toLocaleString('en-IN')}\n${bLabel}`;
  shareWhatsApp(text);
}

function waShareDate(date) {
  const dayEntries = entries.filter(e => e.date === date).sort((a,b) => a.name.localeCompare(b.name));
  const t = computeTotals(dayEntries);
  const baki = t.diya - t.liya;
  const lines = dayEntries.map(e =>
    `${esc(e.name)} — ${e.direction === 'diya' ? 'दिया' : 'लिया'} ₹${e.amount.toLocaleString('en-IN')} (${TYPE_LABELS[e.type]})${e.star ? ' ⭐' : ''}`
  );
  const text = `प्रभुति ट्रेडर्स\n📅 ${displayDate(date)} का हिसाब\n\n${lines.join('\n')}\n\nकुल दिया: ₹${t.diya.toLocaleString('en-IN')}\nकुल लिया: ₹${t.liya.toLocaleString('en-IN')}\nबाकी: ${baki >= 0 ? '' : '-'}₹${Math.abs(baki).toLocaleString('en-IN')}`;
  shareWhatsApp(text);
}

function waShareAll() {
  const t = computeTotals(entries);
  const baki = t.diya - t.liya;
  const bLabel = baki >= 0 ? `आना है: ₹${baki.toLocaleString('en-IN')}` : `देना है: ₹${Math.abs(baki).toLocaleString('en-IN')}`;
  const text = `📖 प्रभुति ट्रेडर्स — कुल सारांश\n\nकुल एंट्री: ${entries.length}\nकुल दिया: ₹${t.diya.toLocaleString('en-IN')}\nकुल लिया: ₹${t.liya.toLocaleString('en-IN')}\n${bLabel}`;
  shareWhatsApp(text);
}

document.getElementById('whatsAppAllBtn').addEventListener('click', waShareAll);

// ── SETTINGS MODAL ─────────────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('scanSettingsBtn').addEventListener('click', openSettings);
function openSettings() {
  document.getElementById('settingsGeminiKey').value = localStorage.getItem('bahi_gemini_key') || '';
  document.getElementById('settingsServerUrl').value = localStorage.getItem('bahi_server_url') || '';
  document.getElementById('settingsServerPass').value = localStorage.getItem('bahi_server_pass') || '';
  document.getElementById('settingsModal').classList.remove('hidden');
}
document.getElementById('settingsCancelBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
document.getElementById('settingsModal').addEventListener('click', e => { if (e.target === document.getElementById('settingsModal')) document.getElementById('settingsModal').classList.add('hidden'); });
document.getElementById('settingsSaveBtn').addEventListener('click', () => {
  const key = document.getElementById('settingsGeminiKey').value.trim();
  const url = document.getElementById('settingsServerUrl').value.trim();
  const pass = document.getElementById('settingsServerPass').value.trim();
  if (key) localStorage.setItem('bahi_gemini_key', key); else localStorage.removeItem('bahi_gemini_key');
  if (url) localStorage.setItem('bahi_server_url', url); else localStorage.removeItem('bahi_server_url');
  if (pass) localStorage.setItem('bahi_server_pass', pass); else localStorage.removeItem('bahi_server_pass');
  document.getElementById('settingsModal').classList.add('hidden');
  showToast('सेटिंग सेव हुई ✓');
});

// ── SCAN (OCR) FLOW ────────────────────────────────────────────────────────
const GEMINI_PROMPT = `यह एक हिसाब रजिस्टर का फोटो है। इसमें से हर entry को पढ़कर नीचे दिए format में JSON array दो।
हर item में ये fields रखो:
- name: व्यक्ति का नाम (string)
- amount: रकम (number, सिर्फ़ अंक, कोई ₹ या comma नहीं)
- date: तारीख़ YYYY-MM-DD format में (अगर सिर्फ़ DD/MM हो तो साल 2026 मान लो; अगर तारीख़ नहीं दिखे तो आज की तारीख़ दो)
- direction: "diya" (अगर दिया/given/debit हो) या "liya" (अगर लिया/received/credit हो) — अगर पता न हो तो "diya" रखो
- star: true (अगर हरे रंग से highlight हो या बड़ी रकम हो 50000 से ज़्यादा) या false
- note: कोई अतिरिक्त टिप्पणी (string, नहीं तो "")

सिर्फ़ valid JSON array दो, कोई markdown fence नहीं, कोई extra text नहीं।
Format: [{"name":"...","amount":1000,"date":"2026-06-29","direction":"diya","star":false,"note":""}]`;

document.getElementById('scanBtn').addEventListener('click', openScan);
function openScan() {
  document.getElementById('scanStep1').classList.remove('hidden');
  document.getElementById('scanReviewWrap').classList.add('hidden');
  document.getElementById('scanPreviewWrap').classList.add('hidden');
  document.getElementById('scanRunBtn').classList.add('hidden');
  document.getElementById('scanSpinner').classList.add('hidden');
  document.getElementById('scanError').classList.add('hidden');
  document.getElementById('scanFileInput').value = '';
  scanPreviewBase64 = null;
  document.getElementById('scanModal').classList.remove('hidden');
}
document.getElementById('scanCloseBtn').addEventListener('click', () => document.getElementById('scanModal').classList.add('hidden'));
document.getElementById('scanModal').addEventListener('click', e => { if (e.target === document.getElementById('scanModal')) document.getElementById('scanModal').classList.add('hidden'); });

document.getElementById('scanPickBtn').addEventListener('click', () => document.getElementById('scanFileInput').click());
document.getElementById('scanFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    scanPreviewBase64 = await compressImage(file, 1400, 0.88);
    document.getElementById('scanPreviewImg').src = 'data:image/jpeg;base64,' + scanPreviewBase64;
    document.getElementById('scanPreviewWrap').classList.remove('hidden');
    document.getElementById('scanRunBtn').classList.remove('hidden');
    document.getElementById('scanError').classList.add('hidden');
  } catch { showToast('फोटो लोड नहीं हुई'); }
});

document.getElementById('scanRunBtn').addEventListener('click', async () => {
  if (!scanPreviewBase64) return;
  document.getElementById('scanRunBtn').classList.add('hidden');
  document.getElementById('scanSpinner').classList.remove('hidden');
  document.getElementById('scanError').classList.add('hidden');
  try {
    const parsed = await callVision(scanPreviewBase64);
    scanResultRows = parsed;
    showScanReview(parsed);
  } catch (err) {
    document.getElementById('scanSpinner').classList.add('hidden');
    document.getElementById('scanRunBtn').classList.remove('hidden');
    document.getElementById('scanError').textContent = 'पढ़ाई नहीं हुई: ' + (err.message || err);
    document.getElementById('scanError').classList.remove('hidden');
  }
});

async function callVision(base64) {
  const key = localStorage.getItem('bahi_gemini_key');
  const serverUrl = localStorage.getItem('bahi_server_url') || DEFAULT_SERVER_URL;
  const serverPass = localStorage.getItem('bahi_server_pass') || '';

  // ── Path 1: Cloudflare Worker proxy ──────────────────────────────────────
  if (serverUrl) {
    document.getElementById('scanSpinner').textContent = '🤖 Gemini AI से पढ़ रहे हैं...';
    const res = await fetch(serverUrl.replace(/\/$/, '') + '/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, password: serverPass })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `सर्वर error: ${res.status}`);
    }
    const data = await res.json();
    let jsonText = (data.text || data.result || '')
      .replace(/```json\s*/i, '').replace(/```\s*/g, '').trim();
    const arr = JSON.parse(jsonText);
    if (!Array.isArray(arr)) throw new Error('जवाब array नहीं था');
    return arr;
  }

  // ── Path 2: Gemini (if key available) ────────────────────────────────────
  if (key) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }]
        })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini error: ${res.status}`);
    }
    const data = await res.json();
    let jsonText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/```json\s*/i, '').replace(/```\s*/g, '').trim();
    const arr = JSON.parse(jsonText);
    if (!Array.isArray(arr)) throw new Error('जवाब array नहीं था');
    return arr;
  }

  // ── Path 3: OCR.space free (no key needed — always works) ────────────────
  document.getElementById('scanSpinner').textContent = '📷 पढ़ रहे हैं (free OCR)...';
  return await callOcrSpace(base64);
}

// ── OCR.space free service (public key, no signup) ─────────────────────────
async function callOcrSpace(base64) {
  const body = new URLSearchParams({
    apikey: 'helloworld',
    base64Image: 'data:image/jpeg;base64,' + base64,
    language: 'eng',
    isTable: 'false',
    OCREngine: '2',
    scale: 'true',
    isCreateSearchablePdf: 'false'
  });
  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`OCR error: ${res.status}`);
  const data = await res.json();
  if (data.IsErroredOnProcessing) throw new Error(data.ErrorMessage?.[0] || 'OCR नहीं हुई');
  const rawText = data.ParsedResults?.[0]?.ParsedText || '';
  if (!rawText.trim()) throw new Error('फोटो में कुछ पढ़ नहीं हुआ — साफ़ रोशनी में दोबारा फोटो लें');
  return parseRegisterText(rawText);
}

// ── Parse raw OCR text into entry objects ──────────────────────────────────
function parseRegisterText(rawText) {
  const today = todayISO();
  const lines = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  let currentDate = today;

  const dateRx = /(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/;
  const numRx = /[\d,]+/g;

  for (const line of lines) {
    const nums = (line.match(numRx) || [])
      .map(n => parseInt(n.replace(/,/g, '')))
      .filter(n => n >= 100 && n <= 100000000);

    // Date-header line (has date pattern, no large amounts)
    if (nums.length === 0) {
      const dm = line.match(dateRx);
      if (dm) {
        const d = dm[1].padStart(2, '0');
        const m = dm[2].padStart(2, '0');
        const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : '2026';
        if (+m <= 12 && +d <= 31) currentDate = `${y}-${m}-${d}`;
      }
      continue;
    }

    const amount = Math.max(...nums);
    if (amount < 100) continue;

    // Name = line minus numbers, dates, symbols
    let name = line
      .replace(numRx, '')
      .replace(dateRx, '')
      .replace(/[₹\/\-\.\:\;\(\)@#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length < 1) name = 'अज्ञात';

    // Date on same line?
    const dm = line.match(dateRx);
    let entryDate = currentDate;
    if (dm) {
      const d = dm[1].padStart(2, '0');
      const m = dm[2].padStart(2, '0');
      const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : '2026';
      if (+m <= 12 && +d <= 31) entryDate = `${y}-${m}-${d}`;
    }

    entries.push({
      name: name.slice(0, 40),
      amount,
      date: entryDate,
      direction: 'diya',
      star: amount >= 50000,
      note: '(OCR — जाँच लें)'
    });
  }
  return entries;
}

function showScanReview(rows) {
  document.getElementById('scanSpinner').classList.add('hidden');
  document.getElementById('scanStep1').classList.add('hidden');
  const today = todayISO();
  document.getElementById('scanReviewList').innerHTML = rows.map((r, i) => `
    <div class="scan-review-row" id="scanRow${i}">
      <div class="scan-row-head">
        <input type="checkbox" id="scanCheck${i}" checked>
        <label for="scanCheck${i}" style="font-weight:600;font-size:.9rem">#${i+1}</label>
      </div>
      <div class="scan-row-fields">
        <input name="name" value="${esc(r.name || '')}" placeholder="नाम">
        <input name="amount" type="text" inputmode="numeric" value="${r.amount ? toDevNum(r.amount) : ''}" placeholder="रकम" style="text-align:right;letter-spacing:1px">
        <select name="direction">
          <option value="diya" ${r.direction !== 'liya' ? 'selected' : ''}>दिया</option>
          <option value="liya" ${r.direction === 'liya' ? 'selected' : ''}>लिया</option>
        </select>
        <div style="position:relative">
          <button type="button" class="date-picker-btn scan-date-btn" style="width:100%;text-align:left;padding:8px 10px">📅 ${fmtDate(r.date || today)}</button>
          <input name="date" type="date" value="${r.date || today}" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer">
        </div>
        <input name="note" value="${esc(r.note || '')}" placeholder="नोट">
      </div>
      <label style="font-size:.8rem;display:flex;align-items:center;gap:6px;margin-top:4px">
        <input type="checkbox" name="star" ${r.star ? 'checked' : ''}> ⭐ ज़रूरी
      </label>
    </div>`).join('');
  document.querySelectorAll('.scan-review-row [name=date]').forEach(inp => {
    inp.addEventListener('change', e => {
      const btn = e.target.parentElement.querySelector('.scan-date-btn');
      if (btn) btn.textContent = '📅 ' + (e.target.value ? fmtDate(e.target.value) : 'तारीख़');
    });
  });
  document.getElementById('scanReviewWrap').classList.remove('hidden');
}

document.getElementById('scanReviewCancelBtn').addEventListener('click', () => {
  document.getElementById('scanModal').classList.add('hidden');
});
document.getElementById('scanReviewAddBtn').addEventListener('click', async () => {
  const rows = document.querySelectorAll('.scan-review-row');
  let added = 0;
  rows.forEach((row, i) => {
    const checked = row.querySelector(`#scanCheck${i}`).checked;
    if (!checked) return;
    const name = row.querySelector('[name=name]').value.trim();
    const amount = parseFloat(fromDevNum(row.querySelector('[name=amount]').value));
    if (!name || !amount || amount <= 0) return;
    const direction = row.querySelector('[name=direction]').value;
    const date = row.querySelector('[name=date]').value || todayISO();
    const note = row.querySelector('[name=note]').value.trim();
    const star = row.querySelector('[name=star]').checked;
    entries.push({ id: uid(), name, amount, direction, type: 'udhar', date, note, star, hasPhoto: false });
    added++;
  });
  saveEntries();
  document.getElementById('scanModal').classList.add('hidden');
  showToast(`${toDevNum(added)} एंट्री जोड़ी गईं ✓`);
});

// ── BACKUP / RESTORE ───────────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', async () => {
  const photos = await getAllPhotos();
  const photoMap = {};
  photos.forEach(p => { photoMap[p.id] = p.data; });
  const blob = new Blob([JSON.stringify({ entries, earnings, photos: photoMap })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bahikhata-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('बैकअप फ़ाइल सेव हुई ✓');
});

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data.entries)) throw new Error('अमान्य फ़ाइल');
      entries = data.entries;
      localStorage.setItem('bahi_entries', JSON.stringify(entries));
      if (Array.isArray(data.earnings)) {
        earnings = data.earnings;
        localStorage.setItem('bahi_earnings', JSON.stringify(earnings));
      }
      if (data.photos && typeof data.photos === 'object') {
        for (const [id, base64] of Object.entries(data.photos)) {
          await savePhoto(id, base64);
        }
      }
      render();
      showToast(`बैकअप से ${toDevNum(entries.length)} entries वापस आईं ✓`);
    } catch (err) { showToast('बैकअप फ़ाइल गलत है: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── CLOUD BACKUP ───────────────────────────────────────────────────────────
function updateCloudStatus() {
  const code = getBackupCode();
  const lastTime = localStorage.getItem('bahi_last_backup_time');
  const status = document.getElementById('cloudStatus');
  const btn = document.getElementById('cloudToggleBtn');
  if (code) {
    status.textContent = lastTime ? `☁️ आख़िरी बैकअप: ${lastTime}` : '☁️ अपने-आप बैकअप चालू है';
    btn.textContent = '☁️ बैकअप कोड बदलें / बंद करें';
    cloudEnabled = true;
  } else {
    status.textContent = '';
    btn.textContent = '☁️ अपने-आप बैकअप चालू करें';
    cloudEnabled = false;
  }
}

let cloudModalMode = 'enable'; // 'enable' or 'restore'

function cloudMsg(text, kind) {
  const m = document.getElementById('cloudMsg');
  if (!m) return;
  m.textContent = text || '';
  m.className = 'cloud-msg' + (kind ? ' ' + kind : '');
}

document.getElementById('cloudToggleBtn')?.addEventListener('click', () => openCloudModal('enable'));
document.getElementById('cloudRestoreBtn')?.addEventListener('click', () => openCloudModal('restore'));

function openCloudModal(mode) {
  cloudModalMode = mode;
  const modal = document.getElementById('cloudModal');
  const title = document.getElementById('cloudModalTitle');
  const desc = document.getElementById('cloudModalDesc');
  const confirmBtn = document.getElementById('cloudConfirmBtn');
  const disableBtn = document.getElementById('cloudDisableBtn');
  const codeInp = document.getElementById('cloudCodeInput');
  const existing = getBackupCode();

  if (mode === 'restore') {
    if (title) title.textContent = '🔑 कोड से डेटा वापस लाएँ';
    if (desc) desc.textContent = 'जो बैकअप कोड आपने सेट किया था वो डालें — सारा हिसाब वापस आ जाएगा।';
    if (confirmBtn) confirmBtn.textContent = '⬇️ वापस लाएँ';
    if (disableBtn) disableBtn.style.display = 'none';
  } else {
    if (title) title.textContent = '☁️ अपने-आप बैकअप';
    if (desc) desc.textContent = 'एक बैकअप कोड चुनें (कोई भी शब्द/नंबर)। यह कोड याद रखें — नए फ़ोन में डेटा वापस लाने के लिए यही काम आएगा।';
    if (confirmBtn) confirmBtn.textContent = existing ? '💾 अभी बैकअप करें' : '✓ चालू करें';
    if (disableBtn) disableBtn.style.display = existing ? 'block' : 'none';
  }
  if (codeInp) codeInp.value = existing || '';
  cloudMsg('');
  if (modal) modal.classList.remove('hidden');
}

document.getElementById('cloudCancelBtn')?.addEventListener('click', () => document.getElementById('cloudModal').classList.add('hidden'));
document.getElementById('cloudModal')?.addEventListener('click', e => { if (e.target === document.getElementById('cloudModal')) document.getElementById('cloudModal').classList.add('hidden'); });

document.getElementById('cloudDisableBtn')?.addEventListener('click', () => {
  clearBackupCode();
  localStorage.removeItem('bahi_last_backup_time');
  updateCloudStatus();
  document.getElementById('cloudModal').classList.add('hidden');
  showToast('अपने-आप बैकअप बंद हुआ');
});

document.getElementById('cloudConfirmBtn')?.addEventListener('click', async () => {
  try {
    const code = (document.getElementById('cloudCodeInput')?.value || '').trim();
    if (!code) { cloudMsg('⚠️ कोड ज़रूरी है', 'err'); showToast('कोड ज़रूरी है'); return; }
    if (cloudModalMode === 'restore') {
      await cloudRestore(code);
    } else {
      saveBackupCode(code);
      cloudEnabled = true;
      updateCloudStatus();
      cloudMsg('☁️ बैकअप हो रहा है...', '');
      showToast('बैकअप हो रहा है...');
      const r = await pushCloudBackupNow(true);
      if (r.ok) {
        cloudMsg(`✓ बैकअप हो गया (${toDevNum(entries.length)} entries)`, 'ok');
        showToast(`✓ बैकअप चालू (${toDevNum(entries.length)} entries)`);
        setTimeout(() => document.getElementById('cloudModal').classList.add('hidden'), 1200);
      } else {
        cloudMsg('✗ बैकअप नहीं हुआ: ' + r.error, 'err');
        showToast('✗ बैकअप नहीं हुआ: ' + r.error);
      }
    }
  } catch (err) {
    const frames = (err.stack || '').split('\n').slice(0, 4).join(' | ');
    cloudMsg('✗ ' + err.message + ' @ ' + frames, 'err');
    showToast('✗ ' + err.message);
    console.error('cloud enable error', err);
  }
});

async function pushCloudBackupNow(report) {
  const code = getBackupCode();
  const serverUrl = localStorage.getItem('bahi_server_url') || DEFAULT_SERVER_URL;
  const serverPass = localStorage.getItem('bahi_server_pass') || '';
  if (!code) return { ok: false, error: 'कोई कोड नहीं' };
  try {
    const res = await fetch(serverUrl.replace(/\/$/, '') + '/backup/' + encodeURIComponent(code), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, earnings, password: serverPass })
    });
    if (res.ok) {
      const now = new Date().toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' });
      localStorage.setItem('bahi_last_backup_time', now);
      updateCloudStatus();
      return { ok: true };
    }
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err.error || ('HTTP ' + res.status)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cloudRestore(code) {
  const serverUrl = localStorage.getItem('bahi_server_url') || DEFAULT_SERVER_URL;
  const serverPass = localStorage.getItem('bahi_server_pass') || '';
  cloudMsg('⬇️ डेटा ला रहे हैं...', '');
  try {
    const res = await fetch(serverUrl.replace(/\/$/, '') + '/backup/' + encodeURIComponent(code) + '?password=' + encodeURIComponent(serverPass));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      cloudMsg('✗ बैकअप नहीं मिला: ' + (err.error || ('HTTP ' + res.status)) + ' — कोड सही है?', 'err');
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data.entries)) { cloudMsg('✗ बैकअप डेटा अमान्य है', 'err'); return; }
    entries = data.entries;
    localStorage.setItem('bahi_entries', JSON.stringify(entries));
    if (Array.isArray(data.earnings)) {
      earnings = data.earnings;
      localStorage.setItem('bahi_earnings', JSON.stringify(earnings));
    }
    saveBackupCode(code);
    cloudEnabled = true;
    render();
    updateCloudStatus();
    cloudMsg(`✓ ${toDevNum(entries.length)} entries वापस आईं`, 'ok');
    showToast('डेटा वापस आ गया ✓');
    setTimeout(() => document.getElementById('cloudModal').classList.add('hidden'), 1000);
  } catch (err) { cloudMsg('✗ वापसी नहीं हुई: ' + err.message, 'err'); }
}

function schedulePushBackup() {
  if (!cloudEnabled || !getBackupCode()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(pushCloudBackupNow, 5000);
}

// ── TOAST ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 260); }, 2500);
}

document.getElementById('fDate')?.addEventListener('change', e => {
  const b = document.getElementById('fDateBtn');
  if (b) b.textContent = '📅 ' + (e.target.value ? fmtDate(e.target.value) : 'तारीख़ चुनें');
});

document.getElementById('fDue')?.addEventListener('change', e => {
  const b = document.getElementById('fDueBtn');
  if (b) b.textContent = e.target.value ? '⏰ ' + fmtDate(e.target.value) : '⏰ तारीख़ चुनें (वैकल्पिक)';
});
document.getElementById('fDueClearBtn')?.addEventListener('click', () => {
  const inp = document.getElementById('fDue');
  if (inp) inp.value = '';
  const b = document.getElementById('fDueBtn');
  if (b) b.textContent = '⏰ तारीख़ चुनें (वैकल्पिक)';
});

document.getElementById('fAmount')?.addEventListener('input', e => {
  const pos = e.target.selectionStart;
  const converted = toDevNum(e.target.value.replace(/[^\d०-९]/g, ''));
  e.target.value = converted;
  e.target.setSelectionRange(pos, pos);
});

// ── AUTO-RESTORE ON STARTUP ────────────────────────────────────────────────
(async () => {
  const code = getBackupCode();
  if (code && entries.length === 0) {
    try {
      const serverUrl = localStorage.getItem('bahi_server_url') || DEFAULT_SERVER_URL;
      const res = await fetch(`${serverUrl}/backup/${encodeURIComponent(code)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.entries) && data.entries.length > 0) {
          entries = data.entries;
          localStorage.setItem('bahi_entries', JSON.stringify(entries));
          if (Array.isArray(data.earnings)) {
            earnings = data.earnings;
            localStorage.setItem('bahi_earnings', JSON.stringify(earnings));
          }
          cloudEnabled = true;
          render();
          showToast(`☁️ ${toDevNum(entries.length)} entries cloud से वापस आईं ✓`);
        }
      }
    } catch {}
  }
})();

// ── REMINDER NOTIFICATIONS ─────────────────────────────────────────────────
function notifyDueReminders() {
  if (!('Notification' in window)) return;
  const today = todayISO();
  const due = entries.filter(e => e.dueDate && e.dueDate <= today);
  if (!due.length) return;

  const show = () => {
    // only notify once per day
    if (localStorage.getItem('bahi_last_notify') === today) return;
    localStorage.setItem('bahi_last_notify', today);
    const over = due.filter(e => e.dueDate < today).length;
    const body = due.slice(0, 4).map(e => `${e.name} — ${fmtAmount(e.amount)}`).join('\n');
    new Notification('⏰ प्रभुति ट्रेडर्स — याद दिलाना', {
      body: `${toDevNum(due.length)} एंट्री बाकी${over ? ` (${toDevNum(over)} overdue)` : ''}\n${body}`,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'bahi-reminders'
    });
  };

  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') show(); });
  }
}
setTimeout(notifyDueReminders, 2500);

// show running version so cache state is visible
const _vt = document.getElementById('versionTag');
if (_vt) _vt.textContent = 'प्रभुति ट्रेडर्स · ' + APP_VERSION;

// ── SERVICE WORKER REGISTRATION ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // when a new SW takes control, reload once so fresh code + HTML load together
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    // check for updates on each load
    reg.update().catch(() => {});
  }).catch(() => {});
}

// ── INIT ───────────────────────────────────────────────────────────────────
updateCloudStatus();
render();
