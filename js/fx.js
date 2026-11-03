'use strict';

// =====================================================================
// ลูกเล่นอนิเมชันโหมด "จัดเต็ม"
//   ระดับอนิเมชัน (pd_motion): full = จัดเต็ม, normal = ปกติ (เฉพาะอนิเมชันพื้นฐาน), off = ปิด
//   ถ้าเครื่องตั้ง "ลดการเคลื่อนไหว" ไว้ ทุกอย่างในไฟล์นี้จะไม่ทำงาน
// ไฟล์นี้โหลดก่อน app.js ฟังก์ชันจึงใช้ของใน app.js ได้ตอนทำงานจริงเท่านั้น
// =====================================================================
const MOTION_KEY = 'pd_motion';
const TAB_ORDER = ['home', 'history', 'goals', 'settings'];

function motionLevel() {
  let v = 'full';
  try { v = JSON.parse(localStorage.getItem(MOTION_KEY) || '"full"'); } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  return ['full', 'normal', 'off'].includes(v) ? v : 'full';
}
const systemReduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fxFull = () => motionLevel() === 'full' && !systemReduce();

function applyMotion() {
  const level = motionLevel();
  const root = document.documentElement;
  root.classList.toggle('fx-full', level === 'full' && !systemReduce());
  root.classList.toggle('fx-off', level === 'off');
  document.querySelectorAll('[data-motion-opt]').forEach((b) => b.classList.toggle('active', b.dataset.motionOpt === level));
}

function setMotion(level) {
  try { localStorage.setItem(MOTION_KEY, JSON.stringify(level)); } catch (e) { /* ignore */ }
  applyMotion();
  if (level === 'full' && fxFull()) {
    confetti();
    toast('✨ เปิดอนิเมชันแบบจัดเต็มแล้ว!', 'success', 2000);
  } else {
    toast(level === 'off' ? 'ปิดอนิเมชันแล้ว' : 'ใช้อนิเมชันแบบปกติ', 'info', 1500);
  }
}

// ---------- สลับแท็บ: เลื่อนตามทิศ ----------
function fxPanelClass(prev, next) {
  if (!fxFull() || !prev) return 'panel-in';
  return TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(prev) ? 'panel-in-r' : 'panel-in-l';
}

// ตัวเลื่อนใต้แท็บที่เลือก
function moveTabIndicator() {
  const ind = $('tab-ind');
  const btn = document.querySelector('.bottom-tab.active');
  if (!ind || !btn) return;
  // วางให้ตรงกลางไอคอนพอดี
  const icon = btn.querySelector('svg');
  const w = 56;
  const h = 30;
  const cx = btn.offsetLeft + btn.offsetWidth / 2;
  const cy = icon ? icon.offsetTop + icon.getBoundingClientRect().height / 2 : 18;
  ind.style.width = `${w}px`;
  ind.style.height = `${h}px`;
  ind.style.top = `${btn.offsetTop + cy - h / 2}px`;
  ind.style.transform = `translateX(${cx - w / 2}px)`;
  ind.classList.add('ready');
}

// ---------- ระลอกน้ำเมื่อแตะปุ่ม ----------
const RIPPLE_TARGETS = '.btn-primary,.btn-secondary,.chip,.quick-chip,.bottom-tab,#fab,.badge-tile,.row-btn,.theme-opt,.seg';
function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (!fxFull()) return;
    const el = e.target.closest(RIPPLE_TARGETS);
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.left = `${e.clientX - r.left - size / 2}px`;
    s.style.top = `${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.classList.add('ripple-host');
    el.appendChild(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
  }, { passive: true });
}

// ---------- ของบินจากจุดหนึ่งไปอีกจุด (โค้งขึ้นแล้วตกลง) ----------
function fxFly(from, toEl, text, { delay = 0, size = 28, onArrive } = {}) {
  if (!fxFull() || !toEl) return;
  const a = from instanceof Element ? from.getBoundingClientRect() : from;
  const b = toEl.getBoundingClientRect();
  if (!b.width || !a) return;
  const el = document.createElement('div');
  el.className = 'fly';
  el.style.fontSize = `${size}px`;
  el.textContent = text;
  document.body.appendChild(el);
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2;
  const y1 = b.top + b.height / 2;
  const lift = Math.min(160, 60 + Math.abs(y1 - y0) * 0.25);
  const anim = el.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(0.5) rotate(0deg)`, opacity: 0 },
    { transform: `translate(${x0 + (x1 - x0) * 0.35}px, ${Math.min(y0, y1) - lift}px) scale(1.35) rotate(-20deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${x1}px, ${y1}px) scale(0.45) rotate(15deg)`, opacity: 0.3 },
  ], { duration: 800, delay, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'backwards' });
  anim.onfinish = () => {
    el.remove();
    replay(toEl, 'num-hit');
    if (onArrive) onArrive();
  };
}

// เหรียญตกลงกระปุก
function fxCoinRain(target, count = 8) {
  if (!fxFull() || !target) return;
  const r = target.getBoundingClientRect();
  if (!r.width) return;
  for (let i = 0; i < count; i += 1) {
    const from = { left: r.left + Math.random() * r.width, top: Math.max(0, r.top - 120 - Math.random() * 80), width: 0, height: 0 };
    fxFly(from, target, '🪙', {
      delay: i * 90,
      size: 22,
      onArrive: i === count - 1 ? () => replay(target, 'pig-jump') : null,
    });
  }
}

// เงินปลิวออกจากการ์ดตอนใช้เกินงบ
function fxMoneyAway(card) {
  if (!fxFull() || !card) return;
  const r = card.getBoundingClientRect();
  for (let i = 0; i < 7; i += 1) {
    const el = document.createElement('div');
    el.className = 'fly';
    el.style.fontSize = `${22 + Math.random() * 12}px`;
    el.textContent = i % 3 ? '💸' : '🪙';
    document.body.appendChild(el);
    const x0 = r.left + r.width * (0.25 + Math.random() * 0.5);
    const y0 = r.top + r.height * 0.45;
    const dx = (Math.random() - 0.5) * 320;
    const dy = -160 - Math.random() * 200;
    el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.4) rotate(0)`, opacity: 0 },
      { transform: `translate(${x0 + dx * 0.3}px, ${y0 + dy * 0.3}px) scale(1.2) rotate(${dx / 6}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(0.8) rotate(${dx / 2}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 500, delay: i * 70, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)', fill: 'backwards' })
      .onfinish = () => el.remove();
  }
}

// ---------- ฉลองเต็มจอ (เหรียญใหม่ / เป้าหมายสำเร็จ) ----------
const celebrateQueue = [];
let celebrating = false;
function fxCelebrate(emoji, title, sub) {
  if (!fxFull()) return false;
  celebrateQueue.push({ emoji, title, sub });
  if (!celebrating) nextCelebrate();
  return true;
}
function nextCelebrate() {
  const c = celebrateQueue.shift();
  if (!c) { celebrating = false; return; }
  celebrating = true;
  const o = document.createElement('div');
  o.className = 'celebrate';
  o.innerHTML = `<div class="celebrate-box">
      <div class="celebrate-rays"></div>
      <div class="celebrate-emoji">${c.emoji}</div>
      <div class="celebrate-title">${escapeHtml(c.title)}</div>
      <div class="celebrate-sub">${escapeHtml(c.sub)}</div>
      <div class="celebrate-tap">แตะเพื่อปิด</div>
    </div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    o.classList.add('out');
    setTimeout(() => { o.remove(); nextCelebrate(); }, 280);
  };
  o.addEventListener('click', close);
  document.body.appendChild(o);
  confetti();
  setTimeout(close, 3400);
}

// ---------- หน้าต้อนรับตอนเปิดแอป (ครั้งเดียวต่อการเปิด) ----------
function fxSplash() {
  if (!fxFull()) return;
  try {
    if (sessionStorage.getItem('pd_splash')) return;
    sessionStorage.setItem('pd_splash', '1');
  } catch (e) { return; }
  const o = document.createElement('div');
  o.className = 'splash';
  o.innerHTML = `<div class="splash-pig">${piggySvg(new Date().getHours() >= 22 || new Date().getHours() < 6 ? 'sleep' : 'party')}</div>
    <div class="splash-title">พอเดือน</div>
    <div class="splash-sub">ใช้เงินพอดี อยู่รอดทั้งเดือน</div>`;
  const close = () => {
    if (o.classList.contains('out')) return;
    o.classList.add('out');
    setTimeout(() => o.remove(), 400);
    // ต้อนรับเสร็จ หมูทักทาย
    setTimeout(() => { if (data.settings.income !== null) showPiggyBubble(piggyMessages()[0]); }, 500);
  };
  o.addEventListener('click', close);
  document.body.appendChild(o);
  setTimeout(close, 1300);
}

// ---------- ลบรายการ: แถวยุบหายไปก่อน ----------
function fxRemoveRow(id, done) {
  const el = currentTab && document.querySelector(`#tab-${currentTab} [data-row="${id}"]`);
  if (!el || reduceMotion()) { done(); return; }
  el.style.overflow = 'hidden';
  el.animate([
    { opacity: 1, transform: 'none', height: `${el.offsetHeight}px` },
    { opacity: 0, transform: 'translateX(60px)', height: `${el.offsetHeight}px`, offset: 0.55 },
    { opacity: 0, transform: 'translateX(60px)', height: '0px', paddingTop: '0px', paddingBottom: '0px' },
  ], { duration: 420, easing: 'ease-in' }).onfinish = done;
}

function initFx() {
  applyMotion();
  initRipple();
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyMotion);
  window.addEventListener('resize', moveTabIndicator);
  fxSplash();
}
