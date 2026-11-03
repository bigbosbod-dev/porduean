'use strict';

// =====================================================================
// พอเดือน: บอกว่าวันนี้ใช้เงินได้อีกกี่บาท ถึงจะอยู่รอดถึงวันเงินเข้ารอบหน้า
//
// วิธีคิด (ต่อ "รอบ" = ตั้งแต่วันเงินเข้า ถึงวันก่อนเงินเข้ารอบถัดไป)
//   งบใช้จ่าย   = เงินต่อเดือน + รายรับเพิ่มในรอบ − ค่าใช้จ่ายประจำ − เงินเก็บ
//   งบวันนี้     = (งบใช้จ่าย − ที่ใช้ไปแล้วในวันอื่นของรอบ) ÷ จำนวนวันที่เหลือ (รวมวันนี้)
//   วันนี้ใช้ได้อีก = งบวันนี้ − ที่ใช้ไปแล้ววันนี้
// ถ้าวันนี้ใช้น้อย เงินที่เหลือจะถูกเกลี่ยไปให้วันถัด ๆ ไปเอง
//
// ข้อมูลเก็บใน localStorage โดยคีย์ขึ้นต้นด้วย pd_ ทั้งหมด
// (เว็บนี้อยู่โดเมนเดียวกับ StudyFlow จึงต้องไม่ใช้ชื่อคีย์ซ้ำกัน)
// =====================================================================
const KEYS = { data: 'pd_data', theme: 'pd_theme', tab: 'pd_tab' };

const CATS = [
  { id: 'food', label: 'อาหาร', emoji: '🍜', color: '#f97316' },
  { id: 'travel', label: 'เดินทาง', emoji: '🛵', color: '#0ea5e9' },
  { id: 'shop', label: 'ของใช้', emoji: '🧴', color: '#8b5cf6' },
  { id: 'fun', label: 'บันเทิง', emoji: '🎮', color: '#ec4899' },
  { id: 'study', label: 'การเรียน', emoji: '📚', color: '#6366f1' },
  { id: 'other', label: 'อื่น ๆ', emoji: '📦', color: '#64748b' },
];
const INCOME_CAT = { id: 'income', label: 'รายรับเพิ่ม', emoji: '💰', color: '#059669' };
const catOf = (t) => (t.type === 'income' ? INCOME_CAT : CATS.find((c) => c.id === t.cat) || CATS[CATS.length - 1]);

const $ = (id) => document.getElementById(id);

// ---------- Storage ----------
function getStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function setStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('บันทึกไม่สำเร็จ (พื้นที่ในเบราว์เซอร์เต็ม หรือเปิดโหมดส่วนตัวอยู่)', 'error'); }
}

const num = (v, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.round(n * 100) / 100 : null;
};
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function sanitize(d) {
  const s = (d && d.settings) || {};
  const payday = Math.min(31, Math.max(1, Math.floor(Number(s.payday)) || 1));
  return {
    settings: {
      income: num(s.income),
      payday,
      saving: num(s.saving) || 0,
      // เตือนเมื่อใช้ถึงกี่ % ของงบวันนี้ (0 = ไม่เตือน)
      warnPct: [0, 70, 80, 90].includes(s.warnPct) ? s.warnPct : 80,
      fixed: (Array.isArray(s.fixed) ? s.fixed : [])
        .filter((f) => f && typeof f.name === 'string' && num(f.amount) !== null)
        .map((f) => ({ id: typeof f.id === 'string' ? f.id : uid(), name: f.name.slice(0, 40), amount: num(f.amount) })),
    },
    txns: (Array.isArray(d && d.txns) ? d.txns : [])
      .filter((t) => t && isYmd(t.date) && num(t.amount) !== null && num(t.amount) > 0)
      .map((t) => ({
        id: typeof t.id === 'string' ? t.id : uid(),
        type: t.type === 'income' ? 'income' : 'expense',
        amount: num(t.amount),
        cat: CATS.some((c) => c.id === t.cat) ? t.cat : 'other',
        note: typeof t.note === 'string' ? t.note.slice(0, 60) : '',
        date: t.date,
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
      })),
  };
}

let data = sanitize(getStorage(KEYS.data, {}));
const save = () => setStorage(KEYS.data, data);

// ---------- Dates ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dayDiff = (a, b) => Math.round((b - a) / 86400000);
const todayDate = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

// วันเงินเข้าของเดือนนั้น (ถ้าตั้งไว้วันที่ 31 แต่เดือนนั้นมี 30 วัน ก็ใช้วันสุดท้ายของเดือน)
const paydayIn = (y, m, payday) => new Date(y, m, Math.min(payday, daysInMonth(y, m)));

function cycleAt(offset = 0) {
  const p = data.settings.payday;
  const t = todayDate();
  let y = t.getFullYear();
  let m = t.getMonth();
  if (t < paydayIn(y, m, p)) m -= 1;
  m += offset;
  const start = paydayIn(y, m, p); // Date จัดการเดือนติดลบ/เกิน 11 ให้เอง
  const next = paydayIn(start.getFullYear(), start.getMonth() + 1, p);
  const end = addDays(next, -1);
  return { start, end, startStr: ymd(start), endStr: ymd(end), days: dayDiff(start, end) + 1 };
}

const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => d.toLocaleDateString('th-TH', opts);
function fmtMoney(n, { sign = false } = {}) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('th-TH', { maximumFractionDigits: abs % 1 ? 2 : 0 });
  return `${n < 0 ? '−' : sign ? '+' : ''}฿${s}`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- คำนวณ ----------
const fixedTotal = () => data.settings.fixed.reduce((s, f) => s + f.amount, 0);
const inCycle = (c) => data.txns.filter((t) => t.date >= c.startStr && t.date <= c.endStr);
const sum = (arr) => arr.reduce((s, t) => s + t.amount, 0);

function cycleSummary(c) {
  const txns = inCycle(c);
  const extra = sum(txns.filter((t) => t.type === 'income'));
  const expenses = txns.filter((t) => t.type === 'expense');
  const budget = (data.settings.income || 0) + extra - fixedTotal() - data.settings.saving;
  return { txns, expenses, extra, budget, spent: sum(expenses) };
}

function todayNumbers() {
  const c = cycleAt(0);
  const today = ymd(todayDate());
  const s = cycleSummary(c);
  const spentToday = sum(s.expenses.filter((t) => t.date === today));
  const spentOther = s.spent - spentToday;
  const daysLeft = dayDiff(todayDate(), c.end) + 1;
  // ยอดที่ "ใช้ได้" ปัดลงเป็นบาทเต็ม จะได้ไม่เผลอใช้เกิน
  const daily = Math.floor((s.budget - spentOther) / daysLeft);
  const remaining = s.budget - s.spent;
  return {
    c, s, today, spentToday, daysLeft, daily, remaining,
    left: daily - spentToday,
    tomorrow: daysLeft > 1 ? Math.floor(remaining / (daysLeft - 1)) : null,
    perDayPlan: s.budget / c.days,
  };
}

// สถานะของวันนี้: ok = ปกติ, near = ใช้ถึงเกณฑ์เตือนแล้ว, over = เกินงบวันนี้
function todayState(spent, daily) {
  if (spent > daily) return 'over';
  const w = data.settings.warnPct;
  if (w && spent > 0 && (daily <= 0 || spent >= (daily * w) / 100)) return 'near';
  return 'ok';
}

// ---------- Render ----------
function txnRow(t, { showDate = false } = {}) {
  const c = catOf(t);
  const title = t.note || c.label;
  const sub = [showDate ? fmtDate(parseYmd(t.date), { weekday: 'short', day: 'numeric', month: 'short' }) : '', t.note ? c.label : ''].filter(Boolean).join(' · ');
  return `<button class="row-btn" onclick="openSheet('${t.id}')">
    <span class="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-lg" style="background:${c.color}1f">${c.emoji}</span>
    <span class="flex-1 min-w-0">
      <span class="block truncate heading text-sm font-medium">${escapeHtml(title)}</span>
      ${sub ? `<span class="block text-xs muted truncate">${escapeHtml(sub)}</span>` : ''}
    </span>
    <span class="font-semibold text-sm ${t.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'heading'}">${fmtMoney(t.type === 'income' ? t.amount : -t.amount, { sign: true })}</span>
  </button>`;
}

const sortTxns = (arr) => [...arr].sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));

function renderHome() {
  const ready = data.settings.income !== null;
  $('setup-card').classList.toggle('hidden', ready);
  ['today-card', 'stats-grid', 'month-card', 'today-list-card'].forEach((id) => $(id).classList.toggle('hidden', !ready));
  updateFab();
  if (!ready) {
    $('header-cycle').textContent = '';
    return;
  }

  const n = todayNumbers();
  $('header-cycle').textContent = `รอบ ${fmtDate(n.c.start)} – ${fmtDate(n.c.end)}`;

  const over = n.left < 0;
  const state = todayState(n.spentToday, n.daily);
  $('today-card').dataset.state = state;
  $('today-label').textContent = over ? 'วันนี้ใช้เกินงบไปแล้ว' : state === 'near' ? '⚠️ ใกล้หมดงบวันนี้แล้ว เหลืออีก' : 'วันนี้ใช้ได้อีก';
  $('today-amount').textContent = fmtMoney(Math.abs(n.left));

  let sub;
  if (n.remaining < 0) sub = `⚠️ ใช้เกินงบทั้งรอบไปแล้ว ${fmtMoney(-n.remaining)} ลองลดรายจ่ายหรือดึงเงินเก็บมาใช้`;
  else if (n.tomorrow === null) sub = 'วันสุดท้ายของรอบแล้ว พรุ่งนี้เงินเข้า 🎉';
  else if (over) sub = `พรุ่งนี้จะเหลือใช้ได้ ${fmtMoney(n.tomorrow)} (ลดลงจากเดิม)`;
  else sub = `ถ้าวันนี้ไม่ใช้เพิ่ม พรุ่งนี้จะใช้ได้ ${fmtMoney(n.tomorrow)}`;
  $('today-sub').textContent = sub;

  const limit = Math.max(n.daily, 0);
  $('today-bar').style.width = `${limit > 0 ? Math.min(100, (n.spentToday / limit) * 100) : n.spentToday > 0 ? 100 : 0}%`;
  $('today-spent').textContent = `ใช้ไป ${fmtMoney(n.spentToday)}`;
  $('today-limit').textContent = `งบวันนี้ ${fmtMoney(n.daily)}`;

  $('stat-remaining').textContent = fmtMoney(n.remaining);
  $('stat-remaining').classList.toggle('text-rose-600', n.remaining < 0);
  $('stat-spent').textContent = fmtMoney(n.s.spent);
  $('stat-days').textContent = `${n.daysLeft} วัน`;

  $('month-budget').textContent = fmtMoney(n.s.budget);
  const pctSpent = n.s.budget > 0 ? (n.s.spent / n.s.budget) * 100 : 100;
  const pctTime = ((n.c.days - n.daysLeft + 1) / n.c.days) * 100;
  const bar = $('month-bar');
  bar.style.width = `${Math.min(100, pctSpent)}%`;
  bar.classList.toggle('bg-emerald-500', pctSpent <= pctTime);
  bar.classList.toggle('bg-amber-500', pctSpent > pctTime && pctSpent <= 100);
  bar.classList.toggle('bg-rose-500', pctSpent > 100);
  const parts = [`ใช้ไป ${Math.round(pctSpent)}% ของงบ ผ่านไป ${Math.round(pctTime)}% ของรอบ`];
  if (fixedTotal() || data.settings.saving) parts.push(`(หักค่าใช้จ่ายประจำ ${fmtMoney(fixedTotal())} และเงินเก็บ ${fmtMoney(data.settings.saving)} แล้ว)`);
  if (n.s.budget <= 0) parts.unshift('⚠️ ค่าใช้จ่ายประจำ + เงินเก็บ มากกว่ารายรับ ลองปรับในแท็บตั้งค่า');
  $('month-note').textContent = parts.join(' ');

  const todays = sortTxns(n.s.txns.filter((t) => t.date === n.today));
  $('today-count').textContent = todays.length ? `${todays.length} รายการ` : '';
  $('today-list').innerHTML = todays.length
    ? todays.map((t) => txnRow(t)).join('')
    : '<p class="text-sm muted px-3 py-4 text-center">ยังไม่ได้จดรายการวันนี้ กดปุ่ม "จดรายการ" ด้านล่างได้เลย</p>';
}

let histOffset = 0;
function shiftCycle(d) {
  histOffset = Math.min(0, histOffset + d);
  renderHistory();
}

function renderHistory() {
  const c = cycleAt(histOffset);
  const s = cycleSummary(c);
  $('hist-label').textContent = histOffset === 0 ? 'รอบปัจจุบัน' : fmtDate(c.start, { month: 'long', year: 'numeric' });
  $('hist-range').textContent = `${fmtDate(c.start)} – ${fmtDate(c.end, { day: 'numeric', month: 'short', year: '2-digit' })}`;
  $('hist-next').disabled = histOffset === 0;
  $('hist-next').classList.toggle('opacity-30', histOffset === 0);

  const left = s.budget - s.spent;
  $('hist-budget').textContent = fmtMoney(s.budget);
  $('hist-spent').textContent = fmtMoney(s.spent);
  $('hist-left-label').textContent = left < 0 ? 'เกินงบ' : 'เหลือ';
  $('hist-left').textContent = fmtMoney(Math.abs(left));
  $('hist-left').className = `font-semibold mt-0.5 ${left < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`;

  renderChart(c, s);

  const byCat = CATS.map((cat) => ({ cat, total: sum(s.expenses.filter((t) => t.cat === cat.id)) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  $('hist-cats').innerHTML = byCat.length
    ? byCat.map(({ cat, total }) => {
      const pct = (total / s.spent) * 100;
      return `<div>
        <div class="flex justify-between text-sm mb-1">
          <span>${cat.emoji} ${cat.label}</span>
          <span class="heading font-medium">${fmtMoney(total)} <span class="muted font-normal text-xs">${Math.round(pct)}%</span></span>
        </div>
        <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full" style="width:${pct}%;background:${cat.color}"></div>
        </div>
      </div>`;
    }).join('')
    : '<p class="text-sm muted text-center py-2">ยังไม่มีรายจ่ายในรอบนี้</p>';

  const groups = {};
  sortTxns(s.txns).forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
  const dates = Object.keys(groups);
  $('hist-list').innerHTML = dates.length
    ? dates.map((d) => {
      const dayOut = sum(groups[d].filter((t) => t.type === 'expense'));
      return `<div class="mt-1">
        <div class="flex justify-between px-3 pt-2 pb-1 text-xs muted">
          <span>${fmtDate(parseYmd(d), { weekday: 'long', day: 'numeric', month: 'short' })}</span>
          <span>${dayOut ? `ใช้ ${fmtMoney(dayOut)}` : ''}</span>
        </div>
        ${groups[d].map((t) => txnRow(t)).join('')}
      </div>`;
    }).join('')
    : '<p class="text-sm muted px-3 py-4 text-center">ไม่มีรายการ</p>';
}

// ---------- กราฟรายจ่ายรายวัน ----------
// แท่งละวัน เทียบกับเส้น "งบต่อวัน" (งบทั้งรอบ ÷ จำนวนวันในรอบ) วันที่เกินเส้นเป็นสีส้ม
// แตะ/ชี้ที่แท่งเพื่อดูยอดของวันนั้น
let chartDays = [];
let chartPlan = 0;

function renderChart(c, s) {
  const today = ymd(todayDate());
  const byDate = {};
  s.expenses.forEach((t) => { byDate[t.date] = (byDate[t.date] || 0) + t.amount; });
  chartPlan = Math.max(0, s.budget / c.days);
  chartDays = Array.from({ length: c.days }, (_, i) => {
    const d = addDays(c.start, i);
    const key = ymd(d);
    return { d, key, total: byDate[key] || 0, future: key > today };
  });

  const W = 340; const H = 150; const top = 14; const bottom = 20; const left = 2; const right = 2;
  const plotH = H - top - bottom;
  const maxV = Math.max(chartPlan, ...chartDays.map((x) => x.total), 1) * 1.08;
  const y = (v) => top + plotH - (v / maxV) * plotH;
  const slot = (W - left - right) / c.days;
  const barW = Math.max(2, slot - 2); // ช่องว่าง 2px ระหว่างแท่ง
  const r = Math.min(4, barW / 2);

  const bars = chartDays.map((x, i) => {
    if (!x.total) return '';
    const bx = left + i * slot + (slot - barW) / 2;
    const by = y(x.total);
    const h = top + plotH - by;
    const rr = Math.min(r, h);
    const color = chartPlan > 0 && x.total > chartPlan ? 'var(--bar-over)' : 'var(--bar-ok)';
    // มุมโค้งเฉพาะด้านบน ด้านล่างแนบเส้นฐาน
    return `<path d="M${bx},${top + plotH} V${by + rr} Q${bx},${by} ${bx + rr},${by} H${bx + barW - rr} Q${bx + barW},${by} ${bx + barW},${by + rr} V${top + plotH} Z" fill="${color}" />`;
  }).join('');

  // ป้ายวันที่ใต้แกน: วันแรก ทุก 7 วัน และวันสุดท้าย
  const labels = chartDays.map((x, i) => {
    if (!(i === 0 || i === c.days - 1 || (i % 7 === 0 && c.days - 1 - i >= 3))) return '';
    const cx = left + i * slot + slot / 2;
    const anchor = i === 0 ? 'start' : i === c.days - 1 ? 'end' : 'middle';
    const tx = i === 0 ? left : i === c.days - 1 ? W - right : cx;
    return `<text x="${tx}" y="${H - 5}" text-anchor="${anchor}" class="fill-slate-500 dark:fill-slate-400" font-size="10">${x.d.getDate()}</text>`;
  }).join('');

  const todayIdx = chartDays.findIndex((x) => x.key === today);
  const todayMark = todayIdx >= 0
    ? `<circle cx="${left + todayIdx * slot + slot / 2}" cy="${top + plotH + 4}" r="2" class="fill-slate-500 dark:fill-slate-400" />`
    : '';

  const planY = y(chartPlan);
  const planLine = chartPlan > 0
    ? `<line x1="${left}" x2="${W - right}" y1="${planY}" y2="${planY}" stroke="var(--axis)" stroke-width="1.5" stroke-dasharray="4 3" />
       <text x="${W - right}" y="${planY - 4}" text-anchor="end" font-size="10" class="fill-slate-500 dark:fill-slate-400">งบต่อวัน ${fmtMoney(Math.floor(chartPlan))}</text>`
    : '';

  // พื้นที่แตะใหญ่กว่าแท่ง (เต็มความสูง)
  const hits = chartDays.map((x, i) => `<rect x="${left + i * slot}" y="0" width="${slot}" height="${H}" fill="transparent" data-i="${i}" />`).join('');
  const hl = `<rect id="chart-hl" x="0" y="${top}" width="${slot}" height="${plotH}" rx="3" class="fill-slate-400/15" visibility="hidden" />`;

  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto overflow-visible" role="img" aria-label="กราฟรายจ่ายรายวันของรอบนี้">
    ${hl}
    <line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" stroke="var(--grid)" stroke-width="1" />
    ${bars}${planLine}${labels}${todayMark}
    <g id="chart-hits">${hits}</g>
  </svg>`;

  const past = chartDays.filter((x) => !x.future);
  const spentDays = past.length || 1;
  const overDays = past.filter((x) => chartPlan > 0 && x.total > chartPlan).length;
  $('chart-avg').textContent = s.spent ? `เฉลี่ย ${fmtMoney(Math.round(s.spent / spentDays))}/วัน` : '';
  chartDefaultInfo = s.spent
    ? (overDays ? `เกินงบต่อวัน ${overDays} วัน จาก ${past.length} วัน` : `ยังไม่มีวันไหนเกินงบต่อวัน 👍`)
    : 'ยังไม่มีรายจ่ายในรอบนี้';
  showChartInfo(-1);

  const g = $('chart-hits');
  const pick = (ev) => {
    const el = ev.target.closest('[data-i]');
    if (el) showChartInfo(Number(el.dataset.i));
  };
  g.addEventListener('pointerenter', pick, true);
  g.addEventListener('pointerdown', pick);
  g.addEventListener('pointermove', pick);
  $('chart').querySelector('svg').addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') showChartInfo(-1); });
}

let chartDefaultInfo = '';
function showChartInfo(i) {
  const hl = $('chart-hl');
  const x = chartDays[i];
  if (!x) {
    if (hl) hl.setAttribute('visibility', 'hidden');
    $('chart-info').innerHTML = `<span class="muted">${escapeHtml(chartDefaultInfo)}</span>`;
    return;
  }
  const slot = Number($('chart-hits').firstElementChild.getAttribute('width'));
  hl.setAttribute('x', i * slot + 2);
  hl.setAttribute('visibility', 'visible');
  const date = fmtDate(x.d, { weekday: 'short', day: 'numeric', month: 'short' });
  let note = '';
  if (x.future) note = '<span class="muted">ยังไม่ถึงวันนี้</span>';
  else if (chartPlan > 0 && x.total > chartPlan) note = `<span class="text-orange-600 dark:text-orange-400">เกินงบต่อวัน ${fmtMoney(Math.ceil(x.total - chartPlan))}</span>`;
  else if (x.total) note = '<span class="muted">ไม่เกินงบต่อวัน</span>';
  $('chart-info').innerHTML = `${date} · <b>${x.total ? `ใช้ ${fmtMoney(x.total)}` : 'ไม่ได้ใช้เงิน'}</b> ${note}`;
}

function paydayOptions(sel) {
  sel.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}${i === 30 ? ' (หรือวันสุดท้ายของเดือน)' : ''}</option>`).join('');
}

function renderSettings() {
  const st = data.settings;
  $('set-income').value = st.income ?? '';
  $('set-payday').value = String(st.payday);
  $('set-saving').value = st.saving || '';
  $('set-warn').value = String(st.warnPct);
  $('fixed-total').textContent = st.fixed.length ? `รวม ${fmtMoney(fixedTotal())}/เดือน` : '';
  $('fixed-list').innerHTML = st.fixed.length
    ? st.fixed.map((f) => `<div class="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl pl-3 pr-1 py-1">
        <span class="flex-1 text-sm heading truncate">${escapeHtml(f.name)}</span>
        <span class="text-sm font-medium heading">${fmtMoney(f.amount)}</span>
        <button class="icon-btn" onclick="removeFixed('${f.id}')" aria-label="ลบ ${escapeHtml(f.name)}"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>`).join('')
    : '<p class="text-sm muted">ยังไม่มี</p>';
  const theme = getStorage(KEYS.theme, 'system');
  document.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === theme));
  refreshIcons();
}

function renderAll() {
  renderHome();
  renderHistory();
  renderSettings();
  refreshIcons();
}

function refreshIcons() {
  if (!window.lucide) return;
  window.lucide.createIcons();
  // lucide จะสร้างไอคอนที่ยังมี data-lucide ใหม่ทุกครั้ง ถ้าไอคอนใต้นิ้วถูกแทนที่ระหว่างแตะ การแตะนั้นจะไม่ติด
  // จึงลบ data-lucide ออกจากไอคอนที่วาดแล้ว ให้ครั้งต่อไปวาดเฉพาะไอคอนใหม่
  document.querySelectorAll('svg[data-lucide]').forEach((el) => el.removeAttribute('data-lucide'));
}

// ---------- Tabs ----------
let currentTab = 'home';
// ปุ่ม "จดรายการ" ไม่ต้องแสดงในหน้าตั้งค่า (บังช่องกรอก) และก่อนตั้งค่ารายรับครั้งแรก
const updateFab = () => $('fab').classList.toggle('hidden', data.settings.income === null || currentTab === 'settings');

function switchTab(tab) {
  if (!['home', 'history', 'settings'].includes(tab)) tab = 'home';
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  document.querySelectorAll('.bottom-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  currentTab = tab;
  updateFab();
  if (tab === 'history') { histOffset = 0; renderHistory(); }
  setStorage(KEYS.tab, tab);
  window.scrollTo(0, 0);
}

// ---------- Setup & settings ----------
function finishSetup() {
  const income = num($('setup-income').value);
  if (!income) return toast('กรอกเงินที่ได้ต่อเดือนก่อนนะ', 'error');
  data.settings.income = income;
  data.settings.payday = Number($('setup-payday').value) || 1;
  save();
  renderAll();
  toast('ตั้งค่าเรียบร้อย ลองจดรายจ่ายแรกได้เลย', 'success');
}

function saveSettingsForm() {
  const income = $('set-income').value === '' ? null : num($('set-income').value);
  const saving = num($('set-saving').value) || 0;
  if ($('set-income').value !== '' && income === null) return toast('จำนวนเงินไม่ถูกต้อง', 'error');
  data.settings.income = income;
  data.settings.payday = Number($('set-payday').value) || 1;
  data.settings.saving = saving;
  data.settings.warnPct = Number($('set-warn').value) || 0;
  save();
  renderAll();
  toast('บันทึกแล้ว', 'success', 1200);
}

function addFixed() {
  const name = $('fixed-name').value.trim();
  const amount = num($('fixed-amount').value);
  if (!name) return toast('ใส่ชื่อรายการก่อน', 'error');
  if (!amount) return toast('ใส่จำนวนเงินก่อน', 'error');
  data.settings.fixed.push({ id: uid(), name: name.slice(0, 40), amount });
  $('fixed-name').value = '';
  $('fixed-amount').value = '';
  save();
  renderAll();
}

function removeFixed(id) {
  data.settings.fixed = data.settings.fixed.filter((f) => f.id !== id);
  save();
  renderAll();
}

// ---------- Sheet (เพิ่ม/แก้ไขรายการ) ----------
let sheetType = 'expense';
let sheetCat = 'food';
let editingId = null;

function renderSheetCats() {
  $('sheet-cats').innerHTML = CATS.map((c) => `<button type="button" class="chip ${c.id === sheetCat ? 'active' : ''}" onclick="pickCat('${c.id}')">
    <span class="text-xl">${c.emoji}</span>${c.label}</button>`).join('');
}
function pickCat(id) { sheetCat = id; renderSheetCats(); }

function setSheetType(type) {
  sheetType = type;
  document.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  $('sheet-cats-wrap').classList.toggle('hidden', type === 'income');
  $('sheet-note').placeholder = type === 'income' ? 'เช่น ค่าจ้างพาร์ทไทม์' : 'เช่น ข้าวมันไก่';
  updateSheetPreview();
}

function openSheet(id) {
  const t = id ? data.txns.find((x) => x.id === id) : null;
  editingId = t ? t.id : null;
  sheetCat = t && t.type === 'expense' ? t.cat : 'food';
  setSheetType(t ? t.type : 'expense');
  renderSheetCats();
  $('sheet-title').textContent = t ? 'แก้ไขรายการ' : 'จดรายการ';
  $('sheet-amount').value = t ? t.amount : '';
  $('sheet-note').value = t ? t.note : '';
  $('sheet-date').value = t ? t.date : ymd(todayDate());
  $('sheet-delete').classList.toggle('hidden', !t);
  updateSheetPreview();
  $('sheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (!t) setTimeout(() => $('sheet-amount').focus(), 50);
}

function closeSheet() {
  $('sheet').classList.add('hidden');
  document.body.style.overflow = '';
}

// ยอดที่ใช้วันนี้ ถ้าจดรายการในแผ่นนี้ (ไม่นับยอดเดิมของรายการที่กำลังแก้)
function todayAfterSheet(amount) {
  const n = todayNumbers();
  const old = editingId ? data.txns.find((t) => t.id === editingId) : null;
  const oldToday = old && old.type === 'expense' && old.date === n.today ? old.amount : 0;
  return { n, before: n.spentToday - oldToday, after: n.spentToday - oldToday + amount };
}

// บอกล่วงหน้าระหว่างพิมพ์ว่าจดแล้ววันนี้จะเหลือเท่าไหร่
function updateSheetPreview() {
  const el = $('sheet-preview');
  const amount = num($('sheet-amount').value);
  const isToday = $('sheet-date').value === ymd(todayDate());
  if (sheetType !== 'expense' || !amount || !isToday || data.settings.income === null || !data.settings.warnPct) {
    el.classList.add('hidden');
    return;
  }
  const { n, after } = todayAfterSheet(amount);
  const left = n.daily - after;
  const state = todayState(after, n.daily);
  const styles = {
    ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200',
    near: 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
    over: 'bg-orange-50 text-orange-900 dark:bg-orange-500/10 dark:text-orange-200',
  };
  el.className = `mt-2 text-sm rounded-xl px-3 py-2 ${styles[state]}`;
  el.textContent = state === 'over'
    ? `⚠️ จดแล้วจะเกินงบวันนี้ ${fmtMoney(-left)}`
    : state === 'near'
      ? `⚠️ จดแล้ววันนี้จะเหลือแค่ ${fmtMoney(left)}`
      : `จดแล้ววันนี้ยังใช้ได้อีก ${fmtMoney(left)}`;
}

// เตือนหลังบันทึก เฉพาะตอนที่ข้ามเกณฑ์ (จะได้ไม่เตือนซ้ำทุกรายการ)
function warnAfterSave(before, after, n) {
  if (!data.settings.warnPct) return false;
  const was = todayState(before, n.daily);
  const now = todayState(after, n.daily);
  if (now === was || now === 'ok') return false;
  if (now === 'over') {
    const t = todayNumbers();
    const tail = t.tomorrow !== null ? ` พรุ่งนี้จะเหลือใช้ได้ ${fmtMoney(t.tomorrow)}` : '';
    toast(`⚠️ เกินงบวันนี้ ${fmtMoney(after - n.daily)} แล้ว${tail}`, 'warn', 5000);
  } else {
    toast(`⚠️ ใช้ไป ${n.daily > 0 ? Math.round((after / n.daily) * 100) : 100}% ของงบวันนี้แล้ว เหลืออีก ${fmtMoney(n.daily - after)}`, 'warn', 4500);
  }
  return true;
}

function saveSheet() {
  const amount = num($('sheet-amount').value);
  if (!amount) return toast('ใส่จำนวนเงินก่อน', 'error');
  const date = $('sheet-date').value;
  if (!isYmd(date)) return toast('เลือกวันที่ก่อน', 'error');
  const counts = sheetType === 'expense' && date === ymd(todayDate()) && data.settings.income !== null;
  const check = counts ? todayAfterSheet(amount) : null;
  const fields = { type: sheetType, amount, cat: sheetType === 'income' ? 'other' : sheetCat, note: $('sheet-note').value.trim().slice(0, 60), date };
  if (editingId) {
    const t = data.txns.find((x) => x.id === editingId);
    if (t) Object.assign(t, fields);
  } else {
    data.txns.push({ id: uid(), createdAt: Date.now(), ...fields });
  }
  save();
  closeSheet();
  renderAll();
  if (check && warnAfterSave(check.before, check.after, check.n)) return;
  toast(editingId ? 'แก้ไขแล้ว' : `บันทึก ${fmtMoney(amount)} แล้ว`, 'success', 1500);
}

function deleteFromSheet() {
  if (!editingId || !confirm('ลบรายการนี้ใช่ไหม?')) return;
  data.txns = data.txns.filter((t) => t.id !== editingId);
  save();
  closeSheet();
  renderAll();
  toast('ลบแล้ว');
}

// ---------- Theme ----------
function applyTheme() {
  const t = getStorage(KEYS.theme, 'system');
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f172a' : '#059669';
}
function setTheme(t) {
  setStorage(KEYS.theme, t);
  applyTheme();
  renderSettings();
}

// ---------- Backup ----------
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'porduean', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `porduean-${ymd(todayDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.app !== 'porduean') throw new Error('ไม่ใช่ไฟล์สำรองของพอเดือน');
    const next = sanitize(parsed);
    if (!confirm(`นำเข้า ${next.txns.length} รายการ? ข้อมูลในเครื่องนี้จะถูกแทนที่ทั้งหมด`)) return;
    data = next;
    save();
    renderAll();
    toast('นำเข้าข้อมูลแล้ว', 'success');
  } catch (err) {
    toast(`นำเข้าไม่สำเร็จ: ${err.message}`, 'error', 5000);
  }
}

function clearAll() {
  if (!confirm('ลบข้อมูลทั้งหมด (ตั้งค่าและทุกรายการ) ใช่ไหม? กู้คืนไม่ได้ ถ้ายังไม่ได้สำรองไว้')) return;
  data = sanitize({});
  save();
  renderAll();
  switchTab('home');
  toast('ลบข้อมูลทั้งหมดแล้ว');
}

// ---------- Toast ----------
function toast(msg, kind = 'info', ms = 2500) {
  const el = document.createElement('div');
  const color = { error: 'bg-rose-600', success: 'bg-emerald-600', warn: 'bg-orange-600' }[kind] || 'bg-slate-800';
  el.className = `toast pointer-events-auto ${color} text-white text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-sm text-center`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Install (PWA) ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-btn').classList.remove('hidden');
});
async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-btn').classList.add('hidden');
}

// ---------- Init ----------
function init() {
  paydayOptions($('setup-payday'));
  paydayOptions($('set-payday'));
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  renderAll();
  switchTab(getStorage(KEYS.tab, 'home'));

  $('sheet-amount').addEventListener('input', updateSheetPreview);
  $('sheet-date').addEventListener('change', updateSheetPreview);
  $('sheet-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSheet(); });
  $('fixed-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFixed(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ข้ามเที่ยงคืนหรือกลับมาเปิดแอปวันใหม่: คำนวณใหม่
  let lastDay = ymd(todayDate());
  const recheck = () => { const d = ymd(todayDate()); if (d !== lastDay) { lastDay = d; renderAll(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
  setInterval(recheck, 60000);
  // ข้อมูลถูกแก้จากอีกแท็บ
  window.addEventListener('storage', (e) => {
    if (e.key === KEYS.data) { data = sanitize(getStorage(KEYS.data, {})); renderAll(); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed', err));
  }
}

try {
  init();
} catch (err) {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div style="padding:16px;background:#fee2e2;color:#991b1b;font-family:sans-serif">เกิดข้อผิดพลาด: ${escapeHtml(err.message || err)} ลองรีเฟรชหน้า</div>`);
}
