/* Генератор ИД — синхронизация проектов между ПК и телефоном через Google Диск
   (Apps Script из папки google-sync, ставится на ваш Google-аккаунт один раз).

   Как решается, что делать с проектом:
   - изменён только здесь — отправляем на сервер;
   - изменён только на другом устройстве — забираем;
   - изменён и здесь, и там — остаётся более свежая версия, другая кладётся в «Историю версий» (ничего не теряется);
   - удалён на одном устройстве — удаляется и на других (если там его с тех пор не меняли; копия — в истории). */
(function () {
  'use strict';
  const CFG = 'idgen.sync', STATE = 'idgen.syncState';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const cfg = () => load(CFG, { url: '', key: '', auto: true });
  let status = { at: '', text: '', err: false }, running = null, again = false;

  // ---------- вызов API (как в «Отчётах»: text/plain без CORS-preflight) ----------
  async function call(action, params, c) {
    c = c || cfg();
    if (!c.url || !c.key) throw Object.assign(new Error('Синхронизация не настроена'), { code: 'NO_CONFIG' });
    const once = async () => {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
      let res;
      try { res = await fetch(c.url, { method: 'POST', body: JSON.stringify(Object.assign({}, params, { action, key: c.key })), redirect: 'follow', signal: ctrl.signal }); }
      catch (e) { throw Object.assign(new Error(e.name === 'AbortError' ? 'Google долго не отвечает' : 'Нет связи с Google'), { code: 'OFFLINE' }); }
      finally { clearTimeout(t); }
      let j;
      try { j = await res.json(); } catch (e) { throw Object.assign(new Error('Ответ не похож на API синхронизации. Проверьте адрес (/exec) и доступ «Все» при развертывании'), { code: 'BAD_RESPONSE' }); }
      if (!j.ok) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.data;
    };
    try { return await once(); }
    catch (e) { if (e.code !== 'BAD_RESPONSE' && e.code !== 'NO_ACTION' && e.code !== 'BUSY') throw e; await new Promise(r => setTimeout(r, 1000)); return once(); }
  }

  // ---------- синхронизация ----------
  async function syncNow(manual) {
    if (running) { again = true; return running; }
    running = (async () => {
      const c = cfg();
      if (!c.url || !c.key) return;
      const st = load(STATE, {});
      const store = IDApp.store();
      const log = { up: 0, down: 0, conflicts: [], removed: 0 };
      try {
        setStatus('Синхронизация…');
        const list = await call('list');
        const srv = {}; list.forEach(x => { srv[x.id] = x; });
        const put = async (p, base, force) => {
          const r = await call('put', { project: p, base, force: !!force });
          st[p.id] = { server: r.updatedAt, local: p.updatedAt || '' }; log.up++;
        };
        const get = async id => {
          const r = await call('get', { id });
          IDApp.putProject(r.project);
          st[id] = { server: r.updatedAt, local: r.project.updatedAt || '' }; log.down++;
          return r.project;
        };
        const keepCopy = (p, why) => window.IDBackup && IDBackup.snapshotOf(JSON.parse(JSON.stringify(p)), why);
        // проекты этого устройства
        for (const p of Object.values(store.projects)) {
          const s = srv[p.id], my = st[p.id];
          const localChanged = !my || (p.updatedAt || '') !== my.local;
          const empty = !p.settings.objectName && !p.settings.shortName && !p.acts.length && !p.orgs.length && !p.materials.length && !p.smeta.length;
          if (!s) { if (!empty || my) await put(p); continue; }                 // нового на сервере ещё нет (пустой стартовый — не шлём)
          if (s.deleted) {                                                      // удалён на другом устройстве
            if (my && !localChanged) { keepCopy(p, 'удалён на другом устройстве'); IDApp.removeProject(p.id); delete st[p.id]; log.removed++; }
            else await put(p, undefined, true);                                // здесь его меняли — возвращаем на сервер
            continue;
          }
          const serverChanged = !my || s.updatedAt !== my.server;
          if (!my) {                                                            // первая встреча (например, перенесли файлом)
            if ((p.updatedAt || '') === (s.projectUpdatedAt || '')) st[p.id] = { server: s.updatedAt, local: p.updatedAt || '' };
            else if ((p.updatedAt || '') > (s.projectUpdatedAt || '')) await put(p, s.updatedAt);
            else { keepCopy(p, 'версия с этого устройства до синхронизации'); await get(p.id); }
            continue;
          }
          if (localChanged && !serverChanged) await put(p, my.server);
          else if (!localChanged && serverChanged) await get(p.id);
          else if (localChanged && serverChanged) {
            // правили и здесь, и на другом устройстве: побеждает более свежая правка, другая — в истории версий
            const t = IDApp.projTitle(p);
            if ((p.updatedAt || '') >= (s.projectUpdatedAt || '')) {
              try { const r = await call('get', { id: p.id }); keepCopy(r.project, 'версия с другого устройства (конфликт)'); } catch (e) { }
              await put(p, undefined, true);
              log.conflicts.push(t + ' — оставлена версия с этого устройства');
            } else {
              keepCopy(p, 'версия с этого устройства (конфликт)');
              await get(p.id);
              log.conflicts.push(t + ' — оставлена более свежая версия с другого устройства');
            }
          }
        }
        // проекты, которых здесь нет
        for (const s of list) {
          if (s.deleted || store.projects[s.id]) continue;
          if (st[s.id]) { await call('delete', { id: s.id }); delete st[s.id]; log.removed++; }  // удалили здесь
          else await get(s.id);                                                                 // новый с другого устройства
        }
        save(STATE, st);
        const parts = [];
        if (log.up) parts.push('отправлено ' + log.up);
        if (log.down) parts.push('получено ' + log.down);
        if (log.removed) parts.push('удалено ' + log.removed);
        setStatus('Синхронизировано' + (parts.length ? ': ' + parts.join(', ') : ', изменений нет'));
        if (log.conflicts.length) IDApp.ui.toast('Проект правили на двух устройствах: ' + log.conflicts.join('; ') + '. Другая версия — в «Истории версий».');
        else if (manual || log.down || log.removed) IDApp.ui.toast(status.text);
      } catch (e) {
        save(STATE, st);
        setStatus(e.message, true);
        if (manual) IDApp.ui.toast('Синхронизация: ' + e.message);
      }
    })();
    try { await running; } finally {
      running = null;
      if (again) { again = false; setTimeout(() => syncNow(), 1000); }
    }
  }
  function setStatus(text, err) {
    status = { at: new Date().toISOString(), text, err: !!err };
    save('idgen.syncStatus', status);
    const el = document.getElementById('syncState');
    if (el) { el.textContent = err ? '⚠ нет синхронизации' : text === 'Синхронизация…' ? '⟳ синхр.' : '✓ синхр.'; el.title = text + ' — ' + new Date().toLocaleTimeString('ru-RU'); el.hidden = false; }
  }

  // ---------- автоматически ----------
  let timer = null, lastRun = 0;
  const autoOn = () => { const c = cfg(); return c.url && c.key && c.auto !== false; };
  function schedule(ms) { if (!autoOn()) return; clearTimeout(timer); timer = setTimeout(() => { lastRun = Date.now(); syncNow(); }, ms); }
  document.addEventListener('idgen-saved', () => schedule(15000));          // после правок — через 15 с тишины
  window.addEventListener('online', () => schedule(1000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastRun > 60000) schedule(500); });
  setTimeout(() => schedule(0), 2500);                                       // при запуске

  // ---------- карточка на странице «Проекты и файлы» ----------
  function renderCard(main) {
    const { card, btn, para, esc, toast } = IDApp.ui;
    const c = cfg(); const s = load('idgen.syncStatus', status);
    const box = card('Синхронизация ПК ↔ телефон (Google Диск)', []);
    main.appendChild(box);
    box.appendChild(para(c.url && c.key
      ? 'Подключено. Проекты сами синхронизируются при запуске, через 15 секунд после правок и при появлении интернета.' + (s.text ? ' Последнее: <b>' + esc(s.text) + '</b>' + (s.at ? ' (' + new Date(s.at).toLocaleString('ru-RU') + ')' : '') + '.' : '')
      : 'Один раз установите скрипт синхронизации на свой Google-аккаунт (инструкция — файл <b>google-sync/УСТАНОВКА.md</b> в папке приложения), затем вставьте сюда адрес веб-приложения и ключ — на ПК и на телефоне.'));
    const g = document.createElement('div'); g.className = 'grid';
    g.innerHTML = '<label class="field wide"><span>Адрес веб-приложения (…/exec)</span><input type="text" data-k="url" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label class="field"><span>Ключ доступа</span><input type="password" data-k="key" autocomplete="off"></label>' +
      '<label class="check"><input type="checkbox" data-k="auto"> Синхронизировать автоматически</label>';
    g.querySelector('[data-k=url]').value = c.url || ''; g.querySelector('[data-k=key]').value = c.key || ''; g.querySelector('[data-k=auto]').checked = c.auto !== false;
    box.appendChild(g);
    const read = () => ({ url: g.querySelector('[data-k=url]').value.trim(), key: g.querySelector('[data-k=key]').value.trim(), auto: g.querySelector('[data-k=auto]').checked });
    const tb = document.createElement('div'); tb.className = 'toolbar'; tb.style.marginTop = '8px';
    tb.appendChild(btn('Проверить и сохранить', async () => {
      const n = read();
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(n.url)) { toast('Адрес должен начинаться с https://script.google.com/ и заканчиваться на /exec'); return; }
      try {
        const r = await call('ping', {}, n);
        save(CFG, n);
        toast('Подключено: папка «' + r.folder + '», проектов на сервере: ' + r.count);
        await syncNow(true); IDApp.render();
      } catch (e) { toast('Не подключилось: ' + e.message); }
    }, 'btn-primary'));
    if (c.url && c.key) {
      tb.appendChild(btn('Синхронизировать сейчас', async () => { await syncNow(true); IDApp.render(); }));
      tb.appendChild(btn('Отключить на этом устройстве', () => { save(CFG, { url: '', key: '', auto: true }); localStorage.removeItem(STATE); toast('Синхронизация отключена. Проекты на устройстве и на сервере остались.'); IDApp.render(); }));
    }
    box.appendChild(tb);
  }

  window.IDSync = { syncNow, renderCard, call };
})();
