(() => {
'use strict';
/* ================= 基本工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => 'NT$' + Math.round(Number(n) || 0).toLocaleString('zh-TW');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m||1)-1, d||1); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate()+n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const WD = ['日','一','二','三','四','五','六'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtD = s => { if (!s) return '—'; const d = parseD(s); return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const fmtDY = s => s ? s.replace(/-/g, '/') : '—';
const fmtEN = s => { if (!s) return '—'; const d = parseD(s); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const uid = p => (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const age = b => { if (!b) return ''; const d = parseD(b), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a; };
const TODAY = () => ymd(new Date());
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`;

const IC = {
  plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>', left:'<path d="M15 6l-6 6 6 6"/>', right:'<path d="M9 6l6 6-6 6"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  dl:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>'
};
const ic = (n, s) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${s ? `width="${s}" height="${s}"` : ''} aria-hidden="true">${IC[n]}</svg>`;

/* ================= 資料層 ================= */
const COLS = ['clients', 'appointments', 'orders', 'products', 'services', 'staff'];
const S = { clients:new Map(), appointments:new Map(), orders:new Map(), products:new Map(), services:new Map(), staff:new Map(), settings:{} };
const loaded = new Set();
// 資料存在 Supabase 的 public.docs 表（col + id + data），只有登入且通過核准的成員能讀寫。
const CFG = window.APP_CONFIG || {};
let sb = null, me = null, channel = null, mode = 'connecting', canWrite = true;

const all = c => [...S[c].entries()].map(([id, d]) => ({ id, ...d }));
const get = (c, id) => { const d = S[c].get(id); return d ? { id, ...d } : null; };

function writeErr(e) {
  const code = e && e.code, msg = (e && e.message) || '';
  if (code === '42501' || /row-level security/i.test(msg)) { toast('你的帳號沒有修改權限，請聯絡管理員。', true); return; }
  if (/Failed to fetch|NetworkError/i.test(msg)) { toast('網路連線中斷，資料沒有存到，請確認網路後再試一次。', true); return; }
  if (/JWT|session/i.test(msg)) { toast('登入已逾時，請重新登入。', true); return; }
  toast('儲存失敗，請稍後再試一次。' + (msg ? `（${msg}）` : ''), true);
}
function guardWrite() { if (!canWrite) { toast('你目前只有檢視權限，資料無法修改。', true); return false; } return true; }
async function upsertDoc(col, id, data) {
  const { error } = await sb.from('docs').upsert({ col, id, data });
  if (error) throw error;
}
async function save(c, id, data) {
  id = id || uid(c[0]);
  if (!guardWrite()) return null;
  try { await upsertDoc(c, id, data); S[c].set(id, clone(data)); refresh(); return id; }
  catch (e) { writeErr(e); return null; }
}
async function patch(c, id, data) {
  if (!guardWrite()) return false;
  try {
    const merged = { ...clone(S[c].get(id) || {}), ...clone(data) };
    await upsertDoc(c, id, merged); S[c].set(id, merged); refresh(); return true;
  } catch (e) { writeErr(e); return false; }
}
async function remove(c, id) {
  if (!guardWrite()) return false;
  try {
    const { error } = await sb.from('docs').delete().match({ col: c, id });
    if (error) throw error;
    S[c].delete(id); refresh(); return true;
  } catch (e) { writeErr(e); return false; }
}
async function saveSettings(data) {
  if (!guardWrite()) return false;
  try { await upsertDoc('settings', 'clinic', data); S.settings = clone(data); refresh(); return true; }
  catch (e) { writeErr(e); return false; }
}
function applyRow(row) {
  if (!row || !row.col) return;
  if (row.col === 'settings') { if (row.id === 'clinic') S.settings = row.data || {}; return; }
  if (S[row.col] instanceof Map) S[row.col].set(row.id, row.data || {});
}
async function loadAll() {
  COLS.forEach(c => { S[c] = new Map(); }); S.settings = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('docs').select('col,id,data').order('col').order('id').range(from, from + 999);
    if (error) throw error;
    data.forEach(applyRow);
    if (data.length < 1000) break;
  }
  COLS.forEach(c => loaded.add(c));
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('docs-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      if (p.eventType === 'DELETE') { const o = p.old || {}; if (o.col === 'settings') S.settings = {}; else if (S[o.col] instanceof Map) S[o.col].delete(o.id); }
      else applyRow(p.new);
      refresh();
    })
    .subscribe();
}

/* ================= 介面狀態 ================= */
const NAV = [
  { id:'dash', label:'總覽', title:'今日總覽' },
  { id:'clients', label:'病患', title:'病患管理' },
  { id:'appts', label:'預約', title:'預約排程' },
  { id:'pos', label:'結帳', title:'櫃檯結帳' },
  { id:'stock', label:'庫存', title:'庫存管理' },
  { id:'report', label:'報表', title:'營運報表' },
  { id:'settings', label:'設定', title:'系統設定' }
];
const PER_PAGE = 12;
const ui = {
  view: 'dash', menu: false, menuTab: 'cat',
  cq: '', clv: '全部', csort: 'recent', ctag: '', cpage: 1, cmode: 'card',
  day: TODAY(), apMode: 'grid',
  posTab: 'service', posQ: '', cart: [], cartClient: '', cartDiscount: 0, cartPay: '現金', cartStaff: '', cartNote: '',
  sq: '', scat: '全部',
  rMonth: TODAY().slice(0, 7),
  setTab: 'clinic',
  drawer: null, drawerTab: 'info', dentition: 'adult', tooth: null, toothDraft: null
};
try { const v = localStorage.getItem('clinic.view'); if (v && NAV.some(n => n.id === v)) ui.view = v; const m = localStorage.getItem('clinic.cmode'); if (m === 'list' || m === 'card') ui.cmode = m; } catch (e) {}
if (location.hash && NAV.some(n => n.id === location.hash.slice(1))) ui.view = location.hash.slice(1);

/* ================= 牙科常數 ================= */
const LEVELS = ['一般', '銀卡', '金卡', 'VIP'];
const SOURCES = ['親友介紹', 'Google 搜尋', 'Google 地圖', 'Facebook', 'LINE 官方帳號', '路過', '其他'];
const ROLES = ['牙醫師', '衛教師', '牙助', '櫃檯'];
const CHAIR_ROLES = ['牙醫師', '衛教師'];
const PAYS = ['現金', '信用卡', 'LINE Pay', '轉帳', '儲值扣款'];
const AP_ST = ['已預約', '已報到', '完成', '未到', '取消'];
const TS = { ok: '健康', caries: '齲齒・待補', filled: '已補牙', rct: '根管治療', crown: '牙冠／牙橋', implant: '植牙', missing: '缺牙', extract: '建議拔除', watch: '觀察中' };
const TS_EN = { caries: 'Caries', filled: 'Filled', rct: 'Root Canal', crown: 'Crown', implant: 'Implant', missing: 'Missing', extract: 'Extract', watch: 'Watch' };
const SURF = [['M', '近心'], ['D', '遠心'], ['O', '咬合'], ['B', '頰側'], ['L', '舌側']];
const ARCH = {
  adult: { U: [[18,17,16,15,14,13,12,11], [21,22,23,24,25,26,27,28]], L: [[48,47,46,45,44,43,42,41], [31,32,33,34,35,36,37,38]] },
  child: { U: [[55,54,53,52,51], [61,62,63,64,65]], L: [[85,84,83,82,81], [71,72,73,74,75]] }
};
const validTooth = n => { const q = Math.floor(n / 10), d = n % 10; return (q >= 1 && q <= 4 && d >= 1 && d <= 8) || (q >= 5 && q <= 8 && d >= 1 && d <= 5); };
const parseTeeth = s => [...new Set((String(s || '').match(/\d{2}/g) || []).map(Number).filter(validTooth))].map(String);
function toothName(n) {
  n = +n; const q = Math.floor(n / 10), d = n % 10, kid = q >= 5;
  const pos = ['', '右上', '左上', '左下', '右下'][kid ? q - 4 : q];
  const nm = kid ? ['', '乳正中門牙', '乳側門牙', '乳犬齒', '第一乳臼齒', '第二乳臼齒'][d] : ['', '正中門牙', '側門牙', '犬齒', '第一小臼齒', '第二小臼齒', '第一大臼齒', '第二大臼齒', '智齒'][d];
  return pos + nm;
}

/* ================= 衍生資料 ================= */
const stChip = s => ({ '已預約':'info', '已報到':'warn', '完成':'ok', '未到':'danger', '取消':'' }[s] ?? '');
const staffColor = st => `var(--c${(st && st.color) || 0})`;
const staffSoft = st => `var(--c${(st && st.color) || 0}s)`;
const clinicName = () => S.settings.name || '牙醫診所管理系統';
const remindDays = () => +(S.settings.remindDays || 14);
const isChild = c => !!(c && c.birthday && age(c.birthday) < 7);

function clientStats(cid) {
  const orders = all('orders').filter(o => o.clientId === cid);
  const appts = all('appointments').filter(a => a.clientId === cid);
  const spent = orders.reduce((s, o) => s + (o.total || 0), 0);
  const visits = appts.filter(a => a.status === '完成').length;
  const last = appts.filter(a => a.status === '完成').map(a => a.date).sort().pop() || '';
  const next = appts.filter(a => a.date >= TODAY() && (a.status === '已預約' || a.status === '已報到')).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  return { orders, appts, spent, visits, last, next };
}
const pkgLeft = c => (c.packages || []).reduce((s, p) => s + Math.max(0, (p.total || 0) - (p.used || 0)), 0);
const clientAlert = c => [c.allergies && `過敏：${c.allergies}`, c.medical && `病史：${c.medical}`].filter(Boolean).join('；');
function nextChartNo() {
  const n = all('clients').map(c => parseInt(c.chartNo, 10)).filter(x => !isNaN(x));
  return String((n.length ? Math.max(...n) : 1000) + 1).padStart(7, '0');
}
function nextOrderNo(date) {
  const key = date.replace(/-/g, '');
  const n = all('orders').filter(o => (o.no || '').startsWith('S' + key)).length + 1;
  return `S${key}-${String(n).padStart(3, '0')}`;
}
function followUps() {
  const t = TODAY(), lim = addDays(t, remindDays());
  return all('clients').filter(c => c.nextFollowUp && c.nextFollowUp <= lim)
    .map(c => ({ ...c, overdue: c.nextFollowUp < t }))
    .filter(c => !all('appointments').some(a => a.clientId === c.id && a.date >= t && (a.status === '已預約' || a.status === '已報到')))
    .sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
}
const lowStock = () => all('products').filter(p => (p.stock || 0) <= (p.safety || 0));
const monthRevenue = ym => all('orders').filter(o => (o.date || '').startsWith(ym)).reduce((s, o) => s + (o.total || 0), 0);
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
const teethTxt = a => (a.teeth || []).length ? `牙位 ${a.teeth.join('、')}` : '';
const tagCounts = () => { const m = {}; all('clients').forEach(c => (c.tags || []).forEach(t => { m[t] = (m[t] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

/* ================= 外框渲染 ================= */
function renderNav() {
  const fu = followUps().length, ls = lowStock().length;
  $('#nav').innerHTML = NAV.map(n => {
    const b = n.id === 'dash' && fu ? fu : n.id === 'stock' && ls ? ls : 0;
    return `<li><button type="button" data-nav="${n.id}" ${ui.view === n.id ? 'aria-current="page"' : ''}>${n.label}${b ? `<sup>${b}</sup>` : ''}</button></li>`;
  }).join('');
  $('#brandName').textContent = clinicName();
  $('#copy').textContent = `Copyright © ${clinicName()} All Rights Reserved.`;
  const cur = NAV.find(n => n.id === ui.view);
  $('#crumb').innerHTML = `<li><button type="button" data-nav="dash">首頁</button></li>${ui.view === 'dash' ? '' : `<li>${cur.title}</li>`}${ui.view === 'clients' && ui.ctag ? `<li>#${esc(ui.ctag)}</li>` : ''}`;
  const btn = $('#menuBtn');
  btn.querySelector('.cnt')?.remove();
  if (fu) btn.insertAdjacentHTML('beforeend', `<span class="cnt">${fu}</span>`);
}
function renderBanners() {
  const out = [];
  if (mode === 'error') out.push(`<div class="banner"><b>OFFLINE</b><span>目前無法從資料庫讀取資料，請確認網路連線後重新整理頁面。</span><button class="btn sm" type="button" data-act="reload">重新整理</button></div>`);
  const samples = COLS.reduce((s, c) => s + all(c).filter(d => d.sample).length, 0);
  if (samples && ui.view !== 'settings') out.push(`<div class="banner"><b>SAMPLE DATA</b><span>目前顯示的是範例資料（共 ${samples} 筆），方便你試用各項功能。正式使用前可到「系統設定」一鍵清除。</span><button class="btn sm" type="button" data-go="settings">前往清除</button></div>`);
  $('#banners').innerHTML = out.join('');
  if (ui.menu) renderMenu();
}
function renderMenu() {
  const host = $('#menuHost');
  if (!ui.menu) { host.innerHTML = ''; $('#menuBtn').setAttribute('aria-expanded', 'false'); return; }
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  const counts = { dash: followUps().length, clients: S.clients.size, appts: all('appointments').filter(a => a.date === TODAY() && a.status !== '取消').length, pos: all('orders').filter(o => o.date === TODAY()).length, stock: S.products.size, report: all('orders').filter(o => (o.date || '').startsWith(TODAY().slice(0, 7))).length, settings: S.services.size };
  const unit = { dash: '待回診', clients: '位', appts: '今日', pos: '今日筆數', stock: '品項', report: '本月筆數', settings: '療程' };
  const tags = tagCounts();
  host.innerHTML = `<div class="smenu-scrim" data-closemenu></div>
  <nav class="smenu" aria-label="選單">
    <div class="smenu-t"><span>MENU</span><button type="button" data-closemenu aria-label="關閉選單">${ic('x', 20)}</button></div>
    <div class="smenu-sec"><h2>Quick Action</h2><div class="qa">
      <button type="button" data-act="new-appt">＋ 新增預約</button><button type="button" data-act="new-client">＋ 新增病患</button>
      <button type="button" data-nav="pos">櫃檯結帳</button><button type="button" data-act="export-clients">匯出病患 CSV</button></div></div>
    <div class="smenu-sec"><h2>Tooth Status</h2><div class="swatches">${Object.keys(TS_EN).map(k => `<span class="ts-${k}"><i></i>${TS_EN[k]}</span>`).join('')}</div></div>
    <div class="smenu-sec"><h2>Layout</h2><div class="qa">
      <button type="button" data-cmode="card">TYPE_A　卡片</button><button type="button" data-cmode="list">TYPE_B　列表</button></div></div>
    <div class="smenu-tabs" role="tablist"><button type="button" role="tab" data-mtab="cat" aria-selected="${ui.menuTab === 'cat'}">Category</button><button type="button" role="tab" data-mtab="tag" aria-selected="${ui.menuTab === 'tag'}">Tag</button></div>
    <ul class="smenu-list">${ui.menuTab === 'cat'
      ? NAV.map(n => `<li><button type="button" data-nav="${n.id}" ${ui.view === n.id ? 'aria-current="true"' : ''}>${n.title}（${unit[n.id]} ${counts[n.id]}）</button></li>`).join('')
      : (tags.length ? `<li><button type="button" data-ctag="">全部病患（${S.clients.size}）</button></li>` + tags.map(([t, n]) => `<li><button type="button" data-ctag="${esc(t)}" ${ui.ctag === t ? 'aria-current="true"' : ''}>${esc(t)}（${n}）</button></li>`).join('') : '<li><button type="button" disabled>尚無病患標籤</button></li>')}</ul>
    <div class="smenu-foot">${mode === 'live' ? '<span class="dot live"></span>已連線・資料即時同步' : mode === 'error' ? '<span class="dot local"></span>無法連線' : '<span class="dot"></span>連線中…'}<br>現在登錄 ${S.clients.size} 位病患<br>登入帳號：<span class="en">${esc(me ? me.email : '')}</span>${me && me.role === 'admin' ? '（管理員）' : ''}<br><button class="btn sm" type="button" data-act="logout">登出</button></div>
  </nav>`;
}

const VIEWS = {};
function setView(v) {
  ui.view = v; ui.menu = false; renderMenu();
  try { localStorage.setItem('clinic.view', v); } catch (e) {}
  renderShell();
  window.scrollTo(0, 0);
}
function renderShell() {
  renderNav(); renderBanners();
  const V = VIEWS[ui.view];
  $('#viewTitle').textContent = NAV.find(n => n.id === ui.view).title;
  $('#viewSub').textContent = V.sub ? V.sub() : '';
  $('#viewTools').innerHTML = V.tools ? V.tools() : '';
  $('#viewTools').hidden = !$('#viewTools').innerHTML.trim();
  renderBody();
}
function renderBody() {
  if (mode === 'connecting' && !loaded.size) { $('#viewBody').innerHTML = `<div class="panel"><div class="empty">正在讀取診所資料…</div></div>`; return; }
  $('#viewBody').innerHTML = VIEWS[ui.view].body();
}
let rq = 0;
function refresh() {
  if (rq) return;
  rq = requestAnimationFrame(() => {
    rq = 0;
    renderNav(); renderBanners();
    const V = VIEWS[ui.view];
    $('#viewSub').textContent = V.sub ? V.sub() : '';
    if (V.retools) { $('#viewTools').innerHTML = V.tools(); $('#viewTools').hidden = !$('#viewTools').innerHTML.trim(); }
    renderBody();
    if (ui.drawer) renderDrawer();
  });
}

/* ================= 共用片段 ================= */
const empty = (title, text, btn) => `<div class="empty"><b>${esc(title)}</b><span>${esc(text)}</span>${btn || ''}</div>`;
const sec = (t, en) => `<h2 class="sec">${t}${en ? `<small class="en">${en}</small>` : ''}</h2>`;
function barChart(data, opts = {}) {
  const W = 560, H = 220, L = 54, R = 10, T = 14, B = 28;
  const max = Math.max(1, ...data.map(d => d.value));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - L - R, ih = H - T - B, bw = Math.min(40, iw / data.length * 0.5);
  const y = v => T + ih - v / top * ih;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="grid-l" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${shortMoney(v)}</text>`;
  const cols = data.map((d, i) => {
    const cx = L + iw / data.length * (i + .5), x = cx - bw / 2, h = Math.max(0, ih - (y(d.value) - T)), yy = y(d.value);
    const tipW = 96, tx = Math.min(W - R - tipW, Math.max(L, cx - tipW / 2)), ty = Math.max(0, yy - 30);
    return `<g class="col"><rect x="${cx - iw/data.length/2}" y="${T}" width="${iw/data.length}" height="${ih}" fill="transparent"/>${h > 0 ? `<rect class="bar ${d.cur ? 'cur' : ''}" x="${x}" y="${yy}" width="${bw}" height="${h}"/>` : ''}
      <text x="${cx}" y="${H-8}" text-anchor="middle" ${d.cur ? 'style="fill:#333"' : ''}>${esc(d.label)}</text>
      <g class="tip"><rect x="${tx}" y="${ty}" width="${tipW}" height="22"/><text x="${tx + tipW/2}" y="${ty+15}" text-anchor="middle">${money(d.value)}</text></g></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '長條圖')}">${g}${cols}</svg>`;
}
function niceStep(x) { if (x <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function shortMoney(v) { return v >= 10000 ? (v / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 }) + '萬' : Math.round(v).toLocaleString('zh-TW'); }
function hbars(rows, fmt = money) {
  if (!rows.length) return `<div class="empty"><span>這段期間還沒有資料。</span></div>`;
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="hbar">${rows.map(r => `<span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span><span class="track"><span class="fill" style="width:${(r.value / max * 100).toFixed(1)}%"></span></span><span class="v">${fmt(r.value)}</span>`).join('')}</div>`;
}
const clientOpts = sel => `<option value="">— 選擇病患 —</option>` + all('clients').sort((a, b) => (a.chartNo || '').localeCompare(b.chartNo || '')).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}（${esc(c.chartNo)}・${esc((c.phone || '').slice(-3))}）</option>`).join('');
const staffOpts = (sel, roleFilter) => `<option value="">— 未指定 —</option>` + all('staff').filter(s => s.active !== false && (!roleFilter || roleFilter.includes(s.role))).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}・${esc(s.role)}</option>`).join('');
const serviceOpts = sel => `<option value="">— 選擇療程 —</option>` + all('services').filter(s => s.active !== false).sort((a, b) => (a.code || '').localeCompare(b.code || '')).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.nhi ? '［健保］' : '［自費］'}${esc(s.name)}（${s.duration || 30} 分）</option>`).join('');
const opts = (arr, sel) => arr.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
function pager(total, cur, attr) {
  const pages = Math.ceil(total / PER_PAGE); if (pages <= 1) return '';
  let h = ''; for (let i = 1; i <= pages; i++) h += `<button type="button" ${attr}="${i}" ${i === cur ? 'aria-current="page"' : ''}>${i}</button>`;
  if (cur < pages) h += `<button type="button" ${attr}="${cur + 1}" aria-label="下一頁">&gt;</button>`;
  return `<nav class="pager" aria-label="分頁">${h}</nav>`;
}

/* ---------- 卡片視覺 ---------- */
function miniChart(c) {
  const teeth = c.teeth || {}, a = ARCH[isChild(c) ? 'child' : 'adult'];
  const up = [...a.U[0], ...a.U[1]], lo = [...a.L[0], ...a.L[1]], n = up.length;
  const cw = n === 16 ? 11 : 17, gap = 2, mid = 8, tw = n * (cw + gap) - gap + mid, x0 = (220 - tw) / 2;
  const x = i => x0 + i * (cw + gap) + (i >= n / 2 ? mid : 0);
  const r = (list, y, lower) => list.map((t, i) => { const s = (teeth[t] || {}).s || 'ok'; return `<rect class="mt ts-${s}" x="${x(i)}" y="${y}" width="${cw}" height="24" rx="${lower ? 5 : 3}"><title>${t} ${TS[s]}</title></rect>`; }).join('');
  return `<svg class="vis-chart" viewBox="0 0 220 120" aria-hidden="true">
    <line x1="110" y1="26" x2="110" y2="96" stroke="#CFC7B8"/><line x1="${x0 - 4}" y1="61" x2="${x0 + tw + 4}" y2="61" stroke="#CFC7B8"/>
    ${r(up, 32, false)}${r(lo, 66, true)}
    <text x="${x0}" y="20" font-size="9" fill="#999" font-family="Roboto Condensed,sans-serif" letter-spacing="1">R</text><text x="${x0 + tw}" y="20" font-size="9" fill="#999" text-anchor="end" font-family="Roboto Condensed,sans-serif" letter-spacing="1">L</text>
  </svg>`;
}
function clientCard(c, st) {
  const al = clientAlert(c), od = c.nextFollowUp && c.nextFollowUp < TODAY();
  const tag = (c.tags || [])[0];
  return `<li class="card" data-open-client="${c.id}" tabindex="0">
    <div class="card-img">${miniChart(c)}${c.level && c.level !== '一般' ? `<span class="vis-corner">${esc(c.level)}</span>` : ''}${al ? `<span class="vis-alert" title="${esc(al)}">警示</span>` : ''}
      <div class="card-over"><time>${st.last ? fmtEN(st.last) : 'New Patient'}</time>
        <p class="over-cat">${c.nextFollowUp ? `${od ? '已逾期・' : ''}建議回診 ${fmtDY(c.nextFollowUp)}　${esc(c.followUpReason || '')}` : '目前沒有回診提醒'}</p>
        ${tag ? `<p class="over-tec">${esc(tag)}</p>` : ''}
        <div class="over-acts"><button class="obtn" type="button" data-act="new-appt" data-client="${c.id}" data-svc="${esc(c.followUpServiceId || '')}">排預約</button><button class="obtn" type="button" data-open-client="${c.id}" data-tab="teeth">牙位圖</button></div></div></div>
    <p class="card-ttl"><b>${esc(c.name)}</b>　${esc(c.gender || '')}${c.birthday ? `・${age(c.birthday)} 歲` : ''}</p>
    <p class="card-url en">${esc(c.chartNo)}　${esc(c.phone || '')}</p></li>`;
}
function apptCard(a) {
  const st = get('staff', a.staffId), c = get('clients', a.clientId), al = c && clientAlert(c);
  return `<li class="card" data-act="edit-appt" data-id="${a.id}" tabindex="0">
    <div class="card-img appt-vis st-${esc(a.status)}" style="--sc:${staffColor(st)};--ss:${staffSoft(st)}">
      <span class="chip ${stChip(a.status)}">${esc(a.status)}</span>${al ? `<span class="vis-alert" title="${esc(al)}">警示</span>` : ''}
      <span class="vis-time">${esc(a.time)}</span><span class="vis-svc">${esc(a.serviceName)}</span>
      <div class="card-over"><time>${fmtEN(a.date)}　${esc(a.time)}–${fromMin(toMin(a.time) + (a.duration || 30))}</time>
        <p class="over-cat">${st ? esc(st.name) + '・' + esc(st.role) : '未指定人員'}${a.note ? '　' + esc(a.note) : ''}</p>
        ${(a.teeth || []).length ? `<p class="over-tec">#${a.teeth.join(' #')}</p>` : ''}
        <div class="over-acts">${a.status === '已預約' ? `<button class="obtn" type="button" data-act="ap-status" data-id="${a.id}" data-st="已報到">報到</button>` : ''}${a.status === '已報到' ? `<button class="obtn" type="button" data-act="ap-done" data-id="${a.id}">完成</button>` : ''}<button class="obtn" type="button" data-open-client="${a.clientId}">病歷</button></div></div></div>
    <p class="card-ttl"><b>${esc(a.clientName)}</b></p>
    <p class="card-url">${st ? esc(st.name) : '未指定'}・${a.duration || 30} 分${teethTxt(a) ? '・' + teethTxt(a) : ''}</p></li>`;
}

/* ================= 總覽 ================= */
VIEWS.dash = {
  sub: () => `${clinicName()}　${fmtEN(TODAY())}`,
  tools: () => `<button class="btn" type="button" data-act="new-client">${ic('plus')}新增病患</button><button class="btn primary" type="button" data-act="new-appt">${ic('plus')}新增預約</button>`,
  body() {
    const t = TODAY(), ym = t.slice(0, 7);
    const todays = all('appointments').filter(a => a.date === t).sort((a, b) => a.time.localeCompare(b.time));
    const active = todays.filter(a => a.status !== '取消');
    const arrived = todays.filter(a => a.status === '已報到' || a.status === '完成').length;
    const rev = monthRevenue(ym), prev = monthRevenue(shiftMonth(ym, -1));
    const diff = prev ? Math.round((rev - prev) / prev * 100) : null;
    const todayRev = all('orders').filter(o => o.date === t).reduce((s, o) => s + (o.total || 0), 0);
    const fu = followUps(), ls = lowStock();
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(ym, i - 5));
    return `
    <div class="grid g-kpi">
      <div class="panel kpi"><span class="eyebrow">TODAY</span><span class="label">今日預約</span><span class="val">${active.length}</span><span class="foot">已報到 / 完成 ${arrived} 位</span></div>
      <div class="panel kpi"><span class="eyebrow">SALES</span><span class="label">今日營收</span><span class="val">${money(todayRev)}</span><span class="foot">${all('orders').filter(o => o.date === t).length} 筆結帳</span></div>
      <div class="panel kpi"><span class="eyebrow">MONTHLY</span><span class="label">本月營收</span><span class="val">${money(rev)}</span><span class="foot">${diff === null ? '上月無資料' : `較上月 <span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}%</span>`}</span></div>
      <div class="panel kpi"><span class="eyebrow">RECALL</span><span class="label">待聯絡回診</span><span class="val" ${fu.some(c => c.overdue) ? 'style="color:var(--warn)"' : ''}>${fu.length}</span><span class="foot">其中已逾期 ${fu.filter(c => c.overdue).length} 位</span></div>
    </div>
    ${sec('今日預約', 'Today\'s Appointments')}
    <ul class="cards">${todays.length ? todays.map(apptCard).join('') : `<li class="empty-card">${empty('今天還沒有預約', '點上方「新增預約」幫病患排時段。')}</li>`}</ul>
    ${sec('洗牙・回診提醒', `Recall within ${remindDays()} days`)}
    <div class="grid g-2e">
      <section class="panel"><div class="panel-h"><h2>待聯絡病患</h2><span class="meta">建議回診日在 ${remindDays()} 天內、尚未預約</span></div>
        <div class="panel-b">${fu.length ? `<div class="list">${fu.slice(0, 10).map(c => `
          <div class="li"><div class="body"><div class="ttl2"><a href="#" data-open-client="${c.id}">${esc(c.name)}</a>　${esc(c.followUpReason || '回診')}</div><div class="sub">建議 ${fmtD(c.nextFollowUp)}・<span class="en">${esc(c.phone)}</span></div></div>
          <div class="act">${c.overdue ? `<span class="chip danger">逾期 ${daysBetween(c.nextFollowUp, TODAY())} 天</span>` : '<span class="chip warn">即將到期</span>'}<button class="btn sm" type="button" data-act="new-appt" data-client="${c.id}" data-svc="${esc(c.followUpServiceId || '')}">排預約</button></div></div>`).join('')}</div>`
          : `<div class="empty"><span>沒有待聯絡的回診提醒。</span></div>`}</div></section>
      <section class="panel"><div class="panel-h"><h2>庫存不足</h2><span class="meta">低於安全庫存</span></div>
        <div class="panel-b">${ls.length ? `<div class="list">${ls.map(p => `<div class="li"><div class="body"><div class="ttl2">${esc(p.name)}</div><div class="sub">安全庫存 ${p.safety} ${esc(p.unit || '')}</div></div><div class="act"><span class="chip ${p.stock <= 0 ? 'danger' : 'warn'}">剩 ${p.stock}</span><button class="btn sm" type="button" data-act="restock" data-id="${p.id}">進貨</button></div></div>`).join('')}</div>`
          : `<div class="empty"><span>所有品項庫存充足。</span></div>`}</div></section>
    </div>
    ${sec('近六個月營收', 'Monthly Sales')}
    <section class="panel"><div class="panel-b">${barChart(months.map(m => ({ label: +m.slice(5) + '月', value: monthRevenue(m), cur: m === ym })), { label: '近六個月營收' })}</div></section>`;
  }
};
function apptRow(a) {
  const st = get('staff', a.staffId), c = get('clients', a.clientId), warn = c && clientAlert(c);
  return `<div class="li"><span style="width:3px;align-self:stretch;background:${staffColor(st)}"></span><span class="en" style="width:44px;color:var(--faint)">${esc(a.time)}</span>
    <div class="body"><div class="ttl2"><a href="#" data-open-client="${a.clientId}">${esc(a.clientName)}</a>　${esc(a.serviceName)} ${warn ? `<span class="chip danger" title="${esc(warn)}">警示</span>` : ''}</div><div class="sub">${st ? esc(st.name) : '未指定人員'}・${a.duration || 30} 分鐘${teethTxt(a) ? '・' + teethTxt(a) : ''}${a.note ? '・' + esc(a.note) : ''}</div></div>
    <div class="act"><span class="chip ${stChip(a.status)}">${esc(a.status)}</span>
    ${a.status === '已預約' ? `<button class="btn sm" type="button" data-act="ap-status" data-id="${a.id}" data-st="已報到">報到</button>` : ''}
    ${a.status === '已報到' ? `<button class="btn sm" type="button" data-act="ap-done" data-id="${a.id}">完成</button>` : ''}
    <button class="btn sm ghost" type="button" data-act="edit-appt" data-id="${a.id}" aria-label="編輯預約">${ic('edit')}</button></div></div>`;
}

/* ================= 病患 ================= */
VIEWS.clients = {
  retools: true,
  sub: () => `現在 ${S.clients.size} 位病患${ui.ctag ? `・標籤「${ui.ctag}」` : ''}`,
  tools: () => `<div class="search">${ic('search')}<input class="input" id="cq" type="search" placeholder="搜尋姓名、電話、病歷號" value="${esc(ui.cq)}"></div>
    <select class="input" id="clv" style="width:auto" aria-label="篩選">${opts(['全部', '待回診', '有警示', ...LEVELS], ui.clv)}</select>
    <select class="input" id="csort" style="width:auto" aria-label="排序"><option value="recent" ${ui.csort === 'recent' ? 'selected' : ''}>最近就診</option><option value="recall" ${ui.csort === 'recall' ? 'selected' : ''}>建議回診日</option><option value="chart" ${ui.csort === 'chart' ? 'selected' : ''}>病歷號</option><option value="spent" ${ui.csort === 'spent' ? 'selected' : ''}>累積消費</option></select>
    <div class="seg"><button type="button" data-cmode="card" aria-pressed="${ui.cmode === 'card'}">TYPE_A</button><button type="button" data-cmode="list" aria-pressed="${ui.cmode === 'list'}">TYPE_B</button></div>
    <button class="btn" type="button" data-act="export-clients">${ic('dl')}匯出</button>
    <button class="btn primary" type="button" data-act="new-client">${ic('plus')}新增病患</button>`,
  body() {
    if (!S.clients.size) return `<div class="panel">${empty('還沒有任何病患資料', '新增第一位病患後，就能排預約、記錄牙位與療程。', `<button class="btn primary" type="button" data-act="new-client">${ic('plus')}新增病患</button>`)}</div>`;
    const q = ui.cq.trim().toLowerCase(), lim = addDays(TODAY(), remindDays());
    let rows = all('clients').map(c => ({ c, st: clientStats(c.id) }))
      .filter(({ c }) => ui.clv === '全部' || (ui.clv === '待回診' ? (c.nextFollowUp && c.nextFollowUp <= lim) : ui.clv === '有警示' ? !!clientAlert(c) : c.level === ui.clv))
      .filter(({ c }) => !ui.ctag || (c.tags || []).includes(ui.ctag))
      .filter(({ c }) => !q || [c.name, c.phone, c.chartNo, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => ui.csort === 'chart' ? (a.c.chartNo || '').localeCompare(b.c.chartNo || '') : ui.csort === 'spent' ? b.st.spent - a.st.spent : ui.csort === 'recall' ? (a.c.nextFollowUp || '9').localeCompare(b.c.nextFollowUp || '9') : (b.st.last || '').localeCompare(a.st.last || ''));
    if (!rows.length) return `<div class="panel"><div class="empty"><span>找不到符合條件的病患，試試其他關鍵字或清除篩選。</span>${ui.ctag ? '<button class="btn sm" type="button" data-ctag="">清除標籤篩選</button>' : ''}</div></div>`;
    const pages = Math.ceil(rows.length / PER_PAGE); if (ui.cpage > pages) ui.cpage = 1;
    const page = rows.slice((ui.cpage - 1) * PER_PAGE, ui.cpage * PER_PAGE);
    if (ui.cmode === 'card') return `<ul class="cards">${page.map(({ c, st }) => clientCard(c, st)).join('')}</ul>${pager(rows.length, ui.cpage, 'data-cpage')}`;
    return `<div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>病歷號</th><th>姓名</th><th class="hide-sm">電話</th><th class="hide-sm">最近就診</th><th>建議回診</th><th class="hide-sm">下次預約</th><th class="r hide-sm">剩餘療程</th><th class="r hide-sm">累積消費</th></tr></thead><tbody>
      ${page.map(({ c, st }) => { const due = c.nextFollowUp && c.nextFollowUp <= lim, od = c.nextFollowUp && c.nextFollowUp < TODAY(); return `<tr class="click" data-open-client="${c.id}" tabindex="0">
        <td class="en">${esc(c.chartNo)}</td>
        <td><div class="cell-name">${esc(c.name)} ${clientAlert(c) ? `<span class="chip danger" title="${esc(clientAlert(c))}">警示</span>` : ''}</div><div class="cell-sub">${esc(c.gender || '')}${c.birthday ? '・' + age(c.birthday) + ' 歲' : ''}${(c.tags || []).length ? '・' + c.tags.map(esc).join('、') : ''}</div></td>
        <td class="en hide-sm">${esc(c.phone)}</td>
        <td class="hide-sm">${st.last ? fmtDY(st.last) : '<span class="muted">尚未就診</span>'}</td>
        <td>${c.nextFollowUp ? `<span class="${od ? 'down' : due ? '' : 'muted'}">${fmtD(c.nextFollowUp)}</span><div class="cell-sub">${esc(c.followUpReason || '')}</div>` : '<span class="muted">—</span>'}</td>
        <td class="hide-sm">${st.next ? `${fmtD(st.next.date)} ${esc(st.next.time)}` : '<span class="muted">—</span>'}</td>
        <td class="r num hide-sm">${pkgLeft(c) || '—'}</td>
        <td class="r num hide-sm">${money(st.spent)}</td></tr>`; }).join('')}
      </tbody></table></div>${pager(rows.length, ui.cpage, 'data-cpage')}`;
  }
};

/* ---------- 牙位圖 ---------- */
function odontogram(c) {
  const teeth = c.teeth || {}, arch = ARCH[ui.dentition];
  const tooth = (n, lower) => {
    const t = teeth[n] || {}, s = t.s || 'ok', d = n % 10;
    const w = d <= 2 ? 56 : d === 3 ? 66 : (ui.dentition === 'child' || d >= 6) ? 92 : 76;
    const no = `<span class="no">${n}</span>`;
    return `<button type="button" class="tooth ts-${s} ${lower ? 'lo' : ''} ${String(ui.tooth) === String(n) ? 'sel' : ''}" data-tooth="${n}" title="${n} ${toothName(n)}・${TS[s]}${t.note ? '・' + esc(t.note) : ''}" aria-label="牙位 ${n} ${toothName(n)}，${TS[s]}">${lower ? '' : no}<span class="shape" style="--w:${w}%">${(t.surf || []).join('')}</span>${lower ? no : ''}</button>`;
  };
  const row = (halves, lower) => `<div class="odo-row">${halves.map(h => `<div class="odo-half" style="--n:${h.length}">${h.map(n => tooth(n, lower)).join('')}</div>`).join('<span class="odo-mid" aria-hidden="true"></span>')}</div>`;
  const counts = {}; Object.entries(teeth).forEach(([n, t]) => { if (t.s && t.s !== 'ok' && validTooth(+n)) counts[t.s] = (counts[t.s] || 0) + 1; });
  let editor = '';
  if (ui.tooth) {
    const n = ui.tooth, dr = ui.toothDraft;
    const hist = all('appointments').filter(a => a.clientId === c.id && a.status === '完成' && (a.teeth || []).includes(String(n))).sort((a, b) => b.date.localeCompare(a.date));
    editor = `<div class="tooth-edit">
      <div class="row"><b class="en" style="font-size:18px;font-weight:400">${n}</b><span>${toothName(n)}</span>${teeth[n] && teeth[n].at ? `<span class="muted small">最後更新 ${fmtDY(teeth[n].at)}</span>` : ''}<span class="spacer"></span><button class="btn sm ghost" type="button" data-act="tooth-close" aria-label="關閉牙位編輯">${ic('x')}</button></div>
      <div class="pick" role="group" aria-label="牙齒狀態">${Object.entries(TS).map(([k, v]) => `<button type="button" data-tst="${k}" aria-pressed="${dr.s === k}"><i class="sw ts-${k}"></i>${v}</button>`).join('')}</div>
      <div class="row"><span class="section-t">牙面</span><div class="pick surf" role="group" aria-label="牙面">${SURF.map(([k, v]) => `<button type="button" data-surf="${k}" aria-pressed="${(dr.surf || []).includes(k)}" title="${v}">${k} ${v}</button>`).join('')}</div></div>
      <input class="input" id="tooth_note" value="${esc(dr.note || '')}" placeholder="備註，例如：咬合面淺層齲齒，下次補">
      <div class="row"><span class="small muted">${hist.length ? '治療紀錄：' + hist.map(a => `${fmtDY(a.date)} ${esc(a.serviceName)}`).join('；') : '這顆牙還沒有完成的治療紀錄。'}</span><span class="spacer"></span><button class="btn primary sm" type="button" data-act="tooth-save" data-id="${c.id}">${ic('check')}儲存牙位 ${n}</button></div>
    </div>`;
  }
  return `<div class="row"><span class="section-t">DENTAL CHART（FDI）</span><span class="spacer"></span><div class="seg"><button type="button" data-dent="adult" aria-pressed="${ui.dentition === 'adult'}">恆牙</button><button type="button" data-dent="child" aria-pressed="${ui.dentition === 'child'}">乳牙</button></div></div>
    <div class="odo-wrap"><div class="odo">
      <div class="odo-side"><span>病患右側</span><span>上顎</span><span>病患左側</span></div>
      ${row(arch.U, false)}<div class="odo-jaw"></div>${row(arch.L, true)}
      <div class="odo-side"><span></span><span>下顎</span><span></span></div>
    </div>
    <div class="odo-legend">${Object.entries(TS).map(([k, v]) => `<span><i class="sw ts-${k}"></i>${v}${counts[k] ? ` <b class="en">${counts[k]}</b>` : ''}</span>`).join('')}</div></div>
    ${editor || '<div class="small muted">點選任一顆牙可記錄狀態、牙面與備註。完成帶有牙位的療程時，系統也會自動更新牙位圖。</div>'}`;
}

function renderDrawer() {
  const c = get('clients', ui.drawer);
  if (!c) { closeOverlay(); return; }
  const st = clientStats(c.id), tab = ui.drawerTab;
  let content = '';
  if (tab === 'info') {
    content = `<dl class="kv">
      <dt>病歷號</dt><dd class="en">${esc(c.chartNo)}</dd>
      <dt>性別 / 年齡</dt><dd>${esc(c.gender || '—')}${c.birthday ? `・${age(c.birthday)} 歲（${fmtDY(c.birthday)}）` : ''}</dd>
      <dt>電話</dt><dd class="en">${esc(c.phone || '—')}</dd>
      <dt>LINE ID</dt><dd>${esc(c.line || '—')}</dd>
      <dt>Email</dt><dd>${esc(c.email || '—')}</dd>
      <dt>來源</dt><dd>${esc(c.source || '—')}</dd>
      <dt>會員等級</dt><dd>${esc(c.level || '一般')}</dd>
      <dt>標籤</dt><dd>${(c.tags || []).length ? `<span class="chips">${c.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</span>` : '—'}</dd>
      <dt>過敏</dt><dd>${esc(c.allergies || '無')}</dd>
      <dt>全身病史</dt><dd>${esc(c.medical || '無')}</dd>
      <dt>建議回診</dt><dd>${c.nextFollowUp ? `${fmtD(c.nextFollowUp)}・${esc(c.followUpReason || '回診')}` : '—'}</dd>
      <dt>建檔日期</dt><dd>${fmtDY(c.createdAt)}</dd>
      <dt>備註</dt><dd style="white-space:pre-wrap">${esc(c.notes || '—')}</dd></dl>`;
  } else if (tab === 'teeth') {
    content = odontogram(c);
  } else if (tab === 'pkg') {
    const pk = c.packages || [];
    content = `<div class="row"><span class="section-t">療程計畫</span><span class="spacer"></span><button class="btn sm" type="button" data-act="add-pkg" data-id="${c.id}">${ic('plus')}手動新增</button></div>
      ${pk.length ? pk.map((p, i) => { const left = (p.total || 0) - (p.used || 0); return `<div class="pkg"><div class="pkg-top"><span style="color:var(--ink-2)">${esc(p.name)}</span><span class="chip ${left > 0 ? 'dark' : ''}">剩 ${left} / ${p.total} 次</span></div>
        <div class="pips">${Array.from({ length: p.total || 0 }, (_, k) => `<i class="${k < (p.used || 0) ? 'used' : ''}"></i>`).join('')}</div>
        <div class="row small muted"><span>開始 ${fmtDY(p.boughtAt)}</span>${p.expires ? `<span>・到期 ${fmtDY(p.expires)}</span>` : ''}<span class="spacer"></span>
        <button class="btn sm" type="button" data-act="use-pkg" data-id="${c.id}" data-i="${i}" ${left <= 0 ? 'disabled' : ''}>扣 1 次</button>
        <button class="btn sm ghost" type="button" data-act="undo-pkg" data-id="${c.id}" data-i="${i}" ${(p.used || 0) <= 0 ? 'disabled' : ''}>補回</button></div></div>`; }).join('')
      : `<div class="panel"><div class="empty"><span>沒有進行中的療程計畫。矯正、美白等分次療程可在「櫃檯結帳」選擇療程計畫，結帳後會自動加到這裡。</span></div></div>`}`;
  } else if (tab === 'appts') {
    const ap = st.appts.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    content = `<div class="row"><span class="section-t">預約與就診紀錄</span><span class="spacer"></span><button class="btn sm" type="button" data-act="new-appt" data-client="${c.id}">${ic('plus')}新增預約</button></div>
      ${ap.length ? `<div class="panel"><div class="panel-b"><div class="list">${ap.map(a => { const s = get('staff', a.staffId); return `<div class="li"><div class="body"><div class="ttl2">${fmtDY(a.date)} <span class="en">${esc(a.time)}</span>　${esc(a.serviceName)}</div><div class="sub">${s ? esc(s.name) : '未指定'}${teethTxt(a) ? '・' + teethTxt(a) : ''}${a.note ? '・' + esc(a.note) : ''}</div></div><div class="act"><span class="chip ${stChip(a.status)}">${esc(a.status)}</span><button class="btn sm ghost" type="button" data-act="edit-appt" data-id="${a.id}" aria-label="編輯">${ic('edit')}</button></div></div>`; }).join('')}</div></div></div>`
      : `<div class="panel"><div class="empty"><span>還沒有預約紀錄。</span></div></div>`}`;
  } else {
    const os = st.orders.sort((a, b) => (b.no || '').localeCompare(a.no || ''));
    content = `<div class="row"><span class="section-t">消費紀錄</span><span class="spacer"></span><button class="btn sm" type="button" data-act="pos-client" data-id="${c.id}">幫他結帳</button></div>
      ${os.length ? `<div class="panel"><div class="panel-b"><div class="list">${os.map(o => `<div class="li"><div class="body"><div class="ttl2">${(o.items || []).map(i => esc(i.name) + (i.qty > 1 ? ` ×${i.qty}` : '')).join('、')}</div><div class="sub"><span class="en">${esc(o.no)}</span>・${fmtDY(o.date)}・${esc(o.payMethod)}</div></div><div class="act"><span class="num">${money(o.total)}</span></div></div>`).join('')}</div></div></div>`
      : `<div class="panel"><div class="empty"><span>還沒有消費紀錄。</span></div></div>`}`;
  }
  const warn = clientAlert(c);
  const keepScroll = $('#overlay .drawer-b') ? $('#overlay .drawer-b').scrollTop : 0;
  $('#overlay').innerHTML = `<div class="scrim" data-scrim>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="病患資料：${esc(c.name)}">
      <div class="drawer-h"><div style="flex:1;min-width:0"><div class="nm">${esc(c.name)}</div>
        <div class="sub">${esc(c.chartNo)}　${esc(c.phone || '')}${c.birthday ? `　${age(c.birthday)} 歲` : ''}${c.level && c.level !== '一般' ? `　${esc(c.level)}` : ''}</div></div>
        <button class="btn sm" type="button" data-act="edit-client" data-id="${c.id}">${ic('edit')}編輯</button>
        <button class="btn sm ghost" type="button" data-close aria-label="關閉" style="color:#fff">${ic('x', 18)}</button></div>
      <div class="drawer-b">
        <div class="dtabs" role="tablist">${[['info', '基本資料'], ['teeth', '牙位圖'], ['pkg', `療程計畫（${pkgLeft(c)}）`], ['appts', `就診紀錄（${st.appts.length}）`], ['orders', `消費（${st.orders.length}）`]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-dtab="${k}">${l}</button>`).join('')}</div>
        ${warn ? `<div class="alert-box">治療前注意：${esc(warn)}</div>` : ''}
        <div class="mini-stats"><div><span>建議回診</span><b>${c.nextFollowUp ? fmtDY(c.nextFollowUp) : '—'}</b></div><div><span>累積消費</span><b>${money(st.spent)}</b></div><div><span>就診次數</span><b>${st.visits}</b></div></div>
        ${content}
      </div></aside></div>`;
  if (keepScroll) $('#overlay .drawer-b').scrollTop = keepScroll;
}
function openClient(id, tab) {
  const c = get('clients', id);
  ui.menu = false; renderMenu();
  ui.drawer = id; ui.drawerTab = tab || 'info'; ui.tooth = null; ui.toothDraft = null;
  ui.dentition = isChild(c) ? 'child' : 'adult';
  renderDrawer();
}
function closeOverlay() { ui.drawer = null; ui.tooth = null; $('#overlay').innerHTML = ''; }

/* ================= 預約 ================= */
const OPEN = 9 * 60, CLOSE = 21 * 60, SLOT = 30, SLOT_PX = 40;
VIEWS.appts = {
  retools: true,
  sub: () => { const n = all('appointments').filter(a => a.date === ui.day && a.status !== '取消').length; return `${fmtEN(ui.day)}・${n} 筆預約`; },
  tools: () => `<button class="btn" type="button" data-act="day" data-n="-1" aria-label="前一天">${ic('left')}</button>
    <input class="input" id="dayPick" type="date" value="${ui.day}" style="width:auto" aria-label="選擇日期">
    <button class="btn" type="button" data-act="day" data-n="1" aria-label="後一天">${ic('right')}</button>
    <button class="btn" type="button" data-act="today">今天</button>
    <div class="seg"><button type="button" data-apmode="grid" aria-pressed="${ui.apMode === 'grid'}">TIME TABLE</button><button type="button" data-apmode="card" aria-pressed="${ui.apMode === 'card'}">CARD</button></div>
    <button class="btn primary" type="button" data-act="new-appt">${ic('plus')}新增預約</button>`,
  body() {
    const start = addDays(ui.day, -3);
    const strip = Array.from({ length: 10 }, (_, i) => addDays(start, i)).map(d => {
      const n = all('appointments').filter(a => a.date === d && a.status !== '取消').length, dd = parseD(d);
      return `<button type="button" data-setday="${d}" aria-pressed="${d === ui.day}" class="${d === TODAY() ? 'today' : ''}"><span class="w">週${WD[dd.getDay()]}</span><span class="d">${dd.getMonth()+1}/${dd.getDate()}</span><span class="c">${n ? n : '　'}</span></button>`;
    }).join('');
    const staff = all('staff').filter(s => s.active !== false && CHAIR_ROLES.includes(s.role)).sort((a, b) => CHAIR_ROLES.indexOf(a.role) - CHAIR_ROLES.indexOf(b.role));
    const day = all('appointments').filter(a => a.date === ui.day).sort((a, b) => a.time.localeCompare(b.time));
    let main;
    if (ui.apMode === 'card' || !staff.length) {
      main = `<ul class="cards">${day.length ? day.map(apptCard).join('') : `<li class="empty-card">${empty('這天沒有預約', '點上方「新增預約」安排時段。')}</li>`}</ul>`;
    } else {
      const slots = []; for (let m = OPEN; m < CLOSE; m += SLOT) slots.push(m);
      const colW = 170;
      const unassigned = day.filter(a => !staff.some(s => s.id === a.staffId));
      const cols = [...staff, ...(unassigned.length ? [{ id: '', name: '未指定', role: '', color: 0 }] : [])];
      const nowM = new Date().getHours() * 60 + new Date().getMinutes();
      main = `<section class="panel"><div class="panel-h"><h2>${fmtD(ui.day)}</h2><div class="legend">${staff.map(s => `<span><i style="background:${staffColor(s)}"></i>${esc(s.name)}</span>`).join('')}</div></div>
        <div class="sched-wrap"><div class="sched" style="--slot:${SLOT_PX}px;grid-template-columns:58px repeat(${cols.length}, minmax(${colW}px,1fr));min-width:${58 + cols.length * colW}px">
        <div class="th tcol"></div>${cols.map(s => `<div class="th"><i style="background:${staffColor(s)}"></i>${esc(s.name)}<span class="muted small">${esc(s.role)}</span></div>`).join('')}
        <div class="tcol">${slots.map(m => `<div class="slot ${m % 60 === 30 ? 'hr' : ''}">${m % 60 === 0 ? fromMin(m) : ''}</div>`).join('')}</div>
        ${cols.map(s => {
          const items = day.filter(a => s.id ? a.staffId === s.id : !staff.some(x => x.id === a.staffId));
          return `<div class="scol">${slots.map(m => `<div class="cell ${m % 60 === 30 ? 'hr' : ''}" data-act="new-appt" data-staff="${s.id}" data-time="${fromMin(m)}" title="${fromMin(m)} 新增預約"></div>`).join('')}
            ${items.map(a => { const top = (toMin(a.time) - OPEN) / SLOT * SLOT_PX, h = Math.max(SLOT_PX - 4, (a.duration || 30) / SLOT * SLOT_PX - 4); const who = get('staff', a.staffId) || s;
              return `<div class="appt st-${esc(a.status)}" data-act="edit-appt" data-id="${a.id}" style="top:${top + 2}px;height:${h}px;background:${staffSoft(who)};color:${staffColor(who)}">
                <div class="t">${esc(a.time)}–${fromMin(toMin(a.time) + (a.duration || 30))}・${esc(a.status)}</div><div class="n">${esc(a.clientName)}</div><div>${esc(a.serviceName)}${(a.teeth || []).length ? ` <span class="en">#${a.teeth.join(',')}</span>` : ''}</div></div>`; }).join('')}
          </div>`;
        }).join('')}
        ${ui.day === TODAY() && nowM >= OPEN && nowM <= CLOSE ? `<div class="nowline" style="top:${40 + (nowM - OPEN) / SLOT * SLOT_PX}px"></div>` : ''}
      </div></div></section>`;
    }
    return `<div class="daystrip">${strip}</div>${main}`;
  }
};

function apptForm(a = {}, preset = {}) {
  const isNew = !a.id;
  const v = { date: ui.day, time: '10:00', duration: 30, status: '已預約', ...preset, ...a };
  openDialog(isNew ? '新增預約' : '編輯預約', `
    <div class="field full"><label class="req" for="f_client">病患</label><select class="input" id="f_client">${clientOpts(v.clientId)}</select><span class="hint">新病患請先到「病患管理」建檔。</span></div>
    <div class="field full"><label class="req" for="f_service">療程項目</label><select class="input" id="f_service">${serviceOpts(v.serviceId)}</select></div>
    <div class="field"><label class="req" for="f_date">日期</label><input class="input" id="f_date" type="date" value="${esc(v.date)}"></div>
    <div class="field"><label class="req" for="f_time">時間</label><input class="input" id="f_time" type="time" step="900" value="${esc(v.time)}"></div>
    <div class="field"><label for="f_dur">時長（分鐘）</label><input class="input" id="f_dur" type="number" min="10" step="10" value="${esc(v.duration)}"></div>
    <div class="field"><label for="f_staff">醫師 / 衛教師</label><select class="input" id="f_staff">${staffOpts(v.staffId, CHAIR_ROLES)}</select></div>
    <div class="field"><label for="f_teeth">牙位（FDI）</label><input class="input en" id="f_teeth" value="${esc((v.teeth || []).join(', '))}" placeholder="例如 36, 37"><span class="hint">全口治療（如洗牙）可留空</span></div>
    ${isNew ? '' : `<div class="field"><label for="f_status">狀態</label><select class="input" id="f_status">${opts(AP_ST, v.status)}</select></div>`}
    <div class="field ${isNew ? '' : 'full'}"><label for="f_note">備註</label><input class="input" id="f_note" value="${esc(v.note || '')}" placeholder="例如：根管第 2 次"></div>
    <div class="field full" id="f_warn" style="gap:6px"></div>`,
    `${isNew ? '' : `<button class="btn danger" type="button" data-act="del-appt" data-id="${a.id}">${ic('trash')}刪除</button><span class="spacer"></span>`}
     <button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="f_save">${isNew ? '建立預約' : '儲存變更'}</button>`);
  const svc = $('#f_service');
  svc.addEventListener('change', () => { const s = get('services', svc.value); if (s) $('#f_dur').value = s.duration || 30; check(); });
  ['f_client', 'f_date', 'f_time', 'f_dur', 'f_staff'].forEach(id => $('#' + id).addEventListener('change', check));
  function check() {
    const out = [];
    const cid = $('#f_client').value, c = get('clients', cid), s = get('services', svc.value), d = $('#f_date').value;
    if (c && clientAlert(c)) out.push(`<div class="note-box danger">治療前注意：${esc(clientAlert(c))}</div>`);
    if (s && s.minInterval && cid && d) {
      const last = all('appointments').filter(x => x.id !== a.id && x.clientId === cid && x.serviceId === s.id && x.status === '完成' && x.date <= d).map(x => x.date).sort().pop();
      if (last && daysBetween(last, d) < s.minInterval) out.push(`<div class="note-box warn">上次「${esc(s.name)}」是 ${fmtDY(last)}，相隔 ${daysBetween(last, d)} 天，未滿 ${s.minInterval} 天，健保不給付。可改約 ${fmtDY(addDays(last, s.minInterval))} 之後，或改用自費項目。</div>`);
    }
    const sid = $('#f_staff').value, s0 = toMin($('#f_time').value), s1 = s0 + (+$('#f_dur').value || 30);
    const hit = sid && all('appointments').find(x => x.id !== a.id && x.staffId === sid && x.date === d && x.status !== '取消' && toMin(x.time) < s1 && toMin(x.time) + (x.duration || 30) > s0);
    if (hit) out.push(`<div class="note-box warn">此人員在 ${esc(hit.time)} 已有 ${esc(hit.clientName)} 的「${esc(hit.serviceName)}」，時段重疊。</div>`);
    $('#f_warn').innerHTML = out.join('');
  }
  check();
  $('#f_save').addEventListener('click', async () => {
    const cid = $('#f_client').value, sid = $('#f_service').value;
    if (!cid || !sid || !$('#f_date').value || !$('#f_time').value) { toast('請選擇病患、療程，並填入日期與時間。', true); return; }
    const raw = $('#f_teeth').value.trim(), teeth = parseTeeth(raw);
    if (raw && !teeth.length) { toast('牙位請用 FDI 兩位數，例如 16、36；乳牙為 51–85。', true); return; }
    const c = get('clients', cid), s = get('services', sid);
    const data = { ...clone(a), clientId: cid, clientName: c.name, serviceId: sid, serviceName: s.name, date: $('#f_date').value, time: $('#f_time').value,
      duration: +$('#f_dur').value || 30, staffId: $('#f_staff').value, teeth, status: isNew ? '已預約' : $('#f_status').value, note: $('#f_note').value.trim() };
    delete data.id; if (isNew) data.createdAt = TODAY();
    const ok = await save('appointments', a.id, data);
    if (ok) { closeDialog(); toast(isNew ? `已為 ${c.name} 建立 ${fmtD(data.date)} ${data.time} 的預約` : '預約已更新'); }
  });
}
function completeAppt(id) {
  const a = get('appointments', id); if (!a) return;
  const c = get('clients', a.clientId), s = get('services', a.serviceId);
  const idx = c ? (c.packages || []).findIndex(p => p.serviceId === a.serviceId && (p.total || 0) > (p.used || 0)) : -1;
  if (idx < 0) { finishAppt(id, -1); return; }
  const p = c.packages[idx];
  openDialog('完成療程', `<div class="field full"><p style="margin:0">${esc(a.clientName)} 有「${esc(p.name)}」，剩 <b>${p.total - p.used}</b> 次。這次要從療程計畫扣除嗎？</p>${s && s.recallDays ? `<span class="hint">完成後會自動排定 ${s.recallDays} 天後的「${esc(s.recallLabel || s.name + '回診')}」提醒。</span>` : ''}</div>`,
    `<button class="btn" type="button" data-act="done-nopkg" data-id="${id}">只標記完成</button><button class="btn primary" type="button" data-act="done-pkg" data-id="${id}" data-i="${idx}">完成並扣 1 次</button>`);
}
async function finishAppt(id, pkgIdx) {
  const a = get('appointments', id); if (!a) return;
  const c = get('clients', a.clientId), s = get('services', a.serviceId);
  if (!await patch('appointments', id, { status: '完成' })) return;
  const upd = {}, msg = [];
  if (c) {
    if (pkgIdx >= 0) { const pk = clone(c.packages); pk[pkgIdx].used = (pk[pkgIdx].used || 0) + 1; upd.packages = pk; msg.push('已扣療程計畫 1 次'); }
    if (s && s.toothStatus && (a.teeth || []).length) {
      const t = clone(c.teeth || {});
      a.teeth.forEach(n => { t[n] = { ...(t[n] || {}), s: s.toothStatus, at: a.date }; if (['missing', 'implant', 'crown'].includes(s.toothStatus)) t[n].surf = []; });
      upd.teeth = t; msg.push(`牙位 ${a.teeth.join('、')} 更新為「${TS[s.toothStatus]}」`);
    }
    if (s && s.recallDays > 0) { upd.nextFollowUp = addDays(a.date, s.recallDays); upd.followUpReason = s.recallLabel || `${s.name}回診`; upd.followUpServiceId = s.recallServiceId || s.id; msg.push(`${upd.followUpReason}提醒 ${fmtD(upd.nextFollowUp)}`); }
    if (Object.keys(upd).length) await patch('clients', c.id, upd);
  }
  closeDialog();
  toast(`${a.clientName} 已完成${msg.length ? '：' + msg.join('，') : ''}`);
}

/* ================= 病患表單 ================= */
function clientForm(c = {}) {
  const isNew = !c.id;
  const v = { level: '一般', gender: '女', source: SOURCES[0], ...c };
  openDialog(isNew ? '新增病患' : `編輯病患：${c.name}`, `
    <div class="field"><label class="req" for="c_name">姓名</label><input class="input" id="c_name" value="${esc(v.name || '')}" autocomplete="off"></div>
    <div class="field"><label for="c_chart">病歷號</label><input class="input en" id="c_chart" value="${esc(v.chartNo || nextChartNo())}"></div>
    <div class="field"><label class="req" for="c_phone">手機</label><input class="input en" id="c_phone" inputmode="tel" value="${esc(v.phone || '')}" placeholder="0912-345-678"></div>
    <div class="field"><label for="c_gender">性別</label><select class="input" id="c_gender">${opts(['女', '男', '其他'], v.gender)}</select></div>
    <div class="field"><label for="c_birth">生日</label><input class="input" id="c_birth" type="date" value="${esc(v.birthday || '')}"></div>
    <div class="field"><label for="c_level">會員等級</label><select class="input" id="c_level">${opts(LEVELS, v.level)}</select></div>
    <div class="field"><label for="c_line">LINE ID</label><input class="input" id="c_line" value="${esc(v.line || '')}"></div>
    <div class="field"><label for="c_email">Email</label><input class="input" id="c_email" type="email" value="${esc(v.email || '')}"></div>
    <div class="field"><label for="c_source">來源</label><select class="input" id="c_source">${opts(SOURCES, v.source)}</select></div>
    <div class="field"><label for="c_follow">建議回診日</label><input class="input" id="c_follow" type="date" value="${esc(v.nextFollowUp || '')}"></div>
    <div class="field full"><label for="c_reason">回診原因</label><input class="input" id="c_reason" value="${esc(v.followUpReason || '')}" placeholder="例如：半年定期洗牙、根管第 2 次"></div>
    <div class="field full"><label for="c_allergy">過敏</label><input class="input" id="c_allergy" value="${esc(v.allergies || '')}" placeholder="例如：盤尼西林、乳膠手套、局部麻醉藥"></div>
    <div class="field full"><label for="c_medical">全身病史 / 用藥</label><input class="input" id="c_medical" value="${esc(v.medical || '')}" placeholder="例如：高血壓、糖尿病、服用抗凝血劑、懷孕中"></div>
    <div class="field full"><label for="c_tags">標籤</label><input class="input" id="c_tags" value="${esc((v.tags || []).join('、'))}" placeholder="用頓號或逗號分隔，例如：怕痛、牙周病、矯正中"></div>
    <div class="field full"><label for="c_notes">備註</label><textarea class="input" id="c_notes">${esc(v.notes || '')}</textarea></div>`,
    `${isNew ? '' : `<button class="btn danger" type="button" data-act="del-client" data-id="${c.id}">${ic('trash')}刪除</button><span class="spacer"></span>`}
     <button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="c_save">${isNew ? '建立病患' : '儲存變更'}</button>`, true);
  $('#c_save').addEventListener('click', async () => {
    const name = $('#c_name').value.trim(), phone = $('#c_phone').value.trim();
    if (!name || !phone) { toast('請填寫姓名與手機。', true); return; }
    const chartNo = $('#c_chart').value.trim();
    if (all('clients').some(x => x.id !== c.id && x.chartNo === chartNo)) { toast(`病歷號 ${chartNo} 已被使用，請換一個。`, true); return; }
    const data = { ...clone(c), name, phone, chartNo, gender: $('#c_gender').value, birthday: $('#c_birth').value, level: $('#c_level').value,
      email: $('#c_email').value.trim(), line: $('#c_line').value.trim(), source: $('#c_source').value, nextFollowUp: $('#c_follow').value, followUpReason: $('#c_reason').value.trim(),
      tags: $('#c_tags').value.split(/[、,，]/).map(s => s.trim()).filter(Boolean), allergies: $('#c_allergy').value.trim(), medical: $('#c_medical').value.trim(), notes: $('#c_notes').value.trim() };
    delete data.id;
    if (isNew) Object.assign(data, { createdAt: TODAY(), balance: 0, packages: [], teeth: {} });
    const id = await save('clients', c.id, data);
    if (id) { closeDialog(); toast(isNew ? `已建立病患 ${name}` : '病患資料已更新'); if (isNew) setTimeout(() => openClient(id), 50); }
  });
}

/* ================= 櫃檯結帳 ================= */
function posItems() {
  // 畫面與點選共用同一份清單，索引才會一致
  const q = ui.posQ.trim().toLowerCase();
  const byCode = (a, b) => (get('services', a.refId)?.code || '').localeCompare(get('services', b.refId)?.code || '');
  let items = [];
  if (ui.posTab === 'service') items = all('services').filter(s => s.active !== false).map(s => ({ type: 'service', refId: s.id, name: s.name, price: s.price, ds: `${s.nhi ? '健保' : '自費'}・${s.category || ''}・${s.duration || 30} 分` })).sort(byCode);
  if (ui.posTab === 'package') items = all('services').filter(s => s.active !== false && s.pkgSessions > 0).map(s => ({ type: 'package', refId: s.id, name: `${s.name}（${s.pkgSessions} 次療程）`, price: s.pkgPrice, sessions: s.pkgSessions, ds: `平均每次 ${money(s.pkgPrice / s.pkgSessions)}` })).sort(byCode);
  if (ui.posTab === 'product') items = all('products').sort((a, b) => (a.category || '').localeCompare(b.category || '', 'zh-Hant') || (a.sku || '').localeCompare(b.sku || '')).map(p => ({ type: 'product', refId: p.id, name: p.name, price: p.price, ds: `${p.category ? p.category + '・' : ''}庫存 ${p.stock} ${p.unit || ''}`, out: p.stock <= 0 }));
  if (ui.posTab === 'topup') items = [3000, 5000, 10000, 20000, 30000].map(v => ({ type: 'topup', refId: 'topup' + v, name: `儲值 ${money(v)}`, price: v, bonus: v >= 30000 ? .1 : v >= 20000 ? .08 : v >= 10000 ? .05 : 0, ds: v >= 10000 ? `加贈 ${v >= 30000 ? '10' : v >= 20000 ? '8' : '5'}%` : '可用於自費療程' }));
  return items.filter(i => !q || i.name.toLowerCase().includes(q));
}
VIEWS.pos = {
  sub: () => '健保部分負擔、自費療程、口腔用品與儲值',
  tools: () => '',
  body() {
    const items = posItems();
    const sub = ui.cart.reduce((s, l) => s + l.price * l.qty, 0);
    const disc = Math.min(sub, Math.max(0, +ui.cartDiscount || 0));
    const total = sub - disc;
    const cl = get('clients', ui.cartClient);
    const recent = all('orders').sort((a, b) => (b.no || '').localeCompare(a.no || '')).slice(0, 8);
    return `<div class="pos">
      <div class="stack">
        <section class="panel"><div class="panel-h" style="flex-wrap:wrap"><div class="seg">${[['service', '單次療程'], ['package', '療程計畫'], ['product', '口腔用品'], ['topup', '儲值']].map(([k, l]) => `<button type="button" data-postab="${k}" aria-pressed="${ui.posTab === k}">${l}</button>`).join('')}</div>
          <div class="search" style="max-width:220px">${ic('search')}<input class="input" id="posQ" type="search" placeholder="搜尋品項" value="${esc(ui.posQ)}"></div></div>
          <div class="panel-b">${items.length ? `<div class="catalog">${items.map((i, k) => `<button type="button" class="item-card" data-additem="${k}" ${i.out ? 'disabled style="opacity:.5"' : ''}><span class="nm">${esc(i.name)}</span><span class="pr">${money(i.price)}</span><span class="ds">${esc(i.ds)}${i.out ? '・缺貨' : ''}</span></button>`).join('')}</div>` : `<div class="empty"><span>這個分類還沒有品項，可以到「系統設定」或「庫存管理」新增。</span></div>`}</div></section>
        <section class="panel"><div class="panel-h"><h2>最近結帳</h2><span class="meta">最新 8 筆</span></div>
          <div class="tbl-wrap">${recent.length ? `<table class="tbl"><thead><tr><th>單號</th><th>日期</th><th>病患</th><th class="hide-sm">內容</th><th>付款</th><th class="r">金額</th></tr></thead><tbody>${recent.map(o => `<tr><td class="en">${esc(o.no)}</td><td>${fmtDY(o.date)}</td><td><a href="#" data-open-client="${o.clientId}">${esc(o.clientName)}</a></td><td class="hide-sm">${(o.items || []).map(i => esc(i.name)).join('、')}</td><td><span class="chip">${esc(o.payMethod)}</span></td><td class="r num">${money(o.total)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><span>還沒有結帳紀錄。</span></div>`}</div></section>
      </div>
      <section class="panel" style="position:sticky;top:12px"><div class="panel-h"><h2>本次帳單</h2>${ui.cart.length ? `<button class="btn sm ghost" type="button" data-act="cart-clear">清空</button>` : ''}</div>
        <div class="panel-b stack" style="gap:14px">
          <div class="field"><label class="req" for="cartClient">病患</label><select class="input" id="cartClient">${clientOpts(ui.cartClient)}</select>
            ${cl ? `<span class="hint">儲值餘額 ${money(cl.balance || 0)}・等級 ${esc(cl.level || '一般')}</span>` : ''}</div>
          <div>${ui.cart.length ? ui.cart.map((l, i) => `<div class="cart-line"><span style="min-width:0">${esc(l.name)}<br><span class="small muted num">${money(l.price)}</span></span>
              <span class="qty"><button type="button" data-qty="${i}" data-d="-1" aria-label="減少">−</button><span>${l.qty}</span><button type="button" data-qty="${i}" data-d="1" aria-label="增加">＋</button></span>
              <span class="num" style="min-width:72px;text-align:right">${money(l.price * l.qty)}</span><button class="btn sm ghost" type="button" data-rmline="${i}" aria-label="移除">${ic('x')}</button></div>`).join('')
            : `<div class="empty" style="padding:18px 0"><span>從左側點選品項加入帳單。</span></div>`}</div>
          <div class="grid g-2e" style="gap:12px">
            <div class="field"><label for="cartDiscount">折扣金額</label><input class="input en" id="cartDiscount" type="number" min="0" step="10" value="${esc(ui.cartDiscount || '')}" placeholder="0"></div>
            <div class="field"><label for="cartPay">付款方式</label><select class="input" id="cartPay">${opts(PAYS, ui.cartPay)}</select></div>
            <div class="field"><label for="cartStaff">主治 / 經手</label><select class="input" id="cartStaff">${staffOpts(ui.cartStaff)}</select></div>
            <div class="field"><label for="cartNote">備註</label><input class="input" id="cartNote" value="${esc(ui.cartNote)}"></div>
          </div>
          <div><div class="sum-row"><span>小計</span><span class="num">${money(sub)}</span></div><div class="sum-row"><span>折扣</span><span class="num">−${money(disc)}</span></div><div class="sum-row total"><span>應收</span><span class="num">${money(total)}</span></div>
            ${ui.cartPay === '儲值扣款' && cl ? `<div class="small ${((cl.balance || 0) < total) ? 'down' : 'muted'}">扣款後餘額 ${money((cl.balance || 0) - total)}</div>` : ''}</div>
          <button class="btn primary" type="button" data-act="checkout" ${ui.cart.length ? '' : 'disabled'} style="justify-content:center;padding:12px">${ic('check')}確認結帳 ${money(total)}</button>
        </div></section></div>`;
  }
};
async function checkout() {
  const c = get('clients', ui.cartClient);
  if (!c) { toast('請先選擇病患再結帳。', true); return; }
  if (!ui.cart.length) return;
  const sub = ui.cart.reduce((s, l) => s + l.price * l.qty, 0);
  const disc = Math.min(sub, Math.max(0, +ui.cartDiscount || 0)), total = sub - disc;
  if (ui.cartPay === '儲值扣款') {
    if (ui.cart.some(l => l.type === 'topup')) { toast('儲值品項不能用儲值扣款支付，請改用其他付款方式。', true); return; }
    if ((c.balance || 0) < total) { toast(`儲值餘額不足：目前 ${money(c.balance || 0)}，應收 ${money(total)}。`, true); return; }
  }
  for (const l of ui.cart.filter(l => l.type === 'product')) {
    const p = get('products', l.refId);
    if (!p || p.stock < l.qty) { toast(`「${l.name}」庫存不足（剩 ${p ? p.stock : 0}）。`, true); return; }
  }
  const date = TODAY();
  const order = { no: nextOrderNo(date), date, clientId: c.id, clientName: c.name, items: ui.cart.map(l => ({ type: l.type, refId: l.refId, name: l.name, qty: l.qty, price: l.price })),
    subtotal: sub, discount: disc, total, payMethod: ui.cartPay, staffId: ui.cartStaff, note: ui.cartNote.trim(), createdAt: new Date().toISOString() };
  const id = await save('orders', null, order);
  if (!id) return;
  let balance = c.balance || 0; const packages = clone(c.packages || []);
  if (ui.cartPay === '儲值扣款') balance -= total;
  ui.cart.forEach(l => {
    if (l.type === 'topup') balance += Math.round(l.price * l.qty * (1 + (l.bonus || 0)));
    if (l.type === 'package') for (let k = 0; k < l.qty; k++) packages.push({ serviceId: l.refId, name: l.name, total: l.sessions, used: 0, boughtAt: date, expires: addDays(date, 730) });
  });
  if (balance !== (c.balance || 0) || packages.length !== (c.packages || []).length) await patch('clients', c.id, { balance, packages });
  for (const l of ui.cart.filter(l => l.type === 'product')) { const p = get('products', l.refId); await patch('products', p.id, { stock: p.stock - l.qty }); }
  toast(`結帳完成：${order.no}・${money(total)}`);
  Object.assign(ui, { cart: [], cartDiscount: 0, cartNote: '' });
  refresh();
}

/* ================= 庫存 ================= */
VIEWS.stock = {
  sub: () => { const l = lowStock().length; return `${S.products.size} 項品項${l ? `・${l} 項低於安全庫存` : ''}`; },
  tools: () => {
    const cats = ['全部', ...new Set(all('products').map(p => p.category).filter(Boolean))];
    return `<div class="search">${ic('search')}<input class="input" id="sq" type="search" placeholder="搜尋品名或料號" value="${esc(ui.sq)}"></div>
      <select class="input" id="scat" style="width:auto" aria-label="分類">${opts(cats, ui.scat)}</select>
      <button class="btn primary" type="button" data-act="new-product">${ic('plus')}新增品項</button>`;
  },
  body() {
    if (!S.products.size) return `<div class="panel">${empty('還沒有品項資料', '建立牙刷、牙線、矯正用品等品項，即可在結帳時販售並追蹤庫存。', `<button class="btn primary" type="button" data-act="new-product">${ic('plus')}新增品項</button>`)}</div>`;
    const q = ui.sq.trim().toLowerCase();
    const rows = all('products').filter(p => (ui.scat === '全部' || p.category === ui.scat) && (!q || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(q)))
      .sort((a, b) => (a.stock / Math.max(1, a.safety)) - (b.stock / Math.max(1, b.safety)));
    const value = all('products').reduce((s, p) => s + (p.stock || 0) * (p.cost || 0), 0);
    return `<div class="grid g-kpi">
        <div class="panel kpi"><span class="eyebrow">ITEMS</span><span class="label">品項數</span><span class="val">${S.products.size}</span></div>
        <div class="panel kpi"><span class="eyebrow">VALUE</span><span class="label">庫存成本總值</span><span class="val">${money(value)}</span></div>
        <div class="panel kpi"><span class="eyebrow">LOW</span><span class="label">低於安全庫存</span><span class="val" style="color:var(--warn)">${lowStock().filter(p => p.stock > 0).length}</span></div>
        <div class="panel kpi"><span class="eyebrow">OUT</span><span class="label">缺貨</span><span class="val" style="color:var(--danger)">${all('products').filter(p => p.stock <= 0).length}</span></div></div>
      ${sec('品項一覽', 'Inventory')}
      <ul class="cards">${rows.map(p => { const ratio = Math.min(1, p.stock / Math.max(1, p.safety * 2)); const cls = p.stock <= 0 ? 'out' : p.stock <= p.safety ? 'low' : '';
        return `<li class="card" data-act="edit-product" data-id="${p.id}" tabindex="0">
          <div class="card-img stock-vis">${cls ? `<span class="vis-alert" style="background:var(--${cls === 'out' ? 'danger' : 'warn'})">${cls === 'out' ? '缺貨' : '庫存偏低'}</span>` : ''}
            <span class="big">${p.stock}<small>${esc(p.unit || '')}</small></span><span class="gauge"><i class="${cls}" style="width:${ratio * 100}%"></i></span><span class="small muted">安全庫存 ${p.safety}</span>
            <div class="card-over"><time>${p.lastRestock ? 'Restock ' + fmtEN(p.lastRestock) : 'Stock'}</time><p class="over-cat">成本 ${money(p.cost)}・毛利 ${p.price ? Math.round((p.price - p.cost) / p.price * 100) + '%' : '—'}</p><p class="over-tec">${esc(p.category || '未分類')}</p>
              <div class="over-acts"><button class="obtn" type="button" data-act="restock" data-id="${p.id}">進貨</button><button class="obtn" type="button" data-act="edit-product" data-id="${p.id}">編輯</button></div></div></div>
          <p class="card-ttl"><b>${esc(p.name)}</b></p><p class="card-url en">${esc(p.sku || '')}　${money(p.price)}</p></li>`; }).join('')}</ul>`;
  }
};
function productForm(p = {}) {
  const isNew = !p.id; const v = { unit: '支', stock: 0, safety: 5, ...p };
  openDialog(isNew ? '新增品項' : `編輯品項：${p.name}`, `
    <div class="field"><label class="req" for="p_name">品名</label><input class="input" id="p_name" value="${esc(v.name || '')}"></div>
    <div class="field"><label for="p_sku">料號</label><input class="input en" id="p_sku" value="${esc(v.sku || '')}" placeholder="例如 OC-012"></div>
    <div class="field"><label for="p_cat">分類</label><input class="input" id="p_cat" value="${esc(v.category || '')}" list="p_cats" placeholder="居家清潔 / 矯正用品"><datalist id="p_cats">${[...new Set(all('products').map(x => x.category).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="field"><label for="p_unit">單位</label><input class="input" id="p_unit" value="${esc(v.unit)}"></div>
    <div class="field"><label for="p_cost">成本</label><input class="input en" id="p_cost" type="number" min="0" value="${esc(v.cost ?? '')}"></div>
    <div class="field"><label class="req" for="p_price">售價</label><input class="input en" id="p_price" type="number" min="0" value="${esc(v.price ?? '')}"></div>
    <div class="field"><label for="p_stock">目前庫存</label><input class="input en" id="p_stock" type="number" value="${esc(v.stock)}"></div>
    <div class="field"><label for="p_safety">安全庫存</label><input class="input en" id="p_safety" type="number" min="0" value="${esc(v.safety)}"><span class="hint">低於此數量會出現提醒</span></div>`,
    `${isNew ? '' : `<button class="btn danger" type="button" data-act="del-product" data-id="${p.id}">${ic('trash')}刪除</button><span class="spacer"></span>`}<button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="p_save">${isNew ? '建立品項' : '儲存變更'}</button>`);
  $('#p_save').addEventListener('click', async () => {
    const name = $('#p_name').value.trim(); if (!name || $('#p_price').value === '') { toast('請填寫品名與售價。', true); return; }
    const data = { ...clone(p), name, sku: $('#p_sku').value.trim(), category: $('#p_cat').value.trim(), unit: $('#p_unit').value.trim(), cost: +$('#p_cost').value || 0, price: +$('#p_price').value || 0, stock: +$('#p_stock').value || 0, safety: +$('#p_safety').value || 0 };
    delete data.id;
    if (await save('products', p.id, data)) { closeDialog(); toast(isNew ? `已新增 ${name}` : '品項已更新'); }
  });
}
function restockForm(p) {
  openDialog(`進貨：${p.name}`, `<div class="field"><label for="r_qty">進貨數量（${esc(p.unit || '')}）</label><input class="input en" id="r_qty" type="number" min="1" value="${Math.max(1, p.safety * 2 - p.stock)}"></div>
    <div class="field"><label>目前庫存</label><div class="input en" style="background:var(--crumb)">${p.stock}</div></div>
    <div class="field full"><span class="hint">建議補到安全庫存的 2 倍（${p.safety * 2} ${esc(p.unit || '')}）。</span></div>`,
    `<button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="r_save">確認入庫</button>`);
  $('#r_save').addEventListener('click', async () => { const n = +$('#r_qty').value || 0; if (n <= 0) { toast('請輸入大於 0 的數量。', true); return; }
    if (await patch('products', p.id, { stock: (get('products', p.id).stock || 0) + n, lastRestock: TODAY() })) { closeDialog(); toast(`${p.name} 已入庫 ${n} ${p.unit || ''}`); } });
}

/* ================= 報表 ================= */
VIEWS.report = {
  retools: true,
  sub: () => { const [y, m] = ui.rMonth.split('-'); return `${y} 年 ${+m} 月`; },
  tools: () => `<button class="btn" type="button" data-act="rmonth" data-n="-1" aria-label="上個月">${ic('left')}</button><input class="input" id="rMonth" type="month" value="${ui.rMonth}" style="width:auto" aria-label="選擇月份"><button class="btn" type="button" data-act="rmonth" data-n="1" aria-label="下個月">${ic('right')}</button>`,
  body() {
    const ym = ui.rMonth;
    const os = all('orders').filter(o => (o.date || '').startsWith(ym));
    const rev = os.reduce((s, o) => s + o.total, 0), prev = monthRevenue(shiftMonth(ym, -1));
    const ap = all('appointments').filter(a => (a.date || '').startsWith(ym));
    const done = ap.filter(a => a.status === '完成').length, noshow = ap.filter(a => a.status === '未到').length;
    const buyers = new Set(os.map(o => o.clientId));
    const newIds = new Set(all('clients').filter(c => (c.createdAt || '').startsWith(ym)).map(c => c.id));
    const catOf = i => i.type === 'service' ? (get('services', i.refId)?.nhi ? '健保部分負擔' : '自費療程') : ({ package: '療程計畫', product: '口腔用品', topup: '儲值' }[i.type] || i.type);
    const byCat = {}, bySvc = {}, byStaff = {}, byPay = {};
    os.forEach(o => {
      const ratio = o.subtotal ? o.total / o.subtotal : 1;
      (o.items || []).forEach(i => { const v = i.price * i.qty * ratio, k = catOf(i); byCat[k] = (byCat[k] || 0) + v; if (i.type === 'service' || i.type === 'package') bySvc[i.name] = (bySvc[i.name] || 0) + v; });
      const st = get('staff', o.staffId); const sn = st ? st.name : '未指定'; byStaff[sn] = (byStaff[sn] || 0) + o.total;
      byPay[o.payMethod] = (byPay[o.payMethod] || 0) + o.total;
    });
    const toRows = m => Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(ym, i - 11));
    const diff = prev ? Math.round((rev - prev) / prev * 100) : null;
    const recallDone = ap.filter(a => a.status === '完成' && get('services', a.serviceId)?.recallDays >= 150).length;
    return `<div class="grid g-kpi">
      <div class="panel kpi"><span class="eyebrow">SALES</span><span class="label">當月營收</span><span class="val">${money(rev)}</span><span class="foot">${diff === null ? '上月無資料' : `較上月 <span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}%</span>`}</span></div>
      <div class="panel kpi"><span class="eyebrow">VISITS</span><span class="label">完成看診</span><span class="val">${done}</span><span class="foot">預約 ${ap.length} 筆・未到 ${noshow}</span></div>
      <div class="panel kpi"><span class="eyebrow">RECALL</span><span class="label">定期洗牙完成</span><span class="val">${recallDone}</span><span class="foot">回診率的主要指標</span></div>
      <div class="panel kpi"><span class="eyebrow">PATIENTS</span><span class="label">新 / 舊病患</span><span class="val">${[...buyers].filter(b => newIds.has(b)).length} / ${[...buyers].filter(b => !newIds.has(b)).length}</span><span class="foot">當月新建檔 ${newIds.size} 位</span></div></div>
      ${sec('近 12 個月營收', 'Monthly Sales')}
      <section class="panel"><div class="panel-b">${barChart(months.map(m => ({ label: +m.slice(5) + '月', value: monthRevenue(m), cur: m === ym })), { label: '近十二個月營收' })}</div></section>
      ${sec('營收分析', 'Breakdown')}
      <div class="grid g-2e">
        <section class="panel"><div class="panel-h"><h2>營收來源</h2><span class="meta">健保／自費分開計算</span></div><div class="panel-b">${hbars(toRows(byCat))}</div></section>
        <section class="panel"><div class="panel-h"><h2>療程營收排行</h2></div><div class="panel-b">${hbars(toRows(bySvc).slice(0, 8))}</div></section>
        <section class="panel"><div class="panel-h"><h2>醫師業績</h2><span class="meta">依主治 / 經手人員</span></div><div class="panel-b">${hbars(toRows(byStaff))}</div></section>
        <section class="panel"><div class="panel-h"><h2>付款方式</h2></div><div class="panel-b">${hbars(toRows(byPay))}</div></section>
      </div>`;
  }
};

/* ================= 設定 ================= */
VIEWS.settings = {
  retools: true,
  sub: () => '診所資訊、療程價目與人員',
  tools: () => `<div class="seg">${[['clinic', '診所資訊'], ['services', '療程價目'], ['staff', '人員'], ...(me && me.role === 'admin' ? [['members', '帳號']] : []), ['data', '資料管理']].map(([k, l]) => `<button type="button" data-settab="${k}" aria-pressed="${ui.setTab === k}">${l}</button>`).join('')}</div>`,
  body() {
    if (ui.setTab === 'clinic') {
      const s = S.settings;
      return `<section class="panel" style="max-width:720px;margin:0 auto"><div class="panel-h"><h2>診所資訊</h2></div><div class="dialog-b">
        <div class="field full"><label for="s_name">診所名稱</label><input class="input" id="s_name" value="${esc(s.name || '')}" placeholder="例如：晴光牙醫診所"></div>
        <div class="field"><label for="s_phone">電話</label><input class="input en" id="s_phone" value="${esc(s.phone || '')}"></div>
        <div class="field"><label for="s_hours">看診時間</label><input class="input" id="s_hours" value="${esc(s.hours || '')}" placeholder="週一至週六 09:00–21:00"></div>
        <div class="field full"><label for="s_addr">地址</label><input class="input" id="s_addr" value="${esc(s.address || '')}"></div>
        <div class="field full"><label for="s_remind">提前幾天提醒回診</label><input class="input en" id="s_remind" type="number" min="1" value="${esc(s.remindDays || 14)}"><span class="hint">建議回診日在這個天數內、且還沒預約的病患，會出現在總覽的「洗牙・回診提醒」。各療程的回診間隔在「療程價目」設定，例如洗牙 180 天。</span></div>
      </div><div class="dialog-f"><button class="btn primary" type="button" data-act="save-settings">儲存設定</button></div></section>`;
    }
    if (ui.setTab === 'services') {
      const rows = all('services').sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      return `<section class="panel"><div class="panel-h"><h2>療程價目表</h2><button class="btn primary sm" type="button" data-act="new-service">${ic('plus')}新增療程</button></div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>代碼</th><th>名稱</th><th class="hide-sm">分類</th><th class="r">時長</th><th class="r">價格</th><th class="hide-sm">療程計畫</th><th class="hide-sm">回診提醒</th><th class="hide-sm">牙位圖</th></tr></thead><tbody>${rows.map(s => `<tr class="click" data-act="edit-service" data-id="${s.id}"><td class="en">${esc(s.code)}</td><td class="cell-name">${esc(s.name)} <span class="chip ${s.nhi ? 'info' : ''}">${s.nhi ? '健保' : '自費'}</span> ${s.active === false ? '<span class="chip">停用</span>' : ''}</td><td class="hide-sm">${esc(s.category || '')}</td><td class="r num">${s.duration} 分</td><td class="r num">${money(s.price)}</td><td class="hide-sm">${s.pkgSessions ? `${s.pkgSessions} 次 <span class="num">${money(s.pkgPrice)}</span>` : '—'}</td><td class="hide-sm">${s.recallDays ? `${s.recallDays} 天・${esc(s.recallLabel || '')}` : '—'}</td><td class="hide-sm">${s.toothStatus ? `<span class="row" style="gap:5px"><i class="sw ts-${s.toothStatus}"></i>${TS[s.toothStatus]}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`
        : empty('尚未建立療程', '先建立療程項目與價格，預約與結帳時才能選用。', `<button class="btn primary" type="button" data-act="new-service">${ic('plus')}新增療程</button>`)}</section>`;
    }
    if (ui.setTab === 'staff') {
      const rows = all('staff').sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
      return `<ul class="cards">${rows.map(s => `<li class="card" data-act="edit-staff" data-id="${s.id}" tabindex="0"><div class="card-img" style="background:${staffSoft(s)};flex-direction:column;gap:4px;border-bottom:3px solid ${staffColor(s)}"><span class="en" style="font-size:13px;letter-spacing:2px;color:${staffColor(s)}">${esc(s.role)}</span><span style="font-size:26px;color:var(--ink-2);letter-spacing:4px">${esc(s.name)}</span>${s.active === false ? '<span class="vis-alert" style="background:#888">停用</span>' : ''}</div><p class="card-ttl"><b>${esc(s.name)}</b>　${esc(s.role)}</p><p class="card-url">${esc(s.title || '—')}${CHAIR_ROLES.includes(s.role) ? '・顯示於預約表' : ''}</p></li>`).join('')}
        <li class="card" data-act="new-staff" tabindex="0"><div class="card-img" style="flex-direction:column;gap:6px;color:var(--faint)">${ic('plus', 30)}<span>新增人員</span></div><p class="card-ttl">新增牙醫師、衛教師或櫃檯</p><p class="card-url">Add staff</p></li></ul>`;
    }
    if (ui.setTab === 'members') {
      if (!ui.members) { loadMembers(); return `<div class="panel"><div class="empty">正在讀取帳號名單…</div></div>`; }
      return `<section class="panel" style="max-width:860px;margin:0 auto"><div class="panel-h"><h2>登入帳號</h2><span class="meta">新註冊的帳號需要管理員核准才能看到病患資料</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>註冊日期</th><th>身分</th><th>狀態</th><th></th></tr></thead><tbody>
        ${ui.members.map(m => `<tr><td class="en">${esc(m.email)}${m.user_id === me.user_id ? ' <span class="chip">你</span>' : ''}</td><td>${fmtDY((m.created_at || '').slice(0, 10))}</td>
          <td>${m.user_id === me.user_id ? '管理員' : `<select class="input" data-mrole="${m.user_id}" style="width:auto"><option value="staff" ${m.role === 'staff' ? 'selected' : ''}>一般人員</option><option value="admin" ${m.role === 'admin' ? 'selected' : ''}>管理員</option></select>`}</td>
          <td>${m.approved ? '<span class="chip ok">已核准</span>' : '<span class="chip warn">等待核准</span>'}</td>
          <td class="r" style="white-space:nowrap">${m.user_id === me.user_id ? '' : `${m.approved ? `<button class="btn sm" type="button" data-act="member-approve" data-id="${m.user_id}" data-v="0">停用</button>` : `<button class="btn sm primary" type="button" data-act="member-approve" data-id="${m.user_id}" data-v="1">核准</button>`} <button class="btn sm ghost" type="button" data-act="member-remove" data-id="${m.user_id}" aria-label="移除">${ic('trash')}</button>`}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="panel-b small muted">請同事打開這個網站，按「建立帳號」用自己的 Email 註冊並完成信箱驗證，再回到這裡按「核准」。</div></section>`;
    }
    const samples = COLS.reduce((s, c) => s + all(c).filter(d => d.sample).length, 0);
    return `<div class="stack" style="max-width:720px;margin:0 auto">
      <section class="panel"><div class="panel-h"><h2>範例資料</h2></div><div class="panel-b stack" style="gap:12px">
        <p style="margin:0">${samples ? `目前有 <b>${samples}</b> 筆範例資料（病患、預約、訂單、品項、療程與人員）。正式開始使用前，可以一次清除。你自己新增的資料不會被刪除。` : '目前沒有範例資料。'}</p>
        <div><button class="btn danger" type="button" data-act="clear-samples" ${samples ? '' : 'disabled'}>${ic('trash')}清除所有範例資料</button></div></div></section>
      <section class="panel"><div class="panel-h"><h2>匯出</h2></div><div class="panel-b row"><button class="btn" type="button" data-act="export-clients">${ic('dl')}病患名單 CSV</button><button class="btn" type="button" data-act="export-orders">${ic('dl')}銷售明細 CSV</button></div></section>
      <section class="panel"><div class="panel-h"><h2>資料保存方式</h2></div><div class="panel-b small muted" style="line-height:1.9">所有資料存放在診所專屬的 Supabase 資料庫，同事在不同電腦登入後會即時看到最新內容。只有登入、且經管理員核准的帳號才能讀寫病患資料；網站本身是公開網址，但沒有帳號的人什麼資料都看不到。病歷屬敏感個資，請只核准診所內部人員。本系統為營運管理用途，不取代健保申報與正式電子病歷系統。</div></section></div>`;
  }
};
function serviceForm(s = {}) {
  const isNew = !s.id; const v = { duration: 30, active: true, nhi: false, ...s };
  openDialog(isNew ? '新增療程' : `編輯療程：${s.name}`, `
    <div class="field"><label class="req" for="v_name">療程名稱</label><input class="input" id="v_name" value="${esc(v.name || '')}"></div>
    <div class="field"><label for="v_code">代碼</label><input class="input en" id="v_code" value="${esc(v.code || '')}" placeholder="例如 NHI-01"></div>
    <div class="field"><label for="v_nhi">給付類別</label><select class="input" id="v_nhi"><option value="1" ${v.nhi ? 'selected' : ''}>健保</option><option value="0" ${!v.nhi ? 'selected' : ''}>自費</option></select></div>
    <div class="field"><label for="v_cat">分類</label><input class="input" id="v_cat" value="${esc(v.category || '')}" list="v_cats" placeholder="預防保健 / 補綴 / 矯正"><datalist id="v_cats">${[...new Set(all('services').map(x => x.category).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="field"><label for="v_dur">時長（分鐘）</label><input class="input en" id="v_dur" type="number" min="10" step="10" value="${esc(v.duration)}"></div>
    <div class="field"><label class="req" for="v_price">病患付費金額</label><input class="input en" id="v_price" type="number" min="0" value="${esc(v.price ?? '')}"><span class="hint">健保項目填掛號費加部分負擔</span></div>
    <div class="field"><label for="v_pks">療程計畫次數</label><input class="input en" id="v_pks" type="number" min="0" value="${esc(v.pkgSessions || '')}" placeholder="不分次請留空"></div>
    <div class="field"><label for="v_pkp">療程計畫總價</label><input class="input en" id="v_pkp" type="number" min="0" value="${esc(v.pkgPrice || '')}"></div>
    <div class="field"><label for="v_recall">完成後幾天提醒回診</label><input class="input en" id="v_recall" type="number" min="0" value="${esc(v.recallDays || '')}" placeholder="例如洗牙 180"></div>
    <div class="field"><label for="v_rlabel">回診提醒名稱</label><input class="input" id="v_rlabel" value="${esc(v.recallLabel || '')}" placeholder="例如：半年定期洗牙"></div>
    <div class="field"><label for="v_tooth">完成後牙位標記為</label><select class="input" id="v_tooth"><option value="">不更新牙位圖</option>${Object.entries(TS).filter(([k]) => k !== 'ok').map(([k, l]) => `<option value="${k}" ${v.toothStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="v_min">健保最短間隔（天）</label><input class="input en" id="v_min" type="number" min="0" value="${esc(v.minInterval || '')}" placeholder="例如洗牙 180"><span class="hint">預約未滿間隔時會提醒</span></div>
    <div class="field"><label for="v_active">狀態</label><select class="input" id="v_active"><option value="1" ${v.active !== false ? 'selected' : ''}>啟用</option><option value="0" ${v.active === false ? 'selected' : ''}>停用</option></select></div>`,
    `${isNew ? '' : `<button class="btn danger" type="button" data-act="del-service" data-id="${s.id}">${ic('trash')}刪除</button><span class="spacer"></span>`}<button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="v_save">${isNew ? '建立療程' : '儲存變更'}</button>`, true);
  $('#v_save').addEventListener('click', async () => {
    const name = $('#v_name').value.trim(); if (!name || $('#v_price').value === '') { toast('請填寫療程名稱與金額。', true); return; }
    const pks = +$('#v_pks').value || 0, pkp = +$('#v_pkp').value || 0;
    if (pks && !pkp) { toast('有設定療程計畫次數時，也請填寫總價。', true); return; }
    const data = { ...clone(s), name, code: $('#v_code').value.trim(), nhi: $('#v_nhi').value === '1', category: $('#v_cat').value.trim(), duration: +$('#v_dur').value || 30, price: +$('#v_price').value || 0,
      active: $('#v_active').value === '1', pkgSessions: pks, pkgPrice: pkp, recallDays: +$('#v_recall').value || 0, recallLabel: $('#v_rlabel').value.trim(), toothStatus: $('#v_tooth').value, minInterval: +$('#v_min').value || 0 };
    delete data.id;
    if (await save('services', s.id, data)) { closeDialog(); toast(isNew ? `已新增療程 ${name}` : '療程已更新'); }
  });
}
function staffForm(s = {}) {
  const isNew = !s.id; const used = all('staff').map(x => x.color); const free = [0, 1, 2, 3, 4, 5].find(c => !used.includes(c)) ?? 0;
  const v = { role: '牙醫師', color: free, active: true, ...s };
  openDialog(isNew ? '新增人員' : `編輯人員：${s.name}`, `
    <div class="field"><label class="req" for="t_name">姓名</label><input class="input" id="t_name" value="${esc(v.name || '')}"></div>
    <div class="field"><label for="t_role">職務</label><select class="input" id="t_role">${opts(ROLES, v.role)}</select></div>
    <div class="field"><label for="t_title">專長</label><input class="input" id="t_title" value="${esc(v.title || '')}" placeholder="例如：齒顎矯正、植牙"></div>
    <div class="field"><label for="t_active">狀態</label><select class="input" id="t_active"><option value="1" ${v.active !== false ? 'selected' : ''}>在職</option><option value="0" ${v.active === false ? 'selected' : ''}>離職 / 停用</option></select></div>
    <div class="field full"><label>預約表顏色</label><div class="row" id="t_colors">${[0, 1, 2, 3, 4, 5].map(c => `<button type="button" class="btn sm" data-color="${c}" aria-pressed="${c === v.color}" style="background:var(--c${c}s);color:var(--c${c});${c === v.color ? 'outline:2px solid var(--c' + c + ');' : ''}">色 ${c + 1}</button>`).join('')}</div></div>`,
    `${isNew ? '' : `<button class="btn danger" type="button" data-act="del-staff" data-id="${s.id}">${ic('trash')}刪除</button><span class="spacer"></span>`}<button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="t_save">${isNew ? '建立人員' : '儲存變更'}</button>`);
  let color = v.color;
  $('#t_colors').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (!b) return; color = +b.dataset.color;
    [...$('#t_colors').children].forEach(x => { const on = +x.dataset.color === color; x.setAttribute('aria-pressed', on); x.style.outline = on ? `2px solid var(--c${color})` : ''; }); });
  $('#t_save').addEventListener('click', async () => {
    const name = $('#t_name').value.trim(); if (!name) { toast('請填寫姓名。', true); return; }
    const data = { ...clone(s), name, role: $('#t_role').value, title: $('#t_title').value.trim(), active: $('#t_active').value === '1', color };
    delete data.id;
    if (await save('staff', s.id, data)) { closeDialog(); toast(isNew ? `已新增 ${name}` : '人員資料已更新'); }
  });
}

/* ================= 對話框 / 提示 ================= */
let returnDrawer = null;
function openDialog(title, body, foot, wide) {
  ui.drawer = null; ui.menu = false; renderMenu();
  $('#overlay').innerHTML = `<div class="scrim center" data-scrim><div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="dialog-h"><h3>${esc(title)}</h3><button class="btn sm ghost" type="button" data-close aria-label="關閉">${ic('x', 16)}</button></div>
    <div class="dialog-b">${body}</div><div class="dialog-f">${foot}</div></div></div>`;
  const f = $('#overlay .dialog-b input, #overlay .dialog-b select'); if (f) setTimeout(() => f.focus(), 30);
}
function closeDialog() {
  $('#overlay').innerHTML = '';
  if (returnDrawer && S.clients.has(returnDrawer)) { ui.drawer = returnDrawer; renderDrawer(); }
  returnDrawer = null;
}
function confirmBox(title, msg, okLabel, onOk) {
  const keep = returnDrawer;
  openDialog(title, `<div class="field full"><p style="margin:0">${msg}</p></div>`, `<button class="btn" type="button" data-close>取消</button><button class="btn danger solid" type="button" id="cf_ok">${esc(okLabel)}</button>`);
  returnDrawer = keep;
  $('#cf_ok').addEventListener('click', async () => { $('#cf_ok').disabled = true; await onOk(); });
}
let tt;
function toast(msg, err) {
  clearTimeout(tt);
  $('#toastHost').innerHTML = `<div class="toast ${err ? 'err' : ''}" role="status">${esc(msg)}</div>`;
  tt = setTimeout(() => { $('#toastHost').innerHTML = ''; }, err ? 4200 : 3000);
}

/* ================= CSV 匯出 ================= */
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
async function exportCSV(filename, header, rows) {
  const text = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`已下載 ${filename}`);
}

/* ================= 帳號管理（管理員） ================= */
async function loadMembers() {
  const { data, error } = await sb.from('members').select('user_id,email,role,approved,created_at').order('created_at');
  if (error) { toast('讀取帳號名單失敗：' + error.message, true); ui.members = []; } else ui.members = data;
  if (ui.view === 'settings' && ui.setTab === 'members') renderBody();
}
async function updateMember(id, fields) {
  const { error } = await sb.from('members').update(fields).eq('user_id', id);
  if (error) { toast('更新失敗：' + error.message, true); return false; }
  await loadMembers(); return true;
}

/* ================= 事件 ================= */
document.addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#menuBtn')) { ui.menu = !ui.menu; renderMenu(); return; }
  if (t.closest('[data-closemenu]')) { ui.menu = false; renderMenu(); return; }
  const mt = t.closest('[data-mtab]'); if (mt) { ui.menuTab = mt.dataset.mtab; renderMenu(); return; }
  const ctg = t.closest('[data-ctag]'); if (ctg) { ui.ctag = ctg.dataset.ctag; ui.cpage = 1; ui.cmode = ui.cmode || 'card'; setView('clients'); return; }
  const cm = t.closest('[data-cmode]'); if (cm) { ui.cmode = cm.dataset.cmode; try { localStorage.setItem('clinic.cmode', ui.cmode); } catch (er) {} if (ui.view !== 'clients') setView('clients'); else { ui.menu = false; renderMenu(); renderShell(); } return; }
  const cp = t.closest('[data-cpage]'); if (cp) { ui.cpage = +cp.dataset.cpage; renderBody(); window.scrollTo({ top: $('#viewTitle').offsetTop - 20 }); return; }
  const nav = t.closest('[data-nav]'); if (nav) { setView(nav.dataset.nav); return; }
  const go = t.closest('[data-go]'); if (go) { setView(go.dataset.go); return; }
  if (t.closest('[data-close]')) { if (ui.drawer && t.closest('.drawer')) closeOverlay(); else closeDialog(); return; }
  if (t.matches('[data-scrim]')) { if (ui.drawer) closeOverlay(); else closeDialog(); return; }
  const dt = t.closest('[data-dtab]'); if (dt) { ui.drawerTab = dt.dataset.dtab; ui.tooth = null; renderDrawer(); return; }
  const dn = t.closest('[data-dent]'); if (dn) { ui.dentition = dn.dataset.dent; ui.tooth = null; renderDrawer(); return; }
  const th = t.closest('[data-tooth]'); if (th) {
    const c = get('clients', ui.drawer), n = th.dataset.tooth, cur = (c.teeth || {})[n] || {};
    ui.tooth = n; ui.toothDraft = { s: cur.s || 'ok', surf: [...(cur.surf || [])], note: cur.note || '' }; renderDrawer();
    const ed = $('#overlay .tooth-edit'); if (ed) ed.scrollIntoView({ block: 'nearest' });
    return;
  }
  const tst = t.closest('[data-tst]'); if (tst) { ui.toothDraft.s = tst.dataset.tst; if (['ok', 'missing', 'implant', 'crown'].includes(ui.toothDraft.s)) ui.toothDraft.surf = []; renderDrawer(); return; }
  const sf = t.closest('[data-surf]'); if (sf) { const k = sf.dataset.surf, a = ui.toothDraft.surf; ui.toothDraft.surf = a.includes(k) ? a.filter(x => x !== k) : [...a, k].sort((x, y) => 'MODBL'.indexOf(x) - 'MODBL'.indexOf(y)); renderDrawer(); return; }
  const sd = t.closest('[data-setday]'); if (sd) { ui.day = sd.dataset.setday; renderShell(); return; }
  const am = t.closest('[data-apmode]'); if (am) { ui.apMode = am.dataset.apmode; renderShell(); return; }
  const pt = t.closest('[data-postab]'); if (pt) { ui.posTab = pt.dataset.postab; renderBody(); return; }
  const stb = t.closest('[data-settab]'); if (stb) { ui.setTab = stb.dataset.settab; if (ui.setTab === 'members') ui.members = null; renderShell(); return; }
  const al = t.closest('[data-auth]'); if (al) { showAuth(al.dataset.auth); return; }
  const ai = t.closest('[data-additem]'); if (ai) {
    const it = posItems()[+ai.dataset.additem]; if (!it) return;
    const ex = ui.cart.find(l => l.refId === it.refId && l.type === it.type);
    if (ex) ex.qty++; else ui.cart.push({ ...it, qty: 1 });
    renderBody(); return;
  }
  const qb = t.closest('[data-qty]'); if (qb) { const l = ui.cart[+qb.dataset.qty]; l.qty = Math.max(1, l.qty + +qb.dataset.d); renderBody(); return; }
  const rl = t.closest('[data-rmline]'); if (rl) { ui.cart.splice(+rl.dataset.rmline, 1); renderBody(); return; }
  // 卡片內按鈕優先於整張卡片
  const a = t.closest('[data-act]');
  const oc = t.closest('[data-open-client]');
  if (oc && (!a || oc.contains(a) === false || a.contains(oc))) { e.preventDefault(); if (oc.dataset.openClient) openClient(oc.dataset.openClient, oc.dataset.tab); return; }
  if (!a) return;
  const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'new-client': clientForm(); break;
    case 'edit-client': returnDrawer = id; clientForm(get('clients', id)); break;
    case 'del-client': {
      const c = get('clients', id); const st = clientStats(id);
      confirmBox('刪除病患', `確定要刪除「${esc(c.name)}」（${esc(c.chartNo)}）嗎？${st.appts.length || st.orders.length ? `<br><span class="small muted">他的 ${st.appts.length} 筆預約與 ${st.orders.length} 筆消費紀錄會保留在報表中。</span>` : ''}`, '刪除病患', async () => {
        returnDrawer = null; if (await remove('clients', id)) { closeOverlay(); toast(`已刪除 ${c.name}`); } });
      break;
    }
    case 'new-appt': {
      if (!S.services.size) { toast('請先到「系統設定 → 療程價目」建立療程項目。', true); break; }
      if (ui.drawer) returnDrawer = ui.drawer;
      const preset = {};
      if (a.dataset.client) preset.clientId = a.dataset.client;
      if (a.dataset.svc && S.services.has(a.dataset.svc)) { preset.serviceId = a.dataset.svc; preset.duration = get('services', a.dataset.svc).duration; }
      if (a.dataset.staff !== undefined) preset.staffId = a.dataset.staff;
      if (a.dataset.time) preset.time = a.dataset.time;
      if (ui.view !== 'appts') preset.date = TODAY();
      apptForm({}, preset); break;
    }
    case 'edit-appt': if (ui.drawer) returnDrawer = ui.drawer; apptForm(get('appointments', id)); break;
    case 'del-appt': { const ap = get('appointments', id); confirmBox('刪除預約', `確定刪除 ${esc(ap.clientName)} 在 ${fmtD(ap.date)} ${esc(ap.time)} 的預約？若只是病患取消，建議把狀態改成「取消」以保留紀錄。`, '刪除預約', async () => { if (await remove('appointments', id)) { closeDialog(); toast('預約已刪除'); } }); break; }
    case 'ap-status': if (await patch('appointments', id, { status: a.dataset.st })) toast(`已報到：${get('appointments', id)?.clientName || ''}`); break;
    case 'ap-done': completeAppt(id); break;
    case 'done-nopkg': finishAppt(id, -1); break;
    case 'done-pkg': finishAppt(id, +a.dataset.i); break;
    case 'tooth-close': ui.tooth = null; renderDrawer(); break;
    case 'tooth-save': {
      const c = get('clients', id), n = ui.tooth, d = ui.toothDraft;
      const teeth = clone(c.teeth || {});
      teeth[n] = { s: d.s, surf: d.surf, note: (d.note || '').trim(), at: TODAY() };
      if (await patch('clients', id, { teeth })) { toast(`牙位 ${n} 已更新為「${TS[d.s]}」`); ui.tooth = null; renderDrawer(); }
      break;
    }
    case 'use-pkg': case 'undo-pkg': {
      const c = get('clients', id); const pk = clone(c.packages); const p = pk[+a.dataset.i];
      p.used = Math.max(0, Math.min(p.total, (p.used || 0) + (a.dataset.act === 'use-pkg' ? 1 : -1)));
      if (await patch('clients', id, { packages: pk })) toast(a.dataset.act === 'use-pkg' ? `已扣 1 次，剩 ${p.total - p.used} 次` : '已補回 1 次');
      break;
    }
    case 'add-pkg': {
      const c = get('clients', id);
      openDialog('手動新增療程計畫', `<div class="field full"><label for="k_svc">療程</label><select class="input" id="k_svc">${serviceOpts('')}</select></div><div class="field"><label for="k_n">總次數</label><input class="input en" id="k_n" type="number" min="1" value="12"></div><div class="field"><label for="k_used">已完成</label><input class="input en" id="k_used" type="number" min="0" value="0"></div><div class="field full"><span class="hint">用於補登紙本時期開始的療程（例如矯正已進行半年）；不會產生消費紀錄。新的療程計畫請走「櫃檯結帳」。</span></div>`,
        `<button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="k_save">新增</button>`);
      returnDrawer = id;
      $('#k_save').addEventListener('click', async () => { const s = get('services', $('#k_svc').value); const n = +$('#k_n').value || 0; if (!s || n <= 0) { toast('請選擇療程並輸入次數。', true); return; }
        const pk = clone(c.packages || []); pk.push({ serviceId: s.id, name: `${s.name}（${n} 次療程）`, total: n, used: Math.min(n, +$('#k_used').value || 0), boughtAt: TODAY(), expires: addDays(TODAY(), 730) });
        if (await patch('clients', id, { packages: pk })) { closeDialog(); toast('療程計畫已新增'); } });
      break;
    }
    case 'pos-client': ui.cartClient = id; closeOverlay(); setView('pos'); break;
    case 'cart-clear': ui.cart = []; ui.cartDiscount = 0; renderBody(); break;
    case 'checkout': a.disabled = true; await checkout(); break;
    case 'day': ui.day = addDays(ui.day, +a.dataset.n); renderShell(); break;
    case 'today': ui.day = TODAY(); renderShell(); break;
    case 'rmonth': ui.rMonth = shiftMonth(ui.rMonth, +a.dataset.n); renderShell(); break;
    case 'new-product': productForm(); break;
    case 'edit-product': productForm(get('products', id)); break;
    case 'del-product': { const p = get('products', id); confirmBox('刪除品項', `確定刪除「${esc(p.name)}」？過去的銷售紀錄會保留。`, '刪除品項', async () => { if (await remove('products', id)) { closeDialog(); toast('品項已刪除'); } }); break; }
    case 'restock': restockForm(get('products', id)); break;
    case 'new-service': serviceForm(); break;
    case 'edit-service': serviceForm(get('services', id)); break;
    case 'del-service': { const s = get('services', id); confirmBox('刪除療程', `確定刪除「${esc(s.name)}」？已建立的預約與療程計畫不受影響。若只是暫停提供，可改為「停用」。`, '刪除療程', async () => { if (await remove('services', id)) { closeDialog(); toast('療程已刪除'); } }); break; }
    case 'new-staff': staffForm(); break;
    case 'edit-staff': staffForm(get('staff', id)); break;
    case 'del-staff': { const s = get('staff', id); confirmBox('刪除人員', `確定刪除「${esc(s.name)}」？若是離職，建議改為「離職 / 停用」以保留業績紀錄。`, '刪除人員', async () => { if (await remove('staff', id)) { closeDialog(); toast('人員已刪除'); } }); break; }
    case 'save-settings': {
      const data = { ...clone(S.settings), name: $('#s_name').value.trim(), phone: $('#s_phone').value.trim(), hours: $('#s_hours').value.trim(), address: $('#s_addr').value.trim(), remindDays: +$('#s_remind').value || 14 };
      if (await saveSettings(data)) toast('設定已儲存');
      break;
    }
    case 'clear-samples': {
      const list = COLS.flatMap(c => all(c).filter(d => d.sample).map(d => [c, d.id]));
      confirmBox('清除範例資料', `將刪除 ${list.length} 筆範例資料，你自己建立的資料會保留。這個動作無法復原。`, '確認清除', async () => {
        let n = 0; for (const [c, did] of list) { if (await remove(c, did)) n++; else break; }
        if (S.settings.sample) await saveSettings({ remindDays: S.settings.remindDays || 14 });
        closeDialog(); toast(`已清除 ${n} 筆範例資料`);
      });
      break;
    }
    case 'logout': ui.menu = false; renderMenu(); await sb.auth.signOut(); break;
    case 'reload': location.reload(); break;
    case 'member-approve': if (await updateMember(id, { approved: a.dataset.v === '1' })) toast(a.dataset.v === '1' ? '已核准，對方重新整理頁面後即可使用' : '已停用這個帳號'); break;
    case 'member-remove': {
      const m = (ui.members || []).find(x => x.user_id === id);
      confirmBox('移除帳號', `確定要移除「${esc(m ? m.email : '')}」？對方將無法再看到任何病患資料。登入帳號本身仍存在，若要完全刪除請到 Supabase 後台。`, '移除', async () => {
        const { error } = await sb.from('members').delete().eq('user_id', id);
        closeDialog(); if (error) toast('移除失敗：' + error.message, true); else { toast('已移除帳號'); loadMembers(); }
      });
      break;
    }
    case 'export-clients': exportCSV(`病患名單_${TODAY()}.csv`, ['病歷號', '姓名', '性別', '生日', '手機', 'LINE', 'Email', '來源', '等級', '標籤', '過敏', '全身病史', '建議回診日', '回診原因', '剩餘療程次數', '累積消費', '最近就診', '建檔日'],
      all('clients').sort((x, y) => (x.chartNo || '').localeCompare(y.chartNo || '')).map(c => { const st = clientStats(c.id); return [c.chartNo, c.name, c.gender, c.birthday, c.phone, c.line, c.email, c.source, c.level, (c.tags || []).join('、'), c.allergies, c.medical, c.nextFollowUp, c.followUpReason, pkgLeft(c), st.spent, st.last, c.createdAt]; })); break;
    case 'export-orders': exportCSV(`銷售明細_${TODAY()}.csv`, ['單號', '日期', '病患', '品項', '數量', '單價', '小計', '折扣', '實收', '付款方式', '經手人員'],
      all('orders').sort((x, y) => (x.no || '').localeCompare(y.no || '')).flatMap(o => (o.items || []).map((i, k) => [o.no, o.date, o.clientName, i.name, i.qty, i.price, k ? '' : o.subtotal, k ? '' : o.discount, k ? '' : o.total, o.payMethod, get('staff', o.staffId)?.name || ''])) ); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (ui.menu) { ui.menu = false; renderMenu(); } else if ($('#overlay').innerHTML) { if (ui.drawer) closeOverlay(); else closeDialog(); } }
  if (e.key === 'Enter' && e.target.matches('[data-open-client][tabindex]')) openClient(e.target.dataset.openClient);
  if (e.key === 'Enter' && e.target.matches('.card[data-act][tabindex]')) e.target.click();
});
let inputT;
document.addEventListener('input', e => {
  const t = e.target;
  const deb = fn => { clearTimeout(inputT); inputT = setTimeout(fn, 160); };
  if (t.id === 'cq') { ui.cq = t.value; ui.cpage = 1; deb(renderBody); }
  if (t.id === 'sq') { ui.sq = t.value; deb(renderBody); }
  if (t.id === 'posQ') { ui.posQ = t.value; deb(() => { renderBody(); const el = $('#posQ'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }
  if (t.id === 'cartDiscount') { ui.cartDiscount = +t.value || 0; deb(() => { renderBody(); const el = $('#cartDiscount'); if (el) el.focus(); }); }
  if (t.id === 'cartNote') ui.cartNote = t.value;
  if (t.id === 'tooth_note' && ui.toothDraft) ui.toothDraft.note = t.value;
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'clv') { ui.clv = t.value; ui.cpage = 1; renderBody(); }
  if (t.id === 'csort') { ui.csort = t.value; renderBody(); }
  if (t.id === 'scat') { ui.scat = t.value; renderBody(); }
  if (t.id === 'dayPick' && t.value) { ui.day = t.value; renderShell(); }
  if (t.id === 'rMonth' && t.value) { ui.rMonth = t.value; renderShell(); }
  if (t.id === 'cartClient') { ui.cartClient = t.value; renderBody(); }
  if (t.id === 'cartPay') { ui.cartPay = t.value; renderBody(); }
  if (t.id === 'cartStaff') ui.cartStaff = t.value;
  if (t.dataset.mrole) updateMember(t.dataset.mrole, { role: t.value }).then(ok => ok && toast('已更新身分'));
});

/* ================= 登入 ================= */
const AUTH = {
  login: { title: '登入', sub: '請使用診所人員帳號登入', btn: '登入', pass: true, pass2: false, links: [['signup', '建立帳號'], ['forgot', '忘記密碼']] },
  signup: { title: '建立帳號', sub: '第一位註冊的帳號會成為管理員；之後註冊的同事需要管理員核准', btn: '建立帳號', pass: true, pass2: true, links: [['login', '已經有帳號？登入']] },
  forgot: { title: '重設密碼', sub: '輸入註冊時的 Email，我們會寄出重設密碼的連結', btn: '寄出重設連結', pass: false, pass2: false, links: [['login', '返回登入']] },
  reset: { title: '設定新密碼', sub: '請輸入新的密碼（至少 8 個字元）', btn: '更新密碼', pass: true, pass2: true, email: false, links: [] },
  pending: { title: '等待核准', sub: '', btn: '登出', pass: false, pass2: false, email: false, links: [] }
};
let authMode = 'login';
function lockUI(locked) {
  document.body.classList.toggle('locked', locked);
  $('#appView').hidden = locked; $('#authView').hidden = !locked;
  if (locked) { ui.menu = false; renderMenu(); closeOverlay(); }
}
function showAuth(m, msg, ok) {
  authMode = m; const A = AUTH[m];
  lockUI(true);
  $('#authTitle').textContent = A.title;
  $('#authSub').textContent = m === 'pending' ? `你的帳號（${me ? me.email : ''}）已建立，等待診所管理員核准後就能使用。核准後請重新整理此頁。` : A.sub;
  $('#authEmailRow').hidden = A.email === false;
  $('#authPassRow').hidden = !A.pass;
  $('#authPass2Row').hidden = !A.pass2;
  $('#authPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#authSubmit').textContent = A.btn;
  $('#authLinks').innerHTML = A.links.map(([k, l]) => `<button type="button" data-auth="${k}">${l}</button>`).join('');
  const box = $('#authMsg'); box.textContent = msg || ''; box.classList.toggle('ok', !!ok);
  $('#brandName').textContent = '牙醫診所管理系統';
}
const AUTH_ERR = [
  [/Invalid login credentials/i, 'Email 或密碼錯誤。'],
  [/Email not confirmed/i, '這個 Email 還沒完成驗證，請先到信箱點確認連結。'],
  [/User already registered/i, '這個 Email 已經註冊過了，請直接登入。'],
  [/Password should be at least/i, '密碼至少需要 8 個字元。'],
  [/rate limit|too many/i, '操作太頻繁，請稍候一分鐘再試。'],
  [/valid email|invalid format/i, 'Email 格式不正確。'],
  [/Failed to fetch|NetworkError/i, '無法連線，請確認網路後再試一次。']
];
const authErr = e => { const m = (e && e.message) || String(e); const hit = AUTH_ERR.find(([r]) => r.test(m)); return hit ? hit[1] : `發生錯誤：${m}`; };
const backUrl = () => location.origin + location.pathname;
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value, pass2 = $('#authPass2').value;
  const btn = $('#authSubmit'), say = (m, ok) => { $('#authMsg').textContent = m; $('#authMsg').classList.toggle('ok', !!ok); };
  if (authMode === 'pending') { await sb.auth.signOut(); return; }
  if (AUTH[authMode].email !== false && !email) { say('請輸入 Email。'); return; }
  if (AUTH[authMode].pass && pass.length < 8) { say('密碼至少需要 8 個字元。'); return; }
  if (AUTH[authMode].pass2 && pass !== pass2) { say('兩次輸入的密碼不一樣。'); return; }
  btn.disabled = true;
  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } else if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: backUrl() } });
      if (error) throw error;
      if (!data.session) { showAuth('login', '帳號已建立。請到信箱點選確認連結，完成後回到這裡登入。', true); $('#authEmail').value = email; }
    } else if (authMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: backUrl() });
      if (error) throw error;
      say('如果這個 Email 有註冊，重設密碼的信已經寄出，請到信箱查看。', true);
    } else if (authMode === 'reset') {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      toast('密碼已更新');
      const { data } = await sb.auth.getSession(); if (data.session) await enter(data.session);
    }
  } catch (err) { say(authErr(err)); }
  finally { btn.disabled = false; $('#authPass').value = ''; $('#authPass2').value = ''; }
});

/* ================= 啟動 ================= */
let entering = null;
async function enter(session) {
  if (!session) return;
  if (entering) return entering;
  entering = (async () => {
    const { data: m, error } = await sb.from('members').select('user_id,email,role,approved').eq('user_id', session.user.id).maybeSingle();
    if (error) { showAuth('login', authErr(error)); return; }
    me = m || { user_id: session.user.id, email: session.user.email, role: 'staff', approved: false };
    if (!me.approved) { showAuth('pending'); return; }
    canWrite = true; lockUI(false);
    mode = 'connecting'; loaded.clear(); renderShell();
    try { await loadAll(); mode = 'live'; subscribe(); }
    catch (e) { mode = 'error'; COLS.forEach(c => loaded.add(c)); }
    renderShell();
  })();
  try { await entering; } finally { entering = null; }
}
function signedOut() {
  me = null; if (channel) { sb.removeChannel(channel); channel = null; }
  COLS.forEach(c => { S[c] = new Map(); }); S.settings = {}; loaded.clear();
  Object.assign(ui, { cart: [], cartClient: '', members: null, drawer: null });
  showAuth('login');
}
(async () => {
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) {
    showAuth('login', '無法載入資料庫連線元件，請確認網路連線，或檢查 js/config.js 的設定。');
    $('#authSubmit').disabled = true; return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { showAuth('reset'); return; }
    if (event === 'SIGNED_OUT') { signedOut(); return; }
    if (event === 'SIGNED_IN' && authMode !== 'reset' && !me) setTimeout(() => enter(session), 0);
  });
  const { data } = await sb.auth.getSession();
  if (location.hash.includes('type=recovery')) { showAuth('reset'); return; }
  if (data.session) await enter(data.session); else showAuth('login');
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', backUrl());
})();
})();
