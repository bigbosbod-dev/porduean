'use strict';

// =====================================================================
// สแกนสลิปโอนเงิน: อ่านตัวเลขจากรูปด้วย Tesseract.js (OCR ที่ทำงานในเครื่องเอง ไม่ส่งรูปไปไหน)
// ครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อโหลดตัวอ่าน (~5MB) หลังจากนั้นเบราว์เซอร์จะเก็บไว้ให้
// ใช้ชุดภาษาอังกฤษเพราะต้องการแค่ตัวเลข (ชุดภาษาไทยใหญ่กว่ามาก)
// =====================================================================
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let tessLoading = null;
let tessWorker = null;
let ocrProgress = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tessLoading) {
    tessLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = resolve;
      s.onerror = () => {
        tessLoading = null;
        s.remove();
        reject(new Error('โหลดตัวอ่านสลิปไม่สำเร็จ ครั้งแรกต้องต่ออินเทอร์เน็ต'));
      };
      document.head.appendChild(s);
    });
  }
  return tessLoading;
}

async function getOcrWorker() {
  await loadTesseract();
  if (!tessWorker) {
    tessWorker = await window.Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (ocrProgress) ocrProgress(m); },
    });
  }
  return tessWorker;
}

// ย่อรูปให้ไม่ใหญ่เกิน แปลงเป็นขาวดำและเพิ่มความคมชัด ให้อ่านตัวเลขได้แม่นขึ้น
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('เปิดรูปนี้ไม่ได้'));
      im.src = url;
    });
    const maxW = 1400;
    const scale = img.width > maxW ? maxW / img.width : img.width < 700 ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.4 + 128));
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
    ctx.putImageData(px, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// หาจำนวนเงินจากข้อความ: ตัวเลขที่มีทศนิยม 2 ตำแหน่ง (เช่น 1,250.00)
// ให้คะแนนเพิ่มถ้าอยู่บรรทัดเดียวกับคำว่า Amount/THB/Baht หรือมีจุลภาคคั่นหลักพัน
// ไม่นับ 0.00 (ค่าธรรมเนียม) และเวลาอย่าง 09.24
function parseSlipAmount(text) {
  const cands = [];
  text.split(/\n+/).forEach((raw) => {
    const line = raw
      .replace(/(?<=\d)[oO](?=[\d.,])/g, '0')
      .replace(/(?<=\d)\s*([.,])\s*(?=\d)/g, '$1');
    const re = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d])/g;
    let m;
    while ((m = re.exec(line))) {
      const value = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
      if (!(value > 0) || value > 5000000) continue;
      const looksLikeTime = !m[1].includes(',') && /^\d{1,2}$/.test(m[1]) && Number(m[1]) < 24 && Number(m[2]) < 60
        && /\d{1,2}\.\d{2}\s*(?:น|n|u|N)/.test(line.slice(m.index, m.index + 10));
      if (looksLikeTime) continue;
      let score = 1;
      if (/amount|thb|baht|total|จำนวน|บาท/i.test(line)) score += 3;
      if (m[1].includes(',')) score += 2;
      cands.push({ value, score });
    }
  });
  if (!cands.length) return null;
  const freq = {};
  cands.forEach((c) => { freq[c.value] = (freq[c.value] || 0) + 1; });
  cands.forEach((c) => { c.score += freq[c.value] - 1; });
  cands.sort((a, b) => b.score - a.score || b.value - a.value);
  return cands[0].value;
}

function setScanStatus(text, kind = 'info') {
  const el = $('scan-status');
  if (!text) { el.classList.add('hidden'); return; }
  const styles = {
    info: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200',
    error: 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200',
  };
  el.className = `mt-2 text-sm rounded-xl px-3 py-2 ${styles[kind]}`;
  el.textContent = text;
}

let scanning = false;
async function scanSlip(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file || scanning) return;
  scanning = true;
  const btn = $('scan-btn');
  btn.disabled = true;
  btn.classList.add('opacity-60');
  setScanStatus('⏳ กำลังเตรียมตัวอ่านสลิป...');
  ocrProgress = (m) => {
    if (m.status === 'recognizing text') setScanStatus(`🔍 กำลังอ่านสลิป ${Math.round((m.progress || 0) * 100)}%`);
    else if (/load|initializ/i.test(m.status)) setScanStatus('⏳ กำลังโหลดตัวอ่านสลิป (ครั้งแรกอาจใช้เวลาสักครู่)...');
  };
  try {
    const [worker, image] = await Promise.all([getOcrWorker(), prepareImage(file)]);
    const { data: result } = await worker.recognize(image);
    const amount = parseSlipAmount(result.text || '');
    if (amount === null) {
      setScanStatus('อ่านจำนวนเงินจากรูปนี้ไม่เจอ ลองครอปให้เห็นยอดเงินชัด ๆ หรือกรอกเองได้เลย', 'error');
      return;
    }
    $('sheet-amount').value = amount;
    if (!$('sheet-note').value.trim()) $('sheet-note').value = 'โอนเงิน (สลิป)';
    updateSheetPreview();
    replay($('sheet-amount'), 'pop');
    setScanStatus(`✓ อ่านได้ ${fmtMoney(amount)} ตรวจตัวเลขให้ถูกก่อนกดบันทึกนะ`, 'ok');
    awardBadge('scan');
  } catch (err) {
    console.warn('scan failed', err);
    setScanStatus(err && err.message ? err.message : 'อ่านสลิปไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
  } finally {
    ocrProgress = null;
    scanning = false;
    btn.disabled = false;
    btn.classList.remove('opacity-60');
  }
}
