/* Генератор ИД — загрузка документов: договоры, сертификаты, счета, Excel-таблицы.
   Офлайн: Excel/CSV (сопоставление столбцов), текстовые PDF и Word (поиск по шаблонам).
   ИИ (Claude API, ключ пользователя): сканы, фото, сложные документы. */
(function () {
  'use strict';
  const C = window.IDCore;
  const KEY_STORE = 'idgen.ai';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
  const MODEL = 'claude-opus-5-5';

  let A, UI; // IDApp и его помощники интерфейса
  const queue = [];      // загруженные файлы: {id, name, status, note, proposals[], excel?}
  let aiSettings = { key: '', enabled: false };
  try { aiSettings = Object.assign(aiSettings, JSON.parse(localStorage.getItem(KEY_STORE) || '{}')); } catch (e) { /* нет хранилища */ }
  const saveAi = () => { try { localStorage.setItem(KEY_STORE, JSON.stringify(aiSettings)); } catch (e) { } };
  const aiOn = () => aiSettings.enabled && !!aiSettings.key;

  // ================= общие помощники =================
  const MONTHS = { 'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'мая': 5, 'май': 5, 'июн': 6, 'июл': 7, 'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12 };
  const pad = n => ('0' + n).slice(-2);
  // любая дата → YYYY-MM-DD или ''
  function iso(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return '';
      const d = new Date(Math.round((v - 25569) * 864e5));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const t = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/.exec(t);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
    m = /«?\s*(\d{1,2})\s*»?\s+([а-яё]{3,})\s+(\d{4})/i.exec(t);
    if (m) { const mm = MONTHS[m[2].toLowerCase().slice(0, 3)]; if (mm) return m[3] + '-' + pad(mm) + '-' + pad(+m[1]); }
    return '';
  }
  const str = v => (v === null || v === undefined) ? '' : String(v).replace(/\s+/g, ' ').trim();
  const norm = t => str(t).toLowerCase().replace(/[«»"']/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const numStr = v => { const s = str(v).replace(/\s/g, '').replace(',', '.'); return s && isFinite(+s) ? +s : ''; };
  const readBuf = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(f); });
  function b64(buf) {
    const bytes = new Uint8Array(buf); let s = ''; const ch = 0x8000;
    for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
    return btoa(s);
  }
  const ext = name => (name.split('.').pop() || '').toLowerCase();

  // ================= извлечение текста =================
  // PDF → страницы → строки с координатами слов (нужно для разбора таблиц счетов)
  async function pdfText(buf) {
    await UI.loadScript('vendor/pdfjs.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }));
      pages.push(groupLines(items));
    }
    const text = pages.map(ls => ls.map(l => l.text).join('\n')).join('\n\n');
    const n = pdf.numPages;
    pdf.destroy();
    return { text, pages: n, layout: pages };
  }
  // ---------- OCR сканов и фото (tesseract.js, работает на устройстве) ----------
  let ocrWorkerP = null, ocrProgress = null;
  const abs = p => new URL(p, location.href).href;
  async function ocrImages(images, onProgress) {
    await UI.loadScript('vendor/tesseract/tesseract.min.js');
    if (!ocrWorkerP) {
      ocrWorkerP = Tesseract.createWorker(['rus', 'eng'], 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/'),
        langPath: abs('vendor/tesseract/lang'),
        workerBlobURL: false,
        logger: m => { if (ocrProgress && m.status === 'recognizing text') ocrProgress(m.progress); }
      });
      ocrWorkerP.catch(() => { ocrWorkerP = null; });
    }
    const W = await ocrWorkerP;
    const report = (i, p, stage) => onProgress && onProgress((i + p) / images.length, stage);
    const rec = async (img, i, from, span, stage, withLayout) => {
      ocrProgress = p => report(i, from + p * span, stage);
      const { data } = await W.recognize(img, {}, withLayout ? { text: true, blocks: true } : { text: true });
      return { text: data.text, conf: data.confidence, layout: withLayout ? ocrLayout(data, img) : null };
    };
    let text = '';
    const layout = [];
    for (let i = 0; i < images.length; i++) {
      let img = toCanvas(images[i]);
      // 1. ориентация: сертификаты на металл с сайтов часто лежат боком
      const dir = lineDir(img);
      if (dir !== 'h') {
        const angles = dir === 'v' ? [90, 270] : [0, 90, 180, 270];
        let best = null;
        for (let k = 0; k < angles.length; k++) {
          const r = await rec(probeCanvas(img, angles[k]), i, 0.3 * k / angles.length, 0.3 / angles.length, 'определяю поворот');
          if (!best || r.conf > best.conf) best = { a: angles[k], conf: r.conf };
        }
        if (best.a) img = rotateCanvas(img, best.a);
      }
      // 2. основной проход
      let main = await rec(img, i, 0.3, 0.35, 'распознаю', true);
      // 3. слабая страница: перевёрнута вверх ногами? другой фильтр (цветной фон бланка и синие печати → белое)
      if (main.conf < 45) {
        // густая сетка таблицы (УПД боком) сбивает определение направления строк — пробуем все повороты на уменьшенной копии
        const tries = [0, 90, 180, 270];
        let best = null;
        for (let k = 0; k < tries.length; k++) {
          const r = await rec(probeCanvas(img, tries[k]), i, 0.65 + 0.1 * k / tries.length, 0.1 / tries.length, 'проверяю поворот');
          if (!best || r.conf > best.conf) best = { a: tries[k], conf: r.conf };
        }
        if (best && best.a && best.conf > 50) {
          img = rotateCanvas(img, best.a);
          main = await rec(img, i, 0.75, 0.05, 'распознаю', true);
        }
      }
      let extra = null;
      // второй проход — только если страница слабая и номер документа в ней не нашёлся (экономит 10–20 с на странице)
      if (main.conf < 70 && (i === 0 ? !findDocNumbers(main.text).length : main.conf < 50)) extra = await rec(cleanBackground(img), i, 0.8, 0.2, 'второй проход', true);
      // текст лучшего прохода первым — по нему ищутся поля; второй добавляем для поиска номеров и дат
      const passes = [main, extra].filter(Boolean).sort((a, b) => b.conf - a.conf);
      text += passes.map(p => p.text).join('\n——— второй проход ———\n') + '\n';
      layout.push(passes[0].layout || []);
    }
    ocrProgress = null;
    return { text, layout };
  }
  // слова OCR с координатами → строки в формате pdfText (для разбора таблиц счетов и УПД с фото).
  // Фото снято с перекосом: выравниваем по наклону базовых линий; пиксели переводим в «пункты», как в PDF
  // (высота слова ≈ 7 пт), чтобы работали те же допуски, что для текстовых PDF.
  // горизонтальные линии сетки таблицы (вдоль наклона k): y в координатах «выровненного» листа, пиксели
  function ruleLines(src, k) {
    const f = Math.min(1, 1200 / src.width);
    const w = Math.round(src.width * f), h = Math.round(src.height * f);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let sum = 0;
    const g = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0; sum += g[i]; }
    const thr = Math.min(140, sum / (w * h) * 0.7);
    const rows = [];
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let xx = 0; xx < w; xx += 2) {
        const yy = Math.round(y + k * xx);
        if (yy < 0 || yy >= h) continue;
        // линия толщиной в 1–2 пикселя: смотрим и соседний ряд
        if (g[yy * w + xx] < thr || (yy + 1 < h && g[(yy + 1) * w + xx] < thr)) n++;
      }
      rows.push(n / (w / 2));
    }
    const out = [];
    for (let y = 0; y < h; y++) {
      if (rows[y] < 0.4) continue;
      let e = y; while (e + 1 < h && rows[e + 1] >= 0.4) e++;
      out.push(((y + e) / 2) / f);
      y = e;
    }
    return out;
  }
  function ocrLayout(data, img) {
    const words = [], slopes = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => {
      const bl = l.baseline;
      if (bl && bl.x1 - bl.x0 > 150) slopes.push((bl.y1 - bl.y0) / (bl.x1 - bl.x0));
      (l.words || []).forEach(w => {
        if (w.confidence <= 15) return;
        // рамки ячеек OCR читает как | [ ] — режем по ним слово («0,433|22%» → «0,433» и «22%»)
        const raw = String(w.text || ''), cw = (w.bbox.x1 - w.bbox.x0) / Math.max(1, raw.length);
        let pos = 0;
        raw.split(/([|\[\]{}]+)/).forEach(part => {
          const x0 = w.bbox.x0 + pos * cw; pos += part.length;
          const s = part.replace(/^[_—=]+|[_—=]+$/g, '').trim();
          // точки, запятые, кавычки от грязи на фото — не слова
          if (s && /[0-9A-Za-zА-Яа-яЁё№%]/.test(s)) words.push({ s, x0, x1: x0 + part.length * cw, y0: w.bbox.y0, y1: w.bbox.y1 });
        });
      });
    })));
    if (!words.length) return [];
    slopes.sort((a, b) => a - b);
    const k = slopes.length ? slopes[slopes.length >> 1] : 0;
    const hs = words.map(w => w.y1 - w.y0).sort((a, b) => a - b);
    const h = Math.max(4, hs[hs.length >> 1]);
    const sc = 7 / h;
    const its = words.map(w => ({ yc: (w.y0 + w.y1) / 2 - k * (w.x0 + w.x1) / 2, x: w.x0 * sc, w: (w.x1 - w.x0) * sc, s: w.s })).sort((a, b) => a.yc - b.yc);
    const lines = [];
    its.forEach(it => {
      const l = lines[lines.length - 1];
      if (l && Math.abs(it.yc - l.sum / l.items.length) < h * 0.5) { l.items.push(it); l.sum += it.yc; }
      else lines.push({ items: [it], sum: it.yc });
    });
    const out = lines.map(l => {
      const y = -Math.round(l.sum / l.items.length * sc * 10) / 10;
      const items = l.items.sort((a, b) => a.x - b.x).map(it => ({ x: it.x, y, w: it.w, s: it.s }));
      // одиночные буквы с края листа (соседний лист, тень) перед далёким текстом — мусор: из-за них не находится «Продавец:»
      while (items.length > 1 && items[0].s.length <= 2 && !/\d/.test(items[0].s) && items[1].x - (items[0].x + items[0].w) > 30) items.shift();
      return { y, items, text: joinItems(items) };
    }).sort((a, b) => b.y - a.y);
    out.ocr = true;
    // линии сетки → в те же «пункты», что и строки
    try { out.rules = img ? ruleLines(img, k).map(y => -Math.round(y * sc * 10) / 10) : []; } catch (e) { out.rules = []; }
    return out;
  }
  function toCanvas(src) {
    if (src instanceof HTMLCanvasElement) return src;
    const c = document.createElement('canvas'); c.width = src.naturalWidth || src.width; c.height = src.naturalHeight || src.height;
    c.getContext('2d').drawImage(src, 0, 0); return c;
  }
  function loadImage(file) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { res(im); }; im.onerror = () => rej(new Error('Не удалось открыть картинку')); im.src = u; });
  }
  // проба поворота: центр листа в исходном разрешении (у уменьшенного целого листа мелкий текст УПД нечитаем)
  function probeCanvas(src, deg) {
    const s = Math.min(1400, src.width, src.height);
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, s, s);
    return rotateCanvas(c, deg);
  }
  function rotateCanvas(src, deg, maxSide) {
    const sc = Math.min(1, (maxSide || 1e9) / Math.max(src.width, src.height));
    const w = Math.round(src.width * sc), h = Math.round(src.height * sc);
    const c = document.createElement('canvas'); const swap = deg % 180 !== 0;
    c.width = swap ? h : w; c.height = swap ? w : h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(src, -w / 2, -h / 2, w, h);
    return c;
  }
  // направление строк по профилю тёмных пикселей: 'h' — строки горизонтальные, 'v' — повёрнуто на 90°, '?' — неясно
  function lineDir(src) {
    const sc = 800 / Math.max(src.width, src.height);
    const w = Math.max(1, Math.round(src.width * sc)), h = Math.max(1, Math.round(src.height * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h); let sum = 0;
    for (let i = 0; i < w * h; i++) { g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; sum += g[i]; }
    const thr = Math.min(160, sum / (w * h) * 0.75);
    const rows = new Float32Array(h), cols = new Float32Array(w);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (g[yy * w + xx] < thr) { rows[yy]++; cols[xx]++; }
    const rough = a => { let s = 0, m = 0; for (let i = 1; i < a.length; i++) s += (a[i] - a[i - 1]) ** 2; for (let i = 0; i < a.length; i++) m += a[i]; return s / Math.max(1, m); };
    const rr = rough(rows), cc = rough(cols);
    return cc > rr * 1.3 ? 'v' : rr > cc * 1.3 ? 'h' : '?';
  }
  // серый по максимальному каналу + растяжка контраста: цветная сетка бланка и синие печати/подписи становятся белыми
  function cleanBackground(src) {
    const w = src.width, h = src.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    const id = x.getImageData(0, 0, w, h), d = id.data, n = w * h;
    const g = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const v = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); g[i] = v; hist[v]++; }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) { const v = (g[i] - lo) * k; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    return c;
  }
  // страницы PDF → картинки для распознавания. У скана берём саму картинку страницы (быстрее и в исходном
  // разрешении); если картинки нет — рисуем страницу целиком.
  async function pdfImages(buf, maxPages) {
    await UI.loadScript('vendor/pdfjs.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const out = [];
    try {
      for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
        const page = await pdf.getPage(n);
        const img = await pageImage(page);
        if (img) { out.push(img); continue; }
        const v1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(4, 2000 / v1.width) });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await Promise.race([page.render({ canvasContext: ctx, viewport: vp }).promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Не удалось отрисовать страницу PDF')), 60000))]);
        out.push(cv);
      }
    } finally { pdf.destroy(); }
    return out;
  }
  async function pageImage(page) {
    const ops = await page.getOperatorList();
    const O = pdfjsLib.OPS;
    const names = [];
    ops.fnArray.forEach((fn, i) => { if (fn === O.paintImageXObject || fn === O.paintJpegXObject) names.push(ops.argsArray[i][0]); });
    let best = null;
    for (const nm of names) {
      const store = nm.startsWith('g_') ? page.commonObjs : page.objs;
      const obj = await new Promise(res => { try { store.get(nm, res); } catch (e) { res(null); } });
      if (obj && obj.width && (!best || obj.width * obj.height > best.width * best.height)) best = obj;
    }
    if (!best || best.width < 600) return null;
    const scale = Math.min(1, 3000 / best.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(best.width * scale); cv.height = Math.round(best.height * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (best.bitmap) { ctx.drawImage(best.bitmap, 0, 0, cv.width, cv.height); return cv; }
    if (!best.data) return null;
    // данные картинки: 1 бит/пиксель, RGB или RGBA → RGBA
    const full = document.createElement('canvas'); full.width = best.width; full.height = best.height;
    const id = full.getContext('2d').createImageData(best.width, best.height);
    const src = best.data, dst = id.data, px = best.width * best.height;
    if (best.kind === 3) dst.set(src.subarray(0, dst.length));
    else if (best.kind === 2) for (let i = 0, j = 0; i < px; i++, j += 3) { dst[i * 4] = src[j]; dst[i * 4 + 1] = src[j + 1]; dst[i * 4 + 2] = src[j + 2]; dst[i * 4 + 3] = 255; }
    else {
      const rowBytes = (best.width + 7) >> 3;
      for (let y = 0; y < best.height; y++) for (let x = 0; x < best.width; x++) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0, k = (y * best.width + x) * 4;
        dst[k] = dst[k + 1] = dst[k + 2] = v; dst[k + 3] = 255;
      }
    }
    full.getContext('2d').putImageData(id, 0, 0);
    if (scale === 1) return full;
    ctx.drawImage(full, 0, 0, cv.width, cv.height);
    return cv;
  }
  // скан: мало «настоящего» текста (без колонтитулов браузера с адресом страницы и временем печати)
  function looksScanned(text, pages) {
    const real = text.split('\n').filter(l => !/https?:|www\.|\.ru\/|\d{2}\.\d{2}\.\d{4},?\s+\d{1,2}:\d{2}/i.test(l)).join('').replace(/\s/g, '');
    return real.length < 120 * pages;
  }

  // ---------- имя файла: «Арматура 10 мм №26019410 от 10.08.2026.pdf» ----------
  function fromFileName(name) {
    const base = name.replace(/\.[^.]+$/, '').replace(/\(\d+\)/g, ' ').replace(/\s+/g, ' ').trim();
    const r = { name: '', doc_no: '', doc_date: '', doc_until: '', doc_type: '' };
    const no = /№\s*(.+?)(?=\s+(?:от|с)\s+\d|$)/i.exec(base);
    if (no) r.doc_no = no[1].trim().replace(/_/g, '/');
    const from = /(?:от|с)\s+(\d{1,2}[._]\d{1,2}[._]\d{2,4})/i.exec(base);
    if (from) r.doc_date = iso(from[1].replace(/_/g, '.'));
    const until = /(?:по|до)\s+(\d{1,2}[._]\d{1,2}[._]\d{2,4})/i.exec(base);
    if (until) r.doc_until = iso(until[1].replace(/_/g, '.'));
    const low = base.toLowerCase();
    if (/свидетельств/.test(low)) r.doc_type = 'Свидетельство о государственной регистрации';
    else if (/паспорт/.test(low)) r.doc_type = 'Паспорт качества';
    else if (/деклар/.test(low)) r.doc_type = 'Декларация о соответствии';
    else if (/пожарн/.test(low)) r.doc_type = 'Сертификат пожарной безопасности';
    else if (/экспертн/.test(low)) r.doc_type = 'Экспертное заключение';
    else if (/отказн/.test(low)) r.doc_type = 'Отказное письмо';
    r.name = base.split('№')[0].replace(/\([^)]*\)/g, ' ').replace(/^(сертификат[а-яё]*|паспорт[а-яё]*|декларац[а-яё]*)\s+(?=\S)/i, '')
      .replace(/(^|,?\s+)(паспорт|сертификат[а-яё]*|декларац[а-яё]*|свидетельств[а-яё]*|пожарный|экспертное заключение|отказное|гост)(?=[\s,.(]|$).*$/i, '')
      .replace(/^\d+[\s_-]+/, '').replace(/[_\s]+/g, ' ').replace(/[,\s]+$/, '').trim();
    if (/^\d[\d\s]*$/.test(r.name)) r.name = ''; // имя файла вида «2_5265179865337866507»
    // вставка из буфера и типовые имена фото/скриншотов ничего не говорят о материале
    if (/^(Скриншот|Вставленный текст|Снимок экрана|Screenshot|Screen Shot|image|IMG|photo|Photo|scan|Scan|WhatsApp|Telegram)/i.test(base)) { r.name = ''; r.doc_date = ''; }
    return r;
  }
  // ---------- номера документов по их структуре: в позициях цифр — цифры, в позициях букв — буквы ----------
  const TO_DIG = { 'О': '0', 'O': '0', 'о': '0', 'o': '0', 'D': '0', 'Q': '0', 'З': '3', 'з': '3', 'I': '1', 'l': '1', '|': '1', '!': '1', 'i': '1', 'S': '5', 's': '5', 'B': '8', 'В': '8', 'Б': '6', 'б': '6', 'Ч': '4', 'G': '6', 'Z': '2' };
  const TO_LET = { '0': 'О', '3': 'З', '8': 'В', '6': 'Б', '4': 'Ч', 'A': 'А', 'B': 'В', 'E': 'Е', 'K': 'К', 'M': 'М', 'H': 'Н', 'O': 'О', 'P': 'Р', 'C': 'С', 'T': 'Т', 'X': 'Х', 'Y': 'У', 'N': 'И', 'R': 'Я' };
  const dig = s => { const r = String(s).split('').map(c => /\d/.test(c) ? c : (TO_DIG[c] || '?')).join(''); return /^\d+$/.test(r) ? r : null; };
  const lett = s => { const r = String(s).toUpperCase().split('').map(c => /[А-ЯЁ]/.test(c) ? c : (TO_LET[c] || '?')).join(''); return /^[А-ЯЁ]+$/.test(r) ? r : null; };
  const T = '[^\\s.,/]';
  const SEP = '\\s*[.,]\\s*';
  const DOC_TEMPLATES = [
    // сертификат соответствия ГОСТ Р: РОСС RU.32001.04ИБФ1.ОСП28.40856
    { re: new RegExp('(?:РОСС|POCC|РOСС|PОСС|POСС|РОС|POC)\\s*(' + T + '{1,3})?' + SEP + '(' + T + '{5})\\s*[.,/]\\s*(' + T + '{2})(' + T + '{3})(' + T + ')' + SEP + '(' + T + '{3})(' + T + '{2})' + SEP + '([0-9OОоDЗзIl|!SsBВБбЧ]{4,6})', 'g'),
      fmt: m => { const p = [dig(m[2]), dig(m[3]), lett(m[4]), dig(m[5]), lett(m[6]), dig(m[7]), dig(m[8])]; return p.every(Boolean) ? 'РОСС RU.' + p[0] + '.' + p[1] + p[2] + p[3] + '.' + p[4] + p[5] + '.' + p[6] : null; } },
    // свидетельство о государственной регистрации: RU.47.01.05.015.Е.000013.06.18
    { re: new RegExp('R[UuИ]' + SEP + '(' + T + '{2})' + SEP + '(' + T + '{2})' + SEP + '(' + T + '{2})' + SEP + '(' + T + '{3})' + SEP + '([ЕEМMДD])' + SEP + '(' + T + '{6})' + SEP + '(' + T + '{2})' + SEP + '(' + T + '{2})', 'g'),
      fmt: m => { const p = [dig(m[1]), dig(m[2]), dig(m[3]), dig(m[4]), lett(m[5]), dig(m[6]), dig(m[7]), dig(m[8])]; return p.every(Boolean) ? 'RU.' + p.slice(0, 4).join('.') + '.' + p[4] + '.' + p.slice(5).join('.') : null; } },
    // декларация / сертификат ЕАЭС: ЕАЭС N RU Д-RU.РА01.В.16632/25, РОСС RU Д-RU.РА01.В.16632/25
    { re: new RegExp('(ЕАЭС|EAЭС|ЕАЕС|EAEC)?\\s*(?:N|№|No)?\\s*(РОСС\\s*)?(RU|BY|KZ|ВИ|PU)\\s*([ДDСC\\[ОO0(])\\s*-\\s*(' + T + '{2})' + SEP + '(' + T + '{2})(' + T + '{2})' + SEP + '(' + T + ')' + SEP + '(' + T + '{5})\\s*/\\s*(' + T + '{2})', 'g'),
      fmt: m => {
        const kind = /[СC]/.test(m[4]) ? 'С' : 'Д';
        const ctry = /^(RU|BY|KZ|AM|KG)$/.test(m[5].toUpperCase()) ? m[5].toUpperCase() : 'RU';
        const p = [lett(m[6]), dig(m[7]), lett(m[8]), dig(m[9]), dig(m[10])];
        if (!p.every(Boolean)) return null;
        return (m[1] ? 'ЕАЭС N ' : m[2] ? 'РОСС ' : '') + (/^(BY|KZ)$/.test(m[3]) ? m[3] : 'RU') + ' ' + kind + '-' + ctry + '.' + p[0] + p[1] + '.' + p[2] + '.' + p[3] + '/' + p[4];
      } }
  ];
  // все номера документов в тексте, в порядке появления
  function findDocNumbers(text) {
    const out = [];
    DOC_TEMPLATES.forEach(t => {
      t.re.lastIndex = 0; let m;
      while ((m = t.re.exec(text))) { const v = t.fmt(m); if (v) out.push({ v, i: m.index }); }
    });
    return out.sort((a, b) => a.i - b.i);
  }

  // номер документа после OCR: «РОСС КО.32001.04ИБФ1.ОСПЗ2.76523 Г» → «РОСС RU.32001.04ИБФ1.ОСП32.76523»
  function cleanDocNo(raw) {
    const tpl = findDocNumbers(str(raw))[0];
    if (tpl) return tpl.v;
    let s = str(raw).replace(/^№\s*/, '');
    // декларация: «РОСС RU Д-RU.PA01.B.16632/25», «ЕАЭС N RU Д-RU.…», OCR часто читает «Д» как «[», «О», «D»
    const decl = /(ЕАЭС\s*)?(?:РОСС\s*)?(RU|N)\s*[ДDОO0\[(|]\s*-\s*([A-ZА-Я]{2}\s*\.\s*[0-9A-Za-zА-Яа-я]+(?:\s*[.\/]\s*[0-9A-Za-zА-Яа-я]+)*)/i.exec(s);
    if (decl) return (decl[1] ? 'ЕАЭС ' : '') + decl[2].toUpperCase() + ' Д-' + decl[3].replace(/\s+/g, '');
    s = s.replace(/^(?:РОСС|POCC|РOСС|PОСС|POСС)\s*[^\s.]{1,3}\s*\.\s*/i, 'РОСС RU.')
      .replace(/\.\s+(?=[0-9A-Za-zА-Яа-я])/g, '.');
    const m = /^(РОСС RU\.[0-9A-Za-zА-Яа-яЁё.!]+|(?:ЕАЭС )?(?:RU|N) Д-[0-9A-Za-zА-Яа-яЁё.\/]+|[0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё.\/\-]*(?:\s\([^)]{1,30}\))?)/.exec(s);
    s = (m ? m[1] : s).replace(/[.\-\/]+$/, '');
    // в цифровых группах OCR путает З/3 и !/1
    return s.replace(/З(?=\d)|(?<=\d)З/g, '3').replace(/(?<=[А-ЯA-Z])!(?=\.|$)/g, '1');
  }
  // ключ для сравнения номеров: без пробелов и знаков, латиница/кириллица одинаковые
  function docKey(s) {
    const map = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'З': '3' };
    return str(s).toUpperCase().replace(/\(.*?\)/g, '').replace(/[А-ЯЁ]/g, c => map[c] || c).replace(/[^0-9A-ZА-ЯЁ]/g, '');
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // тот же документ? Допускаем 1–3 ошибки распознавания в длинном номере и «хвосты» вида «(EN10204-3/1)»
  // расстояние между номерами: 0 — тот же номер (или один содержит другой, например «Р612142 (EN10204-3/1)»),
  // 1–3 — вероятные ошибки распознавания длинного номера, Infinity — другой документ
  function docDist(a, b) {
    const x = docKey(a), y = docKey(b);
    if (!x || !y) return Infinity;
    if (x === y) return 0;
    if (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x))) return 0;
    if (Math.min(x.length, y.length) < 10) return Infinity;
    const d = lev(x, y);
    return d <= Math.max(2, Math.floor(Math.min(x.length, y.length) * 0.12)) ? d : Infinity;
  }
  const sameDocNo = (a, b) => docDist(a, b) < Infinity;
  // типичный «шум» распознавания: «22 . 0 2 .202 6», «No», «N°»
  function fixOcr(t) {
    return t
      .replace(/\b(\d\s?\d?)\s*\.\s*(\d\s?\d)\s*\.\s*(\d\s?\d\s?\d\s?\d)(?!\d)/g, (m, a, b, c) => a.replace(/\s/g, '') + '.' + b.replace(/\s/g, '') + '.' + c.replace(/\s/g, ''))
      .replace(/\bN[oО°º]\.?\s*(?=[A-ZА-ЯЁ0-9])/g, '№ ').replace(/\bN\s+(?=\d)/g, '№ ');
  }

  // слова с близким y — одна строка; пробел ставим только там, где между словами есть зазор
  function groupLines(items) {
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    items.forEach(it => {
      const l = lines.find(l => Math.abs(l.y - it.y) <= 2);
      if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] });
    });
    lines.forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      l.text = joinItems(l.items);
    });
    return lines.sort((a, b) => b.y - a.y);
  }
  function joinItems(items) {
    let t = '', end = null;
    items.forEach(it => {
      if (end !== null && it.x - end > 1.2 && !/\s$/.test(t) && !/^\s/.test(it.s)) t += ' ';
      t += it.s; end = it.x + it.w;
    });
    return t.replace(/\s+/g, ' ').trim();
  }
  async function docxText(buf) {
    await UI.loadScript('vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('word/document.xml');
    if (!f) throw new Error('Файл Word повреждён');
    const xml = await f.async('string');
    return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:tc>/g, '\t').replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }
  async function readWorkbook(buf) {
    await UI.loadScript('vendor/xlsx.full.min.js');
    return XLSX.read(buf, { type: 'array' });
  }
  function sheetRows(wb, name) {
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  }
  function wbText(wb) {
    return wb.SheetNames.map(n => '### Лист «' + n + '»\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t' }).replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n')).join('\n\n');
  }

  // ================= единый формат результата =================
  const emptyResult = () => ({ doc_kind: 'other', summary: '', contract: { number: '', date: '', object_name: '', object_address: '', work_start: '', work_end: '' }, organizations: [], people: [], materials: [], estimate: [] });

  // ---------- названия организаций: «Общество с ограниченной ответственностью "X"» → ООО «X» ----------
  function orgName(raw) {
    const s = str(raw)
      .replace(/^[OОoо]{3}(?=\s|["«])/, 'ООО').replace(/^[AАaа][OОoо](?=\s|["«])/, 'АО')
      .replace(/Общество с ограниченной ответственностью/i, 'ООО').replace(/Публичное акционерное общество/i, 'ПАО')
      .replace(/Закрытое акционерное общество/i, 'ЗАО').replace(/Открытое акционерное общество/i, 'ОАО')
      .replace(/Акционерное общество/i, 'АО').replace(/Индивидуальный предприниматель/i, 'ИП');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ('"«»“”„'.includes(ch)) {
        const prev = out.replace(/\s+$/, '').slice(-1), next = s.slice(i + 1).replace(/^\s+/, '').charAt(0);
        if (/[0-9A-Za-zА-Яа-яЁё.)»!]/.test(prev) && !/[0-9A-Za-zА-Яа-яЁё]/.test(next)) out = out.replace(/\s+$/, '') + '»';
        else { out += '«'; while (s[i + 1] === ' ') i++; }
      } else out += ch;
    }
    const open = (out.match(/«/g) || []).length, close = (out.match(/»/g) || []).length;
    if (open > close) out += '»'.repeat(open - close);
    return out.replace(/\s+/g, ' ').trim();
  }
  // поставщик из шапки счёта: «Поставщик (Исполнитель): ООО "X", ИНН …»
  const LABEL_RE = /^(Поставщик|Продавец|Покупатель|Грузоотправитель|Грузополучатель|Плательщик|Основание|Получатель|Заказчик|Склад|Ответственный)/i;
  function supplierFromLines(lines) {
    const i = lines.findIndex(l => /^(Поставщик|Продавец)/i.test(l.text));
    if (i < 0) return null;
    let block;
    const lab = lines[i];
    if (lab.items) {
      // подпись «Поставщик:» бывает по центру своего блока — берём строки между соседними подписями
      const labEnd = lab.items[0].x + lab.items[0].w;
      const labels = lines.filter(l => l.items && l.items[0].x < labEnd && LABEL_RE.test(l.items[0].s.trim()));
      const k = labels.indexOf(lab);
      const up = Math.min(k > 0 ? (labels[k - 1].y + lab.y) / 2 : 1e4, lab.y + 16);
      const down = k < labels.length - 1 ? (lab.y + labels[k + 1].y) / 2 : lab.y - 30;
      const region = lines.filter(l => l.y < up && l.y > down);
      // значение идёт сразу за подписью; текст, отделённый большим промежутком, — уже другая колонка («Проект: Оплачено»)
      const vals = region.map(l => {
        const its = l.items.filter(it => it !== lab.items[0] && it.x >= labEnd - 1 &&!/^\(?(Исполнитель|продавец)\)?:?$/i.test(it.s.trim())).sort((a, b) => a.x - b.x);
        const out = []; let end = labEnd;
        for (const it of its) { if (it.x - end > (out.length ? 40 : 120)) break; out.push(it); end = it.x + it.w; }
        return out;
      });
      block = vals.map(joinItems).filter(Boolean).join(' ');
    } else {
      block = lab.text.replace(/^(Поставщик|Продавец)\s*(\([^)]*\))?\s*:?\s*/i, '');
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const lt = lines[j].text.replace(/^\([^)]*\)\s*:?\s*/, '');
        if (LABEL_RE.test(lt)) break;
        block += ' ' + lt;
      }
    }
    // УПД: справа на тех же строках — колонка покупателя, номера строк формы «(2)»
    block = block.split(/\s*\(\d[а-яa-z]?\)\s*|\s+(?=(?:Покупатель|Грузополучатель|Адрес)\b)/i)[0].trim();
    const name = orgName(block.split(/\s*,\s*(?=ИНН|КПП|ОГРН|\d{6}|г\.|город)/i)[0]);
    const inn = (/ИНН\s*:?\s*(\d{12}|\d{10})/.exec(block) || [])[1] || '';
    return name ? { name, inn } : null;
  }

  // ---------- таблица товаров счёта / УПД / накладной по координатам столбцов ----------
  const NUM_RE = /^-?\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;
  const toNum = s => +String(s).replace(/[  ]/g, '').replace(',', '.');
  const SERVICE_RE = /услуг|доставк|транспорт|перевоз|аренд|разгруз|погруз|экскаватор|манипулятор|водовоз|вывоз|обслуживан|^монтаж|работы по/i;
  // строка счёта / УПД / акта — это работа, а не товар (доставка и аренда техники остаются услугами поставщика)
  const WORK_RE = /^(работы?\s|выполнение работ|монтаж|демонтаж|устройство|установка|укладка|прокладка|бетонирование|армирование|разработка грунта|обратная засыпка|планировка|уплотнение|утепление|окраска|огрунтовка|штукатурка|кладка|сварка|пусконаладк|мобилизация|демобилизация|изготовление и монтаж)/i;
  // акт выполненных работ, КС-2, смета от подрядчика / субподрядчика — все строки идут в смету
  const WORKS_DOC_RE = /форма\s*№\s*кс-2\b|о\s+при[её]мке\s+выполненных\s+работ|акт\s+выполненных\s+работ|смета\s+с\s+уч[её]том\s+ндс|(^|\n)\s*смета\s*(\n|$)|акт\s+сдачи-при[её]мки\s+работ|локальн[а-яё]*\s+сметн|сметный\s+расч[её]т|ведомость\s+объ[её]мов\s+работ|расч[её]т\s+стоимости\s+работ/;
  const ADVANCE_RE =/аванс|предоплат|оплата по договору/i;
  const TOTAL_RE = /(^|\s)(итого|всего к оплате|всего наименований)|в т\.? ?ч\.? ?ндс|в том числе ндс|включая ндс/i;
  function normUnit(u) {
    const t = str(u).replace(/\s*\.\s*/g, '. ').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    const l = t.toLowerCase().replace(/\s/g, '');
    if (/^(м2|м\^2|кв\.?м|м²)$/.test(l)) return 'м²';
    if (/^(м3|м\^3|куб\.?м|м³)$/.test(l)) return 'м³';
    if (/^(пог\.?м|п\.?м|пм|м\.?п)$/.test(l)) return 'пог. м';
    if (/^шт/.test(l)) return 'шт';
    return t;
  }
  // соседние куски одного числа в строке: «2» + «527,753» → «2 527,753»; «1 600,» + «00» → «1 600,00»
  function mergeNumbers(items) {
    // отдельная запятая тоже кусок числа: PDF, набранный вразрядку, режет «1 616,00» на «1» «61» «6» «,0» «0»
    const isNumPart = s => /^[\d\s.,]+$/.test(s.trim()) && (/\d/.test(s) || /^[.,]$/.test(s.trim()));
    const out = [];
    items.slice().sort((a, b) => a.x - b.x).forEach(it => {
      const prev = out[out.length - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : 1e9;
      const short = prev && (prev.s.trim().length <= 2 || it.s.trim().length <= 2);
      if (prev && isNumPart(prev.s) && isNumPart(it.s) && gap < (short ? 7 : 5) && !/[.,]\d{2,3}$/.test(prev.s.trim()) || prev && isNumPart(prev.s) && isNumPart(it.s) && /[,.]\s*$/.test(prev.s) && gap < 8) {
        out[out.length - 1] = { x: prev.x, y: prev.y, w: it.x + it.w - prev.x, s: (prev.s + it.s).replace(/\s+/g, '') };
      } else out.push(Object.assign({}, it));
    });
    return out;
  }
  function invoiceTable(layout) {
    const rows = [];
    let carry = null; // таблица продолжается на следующей странице
    layout.forEach(lines => {
      // строка заголовка таблицы: «Товар/Наименование» + рядом не меньше двух колонок из «Кол-во / Цена / Сумма / Ед.»
      // (выбираем лучшую, а не первую: выше по тексту бывают строки «Наименование объекта… цена договора…»)
      const HEAD_COLS = [/^(Кол|Количество)/i, /^Цена/i, /^(Сумма|Стоимость)/i, /^(Ед|Единица)/i];
      let hi = -1, best = 1;
      // шапка в 1–2 строки (счета, УПД); если не нашлась — высокая шапка КС-2 (6 строк вниз от «Наименование работ»)
      let inBand = (m, l) => Math.abs(m.y - l.y) <= 9;
      const findHead = () => lines.forEach((l, idx) => {
        if (!l.items.some(it => /^(Товары?|Наименование)/i.test(it.s.trim()))) return;
        const band = lines.filter(m => inBand(m, l)).flatMap(m => m.items);
        const score = HEAD_COLS.filter(re => band.some(it => re.test(it.s.trim()))).length;
        if (score > best) { best = score; hi = idx; }
      });
      findHead();
      if (hi < 0) { inBand = (m, l) => m.y <= l.y + 12 && m.y >= l.y - 66; best = 2; findHead(); }
      let cols = null;
      if (hi >= 0) {
        const hl = lines[hi];
        const bandLines = lines.filter(l => inBand(l, hl));
        const band = bandLines.flatMap(l => l.items);
        const nameH = band.find(it => /^(Товары?|Наименование)/i.test(it.s.trim()));
        const nameEnd = nameH.x + nameH.w;
        const right = band.filter(it => it.x > nameEnd - 1);
        const left = band.filter(it => it.x + it.w < nameH.x);
        const pick = re => band.filter(it => re.test(it.s.trim()));
        cols = {
          bottom: Math.min(...bandLines.map(l => l.y)),
          leftB: left.length ? Math.max(...left.map(it => it.x + it.w)) : 0,
          // граница столбца наименования — посередине между заголовком «Товар» и следующим заголовком
          rightB: right.length ? Math.max(nameEnd, nameEnd + 0.7 * (Math.min(...right.map(it => it.x)) - nameEnd)) : 1e4,
          qtyH: pick(/^(Кол|Количество)/i)[0],
          // «Ед. изм.» раньше просто «ед.»: в шапке бывает «Цена за ед.,»
          unitH: pick(/^(Ед\.?\s*изм|Единица)/i)[0] || pick(/^(Ед|Единица)/i)[0],
          priceH: pick(/^Цена/i).sort((a, b) => a.x - b.x)[0],
          // «Общая стоимость» (смета: дальше идут столбцы «в т.ч. работы / материалы») — итог строки; иначе самый правый
          sumH: pick(/^Общая\s+стоимость/i)[0] || pick(/^(Сумма|Стоимость|Всего)/i).filter(it => !/единиц/i.test(it.s)).sort((a, b) => b.x - a.x)[0]
        };
      } else if (carry) cols = Object.assign({}, carry, { bottom: 1e4 });
      if (!cols) return;
      const data = [];
      let ended = false;
      for (const l of lines) {
        if (l.y >= cols.bottom) continue;
        if (TOTAL_RE.test(l.text)) { ended = true; break; }
        // строка номеров столбцов под шапкой: «1 2 3 4 5 6 7»
        if (l.items.length >= 4 && l.items.every((it, i) => it.s.trim() === String(i + 1))) continue;
        data.push(l);
      }
      // строки таблицы: первое слово — порядковый номер 1, 2, 3…
      let next = (carry && carry.next) || 1;
      let ax = carry && carry.ax; // все номера позиций стоят на одной вертикали (столбец «№»)
      const anchors = [];
      data.forEach(l => {
        // в УПД перед номером позиции стоит код товара («0000122847 1 Геотекстиль…»)
        const f = l.items.find(it => !/^\d{6,}$/.test(it.s.trim()));
        if (!f || f.x >= cols.rightB || f.x >= cols.leftB + 25 || !/^\d{1,3}$/.test(f.s.trim()) || +f.s.trim() !== next) return;
        if (ax !== undefined && ax !== null && Math.abs(f.x - ax) > 4) return;
        if (ax === undefined || ax === null) ax = f.x;
        anchors.push({ l, num: f }); next++;
      });
      carry = ended ? null : Object.assign({}, cols, { next, ax });
      if (!anchors.length) return;
      // после последней позиции: обрезаем всё, что отделено пустым промежутком (итоги, вес, подписи)
      const hasName = l => l.items.some(it => it.x >= cols.leftB - 3 && it.x < cols.rightB - 2 && !/^\d{1,3}$/.test(it.s.trim()));
      const lastIdx = data.indexOf(anchors[anchors.length - 1].l);
      for (let j = lastIdx + 1; j < data.length; j++) {
        // строка без наименования под последней позицией — итоги без подписи («91 … 44 770»)
        if (data[j - 1].y - data[j].y > 20 || !hasName(data[j])) { data.splice(j); break; }
      }
      // граница между соседними позициями — по самому большому вертикальному разрыву в столбце наименования
      const borders = [];
      for (let k = 0; k < anchors.length - 1; k++) {
        const top = anchors[k].l.y, bot = anchors[k + 1].l.y;
        // + первая строка наименования следующей позиции (она бывает чуть ниже строки с её номером)
        const nextName = data.filter(l => l.y < bot && l.y >= bot - 12 && hasName(l)).map(l => l.y).sort((a, b) => b - a)[0];
        const ys = data.filter(l => l.y <= top && l.y >= bot && hasName(l)).map(l => l.y).concat(nextName !== undefined ? [nextName] : []).sort((a, b) => b - a);
        let border = (top + bot) / 2, gap = -1;
        for (let j = 0; j < ys.length - 1; j++) if (ys[j] - ys[j + 1] > gap) { gap = ys[j] - ys[j + 1]; border = (ys[j] + ys[j + 1]) / 2; }
        // строка с номером следующей позиции всегда относится к ней
        if (border <= bot) border = bot + 0.5;
        borders.push(border);
      }
      const groups = anchors.map(a => ({ a, lines: [] }));
      data.forEach(l => {
        let k = 0;
        while (k < borders.length && l.y < borders[k]) k++;
        groups[k].lines.push(l);
      });
      const center = it => it.x + it.w / 2;
      const nearest = (arr, h) => h ? arr.slice().sort((a, b) => Math.abs(center(a) - center(h)) - Math.abs(center(b) - center(h)))[0] : arr[0];
      groups.forEach(g => {
        const ls = g.lines.sort((a, b) => b.y - a.y);
        const parts = [];
        ls.forEach(l => {
          const its = l.items.filter(it => it !== g.a.num && it.x >= cols.leftB - 3 && it.x < cols.rightB - 2);
          const t = joinItems(its);
          if (t && !(parts.length && /^\d+$/.test(t))) parts.push(t);
        });
        // PDF режет числа на куски («2» «527,753», «1 600,» «00») — склеиваем соседние куски одного числа
        const rightItems = ls.flatMap(l => mergeNumbers(l.items.filter(it => it.x >= cols.rightB - 3)));
        const nums = rightItems.filter(it => NUM_RE.test(it.s.trim()));
        const qtyIt = nearest(nums, cols.qtyH);
        const sumIt = nearest(nums.filter(n => n !== qtyIt), cols.sumH);
        const limit = cols.priceH ? cols.priceH.x - 2 : (sumIt ? sumIt.x : 1e4);
        // единица: под своим заголовком «Ед. изм.», если он есть; иначе — между количеством и ценой
        const unitIts = cols.unitH
          ? rightItems.filter(it => !NUM_RE.test(it.s.trim()) && !/%/.test(it.s) && Math.abs(center(it) - center(cols.unitH)) < 45)
          : rightItems.filter(it => !NUM_RE.test(it.s.trim()) && (!qtyIt || it.x > qtyIt.x) && it.x < limit && !/%/.test(it.s));
        // «М» + отдельный верхний индекс «2» → м²
        if (unitIts.length) {
          const last = unitIts.reduce((a, b) => (b.x > a.x ? b : a));
          const sup = rightItems.find(it => /^[23]$/.test(it.s.trim()) && it.x > last.x && it.x - (last.x + last.w) < 6 && it !== qtyIt);
          if (sup) unitIts.push(sup);
        }
        const qty = qtyIt ? toNum(qtyIt.s) : '';
        const sum = sumIt ? toNum(sumIt.s) : '';
        const name = parts.join(' ').replace(/\s+([.,)])/g, '$1').replace(/\(\s+/g, '(').trim();
        if (!name) return;
        rows.push({ name, qty, unit: normUnit(joinItems(unitIts)), sum, price: qty && sum ? Math.round(sum / qty * 100) / 100 : '' });
      });
    });
    return rows;
  }

  // ---------- таблица товаров на фото / скане (строки из OCR) ----------
  // OCR теряет мелкие заголовки и одиночные цифры («6», «шт»), но суммы с копейками читает надёжно.
  // Поэтому: позиции — по числам в самом правом денежном столбце (сумма), границы позиций — по разрывам
  // в столбце наименования, количество — сумма ÷ цена (проверяется по цифрам из столбца количества).
  const UNIT_RE = /^(шт|рул|пог|м|м2|м3|м²|м³|кг|т|тн|л|лист|упак|уп|компл|к-т|кор|меш|пач|бух|кв\.?м|куб\.?м)\.?$/i;
  function ocrTable(lines) {
    const rules = lines.rules || [];
    // «1308/00» — OCR принял запятую за косую черту
    const numOf = s => { const t = String(s).replace(/^[^\d-]+|[^\d]+$/g, '').replace(/^([\d\s]+)[\/;:](\d{2})$/, '$1,$2'); return t && NUM_RE.test(t) ? t : null; };
    const isMoney = it => { const t = numOf(it.s); return t && /[.,]\d{2}$/.test(t) && !/%/.test(it.s); };
    const letters = s => (String(s).match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    // конец таблицы — «Итого / Всего»; начало — последняя строка с заголовком «Товар / Наименование», под которой есть суммы
    const all = lines.map(l => Object.assign({}, l, { items: mergeNumbers(l.items) }));
    let to = all.findIndex(l => TOTAL_RE.test(l.text));
    if (to < 0) to = all.length;
    const moneyLines = all.slice(0, to).map((l, i) => l.items.some(isMoney) ? i : -1).filter(i => i >= 0);
    const heads = all.slice(0, to).map((l, i) => l.items.some(it => /^(Товары?|Наименование)[,.:]?$/i.test(it.s)) && l.items.length >= 3 && moneyLines.filter(m => m > i).length >= 2 ? i : -1).filter(i => i >= 0);
    const from = heads.length ? heads[heads.length - 1] : -1;
    const data = all.slice(from + 1, to);
    const money = data.flatMap(l => l.items.filter(isMoney));
    if (money.length < 2) return [];
    const sumX = Math.max(...money.map(it => it.x));
    const anchors = data.filter(l => l.items.some(it => isMoney(it) && it.x >= sumX - 25));
    if (!anchors.length) return [];
    // столбец наименования: левая граница — самое частое начало слов, правая — по самому большому разрыву до чисел
    const firstMoneyX = Math.min(...money.map(it => it.x));
    const words = data.flatMap(l => l.items.filter(it => letters(it.s) >= 2 && it.x < firstMoneyX));
    if (!words.length) return [];
    const bins = {};
    words.forEach(it => { const b = Math.round(it.x / 6); bins[b] = (bins[b] || 0) + 1; });
    const nameBin = +Object.keys(bins).sort((a, b) => bins[b] - bins[a])[0];
    const nameL = Math.min(...words.filter(it => Math.round(it.x / 6) === nameBin).map(it => it.x));
    const xs = words.map(it => it.x).filter(x => x >= nameL - 3).sort((a, b) => a - b).concat([firstMoneyX]);
    let nameR = firstMoneyX - 2, gap = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > gap && xs[i - 1] > nameL + 20) { gap = xs[i] - xs[i - 1]; nameR = xs[i - 1] + Math.min(25, gap / 2); }
    const inName = it => it.x >= nameL - 4 && it.x < nameR;
    const hasName = l => l.items.some(it => inName(it) && letters(it.s) >= 2);
    // заголовки «Цена» — чтобы отличить цену от скидки / НДС
    const head = from >= 0 ? all.filter(l => Math.abs(l.y - all[from].y) <= 12).flatMap(l => l.items) : [];
    const priceH = head.filter(it => /^Цена/i.test(it.s));
    // границы позиций — по самому большому разрыву между строками наименования
    const named = data.filter(hasName);
    const borders = [];
    for (let k = 0; k < anchors.length - 1; k++) {
      const top = anchors[k].y, bot = anchors[k + 1].y;
      const ys = named.filter(l => l.y <= top && l.y >= bot).map(l => l.y);
      if (!ys.includes(top)) ys.unshift(top);
      if (!ys.includes(bot)) ys.push(bot);
      ys.sort((a, b) => b - a);
      let border = (top + bot) / 2, g = -1;
      for (let j = 0; j < ys.length - 1; j++) if (ys[j] - ys[j + 1] > g) { g = ys[j] - ys[j + 1]; border = (ys[j] + ys[j + 1]) / 2; }
      // линия сетки между позициями надёжнее разрыва в тексте
      const rl = rules.filter(r => r < top - 2 && r > bot + 2).sort((a, b) => Math.abs(a - border) - Math.abs(b - border))[0];
      borders.push(rl !== undefined ? rl : border);
    }
    // строки выше первой и ниже последней позиции — до ближайшей линии сетки, без неё — пока нет большого разрыва
    const step = 14;
    const ruleAbove = rules.filter(r => r > anchors[0].y + 2).sort((a, b) => a - b)[0];
    const ruleBelow = rules.filter(r => r < anchors[anchors.length - 1].y - 2).sort((a, b) => b - a)[0];
    // все линии сетки внутри таблицы — тоже границы: позиция, у которой OCR не прочёл ни одной цифры, не слипнется с соседней
    const lastA = anchors[anchors.length - 1];
    const allB = borders.concat(rules.filter(r => r < anchors[0].y - 2 && r > lastA.y + 2)).sort((a, b) => b - a)
      .filter((b, i, a) => i === 0 || a[i - 1] - b > 3);
    const groups = allB.map(() => []).concat([[]]);
    data.forEach(l => {
      if (ruleAbove !== undefined && l.y > ruleAbove) return;
      if (ruleBelow !== undefined && l.y < ruleBelow) return;
      let k = 0;
      while (k < allB.length && l.y < allB[k]) k++;
      if (k === 0 && l.y > anchors[0].y && (l.y - anchors[0].y > step * 3 || !hasName(l))) return;
      if (k === allB.length && l.y < lastA.y && (lastA.y - l.y > step * 3 || !hasName(l))) return;
      groups[k].push(l);
    });
    // q = s / p, если цена × количество даёт сумму с точностью до копейки
    const fits = (s, p) => {
      if (!p || !s || p > s) return null;
      const r = Math.round(s / p * 1000) / 1000, q = Math.abs(r - Math.round(r)) < 0.002 ? Math.round(r) : r;
      return Math.abs(p * q - s) <= 0.011 ? q : null;
    };
    // коды ОКЕИ (796 — шт, 778 — упак…) стоят рядом с количеством в УПД — это не количество
    const OKEI = [796, 778, 625, 18, 6, 55, 736, 166, 168, 113, 112, 839, 704, 715];
    const cand = [];
    groups.forEach(ls => {
      ls.sort((a, b) => b.y - a.y);
      const name = ls.map(l => joinItems(l.items.filter(inName).filter(it => letters(it.s) || /\d/.test(it.s)))).filter(Boolean).join(' ')
        .replace(/\s+([.,)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();
      if (letters(name) < 3) return;
      const mid = ls.flatMap(l => l.items.filter(it => it.x >= nameR && it.x < firstMoneyX - 1));
      const nums = ls.flatMap(l => l.items.filter(it => it.x >= nameR - 2)).map(it => ({ it, t: numOf(it.s) })).filter(n => n.t);
      const sumN = nums.filter(n => isMoney(n.it) && n.it.x >= sumX - 25).sort((a, b) => b.it.x - a.it.x)[0];
      const sum = sumN ? toNum(sumN.t) : '';
      // обрывок без цифр со строчной буквы — продолжение предыдущего наименования (лишняя линия)
      if (!sum && !nums.some(n => isMoney(n.it)) && cand.length && /^[a-zа-яё(\d]/.test(name)) { cand[cand.length - 1].name += ' ' + name; return; }
      const qtyCand = mid.map(it => numOf(it.s)).filter(Boolean).map(toNum).filter(v => !(Number.isInteger(v) && OKEI.includes(v) && /\b(шт|упак|л|м|кг|рул|пог)/i.test(mid.map(it => it.s).join(' '))));
      const prices = nums.filter(n => n !== sumN && isMoney(n.it)).map(n => ({ v: toNum(n.t), x: n.it.x + n.it.w / 2 }));
      // дробное количество (2 527,753 м²) — только если его видно в столбце количества, иначе это случайное совпадение
      const okQ = q => q && (Number.isInteger(q) || qtyCand.some(c => Math.abs(c - q) < 0.001));
      const opts = sum ? prices.map(p => ({ p, q: fits(sum, p.v) })).filter(o => okQ(o.q)) : [];
      const unitT = mid.filter(it => !numOf(it.s)).map(it => it.s.replace(/^[wш][rtт]\.?$/i, 'шт').replace(/[|()]/g, '')).filter(s => UNIT_RE.test(s));
      // целое число из строки, при котором сумма ÷ число ≈ другому числу строки (цена с прилипшей рамкой «155,001»)
      const vals = nums.filter(n => n !== sumN).map(n => toNum(n.t));
      const ints = nums.filter(n => !isMoney(n.it) && /^\d{1,5}$/.test(n.t)).map(n => +n.t).filter(v => v > 0 && !OKEI.includes(v));
      const near = sum ? ints.find(q => { const p = sum / q; return p > 0.5 && vals.some(v => v !== q && Math.abs(v - p) <= 0.005 * p); }) : undefined;
      cand.push({ name, sum, prices, opts, qtyCand, near, unit: normUnit(unitT.join(' ')) });
    });
    // однозначные позиции показывают, в каком столбце стоит цена — по нему решаем спорные (цена или скидка)
    // (цена бывает в двух столбцах — «без скидки» и «со скидкой»: запоминаем все)
    const sure = cand.flatMap(c => { const qs = [...new Set(c.opts.map(o => o.q))]; return qs.length === 1 ? c.opts.map(o => o.p.x) : []; });
    const priceX = priceH.length ? priceH.map(h => h.x + h.w / 2) : sure;
    return cand.map(c => {
      let qty = '';
      const confirmed = c.opts.find(o => c.qtyCand.some(q => Math.abs(q - o.q) < 0.001));
      const dist = o => Math.min(...priceX.map(x => Math.abs(o.p.x - x)));
      const byCol = priceX.length ? c.opts.filter(o => dist(o) < 30).sort((a, b) => dist(a) - dist(b))[0] : null;
      const pick = confirmed || byCol;
      if (pick) qty = pick.q;
      // УПД: цена и стоимость без НДС в других столбцах — пробуем пары «стоимость ÷ цена»
      if (!qty && c.sum && !c.opts.length) {
        // цена без НДС округлена до копеек — допуск полкопейки на единицу; стоимость — самое большое из чисел
        const pairs = [];
        c.prices.forEach(a => c.prices.forEach(b => {
          if (a === b || b.v > a.v) return;
          const q = Math.round(a.v / b.v);
          if (q >= 1 && Math.abs(b.v * q - a.v) <= 0.011 + q * 0.005) pairs.push({ a: a.v, q });
        }));
        pairs.sort((x, y) => y.a - x.a || y.q - x.q);
        if (pairs.length) qty = pairs[0].q;
      }
      if (!qty && c.near) qty = c.near;
      if (!qty) { const o = c.opts.filter(o => o.q > 1 && Number.isInteger(o.q)).sort((a, b) => a.q - b.q)[0] || c.opts[0]; if (o) qty = o.q; }
      if (qty === '' && c.qtyCand.length) qty = c.qtyCand[0];
      return { name: c.name, qty, unit: c.unit, sum: c.sum, price: qty && c.sum ? Math.round(c.sum / qty * 100) / 100 : '' };
    });
  }

  // ---------- реквизиты сторон договора, свёрстанные в две колонки ----------
  function contractParties(layout) {
    const out = [];
    for (const lines of layout) {
      const ri = lines.findIndex(l => /реквизиты/i.test(l.text) && /сторон/i.test(l.text));
      const from = ri >= 0 ? ri : -1;
      if (from < 0) continue;
      // строка-заголовок колонок: «Подрядчик  Заказчик»
      const hi = lines.findIndex((l, i) => i > from && i < from + 6 && l.items.filter(it => /^(Подрядчик|Генподрядчик|Субподрядчик|Заказчик|Генеральный подрядчик|Застройщик)[:]?$/i.test(it.s.trim())).length >= 2);
      if (hi < 0) continue;
      const heads = lines[hi].items.filter(it => /^(Подрядчик|Генподрядчик|Субподрядчик|Заказчик|Генеральный подрядчик|Застройщик)[:]?$/i.test(it.s.trim())).sort((a, b) => a.x - b.x);
      const split = heads[1].x - 10;
      const cols = [[], []];
      const colOf = (l, k) => joinItems(l.items.filter(it => k ? it.x >= split : it.x < split));
      let i = hi + 1;
      for (; i < Math.min(lines.length, hi + 40); i++) {
        if (/_{4,}|м\.п\.|подпись/i.test(lines[i].text)) break;
        [0, 1].forEach(k => { const t = colOf(lines[i], k); if (t) cols[k].push(t); });
      }
      // блок подписей: «Генеральный директор … ____/А.А. Симанок/» — подписанты для КС-2 / КС-3
      const signLine = lines.slice(i, i + 12).find(l => /_{4,}/.test(l.text));
      const POS_RE = /директор|предприниматель|руководитель|управляющ|президент|начальник|заместитель/i;
      const signers = [0, 1].map(k => {
        if (!signLine) return { pos: '', name: '' };
        const t = colOf(signLine, k);
        const nm = /([А-ЯЁ]\.\s?[А-ЯЁ]\.\s?[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.?)/.exec(t);
        const si = lines.indexOf(signLine);
        const pl = lines.slice(Math.max(hi + 1, si - 5), si).map(l => colOf(l, k)).filter(x => POS_RE.test(x)).pop();
        return { pos: pl ? pl.replace(/[:,]\s*$/, '').trim() : '', name: nm ? nm[1].replace(/\s+/g, ' ').replace(/^([А-ЯЁ]\.)\s?([А-ЯЁ]\.)\s?/, '$1$2 ') : '' };
      });
      heads.slice(0, 2).forEach((h, k) => {
        const txt = cols[k].join('\n');
        const role = /заказчик|застройщик/i.test(h.s) ? 'customer' : 'contractor';
        // строка наименования; «ОГРНИП 3247…» — не наименование, хоть и содержит «ИП»
        let ni = cols[k].findIndex(l => !/^\s*(ИНН|КПП|ОГРН|ОКПО|БИК|р\/с|к\/с)/i.test(l) && /(^|[\s«"])(ООО|АО|ПАО|ЗАО|ОАО|ИП)\s|Общество|Акционерное|Индивидуальный предприниматель/i.test(l));
        if (ni < 0) ni = 0;
        let nameLine = cols[k][ni] || '';
        // «Индивидуальный предприниматель» / ФИО строкой ниже
        if (/^(Индивидуальный предприниматель|ИП)\s*$/i.test(nameLine.trim()) && /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+/.test(cols[k][ni + 1] || '')) nameLine = 'ИП ' + cols[k][ni + 1].trim();
        // физлицо: ФИО полностью и паспортные данные, без ИНН
        const person = /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+$/.test(nameLine.trim()) && /паспорт/i.test(txt);
        const adr = /(?:юридический адрес|юр\.\s*адрес|адрес|зарегистрирован[а-я]*(?:\s+по\s+адресу)?)\s*:?\s*([\s\S]{10,300}?)(?=\n\s*(?:почтовый|фактический|тел|e-?mail|эл\.|р\/с|расч|банк|бик|к\/с|кор|инн|огрн|кпп|окпо|генеральный|директор)|$)/i.exec(txt);
        const tel = /тел[^\d+]{0,10}([+\d][\d\s()\-]{6,20}\d)/i.exec(txt);
        out.push({
          signer_pos: signers[k].pos, signer_name: signers[k].name,
          role, type: person ? 'ФЛ' : /^(ИП|Индивидуальный предприниматель)(?=\s|$)/i.test(nameLine) ? 'ИП' : 'ЮЛ', name: person ? nameLine.trim() : orgName(nameLine.replace(/\s+(ИНН|ОГРН|КПП).*$/i, '')),
          inn: (/ИНН(?:\s*\/\s*КПП)?\s*:?\s*(\d{12}|\d{10})/.exec(txt) || [])[1] || '',
          // у физлица в этом поле — паспорт («40 20 797571, выдан …»)
          ogrn: person ? str((/паспорт[а-яё ]*:?\s*([\s\S]{5,200}?)(?=\n\s*(?:зарегистрирован|адрес|эл\.|e-?mail|тел)|$)/i.exec(txt) || [])[1]).replace(/\s*-\s*/g, '-').replace(/^(\d{2}\s?\d{2}\s?\d{6})\s+(?=выдан)/i, '$1, ')
            : (/ОГРН(?:ИП)?\s*:?\s*(\d{15}|\d{13})/.exec(txt) || [])[1] || '',
          okpo: (/ОКПО\s*:?\s*(\d{8,10})/.exec(txt) || [])[1] || '',
          address: adr ? str(adr[1]).replace(/\s*-\s*(?=[А-ЯЁ])/g, '-').replace(/[,\s]+$/, '') : '',
          phone: tel ? 'тел. ' + str(tel[1]) : '', sro_name: '', sro_ogrn: '', sro_inn: ''
        });
      });
      break;
    }
    return out.filter(o => o.name && (o.inn || o.ogrn || o.type === 'ФЛ'));
  }

  // ---------- офлайн: поиск по шаблонам в тексте ----------
  function offlineParse(text, layout, fname) {
    const r = emptyResult();
    text = fixOcr(text);
    const t = text.replace(/ /g, ' ');
    const head = t.slice(0, 1500).toLowerCase();
    const head3 = t.slice(0, 4000).toLowerCase();
    const fn = fromFileName(fname || '');
    const fnLow = (fname || '').toLowerCase();
    // договор с приложением «Расчёт стоимости работ» — всё же договор: его заголовок в самом начале
    if (WORKS_DOC_RE.test(head3) && !/договор/.test(t.slice(0, 200).toLowerCase())) r.doc_kind = 'act';
    else if (/универсальный передаточный|товарная накладная|торг-12/.test(head3)) r.doc_kind = 'waybill';
    else if (/сч[её]т(-оферта|\s+на оплату)?\s*№|заказ покупателя\s*№/.test(head3)) r.doc_kind = 'invoice';
    else if (/сертификат|сертификац|декларац[а-яё]* о соответствии|паспорт|документ о качестве|свидетельство о государственной регистрации|протокол испытаний|экспертное заключение|отказно|регистрационный номер|орган по сертификации/.test(head)) r.doc_kind = 'certificate';
    else if (/договор/.test(head) && !/сертиф|паспорт|деклар/.test(fnLow)) r.doc_kind = 'contract';
    else if (/сертиф|паспорт|деклар|свидетельств|протокол|качеств|отказн|экспертн/.test(fnLow) || fn.doc_no) r.doc_kind = 'certificate';
    const DATE = '(\\d{1,2}[.\\/]\\d{1,2}[.\\/]\\d{2,4}|«?\\s*\\d{1,2}\\s*»?\\s+[а-яё]+\\s+\\d{4})';

    if (r.doc_kind === 'contract') {
      // номер: «ДОГОВОР НА СТРОИТЕЛЬСТВО № 08/10 - 2863»; дата — следом, часто на следующей строке после города
      const hd = t.slice(0, 3000);
      const m = /договор[^№\n]{0,80}№\s*([0-9A-Za-zА-Яа-яЁё\/.]+(?:\s*[-–]\s*[0-9A-Za-zА-Яа-яЁё\/.]+)*)/i.exec(hd);
      if (m) {
        r.contract.number = m[1].replace(/\s*[-–]\s*/g, '-');
        const d = new RegExp(DATE).exec(hd.slice(m.index + m[0].length, m.index + m[0].length + 250));
        if (d) r.contract.date = iso(d[1]);
      }
      // цена: «Общая стоимость Работ … (цена Договора) составляет 9 475 700, 00 руб.»
      const pr = /(?:общая стоимость работ|цена договора)[\s\S]{0,160}?составляет\s*:?\s*(\d{1,3}(?:[\s ]\d{3})*(?:[.,]\s?\d{2})?)/i.exec(t);
      if (pr) r.contract.price = String(+pr[1].replace(/[\s ]/g, '').replace(',', '.'));
      // объект: «на объекте строительства Заказчика «Складское здание»» или «Объект: …»
      // «на объекте⏎строительства Заказчика «Магазин»» — перенос строки внутри фразы
      const ob = /на\s+объект[ае][^«"]{0,60}?[«"]\s*([^»"]{3,150}?)\s*[»"]/i.exec(t) || /(?:наименование объекта|^\s*объект[а-я]*)\s*[:\-–]\s*([^\n]{5,250})/im.exec(t);
      if (ob) r.contract.object_name = str(ob[1]);
      // адрес: может занимать несколько строк — до «(в пределах участка…)», «, а Заказчик», конца предложения или следующего пункта
      const ad = /(?:расположенн[а-яё]* по адресу|адрес объекта|место выполнения работ|по адресу)\s*[:\-–]?\s*([\s\S]{10,400}?)(?=\s*\((?:в пределах|кадастр|к\.\s?н)|[\s,]+(?:с\s+)?кадастров[а-я]*\s+номер|\s*,\s*а\s+заказчик|\s*;|\.\s*\n|\n\s*\d+\.\d|$)/i.exec(t);
      if (ad) r.contract.object_address = str(ad[1]).replace(/[,\s]+$/, '');
      const term = new RegExp('срок[^\\n]{0,60}?с\\s*' + DATE + '\\s*(?:г\\.?|года)?\\s*(?:по|до)\\s*' + DATE, 'i').exec(t);
      if (term) { r.contract.work_start = iso(term[1]); r.contract.work_end = iso(term[2]); }
      else {
        // «График производства работ»: начало — самая ранняя дата, окончание — самая поздняя
        // именно заголовок раздела (с начала строки), а не ссылка «…в соответствии с Графиком производства работ»
        const gi = t.search(/(?:^|\n)\s*график (?:производства|выполнения) работ/i);
        if (gi >= 0) {
          // до подписей и отметок ЭДО (в них даты-время подписания)
          const part = t.slice(gi, gi + 4000).split(/\n\s*Приложение\s*№|документ подписан|подрядчик\s*:|заказчик\s*:|сертификат [0-9A-F]{8}/i)[0];
          const okYear = d => d && +d.slice(0, 4) >= 2000 && +d.slice(0, 4) <= 2100;
          const ds = (part.match(/(?<![\d.\/])\d{1,2}[.\/]\d{1,2}[.\/](?:\d{4}|\d{2})(?![\d:])/g) || []).map(iso).filter(okYear).sort();
          // «… работы – до «25» декабря 2026 г.» — явный срок окончания
          const till = new RegExp('до\\s*' + DATE, 'i').exec(part);
          if (ds.length) { r.contract.work_start = ds[0]; r.contract.work_end = ds[ds.length - 1]; }
          if (till && okYear(iso(till[1])) && (!r.contract.work_end || iso(till[1]) > r.contract.work_end)) r.contract.work_end = iso(till[1]);
        }
      }
      // реквизиты сторон — по колонкам «Подрядчик | Заказчик»
      if (layout) contractParties(layout).forEach(o => r.organizations.push(o));
      // «Расчёт стоимости работ» — в смету
      if (layout) invoiceTable(layout).forEach(row => {
        if (ADVANCE_RE.test(row.name)) return;
        // подпункты состава работ («- проект КЖ», «- бетон В25…») в наименование позиции не берём
        r.estimate.push({ name: row.name.split(/\s+-\s*(?=[а-яёa-z])/i)[0].trim(), unit: row.unit, qty: String(row.qty), price_work: String(row.price), price_mat: '' });
      });
    }
    // организации: «ООО «Название» … ИНН … ОГРН …»
    const orgRe = /(ООО|АО|ПАО|ЗАО|ОАО|НАО|ИП|Общество с ограниченной ответственностью|Акционерное общество)\s*[«"„]([^»"“\n]{2,80})[»"“]/g;
    const seen = {};
    let m;
    while ((m = orgRe.exec(t))) {
      const short = (m[1].length > 4 ? (m[1].startsWith('Общество') ? 'ООО' : 'АО') : m[1]) + ' «' + m[2].trim() + '»';
      if (seen[norm(short)]) continue;
      const near = t.slice(m.index, m.index + 700);
      const inn = (/ИНН\s*[:\/]?\s*(\d{12}|\d{10})/.exec(near) || [])[1] || '';
      const ogrn = (/ОГРН(?:ИП)?\s*[:\/]?\s*(\d{15}|\d{13})/.exec(near) || [])[1] || '';
      if (!inn && !ogrn) continue;
      // уже взята из реквизитов сторон (там данные полнее)
      if (r.organizations.some(o => (inn && o.inn === inn) || norm(o.name) === norm(short))) continue;
      seen[norm(short)] = 1;
      r.organizations.push({ role: 'other', type: m[1] === 'ИП' ? 'ИП' : 'ЮЛ', name: short, ogrn, inn, address: '', phone: '', okpo: (/ОКПО\s*[:\/]?\s*(\d{8,10})/.exec(near) || [])[1] || '', sro_name: '', sro_ogrn: '', sro_inn: '' });
    }
    if (r.doc_kind === 'contract' && r.organizations.length >= 2) {
      // в договоре подряда первым обычно идёт заказчик, вторым — подрядчик
      const low = t.toLowerCase();
      r.organizations.forEach(o => {
        const i = low.indexOf(norm(o.name).replace(/^(ооо|ао|ип) /, ''));
        const ctx = i >= 0 ? low.slice(i, i + 400) : '';
        // «именуемый в⏎дальнейшем «Заказчик»» — перенос строки внутри фразы; берём ближайшую к названию роль
        const cu = /именуем[а-яё]*\s+(?:в\s+дальнейшем\s+)?[«"]?заказчик/.exec(ctx), co = /именуем[а-яё]*\s+(?:в\s+дальнейшем\s+)?[«"]?(?:подрядчик|генподрядчик)/.exec(ctx);
        if (cu && (!co || cu.index < co.index)) o.role = 'customer';
        else if (co) o.role = 'contractor';
      });
    }
    if (r.doc_kind === 'certificate') {
      const types = [['отказно', 'Отказное письмо'], ['свидетельство о государственной регистрации', 'Свидетельство о государственной регистрации'], ['пожарной безопасности', 'Сертификат пожарной безопасности'], ['декларац', 'Декларация о соответствии'], ['сертификат соответствия', 'Сертификат соответствия'], ['сертификат качества', 'Сертификат качества'], ['паспорт', 'Паспорт качества'], ['документ о качестве', 'Документ о качестве'], ['экспертное заключение', 'Экспертное заключение'], ['протокол', 'Протокол испытаний'], ['отказно', 'Отказное письмо'], ['сертификац', 'Сертификат соответствия']];
      const tp = fn.doc_type || (types.find(x => head.includes(x[0])) || [, 'Сертификат соответствия'])[1];
      // номер: «Регистрационный номер …», затем «№ РОСС …/RU Д-…/ЕАЭС …», затем любой «№ …»
      let no = /регистрационный номер(?: декларации)?\s*:?\s*([^\n]{5,80})/i.exec(t) ||
        /(?:№|номер)\s*((?:РОСС|ЕАЭС|RU|ТС|POCC|EAЭС)[^\n]{3,60}?)(?=\s{2,}|\s+(?:от|срок|дата|выдан)|\n|$)/i.exec(t) ||
        /№\s*([A-ZА-ЯЁ0-9][0-9A-Za-zА-Яа-яЁё.\-\/ ]{2,40}?)(?=\s+от\s|\s{2,}|\n|$)/.exec(t);
      if (no) no = [no[0], cleanDocNo(/\d\s+[\d/]/.test(no[1]) && !/[A-ZА-Я]{2}/.test(no[1]) ? no[1].replace(/\s+/g, '') : no[1])];
      if (tp === 'Отказное письмо') no = null; // у отказного письма номера обычно нет, «№» в тексте — это ссылки на постановления
      // номер, совпавший со структурой сертификата / декларации / свидетельства ГР, — самый надёжный;
      // берём тот, что стоит после «Регистрационный номер», иначе первый в тексте
      const tpls = tp === 'Отказное письмо' ? [] : findDocNumbers(t);
      const regIdx = t.search(/регистрационный номер|свидетельство о государственной регистрации|сертификат соответствия|декларац/i);
      const tplNo = (tpls.find(x => regIdx >= 0 && x.i > regIdx) || tpls[0] || {}).v || '';
      // имя файла набрано человеком, но в нём бывают опечатки: если номер со скана почти такой же — верим скану
      const docNo = tplNo && fn.doc_no ? (docDist(tplNo, fn.doc_no) < Infinity ? tplNo : fn.doc_no) : (tplNo || fn.doc_no || (no ? str(no[1]) : ''));
      const from = new RegExp('(?:дата (?:регистрации|выдачи)|выдан[а-яё]*|от|срок действия с)\\s*:?\\s*' + DATE, 'i').exec(t);
      const until = new RegExp('(?:по|до|действ[а-яё]* до|срок действия[^\\n]{0,30}?по)\\s*:?\\s*(?:включительно\\s*)?' + DATE, 'i').exec(t.slice(from ? from.index + from[0].length : 0));
      // продукция может занимать несколько строк — берём до следующего раздела
      const prod = /(?:наименование продукции|продукция|изделие)\s*[:\-–|]?\s*([\s\S]{5,300}?)(?=\n\s*(?:код|соответствует|изготовитель|производитель|заявитель|выдан|сертификат|декларац|орган|дата|количество|кол-во|срок|регистрац|№|номер|партия|масса|объ[её]м|поставщик|потребитель|грузополучатель|марка|тип\b|типоразмер|модель|класс)|\n\s*\n|$)/i.exec(t);
      // изготовитель — только если дальше действительно организация («Изготовитель гарантирует…» не берём)
      const maker = /(?:изготовитель|производитель)\s*(?:\([^)]*\))?\s*[:\-–]?\s*((?:ООО|АО|ПАО|ЗАО|ОАО|ИП|Общество|Акционерное|Индивидуальный|ОБЩЕСТВО|АКЦИОНЕРНОЕ)[^\n]{3,200})/i.exec(t);
      // ГОСТ/ТУ: самый частый в документе (в сертификатах на металл первым часто стоит ГОСТ на правила приёмки)
      const gosts = {};
      (t.match(/ГОСТ\s*(?:Р\s*)?(?:ЕН\s*|EN\s*|ISO\s*)?\d[\d.]*(?:\s*[-–]\s*\d{2,3}\s?\d?)?|ТУ\s*[\d.]+(?:\s*[-–]\s*[\d.\-–]+)?/g) || [])
        .map(g => g.replace(/\s*[-–]\s*/g, '-').replace(/(-\d{2,3})\s(\d)$/, '$1$2').replace(/\s+/g, ' ').trim())
        .forEach(g => { gosts[g] = (gosts[g] || 0) + 1; });
      let gostBest = Object.keys(gosts).sort((a, b) => gosts[b] - gosts[a])[0];
      // OCR потерял дефис перед годом: «ГОСТ 340282016» → «ГОСТ 34028-2016»
      if (gostBest) gostBest = gostBest.replace(/^(ГОСТ (?:Р ?)?)(\d{4,5})((?:19|20)\d\d)$/, '$1$2-$3').replace(/^ГОСТР/, 'ГОСТ Р');
      const gost = gostBest ? [gostBest, gostBest] : null;
      r.organizations.forEach(o => { o.role = 'manufacturer'; }); // в сертификате — орган по сертификации и изготовитель, не участники стройки
      // имя файла набрано человеком — номер, даты и наименование из него надёжнее распознанного скана
      r.materials.push({
        name: fn.name || (prod && !/^(ТУ|ГОСТ|СТО)\s/i.test(str(prod[1])) ? str(prod[1]).slice(0, 250) : ''), mark: '', gost: gost ? gost[1].replace(/\.$/, '') : '',
        // «Общество с ограниченной ответстве: ‘ностью «ТехноПласт»» (OCR порвал слово) → ООО «ТехноПласт»
        maker: maker ? orgName(str(maker[1]).replace(/^общество\s+с\s+огран[^«"]*(?=[«"])/i, 'ООО ').replace(/^акционерное\s+общ[^«"]*(?=[«"])/i, 'АО ').replace(/[,.;|]?\s*(ИНН|ОГРН|адрес|место нахождения|юр\.|тел).*$/i, '').replace(/[,;]?\s+[=|{}<>—–~].*$/, '').replace(/[\s,|{}()<>=—–-]+$/, '').replace(/,\s*[A-Za-z]{1,3}$/, '')).slice(0, 120) : '',
        doc_type: tp, doc_no: docNo, doc_date: fn.doc_date || (from && tp !== 'Отказное письмо' ? iso(from[1]) : ''), doc_until: fn.doc_until || (until && tp !== 'Отказное письмо' ? iso(until[1]) : ''),
        supplier: '', delivery_doc: '', delivery_date: '', qty: '', unit: '', _ocrName: prod ? str(prod[1]).slice(0, 250) : ''
      });
    }
    if (r.doc_kind === 'invoice' || r.doc_kind === 'waybill') {
      // документ поставки (УПД, накладная) важнее счёта и заказа: он идёт в журнал входного контроля
      // «от» на фото OCR читает и латиницей («or», «oт»)
      const OT = '\\s+(?:от|оt|or|oт|ot)\\s+';
      const no = new RegExp('(упд|передаточный документ|товарная накладная|сч[её]т-фактура|документ отгрузки)\\s*(?:№|N|No)?\\s*([^\\n]{1,40}?)' + OT + DATE, 'i').exec(t)
        || new RegExp('(сч[её]т(?:-оферта| на оплату)?|заказ покупателя|упд|универсальный передаточный документ|товарная накладная|накладная)\\s*№\\s*([^\\n]{1,40}?)' + OT + DATE, 'i').exec(t);
      const kind = no && (/упд|передаточн|накладн|отгрузк/i.test(no[1]) ||(/фактура/i.test(no[1]) && /передаточн/i.test(t))) ? 'УПД' : 'счёт';
      const docNo = no ? no[2].replace(/^([A-Za-zА-Яа-яЁё]+)\s+(\d)/, '$1$2').trim() : '';
      const docDate = no ? iso(no[3]) : '';
      const deliveryDoc = no ? kind + ' № ' + docNo + ' от ' + C.fmtDate(docDate) : '';
      r.summary = deliveryDoc ? deliveryDoc.charAt(0).toUpperCase() + deliveryDoc.slice(1) : (r.doc_kind === 'invoice' ? 'Счёт' : 'УПД / накладная');
      r.organizations.forEach(o => { o.role = 'supplier'; }); // стороны счёта — поставщик и мы сами
      const lines = layout ? (layout.find(ls => ls.some(l => /^(Поставщик|Продавец)/i.test(l.text))) || layout[0]) : t.split('\n').map(x => ({ text: x }));
      const sup = supplierFromLines(lines);
      if (layout) {
        // фото / скан: свой разбор по столбцу сумм; если он ничего не нашёл — общий, как для PDF
        let rows = layout.some(ls => ls.ocr) ? layout.flatMap(ocrTable) : [];
        if (!rows.length) rows = invoiceTable(layout);
        if (rows.length && rows.every(row => ADVANCE_RE.test(row.name))) r.summary += ' (аванс — материалов нет)';
        rows.forEach(row => {
          if (ADVANCE_RE.test(row.name)) return;
          // работы подрядчика (монтаж, устройство…) — в смету с ценой работ, а не в материалы
          if (WORK_RE.test(row.name)) {
            r.estimate.push({ name: row.name, unit: row.unit, qty: String(row.qty), price_work: String(row.price), price_mat: '' });
            return;
          }
          r.materials.push({
            name: row.name, mark: '', gost: '', maker: '', doc_type: '', doc_no: '', doc_date: '', doc_until: '',
            supplier: sup ? sup.name : '', delivery_doc: deliveryDoc, delivery_date: kind === 'УПД' ? docDate : '',
            qty: String(row.qty), unit: row.unit, _service: SERVICE_RE.test(row.name), _price: row.price
          });
        });
        if (!rows.length) r.summary += ' (строки товаров не найдены)';
        if (r.estimate.length) r.summary += ' · работ в смету: ' + r.estimate.length;
      }
    }
    if (r.doc_kind === 'act') {
      const no = new RegExp('(акт[^\\n№]{0,60}|смет[^\\n№]{0,40}|расч[её]т[^\\n№]{0,40})№\\s*([^\\s,]{1,20})(?:\\s+от\\s+' + DATE + ')?', 'i').exec(t);
      r.summary = (/смет|расч/i.test(no ? no[1] : head3.slice(0, 300)) ? 'Смета' : 'Акт выполненных работ') + (no ? ' № ' + no[2] + (no[3] ? ' от ' + C.fmtDate(iso(no[3])) : '') : '');
      if (layout) {
        let rows = layout.some(ls => ls.ocr) ? layout.flatMap(ocrTable) : [];
        if (!rows.length) rows = invoiceTable(layout);
        rows.filter(row => !ADVANCE_RE.test(row.name)).forEach(row => r.estimate.push({ name: row.name, unit: row.unit, qty: String(row.qty), price_work: String(row.price), price_mat: '' }));
      }
      r.summary += r.estimate.length ? ' · позиций в смету: ' + r.estimate.length : ' (строки работ не найдены — перенесите через «Разметить по тексту» или загрузите Excel)';
    }
    if (!r.summary) r.summary = ({ contract: 'Договор', certificate: 'Документ о качестве', invoice: 'Счёт', waybill: 'Накладная / УПД', other: 'Документ' })[r.doc_kind] || 'Документ';
    return r;
  }

  // ---------- ИИ: Claude API ----------
  const S = { type: 'string' };
  const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
  const SCHEMA = obj({
    doc_kind: { type: 'string', enum: ['contract', 'certificate', 'invoice', 'waybill', 'estimate', 'act', 'other'] },
    summary: S,
    contract: obj({ number: S, date: S, object_name: S, object_address: S, work_start: S, work_end: S }),
    organizations: { type: 'array', items: obj({ role: { type: 'string', enum: ['customer', 'contractor', 'designer', 'supplier', 'manufacturer', 'other'] }, type: { type: 'string', enum: ['ЮЛ', 'ИП', 'ФЛ'] }, name: S, ogrn: S, inn: S, address: S, phone: S, okpo: S, sro_name: S, sro_ogrn: S, sro_inn: S }) },
    people: { type: 'array', items: obj({ full_name: S, position: S, org_name: S, auth_doc: S }) },
    materials: { type: 'array', items: obj({ name: S, mark: S, gost: S, maker: S, doc_type: S, doc_no: S, doc_date: S, doc_until: S, supplier: S, delivery_doc: S, delivery_date: S, qty: S, unit: S }) },
    estimate: { type: 'array', items: obj({ name: S, unit: S, qty: S, price_work: S, price_mat: S }) }
  });
  const SYSTEM = `Ты извлекаешь данные из документов российского строительного объекта для ведения исполнительной документации (акты АОСР, журнал входного контроля, КС-2/КС-3).
Документы: договоры подряда, сертификаты и декларации соответствия, паспорта качества, счета, УПД и накладные, сметы, Excel-таблицы.

Правила:
- Переписывай значения дословно, как в документе. Ничего не придумывай: если значения нет, оставь пустую строку.
- Даты — в формате YYYY-MM-DD. Количества и цены — числом в строке, точка как десятичный разделитель, без пробелов и валюты.
- summary — одна строка: вид документа, номер и дата (например «Сертификат соответствия № РОСС RU.… до 12.10.2026»).
- contract заполняй только для договора (номер, дата, объект, адрес, сроки работ). Для других документов оставь поля пустыми.
- organizations: стороны с реквизитами. role: customer — заказчик/застройщик, contractor — подрядчик/генподрядчик, designer — проектировщик, supplier — поставщик или продавец, manufacturer — изготовитель. Название в форме «ООО «Название»». Данные СРО — если указаны.
- people: подписанты и представители с должностями и документами о полномочиях (устав, доверенность, приказ).
- materials: по одной записи на каждую позицию материала или изделия.
  • Сертификат, декларация, паспорт: name — продукция, mark — марка или типоразмер, gost — ГОСТ или ТУ, maker — изготовитель; doc_type — вид документа («Сертификат соответствия», «Декларация о соответствии», «Паспорт качества», «Сертификат качества», «Документ о качестве», «Свидетельство о государственной регистрации», «Протокол испытаний», «Отказное письмо»); doc_no, doc_date, doc_until — номер, дата и срок действия.
  • Счёт, УПД, накладная: строки товаров. name и mark — из наименования товара, qty и unit — количество и единица, supplier — продавец («ООО «…»»), delivery_doc — «счёт № … от ДД.ММ.ГГГГ» или «УПД № … от ДД.ММ.ГГГГ», delivery_date — дата отгрузки или документа (для УПД и накладных).
  • Транспорт, доставку, услуги и скидки в materials не включай.
- estimate: строки сметы или приложения с ценами работ (name, unit, qty, price_work — цена работ за единицу с НДС, price_mat — цена материала за единицу с НДС). Сюда же — работы из счетов, УПД, актов выполненных работ и КС-2 (монтаж, устройство, укладка и т. п.): они не материалы и в materials не попадают. Доставку и аренду техники оставляй в materials.`;

  let sdk = null;
  async function aiParse(file, buf, textFallback) {
    if (!sdk) {
      try { sdk = await import(SDK_URL); } catch (e) { throw new Error('Нет связи с интернетом — ИИ недоступен'); }
    }
    const Anthropic = sdk.default || sdk.Anthropic;
    const client = new Anthropic({ apiKey: aiSettings.key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const e = ext(file.name);
    const content = [];
    if (e === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(buf) } });
    else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e)) content.push({ type: 'image', source: { type: 'base64', media_type: file.type || ('image/' + (e === 'jpg' ? 'jpeg' : e)), data: b64(buf) } });
    else content.push({ type: 'text', text: 'Содержимое файла «' + file.name + '»:\n\n' + textFallback });
    content.push({ type: 'text', text: 'Извлеки данные из этого документа («' + file.name + '»).' });
    let resp;
    try {
      resp = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } }
      });
    } catch (err) {
      if (err instanceof sdk.AuthenticationError) throw new Error('Неверный API-ключ');
      if (err instanceof sdk.PermissionDeniedError) throw new Error('Ключ не имеет доступа к модели');
      if (err instanceof sdk.RateLimitError) throw new Error('Превышен лимит запросов, попробуйте через минуту');
      if (err instanceof sdk.BadRequestError) throw new Error('Документ не принят: ' + (err.message || '').slice(0, 200));
      if (err instanceof sdk.APIConnectionError) throw new Error('Нет связи с сервером Anthropic');
      if (err instanceof sdk.APIError) throw new Error('Ошибка API: ' + (err.message || '').slice(0, 200));
      throw err;
    }
    if (resp.stop_reason === 'refusal') throw new Error('ИИ отказался обрабатывать документ');
    if (resp.stop_reason === 'max_tokens') throw new Error('Документ слишком большой — ответ ИИ обрезан. Разделите файл на части.');
    const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    try { return JSON.parse(txt); } catch (e2) { throw new Error('ИИ вернул неразборчивый ответ'); }
  }

  // ================= Excel: сопоставление столбцов =================
  const TARGETS = {
    materials: {
      label: 'Материалы', fields: [
        ['name', 'Наименование', /наимен|материал|товар|продукц|издели/], ['mark', 'Марка, типоразмер', /марк|типоразм|артикул|размер/],
        ['gost', 'ГОСТ / ТУ', /гост|\bту\b|стандарт/], ['maker', 'Производитель', /изготов|производ/],
        ['doc1Type', 'Вид документа', /вид док|тип док|документ кач|вид сертиф/], ['doc1No', '№ документа', /(№|номер).{0,20}(сертиф|декл|док|паспорт)|сертификат|декларац/],
        ['doc1Date', 'Дата документа', /дата.{0,15}(сертиф|декл|док|выдач|паспорт)/], ['doc1Until', 'Действует до', /действ|срок|окончан/],
        ['supplier', 'Поставщик', /поставщ|продав|контрагент/], ['delivery', 'УПД / ТН / счёт', /упд|накладн|сч[её]т|док.{0,10}постав/],
        ['deliveryDate', 'Дата поставки', /дата.{0,12}(постав|поступ|отгруз|прих)/], ['qty', 'Количество', /кол-?во|количеств/], ['unit', 'Ед. изм.', /^ед|ед\.|единиц/]
      ]
    },
    smeta: {
      label: 'Смета', fields: [
        ['name', 'Наименование работ и затрат', /наимен|работ[ыа]? и затрат|вид работ/], ['unit', 'Ед. изм.', /^ед|ед\.|единиц/],
        ['qty', 'Количество', /кол-?во|количеств|объ[её]м/], ['priceWork', 'Цена работ за ед.', /(стоим|цена).{0,25}работ|цена за ед|расценк/],
        ['priceMat', 'Цена материала за ед.', /(стоим|цена).{0,25}матер/]
      ]
    }
  };
  function guessMapping(rows, target) {
    const fields = TARGETS[target].fields;
    let best = { row: 0, score: -1, map: {} };
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const map = {}; let score = 0;
      rows[r].forEach((cell, c) => {
        const h = norm(cell);
        if (!h || h.length > 120) return;
        const f = fields.find(([k, , re]) => !Object.values(map).includes(k) && re.test(h));
        if (f && map[c] === undefined) { map[c] = f[0]; score++; }
      });
      if (score > best.score) best = { row: r, score, map };
    }
    return best;
  }
  function excelToResult(rows, headerRow, map, target) {
    const r = emptyResult();
    r.doc_kind = target === 'smeta' ? 'estimate' : 'other';
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i]; const o = {};
      Object.entries(map).forEach(([c, k]) => { if (k) o[k] = row[c]; });
      if (!str(o.name) || /^итого|^всего/i.test(str(o.name))) continue;
      if (target === 'smeta') r.estimate.push({ name: str(o.name), unit: str(o.unit), qty: String(numStr(o.qty)), price_work: String(numStr(o.priceWork)), price_mat: String(numStr(o.priceMat)) });
      else r.materials.push({ name: str(o.name), mark: str(o.mark), gost: str(o.gost), maker: str(o.maker), doc_type: str(o.doc1Type), doc_no: str(o.doc1No), doc_date: iso(o.doc1Date), doc_until: iso(o.doc1Until), supplier: str(o.supplier), delivery_doc: str(o.delivery), delivery_date: iso(o.deliveryDate), qty: String(numStr(o.qty)), unit: str(o.unit) });
    }
    r.summary = target === 'smeta' ? 'Позиции сметы: ' + r.estimate.length : 'Материалы: ' + r.materials.length;
    return r;
  }

  // ================= книга «Генератор ИД» (.xlsm) целиком =================
  function isGeneratorBook(wb) { return ['Реквизиты', 'Журнал', 'Материалы', 'Справочник'].every(n => wb.SheetNames.includes(n)); }
  function generatorToProject(wb) {
    const p = C.emptyProject();
    const cell = (sh, a) => { const ws = wb.Sheets[sh]; const c = ws && ws[a]; return c ? c.v : ''; };
    const T = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : str(v);
    const rng = (sh, r1, r2, c1, c2) => { const out = []; for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(cell(sh, XLSX.utils.encode_cell({ r: r - 1, c: c - 1 }))); out.push(row); } return out; };
    const R = a => cell('Реквизиты', a);
    Object.assign(p.settings, { objectName: T(R('B5')), address: T(R('B6')), workKind: T(R('B7')) || 'строительство', contractNo: T(R('B8')), contractDate: iso(R('B9')), projectCode: T(R('B10')), projectDocName: T(R('B11')), vat: typeof R('B12') === 'number' ? R('B12') : 0.22, copies: R('B13') || 3, permit: T(R('B14')), expertise: T(R('B15')), startDate: iso(R('B16')), endDate: iso(R('B17')), objectInfo: T(R('B18')) });
    Object.assign(p.ks, { number: T(R('B21')), date: iso(R('B22')), periodFrom: iso(R('B23')), periodTo: iso(R('B24')), opType: T(R('B25')), term: T(R('B26')), pricesAt: T(R('B27')), contractorSignerPos: T(R('B28')), contractorSignerName: T(R('B29')), customerSignerPos: T(R('B30')), customerSignerName: T(R('B31')), stageName: T(cell('КС-3', 'C26')) });
    rng('Реквизиты', 35, 46, 1, 12).forEach(v => { if (!T(v[0]) && !T(v[3])) return; p.orgs.push({ id: C.uid(), key: T(v[0]), role: T(v[1]), type: T(v[2]), name: T(v[3]), ogrn: T(v[4]), inn: T(v[5]), address: T(v[6]), phone: T(v[7]), okpo: T(v[8]), sroName: T(v[9]), sroOgrn: T(v[10]), sroInn: T(v[11]) }); });
    rng('Реквизиты', 54, 83, 1, 8).forEach(v => { if (!T(v[2])) return; p.people.push({ id: C.uid(), role: T(v[0]), orgKey: T(v[1]), fullName: T(v[2]), position: T(v[3]), authDoc: T(v[4]), nrs: T(v[5]), from: iso(v[6]), to: iso(v[7]) }); });
    const matByLabel = {};
    rng('Материалы', 5, 404, 1, 20).forEach(v => {
      if (!T(v[1]) || /^ПРИМЕР/i.test(T(v[1]))) return;
      const id = C.uid();
      p.materials.push({ id, name: T(v[1]), mark: T(v[2]), gost: T(v[3]), maker: T(v[4]), doc1Type: T(v[5]), doc1No: T(v[6]), doc1Date: iso(v[7]), doc1Until: iso(v[8]), doc2Type: T(v[9]), doc2No: T(v[10]), doc2Date: iso(v[11]), doc2Until: iso(v[12]), supplier: T(v[13]), delivery: T(v[14]), deliveryDate: iso(v[15]), qty: typeof v[16] === 'number' ? v[16] : numStr(v[16]), unit: T(v[17]), vk: T(v[18]) });
      matByLabel[T(v[19])] = id;
    });
    const workByLabel = {};
    rng('Справочник', 5, 124, 1, 8).forEach(v => { if (!T(v[3])) return; const id = C.uid(); p.works.push({ id, code: T(v[0]), actType: T(v[1]), section: T(v[2]), name: T(v[3]), norms: T(v[4]), next: T(v[5]), docs: T(v[6]) }); workByLabel[T(v[7])] = id; });
    rng('Журнал', 7, 306, 1, 34).forEach(v => {
      if (!T(v[2])) return;
      const mark = T(v[1]).toLowerCase();
      p.acts.push({ id: C.uid(), print: mark && mark !== '0' ? 1 : '', type: T(v[2]), section: T(v[3]), manualNo: T(v[4]), workId: workByLabel[T(v[6])] || '', axes: T(v[7]), manualName: T(v[8]), executor: T(v[9]), start: iso(v[10]), end: iso(v[11]), actDate: iso(v[12]), sheets: T(v[13]), materials: v.slice(14, 24).map(l => matByLabel[T(l)]).filter(Boolean), docs: T(v[24]), expertise: T(v[25]), tests: T(v[26]), hiddenActs: T(v[27]), loadCond: T(v[28]), manualNorms: T(v[29]), manualNext: T(v[30]), extra: T(v[31]), manualAttach: T(v[32]), copies: T(v[33]) });
    });
    if (wb.Sheets['Смета']) rng('Смета', 26, 65, 2, 6).forEach(v => { if (!T(v[0])) return; p.smeta.push({ id: C.uid(), name: T(v[0]), unit: T(v[1]), qty: numStr(v[2]), priceWork: numStr(v[3]), priceMat: numStr(v[4]) }); });
    if (wb.Sheets['ОЖР Титул']) Object.assign(p.ozhr, { builderRepName: T(cell('ОЖР Титул', 'B26')), builderRepPos: T(cell('ОЖР Титул', 'C26')), builderRepDoc: T(cell('ОЖР Титул', 'D26')), builderRepNrs: T(cell('ОЖР Титул', 'E26')) });
    if (wb.Sheets['ОЖР Р1']) rng('ОЖР Р1', 6, 60, 2, 6).forEach(v => { if (!T(v[0]) && !T(v[1])) return; p.ozhr.r1.push({ id: C.uid(), org: T(v[0]), person: T(v[1]), start: T(v[2]), end: T(v[3]), signer: T(v[4]) }); });
    if (wb.Sheets['Списки']) {
      const col = c => rng('Списки', 2, 60, c, c).map(x => T(x[0])).filter(Boolean);
      const L = { actTypes: col(1), sections: col(2), docTypes: col(3), orgRoles: col(5), personTypes: col(6), vk: col(7) };
      Object.keys(L).forEach(k => { if (L[k].length) p.lists[k] = L[k]; });
    }
    return p;
  }

  // ================= предложения изменений =================
  const ROLE_MAP = { customer: C.ORG_ROLE.customer, contractor: C.ORG_ROLE.builder, designer: C.ORG_ROLE.designer };
  const F = (k, l, t) => ({ k, l, t: t || 'text' });

  function orgKeyFromName(name) {
    const m = /[«"]([^»"]+)[»"]/.exec(name);
    return str(m ? m[1] : name).slice(0, 30);
  }
  function findMaterial(P, m) {
    const n = norm(m.name + ' ' + m.mark);
    if (m.doc_no) {
      // ближайший номер; соседние номера одной серии (…000012 и …000013) различаем — нужен однозначный минимум
      const scored = P.materials.map(x => ({ x, d: Math.min(docDist(x.doc1No, m.doc_no), docDist(x.doc2No, m.doc_no)) })).filter(s => s.d < Infinity).sort((a, b) => a.d - b.d);
      if (scored.length && (scored.length === 1 || scored[1].d > scored[0].d)) return scored[0].x;
    }
    return P.materials.find(x => n.length > 3 && norm(x.name + ' ' + (x.mark || '')) === n) || null;
  }

  // что дописать в существующий материал: только пустые поля, документ — в свободный слот
  function matUpdates(ex, vals) {
    const upd = {};
    const hasDoc = vals.doc1No || vals.doc1Type;
    const sameDoc = vals.doc1No && (sameDocNo(ex.doc1No, vals.doc1No) || sameDocNo(ex.doc2No, vals.doc1No));
    // документ того же вида без номера (отказное письмо) уже есть — не дублируем
    const sameTypeNoNum = !vals.doc1No && vals.doc1Type && (ex.doc1Type === vals.doc1Type || ex.doc2Type === vals.doc1Type);
    if (hasDoc && !sameDoc && !sameTypeNoNum) {
      const slot = !ex.doc1Type && !ex.doc1No ? 'doc1' : (!ex.doc2Type && !ex.doc2No ? 'doc2' : null);
      if (slot) ['Type', 'No', 'Date', 'Until'].forEach(s => { if (vals['doc1' + s]) upd[slot + s] = vals['doc1' + s]; });
    } else if (sameDoc) {
      const slot = sameDocNo(ex.doc1No, vals.doc1No) ? 'doc1' : 'doc2';
      ['Date', 'Until'].forEach(s => { if (vals['doc1' + s] && !ex[slot + s]) upd[slot + s] = vals['doc1' + s]; });
    }
    ['gost', 'maker', 'supplier', 'delivery', 'deliveryDate', 'qty', 'unit', 'mark'].forEach(k => { if (vals[k] !== '' && vals[k] !== undefined && !str(ex[k])) upd[k] = vals[k]; });
    return upd;
  }
  // похожий материал по значимым словам и числам (диаметры, толщины); только если совпадение однозначное
  const STOP = /^(марк|толщ|разм|длин|шири|техн|строи|издел|сист|черн|бел|сер|для|част|прим|прои|издел|упак|сорт|тип|вид|гост)/;
  function matFeatures(t) {
    const n = norm(t);
    const words = new Set(n.replace(/[^a-zа-я0-9 ]/g, ' ').split(' ')
      .filter(w => w.length >= 4 && !/\d/.test(w) && !STOP.test(w))
      .map(w => w.slice(0, w.length >= 6 ? 5 : 4)));
    const dims = new Set();
    n.replace(/(?:^|[^a-zа-я])(?:d|ø|ф|диам\.?|∅)\s*(\d{2,4})/g, (m, d) => dims.add(d));
    n.replace(/(\d{2,4})\s*[хx×*]\s*\d/g, (m, d) => dims.add(d));
    n.replace(/(?:^|[^\d,.])(\d{1,3})\s*мм/g, (m, d) => dims.add(d));
    const nums = new Set((n.match(/\d{2,4}/g) || []));
    return { words, dims, nums };
  }
  // похожий материал: общие значимые слова, совпадение диаметров; разные диаметры — точно другой материал
  function guessMaterial(P, vals) {
    const a = matFeatures(vals.name + ' ' + vals.mark);
    let best = null, bs = 0, second = 0;
    P.materials.forEach(m => {
      const b = matFeatures(m.name + ' ' + (m.mark || ''));
      let w = 0; b.words.forEach(x => { if (a.words.has(x)) w++; });
      const dimMatch = a.dims.size && b.dims.size ? [...a.dims].some(d => b.dims.has(d)) : null;
      if (!w && !dimMatch) return;
      let sc = w;
      if (dimMatch !== null) sc += dimMatch ? 2 : -3;
      b.nums.forEach(x => { if (a.nums.has(x)) sc += 0.5; });
      if (sc > bs) { second = bs; bs = sc; best = m; } else if (sc > second) second = sc;
    });
    return bs >= 1 && bs > second ? best : null;
  }

  // предложение «материал»: новый или дописать в существующий (похожий подбирается сам)
  function matAddProposal(P, vals, m) {
    m = m || {};
    const guess = vals.name ? guessMaterial(P, vals) : null;
    const data = Object.assign({ _target: guess ? guess.id : '' }, vals);
    return {
      kind: m._service ? 'Услуга' : 'Материалы',
      title: (m._service ? 'Услуга, не материал: ' : 'Материал: ') + ([vals.name, vals.mark].filter(Boolean).join(' ') || 'без названия') +
        (m._price ? ' — ' + C.qty(vals.qty) + ' ' + vals.unit + ' × ' + C.money(m._price) : ''),
      checked: !m._service, data, srcLearned: m._learned,
      // заголовок по текущим значениям — после правок в разметке он меняется
      titleOf: d => (m._service ? 'Услуга, не материал: ' : 'Материал: ') + ([d.name, d.mark].filter(Boolean).join(' ') || 'без названия') + (d._target ? ' → дописать к ' + C.matLabel(P, P.materials.find(x => x.id === d._target) || {}) : ''),
      fields: [F('_target', 'Куда записать', 'matTarget')].concat(Object.keys(MAT_LABELS).map(k => F(k, MAT_LABELS[k], /Date|Until/.test(k) ? 'date' : (k === 'doc1Type' ? 'docType' : 'text')))),
      valid: d => d.name || d._target ? '' : 'укажите наименование материала',
      apply: d => {
        const v = Object.assign({}, d, { qty: d.qty === '' ? '' : C.num(d.qty) }); delete v._target;
        const tgt = d._target && P.materials.find(x => x.id === d._target);
        if (tgt) Object.assign(tgt, matUpdates(tgt, v));
        else P.materials.push(Object.assign({ id: C.uid() }, v));
      }
    };
  }
  // пустые предложения — заполнить вручную из распознанного текста
  function blankProposal(kind, source) {
    const P = A.project;
    let p;
    if (kind === 'material') {
      const vals = {}; Object.keys(MAT_LABELS).forEach(k => { vals[k] = ''; });
      p = matAddProposal(P, vals); p.title = 'Материал (заполнить из текста)';
    } else if (kind === 'contract') {
      const labels = { contractNo: 'Номер договора', contractDate: 'Дата договора', objectName: 'Наименование объекта', address: 'Адрес объекта', startDate: 'Начало работ', endDate: 'Окончание работ' };
      p = {
        kind: 'Объект и договор', title: 'Реквизиты договора и объекта (заполнить из текста)', checked: true,
        data: Object.fromEntries(Object.keys(labels).map(k => [k, ''])),
        fields: Object.keys(labels).map(k => F(k, labels[k] + (P.settings[k] ? ' (сейчас: ' + (k.endsWith('Date') ? C.fmtDate(P.settings[k]) : P.settings[k]) + ')' : ''), k.endsWith('Date') ? 'date' : 'text')),
        apply: d => { Object.keys(d).forEach(k => { if (str(d[k])) P.settings[k] = d[k]; }); }
      };
    } else {
      p = {
        kind: 'Организации', title: 'Организация (заполнить из текста)', checked: true,
        data: { key: '', role: '', type: 'ЮЛ', name: '', inn: '', ogrn: '', address: '', phone: '', okpo: '', sroName: '' },
        fields: [F('name', 'Наименование'), F('key', 'Ключ (краткое имя)'), F('role', 'Роль на объекте', 'orgRole'), F('inn', 'ИНН'), F('ogrn', 'ОГРН'), F('address', 'Адрес'), F('phone', 'Телефон'), F('okpo', 'ОКПО'), F('sroName', 'СРО')],
        valid: d => !d.name ? 'укажите наименование организации' : P.orgs.some(o => o.key === (d.key || orgKeyFromName(d.name))) ? 'ключ уже занят' : '',
        apply: d => P.orgs.push(Object.assign({ id: C.uid() }, d, { key: d.key || orgKeyFromName(d.name) }))
      };
    }
    p.id = C.uid(); p.source = source;
    return p;
  }

  function buildProposals(res, source) {
    const P = A.project;
    const out = [];
    learnRes(res);
    const st = P.settings;
    // договор → объект и договор
    const c = res.contract || {};
    const sets = {};
    [['contractNo', c.number], ['contractDate', iso(c.date)], ['objectName', c.object_name], ['address', c.object_address], ['startDate', iso(c.work_start)], ['endDate', iso(c.work_end)], ['contractPrice', c.price]]
      .forEach(([k, v]) => { if (str(v) && str(v) !== str(st[k])) sets[k] = str(v); });
    if (Object.keys(sets).length) {
      const labels = { contractNo: 'Номер договора', contractDate: 'Дата договора', objectName: 'Наименование объекта', address: 'Адрес объекта', startDate: 'Начало работ', endDate: 'Окончание работ', contractPrice: 'Цена договора, руб. с НДС' };
      out.push({
        kind: 'Объект и договор', title: 'Обновить реквизиты договора и объекта', checked: true, data: sets,
        fields: Object.keys(sets).map(k => F(k, labels[k] + (st[k] ? ' (сейчас: ' + (k.endsWith('Date') ? C.fmtDate(st[k]) : st[k]) + ')' : ''), k.endsWith('Date') ? 'date' : 'text')),
        apply: d => { Object.assign(P.settings, d); }
      });
    }
    // организации (заказчик, подрядчик, проектировщик и прочие участники; поставщики и изготовители идут в материалы)
    (res.organizations || []).forEach(o => {
      if (!o.name || o.role === 'supplier' || o.role === 'manufacturer') return;
      const ex = P.orgs.find(x => (o.inn && x.inn === o.inn) || norm(x.name) === norm(o.name));
      const map = { type: o.type, name: o.name, ogrn: o.ogrn, inn: o.inn, address: o.address, phone: o.phone, okpo: o.okpo, sroName: o.sro_name, sroOgrn: o.sro_ogrn, sroInn: o.sro_inn };
      if (ex) {
        const upd = {};
        Object.entries(map).forEach(([k, v]) => { if (str(v) && !str(ex[k])) upd[k] = str(v); });
        if (Object.keys(upd).length) out.push({
          kind: 'Организации', title: 'Дополнить реквизиты: ' + (ex.key || ex.name), checked: true, data: upd, srcOrg: o, orgRef: ex,
          fields: Object.keys(upd).map(k => F(k, ORG_LABELS[k])), apply: d => Object.assign(ex, d)
        });
        return;
      }
      const data = Object.assign({ key: orgKeyFromName(o.name), role: ROLE_MAP[o.role] || '' }, Object.fromEntries(Object.entries(map).map(([k, v]) => [k, str(v)])));
      if (!data.type) data.type = 'ЮЛ';
      out.push({
        kind: 'Организации', title: 'Добавить организацию: ' + o.name, checked: !!ROLE_MAP[o.role], data, srcOrg: o,
        fields: [F('key', 'Ключ (краткое имя)'), F('role', 'Роль в проекте', 'orgRole'), F('name', 'Наименование'), F('inn', 'ИНН'), F('ogrn', 'ОГРН'), F('address', 'Адрес'), F('phone', 'Телефон'), F('okpo', 'ОКПО'), F('sroName', 'СРО')],
        apply: d => P.orgs.push(Object.assign({ id: C.uid() }, d))
      });
    });
    // подписанты КС-2 / КС-3 из блока подписей договора
    const sgn = role => (res.organizations || []).find(o => o.role === role && (o.signer_name || o.signer_pos)) || {};
    const ksSet = {};
    [['contractorSignerPos', sgn('contractor').signer_pos], ['contractorSignerName', sgn('contractor').signer_name],
      ['customerSignerPos', sgn('customer').signer_pos], ['customerSignerName', sgn('customer').signer_name]]
      .forEach(([k, v]) => { if (str(v) && str(v) !== str(P.ks[k])) ksSet[k] = str(v); });
    if (Object.keys(ksSet).length) {
      const labels = { contractorSignerPos: 'Подписант Подрядчика: должность', contractorSignerName: 'Подписант Подрядчика: Фамилия И.О.', customerSignerPos: 'Подписант Заказчика: должность', customerSignerName: 'Подписант Заказчика: Фамилия И.О.' };
      out.push({
        kind: 'Объект и договор', ksSigners: true, title: 'Подписанты КС-2 / КС-3 и сметы', checked: true, data: ksSet,
        fields: Object.keys(ksSet).map(k => F(k, labels[k] + (P.ks[k] ? ' (сейчас: ' + P.ks[k] + ')' : ''))),
        apply: d => Object.assign(P.ks, d)
      });
    }
    // представители
    (res.people || []).forEach(h => {
      if (!h.full_name || P.people.some(x => norm(x.fullName) === norm(h.full_name))) return;
      const org = P.orgs.find(x => h.org_name && (norm(x.name) === norm(h.org_name) || norm(h.org_name).includes(norm(x.key))));
      out.push({
        kind: 'Представители', title: 'Добавить представителя: ' + h.full_name + (h.position ? ', ' + h.position : ''), checked: false,
        data: { role: '', orgKey: org ? org.key : '', fullName: str(h.full_name), position: str(h.position), authDoc: str(h.auth_doc), from: '' },
        fields: [F('role', 'Роль (обязательно)', 'repRole'), F('orgKey', 'Организация (ключ)', 'orgKey'), F('fullName', 'ФИО'), F('position', 'Должность'), F('authDoc', 'Документ о полномочиях'), F('from', 'Действует с', 'date')],
        valid: d => d.role ? '' : 'выберите роль представителя',
        apply: d => P.people.push(Object.assign({ id: C.uid() }, d))
      });
    });
    // материалы
    (res.materials || []).forEach(m => {
      if (!m.name && !m.doc_no) return;
      const vals = {
        name: str(m.name), mark: str(m.mark), gost: str(m.gost), maker: str(m.maker),
        doc1Type: str(m.doc_type), doc1No: str(m.doc_no), doc1Date: iso(m.doc_date), doc1Until: iso(m.doc_until),
        supplier: str(m.supplier), delivery: str(m.delivery_doc), deliveryDate: iso(m.delivery_date), qty: numStr(m.qty), unit: str(m.unit)
      };
      if (vals.doc1No && !vals.doc1Type) {
        if (/^(РОСС|POCC|RU\.)/i.test(vals.doc1No)) vals.doc1Type = 'Сертификат соответствия';
        else if (/^(ЕАЭС|EAЭС|RU\s*Д-|Д-)/i.test(vals.doc1No)) vals.doc1Type = 'Декларация о соответствии';
        else vals.doc1Type = 'Документ о качестве';
      }
      const ex = findMaterial(P, m);
      if (ex) {
        const upd = matUpdates(ex, vals);
        if (Object.keys(upd).length) out.push({
          kind: 'Материалы', title: 'Дополнить материал ' + C.matLabel(P, ex), checked: true, data: upd,
          fields: Object.keys(upd).map(k => F(k, MAT_LABELS[k] || MAT_LABELS[k.replace('doc2', 'doc1')] && MAT_LABELS[k.replace('doc2', 'doc1')].replace('Документ 1', 'Документ 2'), /Date|Until/.test(k) ? 'date' : 'text')),
          apply: d => Object.assign(ex, d)
        });
        return;
      }
      out.push(matAddProposal(P, vals, m));
    });
    // смета
    const est = (res.estimate || []).filter(r => r.name);
    if (est.length) {
      const rows = est.map(r => ({ id: C.uid(), name: str(r.name), unit: str(r.unit), qty: numStr(r.qty), priceWork: numStr(r.price_work), priceMat: numStr(r.price_mat) }));
      out.push({
        kind: 'Смета', title: 'Добавить в смету позиций: ' + rows.length + (P.smeta.length ? ' (в смете уже ' + P.smeta.length + ')' : ''), checked: true,
        data: { replace: P.smeta.length ? '' : 1 }, fields: P.smeta.length ? [F('replace', 'Заменить текущую смету, а не дописать', 'check')] : [],
        list: rows.map(r => r.name + ' — ' + C.qty(r.qty) + ' ' + r.unit + ' × ' + C.money(C.num(r.priceWork) + C.num(r.priceMat))),
        apply: d => { if (d.replace) P.smeta.splice(0, P.smeta.length); rows.forEach(r => P.smeta.push(r)); }
      });
    }
    out.forEach(p => { p.source = source; p.id = C.uid(); applyLearned(p); p.orig = Object.assign({}, p.data); });
    return out;
  }
  // ---------- обучение на поправках пользователя ----------
  // поправили в предложении «распознано → как надо» — в следующий раз подставляем сами (хранится на устройстве)
  const LEARN_KEY = 'idgen.learn';
  const LEARN_FIELDS = { 'Материалы': ['name', 'mark', 'maker', 'supplier', 'unit', 'gost'], 'Организации': ['name', 'key'] };
  const learnNorm = v => norm(v).replace(/[.,;:()«»"'\s-]+/g, ' ').trim();
  function learnLoad() { try { return JSON.parse(localStorage.getItem(LEARN_KEY)) || {}; } catch (e) { return {}; } }
  function learnFrom(p) {
    const ks = LEARN_FIELDS[p.kind]; if (!ks || !p.orig) return;
    const L = learnLoad(); let ch = false;
    ks.forEach(k => {
      const a = str(p.orig[k]), b = str(p.data[k]);
      if (!a || !b || a === b || (p.learned && p.learned[k])) return;
      (L[k] = L[k] || {})[learnNorm(a)] = b; ch = true;
    });
    if (ch) try { localStorage.setItem(LEARN_KEY, JSON.stringify(L)); } catch (e) { }
  }
  function applyLearned(p) {
    const ks = LEARN_FIELDS[p.kind]; if (!ks || !p.data) return;
    const L = learnLoad();
    ks.forEach(k => {
      const v = str(p.data[k]); if (!v || !L[k]) return;
      const fix = L[k][learnNorm(v)];
      if (fix && fix !== v) { p.data[k] = fix; (p.learned = p.learned || {})[k] = v; }
      // уже подставлено до подбора материала (learnRes) — только отмечаем
      else if (p.srcLearned && p.srcLearned[k]) (p.learned = p.learned || {})[k] = p.srcLearned[k];
    });
  }
  // поправки — в сам результат разбора, до подбора материала / организации в проекте
  const RES_KEYS = { name: 'name', mark: 'mark', maker: 'maker', supplier: 'supplier', unit: 'unit', gost: 'gost' };
  function learnRes(res) {
    const L = learnLoad();
    const fix = (o, k, lk) => { const v = str(o[k]); const f = v && L[lk] && L[lk][learnNorm(v)]; if (f && f !== v) { o[k] = f; (o._learned = o._learned || {})[lk] = v; } };
    (res.materials || []).forEach(m => Object.entries(RES_KEYS).forEach(([k, lk]) => fix(m, k, lk)));
    (res.organizations || []).forEach(o => fix(o, 'name', 'name'));
  }
  const ORG_LABELS ={ type: 'Тип лица', name: 'Наименование', ogrn: 'ОГРН', inn: 'ИНН', address: 'Адрес', phone: 'Телефон', okpo: 'ОКПО', sroName: 'СРО: наименование', sroOgrn: 'СРО: ОГРН', sroInn: 'СРО: ИНН' };
  const MAT_LABELS = { name: 'Наименование', mark: 'Марка, типоразмер', gost: 'ГОСТ / ТУ', maker: 'Производитель', doc1Type: 'Документ 1: вид', doc1No: 'Документ 1: №', doc1Date: 'Документ 1: дата', doc1Until: 'Документ 1: действует до', supplier: 'Поставщик', delivery: 'УПД / ТН / счёт', deliveryDate: 'Дата поставки', qty: 'Количество', unit: 'Ед. изм.' };

  // ================= обработка файлов =================
  // файлы обрабатываются по очереди: сканы тяжёлые, параллельно они только мешают друг другу
  let chain = Promise.resolve();
  function processFile(file) {
    const item = { id: C.uid(), name: file.name, status: 'В очереди…', note: '', proposals: [] };
    queue.unshift(item); draw();
    chain = chain.then(() => processItem(file, item));
    return chain;
  }
  async function processItem(file, item) {
    item.status = 'Читаю…'; draw();
    try {
      const e = ext(file.name);
      const buf = await readBuf(file);
      if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(e)) {
        const wb = await readWorkbook(buf);
        if (isGeneratorBook(wb)) {
          item.generator = generatorToProject(wb);
          item.status = 'Книга «Генератор ИД»';
          item.note = 'Актов: ' + item.generator.acts.length + ', материалов: ' + item.generator.materials.length + ', организаций: ' + item.generator.orgs.length;
        } else {
          item.excel = { wb, file, buf, sheet: wb.SheetNames[0], target: 'materials' };
          prepareExcel(item);
          item.status = 'Таблица Excel';
        }
      } else if (['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e)) {
        let text = '', layout = null;
        if (e === 'pdf') { const r = await pdfText(buf); text = r.text; layout = r.layout; item.scan = looksScanned(text, r.pages); }
        else if (e === 'docx') text = await docxText(buf);
        else if (e === 'txt') text = new TextDecoder().decode(buf);
        else item.scan = true;
        let res;
        if (aiOn()) {
          item.status = 'Распознаю через ИИ…'; draw();
          res = await aiParse(file, buf, text);
          if (text && text.trim()) item.rawText = text;
          item.via = 'ИИ';
        } else {
          if (item.scan) {
            // скан или фото — распознаём текст на устройстве
            item.status = 'Распознаю скан…'; draw();
            const images = e === 'pdf' ? await pdfImages(buf, 3) : [await loadImage(file)];
            const o = await ocrImages(images, (p, stage) => { item.status = 'Скан: ' + (stage || 'распознаю') + '… ' + Math.round(p * 100) + '%'; draw(); });
            text = o.text;
            // строки с координатами слов — для таблиц счетов, УПД и чеков на фото
            layout = o.layout.some(ls => ls.length) ? o.layout : null;
            item.via = 'офлайн, распознан скан';
          } else item.via = 'офлайн';
          item.rawText = text;
          res = offlineParse(text, layout, file.name);
        }
        item.res = res;
        item.proposals = buildProposals(res, file.name);
        autoFill(item);
        item.status = (res.summary || 'Документ') + ' · ' + item.via;
        if (!item.proposals.length) item.note = 'Новых данных не найдено (всё уже есть в проекте или документ не распознан).' + (item.rawText ? ' Можно перенести данные вручную: «Разметить по тексту».' : '');
        else if (item.via === 'офлайн') item.note = 'Разобрано по шаблонам — проверьте значения. Точнее и полнее распознаёт ИИ.';
      } else if (e === 'doc') {
        throw new Error('Старый формат .doc не поддерживается. Сохраните файл как .docx или PDF.');
      } else throw new Error('Неподдерживаемый тип файла: .' + e);
    } catch (err) {
      console.error(err);
      item.status = 'Ошибка'; item.note = err.message || String(err); item.error = true;
    }
    draw();
  }

  function prepareExcel(item) {
    const x = item.excel;
    x.rows = sheetRows(x.wb, x.sheet).filter(r => r.some(c => str(c)));
    const g = guessMapping(x.rows, x.target);
    x.headerRow = g.row; x.map = g.map;
  }

  async function excelViaAi(item) {
    item.status = 'Распознаю через ИИ…'; item.note = ''; draw();
    try {
      const res = await aiParse(item.excel.file, item.excel.buf, wbText(item.excel.wb));
      item.proposals = buildProposals(res, item.name);
      item.status = (res.summary || 'Таблица') + ' · ИИ';
      item.excel = null;
      if (!item.proposals.length) item.note = 'Новых данных не найдено.';
    } catch (err) { item.status = 'Ошибка'; item.note = err.message; }
    draw();
  }

  // ================= интерфейс =================
  let root = null;
  function view() {
    const { head, card, para, esc } = UI;
    const main = UI.main();
    main.appendChild(head('Загрузка документов', 'Договоры, сертификаты, паспорта, счета, УПД, сметы и таблицы Excel. Найденные данные показываются на проверку и попадают в проект только после подтверждения.'));
    // зона загрузки
    const drop = document.createElement('div'); drop.className = 'card drop';
    drop.innerHTML = '<div class="drop-inner"><b>Перетащите файлы сюда или вставьте скриншот (Ctrl+V)</b><span class="muted small">PDF, Word (.docx), Excel (.xlsx, .xlsm, .xls, .csv), фото и сканы (.jpg, .png), скриншоты и скопированный текст</span>' +
      '<div class="drop-btns"><label class="btn btn-primary">Выбрать файлы<input type="file" multiple hidden accept=".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv,.ods,.txt,.jpg,.jpeg,.png,.webp,.gif,image/*"></label>' +
      '<button type="button" class="btn" data-paste>Вставить из буфера</button></div></div>';
    const inp = drop.querySelector('input');
    drop.querySelector('[data-paste]').addEventListener('click', pasteFromButton);
    inp.addEventListener('change', () => { Array.from(inp.files).forEach(processFile); inp.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => Array.from(e.dataTransfer.files || []).forEach(processFile));
    main.appendChild(drop);
    // настройки ИИ
    const ai = card('Распознавание через ИИ (Claude)', []);
    ai.innerHTML += '<p class="muted small">Нужно для сканов и фото, а также для более точного разбора договоров, счетов и сертификатов. Документ отправляется в Anthropic (Claude API) и оплачивается по вашему API-ключу. Ключ хранится только на этом устройстве и не попадает в файл проекта. Получить ключ: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>' +
      '<div class="grid"><label class="field wide"><span>API-ключ Anthropic</span><input type="password" autocomplete="off" placeholder="sk-ant-…" id="aiKey"></label>' +
      '<label class="check"><input type="checkbox" id="aiOn"> Использовать ИИ для PDF, Word и фото</label></div>';
    $('#aiKey', ai).value = aiSettings.key || '';
    $('#aiOn', ai).checked = !!aiSettings.enabled;
    $('#aiKey', ai).addEventListener('input', e => { aiSettings.key = e.target.value.trim(); if (aiSettings.key && !aiSettings.enabled) { aiSettings.enabled = true; $('#aiOn', ai).checked = true; } saveAi(); });
    $('#aiOn', ai).addEventListener('change', e => { aiSettings.enabled = e.target.checked; saveAi(); if (aiSettings.enabled && !aiSettings.key) UI.toast('Введите API-ключ'); });
    main.appendChild(ai);
    root = document.createElement('div');
    main.appendChild(root);
    draw();
  }
  const $ = (s, r) => (r || document).querySelector(s);

  function draw() {
    if (!root || !document.body.contains(root)) return;
    const { esc } = UI;
    root.innerHTML = '';
    if (!queue.length) { root.innerHTML = '<div class="empty">Загруженных документов пока нет.</div>'; return; }
    const pending = queue.reduce((n, q) => n + q.proposals.filter(p => !p.done).length, 0);
    if (pending) {
      const bar = document.createElement('div'); bar.className = 'toolbar sticky-bar';
      bar.innerHTML = '<span class="muted small">Предложений к проверке: ' + pending + '</span>';
      bar.appendChild(UI.btn('Применить отмеченные', applyChecked, 'btn-primary'));
      // после смены проекта или ручных правок — заново сопоставить уже распознанные документы с проектом
      bar.appendChild(UI.btn('Обновить предложения', () => {
        queue.forEach(q => { if (q.res) { q.proposals = buildProposals(q.res, q.name).concat(q.proposals.filter(p => p.done)); autoFill(q); } });
        draw(); UI.toast('Предложения пересобраны под проект «' + A.projTitle(A.project) + '»');
      }));
      bar.appendChild(UI.btn('Очистить список', () => { queue.length = 0; draw(); }));
      root.appendChild(bar);
    } else root.appendChild(Object.assign(document.createElement('div'), { className: 'toolbar' })).appendChild(UI.btn('Очистить список', () => { queue.length = 0; draw(); }));

    queue.forEach(item => {
      const c = document.createElement('div'); c.className = 'card';
      c.innerHTML = '<div class="imp-head"><b>' + esc(item.name) + '</b><span class="badge ' + (item.error ? 'danger' : item.status.endsWith('…') ? '' : 'ok') + '">' + esc(item.status) + '</span>' + (item.status.endsWith('…') ? '<span class="spinner"></span>' : '') + '</div>' +
        (item.note ? '<p class="small ' + (item.error ? '' : 'muted') + '" style="' + (item.error ? 'color:var(--danger)' : '') + '">' + esc(item.note) + '</p>' : '') +
        (item.autoNote ? '<p class="small auto-note">' + esc(item.autoNote) + '</p>' : '');
      // договор другого объекта — отдельным проектом, а не поверх текущего
      if (item.res && item.res.doc_kind === 'contract' && !item.projectCreated) {
        const c0 = item.res.contract || {}, cur = A.project.settings;
        const other = c0.number && cur.contractNo && c0.number !== cur.contractNo;
        const nb = document.createElement('div'); nb.className = 'toolbar'; nb.style.margin = '8px 0 0';
        if (other) nb.insertAdjacentHTML('beforeend', '<span class="small auto-note">Договор № ' + esc(c0.number) + ' — похоже, другой объект: в открытом проекте договор № ' + esc(cur.contractNo) + '.</span>');
        nb.appendChild(UI.btn('Создать новый проект из договора', () => createProjectFromContract(item), other ? 'btn-primary' : ''));
        c.appendChild(nb);
      }
      if (item.generator) {
        const b = document.createElement('div'); b.className = 'toolbar';
        b.append(
          UI.btn('Открыть как новый проект', () => { A.openProject(JSON.parse(JSON.stringify(item.generator))); UI.toast('Проект открыт'); }, 'btn-primary'),
          UI.btn('Заменить текущий проект', () => UI.confirmBox('Заменить данные проекта «' + A.projTitle(A.project) + '» данными из книги? Текущие данные будут потеряны, если не сохранены в файл.', 'Заменить', () => { A.openProject(JSON.parse(JSON.stringify(item.generator)), A.project.id); UI.toast('Проект заменён'); }, true))
        );
        c.appendChild(b);
      }
      if (item.rawText) {
        const tb = document.createElement('div'); tb.className = 'toolbar'; tb.style.margin = '8px 0 0';
        tb.appendChild(UI.btn('Разметить по тексту — что в какое поле', () => openMapper(item), item.proposals.some(p => !p.done) ? '' : 'btn-primary'));
        c.appendChild(tb);
        const det = document.createElement('details'); det.className = 'raw-text';
        det.innerHTML = '<summary class="small muted">Распознанный текст</summary><pre></pre>';
        det.querySelector('pre').textContent = item.rawText.slice(0, 20000);
        c.appendChild(det);
      }
      if (item.excel) c.appendChild(excelPanel(item));
      item.proposals.forEach(p => c.appendChild(proposalEl(p)));
      root.appendChild(c);
    });
  }

  function excelPanel(item) {
    const { esc } = UI;
    const x = item.excel;
    const box = document.createElement('div');
    const T = TARGETS[x.target];
    const header = x.rows[x.headerRow] || [];
    const ncol = Math.max(0, ...x.rows.slice(0, 50).map(r => r.length));
    let html = '<div class="grid">' +
      '<label class="field"><span>Лист</span><select data-k="sheet">' + x.wb.SheetNames.map(n => '<option' + (n === x.sheet ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Загрузить в раздел</span><select data-k="target">' + Object.entries(TARGETS).map(([k, t]) => '<option value="' + k + '"' + (k === x.target ? ' selected' : '') + '>' + t.label + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Строка заголовков</span><select data-k="headerRow">' + x.rows.slice(0, 20).map((r, i) => '<option value="' + i + '"' + (i === x.headerRow ? ' selected' : '') + '>' + (i + 1) + ': ' + esc(r.filter(c => str(c)).slice(0, 4).join(' | ').slice(0, 70)) + '</option>').join('') + '</select></label></div>';
    html += '<h3>Какой столбец что означает</h3><div class="grid">';
    for (let ci = 0; ci < ncol; ci++) {
      const sample = x.rows.slice(x.headerRow + 1, x.headerRow + 3).map(r => str(r[ci])).filter(Boolean).join('; ').slice(0, 60);
      html += '<label class="field"><span>' + esc(str(header[ci]) || 'Столбец ' + (ci + 1)) + (sample ? ' <i class="muted">(' + esc(sample) + ')</i>' : '') + '</span><select data-col="' + ci + '"><option value="">— не загружать —</option>' +
        T.fields.map(([k, l]) => '<option value="' + k + '"' + (x.map[ci] === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
    }
    html += '</div>';
    box.innerHTML = html;
    box.querySelectorAll('select[data-k]').forEach(s => s.addEventListener('change', () => {
      const k = s.dataset.k;
      if (k === 'headerRow') { x.headerRow = +s.value; }
      else { x[k] = s.value; if (k === 'sheet') x.rows = null; prepareExcelKeep(item, k); }
      draw();
    }));
    box.querySelectorAll('select[data-col]').forEach(s => s.addEventListener('change', () => {
      const c = s.dataset.col;
      if (s.value) Object.keys(x.map).forEach(k => { if (x.map[k] === s.value) delete x.map[k]; });
      x.map[c] = s.value; if (!s.value) delete x.map[c];
      draw();
    }));
    const tb = document.createElement('div'); tb.className = 'toolbar'; tb.style.marginTop = '12px';
    tb.appendChild(UI.btn('Сформировать предложения', () => {
      if (!Object.values(x.map).includes('name')) { UI.toast('Укажите столбец с наименованием'); return; }
      const res = excelToResult(x.rows, x.headerRow, x.map, x.target);
      item.proposals = buildProposals(res, item.name);
      item.status = res.summary + ' · офлайн';
      item.note = item.proposals.length ? '' : 'Новых данных не найдено.';
      item.excel = null; draw();
    }, 'btn-primary'));
    if (aiOn()) tb.appendChild(UI.btn('Распознать через ИИ', () => excelViaAi(item)));
    box.appendChild(tb);
    return box;
  }
  function prepareExcelKeep(item, changed) {
    const x = item.excel;
    if (changed === 'sheet' || !x.rows) x.rows = sheetRows(x.wb, x.sheet).filter(r => r.some(c => str(c)));
    const g = guessMapping(x.rows, x.target);
    x.headerRow = g.row; x.map = g.map;
  }

  function proposalEl(p) {
    const { esc } = UI;
    const P = A.project;
    const el = document.createElement('div'); el.className = 'proposal' + (p.done ? ' done' : '');
    if (p.done) { el.innerHTML = '<span class="badge ok">применено</span> ' + esc(p.title); return el; }
    const titleText = () => p.titleOf ? p.titleOf(p.data) : p.title;
    el.innerHTML = '<label class="check prop-title"><input type="checkbox"' + (p.checked ? ' checked' : '') + '> <span><span class="badge">' + esc(p.kind) + '</span> <span class="prop-title-text">' + esc(titleText()) + '</span></span></label>';
    el.querySelector('input').addEventListener('change', e => { p.checked = e.target.checked; });
    if (p.titleOf) el.addEventListener('input', () => { el.querySelector('.prop-title-text').textContent = titleText(); });
    if (p.titleOf) el.addEventListener('change', () => { el.querySelector('.prop-title-text').textContent = titleText(); });
    const body = document.createElement('div'); body.className = 'grid prop-body';
    p.fields.forEach(f => {
      const w = document.createElement('label'); w.className = 'field';
      w.dataset.k = f.k; w.dataset.t = f.t; // для экрана разметки
      const v = p.data[f.k] === undefined ? '' : p.data[f.k];
      const isAuto = p.auto && p.auto[f.k];
      if (isAuto) w.classList.add('auto');
      let input;
      if (f.t === 'check') {
        w.className = 'check'; w.innerHTML = '<input type="checkbox"' + (v ? ' checked' : '') + '> ' + esc(f.l);
        w.querySelector('input').addEventListener('change', e => { p.data[f.k] = e.target.checked ? 1 : ''; });
        body.appendChild(w); return;
      }
      const wasLearned = p.learned && p.learned[f.k];
      w.innerHTML = '<span>' + esc(f.l) + (isAuto ? ' <em class="auto-tag">из текста</em>' : '') + (wasLearned ? ' <em class="auto-tag" title="Распознано: ' + esc(wasLearned) + '">как вы исправляли раньше</em>' : '') + '</span>';
      // поправили значение руками — пометка «из текста» больше не нужна
      if (isAuto) w.addEventListener('input', () => { delete p.auto[f.k]; w.classList.remove('auto'); const t = w.querySelector('.auto-tag'); if (t) t.remove(); }, { once: true });
      if (f.t === 'matTarget') {
        w.classList.add('wide');
        input = document.createElement('select');
        input.innerHTML = '<option value="">+ Новый материал</option>' + P.materials.map(m => '<option value="' + esc(m.id) + '"' + (m.id === v ? ' selected' : '') + '>Дописать к ' + esc(C.matLabel(P, m)) + '</option>').join('');
        input.addEventListener('change', () => { p.data[f.k] = input.value; });
        w.appendChild(input); body.appendChild(w); return;
      }
      const opts = f.t === 'orgRole' ? P.lists.orgRoles : f.t === 'repRole' ? C.REP_ROLES : f.t === 'orgKey' ? P.orgs.map(o => o.key) : f.t === 'docType' ? P.lists.docTypes : null;
      if (opts && f.t !== 'docType') {
        input = document.createElement('select');
        input.innerHTML = '<option value="">—</option>' + opts.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
      } else if (f.t === 'text' && (/^(address|name|objectName|maker|sroName|supplier|delivery)$/.test(f.k) || String(v).length > 45)) {
        // длинные значения (адрес, наименование) — многострочное поле, чтобы было видно целиком
        input = document.createElement('textarea'); input.value = v; input.className = 'prop-ta';
        const fit = () => { input.rows = Math.min(5, Math.max(1, Math.ceil(String(input.value).length / 55))); };
        fit(); input.addEventListener('input', fit);
      } else {
        input = document.createElement('input'); input.type = f.t === 'date' ? 'date' : 'text'; input.value = v;
        if (f.t === 'docType') { const id = 'dt' + p.id; input.setAttribute('list', id); w.insertAdjacentHTML('beforeend', '<datalist id="' + id + '">' + opts.map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>'); }
      }
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input', () => { p.data[f.k] = input.value; });
      w.appendChild(input);
      body.appendChild(w);
    });
    if (p.list) {
      const ul = document.createElement('ul'); ul.className = 'small prop-list';
      ul.innerHTML = p.list.slice(0, 30).map(t => '<li>' + esc(t) + '</li>').join('') + (p.list.length > 30 ? '<li>… и ещё ' + (p.list.length - 30) + '</li>' : '');
      body.appendChild(ul);
    }
    el.appendChild(body);
    return el;
  }

  // подпись поля в начале строки («Продукция:», «Изготовитель», «Регистрационный номер») в значение не переносим
  // ================= добор пустых полей из расшифровки: «подпись — значение» =================
  // для каждого поля: подписи, после которых (на той же строке или на следующей) стоит значение
  const KV = {
    name: [/наименование (?:продукции|товара|изделия|материала)/, /^продукция/, /^изделие/, /на отгружаемую партию/, /^товар\b/],
    mark: [/^марка/, /^типоразмер/, /^тип\b/, /^модель/, /^класс бетона/, /^класс прочности/],
    gost: [/изготовлен[а-я]* (?:в соответствии|по)/, /соответствует требованиям/, /нормативн[а-я]* документ/, /^стандарт/],
    maker: [/завод-изготовитель/, /^изготовитель/, /^производитель/],
    doc1No: [/регистрационный номер/, /^номер (?:сертификата|декларации|паспорта|документа)/],
    doc1Date: [/дата (?:выдачи|регистрации|оформления)/, /^выдан[а-я]*\s*(?:от|$)/],
    doc1Until: [/срок действия/, /действител[а-я]* (?:до|по)/, /действует (?:до|по)/],
    supplier: [/^поставщик/, /^продавец/, /^грузоотправитель/, /^отправитель/],
    delivery: [/^(?:товарная |транспортная )?накладная/, /^упд\b/, /^ттн\b/, /^счет[- ]фактура/],
    deliveryDate: [/дата (?:отгрузки|поставки|поступления|отпуска)/],
    qty: [/^количество/, /^кол-во/, /^объ[её]м партии/, /^масса нетто/, /^масса партии/, /^объ[её]м/],
    contractNo: [/^договор[а-я]* (?:подряда )?№/],
    objectName: [/наименование объекта/, /^объект(?: строительства)?\b/],
    address: [/адрес объекта/, /место (?:выполнения работ|нахождения объекта)/, /расположенн[а-я]* по адресу/],
    startDate: [/начал[оа] (?:выполнения )?работ/, /^срок начала/],
    endDate: [/окончани[ея] (?:выполнения )?работ/, /^срок окончания/],
    inn: [/^инн\b/], ogrn: [/^огрн/], okpo: [/^окпо/]
  };
  // какие поля добирать по виду документа: в счёте позиции уже разобраны по таблице — общий текст их не трогает
  const AUTO_FIELDS = {
    invoice: ['supplier', 'delivery', 'deliveryDate'],
    waybill: ['supplier', 'delivery', 'deliveryDate'],
    contract: ['contractNo', 'objectName', 'address', 'startDate', 'endDate', 'inn', 'ogrn', 'okpo']
  };
  // качество значения: в основном буквы/цифры, не служебный мусор OCR
  const looksOk = v => { const t = v.replace(/\s/g, ''); return t.length >= 2 && (t.match(/[0-9A-Za-zА-Яа-яЁё]/g) || []).length / t.length >= 0.6; };
  function kvExtract(text) {
    const lines = fixOcr(text).split('\n').map(l => l.replace(/[|¦]/g, ' | ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = {};
    Object.entries(KV).forEach(([k, res]) => {
      for (let i = 0; i < lines.length && !out[k]; i++) {
        const low = lines[i].toLowerCase();
        const re = res.find(r => r.test(low));
        if (!re) continue;
        const m = re.exec(low);
        // значение — после подписи на той же строке, иначе следующая непустая строка
        // документ поставки — вместе с видом документа: «Накладная № 518 от 12.10.2026»
        let rest = k === 'delivery' ? lines[i].slice(m.index).trim() : lines[i].slice(m.index + m[0].length).replace(/^[\s:|.\-–—№]+/, '').trim();
        if (k === 'delivery') rest = rest.charAt(0).toUpperCase() + rest.slice(1);
        if (!rest || rest.length < 2) rest = (lines[i + 1] || '').trim();
        rest = rest.replace(/\s*\|\s*$/, '').trim();
        if (rest && looksOk(rest)) out[k] = rest.slice(0, 250);
      }
    });
    return out;
  }
  // привести значение к полю; пусто — значит не подошло
  function fitValue(k, v, t) {
    if (!v) return '';
    if (t === 'date') return iso(v);
    if (k === 'qty') { const m = /(\d[\d\s]*(?:[.,]\d+)?)/.exec(v); return m ? m[1].replace(/\s/g, '').replace(',', '.') : ''; }
    if (k === 'unit') return normUnit(v);
    if (/No$/.test(k)) return cleanDocNo(v);
    if (k === 'inn') return (/\d{10,12}/.exec(v) || [''])[0];
    if (k === 'ogrn') return (/\d{13,15}/.exec(v) || [''])[0];
    if (k === 'okpo') return (/\d{8,10}/.exec(v) || [''])[0];
    if (k === 'maker' || k === 'supplier') return orgName(v.split(/,\s*(?=ИНН|ОГРН|\d{6}|адрес)/i)[0]);
    if (k === 'gost') { const g = /(ГОСТ\s*(?:Р\s*)?\d[\d.]*(?:\s*[-–]\s*\d{2,4})?|ТУ\s*[\d.\-–\s]{6,})/i.exec(v); return g ? g[1].replace(/\s*[-–]\s*/g, '-').trim() : ''; }
    if (k === 'contractNo') return (/^([^\s,]+)/.exec(v.replace(/^№\s*/, '')) || [''])[1];
    return v;
  }
  function autoFill(item) {
    if (!item.rawText || !item.rawText.trim()) return;
    const kv = kvExtract(item.rawText);
    let live = item.proposals.filter(p => !p.done);
    // разбор не нашёл в документе вообще ничего — создаём предложение по виду документа и заполняем из текста
    // (если документ узнан, но всё уже есть в проекте, — ничего не создаём, чтобы не плодить дубли)
    const r0 = item.res || {};
    const parsedSomething = (r0.materials || []).length || (r0.contract && r0.contract.number) || (r0.organizations || []).length || (r0.estimate || []).length;
    if (!live.length && !parsedSomething && Object.keys(kv).length) {
      const kind = item.res && item.res.doc_kind === 'contract' ? 'contract' : 'material';
      const p = blankProposal(kind, item.name);
      if (kind === 'material' && item.res && item.res.materials && item.res.materials[0]) {
        const m0 = item.res.materials[0];
        if (m0.doc_type) p.data.doc1Type = m0.doc_type;
      }
      item.proposals.push(p); live = [p]; p._created = true;
    }
    const allow = AUTO_FIELDS[item.res && item.res.doc_kind] || null;
    live.forEach(p => {
      p.auto = p.auto || {};
      // в договоре две стороны: первое «ОКПО» / «ИНН» в тексте может быть чужим — реквизиты берём только из колонки стороны
      if (p.kind === 'Организации' && (r0.organizations || []).length > 1) return;
      let n = 0;
      p.fields.forEach(f => {
        if (!KV[f.k] && f.k !== 'unit') return;
        if (allow && !p._created && !allow.includes(f.k)) return;
        if (str(p.data[f.k])) return;
        let v = f.k === 'unit' ? (/\d\s*([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z.²³/]*\d?)/.exec(kv.qty || '') || [])[1] : kv[f.k];
        v = fitValue(f.k, v, f.t);
        if (!v) return;
        p.data[f.k] = v; p.auto[f.k] = true; n++;
      });
      // наименование появилось — подберём похожий материал проекта
      if (n && p.data && '_target' in p.data && !p.data._target && p.data.name) {
        const g = guessMaterial(A.project, p.data); if (g) p.data._target = g.id;
      }
      if (p._created) p.title = n ? 'Заполнено из расшифровки — проверьте' : p.title;
    });
    // созданное «вслепую» предложение без единого значения не показываем
    item.proposals = item.proposals.filter(p => !p._created || Object.keys(p.auto || {}).length >= 2);
    const filled = item.proposals.reduce((s, p) => s + Object.keys(p.auto || {}).length, 0);
    item.autoNote = filled ? 'Из расшифровки добрано полей: ' + filled + '. Они отмечены «из текста» — проверьте их.' : '';
  }

  function stripLabel(t) {
    return str(t).replace(/^(наименование продукции|продукция|изделие|количество|кол-во|ед\. изм\.|изготовитель|производитель|заявитель|поставщик|продавец|покупатель|грузополучатель|марка|регистрационный номер(?: декларации)?|номер|№|дата регистрации|дата выдачи|срок действия|адрес(?: объекта)?|объект|инн|огрн)\s*(?:\([^)]*\))?\s*[:\-–]?\s+(?=\S)/i, '').trim();
  }

  // ================= новый проект из договора =================
  function createProjectFromContract(item) {
    const res = item.res, c0 = res.contract || {};
    const cur = A.project;
    const p = C.emptyProject();
    // из уже исправленных пользователем полей предложения «Объект и договор», иначе — из разбора
    const sp = item.proposals.find(x => x.kind === 'Объект и договор' && !x.done && !x.ksSigners);
    const d = sp ? sp.data : {};
    Object.assign(p.settings, {
      contractNo: d.contractNo || c0.number || '', contractDate: d.contractDate || iso(c0.date), objectName: d.objectName || c0.object_name || '',
      address: d.address || c0.object_address || '', startDate: d.startDate || iso(c0.work_start), endDate: d.endDate || iso(c0.work_end),
      contractPrice: d.contractPrice || c0.price || '',
      vat: cur.settings.vat, copies: cur.settings.copies
    });
    p.lists = JSON.parse(JSON.stringify(cur.lists));
    const roleOf = r => r === 'customer' ? C.ROLE.developer : r === 'contractor' ? C.ROLE.contractor : r === 'designer' ? C.ROLE.designer : '';
    (res.organizations || []).forEach(o => {
      if (!roleOf(o.role)) return;
      // то, что пользователь поправил в предложении по этой организации, важнее разбора
      const prop = item.proposals.find(x => x.kind === 'Организации' && x.srcOrg === o);
      const edits = prop ? prop.data : {};
      // организация уже заведена в текущем проекте (наша фирма) — берём её целиком вместе с представителями
      const known = (prop && prop.orgRef) || cur.orgs.find(x => (o.inn && x.inn === o.inn) || norm(x.name) === norm(o.name));
      if (known) {
        const org = Object.assign(JSON.parse(JSON.stringify(known)), edits, { id: C.uid(), role: roleOf(o.role) });
        p.orgs.push(org);
        cur.people.filter(x => x.orgKey === known.key && (!x.to || x.to >= C.todayISO())).forEach(x => p.people.push(Object.assign(JSON.parse(JSON.stringify(x)), { id: C.uid(), from: '', to: '' })));
        if (cur.settings.ourOrg === known.key) p.settings.ourOrg = known.key;
      } else {
        p.orgs.push(Object.assign({ id: C.uid(), key: orgKeyFromName(o.name), role: roleOf(o.role), type: o.type || 'ЮЛ', name: o.name, ogrn: o.ogrn || '', inn: o.inn || '', address: o.address || '', phone: o.phone || '', okpo: o.okpo || '', sroName: o.sro_name || '', sroOgrn: '', sroInn: '' },
          edits, { id: C.uid(), role: edits.role || roleOf(o.role) }));
      }
    });
    // подписанты КС: из предложения (с правками), иначе из блока подписей договора
    const ksp = item.proposals.find(x => x.ksSigners);
    const sg = role => (res.organizations || []).find(o => o.role === role) || {};
    Object.assign(p.ks, {
      contractorSignerPos: sg('contractor').signer_pos || '', contractorSignerName: sg('contractor').signer_name || '',
      customerSignerPos: sg('customer').signer_pos || '', customerSignerName: sg('customer').signer_name || ''
    }, ksp ? ksp.data : {});
    // наша организация не распозналась в договоре — всё равно переносим её с представителями (договор наш)
    const ours = C.orgByKey(cur, cur.settings.ourOrg);
    if (ours && !p.orgs.some(x => x.key === ours.key || (ours.inn && x.inn === ours.inn))) {
      p.orgs.push(Object.assign(JSON.parse(JSON.stringify(ours)), { id: C.uid() }));
      cur.people.filter(x => x.orgKey === ours.key && (!x.to || x.to >= C.todayISO())).forEach(x => p.people.push(Object.assign(JSON.parse(JSON.stringify(x)), { id: C.uid(), from: '', to: '' })));
      p.settings.ourOrg = ours.key;
    }
    (res.estimate || []).filter(r => r.name).forEach(r => p.smeta.push({ id: C.uid(), name: str(r.name), unit: str(r.unit), qty: numStr(r.qty), priceWork: numStr(r.price_work), priceMat: numStr(r.price_mat) }));
    // справочник работ и шаблоны — с текущего проекта, они от объекта не зависят
    p.works = JSON.parse(JSON.stringify(cur.works)).map(w => Object.assign(w, { id: C.uid() }));
    UI.confirmBox('Создать новый проект «' + (p.settings.objectName || 'объект') + (p.settings.contractNo ? ', дог. ' + p.settings.contractNo : '') + '»? Будут заведены: организации — ' + p.orgs.length + ', представители — ' + p.people.length + ', позиции сметы — ' + p.smeta.length + '. Справочник работ скопируется из текущего проекта. Текущий проект не изменится.', 'Создать', () => {
      A.openProject(p);
      item.projectCreated = true;
      item.proposals.forEach(x => { if (!x.done && (x.kind === 'Объект и договор' || x.kind === 'Организации' || x.kind === 'Смета')) x.done = true; });
      location.hash = '#/import';
      UI.toast('Создан и открыт проект «' + A.projTitle(A.project) + '»');
      setTimeout(draw, 50);
    });
  }

  // ================= разметка: распознанный текст → поля предложений =================
  function openMapper(item) {
    const { esc } = UI;
    // строки текста без повторяющихся пустых
    const lines = item.rawText.split('\n').map(s => s.replace(/\s+$/, '')).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
    const body = document.createElement('div'); body.className = 'mapper';
    body.innerHTML =
      '<div class="map-col map-left"><div class="map-hint small muted">Выделите мышью часть текста или нажмите на строки (можно несколько), затем нажмите <b>⇐</b> у нужного поля — значение заменится, <b>+</b> — допишется. Строку можно перетащить прямо в поле. Жёлтым подсвечено то, что уже стоит в полях.</div><div class="map-text"></div></div>' +
      '<div class="map-col map-right"><div class="map-sel"><span class="small muted">Выбрано:</span> <span class="map-sel-text muted">ничего</span> <button type="button" class="btn btn-sm" data-clear>Сбросить</button></div>' +
      '<div class="map-props"></div><div class="toolbar map-add"><span class="small muted">Добавить:</span></div></div>';
    const textEl = $('.map-text', body), selEl = $('.map-sel-text', body), propsEl = $('.map-props', body);
    const picked = new Set();
    // последнее выделение мышью в тексте: щелчок по кнопке или полю может снять выделение раньше, чем мы его прочитаем
    let lastSel = '';
    const liveSel = () => {
      const s = window.getSelection();
      if (!s || !s.rangeCount || s.isCollapsed || !textEl.contains(s.anchorNode)) return '';
      // текст берём из диапазона: Selection.toString() в неактивном окне бывает пустым
      return (s.toString() || s.getRangeAt(0).toString()).replace(/⠿/g, '').replace(/\s+/g, ' ').trim();
    };
    const getSel = () => {
      const t = liveSel() || lastSel;
      if (t) return t;
      return [...picked].sort((a, b) => a - b).map(i => lines[i].trim()).join(' ').replace(/\s+/g, ' ').trim();
    };
    const showSel = () => { const t = getSel(); selEl.textContent = t ? '«' + (t.length > 120 ? t.slice(0, 120) + '…' : t) + '»' : 'ничего'; selEl.classList.toggle('muted', !t); };
    const onSelChange = () => { const t = liveSel(); if (t) { lastSel = t; picked.clear(); textEl.querySelectorAll('.map-line.sel').forEach(l => l.classList.remove('sel')); } showSel(); };
    document.addEventListener('selectionchange', onSelChange);

    // подсветка значений, уже стоящих в полях
    const marks = () => {
      const vals = [];
      item.proposals.forEach(p => {
        if (p.done) return;
        p.fields.forEach(f => {
          const v = str(p.data[f.k]);
          if (!v || f.t === 'matTarget' || f.t === 'check' || f.t === 'orgRole') return;
          if (f.t === 'date') { const d = C.fmtDate(v); if (d) vals.push({ v: d, l: f.l }); return; }
          if (v.length >= 3) vals.push({ v, l: f.l });
        });
      });
      return vals.sort((a, b) => b.v.length - a.v.length);
    };
    const renderText = () => {
      const vals = marks();
      textEl.innerHTML = lines.map((line, i) => {
        // интервалы совпадений (без учёта регистра), длинные значения — в приоритете
        const low = line.toLowerCase(), hits = [];
        vals.forEach(m => {
          const q = m.v.toLowerCase(); let from = 0, k;
          while (q && (k = low.indexOf(q, from)) >= 0) { if (!hits.some(h => k < h.e && k + q.length > h.s)) hits.push({ s: k, e: k + q.length, l: m.l }); from = k + q.length; }
        });
        hits.sort((a, b) => a.s - b.s);
        let html = '', pos = 0;
        hits.forEach(h => { html += esc(line.slice(pos, h.s)) + '<mark title="' + esc(h.l) + '">' + esc(line.slice(h.s, h.e)) + '</mark>'; pos = h.e; });
        html += esc(line.slice(pos));
        // перетаскивание — за маркер ⠿: если сделать перетаскиваемой всю строку, браузер запрещает в ней выделение текста
        return '<div class="map-line' + (picked.has(i) ? ' sel' : '') + '" data-i="' + i + '"><span class="map-grip" draggable="true" title="Перетащить строку в поле">⠿</span>' + (html || '&nbsp;') + '</div>';
      }).join('');
    };
    textEl.addEventListener('click', e => {
      const ln = e.target.closest('.map-line'); if (!ln) return;
      const s = window.getSelection(); if (s && s.rangeCount && !s.isCollapsed) return; // идёт выделение мышью
      const i = +ln.dataset.i;
      lastSel = ''; // щелчок по строке — выбираем строки, а не прежний фрагмент
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      ln.classList.toggle('sel'); showSel();
    });
    textEl.addEventListener('dragstart', e => {
      const grip = e.target.closest && e.target.closest('.map-grip');
      if (!grip) return; // перетаскивание выделенного текста браузер делает сам
      const ln = grip.closest('.map-line');
      e.dataTransfer.setData('text/plain', stripLabel(lines[+ln.dataset.i]));
    });

    const put = (w, mode) => {
      const val = stripLabel(getSel());
      if (!val) { UI.toast('Сначала выделите текст или нажмите на строку слева'); return; }
      const input = w.querySelector('input, select, textarea');
      if (w.dataset.t === 'date') {
        const d = iso(val);
        if (!d) { UI.toast('В выделенном нет даты вида ДД.ММ.ГГГГ'); return; }
        input.value = d; input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (input.tagName === 'SELECT') {
        const lv = val.toLowerCase();
        const o = [...input.options].find(o => o.value && (o.text.toLowerCase().includes(lv) || lv.includes(o.text.toLowerCase())));
        if (!o) { UI.toast('Такого варианта в списке нет'); return; }
        input.value = o.value; input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (w.dataset.k === 'qty') {
        // «30 м3» → количество 30, единица м³ (если ещё не указана)
        const m = /(\d[\d\s]*(?:[.,]\d+)?)\s*([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z.²³/]*\d?)?/.exec(val);
        if (!m) { UI.toast('В выделенном нет числа'); return; }
        input.value = m[1].replace(/\s/g, '').replace(',', '.'); input.dispatchEvent(new Event('input', { bubbles: true }));
        const u = w.closest('.proposal').querySelector('.field[data-k="unit"] input');
        if (m[2] && u && !u.value) { u.value = normUnit(m[2]); u.dispatchEvent(new Event('input', { bubbles: true })); }
      } else {
        const v = w.dataset.k.endsWith('No') ? cleanDocNo(val) || val : val;
        input.value = mode === 'add' && input.value ? input.value + ' ' + v : v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      picked.clear(); lastSel = ''; const s = window.getSelection(); if (s) s.removeAllRanges();
      renderText(); showSel();
    };
    const renderProps = () => {
      propsEl.innerHTML = '';
      const live = item.proposals.filter(p => !p.done);
      if (!live.length) propsEl.innerHTML = '<div class="empty">Предложений нет. Добавьте материал, реквизиты договора или организацию кнопками ниже и заполните их из текста.</div>';
      live.forEach(p => {
        const el = proposalEl(p);
        el.querySelectorAll('.field[data-k]').forEach(w => {
          if (w.dataset.t === 'matTarget' || w.dataset.t === 'check') return;
          const acts = document.createElement('div'); acts.className = 'map-acts';
          acts.innerHTML = '<button type="button" class="btn btn-sm" title="Заменить выделенным">⇐</button>' + (w.dataset.t === 'text' || w.dataset.t === 'docType' ? '<button type="button" class="btn btn-sm" title="Дописать выделенное">+</button>' : '');
          const [b1, b2] = acts.querySelectorAll('button');
          // mousedown не отдаёт фокус кнопке — выделение в тексте остаётся на месте
          acts.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
          b1.addEventListener('click', e => { e.preventDefault(); put(w, 'set'); });
          if (b2) b2.addEventListener('click', e => { e.preventDefault(); put(w, 'add'); });
          w.appendChild(acts);
          // перетаскивание строки в поле даты (в текстовое поле браузер вставляет сам)
          if (w.dataset.t === 'date') {
            w.addEventListener('dragover', e => e.preventDefault());
            w.addEventListener('drop', e => { e.preventDefault(); const d = iso(e.dataTransfer.getData('text/plain')); if (d) { const inp = w.querySelector('input'); inp.value = d; inp.dispatchEvent(new Event('change', { bubbles: true })); renderText(); } else UI.toast('Это не дата'); });
          }
        });
        propsEl.appendChild(el);
      });
    };
    let t;
    propsEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderText, 300); });
    propsEl.addEventListener('change', () => { clearTimeout(t); t = setTimeout(renderText, 100); });
    $('[data-clear]', body).addEventListener('click', () => { picked.clear(); lastSel = ''; const s = window.getSelection(); if (s) s.removeAllRanges(); renderText(); showSel(); });
    const add = $('.map-add', body);
    [['material', '+ Материал'], ['contract', '+ Реквизиты договора'], ['org', '+ Организация']].forEach(([k, l]) => {
      add.appendChild(UI.btn(l, () => { item.proposals.push(blankProposal(k, item.name)); renderProps(); propsEl.lastElementChild && propsEl.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 'btn-sm'));
    });
    renderText(); renderProps();
    const dlg = document.getElementById('dlg');
    dlg.classList.add('dlg-wide');
    UI.openDialog('Разметка: ' + item.name, body, ['spacer', { label: 'Готово', cls: 'btn-primary', onClick: UI.closeDialog }], () => {
      dlg.classList.remove('dlg-wide');
      document.removeEventListener('selectionchange', onSelChange);
      draw();
    });
  }

  function applyChecked() {
    let n = 0; const errs = [];
    // снимок до изменений — можно откатить в «Проекты и файлы → История версий»
    if (window.IDBackup && queue.some(q => q.proposals.some(p => !p.done && p.checked))) IDBackup.snapshot('перед применением загруженных документов');
    queue.forEach(q => q.proposals.forEach(p => {
      if (p.done || !p.checked) return;
      const msg = p.valid && p.valid(p.data);
      if (msg) { errs.push(p.title + ': ' + msg); return; }
      learnFrom(p);
      p.apply(p.data); p.done = true; n++;
    }));
    if (n) A.touch();
    UI.toast(n ? 'Применено: ' + n + (errs.length ? '. Не применено: ' + errs.length : '') : (errs[0] || 'Ничего не отмечено'));
    if (errs.length) UI.toast(errs.join('; ').slice(0, 300));
    draw();
  }

  // ================= вставка из буфера обмена =================
  const stamp = () => { const d = new Date(), p = n => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()); };
  let pasteSeq = 0;
  const extOf = type => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' })[type] || 'png';
  function blobToFile(blob, kind) {
    const n = ++pasteSeq;
    if (kind === 'text') return new File([blob], 'Вставленный текст ' + stamp() + (n > 1 ? ' (' + n + ')' : '') + '.txt', { type: 'text/plain' });
    return new File([blob], 'Скриншот ' + stamp() + (n > 1 ? ' (' + n + ')' : '') + '.' + extOf(blob.type), { type: blob.type || 'image/png' });
  }
  // Ctrl+V на странице загрузки: картинки и файлы из буфера; текст — если он не вставляется в поле ввода
  document.addEventListener('paste', e => {
    if (!location.hash.startsWith('#/import')) return;
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []);
    if (!files.length) Array.from(cd.items || []).forEach(it => { if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); } });
    if (files.length) {
      e.preventDefault();
      // скриншот приходит как «image.png» без смысла в имени — даём понятное имя с датой
      files.forEach(f => processFile(/^image\.\w+$/i.test(f.name) || !f.name ? blobToFile(f, 'image') : f));
      UI.toast('Вставлено из буфера: ' + files.length);
      return;
    }
    if (inField) return;
    const text = cd.getData('text/plain');
    if (text && text.trim().length > 20) {
      e.preventDefault();
      processFile(blobToFile(new Blob([text], { type: 'text/plain' }), 'text'));
      UI.toast('Вставлен текст из буфера');
    }
  });
  // кнопка — для телефона и тех, кто не пользуется Ctrl+V; браузер может спросить разрешение
  async function pasteFromButton() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      UI.toast('Браузер не даёт читать буфер по кнопке — нажмите Ctrl+V на этой странице');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      let n = 0;
      for (const it of items) {
        const img = it.types.find(t => t.startsWith('image/'));
        if (img) { processFile(blobToFile(await it.getType(img), 'image')); n++; continue; }
        if (it.types.includes('text/plain')) {
          const text = await (await it.getType('text/plain')).text();
          if (text.trim().length > 20) { processFile(blobToFile(new Blob([text], { type: 'text/plain' }), 'text')); n++; }
        }
      }
      UI.toast(n ? 'Вставлено из буфера: ' + n : 'В буфере нет картинки или текста');
    } catch (err) {
      UI.toast(err && err.name === 'NotAllowedError' ? 'Нет разрешения на чтение буфера — нажмите Ctrl+V на этой странице' : 'Не удалось прочитать буфер: ' + (err.message || err));
    }
  }

  document.addEventListener('idapp-ready', () => {
    A = window.IDApp; UI = A.ui;
    A.registerView('import', view);
  });

  // для проверки
  window.IDImport = { offlineParse, pdfText: b => pdfText(b), invoiceTable, ocrTable,mergeNumbers, pdfImages, ocrImages, cleanDocNo, findDocNumbers, fromFileName, guessMapping, excelToResult, buildProposals: (r, s) => buildProposals(r, s), iso, SCHEMA, generatorToProject: wb => generatorToProject(wb) };
})();
