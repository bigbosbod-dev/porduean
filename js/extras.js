'use strict';

// =====================================================================
// ส่วนเสริมของพอเดือน
//   - ปุ่มจดด่วน         (settings.quick)
//   - งบรายหมวด          (settings.catBudgets)
//   - เป้าหมายออม         (goals + deposits)
//   - สตรีค & เหรียญรางวัล (คำนวณจากรายการ + badges ที่ได้แล้ว)
//   - กระปุกหมู           (อารมณ์ตามสถานะงบวันนี้)
//   - สรุปตอนจบรอบ        (summarized = รอบที่แสดงสรุปอัตโนมัติไปแล้ว)
//
// ไฟล์นี้โหลดก่อน app.js ฟังก์ชันจึงเรียกใช้ของใน app.js ได้ตอนทำงานจริงเท่านั้น
// (ห้ามเรียกของจาก app.js ตอนโหลดไฟล์)
//
// เงินเข้าเป้าหมาย (deposits):
//   fromBudget = true  → หักออกจากงบใช้จ่ายของรอบที่ลงวันที่ไว้ (ถอน = เพิ่มงบ)
//   fromBudget = false → มาจากเงินเก็บ/เงินอื่น ไม่กระทบงบ
//   source = 'leftover' คือย้ายเงินที่เหลือตอนจบรอบ จึงไม่นับเวลาคำนวณงบรายวันย้อนหลัง
// =====================================================================

const GOAL_EMOJIS = ['🎯', '🎧', '📱', '💻', '👟', '✈️', '🎮', '🎁', '📚', '🏍️', '🏠', '💍'];

const BADGES = [
  { id: 'first', emoji: '✏️', name: 'จดรายการแรก', test: () => data.txns.length >= 1 },
  { id: 'streak3', emoji: '🔥', name: 'ไม่เกินงบ 3 วันติด', test: (st) => st.best >= 3 },
  { id: 'streak7', emoji: '🏅', name: 'ไม่เกินงบ 7 วันติด', test: (st) => st.best >= 7 },
  { id: 'streak14', emoji: '🥈', name: 'ไม่เกินงบ 14 วันติด', test: (st) => st.best >= 14 },
  { id: 'streak30', emoji: '🏆', name: 'ไม่เกินงบ 30 วันติด', test: (st) => st.best >= 30 },
  { id: 'goal', emoji: '🎯', name: 'ตั้งเป้าหมายแรก', test: () => data.goals.length > 0 },
  { id: 'saved1000', emoji: '🐷', name: 'ออมครบ ฿1,000', test: () => totalSaved() >= 1000 },
  { id: 'goaldone', emoji: '🎉', name: 'ทำเป้าหมายสำเร็จ', test: () => data.goals.some((g) => g.doneAt) },
  { id: 'cycleok', emoji: '👑', name: 'จบรอบโดยไม่เกินงบ', test: () => lastCycleOk() },
  { id: 'entries50', emoji: '📒', name: 'จดครบ 50 รายการ', test: () => data.txns.length >= 50 },
  { id: 'quick', emoji: '⚡', name: 'สร้างปุ่มจดด่วน', test: () => data.settings.quick.length > 0 },
  { id: 'scan', emoji: '📷', name: 'สแกนสลิปครั้งแรก', test: () => !!data.badges.scan },
];

const arr = (x) => (Array.isArray(x) ? x : []);
const idOr = (x) => (typeof x === 'string' && x ? x : uid());

function sanitizeExtras(d) {
  const s = (d && d.settings) || {};
  const quick = arr(s.quick)
    .filter((q) => q && typeof q.name === 'string' && num(q.amount) > 0)
    .slice(0, 8)
    .map((q) => ({ id: idOr(q.id), name: q.name.slice(0, 30), amount: num(q.amount), cat: CATS.some((c) => c.id === q.cat) ? q.cat : 'other' }));
  const catBudgets = {};
  CATS.forEach((c) => {
    const v = num(s.catBudgets && s.catBudgets[c.id]);
    if (v > 0) catBudgets[c.id] = v;
  });
  const goals = arr(d && d.goals)
    .filter((g) => g && typeof g.name === 'string' && num(g.target) > 0)
    .map((g) => ({
      id: idOr(g.id),
      name: g.name.slice(0, 40),
      emoji: typeof g.emoji === 'string' && g.emoji.length <= 8 ? g.emoji : '🎯',
      target: num(g.target),
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
      doneAt: isYmd(g.doneAt) ? g.doneAt : null,
    }));
  const goalIds = new Set(goals.map((g) => g.id));
  const deposits = arr(d && d.deposits)
    .filter((x) => x && goalIds.has(x.goalId) && isYmd(x.date) && Number.isFinite(Number(x.amount)) && Number(x.amount) !== 0)
    .map((x) => ({
      id: idOr(x.id),
      goalId: x.goalId,
      amount: Math.round(Number(x.amount) * 100) / 100,
      date: x.date,
      fromBudget: x.fromBudget !== false,
      source: ['manual', 'leftover', 'monthly'].includes(x.source) ? x.source : 'manual',
      cycle: isYmd(x.cycle) ? x.cycle : null,
      createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
    }));
  const badges = {};
  const b = (d && d.badges) || {};
  BADGES.forEach((x) => { if (isYmd(b[x.id])) badges[x.id] = b[x.id]; });
  return {
    quick,
    catBudgets,
    goals,
    deposits,
    badges,
    summarized: arr(d && d.summarized).filter(isYmd).slice(-24),
    startDate: isYmd(d && d.startDate) ? d.startDate : null,
  };
}

// ---------- ตัวช่วยคำนวณ ----------
const goalSaved = (id) => sum(data.deposits.filter((x) => x.goalId === id));
const totalSaved = () => sum(data.deposits);

// งบใช้จ่ายและยอดใช้แต่ละวันของรอบ (ใช้กับสตรีค)
// allow = (งบ − ที่ใช้ไปก่อนวันนั้น) ÷ วันที่เหลือ ณ วันนั้น  เหมือนที่หน้าแรกบอกในวันนั้น
function dayLog(c) {
  const s = cycleSummary(c);
  const byDate = {};
  s.expenses.forEach((t) => { byDate[t.date] = (byDate[t.date] || 0) + t.amount; });
  let before = 0;
  return Array.from({ length: c.days }, (_, i) => {
    const key = ymd(addDays(c.start, i));
    const allow = Math.floor((s.planBudget - before) / (c.days - i));
    const spent = byDate[key] || 0;
    before += spent;
    return { key, allow, spent, ok: spent === 0 || spent <= allow };
  });
}

let streakCache = null;
function streakInfo() {
  const empty = { current: 0, best: 0, todayOk: true };
  if (data.settings.income === null || !data.startDate) return empty;
  const today = todayDate();
  const todayKey = ymd(today);
  const sig = `${todayKey}|${JSON.stringify(data.txns.length)}|${sum(data.txns)}|${sum(data.deposits)}|${JSON.stringify(data.settings)}`;
  if (streakCache && streakCache.sig === sig) return streakCache.v;
  let d = parseYmd(data.startDate);
  if (d > today) d = today;
  const logs = {};
  let run = 0;
  let best = 0;
  let current = 0;
  let todayOk = true;
  while (d <= today) {
    const c = cycleOf(d);
    if (!logs[c.startStr]) logs[c.startStr] = dayLog(c);
    const e = logs[c.startStr][dayDiff(c.start, d)];
    if (e.key === todayKey) {
      todayOk = e.ok;
      if (e.ok) run += 1;
      current = e.ok ? run : 0;
    } else {
      run = e.ok ? run + 1 : 0;
    }
    best = Math.max(best, run);
    d = addDays(d, 1);
  }
  const v = { current, best, todayOk };
  streakCache = { sig, v };
  return v;
}

function lastCycleOk() {
  if (!data.startDate || data.settings.income === null) return false;
  const c = cycleAt(-1);
  if (data.startDate > c.endStr) return false;
  const s = cycleSummary(c);
  return s.txns.length > 0 && s.planBudget - s.spent >= 0;
}

// ---------- งบรายหมวด ----------
function catSpent(cat, c = cycleAt(0)) {
  return sum(inCycle(c).filter((t) => t.type === 'expense' && t.cat === cat));
}

function catLine(cat, extra) {
  const limit = data.settings.catBudgets[cat];
  if (!limit) return null;
  const after = catSpent(cat) + extra;
  const c = CATS.find((x) => x.id === cat);
  const left = limit - after;
  const state = left < 0 ? 'over' : after >= limit * 0.8 ? 'near' : 'ok';
  const text = left < 0
    ? `${c.emoji} หมวด${c.label}จะเกินงบรอบนี้ ${fmtMoney(-left)}`
    : `${c.emoji} หมวด${c.label}เหลือ ${fmtMoney(left)} ในรอบนี้`;
  return { state, text };
}

// เตือนเมื่อหมวดข้าม 80% หรือเกินงบ (เฉพาะตอนข้ามเกณฑ์)
function catWarn(cat, before, after) {
  const limit = data.settings.catBudgets[cat];
  if (!limit) return;
  const c = CATS.find((x) => x.id === cat);
  const level = (v) => (v > limit ? 2 : v >= limit * 0.8 ? 1 : 0);
  const a = level(before);
  const b = level(after);
  if (b <= a) return;
  if (b === 2) toast(`${c.emoji} หมวด${c.label}เกินงบรอบนี้ ${fmtMoney(after - limit)} แล้ว`, 'warn', 4500);
  else toast(`${c.emoji} หมวด${c.label}ใช้ไป ${Math.round((after / limit) * 100)}% ของงบรอบนี้ (เหลือ ${fmtMoney(limit - after)})`, 'warn', 4500);
}

function saveCatBudget(cat, value) {
  const v = num(value);
  if (v > 0) data.settings.catBudgets[cat] = v;
  else delete data.settings.catBudgets[cat];
  save();
  renderAll();
  toast('บันทึกงบหมวดแล้ว', 'success', 1200);
}

// ---------- ปุ่มจดด่วน ----------
function quickAdd(id) {
  const q = data.settings.quick.find((x) => x.id === id);
  if (!q || data.settings.income === null) return;
  const n = todayNumbers();
  const catBefore = catSpent(q.cat);
  const txnId = uid();
  newRowId = txnId;
  data.txns.push({ id: txnId, type: 'expense', amount: q.amount, cat: q.cat, note: q.name, date: n.today, createdAt: Date.now() });
  save();
  renderAll();
  newRowId = null;
  floatChip(`−${fmtMoney(q.amount)}`);
  fxFly(document.querySelector(`[data-quick="${id}"]`), $('today-amount'), '💸');
  const el = document.querySelector(`[data-quick="${id}"]`);
  if (el) replay(el, 'pop');
  // ข้อความเดียวต่อการแตะ: ถ้ามีคำเตือน ปุ่มเลิกทำจะอยู่ในคำเตือนนั้นแทน
  const undo = { label: 'เลิกทำ', fn: () => undoTxn(txnId) };
  catWarn(q.cat, catBefore, catBefore + q.amount);
  if (!warnAfterSave(n.spentToday, n.spentToday + q.amount, n, undo)) {
    toast(`จด ${q.name} ${fmtMoney(q.amount)} แล้ว`, 'success', 4000, undo);
  }
}

function undoTxn(id) {
  data.txns = data.txns.filter((t) => t.id !== id);
  save();
  renderAll();
  toast('ยกเลิกรายการแล้ว');
}

function addQuickFrom(fields) {
  const name = (fields.note || CATS.find((c) => c.id === fields.cat).label).slice(0, 30);
  const dup = data.settings.quick.find((q) => q.name === name && q.amount === fields.amount && q.cat === fields.cat);
  if (dup) return;
  if (data.settings.quick.length >= 8) {
    toast('ปุ่มจดด่วนมีครบ 8 ปุ่มแล้ว ลบบางปุ่มในแท็บตั้งค่าก่อน', 'error', 4000);
    return;
  }
  data.settings.quick.push({ id: uid(), name, amount: fields.amount, cat: fields.cat });
}

function removeQuick(id) {
  data.settings.quick = data.settings.quick.filter((q) => q.id !== id);
  save();
  renderAll();
}

function renderQuick() {
  const card = $('quick-card');
  const ready = data.settings.income !== null;
  card.classList.toggle('hidden', !ready);
  if (!ready) return;
  const chips = data.settings.quick.map((q) => {
    const c = CATS.find((x) => x.id === q.cat);
    return `<button class="quick-chip press" data-quick="${q.id}" onclick="quickAdd('${q.id}')">
      <span>${c.emoji}</span><span class="truncate max-w-[7rem]">${escapeHtml(q.name)}</span><b>${fmtMoney(q.amount)}</b></button>`;
  }).join('');
  $('quick-list').innerHTML = chips
    || '<button class="quick-chip quick-chip-ghost press" onclick="openSheet(null, { quick: true })">＋ สร้างปุ่มจดด่วน (ติ๊ก ☆ ตอนจดรายการ)</button>';
}

// ---------- กระปุกหมู ----------
function piggySvg(mood = 'happy') {
  const ink = '#831843';
  const line = (d) => `<path d="${d}" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round" />`;
  const eyes = {
    happy: line('M36 44 q6 -8 12 0') + line('M72 44 q6 -8 12 0'),
    party: line('M36 44 q6 -8 12 0') + line('M72 44 q6 -8 12 0'),
    worried: `<circle cx="42" cy="43" r="3.6" fill="${ink}"/><circle cx="78" cy="43" r="3.6" fill="${ink}"/>`
      + line('M35 34 l11 3') + line('M85 34 l-11 3'),
    sad: line('M36 42 q6 6 12 0') + line('M72 42 q6 6 12 0'),
    sleep: line('M36 44 h12') + line('M72 44 h12'),
  }[mood];
  const mouth = {
    happy: line('M53 71 q7 7 14 0'),
    party: `<path d="M52 70 q8 11 16 0 z" fill="${ink}"/>`,
    worried: line('M52 74 q4 -3 8 0 q4 3 8 0'),
    sad: line('M53 75 q7 -7 14 0'),
    sleep: `<ellipse cx="60" cy="73" rx="3.5" ry="4" fill="${ink}"/>`,
  }[mood];
  const extra = {
    happy: '',
    party: '<path class="pig-spark" d="M12 18 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" fill="#facc15"/><path class="pig-spark pig-spark-2" d="M104 10 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5z" fill="#facc15"/>',
    worried: '<path class="pig-sweat" d="M97 26 q5 7 0 10 q-5 -3 0 -10z" fill="#7dd3fc"/>',
    sad: '<path class="pig-tear" d="M40 49 q3.5 6 0 9 q-3.5 -3 0 -9z" fill="#7dd3fc"/><path class="pig-tear pig-tear-2" d="M80 49 q3.5 6 0 9 q-3.5 -3 0 -9z" fill="#7dd3fc"/>',
    sleep: '<text class="pig-z" x="96" y="20" font-size="14" font-weight="700" fill="#818cf8">z</text><text class="pig-z pig-z-2" x="104" y="10" font-size="11" font-weight="700" fill="#818cf8">z</text><text class="pig-z pig-z-3" x="110" y="2" font-size="9" font-weight="700" fill="#818cf8">z</text>',
  }[mood];
  return `<svg viewBox="0 0 120 100" class="w-full h-full overflow-visible" aria-hidden="true">
    <g class="pig-body">
      <rect x="30" y="72" width="13" height="18" rx="5" fill="#f472b6"/>
      <rect x="77" y="72" width="13" height="18" rx="5" fill="#f472b6"/>
      <path d="M104 50 q11 -5 7 6 q-4 6 3 8" stroke="#f472b6" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path class="pig-ear-l" d="M28 26 L35 5 L52 20 Z" fill="#f472b6"/>
      <path class="pig-ear-r" d="M68 20 L85 5 L92 26 Z" fill="#f472b6"/>
      <ellipse cx="60" cy="52" rx="47" ry="35" fill="#f9a8d4"/>
      <rect x="50" y="20" width="20" height="4.5" rx="2.2" fill="#be185d" opacity=".55"/>
      <circle cx="29" cy="59" r="6.5" fill="#f472b6" opacity=".55"/>
      <circle cx="91" cy="59" r="6.5" fill="#f472b6" opacity=".55"/>
      <ellipse cx="60" cy="58" rx="14" ry="10" fill="#f472b6"/>
      <ellipse cx="55" cy="58" rx="2.6" ry="3.6" fill="#9d174d"/>
      <ellipse cx="65" cy="58" rx="2.6" ry="3.6" fill="#9d174d"/>
      <g class="pig-eyes ${mood === 'happy' || mood === 'worried' || mood === 'party' ? 'can-blink' : ''}">${eyes}</g>${mouth}
    </g>
    ${extra}
  </svg>`;
}

let piggyPokes = 0;
function piggyMood() {
  if (data.settings.income === null) return 'happy';
  const n = todayNumbers();
  const st = todayState(n.spentToday, n.daily);
  if (st === 'over') return 'sad';
  if (st === 'near') return 'worried';
  const h = new Date().getHours();
  return h >= 22 || h < 6 ? 'sleep' : 'happy'; // ดึกแล้วหมูหลับ
}

function piggyMessages() {
  const n = todayNumbers();
  const st = streakInfo();
  const mood = piggyMood();
  const saved = totalSaved();
  if (mood === 'sad') {
    return [
      `วันนี้เกินงบไป ${fmtMoney(-n.left)} แล้ว 😭`,
      n.tomorrow !== null ? `ไม่เป็นไรนะ พรุ่งนี้เริ่มใหม่ ใช้ได้ ${fmtMoney(n.tomorrow)}` : 'ไม่เป็นไรนะ พรุ่งนี้เงินเข้าแล้ว',
      'ช่วยกันประหยัดหน่อยน้า 🥺',
    ];
  }
  if (mood === 'sleep') {
    return [
      `zzz... ฝันดีนะ วันนี้ยังเหลือ ${fmtMoney(n.left)} 😴`,
      'ดึกแล้ว อย่าเผลอสั่งของออนไลน์นะ 🌙',
      'หนูขอนอนก่อนน้า zzz',
    ];
  }
  if (mood === 'worried') {
    return [
      `วันนี้เหลืออีกแค่ ${fmtMoney(n.left)} นะ 😰`,
      'ใกล้หมดงบวันนี้แล้ว ใจเย็น ๆ นะ',
      'มื้อต่อไปลองหาอะไรประหยัด ๆ ไหม 🍙',
    ];
  }
  const msgs = [`วันนี้ยังใช้ได้อีก ${fmtMoney(n.left)} นะ 😊`];
  if (st.current >= 2) msgs.push(`ไม่เกินงบมา ${st.current} วันติดแล้ว เก่งมาก! 🔥`);
  if (saved > 0) msgs.push(`ในท้องหนูมีเงินออม ${fmtMoney(saved)} แล้ว 🐷`);
  if (!data.goals.length) msgs.push('ตั้งเป้าหมายออมในแท็บ "ออม" ได้นะ 🎯');
  msgs.push('จดทุกรายการ เงินจะไม่หายไปไหน ✏️');
  return msgs;
}

// ลูกโป่งคำพูดของหมู (โผล่ชั่วคราวแล้วหายไปเอง)
let bubbleTimer = null;
function showPiggyBubble(text, ms = 4000) {
  const el = $('piggy-msg');
  if (!el || $('today-card').classList.contains('hidden')) return;
  el.textContent = text;
  el.classList.remove('hidden');
  replay(el, 'bubble-pop');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hidePiggyBubble, ms);
}
function hidePiggyBubble() {
  clearTimeout(bubbleTimer);
  $('piggy-msg').classList.add('hidden');
}

function renderPiggy() {
  const ready = data.settings.income !== null;
  if (!ready) return;
  const mood = piggyMood();
  const box = $('piggy');
  const prevMood = box.dataset.mood;
  if (prevMood !== mood) {
    box.innerHTML = piggySvg(mood);
    box.dataset.mood = mood;
    // อารมณ์เปลี่ยน (เช่น ใกล้หมดงบ): หมูพูดทันที
    if (prevMood) showPiggyBubble(piggyMessages()[0]);
  }
  const st = streakInfo();
  $('streak-chip').innerHTML = `<span class="flame">🔥</span> <b>${st.current}</b> วันติด`;
  const saved = totalSaved();
  $('saved-chip').textContent = saved > 0 ? `🐷 ออมเข้าเป้าหมายแล้ว ${fmtMoney(saved)}` : '';
}

let pokeTimes = [];
function pokePiggy() {
  piggyPokes += 1;
  const now = Date.now();
  pokeTimes = pokeTimes.filter((t) => now - t < 2000).concat(now);
  // เซอร์ไพรส์: แตะรัว ๆ 5 ครั้งใน 2 วินาที
  if (pokeTimes.length >= 5 && fxFull()) {
    pokeTimes = [];
    replay($('piggy'), 'pig-spin');
    fxCoinRain($('piggy'), 10);
    showPiggyBubble('ว้าว! หมุนติ้ว ขอบคุณที่เล่นด้วยนะ 🐷💕');
    return;
  }
  replay($('piggy'), 'pig-wiggle');
  const msgs = piggyMessages();
  showPiggyBubble(msgs[(todayDate().getDate() + piggyPokes) % msgs.length]);
}

// ---------- ทัวร์แนะนำการใช้งาน (ครั้งแรก) ----------
const TIPS_KEY = 'pd_tips_done';
const TIPS = [
  { sel: '#today-card', text: 'ตัวเลขนี้คือเงินที่ใช้ได้วันนี้ ถ้าวันนี้ใช้น้อย พรุ่งนี้จะได้เพิ่มเอง สีการ์ดบอกสถานะ: เขียว ปกติ / ส้ม ใกล้หมด / แดง เกินงบ' },
  { sel: '#piggy', text: 'นี่หมูกระปุก 🐷 แตะเพื่อคุยด้วย หมูจะยิ้ม เหงื่อตก หรือร้องไห้ตามงบของวันนี้' },
  { sel: '#quick-card', text: '⚡ จดด่วน: ตอนจดรายการให้ติ๊ก "☆ บันทึกเป็นปุ่มจดด่วน" ครั้งหน้าแตะปุ่มเดียวก็จดเสร็จ' },
  { sel: '#fab', text: 'กดเพื่อจดรายจ่ายหรือรายรับ ถ้ามีสลิปโอนเงิน กด 📷 สแกนสลิปแทนการพิมพ์ได้' },
  { sel: '.bottom-tab[data-tab=history]', text: 'ประวัติ: กราฟรายวัน สรุปแต่ละรอบ และปุ่มส่งออก PDF ไว้ส่งอาจารย์' },
  { sel: '.bottom-tab[data-tab=goals]', text: 'ออม: ตั้งเป้าหมายเก็บเงิน ดูสตรีควันไม่เกินงบ และสะสมเหรียญรางวัล 🏅' },
];

function maybeStartTips() {
  let done = false;
  try { done = !!localStorage.getItem(TIPS_KEY); } catch (e) { done = true; }
  if (done || data.settings.income === null || currentTab !== 'home') return;
  // รอถ้ามีหน้าต่างอื่นเปิดอยู่ (สรุปรอบ ฉลอง ต้อนรับ)
  if (!$('modal').classList.contains('hidden') || document.querySelector('.celebrate, .splash')) {
    setTimeout(maybeStartTips, 1500);
    return;
  }
  startTips();
}

function replayTips() {
  switchTab('home');
  setTimeout(startTips, 450);
}

function startTips() {
  if (document.querySelector('.tips')) return;
  const steps = TIPS.filter((t) => {
    const el = document.querySelector(t.sel);
    // ใช้ getClientRects แทน offsetParent เพราะปุ่มที่ position:fixed มี offsetParent เป็น null เสมอ
    return el && !el.classList.contains('hidden') && el.getClientRects().length > 0;
  });
  if (!steps.length) return;
  hidePiggyBubble();
  const o = document.createElement('div');
  o.className = 'tips';
  o.innerHTML = `<div class="tip-hole"></div>
    <div class="tip-card">
      <div class="tip-text"></div>
      <div class="tip-foot">
        <span class="tip-count"></span>
        <button class="tip-skip">ข้าม</button>
        <button class="tip-next btn-primary press !py-2 !px-4 text-sm"></button>
      </div>
    </div>`;
  document.body.appendChild(o);
  let i = 0;
  const finish = () => {
    try { localStorage.setItem(TIPS_KEY, '1'); } catch (e) { /* ignore */ }
    o.classList.add('out');
    setTimeout(() => o.remove(), 250);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  const show = () => {
    const step = steps[i];
    const el = document.querySelector(step.sel);
    const fixed = getComputedStyle(el).position === 'fixed' || el.closest('nav');
    if (!fixed) el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    setTimeout(() => {
      const r = el.getBoundingClientRect();
      const pad = 8;
      const hole = o.querySelector('.tip-hole');
      Object.assign(hole.style, {
        left: `${r.left - pad}px`, top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
        borderRadius: `${Math.min(28, (r.height + pad * 2) / 2)}px`,
      });
      const card = o.querySelector('.tip-card');
      o.querySelector('.tip-text').textContent = step.text;
      o.querySelector('.tip-count').textContent = `${i + 1}/${steps.length}`;
      o.querySelector('.tip-next').textContent = i === steps.length - 1 ? 'เริ่มใช้เลย!' : 'ถัดไป';
      // วางการ์ดคำอธิบายใต้จุดที่ชี้ ถ้าที่ไม่พอวางด้านบน
      const below = r.bottom + pad + 12;
      const cardH = card.offsetHeight || 140;
      card.style.top = below + cardH < window.innerHeight - 8 ? `${below}px` : `${Math.max(8, r.top - pad - 12 - cardH)}px`;
      replay(card, 'bubble-pop');
    }, fixed ? 30 : 380);
  };
  o.querySelector('.tip-next').addEventListener('click', (e) => {
    e.stopPropagation();
    i += 1;
    if (i >= steps.length) finish(); else show();
  });
  o.querySelector('.tip-skip').addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  show();
}

// ---------- เป้าหมายออม ----------
let animateGoals = false;

function renderGoals() {
  const animate = animateGoals && !reduceMotion();
  animateGoals = false;
  const gp = $('goals-piggy');
  const mood = data.goals.some((g) => g.doneAt) ? 'party' : piggyMood();
  if (gp.dataset.mood !== mood) { gp.innerHTML = piggySvg(mood); gp.dataset.mood = mood; }
  countTo($('goals-total'), totalSaved());
  const st = streakInfo();
  $('streak-now').textContent = st.current;
  $('streak-best').textContent = st.best;

  $('goal-list').innerHTML = data.goals.length
    ? data.goals.map((g) => {
      const saved = goalSaved(g.id);
      const pct = Math.max(0, Math.min(100, (saved / g.target) * 100));
      const left = g.target - saved;
      return `<div class="goal-card rounded-2xl border border-slate-200 dark:border-slate-800 p-3" data-goal="${g.id}">
        <div class="flex items-center gap-3">
          <span class="text-3xl leading-none">${g.emoji}</span>
          <div class="flex-1 min-w-0">
            <div class="font-medium heading truncate">${escapeHtml(g.name)}</div>
            <div class="text-xs muted">${fmtMoney(saved)} / ${fmtMoney(g.target)} · ${Math.floor(pct)}%</div>
          </div>
          ${g.doneAt ? '<span class="text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">สำเร็จแล้ว 🎉</span>' : ''}
          <button class="icon-btn" onclick="openGoalForm('${g.id}')" aria-label="แก้ไข ${escapeHtml(g.name)}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
        </div>
        <div class="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 mt-3 overflow-hidden">
          <div class="h-full rounded-full bg-emerald-500 grow-x shimmer" data-w="${pct}" style="width:${animate ? 0 : pct}%"></div>
        </div>
        <div class="text-xs muted mt-1.5">${left > 0 ? `อีก ${fmtMoney(left)} ถึงเป้า` : 'ครบเป้าแล้ว!'}</div>
        <div class="flex gap-2 mt-3">
          <button class="btn-primary press flex-1 !py-2 text-sm" onclick="openDeposit('${g.id}', 1)"><i data-lucide="plus" class="w-4 h-4"></i>เติมเงิน</button>
          <button class="btn-secondary press !py-2 text-sm" onclick="openDeposit('${g.id}', -1)">ถอน</button>
        </div>
      </div>`;
    }).join('')
    : `<div class="text-center py-4">
        <p class="text-sm muted">ยังไม่มีเป้าหมาย ลองตั้งของที่อยากได้ แล้วค่อย ๆ หยอดกระปุก 🐷</p>
        <button class="btn-primary press mt-3" onclick="openGoalForm()"><i data-lucide="plus" class="w-4 h-4"></i>ตั้งเป้าหมายแรก</button>
      </div>`;
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('#goal-list [data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    }));
  }

  const earned = BADGES.filter((b) => data.badges[b.id]).length;
  $('badge-count').textContent = `${earned}/${BADGES.length}`;
  $('badge-grid').innerHTML = BADGES.map((b) => {
    const got = data.badges[b.id];
    return `<button class="badge-tile press ${got ? '' : 'locked'}" onclick="badgeInfo('${b.id}')">
      <span class="text-2xl">${got ? b.emoji : '🔒'}</span>
      <span class="text-[10px] leading-tight mt-1">${b.name}</span>
    </button>`;
  }).join('');
}

function badgeInfo(id) {
  const b = BADGES.find((x) => x.id === id);
  const got = data.badges[id];
  toast(got ? `${b.emoji} ${b.name} · ได้เมื่อ ${fmtDate(parseYmd(got), { day: 'numeric', month: 'short', year: '2-digit' })}` : `🔒 ${b.name} (ยังไม่ได้)`, 'info', 2500);
}

// ---------- หน้าต่างกลาง (ใช้กับฟอร์มเป้าหมาย เติมเงิน และสรุปรอบ) ----------
let modalCloseTimer = null;
function openModal(html) {
  clearTimeout(modalCloseTimer);
  $('modal-body').innerHTML = html;
  $('modal').classList.remove('hidden', 'closing');
  document.body.style.overflow = 'hidden';
  refreshIcons();
}
function closeModal() {
  const el = $('modal');
  if (el.classList.contains('hidden') || el.classList.contains('closing')) return;
  document.body.style.overflow = '';
  if (reduceMotion()) { el.classList.add('hidden'); return; }
  el.classList.add('closing');
  modalCloseTimer = setTimeout(() => el.classList.add('hidden'), 220);
}
const modalHead = (title) => `<div class="flex items-center justify-between mb-4">
  <h2 class="font-semibold text-lg heading">${title}</h2>
  <button class="icon-btn" onclick="closeModal()" aria-label="ปิด"><i data-lucide="x" class="w-5 h-5"></i></button>
</div>`;

let goalEmoji = '🎯';
function openGoalForm(id) {
  const g = id ? data.goals.find((x) => x.id === id) : null;
  goalEmoji = g ? g.emoji : '🎯';
  openModal(`${modalHead(g ? 'แก้ไขเป้าหมาย' : 'ตั้งเป้าหมายใหม่')}
    <label class="label" for="goal-name">อยากเก็บเงินไว้ทำอะไร</label>
    <input id="goal-name" class="input" maxlength="40" placeholder="เช่น หูฟังใหม่" value="${g ? escapeHtml(g.name) : ''}" />
    <label class="label mt-3" for="goal-target">ต้องเก็บกี่บาท</label>
    <input id="goal-target" type="number" inputmode="decimal" min="0" class="input" placeholder="เช่น 3000" value="${g ? g.target : ''}" />
    <div class="label mt-3">ไอคอน</div>
    <div id="goal-emojis" class="grid grid-cols-6 gap-2">${GOAL_EMOJIS.map((e) => `<button type="button" class="chip press !py-2 text-xl ${e === goalEmoji ? 'active' : ''}" onclick="pickGoalEmoji(this, '${e}')">${e}</button>`).join('')}</div>
    <button class="btn-primary press w-full mt-5 py-3" onclick="saveGoal(${g ? `'${g.id}'` : 'null'})">บันทึก</button>
    ${g ? `<button class="btn-danger w-full mt-2" onclick="deleteGoal('${g.id}')"><i data-lucide="trash-2" class="w-4 h-4"></i>ลบเป้าหมายนี้</button>` : ''}`);
  if (!g) setTimeout(() => $('goal-name').focus(), 50);
}

function pickGoalEmoji(el, e) {
  goalEmoji = e;
  document.querySelectorAll('#goal-emojis .chip').forEach((b) => b.classList.toggle('active', b === el));
  replay(el, 'pop');
}

function saveGoal(id) {
  const name = $('goal-name').value.trim();
  const target = num($('goal-target').value);
  if (!name) return toast('ตั้งชื่อเป้าหมายก่อนนะ', 'error');
  if (!target) return toast('ใส่จำนวนเงินที่อยากเก็บก่อน', 'error');
  if (id) {
    const g = data.goals.find((x) => x.id === id);
    Object.assign(g, { name: name.slice(0, 40), target, emoji: goalEmoji });
    updateGoalDone(g);
  } else {
    data.goals.push({ id: uid(), name: name.slice(0, 40), target, emoji: goalEmoji, createdAt: Date.now(), doneAt: null });
  }
  save();
  closeModal();
  animateGoals = true;
  renderAll();
  toast(id ? 'แก้ไขเป้าหมายแล้ว' : `ตั้งเป้าหมาย ${goalEmoji} ${name} แล้ว`, 'success');
}

function deleteGoal(id) {
  const g = data.goals.find((x) => x.id === id);
  const saved = goalSaved(id);
  const msg = saved > 0
    ? `ลบเป้าหมาย "${g.name}" ใช่ไหม? ยอดออม ${fmtMoney(saved)} ในเป้าหมายนี้จะถูกลบไปด้วย (ถ้าเคยหักจากงบรอบไหน งบรอบนั้นจะกลับมาเท่าเดิม)`
    : `ลบเป้าหมาย "${g.name}" ใช่ไหม?`;
  if (!confirm(msg)) return;
  data.goals = data.goals.filter((x) => x.id !== id);
  data.deposits = data.deposits.filter((x) => x.goalId !== id);
  save();
  closeModal();
  renderAll();
  toast('ลบเป้าหมายแล้ว');
}

// ครบเป้า → ฉลอง / ถอนจนไม่ครบ → ยกเลิกสถานะสำเร็จ
function updateGoalDone(g) {
  const saved = goalSaved(g.id);
  if (saved >= g.target && !g.doneAt) {
    g.doneAt = ymd(todayDate());
    setTimeout(() => {
      if (fxCelebrate(g.emoji, 'เป้าหมายสำเร็จ! 🎉', `${g.name} ครบ ${fmtMoney(g.target)} แล้ว เก่งมาก`)) return;
      confetti();
      toast(`🎉 เป้าหมาย ${g.emoji} ${g.name} สำเร็จแล้ว! เก่งมาก`, 'success', 5000);
    }, fxFull() ? 1300 : 250); // รอเหรียญตกลงกระปุกก่อน
  } else if (saved < g.target && g.doneAt) {
    g.doneAt = null;
  }
}

let depositDir = 1;
let depositGoal = null;
function openDeposit(goalId, dir) {
  const g = data.goals.find((x) => x.id === goalId);
  if (!g) return;
  depositDir = dir;
  depositGoal = goalId;
  const saved = goalSaved(goalId);
  if (dir < 0 && saved <= 0) return toast('เป้าหมายนี้ยังไม่มีเงินให้ถอน', 'error');
  const opt = (value, title, desc, checked) => `<label class="flex gap-3 items-start p-3 rounded-xl border border-slate-200 dark:border-slate-700 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:has-[:checked]:bg-emerald-500/10 cursor-pointer">
      <input type="radio" name="dep-src" value="${value}" class="mt-1 accent-emerald-600" ${checked ? 'checked' : ''} />
      <span><span class="block text-sm font-medium heading">${title}</span><span class="block text-xs muted">${desc}</span></span>
    </label>`;
  const chips = [20, 50, 100, 500].map((v) => `<button type="button" class="chip press !py-1.5" onclick="$('dep-amount').value=${v}">฿${v}</button>`).join('');
  openModal(`${modalHead(dir > 0 ? `เติมเงินเข้า ${g.emoji} ${escapeHtml(g.name)}` : `ถอนจาก ${g.emoji} ${escapeHtml(g.name)}`)}
    <label class="label" for="dep-amount">จำนวนเงิน (บาท)${dir < 0 ? ` · มีอยู่ ${fmtMoney(saved)}` : ''}</label>
    <input id="dep-amount" type="number" inputmode="decimal" min="0" class="input !text-2xl font-semibold" placeholder="0" />
    <div class="grid grid-cols-4 gap-2 mt-2">${chips}</div>
    <div class="space-y-2 mt-4">
      ${dir > 0
    ? opt('budget', 'จากเงินที่เหลือรอบนี้', 'งบใช้จ่ายรอบนี้จะลดลง แอปจะเกลี่ยงบรายวันใหม่ให้', true)
      + opt('other', 'จากเงินเก็บหรือเงินอื่น', 'ไม่กระทบงบใช้จ่ายรอบนี้', false)
    : opt('budget', 'เอามาใช้ในรอบนี้', 'งบใช้จ่ายรอบนี้จะเพิ่มขึ้นตามจำนวนที่ถอน', true)
      + opt('other', 'แค่ปรับยอด', 'ไม่กระทบงบใช้จ่ายรอบนี้', false)}
    </div>
    <button class="btn-primary press w-full mt-5 py-3" onclick="saveDeposit()">${dir > 0 ? 'หยอดกระปุก 🐷' : 'ถอนเงิน'}</button>`);
  setTimeout(() => $('dep-amount').focus(), 50);
}

function saveDeposit() {
  const amount = num($('dep-amount').value);
  if (!amount) return toast('ใส่จำนวนเงินก่อน', 'error');
  const g = data.goals.find((x) => x.id === depositGoal);
  if (!g) return;
  if (depositDir < 0 && amount > goalSaved(g.id)) return toast(`ถอนได้ไม่เกิน ${fmtMoney(goalSaved(g.id))}`, 'error');
  const fromBudget = document.querySelector('input[name="dep-src"]:checked').value === 'budget';
  data.deposits.push({ id: uid(), goalId: g.id, amount: amount * depositDir, date: ymd(todayDate()), fromBudget, source: 'manual', cycle: null, createdAt: Date.now() });
  updateGoalDone(g);
  save();
  closeModal();
  renderAll();
  const card = document.querySelector(`[data-goal="${g.id}"]`);
  if (card) replay(card, 'pop');
  if (depositDir > 0) {
    replay($('goals-piggy'), 'pig-wiggle');
    floatOver($('goals-piggy'), `+${fmtMoney(amount)}`);
    fxCoinRain($('goals-piggy'), Math.min(12, 4 + Math.round(amount / 100)));
  }
  toast(depositDir > 0 ? `หยอด ${fmtMoney(amount)} เข้า ${g.name} แล้ว 🐷` : `ถอน ${fmtMoney(amount)} แล้ว`, 'success', 2500);
}

// ป้ายลอยขึ้นเหนือองค์ประกอบใดก็ได้
function floatOver(el, text) {
  if (reduceMotion() || !el) return;
  const chip = document.createElement('div');
  chip.className = 'float-chip float-chip-dark';
  chip.textContent = text;
  el.style.position = 'relative';
  el.appendChild(chip);
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
}

// ---------- สรุปตอนจบรอบ ----------
function cycleReport(c) {
  const s = cycleSummary(c);
  const prevC = cycleOf(addDays(c.start, -1));
  const prev = cycleSummary(prevC);
  const today = ymd(todayDate());
  const log = dayLog(c).filter((e) => e.key <= today && (!data.startDate || e.key >= data.startDate));
  const byCat = CATS.map((cat) => ({ cat, total: sum(s.expenses.filter((t) => t.cat === cat.id)) })).sort((a, b) => b.total - a.total);
  return {
    c, s,
    left: s.planBudget - s.spent,
    moved: data.deposits.filter((x) => x.cycle === c.startStr),
    okDays: log.filter((e) => e.ok).length,
    days: log.length,
    top: byCat[0] && byCat[0].total > 0 ? byCat[0] : null,
    prevSpent: prev.txns.length ? prev.spent : null,
    past: c.endStr < today,
  };
}

function openSummary(c) {
  const r = cycleReport(c);
  const good = r.left >= 0;
  const stat = (label, value, cls = 'heading') => `<div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
      <div class="text-[11px] muted">${label}</div><div class="font-semibold ${cls}">${value}</div></div>`;
  const lines = [];
  if (r.days) lines.push(`📅 ไม่เกินงบรายวัน <b>${r.okDays}</b> จาก ${r.days} วัน`);
  if (r.top) lines.push(`${r.top.cat.emoji} ใช้กับ${r.top.cat.label}มากที่สุด <b>${fmtMoney(r.top.total)}</b> (${Math.round((r.top.total / (r.s.spent || 1)) * 100)}%)`);
  if (r.prevSpent !== null) {
    const diff = r.s.spent - r.prevSpent;
    const pct = r.prevSpent ? Math.round((Math.abs(diff) / r.prevSpent) * 100) : 0;
    lines.push(diff <= 0
      ? `👍 ใช้น้อยกว่ารอบก่อน <b>${fmtMoney(-diff)}</b>${pct ? ` (−${pct}%)` : ''}`
      : `📈 ใช้มากกว่ารอบก่อน <b>${fmtMoney(diff)}</b>${pct ? ` (+${pct}%)` : ''}`);
  }
  const movedLeft = r.moved.some((x) => x.source === 'leftover');
  const movedMonthly = r.moved.some((x) => x.source === 'monthly');
  const goalSelect = `<select id="sum-goal" class="input mt-2">${data.goals.map((g) => `<option value="${g.id}">${g.emoji} ${escapeHtml(g.name)}</option>`).join('')}</select>`;
  let actions = '';
  if (r.past) {
    const canLeft = r.left > 0 && !movedLeft;
    const canMonthly = data.settings.saving > 0 && !movedMonthly;
    if ((canLeft || canMonthly) && data.goals.length) {
      actions = `<div class="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 p-3 mt-4">
        <div class="text-sm font-medium heading">🐷 หยอดกระปุกจากรอบนี้</div>
        ${goalSelect}
        <div class="flex flex-col gap-2 mt-3">
          ${canLeft ? `<button class="btn-primary press !py-2 text-sm" onclick="moveFromSummary('${c.startStr}', 'leftover')">ย้ายเงินที่เหลือ ${fmtMoney(r.left)} ไปเป้าหมาย</button>` : ''}
          ${canMonthly ? `<button class="btn-secondary press !py-2 text-sm" onclick="moveFromSummary('${c.startStr}', 'monthly')">ใส่เงินเก็บประจำเดือน ${fmtMoney(data.settings.saving)}</button>` : ''}
        </div>
      </div>`;
    } else if ((canLeft || canMonthly) && !data.goals.length) {
      actions = `<p class="text-sm muted mt-4">💡 ตั้งเป้าหมายในแท็บ "ออม" แล้วย้ายเงินที่เหลือไปเก็บได้</p>`;
    }
    if (movedLeft || movedMonthly) {
      actions += `<p class="text-sm text-emerald-700 dark:text-emerald-300 mt-3">✓ ย้ายเข้าเป้าหมายแล้ว ${fmtMoney(sum(r.moved))}</p>`;
    }
  }
  openModal(`${modalHead(`สรุปรอบ ${fmtDate(c.start)} – ${fmtDate(c.end)}`)}
    <div class="flex items-center gap-3">
      <div class="w-20 h-20 shrink-0 pig-bob">${piggySvg(good ? 'party' : 'sad')}</div>
      <div>
        <div class="text-lg font-semibold heading">${r.past ? (good ? 'รอดทั้งเดือน! 🎉' : 'รอบนี้ใช้เกินงบไปหน่อย') : 'สรุปถึงวันนี้'}</div>
        <div class="text-sm muted">${good ? `เหลือเงิน ${fmtMoney(r.left)}` : `เกินงบ ${fmtMoney(-r.left)} รอบหน้าสู้ใหม่นะ`}</div>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-2 mt-4">
      ${stat('งบใช้จ่าย', fmtMoney(r.s.planBudget))}
      ${stat('ใช้ไป', fmtMoney(r.s.spent))}
      ${stat(good ? 'เหลือ' : 'เกินงบ', fmtMoney(Math.abs(r.left)), good ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400')}
    </div>
    <div class="space-y-2 mt-4 text-sm heading">${lines.map((l) => `<p>${l}</p>`).join('')}</div>
    ${actions}
    <button class="btn-secondary press w-full mt-5" onclick="closeModal()">ปิด</button>`);
  if (r.past && good) setTimeout(confetti, 300);
}

function moveFromSummary(cycleStart, source) {
  const c = cycleOf(parseYmd(cycleStart));
  const r = cycleReport(c);
  const goalId = $('sum-goal').value;
  const g = data.goals.find((x) => x.id === goalId);
  if (!g) return;
  const amount = source === 'leftover' ? r.left : data.settings.saving;
  if (!(amount > 0)) return;
  data.deposits.push({ id: uid(), goalId, amount, date: c.endStr, fromBudget: source === 'leftover', source, cycle: c.startStr, createdAt: Date.now() });
  updateGoalDone(g);
  save();
  renderAll();
  openSummary(c);
  toast(`หยอด ${fmtMoney(amount)} เข้า ${g.emoji} ${g.name} แล้ว 🐷`, 'success', 3000);
}

// เปิดแอปครั้งแรกหลังจบรอบ: แสดงสรุปรอบที่แล้วให้อัตโนมัติ (ครั้งเดียวต่อรอบ)
function maybeAutoSummary() {
  if (data.settings.income === null || !data.startDate) return;
  const c = cycleAt(-1);
  if (data.startDate > c.endStr || data.summarized.includes(c.startStr) || !inCycle(c).length) return;
  data.summarized.push(c.startStr);
  data.summarized = data.summarized.slice(-24);
  save();
  openSummary(c);
}

// ---------- เหรียญรางวัล ----------
function checkBadges() {
  if (data.settings.income === null) return;
  const st = streakInfo();
  const fresh = BADGES.filter((b) => !data.badges[b.id] && b.test(st));
  if (!fresh.length) return;
  const today = ymd(todayDate());
  fresh.forEach((b) => { data.badges[b.id] = today; });
  save();
  setTimeout(() => {
    if (fxFull()) {
      fresh.slice(0, 3).forEach((b) => fxCelebrate(b.emoji, 'ได้เหรียญใหม่!', b.name));
      if (fresh.length > 3) toast(`และอีก ${fresh.length - 3} เหรียญ ดูได้ในแท็บ "ออม"`, 'success', 4000);
      return;
    }
    confetti();
    const b = fresh[0];
    toast(`🎖️ ได้เหรียญใหม่: ${b.emoji} ${b.name}${fresh.length > 1 ? ` และอีก ${fresh.length - 1} เหรียญ` : ''}`, 'success', 4500, { label: 'ดู', fn: () => switchTab('goals') });
  }, fxFull() ? 1500 : 400); // ให้ฉลองเป้าหมาย/เหรียญตกจบก่อน
}

function awardBadge(id) {
  if (data.badges[id]) return;
  data.badges[id] = ymd(todayDate());
  save();
  const b = BADGES.find((x) => x.id === id);
  setTimeout(() => {
    if (fxCelebrate(b.emoji, 'ได้เหรียญใหม่!', b.name)) return;
    confetti();
    toast(`🎖️ ได้เหรียญใหม่: ${b.emoji} ${b.name}`, 'success', 4000);
  }, 400);
}

// ---------- พลุกระดาษ ----------
function confetti() {
  if (reduceMotion()) return;
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const colors = ['#10b981', '#f59e0b', '#ec4899', '#6366f1', '#0ea5e9', '#f97316'];
  for (let i = 0; i < 70; i += 1) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
    p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    p.style.animationDelay = `${Math.random() * 0.35}s`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3500);
}

// ---------- ตั้งค่าของส่วนเสริม ----------
function renderExtraSettings() {
  $('quick-settings').innerHTML = data.settings.quick.length
    ? data.settings.quick.map((q) => {
      const c = CATS.find((x) => x.id === q.cat);
      return `<div class="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl pl-3 pr-1 py-1">
        <span>${c.emoji}</span>
        <span class="flex-1 text-sm heading truncate">${escapeHtml(q.name)}</span>
        <span class="text-sm font-medium heading">${fmtMoney(q.amount)}</span>
        <button class="icon-btn" onclick="removeQuick('${q.id}')" aria-label="ลบปุ่ม ${escapeHtml(q.name)}"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>`;
    }).join('')
    : '<p class="text-sm muted">ยังไม่มี ติ๊ก "☆ บันทึกเป็นปุ่มจดด่วน" ตอนจดรายการเพื่อเพิ่ม</p>';
  $('catbudget-list').innerHTML = CATS.map((c) => `<label class="flex items-center gap-3">
      <span class="w-24 text-sm heading shrink-0">${c.emoji} ${c.label}</span>
      <input type="number" inputmode="decimal" min="0" class="input" placeholder="ไม่จำกัด" value="${data.settings.catBudgets[c.id] || ''}" onchange="saveCatBudget('${c.id}', this.value)" />
    </label>`).join('');
}

function renderExtras() {
  renderQuick();
  renderPiggy();
  renderGoals();
  renderExtraSettings();
  checkBadges();
}

// ---------- หมวดในหน้าตั้งค่า: จำว่าเปิดหมวดไหนไว้ ----------
function initSettingGroups() {
  const key = 'pd_groups';
  let open = null;
  try { open = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { open = null; }
  document.querySelectorAll('.set-group').forEach((d) => {
    if (Array.isArray(open)) d.open = open.includes(d.dataset.group);
    d.addEventListener('toggle', () => {
      const now = [...document.querySelectorAll('.set-group')].filter((x) => x.open).map((x) => x.dataset.group);
      try { localStorage.setItem(key, JSON.stringify(now)); } catch (e) { /* ignore */ }
    });
  });
}
