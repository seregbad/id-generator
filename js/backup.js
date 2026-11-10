/* Генератор ИД — сохранность данных:
   1) история версий: снимки проектов в IndexedDB браузера (автоматически не чаще раза в 30 минут
      и перед массовыми изменениями), восстановление любой версии;
   2) автосохранение файлов проектов (.idproj.json) в выбранную папку на диске (Edge / Chrome на ПК),
      например в папку OneDrive — так копия есть и вне браузера. */
(function () {
  'use strict';
  const C = window.IDCore;
  const DB = 'idgen-backup', SNAP = 'snapshots', KV = 'kv';
  const KEEP = 40;                 // снимков на проект
  const AUTO_EVERY = 30 * 60e3;    // автоснимок не чаще
  const FILE_EVERY = 2 * 60e3;     // запись в папку не чаще

  // ---------- IndexedDB ----------
  let dbP = null;
  function db() {
    if (!dbP) dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        const s = d.createObjectStore(SNAP, { keyPath: 'id', autoIncrement: true });
        s.createIndex('project', 'projectId');
        d.createObjectStore(KV);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  };
  const kvGet = k => tx(KV, 'readonly', s => s.get(k));
  const kvSet = (k, v) => tx(KV, 'readwrite', s => s.put(v, k));

  async function listSnaps(projectId) {
    const all = await tx(SNAP, 'readonly', s => s.index('project').getAll(projectId));
    return (all || []).sort((a, b) => b.ts.localeCompare(a.ts));
  }
  // снимок проекта; reason — подпись в истории
  async function snapshot(p, reason) {
    if (!p) return;
    try {
      const data = JSON.stringify(p);
      const prev = (await listSnaps(p.id))[0];
      if (prev && prev.data === data) return; // ничего не изменилось
      await tx(SNAP, 'readwrite', s => s.add({ projectId: p.id, ts: new Date().toISOString(), reason: reason || 'автоматически', title: IDApp.projTitle(p), data }));
      const list = await listSnaps(p.id);
      if (list.length > KEEP) await tx(SNAP, 'readwrite', s => list.slice(KEEP).forEach(x => s.delete(x.id)));
    } catch (e) { console.warn('снимок не сохранён', e); }
  }
  let lastAuto = {};
  function autoSnapshot() {
    const p = IDApp.project;
    if (!p || Date.now() - (lastAuto[p.id] || 0) < AUTO_EVERY) return;
    lastAuto[p.id] = Date.now();
    snapshot(p, 'автоматически');
  }

  // ---------- папка на диске ----------
  const fsOk = 'showDirectoryPicker' in window;
  let dir = null, dirState = 'none'; // none | ok | need-permission
  const safe = t => String(t || 'Проект ИД').replace(/[\\/:*?"<>|\n\r]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  const fileName = p => safe([p.settings.shortName, p.settings.objectName].filter(Boolean).join(' — ') || 'Проект ' + p.id) + '.idproj.json';
  async function initDir() {
    if (!fsOk) return;
    try {
      dir = await kvGet('dir');
      if (!dir) { dirState = 'none'; return; }
      dirState = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'need-permission';
    } catch (e) { dir = null; dirState = 'none'; }
  }
  async function pickDir() {
    try {
      const h = await window.showDirectoryPicker({ id: 'idgen-backup', mode: 'readwrite' });
      dir = h; await kvSet('dir', h); dirState = 'ok';
      await writeAll(true);
      IDApp.ui.toast('Проекты будут сохраняться в папку «' + h.name + '»');
    } catch (e) { if (e.name !== 'AbortError') IDApp.ui.toast('Не удалось выбрать папку: ' + e.message); }
  }
  async function askPermission() {
    if (!dir) return;
    try { dirState = (await dir.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'need-permission'; } catch (e) { dirState = 'need-permission'; }
    if (dirState === 'ok') await writeAll(true);
  }
  let lastWrite = {}, pending = null;
  async function writeProject(p) {
    const h = await dir.getFileHandle(fileName(p), { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(p, null, 1));
    await w.close();
    lastWrite[p.id] = Date.now();
    await kvSet('lastWrite', new Date().toISOString());
  }
  async function writeAll(force) {
    if (dirState !== 'ok') return;
    const store = IDApp.store();
    for (const p of Object.values(store.projects)) {
      if (!force && lastWrite[p.id] && Date.now() - lastWrite[p.id] < FILE_EVERY) continue;
      try { await writeProject(p); } catch (e) { console.warn('запись в папку', e); dirState = 'need-permission'; break; }
    }
  }
  function onSaved() {
    autoSnapshot();
    if (dirState !== 'ok') return;
    const p = IDApp.project;
    clearTimeout(pending);
    const wait = Math.max(3000, FILE_EVERY - (Date.now() - (lastWrite[p.id] || 0)));
    pending = setTimeout(() => writeProject(p).catch(() => { dirState = 'need-permission'; }), wait);
  }

  // ---------- карточка на странице «Проекты и файлы» ----------
  async function renderCard(main) {
    const { card, btn, para, esc, confirmBox, toast } = IDApp.ui;
    const P = IDApp.project;
    // автосохранение в папку
    const fsCard = card('Автосохранение в папку на диске', []);
    main.appendChild(fsCard);
    if (!fsOk) fsCard.appendChild(para('Этот браузер не умеет сохранять в папку (так на телефонах). Сохраняйте файл проекта вручную — кнопкой выше.'));
    else {
      const last = await kvGet('lastWrite').catch(() => null);
      fsCard.appendChild(para(dirState === 'ok' ? 'Все проекты сохраняются в папку <b>«' + esc(dir.name) + '»</b> — через пару минут после изменений.' + (last ? ' Последняя запись: ' + new Date(last).toLocaleString('ru-RU') + '.' : '')
        : dirState === 'need-permission' ? 'Папка <b>«' + esc(dir.name) + '»</b> выбрана, но браузер просит заново разрешить запись (так бывает после перезапуска).'
          : 'Выберите папку — например, в OneDrive или на флешке. Приложение будет само сохранять туда все проекты файлами .idproj.json. Если браузер очистит данные, проекты можно будет открыть из этой папки.'));
      const tb = document.createElement('div'); tb.className = 'toolbar';
      if (dirState === 'need-permission') tb.appendChild(btn('Разрешить запись', async () => { await askPermission(); IDApp.render(); }, 'btn-primary'));
      tb.appendChild(btn(dir ? 'Выбрать другую папку' : 'Выбрать папку', async () => { await pickDir(); IDApp.render(); }, dir ? '' : 'btn-primary'));
      if (dirState === 'ok') tb.appendChild(btn('Сохранить сейчас', async () => { await writeAll(true); toast('Сохранено в «' + dir.name + '»'); IDApp.render(); }));
      fsCard.appendChild(tb);
    }
    // история версий
    const hc = card('История версий проекта', [para('Снимки текущего проекта: автоматически не чаще раза в 30 минут и перед массовыми изменениями (применение загруженных документов, закрытие КС, восстановление). Хранятся в этом браузере, по ' + KEEP + ' последних.')]);
    main.appendChild(hc);
    const tb2 = document.createElement('div'); tb2.className = 'toolbar';
    tb2.appendChild(btn('Сделать снимок сейчас', async () => { await snapshot(P, 'вручную'); toast('Снимок сохранён'); IDApp.render(); }));
    hc.appendChild(tb2);
    const list = await listSnaps(P.id).catch(() => []);
    if (!list.length) { hc.appendChild(para('Снимков пока нет.')); return; }
    const box = document.createElement('div'); box.className = 'list';
    list.forEach(sn => {
      let info = '';
      try { const d = JSON.parse(sn.data); info = 'актов ' + d.acts.length + ', материалов ' + d.materials.length + ', позиций сметы ' + d.smeta.length; } catch (e) { }
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<div class="row-main"><div class="row-title">' + esc(new Date(sn.ts).toLocaleString('ru-RU')) + ' — ' + esc(sn.reason) + '</div><div class="row-sub">' + esc(info) + '</div></div><div class="row-actions"></div>';
      row.querySelector('.row-actions').appendChild(btn('Восстановить', () => confirmBox('Вернуть проект к версии от ' + new Date(sn.ts).toLocaleString('ru-RU') + '? Текущее состояние тоже сохранится в истории — его можно будет вернуть.', 'Восстановить', async () => {
        await snapshot(IDApp.project, 'перед восстановлением');
        const d = C.normalize(JSON.parse(sn.data));
        IDApp.openProject(d, P.id);
        toast('Версия восстановлена');
      }), 'btn-sm'));
      box.appendChild(row);
    });
    hc.appendChild(box);
  }

  document.addEventListener('idgen-saved', onSaved);
  // открыли приложение — сразу снимок текущего состояния (раз в 30 минут)
  initDir().then(() => { autoSnapshot(); if (dirState === 'ok') writeAll(false); });
  window.IDBackup = { snapshot: (reason) => snapshot(IDApp.project, reason), snapshotOf: snapshot, renderCard, writeAll };
})();
