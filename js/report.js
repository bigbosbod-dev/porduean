'use strict';

// =====================================================================
// ส่งออกรายงานรายรับ–รายจ่ายเป็น PDF (เช่น ส่งอาจารย์)
// วิธีทำ: สร้างหน้า A4 เป็น HTML (ให้เบราว์เซอร์จัดตัวอักษรไทยเอง) → ถ่ายเป็นภาพด้วย html2canvas
//         → รวมเป็น PDF ด้วย jsPDF → แชร์/บันทึก (บนไอโฟนจะเปิดหน้าแชร์ให้เลือก "บันทึกไปยังไฟล์")
// ไลบรารีโหลดจาก CDN เฉพาะตอนกดสร้างรายงานครั้งแรก
// =====================================================================
const REPORT_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];
const REPORT_KEY = 'pd_report';
const PAGE_W = 794;   // A4 ที่ 96dpi
const PAGE_H = 1123;

let reportLibs = null;
function loadReportLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (!reportLibs) {
    reportLibs = Promise.all(REPORT_LIBS.map((src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('โหลดตัวสร้าง PDF ไม่สำเร็จ ครั้งแรกต้องต่ออินเทอร์เน็ต')); };
      document.head.appendChild(s);
    }))).catch((e) => { reportLibs = null; throw e; });
  }
  return reportLibs;
}

// ---------- ช่วงเวลา: เลือกได้เป็นรอบ (เดือน) ตั้งแต่รอบที่เริ่มใช้แอป ----------
function reportCycles() {
  const list = [];
  const first = data.startDate ? cycleOf(parseYmd(data.startDate)).startStr : cycleAt(0).startStr;
  for (let i = 0; i > -36; i -= 1) {
    const c = cycleAt(i);
    list.push(c);
    if (c.startStr <= first) break;
  }
  return list; // ล่าสุดก่อน
}

function cycleName(c) {
  // ถ้าเงินเข้าวันที่ 1 ใช้ชื่อเดือนเลย ไม่อย่างนั้นแสดงช่วงวันที่
  if (c.start.getDate() === 1) return fmtDate(c.start, { month: 'long', year: 'numeric' });
  return `${fmtDate(c.start, { day: 'numeric', month: 'short' })} – ${fmtDate(c.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function openReportForm() {
  if (data.settings.income === null) return toast('ตั้งค่ารายรับก่อน แล้วค่อยส่งออกรายงาน', 'error');
  const saved = getStorage(REPORT_KEY, {}) || {};
  const cycles = reportCycles();
  const opts = (sel) => cycles.map((c, i) => `<option value="${c.startStr}" ${i === sel ? 'selected' : ''}>${cycleName(c)}</option>`).join('');
  const field = (id, label, ph) => `<div>
      <label class="label" for="${id}">${label}</label>
      <input id="${id}" class="input" maxlength="60" placeholder="${ph}" value="${escapeHtml(saved[id.replace('rp-', '')] || '')}" />
    </div>`;
  openModal(`${modalHead('📄 ส่งออกรายงาน PDF')}
    <p class="text-sm muted -mt-2 mb-4">ข้อมูลผู้จัดทำจะแสดงบนหน้าแรกของรายงาน ไม่ใส่ก็ได้</p>
    <div class="space-y-3">
      ${field('rp-name', 'ชื่อ–นามสกุล', 'เช่น นายสมชาย ใจดี')}
      <div class="grid grid-cols-2 gap-3">
        ${field('rp-sid', 'รหัสนักศึกษา', 'เช่น 6612345678')}
        ${field('rp-course', 'รายวิชา', 'เช่น การเงินส่วนบุคคล')}
      </div>
      ${field('rp-teacher', 'อาจารย์ผู้สอน', 'เช่น อ.สมหญิง')}
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label" for="rp-from">ตั้งแต่</label><select id="rp-from" class="input">${opts(Math.min(2, cycles.length - 1))}</select></div>
        <div><label class="label" for="rp-to">ถึง</label><select id="rp-to" class="input">${opts(0)}</select></div>
      </div>
      <label class="flex items-center gap-2 text-sm heading cursor-pointer">
        <input id="rp-detail" type="checkbox" class="w-4 h-4 accent-emerald-600" checked /> แนบบัญชีรายรับ–รายจ่ายแบบละเอียดทุกรายการ
      </label>
    </div>
    ${cycles.length < 3 ? `<p class="text-xs muted mt-3">เลือกได้ตั้งแต่รอบที่เริ่มใช้แอป (${cycleName(cycles[cycles.length - 1])})</p>` : ''}
    <div id="rp-status" class="hidden mt-4 text-sm rounded-xl px-3 py-2 bg-slate-100 dark:bg-slate-800 heading"></div>
    <button id="rp-go" class="btn-primary press w-full mt-5 py-3" onclick="exportReport()">📄 สร้าง PDF</button>`);
  pendingPdf = null;
  // แก้ข้อมูลหลังสร้างแล้ว: กลับไปเป็นปุ่ม "สร้าง PDF" จะได้ไม่ส่งไฟล์เก่า
  const reset = () => {
    if (!pendingPdf) return;
    pendingPdf = null;
    const btn = $('rp-go');
    btn.innerHTML = '📄 สร้าง PDF ใหม่';
    btn.onclick = () => exportReport();
    setReportStatus('');
  };
  $('modal-body').addEventListener('input', reset);
  $('modal-body').addEventListener('change', reset);
}

// ---------- ข้อมูลของรายงาน ----------
function ledgerFor(c) {
  const st = data.settings;
  const rows = [];
  const push = (date, item, cat, inc, out, order) => rows.push({ date, item, cat, inc, out, order });
  if (st.income) push(c.startStr, 'เงินรายเดือน', 'รายรับ', st.income, 0, 0);
  st.fixed.forEach((f, i) => push(c.startStr, `${f.name} (ค่าใช้จ่ายประจำ)`, 'ประจำ', 0, f.amount, 1 + i / 100));
  if (st.saving) push(c.startStr, 'กันไว้เป็นเงินออมประจำเดือน', 'ออม', 0, st.saving, 2);
  inCycle(c).forEach((t) => {
    const cat = catOf(t);
    if (t.type === 'income') push(t.date, t.note || 'รายรับเพิ่ม', 'รายรับ', t.amount, 0, 3 + t.createdAt / 1e14);
    else push(t.date, t.note || cat.label, cat.label, 0, t.amount, 3 + t.createdAt / 1e14);
  });
  data.deposits.filter((x) => x.fromBudget && x.date >= c.startStr && x.date <= c.endStr).forEach((x) => {
    const g = data.goals.find((y) => y.id === x.goalId);
    const name = g ? g.name : 'เป้าหมาย';
    if (x.amount > 0) push(x.date, `ออมเข้าเป้าหมาย: ${name}`, 'ออม', 0, x.amount, 4 + x.createdAt / 1e14);
    else push(x.date, `ถอนจากเป้าหมาย: ${name}`, 'ออม', -x.amount, 0, 4 + x.createdAt / 1e14);
  });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let bal = 0;
  rows.forEach((r) => { bal += r.inc - r.out; r.bal = bal; });
  return rows;
}

function reportData(fromStr, toStr) {
  const cycles = reportCycles().filter((c) => c.startStr >= fromStr && c.startStr <= toStr).reverse();
  const today = ymd(todayDate());
  const per = cycles.map((c) => {
    const s = cycleSummary(c);
    const log = dayLog(c).filter((e) => e.key <= today && (!data.startDate || e.key >= data.startDate));
    return {
      c,
      s,
      income: (data.settings.income || 0) + s.extra,
      fixed: fixedTotal(),
      saved: data.settings.saving + s.toGoals,
      left: s.budget - s.spent,
      okDays: log.filter((e) => e.ok).length,
      days: log.length,
      ledger: ledgerFor(c),
      partial: c.endStr >= today,
    };
  });
  const all = (k) => per.reduce((a, p) => a + p[k], 0);
  const cats = CATS.map((cat) => ({ cat, total: per.reduce((a, p) => a + sum(p.s.expenses.filter((t) => t.cat === cat.id)), 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const spent = per.reduce((a, p) => a + p.s.spent, 0);
  const days = all('days');
  return {
    per, cats, spent,
    income: all('income'),
    fixed: all('fixed'),
    saved: all('saved'),
    left: all('left'),
    okDays: all('okDays'),
    days,
    avg: days ? spent / days : 0,
    entries: per.reduce((a, p) => a + p.s.txns.length, 0),
  };
}

// ---------- สร้างหน้า HTML ----------
const money = (n) => (n ? `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '–');
// ตัดข้อความยาวให้พอดีช่อง (นับตามตัวอักษรที่มองเห็น ไม่นับสระบน/ล่าง วรรณยุกต์)
function clip(text, max) {
  const marks = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!marks.test(text[i])) seen += 1;
    if (seen > max) return `${text.slice(0, i).trimEnd()}…`;
  }
  return text;
}
const shortDate = (s) => fmtDate(parseYmd(s), { day: 'numeric', month: 'short', year: '2-digit' });

function pageShell(inner, n, total, info) {
  return `<div class="rpt-page">
    ${inner}
    <div class="rpt-foot"><span>${escapeHtml(info.name || '')}${info.sid ? ` · ${escapeHtml(info.sid)}` : ''}</span><span>หน้า ${n} / ${total}</span></div>
  </div>`;
}

function summaryPage(r, info, range) {
  const maxSpent = Math.max(...r.per.map((p) => p.s.spent), 1);
  const metaRow = (label, value) => (value ? `<tr><td>${label}</td><td>${escapeHtml(value)}</td></tr>` : '');
  const bullets = [];
  bullets.push(`บันทึกรายการทั้งหมด ${r.entries.toLocaleString('th-TH')} รายการ ใน ${r.days} วัน ใช้จ่ายเฉลี่ยวันละ ${money(Math.round(r.avg))} บาท`);
  if (r.cats[0]) bullets.push(`หมวดที่ใช้จ่ายมากที่สุดคือ "${r.cats[0].cat.label}" ${money(r.cats[0].total)} บาท (${Math.round((r.cats[0].total / (r.spent || 1)) * 100)}% ของรายจ่ายที่บันทึก)`);
  if (r.days) bullets.push(`ใช้จ่ายไม่เกินงบประจำวัน ${r.okDays} จาก ${r.days} วัน (${Math.round((r.okDays / r.days) * 100)}%)`);
  if (r.saved > 0) bullets.push(`เก็บออมได้รวม ${money(r.saved)} บาท`);
  bullets.push(r.left >= 0 ? `ภาพรวมใช้จ่ายไม่เกินงบ คงเหลือ ${money(r.left)} บาท` : `ภาพรวมใช้จ่ายเกินงบ ${money(-r.left)} บาท`);
  return `
    <div class="rpt-title">รายงานบันทึกรายรับ–รายจ่าย</div>
    <div class="rpt-sub">ช่วงเวลา ${range}</div>
    <table class="rpt-meta">
      ${metaRow('ชื่อ–นามสกุล', info.name)}${metaRow('รหัสนักศึกษา', info.sid)}${metaRow('รายวิชา', info.course)}${metaRow('อาจารย์ผู้สอน', info.teacher)}
      <tr><td>วันที่จัดทำ</td><td>${fmtDate(todayDate(), { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
    </table>

    <div class="rpt-h">1. สรุปรายเดือน (หน่วย: บาท)</div>
    <table class="rpt-table">
      <thead><tr><th class="l">เดือน / รอบ</th><th>รายรับ</th><th>ค่าใช้จ่ายประจำ</th><th>รายจ่าย</th><th>เงินออม</th><th>คงเหลือ</th></tr></thead>
      <tbody>
        ${r.per.map((p) => `<tr><td class="l">${cycleName(p.c)}${p.partial ? ' *' : ''}</td><td>${money(p.income)}</td><td>${money(p.fixed)}</td><td>${money(p.s.spent)}</td><td>${money(p.saved)}</td><td class="${p.left < 0 ? 'neg' : 'pos'}">${money(p.left)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td class="l">รวม</td><td>${money(r.income)}</td><td>${money(r.fixed)}</td><td>${money(r.spent)}</td><td>${money(r.saved)}</td><td class="${r.left < 0 ? 'neg' : 'pos'}">${money(r.left)}</td></tr></tfoot>
    </table>
    ${r.per.some((p) => p.partial) ? '<div class="rpt-note">* รอบที่ยังไม่สิ้นสุด แสดงข้อมูลถึงวันที่จัดทำรายงาน</div>' : ''}

    <div class="rpt-cols">
      <div>
        <div class="rpt-h">2. รายจ่ายแต่ละเดือน</div>
        <div class="rpt-bars">
          ${r.per.map((p) => `<div class="rpt-bar-row"><span class="rpt-bar-label">${cycleName(p.c)}</span><span class="rpt-bar"><i style="width:${(p.s.spent / maxSpent) * 100}%"></i></span><span class="rpt-bar-val">${money(p.s.spent)}</span></div>`).join('')}
        </div>
      </div>
      <div>
        <div class="rpt-h">3. รายจ่ายตามหมวด</div>
        <table class="rpt-table rpt-compact">
          <tbody>
            ${r.cats.map((x) => `<tr><td class="l"><span class="rpt-dot" style="color:${x.cat.color}">■</span>${x.cat.label}</td><td>${money(x.total)}</td><td class="muted">${Math.round((x.total / (r.spent || 1)) * 100)}%</td></tr>`).join('') || '<tr><td class="l">ยังไม่มีรายจ่าย</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="rpt-h">4. สรุปผล</div>
    <ul class="rpt-list">${bullets.map((b) => `<li><span class="b">•</span>${b}</li>`).join('')}</ul>

    <div class="rpt-sign">
      <div>ลงชื่อ ..................................................... ผู้จัดทำ</div>
      <div>( ${info.name ? escapeHtml(info.name) : '.....................................................'} )</div>
    </div>
    <div class="rpt-src">จัดทำจากข้อมูลที่บันทึกในแอป "พอเดือน" · รายรับประจำและค่าใช้จ่ายประจำใช้ค่าที่ตั้งไว้ในแอป</div>`;
}

// แบ่งบัญชีละเอียดเป็นหลายหน้า โดยนับความสูงของแต่ละบรรทัด
function ledgerPages(r) {
  const ROW = 25;
  const HEAD = 44;
  const SUB = 30;
  const AVAIL = PAGE_H - 96 - 60 - 40; // ขอบ หัวตาราง ท้ายหน้า
  const items = [];
  r.per.forEach((p) => {
    items.push({ h: HEAD, html: `<tr class="rpt-month"><td colspan="6">${cycleName(p.c)}</td></tr>` });
    p.ledger.forEach((x) => items.push({
      h: ROW,
      html: `<tr><td class="l nowrap">${shortDate(x.date)}</td><td class="l item">${escapeHtml(clip(x.item, 24))}</td><td class="l muted">${x.cat}</td><td class="pos">${x.inc ? money(x.inc) : ''}</td><td>${x.out ? money(x.out) : ''}</td><td class="${x.bal < 0 ? 'neg' : ''}">${money(x.bal)}</td></tr>`,
    }));
    const inc = p.ledger.reduce((a, x) => a + x.inc, 0);
    const out = p.ledger.reduce((a, x) => a + x.out, 0);
    items.push({ h: SUB, html: `<tr class="rpt-subtotal"><td class="l" colspan="3">รวม ${cycleName(p.c)}</td><td class="pos">${money(inc)}</td><td>${money(out)}</td><td class="${inc - out < 0 ? 'neg' : ''}">${money(inc - out)}</td></tr>` });
  });
  const pages = [];
  let cur = [];
  let used = 0;
  items.forEach((it) => {
    if (used + it.h > AVAIL && cur.length) { pages.push(cur); cur = []; used = 0; }
    cur.push(it.html);
    used += it.h;
  });
  if (cur.length) pages.push(cur);
  return pages.map((rows, i) => `
    <div class="rpt-h" style="margin-top:0">${i === 0 ? '5. บัญชีรายรับ–รายจ่ายแบบละเอียด (หน่วย: บาท)' : '5. บัญชีรายรับ–รายจ่ายแบบละเอียด (ต่อ)'}</div>
    <table class="rpt-table rpt-ledger">
      <colgroup><col style="width:84px"><col><col style="width:92px"><col style="width:96px"><col style="width:96px"><col style="width:104px"></colgroup>
      <thead><tr><th class="l">วันที่</th><th class="l">รายการ</th><th class="l">หมวด</th><th>รายรับ</th><th>รายจ่าย</th><th>คงเหลือ</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`);
}

function setReportStatus(text) {
  const el = $('rp-status');
  if (!el) return;
  el.classList.toggle('hidden', !text);
  el.textContent = text || '';
}

let exporting = false;
async function exportReport() {
  if (exporting) return;
  const info = {
    name: $('rp-name').value.trim(),
    sid: $('rp-sid').value.trim(),
    course: $('rp-course').value.trim(),
    teacher: $('rp-teacher').value.trim(),
  };
  setStorage(REPORT_KEY, info);
  let from = $('rp-from').value;
  let to = $('rp-to').value;
  if (from > to) [from, to] = [to, from];
  const detail = $('rp-detail').checked;
  const r = reportData(from, to);
  if (!r.per.length) return toast('ไม่มีข้อมูลในช่วงที่เลือก', 'error');
  const range = r.per.length === 1
    ? cycleName(r.per[0].c)
    : `${fmtDate(r.per[0].c.start, { day: 'numeric', month: 'long', year: 'numeric' })} – ${fmtDate((r.per[r.per.length - 1].partial ? todayDate() : r.per[r.per.length - 1].c.end), { day: 'numeric', month: 'long', year: 'numeric' })}`;

  exporting = true;
  pendingPdf = null;
  const btn = $('rp-go');
  btn.disabled = true;
  const wrap = document.createElement('div');
  wrap.className = 'rpt-wrap';
  try {
    setReportStatus('⏳ กำลังโหลดตัวสร้าง PDF...');
    await loadReportLibs();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const inners = [summaryPage(r, info, range), ...(detail ? ledgerPages(r) : [])];
    wrap.innerHTML = inners.map((html, i) => pageShell(html, i + 1, inners.length, info)).join('');
    document.body.appendChild(wrap);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const pages = wrap.querySelectorAll('.rpt-page');
    for (let i = 0; i < pages.length; i += 1) {
      setReportStatus(`🖨️ กำลังสร้างหน้า ${i + 1} จาก ${pages.length}...`);
      // eslint-disable-next-line no-await-in-loop
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      canvas.width = 0; // คืนหน่วยความจำ (สำคัญบนไอโฟน)
    }
    pdf.setProperties({ title: `รายงานรายรับรายจ่าย ${range}`, author: info.name || '', creator: 'พอเดือน' });
    const name = `porduean-report-${from.slice(0, 7)}-to-${to.slice(0, 7)}.pdf`;
    pendingPdf = { blob: pdf.output('blob'), name };
    setReportStatus(`✓ สร้างเสร็จ ${pages.length} หน้า (${(pendingPdf.blob.size / 1024 / 1024).toFixed(1)} MB) กดปุ่มด้านล่างเพื่อบันทึกหรือส่งต่อ`);
    // ไอโฟนเปิดหน้าแชร์ได้เฉพาะตอนที่นิ้วเพิ่งแตะ จึงให้แตะปุ่มนี้อีกครั้ง
    btn.innerHTML = '📤 บันทึก / แชร์ PDF';
    btn.onclick = () => deliverPdf();
    replay(btn, 'pop');
  } catch (err) {
    console.warn('report failed', err);
    setReportStatus(`สร้าง PDF ไม่สำเร็จ: ${err && err.message ? err.message : err}`);
  } finally {
    wrap.remove();
    exporting = false;
    btn.disabled = false;
  }
}

// บนมือถือเปิดหน้าแชร์ (บันทึกไปยังไฟล์ / LINE / อีเมล) ถ้าทำไม่ได้ให้ดาวน์โหลดตรง ๆ
let pendingPdf = null;
async function deliverPdf() {
  if (!pendingPdf) return;
  const { blob, name } = pendingPdf;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'รายงานรายรับ–รายจ่าย' });
      toast('ส่งออก PDF แล้ว 📄', 'success');
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast(`แชร์ไม่สำเร็จ: ${err && err.message ? err.message : err}`, 'error', 5000);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('ดาวน์โหลด PDF แล้ว 📄', 'success');
}
