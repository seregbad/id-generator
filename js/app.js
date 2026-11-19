/* Генератор ИД — интерфейс */
(function () {
  'use strict';
  const C = window.IDCore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = t => String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE_KEY = 'idgen.v1';
  // версия приложения — видна внизу меню; меняется вместе с VERSION в sw.js
  const APP_VERSION = '65 (19.11.2026)';

  // ================= хранилище =================
  let store = { projects: {}, current: null };
  let P = null;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) store = JSON.parse(raw) || store;
    } catch (e) { /* хранилище недоступно — работаем в памяти */ }
    if (!store.projects) store.projects = {};
    Object.keys(store.projects).forEach(id => { store.projects[id] = C.normalize(store.projects[id]); });
    if (!store.current || !store.projects[store.current]) {
      const ids = Object.keys(store.projects);
      if (ids.length) store.current = ids[0];
      else { const p = C.emptyProject(); store.projects[p.id] = p; store.current = p.id; }
    }
    P = store.projects[store.current];
  }
  let saveTimer = null;
  function touch() {
    P.updatedAt = new Date().toISOString();
    setSaveState('…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
        setSaveState('Сохранено');
        document.dispatchEvent(new Event('idgen-saved')); // история версий и автосохранение в папку (backup.js)
      } catch (e) {
        setSaveState('Не сохранено!');
        toast('Не удалось сохранить в браузере. Сохраните проект в файл.');
      }
    }, 300);
    updateHeader();
  }
  function setSaveState(t) { $('#saveState').textContent = t; }
  // закрывают окно сразу после правки — дописать несохранённое немедленно (обычно запись идёт через 0,3 с)
  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); setSaveState('Сохранено'); document.dispatchEvent(new Event('idgen-saved')); } catch (e) { setSaveState('Не сохранено!'); }
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  // открытая карточка с несохранёнными правками — переспросить при закрытии окна
  let editorDirty = false;
  window.addEventListener('beforeunload', e => {
    flushSave();
    if (editorDirty && $('#dlg').open) { e.preventDefault(); e.returnValue = ''; }
  });
  // приложение открыто в двух окнах / вкладках: другое окно сохранило данные — берём их,
  // иначе это окно при следующем сохранении затрёт их своей старой копией
  window.addEventListener('storage', e => {
    if (e.key !== STORE_KEY || !e.newValue || saveTimer) return; // здесь есть свои несохранённые правки — они запишутся и уйдут в то окно
    try {
      const ns = JSON.parse(e.newValue);
      if (!ns || !ns.projects) return;
      Object.keys(ns.projects).forEach(id => { ns.projects[id] = C.normalize(ns.projects[id]); });
      const cur = P && P.id;
      store = ns;
      if (cur && store.projects[cur]) store.current = cur;
      else if (!store.projects[store.current]) store.current = Object.keys(store.projects)[0];
      if (!store.current) return;
      P = store.projects[store.current];
      if ($('#dlg').open) { closeDialog(); toast('Данные изменили в другом окне приложения — карточка закрыта, откройте её заново'); }
      render(); updateHeader();
    } catch (err) { /* не JSON — пропускаем */ }
  });
  function projTitle(p) {
    const s = p.settings;
    return (s.shortName ? s.shortName + ' — ' : '') + (s.objectName || 'Без названия') + (s.contractNo ? ' · дог. ' + s.contractNo : '');
  }
  // короткое имя проекта: задаётся прямо из списка проектов
  function editShortName(p, after) {
    const d = document.createElement('div');
    d.innerHTML = '<label class="field"><span>Короткое имя проекта</span><input type="text" maxlength="60" placeholder="Например: ВИТ, ТурбоТехМаш, Рога и копыта"><small>Только для списка проектов и шапки приложения, в документы не попадает. Объект: ' + esc(p.settings.objectName || 'не указан') + '</small></label>';
    const inp = $('input', d); inp.value = p.settings.shortName || '';
    const save = () => { p.settings.shortName = inp.value.trim(); touch(); closeDialog(); after && after(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    openDialog('Имя проекта', d, ['spacer', { label: 'Отмена', onClick: closeDialog }, { label: 'Сохранить', cls: 'btn-primary', onClick: save }]);
    setTimeout(() => inp.focus(), 50);
  }
  function updateHeader() { $('#projName').textContent = projTitle(P); }

  // ================= уведомления =================
  let toastTimer;
  // undo — функция: в уведомлении появится кнопка «Отменить» (уведомление висит дольше)
  function toast(t, undo) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.toggle('has-undo', !!undo);
    if (undo) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-undo'; b.textContent = 'Отменить';
      b.addEventListener('click', () => { el.classList.remove('show'); undo(); });
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 8000 : 3200);
  }
  // действие с возможностью отмены: снимок проекта до него, «Отменить» в уведомлении вернёт как было
  // msg — строка или функция (текст по итогам действия); onUndo — что ещё вернуть кроме проекта
  function undoable(msg, fn, onUndo) {
    const snap = JSON.stringify(P), id = P.id;
    fn();
    toast(typeof msg === 'function' ? msg() : msg, () => {
      store.projects[id] = C.normalize(JSON.parse(snap));
      if (P.id === id) P = store.projects[id];
      onUndo && onUndo();
      closeDialog(); touch(); render(); toast('Отменено');
    });
  }

  // ================= диалог =================
  const dlg = $('#dlg');
  let dlgOnClose = null;
  // o: { page: true } — большая карточка почти на весь экран (карточка акта)
  function openDialog(title, bodyEl, buttons, onClose, o) {
    dlg.classList.toggle('dlg-page', !!(o && o.page));
    $('#dlgTitle').textContent = title;
    const body = $('#dlgBody'); body.innerHTML = ''; body.appendChild(bodyEl);
    const foot = $('#dlgFoot'); foot.innerHTML = '';
    (buttons || []).forEach(b => {
      if (b === 'spacer') { const sp = document.createElement('span'); sp.className = 'spacer'; foot.appendChild(sp); return; }
      const el = document.createElement(b.href ? 'a' : 'button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      if (b.href) { el.href = b.href; if (b.download) el.download = b.download; if (b.target) el.target = b.target; el.rel = 'noopener'; }
      else el.type = 'button';
      el.addEventListener('click', ev => { if (b.onClick) b.onClick(ev); });
      foot.appendChild(el);
    });
    dlgOnClose = onClose || null;
    if (!dlg.open) dlg.showModal();
    body.scrollTop = 0;
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { editorDirty = false; const f = dlgOnClose; dlgOnClose = null; if (f) f(); });
  $('#dlgClose').addEventListener('click', closeDialog);
  $('#dlgForm').addEventListener('submit', e => e.preventDefault());

  function confirmBox(text, okLabel, onOk, danger) {
    const d = document.createElement('div'); d.innerHTML = '<p>' + esc(text) + '</p>';
    openDialog('Подтверждение', d, [
      'spacer',
      { label: 'Отмена', onClick: closeDialog },
      { label: okLabel || 'OK', cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { closeDialog(); onOk(); } }
    ]);
  }

  // ================= описание полей =================
  const F = (k, l, t, o) => Object.assign({ k, l, t: t || 'text' }, o || {});
  const orgKeys = () => P.orgs.filter(o => o.key).map(o => ({ v: o.key, l: o.key + ' — ' + (o.role ? o.role + ', ' : '') + (o.name || '') }));
  // непринятые изменения позиции из ДС (r.pendingDs): применить — как ручное изменение по ДС («было → стало» запоминается)
  let smetaRedraw = () => render();
  let smetaTab = 't1'; // открытая вкладка экрана сметы (сохраняется при перерисовке)
  let settingsTab = 't1'; // и экрана договора
  let ozhrTab = 't1';     // и общего журнала
  const pendingOf = r => (r.pendingDs || []).filter(x => C.dsById(P, x.dsId));
  // замечания по акту → раздел карточки, где это правится
  function actIssueSec(t) {
    if (/^не указан раздел/.test(t)) return 'main';
    if (/п\. 6/.test(t)) return 'texts';
    if (/представител|выполнил «/.test(t)) return 'reps';
    if (/истёк документ|материал|документ о качестве|п\. 4|схем/.test(t)) return 'mats';
    if (/лист|шифр|раздел/.test(t)) return 'proj';
    return 'main';
  }
  // все замечания по акту: проверка акта + (для чужой ИД) что привести к нашему формату
  function actIssues(a) {
    const list = C.actView(P, a).warnings.concat(a.imported && !a.importDone ? C.importIssues(P, a) : []);
    return [...new Set(list)].map(text => ({ text, sec: actIssueSec(text), lvl: /истёк|нет представителя|позже|раньше|не указаны даты|не указан тип/.test(text) ? 'r' : 'w' }));
  }
  // материал: поставлено, израсходовано по актам, остаток
  function matBal(m) {
    const uses = P.acts.filter(a => a.type && (a.materials || []).includes(m.id)).map(a => ({ a, qty: a.matQty && C.s(a.matQty[m.id]) !== '' ? C.num(a.matQty[m.id]) : null }));
    const used = Math.round(uses.reduce((x, u) => x + (u.qty || 0), 0) * 1000) / 1000, supplied = C.num(m.qty);
    return { supplied, used, uses, rest: C.s(m.qty) === '' ? null : Math.round((supplied - used) * 1000) / 1000 };
  }
  // документ истекает в ближайшие 30 дней
  const matSoon = m => { const u = C.matUntil(m); if (!u || C.matExpired(m)) return false; const d = C.parseDate(u); return !!d && (d - new Date()) / 864e5 < 30; };
  function matIssues(m, b) {
    const out = [];
    if (C.matExpired(m)) out.push({ lvl: b.rest === null || b.rest > 0 ? 'r' : 'w', text: 'Документ о качестве истёк ' + C.fmtDate(C.matUntil(m)) + (b.uses.length ? '; в актах: ' + b.uses.map(u => u.a.type + ' № ' + C.actNumber(P, u.a)).join(', ') : ''), fix: 'Обновить документ' });
    else if (matSoon(m)) out.push({ lvl: 'w', text: 'Документ истекает ' + C.fmtDate(C.matUntil(m)), fix: 'Открыть' });
    if (!C.matDocs(m)) out.push({ lvl: 'w', text: 'Нет документа о качестве', fix: 'Добавить' });
    if (m.vk === 'Не соответствует') out.push({ lvl: 'r', text: 'Входной контроль: не соответствует', fix: 'Открыть' });
    if (b.rest !== null && b.rest < 0) out.push({ lvl: 'r', text: 'По актам израсходовано больше, чем поставлено (' + C.qty(b.used) + ' из ' + C.qty(b.supplied) + ')', fix: 'Открыть' });
    return out;
  }
  // «следующая захватка / этап»: те же поля, даты — сразу после этого акта, такой же длительности
  function nextAct(a, redraw) {
    const iso = d => d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate());
    const s0 = C.parseDate(a.start), e0 = C.parseDate(a.end);
    const cp = JSON.parse(JSON.stringify(a));
    Object.assign(cp, { id: C.uid(), manualNo: '', print: '', printedNo: '', actDate: '', matQty: {}, sheetsCount: '', note: '' });
    if (e0) {
      const days = s0 ? Math.round((e0 - s0) / 864e5) : 0;
      const ns = new Date(e0); ns.setDate(ns.getDate() + 1);
      const ne = new Date(ns); ne.setDate(ne.getDate() + days);
      cp.start = iso(ns); cp.end = iso(ne);
    }
    P.acts.splice(P.acts.indexOf(a) + 1, 0, cp);
    touch(); redraw && redraw();
    openEditor('acts', P.acts, cp, false, redraw);
    toast('Создан следующий акт — проверьте оси, листы и материалы');
  }
  function pendingText(r, x) {
    const d = C.dsById(P, x.dsId), lbl = 'ДС № ' + (d.no || '—') + ': ';
    const was = C.smetaRow(r).total;
    if (x.act === 'ex') return lbl + 'исключить позицию' + (x.note ? ' (' + x.note + ')' : '') + ' — −' + C.money(was) + ' руб.';
    const now = C.smetaRow(x.to).total, parts = [];
    if (C.num(x.to.qty) !== C.num(r.qty)) parts.push('кол-во ' + C.qty(r.qty) + ' → ' + C.qty(x.to.qty) + ' ' + (r.unit || ''));
    const pu = C.num(r.priceWork) + C.num(r.priceMat), nu = C.num(x.to.priceWork) + C.num(x.to.priceMat);
    if (Math.abs(pu - nu) > 0.005) parts.push('цена ' + C.money(pu) + ' → ' + C.money(nu));
    return lbl + (parts.join('; ') || 'без изменений') + ' · сумма ' + C.money(was) + ' → ' + C.money(now) + ' (' + (now - was >= 0 ? '+' : '−') + C.money(Math.abs(now - was)) + ')';
  }
  function applyPending(r, x) {
    if (x.act === 'ex') r.excludedBy = x.dsId;
    else {
      (r.changes = r.changes || []).push({ dsId: x.dsId, from: { qty: r.qty, priceWork: r.priceWork, priceMat: r.priceMat }, to: Object.assign({}, x.to) });
      Object.assign(r, x.to);
    }
    dropPending(r, x);
  }
  function dropPending(r, x) { r.pendingDs = (r.pendingDs || []).filter(y => y !== x); if (!r.pendingDs.length) delete r.pendingDs; }
  const dsOpts = () => C.dsList(P).map(d => ({ v: d.id, l: 'ДС № ' + (d.no || '—') + (d.date ? ' от ' + C.fmtDate(d.date) : '') + (d.subject ? ' — ' + d.subject : '') }));
  const orgRoleOpts = () => C.ORG_ROLES.map(r => ({ v: r, l: r + (C.ROLE_HINT[r] ? ' — ' + C.ROLE_HINT[r] : '') }));
  const units = () => P.lists.units || C.DEFAULT_LISTS.units;
  const REP_HINT = [
    'представитель застройщика / технического заказчика по строительному контролю',
    'представитель генподрядчика / подрядчика (руководитель проекта, начальник участка, прораб)',
    'представитель генподрядчика / подрядчика по строительному контролю',
    'представитель проектировщика (авторский надзор)',
    'представитель субподрядчика, выполнившего работы'
  ];

  const SCHEMA = {
    orgs: {
      title: 'Организации', one: 'Организация',
      intro: 'Участники строительства и их роли на этом объекте. Застройщик (или технический заказчик), генподрядчик/подрядчик и проектировщик подставляются в шапки актов. Свою организацию заведите здесь же и выберите её роль: «Подрядчик», если договор напрямую с заказчиком; «Генподрядчик», если у вас есть субподрядчики; «Субподрядчик», если вы работаете у генподрядчика.',
      fields: () => [
        F('key', 'Ключ (краткое имя)', 'text', { req: 1, hint: 'Короткое имя для выбора в списках, например «АСА СПб». При переименовании ссылки в представителях и актах обновятся сами.' }),
        F('role', 'Роль на объекте', 'select', { req: 1, opts: orgRoleOpts, empty: '— выберите роль —' }),
        F('type', 'Тип лица', 'select', { opts: () => [{ v: 'ЮЛ', l: 'ЮЛ — юридическое лицо' }, { v: 'ИП', l: 'ИП — индивидуальный предприниматель' }, { v: 'ФЛ', l: 'ФЛ — физическое лицо' }], empty: 'ЮЛ (по умолчанию)' }),
        F('name', 'Полное наименование / ФИО', 'text', { req: 1, wide: 1 }),
        F('ogrn', 'ОГРН / ОГРНИП / паспорт (для ФЛ)'), F('inn', 'ИНН'),
        F('address', 'Адрес (юридический / места жительства)', 'textarea', { wide: 1 }),
        F('phone', 'Телефон, e-mail', 'text', { wide: 1 }), F('okpo', 'ОКПО'),
        F('sroName', 'СРО: наименование, рег. №', 'textarea', { wide: 1 }), F('sroOgrn', 'СРО: ОГРН'), F('sroInn', 'СРО: ИНН'),
        F('dirSign', 'Подпись руководителя (картинка) — для КС и сметы', 'image', { hint: 'Ставится у подписанта этой стороны в КС-2, КС-3 и смете' }),
        F('stamp', 'Печать (картинка)', 'image', { hint: 'Ставится у «М.П.» в КС-2, КС-3 и смете' })
      ],
      row: o => ({
        title: (o.key ? o.key + ' — ' : '') + (o.name || 'Без названия'), sub: C.orgLine(o),
        badges: [o.role ? { t: o.role, c: o.role === C.ROLE.other ? '' : 'ok' } : { t: 'роль не выбрана', c: 'warn' }, o.key && o.key === P.settings.ourOrg ? { t: 'наша организация' } : null],
        warn: !o.role
      }),
      search: o => [o.key, o.name, o.role, o.inn].join(' ')
    },
    people: {
      title: 'Представители', one: 'Представитель',
      intro: 'Если человек сменился — добавьте новую строку и проставьте даты «с/по». Старые акты сохранят прежнего представителя (выбор по дате акта).',
      fields: () => [
        F('role', 'Роль в актах', 'select', { req: 1, opts: () => C.REP_ROLES.map((r, i) => ({ v: r, l: r + ' — ' + REP_HINT[i] })) }),
        F('orgKey', 'Организация', 'select', { req: 1, opts: orgKeys, hint: 'Сначала заведите организацию в разделе «Организации»' }),
        F('fullName', 'ФИО полностью', 'text', { req: 1, wide: 1 }),
        F('position', 'Должность', 'text', { wide: 1 }),
        F('authDoc', 'Документ о полномочиях (приказ / доверенность №, дата)', 'text', { wide: 1 }),
        F('nrs', 'ID в НРС'),
        F('from', 'Действует с', 'date'), F('to', 'Действует по', 'date'),
        F('sign', 'Подпись (картинка)', 'image', { wide: 1, hint: 'Скан или фото подписи на белом листе. Вставляется в акты, если включено «Подписи и печати в PDF» на странице «Документы PDF»' })
      ],
      row: r => ({
        title: (r.fullName || 'Без ФИО') + (r.position ? ', ' + r.position.toLowerCase() : ''),
        sub: [r.role, r.orgKey, (r.from || r.to) ? ('с ' + (C.fmtDate(r.from) || '…') + ' по ' + (C.fmtDate(r.to) || '…')) : ''].filter(Boolean).join(' · '),
        badges: [r.to && r.to < C.todayISO() ? { t: 'полномочия истекли', c: 'warn' } : null]
      }),
      search: r => [r.fullName, r.position, r.role, r.orgKey].join(' ')
    },
    materials: {
      title: 'Материалы и документы о качестве', one: 'Материал',
      intro: 'Каждая партия с документами о качестве. Номер (001, 002…) — по порядку в списке. Просроченные документы подсвечиваются.',
      fields: () => [
        F('name', 'Наименование материала / изделия', 'text', { req: 1, wide: 1 }),
        F('mark', 'Марка, типоразмер'), F('gost', 'ГОСТ / ТУ'), F('maker', 'Производитель', 'text', { wide: 1 }),
        F('doc1Type', 'Документ 1: вид', 'combo', { opts: () => P.lists.docTypes }), F('doc1No', 'Документ 1: №'),
        F('doc1Date', 'Документ 1: дата', 'date'), F('doc1Until', 'Документ 1: действует до', 'date'),
        F('doc2Type', 'Документ 2: вид', 'combo', { opts: () => P.lists.docTypes }), F('doc2No', 'Документ 2: №'),
        F('doc2Date', 'Документ 2: дата', 'date'), F('doc2Until', 'Документ 2: действует до', 'date'),
        F('supplier', 'Поставщик'), F('delivery', 'УПД / ТН №'),
        F('deliveryDate', 'Дата поставки', 'date'), F('vk', 'Результат входного контроля', 'select', { opts: () => P.lists.vk, empty: 'Соответствует (по умолчанию)' }),
        F('qty', 'Количество', 'number'), F('unit', 'Ед. изм.', 'combo', { opts: units })
      ],
      // компактная строка: документ, поставлено, в актах, остаток, срок; замечания — по значку статуса
      row: m => {
        const b = matBal(m), u = m.unit ? ' ' + m.unit : '';
        return {
          no: String(C.matNo(P, m)), title: C.matName(m) || 'Без названия',
          cols: [['Документ о качестве', C.matDocs(m) || 'нет', C.matDocs(m) ? '' : 'w'],
            ['Поставлено', C.s(m.qty) === '' ? '—' : C.qty(b.supplied) + u, C.s(m.qty) === '' ? 'dim' : ''],
            ['В актах', b.uses.length ? (b.used ? C.qty(b.used) + u : 'в ' + b.uses.length + ' акт.') : '—', b.uses.length ? '' : 'dim'],
            ['Остаток', b.rest === null ? '—' : C.qty(b.rest) + u, b.rest !== null && b.rest < 0 ? 'r' : b.rest === null ? 'dim' : ''],
            ['Действует до', C.matUntil(m) ? C.fmtDate(C.matUntil(m)) : '—', C.matExpired(m) ? 'r' : matSoon(m) ? 'w' : C.matUntil(m) ? '' : 'dim']],
          colsCls: 'cols-mats',
          issues: matIssues(m, b)
        };
      },
      preview: m => C.matText(m),
      search: m => [m.name, m.mark, m.doc1No, m.doc2No, m.supplier].join(' ')
    },
    works: {
      title: 'Справочник работ', one: 'Вид работ',
      intro: 'Заготовки текстов для актов. Пустые поля акта берут текст отсюда. Нормативы сверьте со своим проектом и допишите пункты СП.',
      fields: () => [
        F('code', 'Код', 'text', { hint: 'Например ФП-01' }),
        F('actType', 'Тип акта', 'select', { opts: () => P.lists.actTypes }),
        F('section', 'Раздел', 'combo', { opts: () => P.lists.sections, hint: 'Шифр берётся по разделу из «Проектной и рабочей документации»' }),
        F('projCode', 'Особый шифр РД для этого вида работ', 'text', { hint: 'Только если отличается от шифра раздела (например, работы по другому комплекту)' }),
        F('name', 'Наименование работ / конструкций', 'textarea', { req: 1, wide: 1 }),
        F('norms', 'Работы выполнены в соответствии с (нормативы)', 'textarea', { wide: 1 }),
        F('next', 'Разрешается производство последующих работ', 'textarea', { wide: 1 }),
        F('docs', 'Исполнительная документация по умолчанию (п. 4 АОСР / п. 5а АООК)', 'textarea', { wide: 1 })
      ],
      row: w => {
        const rd = C.rdFor(P, null, w);
        return { title: C.workLabel(w) || 'Без названия', sub: w.norms, badges: [w.actType ? { t: w.actType } : null, w.section ? { t: w.section } : null, rd.code ? { t: 'шифр ' + rd.code, c: rd.source === 'объект' ? '' : 'ok' } : { t: 'шифр не задан', c: 'warn' }] };
      },
      search: w => [w.code, w.name, w.norms].join(' ')
    },
    acts: {
      title: 'Журнал актов', one: 'Акт',
      fields: (a) => {
        const w = P.works.find(x => x.id === a.workId);
        const isAOOK = a.type === 'АООК';
        return [
          F('type', 'Тип акта', 'select', { req: 1, opts: () => P.lists.actTypes, rerender: 1 }),
          F('section', 'Раздел', 'combo', { opts: () => P.lists.sections, rerender: 1, hint: 'Для нумерации: КЖ-01, КЖ-02…' }),
          F('workId', 'Вид работ (из справочника)', 'select', {
            wide: 1, rerender: 1, empty: '— не выбран (наименование вручную) —',
            opts: () => P.works.filter(x => !a.type || !x.actType || x.actType === a.type).map(x => ({ v: x.id, l: C.workLabel(x) })),
            labelOf: id => { const x = P.works.find(y => y.id === id); return x ? C.workLabel(x) + ' [' + (x.actType || '') + ']' : 'вид работ удалён из справочника'; },
            hint: a.type ? 'Показаны виды работ для типа «' + a.type + '»' : ''
          }),
          F('manualName', 'Наименование работ вручную', 'textarea', { wide: 1, ph: w ? w.name : '', hint: 'Пусто — из справочника' }),
          F('axes', 'Оси / участок / отметки', 'text', { wide: 1, hint: a.type === 'Разбивка осей' ? 'В акте разбивки: «произведена разбивка осей …»' : 'Добавляется к наименованию через пробел' }),
          F('manualNo', '№ вручную', 'text', { ph: C.actNumber(P, P.acts.find(x => x.id === a.id) || a) || 'авто', hint: 'Пусто — номер считается сам' }),
          F('executor', 'Исполнитель работ', 'select', {
            opts: orgKeys, empty: 'Генподрядчик / подрядчик' + (C.builderOrg(P) ? ': ' + C.builderOrg(P).key : ' (не заведён)'),
            hint: 'Выберите субподрядчика, если работы выполнил он: в акт попадут его реквизиты и представитель с ролью «5. Исполнитель работ»'
          }),
          F('start', 'Дата начала', 'date', { req: 1, rerender: 1 }), F('end', 'Дата окончания', 'date', { req: 1, rerender: 1 }),
          F('actDate', 'Дата акта', 'date', { hint: 'Пусто — дата окончания', rerender: 1 }),
          // подписанты: по умолчанию — по роли и датам «с/по» в «Представителях»; здесь можно выбрать вручную
          ...C.REP_ROLES.map((role, i) => {
            const date = a.actDate || a.end || '';
            const auto = C.pickRep(P, role, date, a.executor || (C.builderOrg(P) || {}).key);
            const people = P.people.slice().sort((x, y) => (y.role === role) - (x.role === role));
            return F('rep' + i, 'Подписант: ' + role.replace(/^\d\.\s*/, ''), 'select', {
              wide: i === 0 ? 1 : 0,
              opts: () => people.map(r => ({ v: r.id, l: C.shortName(r.fullName) + (r.position ? ', ' + r.position.toLowerCase() : '') + ' — ' + r.role + ((r.from || r.to) ? ' (' + (r.from ? 'с ' + C.fmtDate(r.from) : '') + (r.to ? ' по ' + C.fmtDate(r.to) : '') + ')' : '') })),
              empty: auto ? 'Автоматически: ' + C.shortName(auto.fullName) : (i < 2 ? '⚠ Автоматически не нашёлся — выберите' : 'Автоматически: нет (строка пустая)'),
              hint: i === 0 ? 'Обычно не трогайте: подписанты подбираются сами по роли и датам «с/по» в «Представителях». Выбор здесь — если нужен другой человек или даты не подходят.' : (!auto && i < 2 ? C.repMissingReason(P, role, date) : '')
            });
          }),
          F('sheets', 'Листы проекта', 'text', { rerender: 1, hint: (() => { const v = C.actView(P, a); return 'В акте, п. 2: «' + (v.project || '—') + '» — шифр взят: ' + v.rdSource + '. Листы добавляются после шифра.'; })() }),
          // листы из перечня раздела ПД / РД — галочками; в поле выше пишется «листы 3–5»
          ...(C.rdSheets(P, a.section).length ? [F('sheetsPick', 'Листы раздела ' + a.section + ' — нажмите нужные', 'pills', {
            rerender: 1,
            opts: () => C.rdSheets(P, a.section).map(x => ({ v: String(x.no), l: x.no + ' ' + x.name })),
            hint: 'Выбранные листы попадут в «Листы проекта»'
          })] : []),
          F('importDone', 'Акт из чужой ИД приведён к нашему формату — убрать из списка «что исправить»', 'check', { wide: 1, show: () => !!a.imported }),
          // материалы из исходного акта, которые не нашлись в «Материалах», — выбрать вручную
          ...((a.imported && a.imported.matsLeft) || []).map((t, i) => F('matFix' + i, 'Материал из исходного акта: «' + t + '» — это', 'select', {
            wide: 1, rerender: 1, opts: () => P.materials.map(m => ({ v: m.id, l: C.matLabel(P, m) })), empty: '— выберите из «Материалов» —',
            hint: 'Выбранный материал добавится к акту, строка уйдёт из «что исправить»'
          })),
          F('materials', 'Материалы', 'mats', { wide: 1, show: () => a.type === 'АОСР' || isAOOK }),
          F('forceRegistry', 'Реестр документов о качестве — приложением к акту, даже если документов 5 и меньше (при 6 и больше — всегда, по форме 344/пр)', 'check', { wide: 1, show: () => a.type === 'АОСР' || isAOOK }),
          // схемы из справочника «Исполнительные схемы» — галочками; в акт идут, если поле ниже пустое
          ...((P.schemes || []).length ? [F('schemeIds', 'Исполнительные схемы — нажмите нужные', 'pills', {
            opts: () => P.schemes.map(x => ({ v: x.id, l: C.schemeLabel(x) })), hint: 'Попадают в п. ' + (isAOOK ? '5а' : '4') + ', если поле ниже пустое'
          })] : []),
          F('docs', isAOOK ? 'Исполнительные геодезические схемы (п. 5а)' : 'Исполнительные схемы, документы (п. 4)', 'textarea', { wide: 1, ph: (C.actView(P, Object.assign({}, a, { docs: '' })).docs) || (w ? w.docs : '') }),
          F('expertise', 'Результаты экспертиз, лаб. испытаний (п. 5б)', 'textarea', { wide: 1, show: () => isAOOK }),
          F('tests', 'Испытания и опробования (п. 6)', 'textarea', { wide: 1, show: () => isAOOK }),
          F('hiddenActs', 'Освидетельствованные скрытые работы, №№ АОСР (п. 3)', 'textarea', { wide: 1, show: () => isAOOK }),
          F('loadCond', 'Условия полного нагружения (п. 9в)', 'textarea', { wide: 1, show: () => isAOOK }),
          F('manualNorms', 'Нормативы вручную', 'textarea', { wide: 1, ph: w ? w.norms : '' }),
          F('manualNext', 'Последующие работы вручную', 'textarea', { wide: 1, ph: w ? w.next : '', show: () => a.type === 'АОСР' || isAOOK }),
          F('extra', a.type === 'Разбивка осей' ? '«2. Закрепление осей произведено …»' : 'Дополнительные сведения', 'textarea', { wide: 1 }),
          F('manualAttach', 'Приложения вручную', 'textarea', { wide: 1, ph: a.docs || (w ? w.docs : ''), hint: 'Пусто — как исполнительные схемы' }),
          F('copies', 'Экземпляров', 'number', { ph: String(P.settings.copies || '') }),
          F('conditions', 'Условия производства работ (ОЖР, разд. 3)', 'text'),
          F('sheetsCount', 'Кол-во листов (реестр ИД)', 'text'),
          F('note', 'Примечание (реестр ИД)', 'text'),
          F('print', 'Отметить для пакетной печати', 'check', { wide: 1 })
        ];
      },
      // карточка акта — по разделам-гармошкам, на весь экран
      page: true,
      titleOf: a => { const v = C.actView(P, P.acts.find(x => x.id === a.id) || a); return (a.type ? a.type + ' № ' + (v.number || '—') + ' — ' : 'Акт — ') + (v.name || 'без наименования'); },
      sections: a => {
        const v = C.actView(P, a), iss = actIssues(a);
        const has = sec => iss.some(x => x.sec === sec);
        const w = P.works.find(x => x.id === a.workId);
        const dates = a.start || a.end ? (a.start && a.end && a.start !== a.end ? C.fmtDate(a.start) + ' – ' + C.fmtDate(a.end) : C.fmtDate(a.end || a.start)) : 'даты не указаны';
        const mats = (a.materials || []).map(id => P.materials.find(m => m.id === id)).filter(Boolean);
        const sch = (a.schemeIds || []).length;
        const edited = ['manualNorms', 'manualNext', 'extra', 'manualAttach', 'expertise', 'tests', 'hiddenActs', 'loadCond'].filter(k => C.s(a[k])).length;
        return [
          { id: 'main', title: 'Основное', keys: ['type', 'section', 'workId', 'manualName', 'axes', 'manualNo', 'executor', 'start', 'end', 'actDate'], sum: [a.type, a.section, dates].filter(Boolean).join(' · '), mark: has('main') ? 'w' : 'ok', open: true },
          { id: 'proj', title: 'Проект', keys: ['sheets', 'sheetsPick'], sum: v.project || 'шифр не задан', mark: has('proj') ? 'w' : 'ok', open: true },
          { id: 'mats', title: 'Материалы и схемы', keys: [/^matFix/, 'materials', 'forceRegistry', 'schemeIds', 'docs'], sum: [mats.length ? mats.map(m => C.matName(m)).slice(0, 3).join(', ') + (mats.length > 3 ? ' и ещё ' + (mats.length - 3) : '') : 'материалов нет', sch ? 'схем: ' + sch : ''].filter(Boolean).join(' · '), mark: has('mats') ? 'w' : 'ok', open: true },
          { id: 'reps', title: 'Подписанты', keys: [/^rep\d$/], sum: has('reps') ? 'кого-то не хватает' : 'подобраны автоматически по ролям и датам', mark: has('reps') ? 'w' : 'ok', open: has('reps') },
          { id: 'texts', title: 'Тексты пунктов', keys: ['manualNorms', 'manualNext', 'expertise', 'tests', 'hiddenActs', 'loadCond', 'extra', 'manualAttach'], sum: (w ? 'из справочника работ' : 'вид работ не выбран — тексты вручную') + ' · изменено: ' + edited, mark: has('texts') ? 'w' : '', open: has('texts') },
          { id: 'print', title: 'Печать и реестр', keys: ['copies', 'sheetsCount', 'note', 'conditions', 'print', 'importDone'], sum: [(a.copies || P.settings.copies || '—') + ' экз.', a.print ? 'отмечен к печати' : '', a.imported ? (a.importDone ? 'чужая ИД — приведён' : 'чужая ИД') : ''].filter(Boolean).join(' · '), mark: '', open: false }
        ];
      },
      // что не хватает до печати — каждый пункт ведёт в свой раздел
      status: a => {
        const iss = actIssues(a);
        const src = a.imported ? 'Акт из чужой ИД — ' + (a.imported.file || '') + (a.imported.no ? ', исходный № ' + a.imported.no + (a.imported.date ? ' от ' + C.fmtDate(a.imported.date) : '') : '') : '';
        return { ok: !iss.length, title: iss.length ? 'Не хватает до печати: ' + iss.length : 'Акт готов к печати', note: src, items: iss };
      },
      footButtons: (item, save) => [
        { label: '🗎 PDF', title: 'Сохранить и сформировать документ', onClick: () => { if (save()) makeAct(item); } },
        { label: '⤵ Следующий акт', title: 'Сохранить и создать следующий: копия, даты — сразу после этого акта', onClick: () => { if (save()) nextAct(item, () => render()); } }
      ],
      // акт из чужой ИД: что исправить — над полями карточки
      banner: a => {
        if (!a.imported) return '';
        const iss = C.importIssues(P, a);
        return '<b>Акт из чужой ИД</b> — ' + esc(a.imported.file || '') + (a.imported.no ? ', исходный № ' + esc(a.imported.no) + (a.imported.date ? ' от ' + esc(C.fmtDate(a.imported.date)) : '') : '') +
          (iss.length ? '<br>Что исправить:<ul>' + iss.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<br>Замечаний нет — акт соответствует данным проекта.');
      },
      onOpen: a => { const list = C.rdSheets(P, a.section).map(x => String(x.no)); a.sheetsPick = C.sheetsParse(a.sheets).filter(n => list.includes(n)); },
      onChange: (a, k) => {
        const mf = /^matFix(\d+)$/.exec(k);
        if (mf && a[k]) {
          a.materials = (a.materials || []).concat(a.materials && a.materials.includes(a[k]) ? [] : [a[k]]);
          a.imported.matsLeft = a.imported.matsLeft.filter((x, i) => i !== +mf[1]);
          delete a[k];
        }
        if (k === 'sheetsPick') a.sheets = C.sheetsText(a.sheetsPick);
        if (k === 'section' || k === 'sheets' || k === 'sheetsPick') {
          // отметки листов — по тексту поля (руками вписанные номера тоже отмечаются)
          const list = C.rdSheets(P, a.section).map(x => String(x.no));
          a.sheetsPick = C.sheetsParse(a.sheets).filter(n => list.includes(n));
        }
        if (k === 'workId') {
          const w = P.works.find(x => x.id === a.workId);
          if (w) { if (!a.type && w.actType) a.type = w.actType; if (!a.section && w.section) a.section = w.section; }
        }
      },
      // компактная строка: № и название, статус (✓ / ⚠ N с раскрывающимся списком), ниже — даты, подписанты, листы, материалы
      row: a => {
        const v = C.actView(P, a);
        const mats = (a.materials || []).map(id => P.materials.find(m => m.id === id)).filter(Boolean).map(m => C.matName(m));
        const dates = a.start || a.end ? (a.start && a.end && a.start !== a.end ? C.fmtDate(a.start) + ' – ' + C.fmtDate(a.end) : C.fmtDate(a.end || a.start)) : '—';
        return {
          no: a.type ? a.type + ' № ' + (v.number || '—') : 'тип не указан', title: v.name || 'Без наименования',
          tags: [a.imported ? { t: 'чужая ИД' + (a.imported.no ? ', исх. № ' + a.imported.no : ''), c: a.importDone ? 'ok' : '' } : null],
          cols: [['Даты работ', dates, a.start || a.end ? '' : 'dim'], ['Акт от', v.date ? C.fmtDate(v.date) : '—', v.date ? '' : 'dim'], ['Подписанты', v.signers || '—', v.signers ? '' : 'dim'], ['Листы', a.sheets || '—', a.sheets ? '' : 'dim'], ['Материалы', mats.join(', ') || '—', mats.length ? '' : 'dim']],
          colsCls: 'cols-acts',
          issues: actIssues(a)
        };
      },
      search: a => { const v = C.actView(P, a); return [v.number, v.name, a.type, a.section, a.imported ? 'чужая ид' + (a.importDone ? '' : ' исправить') : ''].join(' '); }
    },
    schemes: {
      title: 'Исполнительные схемы', one: 'Исполнительная схема',
      fields: () => [
        F('no', '№ схемы'), F('date', 'Дата', 'date'),
        F('name', 'Наименование', 'textarea', { req: 1, wide: 1, hint: 'Например: Устройство песчаной подготовки в осях 1-4/А-В' }),
        F('note', 'Примечание', 'text', { wide: 1 })
      ],
      row: x => {
        const acts = P.acts.filter(a => (a.schemeIds || []).includes(x.id));
        return { title: C.schemeLabel(x), sub: acts.length ? 'В актах: ' + acts.map(a => (a.type || '') + ' № ' + C.actNumber(P, a)).join(', ') : '', badges: [acts.length ? null : { t: 'не привязана к акту', c: 'warn' }, x.srcFile ? { t: 'из чужой ИД' } : null] };
      },
      search: x => [x.no, x.name, x.note].join(' ')
    },
    rdSections: {
      title: 'Проектная и рабочая документация', one: 'Раздел ПД / РД',
      fields: (r) => {
        // перечень листов редактируется текстом: «№ — наименование» по строке
        if (r && r.sheetListText === undefined) r.sheetListText = (r.sheetList || []).map(x => x.no + ' — ' + x.name).join('\n');
        return [
        F('section', 'Раздел', 'combo', { req: 1, opts: () => P.lists.sections, hint: 'Как в поле «Раздел» видов работ и актов: КЖ, КМ, АР…' }),
        F('stage', 'Стадия', 'select', { opts: [{ v: 'П', l: 'П — проектная документация' }], empty: 'Р — рабочая документация (по умолчанию)' }),
        F('code', 'Шифр', 'text', { req: 1, hint: 'Как в штампе, например 038-2024-КЖ0' }),
        F('docName', 'Наименование раздела', 'combo', { wide: 1, ph: P.settings.projectDocName || '', opts: () => rdNameOpts(r), hint: 'Выберите из списка (▾) или впишите своё. Пусто — наименование из «Договора и доп. соглашений»' }),
        F('designerKey', 'Проектировщик раздела', 'select', { opts: orgKeys, empty: 'Проектировщик объекта' + (C.designerOrg(P) ? ': ' + C.designerOrg(P).key : ''), hint: 'Если раздел разрабатывала другая организация' }),
        F('sheetListText', r && r.stage === 'П' ? 'Тома / разделы' : 'Листы (по строке: «№ — наименование»)', 'textarea', { wide: 1, hint: 'Заполняется при загрузке РД (ведомость рабочих чертежей или штампы). В акте листы выбираются галочками' })
      ];
      },
      onChange: (r, k) => {
        if (k === 'sheetListText') r.sheetList = String(r.sheetListText || '').split('\n').map(l => l.trim()).filter(Boolean)
          .map(l => { const m = /^([0-9A-Za-zА-Яа-я.\-]{1,8})\s*[—–\-.:)]\s*(.*)$/.exec(l); return m ? { no: m[1], name: m[2] } : { no: l.split(/\s+/)[0], name: l.split(/\s+/).slice(1).join(' ') }; });
      },
      row: r => ({
        title: (r.section || '?') + ' — шифр ' + (r.code || 'не указан'),
        sub: C.rdFor(P, { section: r.section }, null).projectDoc,
        badges: [{ t: r.stage === 'П' ? 'ПД' : 'РД', c: 'ok' }, (r.sheetList || []).length ? { t: (r.stage === 'П' ? 'томов: ' : 'листов: ') + r.sheetList.length } : null,
          P.works.filter(w => w.section === r.section).length ? { t: 'видов работ: ' + P.works.filter(w => w.section === r.section).length } : { t: 'нет видов работ с этим разделом', c: 'warn' }]
      }),
      search: r => [r.section, r.code, r.docName].join(' ')
    },
    supplements: {
      title: 'Дополнительные соглашения', one: 'Дополнительное соглашение',
      fields: () => [
        F('no', 'Номер ДС', 'text', { req: 1 }), F('date', 'Дата ДС', 'date', { req: 1 }),
        F('subject', 'Предмет (кратко)', 'textarea', { wide: 1, hint: 'Для себя — в документы не попадает (там «Дополнительные работы по дополнительному соглашению № … от …»)' }),
        F('priceMode', 'Как меняется цена договора', 'select', { wide: 1, rerender: 1, opts: [
          { v: 'new', l: 'Новая цена основных работ — доп. работы по другим ДС прибавляются сверху' },
          { v: 'total', l: 'Новая общая цена договора — уже с учётом всех прежних ДС' }
        ], empty: 'Увеличивается / уменьшается на сумму (доп. работы)' }),
        F('amount', 'На сумму, руб. с НДС (уменьшение — со знаком минус)', 'number', { show: w => !w.priceMode, hint: 'Пусто — по позициям этого ДС в смете; 0 — цена не меняется (например, ДС только про сроки)' }),
        F('newPrice', 'Новая цена, руб. с НДС', 'number', { show: w => !!w.priceMode, hint: 'Например, ДС № 2 «Общая стоимость составляет 9 655 000» по расчёту основных работ — это «новая цена основных работ»' }),
        F('fullCalc', 'ДС утверждает новую редакцию всего расчёта стоимости (вместо приложения к договору)', 'check', { wide: 1, hint: 'Тогда его позиции — основные работы «в редакции ДС», а в КС-2 номера позиций по смете — по расчёту этого ДС. Не отмечайте, если в ДС только дополнительные работы' }),
        F('startDate', 'Новое начало работ', 'date'), F('endDate', 'Новое окончание работ', 'date'),
        F('note', 'Примечание', 'textarea', { wide: 1 })
      ],
      row: d => {
        const st = C.contractPriceNow(P).steps.find(x => x.ds === d);
        const n = P.smeta.filter(r => r.dsId === d.id).length, ex = P.smeta.filter(r => r.excludedBy === d.id).length;
        return {
          title: 'ДС № ' + (d.no || '—') + (d.date ? ' от ' + C.fmtDate(d.date) : '') + (d.subject ? ' — ' + d.subject : ''),
          sub: [st && st.delta ? 'цена ' + (st.delta > 0 ? '+' : '−') + C.money(Math.abs(st.delta)) + ' → ' + C.money(st.after) : 'цена не меняется',
            d.endDate ? 'окончание ' + C.fmtDate(d.endDate) : ''].filter(Boolean).join(' · '),
          badges: [d.fullCalc ? { t: 'новая редакция расчёта', c: 'ok' } : null, n ? { t: 'позиций в смете: ' + n, c: 'ok' } : null, ex ? { t: 'исключено позиций: ' + ex, c: 'warn' } : null, !d.no || !d.date ? { t: 'нет номера или даты', c: 'warn' } : null]
        };
      },
      search: d => [d.no, d.subject, d.note].join(' ')
    },
    smeta: {
      title: 'Позиции сметы', one: 'Позиция сметы',
      fields: () => [
        F('name', 'Наименование работ и затрат', 'textarea', { req: 1, wide: 1 }),
        F('no', '№ в расчёте', 'text', { hint: 'Номер позиции в документе, где она согласована (договор, его редакция по ДС или расчёт ДС) — идёт в КС-2 в графу «позиции по смете». Пусто — по порядку' }),
        F('unit', 'Ед. изм.', 'combo', { opts: units }),
        F('qty', 'Количество', 'number'),
        F('priceWork', 'Цена работ за ед., ' + (C.vatTop(P) ? 'без НДС' : 'с НДС'), 'number'),
        F('priceMat', 'Цена материала за ед., ' + (C.vatTop(P) ? 'без НДС' : 'с НДС'), 'number'),
        F('dsId', 'Основание позиции', 'select', { wide: 1, show: () => P.supplements.length > 0, opts: dsOpts, empty: 'Основной договор', hint: 'Дополнительные работы — выберите доп. соглашение: в смете и КС они пойдут отдельным разделом' }),
        F('excludedBy', 'Исключена из договора', 'select', { wide: 1, show: () => P.supplements.length > 0, opts: dsOpts, empty: 'Нет — позиция действует', hint: 'Если доп. соглашение исключило работы: позиция останется в списке, но в смету и КС не попадёт' })
      ],
      row: r => {
        const c = C.smetaRow(r), before = C.qtyDoneBefore(P, r.id);
        const left = C.num(r.qty) - before - C.num(r.qtyNow);
        const ds = C.dsById(P, r.dsId), ex = C.dsById(P, r.excludedBy);
        const chs = (r.changes || []).filter(ch => C.dsById(P, ch.dsId));
        const was = chs.length ? chs[0].from : null; // как было по договору
        return {
          // номер позиции в её расчёте (договор / редакция по ДС / ДС) — он же в графе «позиции по смете» КС-2
          num: C.smetaNo(P, r), cls: ex ? 'excl' : '',
          title: r.name || 'Без названия', sub: C.qty(r.qty) + ' ' + (r.unit || '') + ' × ' + C.money(c.unitPrice) + ' = ' + C.money(c.total) + ' руб.' +
            (was ? ' · по договору было: ' + C.qty(was.qty) + ' × ' + C.money(C.num(was.priceWork) + C.num(was.priceMat)) + ' = ' + C.money(C.smetaRow(was).total) : ''),
          badges: [ds ? { t: 'ДС № ' + (ds.no || '—'), c: 'ok' } : null, ex ? { t: 'исключена по ДС № ' + (ex.no || '—'), c: 'warn' } : null,
            ...chs.map(ch => ({ t: 'изменена по ДС № ' + (C.dsById(P, ch.dsId).no || '—') })),
            pendingOf(r).length ? { t: 'есть изменение по ДС — не принято', c: 'warn' } : null,
            left < -1e-6 && !ex ? { t: 'по КС больше, чем в смете', c: 'danger' } : null],
          // изменение из загруженного ДС — применить или отклонить прямо здесь
          notes: pendingOf(r).map(x => ({ text: pendingText(r, x), buttons: [
            { label: 'Применить', cls: 'btn-primary', onClick: () => { applyPending(r, x); touch(); smetaRedraw(); toast('Изменение из ДС применено'); } },
            { label: 'Отклонить', onClick: () => { dropPending(r, x); touch(); smetaRedraw(); } }
          ] }))
        };
      },
      search: r => r.name
    },
    r1: {
      one: 'Запись раздела 1', fields: () => [
        F('org', 'Наименование лица, осуществляющего строительство', 'text', { wide: 1 }),
        F('person', 'Фамилия, инициалы, должность (ИТР)', 'text', { wide: 1 }),
        F('start', 'Дата начала работ с указанием вида работ', 'text', { wide: 1 }),
        F('end', 'Дата окончания работ', 'text'),
        F('signer', 'Уполномоченный представитель (должность, ФИО)', 'text', { wide: 1 })
      ], row: r => ({ title: r.person || '—', sub: [r.org, r.start, r.end].filter(Boolean).join(' · ') })
    },
    r2: {
      one: 'Специальный журнал', fields: () => [
        F('name', 'Наименование журнала и дата выдачи', 'text', { wide: 1 }),
        F('org', 'Кто ведёт журнал (организация, представитель)', 'textarea', { wide: 1 }),
        F('date', 'Дата передачи застройщику'),
        F('sign', 'Подпись представителя застройщика (должность, ФИО)')
      ], row: r => ({ title: r.name || '—', sub: r.org })
    },
    r4: {
      one: 'Запись строительного контроля', fields: () => [
        F('info', 'Сведения о проведении строительного контроля', 'textarea', { wide: 1 }),
        F('defects', 'Выявленные недостатки', 'textarea', { wide: 1 }),
        F('deadline', 'Срок устранения'), F('fixed', 'Дата устранения'),
        F('rep', 'Представитель (должность, ФИО) — выявил', 'text', { wide: 1 }),
        F('rep2', 'Представитель (должность, ФИО) — принял устранение', 'text', { wide: 1 })
      ], row: r => ({ title: r.info || '—', sub: r.defects })
    },
    r6: {
      one: 'Запись ГСН', fields: () => [
        F('date', 'Дата мероприятия'), F('deadline', 'Срок устранения нарушений'),
        F('info', 'Данные о контрольном (надзорном) мероприятии', 'textarea', { wide: 1 }),
        F('official', 'Должностное лицо (должность, ФИО)', 'text', { wide: 1 }),
        F('fixed', 'Фактическая дата устранения'),
        F('official2', 'Должностное лицо (должность, ФИО) — устранение', 'text', { wide: 1 })
      ], row: r => ({ title: (r.date ? r.date + ' — ' : '') + (r.info || '—'), sub: r.official })
    },
    others: {
      one: 'Другое лицо, осуществляющее строительство', fields: () => [
        F('org', 'Наименование / ФИО, ОГРН, ИНН, адрес', 'textarea', { wide: 1 }),
        F('rep', 'Уполномоченный представитель: ФИО, должность, документ', 'textarea', { wide: 1 }),
        F('works', 'Выполняемые работы', 'textarea', { wide: 1 })
      ], row: r => ({ title: r.org || '—', sub: r.works })
    },
    titleChanges: {
      one: 'Изменение титульного листа', fields: () => [
        F('date', 'Дата'), F('change', 'Изменения с указанием основания', 'textarea', { wide: 1 }),
        F('person', 'Лицо, внёсшее изменения (ФИО, должность, документ)', 'textarea', { wide: 1 })
      ], row: r => ({ title: (r.date ? r.date + ' — ' : '') + (r.change || '—'), sub: r.person })
    }
  };

  // ================= построение полей =================
  function optList(f) {
    const raw = typeof f.opts === 'function' ? f.opts() : (f.opts || []);
    return raw.map(o => typeof o === 'object' ? o : { v: o, l: o });
  }
  // типовые наименования разделов (марки основных комплектов по ГОСТ Р 21.101)
  const RD_NAMES = [
    ['ГП', 'Генеральный план'], ['АР', 'Архитектурные решения'], ['АС', 'Архитектурно-строительные решения'],
    ['КЖ', 'Конструкции железобетонные'], ['КЖ0', 'Конструкции железобетонные. Фундаменты'], ['КМ', 'Конструкции металлические'],
    ['КМД', 'Конструкции металлические деталировочные'], ['КД', 'Конструкции деревянные'], ['КР', 'Конструктивные решения'],
    ['ОВ', 'Отопление, вентиляция и кондиционирование воздуха'], ['ТМ', 'Тепломеханические решения'], ['ВК', 'Внутренние системы водоснабжения и канализации'],
    ['НВК', 'Наружные сети водоснабжения и канализации'], ['НВ', 'Наружные сети водоснабжения'], ['НК', 'Наружные сети канализации'],
    ['ТС', 'Тепловые сети'], ['ГСН', 'Газоснабжение. Наружные газопроводы'], ['ГСВ', 'Газоснабжение. Внутренние устройства'],
    ['ЭМ', 'Силовое электрооборудование'], ['ЭО', 'Электрическое освещение (внутреннее)'], ['ЭН', 'Электрическое освещение наружное'],
    ['ЭС', 'Электроснабжение'], ['ЭОМ', 'Силовое электрооборудование и электроосвещение'], ['ЭСН', 'Наружные сети электроснабжения'],
    ['СС', 'Системы связи'], ['СКС', 'Структурированные кабельные системы'], ['ПС', 'Пожарная сигнализация'], ['АПС', 'Автоматическая пожарная сигнализация'],
    ['СОУЭ', 'Система оповещения и управления эвакуацией'], ['АПТ', 'Автоматическое пожаротушение'], ['АОВ', 'Автоматизация отопления и вентиляции'],
    ['АК', 'Комплексная автоматизация'], ['ТХ', 'Технологические решения'], ['АД', 'Автомобильные дороги'], ['ПЗ', 'Пояснительная записка'],
    ['ПОС', 'Проект организации строительства'], ['ГР', 'Гидротехнические решения'], ['ВР', 'Внутриплощадочные инженерные сети']
  ];
  function rdNameOpts(r) {
    const pre = r && r.stage === 'П' ? 'Проектная документация. ' : 'Рабочая документация. ';
    const sec = String((r && r.section) || '').trim().toUpperCase();
    const out = [], seen = new Set();
    const add = (v, l) => { v = String(v || '').trim(); if (!v || seen.has(v)) return; seen.add(v); out.push({ v, l: l || v }); };
    // сначала — по выбранному разделу, затем уже использованные в проекте, затем все типовые
    RD_NAMES.filter(([m]) => sec && (m === sec || sec.startsWith(m) || m.startsWith(sec))).forEach(([m, n]) => add(pre + n, m + ' — ' + pre + n));
    if (P.settings.projectDocName) add(P.settings.projectDocName);
    P.rdSections.forEach(x => { if (x !== r) add(x.docName); });
    RD_NAMES.forEach(([m, n]) => add(pre + n, m + ' — ' + pre + n));
    return out;
  }
  // поле «выбрать из списка или вписать своё»: по кнопке ▾ показывает ВСЕ варианты, при вводе — подходящие
  function comboEl(f, value) {
    const box = document.createElement('div'); box.className = 'combo';
    box.innerHTML = '<input type="text" autocomplete="off"><button type="button" class="combo-btn" tabindex="-1" aria-label="Показать список">▾</button><div class="combo-list" hidden></div>';
    const input = $('input', box), list = $('.combo-list', box);
    input.value = value || '';
    let filterOn = false;
    const show = () => {
      const q = filterOn ? input.value.trim().toLowerCase() : '';
      const opts = optList(f).filter(o => !q || String(o.l).toLowerCase().includes(q));
      list.innerHTML = opts.length ? opts.map(o => '<div class="combo-opt' + (o.v === input.value ? ' sel' : '') + '" data-v="' + esc(o.v) + '">' + esc(o.l) + '</div>').join('')
        : '<div class="combo-empty">Нет в списке — будет записано как введено</div>';
      list.hidden = false;
    };
    const hide = () => { list.hidden = true; filterOn = false; };
    $('.combo-btn', box).addEventListener('mousedown', e => { e.preventDefault(); if (list.hidden) { filterOn = false; show(); input.focus(); } else hide(); });
    input.addEventListener('input', () => { filterOn = true; show(); });
    input.addEventListener('focus', () => { if (!input.value) { filterOn = false; show(); } });
    input.addEventListener('blur', () => setTimeout(hide, 150));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); if (e.key === 'ArrowDown' && list.hidden) { filterOn = false; show(); } });
    list.addEventListener('mousedown', e => {
      const o = e.target.closest('.combo-opt'); if (!o) return;
      e.preventDefault(); input.value = o.dataset.v; hide();
      input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
      list.hidden = true;
    });
    return { box, input };
  }
  function fieldEl(f, obj, onInput) {
    const wrap = document.createElement(f.t === 'check' || f.t === 'combo' || f.t === 'image' ? 'div' : 'label');
    wrap.className = 'field' + (f.wide ? ' wide' : '');
    const v = obj[f.k];
    if (f.t === 'check') {
      wrap.innerHTML = '<label class="check"><input type="checkbox"' + (v ? ' checked' : '') + '> ' + esc(f.l) + '</label>';
      $('input', wrap).addEventListener('change', e => onInput(f, e.target.checked));
      return wrap;
    }
    // несколько галочек (например, листы РД для акта): значение — массив отмеченных
    if (f.t === 'checks') {
      wrap.className = 'field wide';
      const cur = Array.isArray(v) ? v.map(String) : [];
      wrap.innerHTML = '<span>' + esc(f.l) + '</span><div class="checks">' + optList(f).map(o => '<label class="check"><input type="checkbox" value="' + esc(o.v) + '"' + (cur.includes(String(o.v)) ? ' checked' : '') + '> ' + esc(o.l) + '</label>').join('') + '</div>' + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '');
      wrap.addEventListener('change', () => onInput(f, Array.from(wrap.querySelectorAll('input:checked')).map(x => x.value), true));
      return wrap;
    }
    // то же, но «таблетками»: нажал — выбрано (листы РД, схемы в карточке акта)
    if (f.t === 'pills') {
      wrap.className = 'field wide';
      const cur = Array.isArray(v) ? v.map(String) : [];
      wrap.innerHTML = '<span>' + esc(f.l) + '</span><div class="pills">' + optList(f).map(o => '<button type="button" class="pill' + (cur.includes(String(o.v)) ? ' on' : '') + (o.bad ? ' bad' : '') + '" data-v="' + esc(o.v) + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + esc(o.l) + '</button>').join('') + '</div>' + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '');
      wrap.addEventListener('click', e => {
        const b = e.target.closest('.pill'); if (!b) return;
        b.classList.toggle('on');
        onInput(f, Array.from(wrap.querySelectorAll('.pill.on')).map(x => x.dataset.v), true);
      });
      return wrap;
    }
    wrap.innerHTML = '<span>' + esc(f.l) + (f.req ? ' <b>*</b>' : '') + '</span>';
    if (f.help) wrap.firstChild.appendChild(helpTip(f.help)); // пояснение — в «?», а не текстом под полем
    let input;
    if (f.t === 'textarea') {
      input = document.createElement('textarea'); input.rows = 2; input.value = v || '';
    } else if (f.t === 'select') {
      input = document.createElement('select');
      const opts = optList(f);
      let html = '<option value="">' + esc(f.empty || '—') + '</option>';
      let found = !v;
      opts.forEach(o => { if (o.v === v) found = true; html += '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; });
      // значение есть, но в текущем (отфильтрованном) списке его нет — показываем по-человечески, а не код
      if (!found) html += '<option value="' + esc(v) + '" selected>' + esc(f.labelOf ? f.labelOf(v) : v) + ' (не подходит / нет в списке)</option>';
      input.innerHTML = html;
    } else if (f.t === 'combo') {
      const cb = comboEl(f, v);
      input = cb.input;
      wrap.appendChild(cb.box);
      if (f.ph) input.placeholder = String(f.ph).slice(0, 300);
      if (f.hint) { const h = document.createElement('small'); h.textContent = f.hint; wrap.appendChild(h); }
      input.addEventListener('input', () => onInput(f, input.value));
      if (f.rerender) input.addEventListener('change', () => onInput(f, input.value, true));
      return wrap;
    } else if (f.t === 'image') {
      // картинка (подпись, печать): уменьшаем и храним в проекте как PNG data:URL
      const box = document.createElement('div'); box.className = 'img-field';
      const draw = val => {
        box.innerHTML = (val ? '<img alt="" src="' + esc(val) + '">' : '<span class="muted small">не загружено</span>') +
          '<label class="btn btn-sm">' + (val ? 'Заменить' : 'Загрузить картинку') + '<input type="file" accept="image/*" hidden></label>' + (val ? '<button type="button" class="btn btn-sm" data-del>Убрать</button>' : '');
        $('input', box).addEventListener('change', async e => {
          const file = e.target.files[0]; if (!file) return;
          try { const url = await imageToDataUrl(file, f.maxSide || 500); onInput(f, url); draw(url); } catch (err) { toast('Картинка не открылась'); }
        });
        const del = $('[data-del]', box); if (del) del.addEventListener('click', () => { onInput(f, ''); draw(''); });
      };
      draw(v);
      wrap.appendChild(box);
      if (f.hint) { const h = document.createElement('small'); h.textContent = f.hint; wrap.appendChild(h); }
      return wrap;
    } else if (f.t === 'mats') {
      wrap.appendChild(matsEl(obj, f, onInput));
      return wrap;
    } else {
      input = document.createElement('input');
      input.type = f.t === 'date' ? 'date' : 'text';
      if (f.t === 'number') { input.inputMode = 'decimal'; }
      input.value = v === undefined || v === null ? '' : v;
    }
    if (f.ph) input.placeholder = String(f.ph).slice(0, 300);
    wrap.appendChild(input);
    if (f.hint) { const h = document.createElement('small'); h.textContent = f.hint; wrap.appendChild(h); }
    const ev = (f.t === 'select' || f.t === 'date') ? 'change' : 'input';
    input.addEventListener(ev, () => {
      let val = input.value;
      if (f.t === 'number') val = val.trim() === '' ? '' : C.num(val);
      onInput(f, val);
    });
    if (f.rerender && ev === 'input') input.addEventListener('change', () => onInput(f, input.value, true));
    return wrap;
  }

  // скан подписи / печати → PNG не больше maxSide; белый фон делаем прозрачным, чтобы не закрывать линии бланка
  function imageToDataUrl(file, maxSide) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const v = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
          if (v > 215) d.data[i + 3] = 0; else if (v > 170) d.data[i + 3] = Math.round(255 * (215 - v) / 45);
        }
        x.putImageData(d, 0, 0);
        URL.revokeObjectURL(u); res(c.toDataURL('image/png'));
      };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('image')); };
      im.src = u;
    });
  }
  function matsEl(obj, f, onInput) {
    const box = document.createElement('div'); box.className = 'mats';
    const draw = () => {
      const ids = obj.materials || [];
      box.innerHTML = '';
      ids.forEach((id, i) => {
        const m = P.materials.find(x => x.id === id);
        const it = document.createElement('div'); it.className = 'mat-item';
        it.innerHTML = '<span>' + esc(m ? C.matLabel(P, m) : '(материал удалён)') + (m && C.matExpired(m, obj.actDate || obj.end) ? ' <span class="badge warn">истёк</span>' : '') + '</span>' +
          // расход материала на эти работы — для ведомости остатков
          '<label class="mat-qty" title="Сколько материала ушло на эти работы — для ведомости остатков"><input type="text" inputmode="decimal" placeholder="расход"><span>' + esc(m ? m.unit || '' : '') + '</span></label>' +
          '<button type="button" class="icon-btn" data-a="up" title="Выше">&#8593;</button><button type="button" class="icon-btn" data-a="down" title="Ниже">&#8595;</button><button type="button" class="icon-btn" data-a="del" title="Убрать">&#10005;</button>';
        const qi = it.querySelector('.mat-qty input');
        qi.value = obj.matQty && obj.matQty[id] !== undefined ? obj.matQty[id] : '';
        qi.addEventListener('change', () => {
          const v = qi.value.trim(), mq = Object.assign({}, obj.matQty || {});
          if (v === '') delete mq[id]; else mq[id] = C.num(v);
          onInput({ k: 'matQty' }, mq);
        });
        it.addEventListener('click', e => {
          const a = e.target.closest('button'); if (!a) return;
          const arr = (obj.materials || []).slice();
          if (a.dataset.a === 'del') arr.splice(i, 1);
          if (a.dataset.a === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
          if (a.dataset.a === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
          onInput(f, arr); draw();
        });
        box.appendChild(it);
      });
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">+ Добавить материал…</option>' + P.materials.filter(m => m.name && !ids.includes(m.id))
        .map(m => '<option value="' + esc(m.id) + '">' + esc(C.matLabel(P, m)) + (C.matExpired(m) ? ' (документ истёк)' : '') + '</option>').join('');
      sel.addEventListener('change', () => { if (!sel.value) return; onInput(f, (obj.materials || []).concat(sel.value)); draw(); });
      box.appendChild(sel);
      if (!P.materials.length) { const h = document.createElement('small'); h.textContent = 'Сначала заполните раздел «Материалы».'; box.appendChild(h); }
    };
    draw();
    return box;
  }

  // форма для одного объекта (настройки) — сохраняет сразу
  function formGrid(obj, fields, onAny) {
    const g = document.createElement('div'); g.className = 'grid';
    fields.forEach(f => (f.show && !f.show(obj)) || g.appendChild(fieldEl(f, obj, (ff, val) => { obj[ff.k] = val; touch(); if (onAny) onAny(ff); })));
    return g;
  }

  // ================= редактор записи =================
  // eo: { focus: id раздела карточки — раскрыть и прокрутить к нему }
  function openEditor(schemaKey, arr, item, isNew, after, eo) {
    const sc = SCHEMA[schemaKey];
    const work = JSON.parse(JSON.stringify(item));
    const body = document.createElement('div');
    let openSecs = null; // раскрытые разделы карточки — сохраняются при перерисовке
    let heads = [];      // заголовки разделов — обновляются при вводе (кратко, отметка)
    editorDirty = false;
    const onField = (ff, val, rerender) => {
      work[ff.k] = val; editorDirty = true;
      if (sc.onChange) sc.onChange(work, ff.k);
      if (ff.rerender && (rerender || ff.t === 'select')) { const top = $('#dlgBody').scrollTop; draw(); $('#dlgBody').scrollTop = top; }
      else { if (sc.preview) updPrev(); updHeads(); }
    };
    const fieldMatch = (f, keys) => keys.some(k => k instanceof RegExp ? k.test(f.k) : k === f.k);
    const updHeads = () => {
      if (!sc.sections || !heads.length) return;
      const secs = sc.sections(work);
      heads.forEach(h => {
        const s = secs.find(x => x.id === h.id); if (!s) return;
        h.sum.textContent = s.sum || '';
        h.mark.className = 'mark ' + (s.mark || ''); h.mark.textContent = s.mark === 'ok' ? '✓' : s.mark === 'w' ? '⚠' : '';
      });
      drawStatus();
    };
    let statusEl = null;
    const drawStatus = () => {
      if (!statusEl || !sc.status) return;
      const st = sc.status(work);
      statusEl.className = 'ed-status ' + (st.ok ? 'ok' : 'w');
      statusEl.innerHTML = '<div class="ic">' + (st.ok ? '✓' : '⚠') + '</div><div><b>' + esc(st.title) + '</b>' + (st.note ? '<span class="muted small">' + esc(st.note) + '</span>' : '') + '<div class="todo"></div></div>';
      st.items.forEach(x => {
        const a = document.createElement('a'); a.tabIndex = 0; a.className = x.lvl === 'r' ? 'r' : ''; a.textContent = x.text;
        a.addEventListener('click', () => goSec(x.sec));
        $('.todo', statusEl).appendChild(a);
      });
    };
    const goSec = id => {
      const el = $('[data-sec="' + id + '"]', body); if (!el) return;
      el.classList.add('open'); openSecs && openSecs.add(id);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
    };
    const draw = () => {
      body.innerHTML = '';
      if (sc.onOpen && !work._opened) { work._opened = 1; sc.onOpen(work); }
      const fields = sc.fields(work).filter(f => !f.show || f.show(work));
      const mk = f => fieldEl(f, work, onField);
      if (sc.sections) {
        // статус готовности и разделы-гармошки
        statusEl = document.createElement('div'); body.appendChild(statusEl); drawStatus();
        const secs = sc.sections(work);
        if (!openSecs) openSecs = new Set(secs.filter(s => s.open || s.mark === 'w').map(s => s.id).concat(eo && eo.focus ? [eo.focus] : []));
        heads = [];
        const used = new Set();
        secs.forEach((s, i) => {
          const fs = fields.filter(f => !used.has(f) && fieldMatch(f, s.keys));
          if (!fs.length) return;
          fs.forEach(f => used.add(f));
          const el = document.createElement('div'); el.className = 'ed-sec' + (openSecs.has(s.id) ? ' open' : ''); el.dataset.sec = s.id;
          el.innerHTML = '<div class="h" tabindex="0"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(s.title) + '</span><span class="sum"></span><span class="mark"></span><span class="ch">▾</span></div><div class="b"></div>';
          const h = $('.h', el);
          const tg = () => { el.classList.toggle('open'); el.classList.contains('open') ? openSecs.add(s.id) : openSecs.delete(s.id); };
          h.addEventListener('click', tg); h.addEventListener('keydown', e => { if (e.key === 'Enter') tg(); });
          heads.push({ id: s.id, sum: $('.sum', el), mark: $('.mark', el) });
          const g = document.createElement('div'); g.className = 'grid';
          fs.forEach(f => g.appendChild(mk(f)));
          $('.b', el).appendChild(g);
          body.appendChild(el);
        });
        // поля, не попавшие ни в один раздел — в конце
        const rest = fields.filter(f => !used.has(f));
        if (rest.length) { const g = document.createElement('div'); g.className = 'grid'; g.style.marginTop = '10px'; rest.forEach(f => g.appendChild(mk(f))); body.appendChild(g); }
        updHeads();
      } else {
        const bn = sc.banner && sc.banner(work);
        if (bn) { const b = document.createElement('div'); b.className = 'row-note editor-banner'; b.innerHTML = '<span>' + bn + '</span>'; body.appendChild(b); }
        const g = document.createElement('div'); g.className = 'grid';
        fields.forEach(f => g.appendChild(mk(f)));
        body.appendChild(g);
      }
      if (sc.preview) {
        const pv = document.createElement('div'); pv.className = 'card small'; pv.style.marginTop = '14px'; pv.id = 'prev';
        body.appendChild(pv); updPrev();
      }
    };
    const updPrev = () => { const pv = $('#prev', body); if (pv) pv.innerHTML = '<span class="muted">Текст для актов:</span><br>' + esc(sc.preview(work) || '—'); };
    draw();
    const buttons = [];
    if (!isNew) buttons.push({ label: 'Удалить', cls: 'btn-danger', onClick: () => {
      const refs = schemaKey === 'orgs' ? orgRefs(item.key) : '';
      confirmBox(refs ? 'На организацию «' + item.key + '» ссылаются: ' + refs + '. После удаления эти ссылки станут пустыми. Удалить?' : 'Удалить запись?', 'Удалить', () => undoable('Запись удалена', () => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); touch(); after && after(); }), true);
    } });
    // сохранить карточку; false — если не заполнены обязательные поля
    const save = () => {
      const miss = sc.fields(work).filter(f => f.req && (!f.show || f.show(work)) && (work[f.k] === undefined || work[f.k] === ''));
      if (miss.length) { toast('Заполните: ' + miss.map(f => f.l).join(', ')); return false; }
      if (schemaKey === 'orgs') {
        work.key = String(work.key).trim();
        if (P.orgs.some(o => o !== item && o.key === work.key)) { toast('Ключ «' + work.key + '» уже занят другой организацией'); return false; }
        if (!isNew && item.key && item.key !== work.key) renameOrgKey(item.key, work.key);
      }
      const w2 = JSON.parse(JSON.stringify(work));
      delete w2._opened; delete w2.sheetsPick; // служебные поля карточки
      Object.keys(item).forEach(k => delete item[k]);
      Object.assign(item, w2);
      if (isNew && !arr.includes(item)) arr.push(item);
      isNew = false;
      touch(); closeDialog(); after && after();
      return true;
    };
    buttons.push('spacer');
    if (sc.footButtons) sc.footButtons(item, save).forEach(b => buttons.push(b));
    buttons.push({ label: 'Отмена', onClick: closeDialog }, { label: 'Сохранить', cls: 'btn-primary', onClick: save });
    const title = (isNew ? 'Новая запись: ' : '') + (sc.titleOf && !isNew ? sc.titleOf(work) : sc.one);
    openDialog(title, body, buttons, null, { page: !!sc.page });
    if (eo && eo.focus) setTimeout(() => goSec(eo.focus), 50);
  }

  // ================= быстрый поиск (Ctrl+K): разделы, акты, материалы, участники, смета… =================
  function quickSearch() {
    const body = document.createElement('div');
    body.innerHTML = '<input type="search" class="qs-in" placeholder="Акт, материал, организация, ФИО, позиция сметы, раздел меню…" autocomplete="off"><div class="qs-list"></div><p class="muted small qs-hint">↑ ↓ — выбрать, Enter — открыть, Esc — закрыть</p>';
    const inp = $('.qs-in', body), box = $('.qs-list', body);
    const open = (view, key, arr, it) => () => { closeDialog(); location.hash = '#/' + view; setTimeout(() => openEditor(key, arr, it, false, () => render()), 60); };
    const all = () => {
      const out = [];
      $$('.sidebar a[data-view]').forEach(a => out.push({ ic: '↪', t: a.textContent.replace(/\d+$/, '').trim(), s: 'раздел', go: () => { closeDialog(); location.hash = a.getAttribute('href'); } }));
      P.acts.filter(a => a.type).forEach(a => { const v = C.actView(P, a); out.push({ ic: '📝', t: a.type + ' № ' + v.number + ' — ' + v.name, s: [C.fmtDate(v.date), a.sheets].filter(Boolean).join(' · '), go: open('acts', 'acts', P.acts, a) }); });
      P.materials.filter(m => m.name).forEach(m => out.push({ ic: '🧱', t: C.matNo(P, m) + ' ' + C.matName(m), s: C.matDocs(m), go: open('materials', 'materials', P.materials, m) }));
      P.orgs.forEach(o => out.push({ ic: '🏢', t: (o.key ? o.key + ' — ' : '') + (o.name || ''), s: [o.role, o.inn ? 'ИНН ' + o.inn : ''].filter(Boolean).join(' · '), go: open('orgs', 'orgs', P.orgs, o) }));
      P.people.forEach(r => out.push({ ic: '👤', t: r.fullName || '', s: [r.position, r.role, r.orgKey].filter(Boolean).join(' · '), go: open('people', 'people', P.people, r) }));
      P.smeta.filter(r => r.name).forEach(r => out.push({ ic: '💰', t: r.name, s: C.qty(r.qty) + ' ' + (r.unit || '') + ' · смета', go: () => { closeDialog(); smetaTab = 't1'; location.hash = '#/smeta'; } }));
      P.works.forEach(w => out.push({ ic: '📚', t: C.workLabel(w), s: 'справочник работ', go: open('works', 'works', P.works, w) }));
      (P.rdSections || []).forEach(r => out.push({ ic: '📐', t: [r.section, r.code, r.name].filter(Boolean).join(' · '), s: 'ПД / РД', go: open('rd', 'rdSections', P.rdSections, r) }));
      (P.schemes || []).forEach(x => out.push({ ic: '📏', t: C.schemeLabel(x), s: 'исполнительная схема', go: open('schemes', 'schemes', P.schemes, x) }));
      P.supplements.forEach(d => out.push({ ic: '📄', t: 'ДС № ' + (d.no || '—') + (d.date ? ' от ' + C.fmtDate(d.date) : ''), s: d.subject || 'доп. соглашение', go: open('settings', 'supplements', P.supplements, d) }));
      return out;
    };
    const src = all();
    let found = [], sel = 0;
    const draw = () => {
      const words = inp.value.toLowerCase().split(/\s+/).filter(Boolean);
      found = (words.length ? src.filter(x => { const h = (x.t + ' ' + x.s).toLowerCase(); return words.every(w => h.includes(w)); }) : src.filter(x => x.s === 'раздел')).slice(0, 40);
      sel = Math.min(sel, Math.max(0, found.length - 1));
      box.innerHTML = found.length ? found.map((x, i) => '<div class="qs-it' + (i === sel ? ' on' : '') + '" data-i="' + i + '"><span class="ic">' + x.ic + '</span><span class="tx"><b>' + esc(x.t) + '</b><span class="muted small">' + esc(x.s || '') + '</span></span></div>').join('') : '<div class="empty">Ничего не найдено</div>';
      const on = $('.qs-it.on', box); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    inp.addEventListener('input', () => { sel = 0; draw(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(found.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (found[sel]) found[sel].go(); }
    });
    box.addEventListener('click', e => { const it = e.target.closest('.qs-it'); if (it) found[+it.dataset.i].go(); });
    openDialog('Поиск по объекту', body, []);
    draw(); setTimeout(() => inp.focus(), 30);
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) { e.preventDefault(); quickSearch(); }
  });

  // ================= мастер нового объекта: 3 шага =================
  function newObjectWizard() {
    const st = P.settings;
    const w = { objectName: st.objectName || '', address: st.address || '', contractNo: st.contractNo || '', contractDate: st.contractDate || '', contractPrice: st.contractPrice || '', role: C.ROLE.contractor, ourName: '', ourInn: '', custName: '' };
    let step = 1;
    const keyOf = n => String(n || '').replace(/^\s*(ООО|АО|ПАО|ЗАО|ОАО|ИП|ФГУП|МУП|ГУП)\s*/i, '').replace(/[«»"']/g, '').trim().slice(0, 30);
    const body = document.createElement('div');
    const draw = () => {
      body.innerHTML = '<div class="wz-steps">' + ['Объект и договор', 'Ваша организация', 'Что дальше'].map((t, i) => '<span class="' + (i + 1 === step ? 'on' : i + 1 < step ? 'done' : '') + '"><b>' + (i + 1 < step ? '✓' : i + 1) + '</b>' + t + '</span>').join('') + '</div>';
      if (step === 1) {
        const up = document.createElement('div'); up.className = 'wz-up';
        up.innerHTML = '<div><b>Есть договор файлом?</b><span class="muted small">Загрузите — объект, номер, дату, цену, сроки и стороны программа заполнит сама.</span></div>';
        up.appendChild(btn('⇪ Загрузить договор', () => { closeDialog(); location.hash = '#/import'; }, 'btn-primary'));
        body.appendChild(up);
        body.appendChild(para('Или заполните вручную:', 'muted small'));
        body.appendChild(formGrid(w, [
          F('objectName', 'Наименование объекта', 'text', { wide: 1 }), F('address', 'Адрес объекта', 'text', { wide: 1 }),
          F('contractNo', 'Номер договора'), F('contractDate', 'Дата договора', 'date'),
          F('contractPrice', 'Цена договора, руб. с НДС', 'number')
        ]));
      } else if (step === 2) {
        body.appendChild(formGrid(w, [
          F('role', 'Кто вы на этом объекте', 'select', { wide: 1, rerender: 1, opts: () => [
            { v: C.ROLE.contractor, l: 'Подрядчик — договор напрямую с заказчиком' },
            { v: C.ROLE.genContractor, l: 'Генподрядчик — у вас есть субподрядчики' },
            { v: C.ROLE.subContractor, l: 'Субподрядчик — работаете у генподрядчика' }] }),
          F('ourName', 'Ваша организация (полное наименование)', 'text', { wide: 1, ph: 'ООО «…»' }), F('ourInn', 'ИНН'),
          F('custName', w.role === C.ROLE.subContractor ? 'Генподрядчик (наименование)' : 'Заказчик / застройщик (наименование)', 'text', { wide: 1 })
        ], f => { if (f.k === 'role') draw(); }));
        body.appendChild(para('Остальное (адреса, ОГРН, СРО, представители) — потом в «Участниках строительства» или загрузкой документов.', 'muted small'));
      } else {
        body.appendChild(para('<b>Объект заведён.</b> Дальше удобнее всего загружать документы — программа сама разложит их по разделам:', ''));
        const g = document.createElement('div'); g.className = 'wz-next';
        [['📐', 'Проект ПД / РД', 'шифры и листы для п. 2 актов', '#/import'], ['🧱', 'Сертификаты, паспорта, УПД', 'материалы и документы о качестве', '#/import'], ['💰', 'Смету', 'позиции для КС-2 и КС-3', '#/import'], ['📝', 'Первый акт', 'или загрузите чужую ИД', '#/acts?new']].forEach(([ic, t, s, href]) => {
          const a = document.createElement('a'); a.href = href; a.innerHTML = '<span class="ic">' + ic + '</span><b>' + esc(t) + '</b><span class="muted small">' + esc(s) + '</span>';
          a.addEventListener('click', () => closeDialog());
          g.appendChild(a);
        });
        body.appendChild(g);
      }
      const foot = [];
      if (step > 1 && step < 3) foot.push({ label: '← Назад', onClick: () => { step--; draw(); } });
      foot.push('spacer');
      if (step < 3) foot.push({ label: 'Пропустить мастер', onClick: closeDialog }, { label: step === 2 ? 'Готово →' : 'Далее →', cls: 'btn-primary', onClick: next });
      else foot.push({ label: 'Закрыть', cls: 'btn-primary', onClick: closeDialog });
      openDialog('Новый объект — шаг ' + step + ' из 3', body, foot);
    };
    const next = () => {
      if (step === 1) {
        ['objectName', 'address', 'contractNo', 'contractDate'].forEach(k => { if (C.s(w[k])) st[k] = C.s(w[k]); });
        if (C.s(w.contractPrice) !== '') st.contractPrice = C.num(w.contractPrice);
        touch(); updateHeader();
      }
      if (step === 2) {
        const add = (name, role, inn) => {
          if (!C.s(name)) return null;
          let key = keyOf(name) || name.slice(0, 30), n = 2;
          const ex = P.orgs.find(o => o.name === name.trim()); if (ex) return ex;
          while (P.orgs.some(o => o.key === key)) key = keyOf(name) + ' ' + n++;
          const o = { id: C.uid(), key, role, name: name.trim(), inn: C.s(inn) };
          P.orgs.push(o); return o;
        };
        const our = add(w.ourName, w.role, w.ourInn);
        add(w.custName, w.role === C.ROLE.subContractor ? C.ROLE.genContractor : C.ROLE.developer);
        if (our) P.settings.ourOrg = our.key;
        touch();
      }
      step++; draw();
      if (step === 3) render();
    };
    draw();
  }

  // ссылки на организацию по ключу
  function orgRefs(key) {
    if (!key) return '';
    const r = [];
    const np = P.people.filter(x => x.orgKey === key).length; if (np) r.push('представители (' + np + ')');
    const na = P.acts.filter(x => x.executor === key).length; if (na) r.push('акты как исполнитель (' + na + ')');
    if (P.settings.ourOrg === key) r.push('«наша организация»');
    if (P.ks.customerKey === key || P.ks.contractorKey === key) r.push('стороны КС');
    const nr = P.rdSections.filter(x => x.designerKey === key).length; if (nr) r.push('разделы РД (' + nr + ')');
    return r.join(', ');
  }
  function renameOrgKey(from, to) {
    P.people.forEach(x => { if (x.orgKey === from) x.orgKey = to; });
    P.acts.forEach(x => { if (x.executor === from) x.executor = to; });
    if (P.settings.ourOrg === from) P.settings.ourOrg = to;
    if (P.ks.customerKey === from) P.ks.customerKey = to;
    if (P.ks.contractorKey === from) P.ks.contractorKey = to;
    P.rdSections.forEach(x => { if (x.designerKey === from) x.designerKey = to; });
  }

  // ================= список записей =================
  function collection(el, schemaKey, getArr, opts) {
    opts = opts || {};
    const sc = SCHEMA[schemaKey];
    let q = '';
    const wrap = document.createElement('div');
    const tb = document.createElement('div'); tb.className = 'toolbar';
    tb.innerHTML = '<input type="search" placeholder="Поиск…"><button type="button" class="btn btn-primary" data-add>+ Добавить</button>';
    if (opts.noSearch) $('input', tb).remove();
    if (opts.addLabel) $('[data-add]', tb).textContent = opts.addLabel;
    // элементы слева от «+ Добавить» (подпись, кнопки), между ними — распорка
    if (opts.lead) tb.prepend(...opts.lead);
    (opts.tools || []).forEach(t => tb.appendChild(t));
    // фильтры-«пилюли» с количеством: [[подпись, условие], …]
    let flt = 0;
    const fbar = document.createElement('div'); fbar.className = 'filters';
    const drawFilters = () => {
      if (!opts.filters) return;
      const arr = getArr();
      fbar.innerHTML = '';
      opts.filters.forEach(([label, fn], i) => {
        const n = fn ? arr.filter(fn).length : arr.length;
        if (i && !n && i !== flt) return; // пустые фильтры не показываем
        const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (i === flt ? ' on' : '');
        c.innerHTML = esc(label) + '<span class="n">' + n + '</span>';
        c.addEventListener('click', () => { flt = i; draw(); });
        fbar.appendChild(c);
      });
    };
    // отмеченные строки — панель действий над ними
    const bulk = document.createElement('div'); bulk.className = 'bulk'; bulk.hidden = true;
    const drawBulk = () => {
      if (!opts.check || !opts.bulk) return;
      const sel = getArr().filter(it => it[opts.check.key]);
      bulk.hidden = !sel.length; bulk.innerHTML = '';
      if (!sel.length) return;
      bulk.insertAdjacentHTML('beforeend', '<b>' + esc(opts.bulkLabel || 'Отмечено') + ': ' + sel.length + '</b><span class="sp"></span>');
      opts.bulk(sel).forEach(b => bulk.appendChild(b));
      bulk.appendChild(btn('Снять отметки', () => { sel.forEach(it => { it[opts.check.key] = ''; }); touch(); draw(); opts.onCheck && opts.onCheck(); }, 'btn-sm'));
    };
    if (opts.filters) { const s = $('input[type=search]', tb); if (s) { s.classList.add('flt-search'); } tb.prepend(fbar); }
    const list = document.createElement('div'); list.className = 'list';
    wrap.append(tb, bulk, list);
    el.appendChild(wrap);
    const openRows = new Set(); // строки с раскрытым списком замечаний
    const draw = () => {
      const arr = getArr();
      list.innerHTML = '';
      drawFilters(); drawBulk();
      const ff = opts.filters && opts.filters[flt] && opts.filters[flt][1];
      let items = arr.filter(it => (!ff || ff(it)) && (!q || (sc.search ? sc.search(it) : JSON.stringify(it)).toLowerCase().includes(q)));
      if (opts.order) items = opts.order(items); // порядок показа (например, смета — по разделам договор / ДС)
      if (!items.length) { list.innerHTML = '<div class="empty">' + (arr.length ? 'Ничего не найдено' : 'Пока пусто. Нажмите «' + esc(opts.addLabel || '+ Добавить') + '».') + '</div>'; }
      let curSec = null;
      items.forEach(it => {
        // заголовок раздела перед первой строкой раздела
        if (opts.section) {
          const sec = opts.section(it);
          if (sec && sec !== curSec) { const h = document.createElement('div'); h.className = 'row sec-h'; h.textContent = sec; list.appendChild(h); }
          curSec = sec;
        }
        const r = sc.row(it);
        const compact = !!r.cols; // компактная строка: номер, название, статус; ниже — разбивка столбцами
        const row = document.createElement('div'); row.className = 'row' + (compact ? ' row-c' : (r.warn ? ' warn' : '')) + (r.cls ? ' ' + r.cls : '') + (openRows.has(it) ? ' open' : '');
        let html = '';
        const chk = opts.check ? '<label class="check" title="' + esc(opts.check.title) + '"><input type="checkbox" data-chk' + (it[opts.check.key] ? ' checked' : '') + '></label>' : '';
        if (compact) {
          const iss = r.issues || [];
          const red = iss.some(x => x.lvl === 'r');
          const st = iss.length ? '<button type="button" class="st ' + (red ? 'r' : 'w') + '" data-st title="Что не так — нажмите">' + (red ? '● ' : '⚠ ') + iss.length + '</button>' : (r.okLabel === false ? '' : '<span class="st ok">✓ ' + esc(r.okLabel || 'готов') + '</span>');
          html += '<div class="row-main"><div class="rc-top">' + chk + (r.no ? '<span class="rc-no">' + esc(r.no) + '</span>' : '') + '<span class="rc-nm" title="' + esc(r.title) + '">' + esc(r.title) + '</span>' +
            (r.tags || []).filter(Boolean).map(t => '<span class="rc-tag ' + (t.c || '') + '">' + esc(t.t) + '</span>').join('') + st + '</div>';
          html += '<div class="rc-cols' + (r.colsCls ? ' ' + r.colsCls : '') + '">' + r.cols.map(([lb, vl, cls]) => '<div><span class="lb">' + esc(lb) + '</span><span class="vl ' + (cls || '') + '" title="' + esc(vl) + '">' + esc(vl) + '</span></div>').join('') + '</div>';
          if (iss.length) html += '<div class="rc-iss">' + iss.map((x, i) => '<div class="iss"><span class="d ' + (x.lvl === 'r' ? 'r' : 'w') + '"></span><span class="t">' + esc(x.text) + '</span><button type="button" class="btn btn-sm" data-fix="' + i + '">' + esc(x.fix || 'Исправить') + '</button></div>').join('') + '</div>';
        } else {
          html += chk;
          if (r.num) html += '<div class="num">' + esc(r.num) + '</div>';
          html += '<div class="row-main"><div class="row-title">' + esc(r.title) + '</div>';
          if (r.sub) html += '<div class="row-sub">' + esc(r.sub) + '</div>';
        }
        const b = (r.badges || []).filter(Boolean);
        if (b.length) html += '<div style="margin-top:4px">' + b.map(x => '<span class="badge ' + (x.c || '') + '">' + esc(x.t) + '</span>').join('') + '</div>';
        // пометки с кнопками прямо в строке (например, непринятые изменения из доп. соглашения)
        (r.notes || []).forEach((nt, ni) => {
          html += '<div class="row-note"><span>' + esc(nt.text) + '</span>' + (nt.buttons || []).map((nb, bi) => '<button type="button" class="btn btn-sm ' + (nb.cls || '') + '" data-note="' + ni + ':' + bi + '">' + esc(nb.label) + '</button>').join('') + '</div>';
        });
        html += '</div><div class="row-actions">';
        (opts.rowButtons || []).forEach((rb, i) => { if (rb.show && !rb.show(it)) return; html +='<button type="button" class="icon-btn" data-rb="' + i + '" title="' + esc(rb.title) + '">' + rb.icon + '</button>'; });
        html += '<button type="button" class="icon-btn" data-a="copy" title="Копировать">&#10697;</button>' +
          '<button type="button" class="icon-btn" data-a="up" title="Выше">&#8593;</button>' +
          '<button type="button" class="icon-btn" data-a="down" title="Ниже">&#8595;</button></div>';
        row.innerHTML = html;
        // поля, которые правятся прямо в списке, без открытия карточки
        if (opts.inline) {
          const box = document.createElement('div'); box.className = 'row-inline';
          opts.inline.forEach(f => {
            const lab = document.createElement('label'); lab.className = 'inl inl-' + f.t + (f.cls ? ' ' + f.cls : '');
            lab.innerHTML = '<span>' + esc(f.l) + '</span>';
            let input;
            if (f.t === 'check') {
              // галочка в строке списка (например, «весь остаток» в смете)
              // как соседнее поле: подпись сверху, ниже — «поле» той же высоты с галочкой внутри
              lab.className = 'inl inl-s inl-check';
              lab.innerHTML = '<span>' + esc(f.l) + '</span><span class="inl-box"><input type="checkbox"' + (it[f.k] ? ' checked' : '') + '></span>';
              lab.querySelector('input').addEventListener('change', e => { it[f.k] = e.target.checked ? 1 : ''; touch(); opts.onInline && opts.onInline(it, f.k); });
              box.appendChild(lab); return;
            }
            if (f.t === 'combo') { const c = comboEl(f, it[f.k]); input = c.input; lab.appendChild(c.box); }
            else {
              input = document.createElement('input');
              input.type = f.t === 'number' ? 'text' : f.t === 'date' ? 'date' : 'text';
              if (f.t === 'number') input.inputMode = 'decimal';
              input.value = it[f.k] === undefined || it[f.k] === null ? '' : it[f.k];
              lab.appendChild(input);
            }
            if (f.ph) input.placeholder = f.ph;
            input.addEventListener('change', () => {
              let v = input.value.trim();
              if (f.t === 'number' && v !== '') { const n = +v.replace(/\s/g, '').replace(',', '.'); if (isFinite(n)) v = n; }
              it[f.k] = v; touch(); opts.onInline && opts.onInline(it, f.k);
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
            box.appendChild(lab);
          });
          $('.row-main', row).appendChild(box);
        }
        // свой блок в строке (например, разбивка позиции сметы с полем «В этой КС»)
        if (opts.extra) { const x = opts.extra(it); if (x) { x.classList.add('row-extra'); $('.row-main', row).appendChild(x); } }
        row.addEventListener('click', e => {
          if (e.target.closest('.row-inline, .row-extra')) return;
          const btn = e.target.closest('button');
          if (btn && btn.dataset.note) { const [ni, bi] = btn.dataset.note.split(':').map(Number); r.notes[ni].buttons[bi].onClick(); return; }
          if (e.target.closest('.row-note')) return;
          // статус: раскрыть / свернуть список замечаний
          if (btn && btn.dataset.st !== undefined) { openRows.has(it) ? openRows.delete(it) : openRows.add(it); row.classList.toggle('open'); return; }
          // «Исправить» у замечания: открыть карточку на нужном разделе
          if (btn && btn.dataset.fix !== undefined) {
            const x = r.issues[+btn.dataset.fix];
            if (x.onFix) x.onFix(); else openEditor(schemaKey, getArr(), it, false, () => { draw(); opts.after && opts.after(); }, { focus: x.sec });
            return;
          }
          if (e.target.closest('.rc-iss')) return;
          const chk = e.target.closest('[data-chk]');
          if (chk) { it[opts.check.key] = chk.checked ? 1 : ''; touch(); drawBulk(); opts.onCheck && opts.onCheck(); return; }
          if (e.target.closest('label.check')) return;
          const arr2 = getArr(); const i = arr2.indexOf(it);
          if (btn && btn.dataset.rb !== undefined) { opts.rowButtons[+btn.dataset.rb].onClick(it); return; }
          if (btn && btn.dataset.a === 'copy') {
            const cp = JSON.parse(JSON.stringify(it)); cp.id = C.uid(); if (opts.onCopy) opts.onCopy(cp);
            arr2.splice(i + 1, 0, cp); touch(); draw(); toast('Скопировано'); return;
          }
          if (btn && btn.dataset.a === 'up') { if (i > 0) { [arr2[i - 1], arr2[i]] = [arr2[i], arr2[i - 1]]; touch(); draw(); } return; }
          if (btn && btn.dataset.a === 'down') { if (i < arr2.length - 1) { [arr2[i + 1], arr2[i]] = [arr2[i], arr2[i + 1]]; touch(); draw(); } return; }
          openEditor(schemaKey, arr2, it, false, () => { draw(); opts.after && opts.after(); });
        });
        list.appendChild(row);
      });
      opts.after && opts.after();
    };
    $('input[type=search]', tb) && $('input[type=search]', tb).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
    $('[data-add]', tb).addEventListener('click', () => {
      const it = Object.assign({ id: C.uid() }, opts.defaults ? opts.defaults() : {});
      openEditor(schemaKey, getArr(), it, true, draw);
    });
    draw();
    return { draw };
  }

  // ================= экраны =================
  const main = $('#main');
  function head(title, sub, actions) {
    const h = document.createElement('div'); h.className = 'page-head';
    h.innerHTML = '<div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="muted">' + esc(sub) + '</p>' : '') + '</div><div class="actions"></div>';
    (actions || []).forEach(a => $('.actions', h).appendChild(a));
    return h;
  }
  function btn(label, onClick, cls) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = label;
    b.addEventListener('click', onClick); return b;
  }
  function card(title, children) {
    const c = document.createElement('div'); c.className = 'card';
    if (title) { const h = document.createElement('h2'); h.textContent = title; h.style.marginBottom = '12px'; c.appendChild(h); }
    (children || []).forEach(ch => ch && c.appendChild(ch));
    return c;
  }
  // вкладки раздела: [[адрес, подпись, число?], …] — каждая вкладка ведёт на свой экран
  function subTabs(items, active) {
    const t = document.createElement('div'); t.className = 'subtabs';
    items.forEach(([href, label, n]) => {
      const a = document.createElement('a'); a.href = href; a.className = href === active ? 'on' : '';
      a.innerHTML = esc(label) + (n !== undefined && n !== '' ? ' <span class="n">' + esc(String(n)) + '</span>' : '');
      t.appendChild(a);
    });
    return t;
  }
  function para(html, cls) { const p = document.createElement('p'); p.className = cls || 'muted small'; p.innerHTML = html; return p; }

  const VIEWS = {
    // ===== обзор объекта: готовность по шагам, что сделать дальше, цифры =====
    home() {
      const st = P.settings, today = C.todayISO();
      const chk = C.projectCheck(P);
      const actsAll = P.acts.filter(a => a.type);
      const actBad = a => (a.imported && !a.importDone && C.importIssues(P, a).length) || C.actView(P, a).warnings.length;
      const badActs = actsAll.filter(actBad);
      const bal = C.materialBalance(P);
      const expired = bal.filter(x => C.matExpired(x.m, today) && (x.rest === null || x.rest > 0));
      const cp = C.contractPriceNow(P), smGross = C.smetaTotals(P).gross;
      const doneGross = C.vatSplit(P, C.ksDoneBefore(P)).gross;
      const cand = P.candidates || [];
      const pw = C.partyWarnings(P);
      const pdNoRd = chk.filter(x => x.where === '#/rd');
      // шапка
      const h = document.createElement('div'); h.className = 'home-hero';
      h.innerHTML = '<div><h1>' + esc(projTitle(P)) + '</h1><div class="muted">' + esc([st.contractNo ? 'Договор № ' + st.contractNo + (st.contractDate ? ' от ' + C.fmtDate(st.contractDate) : '') : 'договор не заполнен', C.builderOrg(P) ? 'Подрядчик ' + C.builderOrg(P).name : '', C.workDates(P).end ? 'срок до ' + C.fmtDate(C.workDates(P).end) : ''].filter(Boolean).join(' · ')) + '</div></div><div class="sp"></div>';
      const q = document.createElement('div'); q.className = 'home-quick';
      q.append(btn('⇪ Загрузить документ', () => { location.hash = '#/import'; }, 'btn-primary'), btn('+ Новый акт', () => { location.hash = '#/acts?new'; }), btn('Текущая КС', () => { location.hash = '#/smeta'; }));
      h.appendChild(q); main.appendChild(h);
      // пустой проект — предложить мастер нового объекта
      if (!st.objectName && !st.contractNo && !P.orgs.length && !P.acts.length) {
        const wz = document.createElement('div'); wz.className = 'card wz-offer';
        wz.innerHTML = '<div><b>Новый объект?</b><span class="muted small">Три коротких шага: объект и договор, ваша организация, что загрузить дальше.</span></div>';
        wz.appendChild(btn('Начать мастер', () => newObjectWizard(), 'btn-primary'));
        main.appendChild(wz);
      }
      // готовность по шагам
      const step = (n, title, href, cls, text, pct) => '<a class="hstep ' + cls + '" href="' + href + '"><span class="n">' + n + '</span><span class="t">' + esc(title) + '</span><span class="s">' + esc(text) + '</span><span class="bar"><i style="width:' + Math.max(4, Math.min(100, pct)) + '%"></i></span></a>';
      const contractOk = st.objectName && st.contractNo && st.contractDate;
      const partiesOk = C.customerOrg(P) && C.builderOrg(P) && P.people.length && !pw.length;
      const rdCnt = (P.rdSections || []).length;
      const matCnt = P.materials.filter(m => m.name).length;
      const okActs = actsAll.length - badActs.length;
      const ksNo = P.ks.number || '—';
      const steps = document.createElement('div'); steps.className = 'card home-steps';
      steps.innerHTML =
        step(1, 'Договор', '#/settings', contractOk ? 'ok' : 'warn', contractOk ? '✓ ' + ['цена', C.workDates(P).end ? 'сроки' : '', P.supplements.length ? P.supplements.length + ' ДС' : ''].filter(Boolean).join(', ') : '⚠ заполните реквизиты', contractOk ? 100 : 40) +
        step(2, 'Участники', '#/orgs', partiesOk ? 'ok' : 'warn', (partiesOk ? '✓ ' : '⚠ ') + P.orgs.length + ' орг., ' + P.people.length + ' предст.' + (cand.length ? ' · найдено ' + cand.length : ''), partiesOk ? 100 : 50) +
        step(3, 'Проект ПД / РД', '#/rd', rdCnt && !pdNoRd.length ? 'ok' : 'warn', rdCnt ? (pdNoRd.length ? '⚠ ' + pdNoRd.length + ' без РД' : '✓ разделов: ' + rdCnt) : '⚠ не загружен', rdCnt ? (pdNoRd.length ? 70 : 100) : 10) +
        step(4, 'Материалы', '#/materials', expired.length ? 'warn' : (matCnt ? 'ok' : 'todo'), expired.length ? '⚠ истёк документ: ' + expired.length : (matCnt ? '✓ ' + matCnt + ' шт.' : 'пока нет'), matCnt ? (expired.length ? 80 : 100) : 5) +
        step(5, 'Акты', '#/acts', actsAll.length && !badActs.length ? 'ok' : 'todo', actsAll.length ? okActs + ' из ' + actsAll.length + ' готовы' : 'пока нет', actsAll.length ? okActs / actsAll.length * 100 : 5) +
        step(6, 'КС', '#/smeta', 'todo', P.smeta.some(r => r.name) ? 'КС № ' + ksNo + (P.ksHistory.length ? ' · закрыто ' + P.ksHistory.length : '') : 'сметы нет', cp.total ? doneGross / cp.total * 100 : 5);
      main.appendChild(steps);
      // что сделать дальше — самое важное по порядку
      const todo = [];
      expired.slice(0, 2).forEach(x => todo.push(['r', 'Истёк документ о качестве: «' + C.matName(x.m) + '»', 'действовал до ' + C.fmtDate(C.matUntil(x.m)) + ', материал ещё на объекте — загрузите новый документ', '#/materials', 'Исправить']));
      // (истёкшие документы уже показаны выше — их повтор из проверки акта не берём)
      chk.filter(x => x.lvl === 'err' && !(expired.length && /истёк документ/i.test(x.text))).slice(0, 3).forEach(x => todo.push(['r', x.text, '', x.where, 'Исправить']));
      if (badActs.length) todo.push(['y', 'Актов требуют правки: ' + badActs.length, 'откройте «Акты освидетельствования» → фильтр «исправить»', '#/acts', 'Открыть']);
      pdNoRd.slice(0, 2).forEach(x => todo.push(['y', x.text, '', '#/import', 'Загрузить']));
      if (cand.length) todo.push(['b', 'Принять из документов: ' + cand.filter(c => c.kind === 'org').length + ' организ., ' + cand.filter(c => c.kind === 'person').length + ' представ.', 'нашлись в загруженных документах, ещё не заведены', cand.some(c => c.kind === 'org') ? '#/orgs' : '#/people', 'Посмотреть']);
      chk.filter(x => x.lvl === 'warn' && x.where !== '#/rd').slice(0, Math.max(0, 5 - todo.length)).forEach(x => todo.push(['y', x.text, '', x.where, 'Открыть']));
      const two = document.createElement('div'); two.className = 'home-two';
      const left = document.createElement('div');
      left.innerHTML = '<h2 class="home-h">Что сделать дальше</h2>';
      if (!todo.length) left.appendChild(para('✓ Срочных дел нет. Загрузите следующий документ или оформите новый акт.', 'muted'));
      todo.slice(0, 6).forEach(([c, t, s, href, b]) => {
        const r = document.createElement('div'); r.className = 'home-nx';
        r.innerHTML = '<span class="ic ' + c + '">' + (c === 'r' ? '!' : c === 'y' ? '⚠' : 'i') + '</span><span class="tx"><b>' + esc(t) + '</b>' + (s ? '<span>' + esc(s) + '</span>' : '') + '</span>';
        r.appendChild(btn(b, () => { location.hash = href; }, 'btn-sm' + (c === 'r' ? ' btn-primary' : '')));
        left.appendChild(r);
      });
      // цифры
      const right = document.createElement('div');
      right.innerHTML = '<h2 class="home-h">Объект в цифрах</h2>';
      const k = document.createElement('div'); k.className = 'kpi';
      const match = cp.total && smGross ? (Math.abs(cp.total - smGross) < 0.01 ? '<span class="kpi-ok">✓ совпадает со сметой</span>' : '<span class="kpi-warn">≠ смета ' + (smGross > cp.total ? 'больше' : 'меньше') + ' на ' + C.money(Math.abs(smGross - cp.total)) + '</span>') : '';
      k.innerHTML = '<div><span class="muted small">Цена договора' + (cp.hasDs ? ' с ДС' : '') + '</span><b>' + C.money(cp.total || smGross) + '</b>' + match + '</div>' +
        '<div><span class="muted small">Выполнено (закрытые КС)</span><b>' + C.money(doneGross) + '</b><span class="muted small">' + (cp.total ? Math.round(doneGross / cp.total * 100) + ' %' : '') + '</span></div>' +
        '<div><span class="muted small">Актов</span><b>' + actsAll.length + '</b>' + (badActs.length ? '<span class="kpi-warn">' + badActs.length + ' требуют правки</span>' : '') + '</div>' +
        '<div><span class="muted small">Материалов</span><b>' + matCnt + '</b>' + (expired.length ? '<span class="kpi-warn">истёк документ: ' + expired.length + '</span>' : '') + '</div>';
      const kc = card(null, [k]); kc.style.padding = '12px'; right.appendChild(kc);
      // последние акты — быстрый переход
      const last = actsAll.slice().sort((a, b) => (C.actView(P, b).date || '').localeCompare(C.actView(P, a).date || '')).slice(0, 5);
      if (last.length) {
        right.insertAdjacentHTML('beforeend', '<h2 class="home-h" style="margin-top:14px">Последние акты</h2>');
        const ul = document.createElement('div'); ul.className = 'card home-feed';
        last.forEach(a => { const v = C.actView(P, a); const r = document.createElement('a'); r.href = '#/acts'; r.innerHTML = '<span class="d">' + esc(C.fmtDate(v.date)) + '</span><span>' + esc(a.type + ' № ' + v.number + ' — ' + v.name) + '</span>'; ul.appendChild(r); });
        right.appendChild(ul);
      }
      two.append(left, right); main.appendChild(two);
    },
    settings() {
      main.appendChild(head('Договор и доп. соглашения', '', [btn('⇪ Загрузить договор или ДС', () => { location.hash = '#/import'; })]));
      const st = P.settings;
      // сводка: цена по договору, изменения по ДС, цена с ДС (сверка со сметой), срок работ
      const priceBox = document.createElement('div'); priceBox.className = 'kpi';
      const updPrice = () => {
        const cp = C.contractPriceNow(P), sm = C.smetaTotals(P).gross, wd = C.workDates(P);
        const delta = C.round2(cp.total - cp.base);
        const match = !cp.total || !sm ? '' : Math.abs(cp.total - sm) < 0.01 ? '<span class="kpi-ok">✓ совпадает со сметой</span>' : '<span class="kpi-warn">⚠ смета ' + (sm > cp.total ? 'больше' : 'меньше') + ' на ' + C.money(Math.abs(sm - cp.total)) + '</span>';
        priceBox.innerHTML = '<div><span class="muted small">Цена по договору</span><b>' + (cp.base ? C.money(cp.base) : '—') + '</b></div>' +
          (cp.hasDs ? '<div><span class="muted small">Изменения по ДС (' + cp.steps.length + ')</span><b>' + (delta >= 0 ? '+' : '−') + C.money(Math.abs(delta)) + '</b></div>' +
            '<div><span class="muted small">Цена с учётом ДС</span><b>' + C.money(cp.total) + '</b>' + match + '</div>' : (match ? '<div><span class="muted small">Смета</span><b>' + C.money(sm) + '</b>' + match + '</div>' : '')) +
          '<div><span class="muted small">Срок работ' + (cp.hasDs ? ' с учётом ДС' : '') + '</span><b>' + esc(wd.start || wd.end ? (C.fmtDate(wd.start) || '…') + ' – ' + (C.fmtDate(wd.end) || '…') : '—') + '</b></div>';
      };
      const kc = card(null, [priceBox]); kc.style.padding = '12px'; main.appendChild(kc);
      updPrice();
      const tabs = pageTabs([['t1', 'Договор'], ['t2', 'Доп. соглашения' + (P.supplements.length ? ' (' + P.supplements.length + ')' : '')], ['t3', 'Для общего журнала'], ['t4', 'Настройки']], settingsTab, k => { settingsTab = k; });
      main.appendChild(tabs.bar);
      Object.values(tabs.panes).forEach(x => main.appendChild(x));
      tabs.panes.t1.appendChild(card(null, [formGrid(st, [
        F('objectName', 'Наименование объекта (как в проекте)', 'text', { wide: 1 }),
        F('address', 'Адрес объекта', 'textarea', { wide: 1 }),
        F('contractNo', 'Номер договора подряда'), F('contractDate', 'Дата договора', 'date'),
        F('contractPrice', 'Цена договора, руб. с НДС', 'number', { help: 'Для КС-2 («договорная стоимость») и проверки: КС не больше цены договора. Пусто — по смете. Изменения цены по доп. соглашениям — во вкладке «Доп. соглашения».' }),
        F('projectCode', 'Шифр проекта (общий)', 'text', { help: 'Используется, если у раздела в «Проектной и рабочей документации» нет своего шифра.' })
      ], () => { updateHeader(); updPrice(); })]));
      // дополнительные соглашения: меняют цену, сроки, добавляют или исключают позиции сметы
      const dsCard = card(null, [para('Каждое ДС — отдельной строкой: на сколько меняется цена договора (или новая цена) и сроки. Дополнительные работы добавьте в «Смету» с основанием «ДС № …», исключённые — отметьте «Исключена из договора». ДС можно загрузить файлом через «Загрузку документов».')]);
      tabs.panes.t2.appendChild(dsCard);
      collection(dsCard, 'supplements', () => P.supplements, { noSearch: true, addLabel: '+ Доп. соглашение', after: updPrice });
      tabs.panes.t4.appendChild(card(null, [formGrid(st, [
        F('shortName', 'Короткое имя проекта', 'text', { help: 'Для списка проектов и шапки приложения: ВИТ, ТурбоТехМаш… В документы не попадает.' }),
        F('vat', 'Ставка НДС (0,22 = 22%)', 'number'),
        F('copies', 'Экземпляров акта по умолчанию', 'number'),
        F('projectDocName', 'Наименование проектной / рабочей документации', 'text', { wide: 1, help: 'В актах дополняется «разработчик …» по проектировщику.' })
      ], () => { updateHeader(); updPrice(); })]));
      tabs.panes.t3.appendChild(card(null, [formGrid(st, [
        F('workKind', 'Вид работ', 'combo', { opts: () => ['строительство', 'реконструкция', 'капитальный ремонт'] }),
        F('permit', 'Разрешение на строительство', 'textarea', { wide: 1, show: o => !o.permitNone }),
        F('permitNone', 'Разрешение на строительство не требуется (ст. 51 ГрК РФ) — в ОЖР будет «Не требуется»', 'check', { wide: 1, rerender: 1 }),
        F('expertise', 'Заключение экспертизы', 'textarea', { wide: 1, show: o => !o.expertiseNone }),
        F('expertiseNone', 'Экспертиза проектной документации не проводится (ст. 49 ГрК РФ) — в ОЖР будет «Не требуется»', 'check', { wide: 1, rerender: 1 }),
        F('startDate', 'Начало работ', 'date'), F('endDate', 'Окончание работ', 'date'),
        F('posMonths', 'Продолжительность строительства по ПОС, мес.', 'number', { hint: 'Заполняется при загрузке ПОС. Проверка комплекта сверит с ней сроки и даты актов' }),
        F('posPrep', 'В т. ч. подготовительный период, мес.', 'number'),
        F('objectInfo', 'Краткие характеристики объекта', 'textarea', { wide: 1 })
      ], f => { if (f.k === 'permitNone' || f.k === 'expertiseNone') render(); })]));
    },
    orgs() {
      const sc = SCHEMA.orgs;
      main.appendChild(head('Участники строительства', sc.intro));
      main.appendChild(subTabs([['#/orgs', 'Организации', P.orgs.length], ['#/people', 'Представители', P.people.length]], '#/orgs'));
      // «наша организация» и проверка состава участников
      const top = document.createElement('div');
      main.appendChild(top);
      const drawTop = () => {
        top.innerHTML = '';
        const w = C.partyWarnings(P);
        if (w.length) { const n = document.createElement('div'); n.className = 'notice'; n.innerHTML = '<b>Проверьте участников:</b><ul>' + w.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'; top.appendChild(n); }
        const P2 = C.parties(P);
        const summary = para('В шапках актов сейчас: застройщик — <b>' + esc(P2.customer ? P2.customer.key : 'не задан') + '</b>, лицо, осуществляющее строительство — <b>' + esc(P2.builder ? P2.builder.key : 'не задано') + '</b>, проектировщик — <b>' + esc(P2.designer ? P2.designer.key : 'не задан') + '</b>.');
        top.appendChild(card(null, [formGrid(P.settings, [
          F('ourOrg', 'Наша организация', 'select', { opts: orgKeys, empty: '— не выбрана —', hint: 'От её имени ведётся документация: она подставляется исполнителем в новые акты (если она субподрядчик) и в шапку ЖВК' })
        ], () => { drawTop(); ctl.draw(); }), summary]));
      };
      const cand = document.createElement('div'); main.appendChild(cand);
      const ctl = collection(main, 'orgs', () => P.orgs, {
        after: () => drawTop(),
        onCopy: cp => { let k = cp.key + ' (копия)', n = 2; while (P.orgs.some(o => o.key === k)) k = cp.key + ' (копия ' + n++ + ')'; cp.key = k; }
      });
      candidatesPanel(cand, 'org', () => ctl.draw());
    },
    people() {
      const sc = SCHEMA.people;
      const others = Object.values(store.projects).filter(p => p.id !== P.id && p.people.length);
      main.appendChild(head('Участники строительства', sc.intro, others.length ? [btn('Взять из другого проекта…', () => peopleFromProject(others, () => ctl.draw()))] : []));
      main.appendChild(subTabs([['#/orgs', 'Организации', P.orgs.length], ['#/people', 'Представители', P.people.length]], '#/people'));
      const cand = document.createElement('div'); main.appendChild(cand);
      const ctl = collection(main, 'people', () => P.people, { defaults: () => ({}) });
      candidatesPanel(cand, 'person', () => ctl.draw());
    },
    materials() {
      const sc = SCHEMA.materials;
      main.appendChild(head(sc.title, '', [
        fmtSwitch(),
        ddBtn('ЖВК / ведомость ▾', [
          ['Журнал входного контроля (ЖВК)', () => makeDoc('ЖВК', () => IDPdf.jvkDoc(P))],
          ['Ведомость материалов (остатки)', () => makeDoc('Ведомость материалов', () => IDPdf.balanceDoc(P))]
        ], 'btn-primary')
      ]));
      main.appendChild(subTabs([['#/materials', 'Материалы и документы', P.materials.length], ['#/balance', 'Движение материалов']], '#/materials'));
      const today = C.todayISO();
      collection(main, 'materials', () => P.materials, {
        addLabel: '+ Материал',
        filters: [['Все', null], ['Документ истёк / истекает', m => C.matExpired(m, today) || matSoon(m)], ['Без документа', m => !C.matDocs(m)], ['Не использованы в актах', m => !P.acts.some(a => (a.materials || []).includes(m.id))]]
      });
    },
    works() {
      const sc = SCHEMA.works;
      main.appendChild(head('Справочник видов работ', sc.intro));
      collection(main, 'works', () => P.works);
    },
    // проектная и рабочая документация: разделы, шифры, листы (п. 2 актов)
    rd() {
      main.appendChild(head('Проектная и рабочая документация', 'Шифр и наименование раздела попадают в п. 2 актов. Акт берёт шифр по своему разделу; если раздел не заведён — общий шифр из «Договора»' + (P.settings.projectCode ? ' (' + P.settings.projectCode + ')' : '') + '.',
        [btn('⇪ Загрузить ПД / РД', () => { location.hash = '#/import'; }, 'btn-primary')]));
      const c = card(null, [para('Разделы ПД и РД с перечнем листов заводятся сами при загрузке PDF проекта (по штампам, ведомости рабочих чертежей, «Составу проектной документации»). Если у раздела есть и ПД, и РД, акт берёт шифр РД.')]);
      main.appendChild(c);
      collection(c, 'rdSections', () => P.rdSections, {
        noSearch: true,
        // новый раздел — сразу в список разделов, чтобы выбирался в видах работ и актах
        after: () => { P.rdSections.forEach(r => { if (r.section && !P.lists.sections.includes(r.section)) P.lists.sections.push(r.section); }); updateNavCounts(); }
      });
    },
    // исполнительные схемы — отдельным разделом (в карточке акта отмечаются галочками)
    schemes() {
      main.appendChild(head('Исполнительные схемы', 'Схемы отмечаются в карточке акта галочками и попадают в п. 4 АОСР (п. 5а АООК), если там ничего не вписано вручную. При загрузке чужой ИД схемы из реестра заводятся сюда сами.'));
      collection(main, 'schemes', () => P.schemes, { noSearch: P.schemes.length < 8 });
    },
    acts() {
      const marked = () => P.acts.filter(a => a.print && a.type);
      main.appendChild(head('Акты освидетельствования', '', [
        fmtSwitch(),
        ddBtn('Сформировать ▾', () => [
          ['Отмеченные акты' + (marked().length ? ' (' + marked().length + ')' : ' — все') + '…', () => batchActs()],
          ['Уведомление о вызове по отмеченным', () => { const l = marked(); if (!l.length) toast('Отметьте акты галочкой слева'); else makeNotice(l); }],
          ['Реестр ИД', () => makeDoc('Реестр ИД', () => IDPdf.registryDoc(P))]
        ], 'btn-primary')
      ]));
      const impActs = P.acts.filter(a => a.imported && !a.importDone);
      const rem = reminders(); if (rem) main.appendChild(rem);
      // настройки печати — свёрнуто, чтобы не мешали списку
      const opt = document.createElement('details'); opt.className = 'opts small';
      opt.innerHTML = '<summary>Настройки печати актов</summary>';
      const fit = document.createElement('label'); fit.className = 'check small'; fit.style.display = 'flex';
      fit.innerHTML = '<input type="checkbox"' + (P.settings.fitActs !== false ? ' checked' : '') + '> Умещать акт на один лист, если он чуть-чуть не помещается (шрифт уменьшится, но не меньше 78 %)';
      fit.querySelector('input').addEventListener('change', e => { P.settings.fitActs = e.target.checked; touch(); });
      const reg = document.createElement('label'); reg.className = 'check small'; reg.style.display = 'flex';
      reg.innerHTML = '<input type="checkbox"' + (P.settings.matRegistry !== false ? ' checked' : '') + '> Больше 5 документов о качестве — в п. 3 АОСР (п. 4 АООК) ссылка на реестр, реестр — отдельным листом приложения к акту';
      reg.querySelector('input').addEventListener('change', e => { P.settings.matRegistry = e.target.checked; touch(); });
      opt.append(fit, reg);
      main.appendChild(opt);
      const bad = a => actIssues(a).length > 0;
      const ctl = collection(main, 'acts', () => P.acts, {
        addLabel: '+ Новый акт',
        check: { key: 'print', title: 'Отметить — для печати, уведомления, общей правки' },
        bulkLabel: 'Отмечено',
        bulk: sel => {
          const imp = sel.filter(a => a.imported && !a.importDone);
          return [btn('Выгрузить…', () => batchActs(), 'btn-sm btn-primary'), btn('Уведомление', () => makeNotice(sel.filter(a => a.type)), 'btn-sm')]
            .concat(imp.length ? [btn('Исправить сразу (' + imp.length + ')…', () => batchFixImported(imp, () => render()), 'btn-sm')] : []);
        },
        filters: [['Все', null], ['Требуют правки', bad], ['Готовы', a => !bad(a)], ['Чужая ИД', a => !!a.imported], ['Отмечены', a => !!a.print]],
        tools: [btn('Отметить все', () => { const all = P.acts.every(a => a.print); P.acts.forEach(a => a.print = all ? '' : 1); touch(); ctl.draw(); })]
          .concat(impActs.length ? [btn('Чужие акты — исправить сразу (' + impActs.length + ')…', () => batchFixImported(impActs, () => render()))] : []),
        rowButtons: [{ icon: '&#128462;', title: 'PDF этого акта', onClick: a => makeAct(a) },
          { icon: '&#9993;', title: 'Уведомление о вызове на освидетельствование по этому акту', onClick: a => makeNotice([a]) },
          { icon: '&#10549;', title: 'Следующий акт: копия, даты — сразу после этого акта', onClick: a => nextAct(a, () => ctl.draw()) }],
        onCopy: cp => { cp.manualNo = ''; cp.print = ''; cp.printedNo = ''; },
        defaults: () => {
          const last = P.acts[P.acts.length - 1];
          const d = last ? { type: last.type, section: last.section, start: last.end || '', end: last.end || '' } : { type: 'АОСР' };
          // если мы — субподрядчик, работы в новых актах выполняем мы
          const our = C.orgByKey(P, P.settings.ourOrg);
          if (our && our.role === C.ROLE.subContractor) d.executor = our.key;
          return d;
        }
      });
      // «+ Новый акт» с главной страницы: сразу открыть карточку нового акта
      if (/[?&]new\b/.test(location.hash)) { history.replaceState(null, '', '#/acts'); setTimeout(() => { const b = main.querySelector('[data-add]'); if (b) b.click(); }, 0); }
    },
    smeta() {
      const ksName = k => k + ' № ' + (P.ks.number || '—');
      main.appendChild(head('Смета, КС-2, КС-3', '', [
        fmtSwitch(),
        ddBtn('Сформировать ▾', () => [
          ['Смета', () => makeDoc('Смета', () => IDPdf.smetaDoc(P))],
          [esc(ksName('КС-2')), () => makeDoc('КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P))],
          [esc(ksName('КС-3')), () => makeDoc('КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P))],
          ['<b>Все три (ZIP)</b>', () => makeZip('КС', [['Смета', () => IDPdf.smetaDoc(P)], ['КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P)], ['КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P)]])]
        ], 'btn-primary')
      ]));
      // ===== сводка: плашки =====
      const kpi = document.createElement('div'); kpi.className = 'kpi';
      const tile = (label, val, note) => '<div><span class="muted small">' + label + '</span><b>' + val + '</b>' + (note || '') + '</div>';
      const updKpi = () => {
        // все суммы в сводке — с НДС (цена договора тоже с НДС)
        const t = C.smetaTotals(P), k = C.ksTotals(P), before = C.vatSplit(P, C.ksDoneBefore(P)).gross;
        const cp = C.contractPriceNow(P), price = cp.total, diff = C.round2(price - t.gross);
        const match = !price ? '<span class="kpi-warn">не указана — <a href="#/settings">указать</a>; остаток считается от сметы</span>'
          : Math.abs(diff) < 0.01 ? '<span class="kpi-ok">✓ совпадает со сметой</span>'
            : '<span class="kpi-warn">⚠ смета ' + (diff > 0 ? 'меньше' : 'больше') + ' на ' + C.money(Math.abs(diff)) + '</span>';
        kpi.innerHTML = tile('Цена договора' + (cp.hasDs ? ' с учётом ДС' : ''), price ? C.money(price) : '—', match) +
          tile('Смета с НДС' + (t.top ? ' (без НДС ' + C.money(t.net) + ')' : ''), C.money(t.gross)) +
          tile((t.top ? 'НДС ' : 'в т.ч. НДС ') + t.vatPct + '%', C.money(t.vatSum)) +
          tile(esc(ksName('КС')) + (C.ksPeriodMode(P) ? ' (объёмы за период)' : P.ksHistory.length ? ' (остаток сметы)' : ' (вся смета)') + ', с НДС', k.gross || !P.ksHistory.length ? C.money(k.gross) : '—', !k.gross && P.ksHistory.length ? '<span class="kpi-ok">✓ вся смета закрыта</span>' : '') +
          (P.ksHistory.length ? tile('Закрыто КС: ' + P.ksHistory.length, C.money(before)) : '') +
          tile('Остаток по договору', C.money((price || t.gross) - before - k.gross));
      };
      main.appendChild(card(null, [kpi]));
      // ===== вкладки =====
      const tabs = pageTabs([['t1', 'Смета и текущая КС'], ['t2', 'История КС' + (P.ksHistory.length ? ' (' + P.ksHistory.length + ')' : '')], ['t3', 'Настройки КС']], smetaTab, k => { smetaTab = k; });
      main.appendChild(tabs.bar);
      Object.values(tabs.panes).forEach(x => main.appendChild(x));
      const c = tabs.panes.t1;
      // все непринятые изменения из ДС — одной кнопкой
      const pendBar = document.createElement('div'); c.appendChild(pendBar);
      const drawPend = () => {
        const list = []; P.smeta.forEach(r => pendingOf(r).forEach(x => list.push([r, x])));
        pendBar.innerHTML = '';
        if (!list.length) return;
        const box = document.createElement('div'); box.className = 'row-note row-note-bar';
        box.innerHTML = '<span><b>Изменения из доп. соглашений, не принятые: ' + list.length + '.</b> Они показаны у позиций ниже — примите или отклоните каждое, или все сразу.</span>';
        box.appendChild(btn('Применить все', () => confirmBox('Применить все изменения из ДС (' + list.length + ')? Отменить каждое можно потом кнопкой ↶ у позиции.', 'Применить', () => {
          list.forEach(([r, x]) => applyPending(r, x)); touch(); smetaRedraw(); toast('Применено изменений: ' + list.length);
        }), 'btn-sm btn-primary'));
        box.appendChild(btn('Отклонить все', () => confirmBox('Отклонить все непринятые изменения из ДС (' + list.length + ')?', 'Отклонить', () => {
          list.forEach(([r, x]) => dropPending(r, x)); touch(); smetaRedraw();
        }), 'btn-sm'));
        pendBar.appendChild(box);
      };
      // остаток позиции: по смете минус закрытые КС
      const restOf = x => Math.max(0, Math.round((C.num(x.qty) - C.qtyDoneBefore(P, x.id)) * 1e6) / 1e6);
      const hasNow = x => x.qtyNow !== undefined && x.qtyNow !== null && String(x.qtyNow) !== '';
      const isExcl = x => !!(x.excludedBy && C.dsById(P, x.excludedBy));
      // над списком: номер и период КС, подсказка, кнопки «всё во все» / «очистить»
      const ksLbl = document.createElement('div'); ksLbl.className = 'ks-lbl';
      const drawKsLbl = () => {
        const k = P.ks;
        ksLbl.innerHTML = '<b>' + esc(ksName('КС')) + '</b> <span class="muted small">' + (k.periodFrom || k.periodTo ? 'за период ' + esc(C.fmtDate(k.periodFrom) || '…') + ' – ' + esc(C.fmtDate(k.periodTo) || '…') : 'период не указан — «Настройки КС»') + '</span>';
        ksLbl.appendChild(helpTip('В поле «В этой КС» вписывайте объём, выполненный за этот отчётный период: КС-2 и КС-3 соберутся только по заполненным позициям. Если везде пусто — на всю смету. «всё» (или нажатие на число в «Осталось») — весь остаток позиции. ' +
          (C.vatTop(P) ? 'Цены в смете — без НДС, НДС начисляется сверху.' : 'Цены в смете — с НДС, как в договоре.') + ' Переключить — во вкладке «Настройки КС».'));
      };
      const sp = document.createElement('div'); sp.style.flex = '1';
      const allBtn = btn('Всё во все позиции', () => {
        const rows = C.smetaOrdered(P).filter(x => restOf(x) > 0);
        if (!rows.length) { toast('Остатков нет — вся смета уже закрыта по КС'); return; }
        undoable('В эту КС — весь остаток по ' + rows.length + ' поз.', () => { rows.forEach(x => { x.allNow = 1; x.qtyNow = restOf(x); }); touch(); smetaCtl.draw(); });
      }, 'btn-sm');
      allBtn.title = 'В эту КС сразу весь невыполненный объём сметы (например, последняя КС по объекту)';
      const clrBtn = btn('Очистить', () => {
        const rows = P.smeta.filter(hasNow);
        if (!rows.length) { toast('Поля «В этой КС» и так пустые'); return; }
        undoable('«В этой КС» очищено у ' + rows.length + ' поз.', () => { rows.forEach(x => { x.qtyNow = ''; x.allNow = ''; }); touch(); smetaCtl.draw(); });
      }, 'btn-sm');
      // итоги текущей КС — справа, как в КС-3
      const ksTotal = document.createElement('div'); ksTotal.className = 'ks-total';
      const drawKsTotal = () => {
        const k = C.ksTotals(P), pm = C.ksPeriodMode(P);
        ksTotal.innerHTML = (pm ? '' : '<p class="muted small">Объёмы «В этой КС» не заполнены — КС-2 и КС-3 будут на всю смету.</p>') +
          '<table><tr><td>Итого по ' + esc(ksName('КС')) + ' (без НДС)</td><td class="v">' + C.money(k.net) + '</td></tr>' +
          '<tr><td>Сумма НДС ' + k.vatPct + '%</td><td class="v">' + C.money(k.vatSum) + '</td></tr>' +
          '<tr><td>Всего с учетом НДС</td><td class="v">' + C.money(k.gross) + '</td></tr></table>';
      };
      const updAll = () => { updKpi(); drawKsLbl(); drawKsTotal(); };
      // разбивка позиции: По смете / Было ранее / Осталось / В этой КС / Сумма
      const posGrid = r => {
        if (!r.name || isExcl(r)) return null;
        const before = C.qtyDoneBefore(P, r.id), rest = restOf(r);
        const g = document.createElement('div'); g.className = 'grid5';
        const cell = (lb, html, cls) => '<div class="' + (cls || '') + '"><span class="lb">' + lb + '</span>' + html + '</div>';
        g.innerHTML = cell('По смете', '<span class="vl">' + esc(C.qty(r.qty) + ' ' + (r.unit || '')) + '</span>') +
          cell('Было ранее', '<span class="vl' + (before ? '' : ' dim') + '">' + (before ? esc(C.qty(before)) : '—') + '</span>') +
          cell('Осталось', '<span class="vl ' + (rest ? 'acc' : 'dim') + '"' + (rest ? ' title="Весь остаток — в эту КС" data-rest' : '') + '>' + (rest ? esc(C.qty(rest)) : '0') + '</span>') +
          cell('В этой КС', rest || hasNow(r) ? '<span class="inrow"><input type="text" inputmode="decimal"><button type="button" class="all-btn" title="Весь остаток позиции — в эту КС"></button></span>' : '<span class="vl dim">выполнено</span>', 'c4') +
          cell('<span class="r">Сумма, руб.</span>', '<span class="vl sum"></span>', 'c5');
        const inp = $('input', g), ab = $('.all-btn', g), sumEl = $('.vl.sum', g);
        const upd = () => {
          const v = C.num(r.qtyNow), on = hasNow(r) && rest > 0 && Math.abs(v - rest) < 1e-9;
          if (ab) { ab.classList.toggle('on', on); ab.textContent = on ? '✓ всё' : 'всё'; ab.hidden = !rest; }
          if (inp) { inp.classList.toggle('bad', hasNow(r) && v > rest + 1e-9); inp.title = hasNow(r) && v > rest + 1e-9 ? 'Больше остатка по смете (' + C.qty(rest) + ')' : ''; }
          const it = C.ksPeriodMode(P) && hasNow(r) ? C.ksItems(P).find(x => x.r === r) : null;
          sumEl.textContent = it ? C.money(it.c.total) : '—'; sumEl.classList.toggle('dim', !it);
        };
        const show = v => String(v).replace('.', ','); // десятичная запятая, как в остальных полях
        const set = v => { r.qtyNow = v; r.allNow = v !== '' && rest > 0 && Math.abs(C.num(v) - rest) < 1e-9 ? 1 : ''; touch(); if (inp) inp.value = show(v); upd(); updAll(); };
        if (inp) {
          inp.value = hasNow(r) ? show(r.qtyNow) : ''; inp.placeholder = rest ? C.qty(rest) : '';
          inp.addEventListener('change', () => {
            let v = inp.value.trim();
            if (v !== '') { const n = +v.replace(/\s/g, '').replace(',', '.'); if (!isFinite(n)) { toast('Введите число'); inp.value = hasNow(r) ? r.qtyNow : ''; return; } v = n; }
            set(v);
          });
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
        }
        if (ab) ab.addEventListener('click', () => set(ab.classList.contains('on') ? '' : rest));
        const rv = $('[data-rest]', g); if (rv && inp) rv.addEventListener('click', () => set(rest));
        upd();
        return g;
      };
      // показ по разделам: договор, затем каждое ДС (как в печатной смете)
      // позиции ДС с новой редакцией расчёта — в разделе договора, по номерам этого расчёта
      const grpIdx = x => { const d = C.rowDs(P, x); return d ? C.dsList(P).indexOf(d) + 1 : 0; };
      const noKey = (x, i) => { if (grpIdx(x) || !C.dsEdition(P)) return i; const n = parseFloat(String(x.no || '').replace(',', '.')); return isNaN(n) ? 1e9 + i : n; };
      const smetaCtl = collection(c, 'smeta', () => P.smeta, {
        noSearch: true, addLabel: '+ Позиция', lead: [ksLbl, sp, allBtn, clrBtn], after: updAll,
        order: items => items.map((x, i) => [x, i]).sort((a, b) => grpIdx(a[0]) - grpIdx(b[0]) || noKey(a[0], a[1]) - noKey(b[0], b[1]) || a[1] - b[1]).map(x => x[0]),
        section: x => {
          if (!C.dsList(P).length) return '';
          const d = C.rowDs(P, x);
          return d ? 'Дополнительные работы по ДС № ' + (d.no || '—') + (d.date ? ' от ' + C.fmtDate(d.date) : '') : C.contractWorksLabel(P);
        },
        extra: posGrid,
        // отменить последнее изменение позиции по ДС — вернуть прежние количество и цены
        rowButtons: [{ icon: '&#9998;', title: 'Изменить позицию по доп. соглашению (количество, цены или исключить)', show: r => P.supplements.length > 0 && !(r.dsId && C.dsById(P, r.dsId)) && !r.excludedBy, onClick: r => changeByDs(r) }, { icon: '&#8630;', title: 'Отменить изменение по доп. соглашению', show: r => (r.changes || []).length > 0 || !!r.excludedBy, onClick: r => {
          // исключённую сначала возвращаем в договор
          if (r.excludedBy) {
            const d = C.dsById(P, r.excludedBy);
            confirmBox('Вернуть позицию «' + r.name + '» в договор (отменить исключение' + (d ? ' по ДС № ' + (d.no || '—') : '') + ')?', 'Вернуть', () => { delete r.excludedBy; touch(); smetaCtl.draw(); });
            return;
          }
          const ch = r.changes[r.changes.length - 1], d = C.dsById(P, ch.dsId);
          confirmBox('Вернуть позицию «' + r.name + '» как было до ' + (d ? 'ДС № ' + (d.no || '—') : 'удалённого ДС') + ': ' + C.qty(ch.from.qty) + ' × ' + C.money(C.num(ch.from.priceWork) + C.num(ch.from.priceMat)) + '?', 'Вернуть', () => {
            Object.assign(r, ch.from); r.changes.pop(); if (!r.changes.length) delete r.changes;
            touch(); smetaCtl.draw();
          });
        } }]
      });
      c.appendChild(ksTotal);
      smetaRedraw = () => { smetaCtl.draw(); drawPend(); };
      drawPend();
      // ручное изменение позиции договора по ДС: запоминается «было → стало», как при загрузке ДС
      const changeByDs = r => {
        const ds = C.dsList(P);
        const w = { dsId: ds[ds.length - 1].id, act: '', qty: r.qty, priceWork: r.priceWork, priceMat: r.priceMat };
        const was = C.smetaRow(r);
        const body = document.createElement('div');
        const res = para('');
        const upd = () => {
          const t = C.smetaRow(w).total;
          res.innerHTML = w.act === 'ex' ? 'Позиция будет исключена: −' + C.money(was.total) + ' руб.'
            : 'Было: ' + C.qty(r.qty) + ' × ' + C.money(was.unitPrice) + ' = ' + C.money(was.total) + ' руб. → стало: ' + C.money(t) + ' руб. (' + (t - was.total >= 0 ? '+' : '−') + C.money(Math.abs(t - was.total)) + ')';
        };
        const draw = () => {
          body.innerHTML = '';
          body.appendChild(formGrid(w, [
            F('dsId', 'По доп. соглашению', 'select', { wide: 1, opts: dsOpts }),
            F('act', 'Что меняется', 'select', { wide: 1, rerender: 1, opts: [{ v: 'ex', l: 'Исключить позицию из договора' }], empty: 'Количество и / или цены' }),
            F('qty', 'Количество (было ' + C.qty(r.qty) + ' ' + (r.unit || '') + ')', 'number', { show: o => o.act !== 'ex' }),
            F('priceWork', 'Цена работ за ед. (было ' + C.money(C.num(r.priceWork)) + ')', 'number', { show: o => o.act !== 'ex' }),
            F('priceMat', 'Цена материала за ед. (было ' + C.money(C.num(r.priceMat)) + ')', 'number', { show: o => o.act !== 'ex' })
          ], f => { if (f.k === 'act') draw(); else upd(); }));
          body.appendChild(res); upd();
        };
        draw();
        openDialog('Изменение по ДС: ' + r.name, body, ['spacer', { label: 'Отмена', onClick: closeDialog }, {
          label: 'Применить', cls: 'btn-primary', onClick: () => {
            if (w.act === 'ex') { r.excludedBy = w.dsId; }
            else {
              const to = { qty: C.num(w.qty), priceWork: w.priceWork === '' ? '' : C.num(w.priceWork), priceMat: w.priceMat === '' ? '' : C.num(w.priceMat) };
              if (to.qty === C.num(r.qty) && C.num(to.priceWork) === C.num(r.priceWork) && C.num(to.priceMat) === C.num(r.priceMat)) { toast('Значения не изменились'); return; }
              (r.changes = r.changes || []).push({ dsId: w.dsId, from: { qty: r.qty, priceWork: r.priceWork, priceMat: r.priceMat }, to });
              Object.assign(r, to);
            }
            touch(); closeDialog(); smetaCtl.draw(); toast('Позиция изменена по ДС');
          }
        }]);
      };
      // история КС: закрыть текущую и начать следующую
      const hist = tabs.panes.t2;
      const drawHist = () => {
        hist.innerHTML = '';
        if (P.ksHistory.length) {
          const t = document.createElement('table'); t.className = 't';
          t.innerHTML = '<tr><th>№ КС</th><th>Дата</th><th>Период</th><th class="r">Сумма, руб.</th><th></th></tr>' + P.ksHistory.map((h, i) =>
            '<tr><td>' + esc(h.number) + '</td><td>' + esc(C.fmtDate(h.date)) + '</td><td>' + esc(C.fmtDate(h.periodFrom) + ' – ' + C.fmtDate(h.periodTo)) + '</td><td class="r">' + C.money(h.total) + '</td>' +
            '<td class="r">' + (i === P.ksHistory.length - 1 ? '<button type="button" class="btn btn-sm" data-reopen title="Её объёмы снова встанут в поля «В этой КС»">Вернуть в работу</button>' : '') + '</td></tr>').join('');
          const w = document.createElement('div'); w.className = 'table-wrap'; w.appendChild(t); hist.appendChild(w);
          $('[data-reopen]', t).addEventListener('click', reopenKs);
        } else hist.appendChild(card(null, [para('Закрытых КС пока нет. Когда КС подписана — закройте её: объёмы запомнятся, номер увеличится, а в КС-3 «с начала работ» и «с начала года» пойдёт нарастающий итог.')]));
        const tb = document.createElement('div'); tb.className = 'toolbar'; tb.style.marginTop = '12px';
        const sp2 = document.createElement('div'); sp2.style.flex = '1';
        tb.append(sp2, btn('Закрыть КС № ' + (P.ks.number || '—') + ' и начать следующую', closeKs, 'btn-primary'));
        hist.appendChild(tb);
      };
      const closeKs = () => {
        const k = C.ksTotals(P);
        if (!k.total) { toast(P.ksHistory.length && !C.ksPeriodMode(P) ? 'Вся смета уже закрыта прошлыми КС — закрывать нечего' : 'В КС нет сумм'); return; }
        confirmBox('Закрыть КС № ' + (P.ks.number || '—') + ' на ' + C.money(k.total) + ' руб.? Объёмы этого периода запомнятся, поля «В этой КС» очистятся, номер станет ' + ((parseInt(P.ks.number, 10) || 0) + 1) + '.', 'Закрыть КС', () => {
          if (window.IDBackup) IDBackup.snapshot('перед закрытием КС № ' + (P.ks.number || ''));
          P.ksHistory.push({
            id: C.uid(), number: P.ks.number, date: P.ks.date, periodFrom: P.ks.periodFrom, periodTo: P.ks.periodTo, total: k.total, work: k.work, mat: k.mat,
            rows: C.ksItems(P).map(({ r, qty, c }) => ({ id: r.id, name: r.name, unit: r.unit, qty: C.num(qty), sum: c.total }))
          });
          // следующий период — со дня после окончания этого (по местной дате, без сдвига часового пояса)
          const next = C.parseDate(P.ks.periodTo); if (next) next.setDate(next.getDate() + 1);
          const isoLocal = d => d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate());
          Object.assign(P.ks, { number: String((parseInt(P.ks.number, 10) || 0) + 1), date: '', periodFrom: next ? isoLocal(next) : '', periodTo: '' });
          P.smeta.forEach(r => { r.qtyNow = ''; r.allNow = ''; });
          touch(); render(); toast('КС закрыта');
        });
      };
      const reopenKs = () => {
        const h = P.ksHistory[P.ksHistory.length - 1];
        confirmBox('Вернуть КС № ' + h.number + ' в работу? Её объёмы снова встанут в поля «В этой КС», текущие значения этих полей заменятся.', 'Вернуть', () => {
          P.ksHistory.pop();
          P.smeta.forEach(r => { const x = h.rows.find(y => y.id === r.id); r.qtyNow = x ? x.qty : ''; });
          Object.assign(P.ks, { number: h.number, date: h.date, periodFrom: h.periodFrom, periodTo: h.periodTo });
          touch(); render();
        });
      };
      drawHist();
      if (P.ks.fitOnePage === undefined) P.ks.fitOnePage = true; // по умолчанию включено
      // ===== настройки КС: карточки по смыслу =====
      const onSet = f => {
        if (f.k === 'vatMode' || f.k === 'dsMode' || f.k === 'dsScope' || f.k === 'worksOnly' || f.k === 'ks3Mode') { render(); return; }
        updAll(); if (f.k === 'number') drawHist();
      };
      // короткие поля — по два в строку, длинные списки — в одну колонку
      const setCard = (title, fields, one) => { const g = formGrid(P.ks, fields, onSet); if (one) g.classList.add('one'); return card(title, [g]); };
      const sg = document.createElement('div'); sg.className = 'set-grid';
      sg.append(
        setCard('Реквизиты КС', [
          F('number', 'Номер КС-2 / КС-3'), F('date', 'Дата составления', 'date'),
          F('periodFrom', 'Отчётный период с', 'date'), F('periodTo', 'Отчётный период по', 'date'),
          F('opType', 'Вид операции (код)'), F('pricesAt', 'Смета составлена в ценах на'),
          F('term', 'Срок выполнения работ (для сметы)', 'textarea', { wide: 1 })
        ]),
        setCard('Подписанты', [
          F('contractorSignerPos', 'Подрядчик: должность'), F('contractorSignerName', 'Подрядчик: Фамилия И.О.'),
          F('customerSignerPos', 'Заказчик: должность'), F('customerSignerName', 'Заказчик: Фамилия И.О.')
        ]),
        setCard('Расчёт', [
          F('vatMode', 'НДС в смете и КС', 'select', { opts: [{ v: 'top', l: 'Цены без НДС — НДС сверху' }], empty: 'Цены с НДС, как в договоре — «в т.ч. НДС» (по умолчанию)', hint: 'КС-3 по бланку всегда: «Итого» (без НДС), «Сумма НДС», «Всего с учетом НДС»' }),
          F('ks2Style', 'Расчёт в КС-2', 'select', { opts: [{ v: 'smeta', l: 'Как в смете — в ценах сметы' }], empty: 'Как в КС-3 — без НДС, суммы совпадают до копейки (по умолчанию)' }),
          ...(P.supplements.length ? [
            F('dsMode', 'КС при доп. соглашениях', 'select', { opts: [{ v: 'sep', l: 'Отдельная КС на договор и на каждое ДС' }], empty: 'Одна КС, работы по ДС — разделами (по умолчанию)', hint: 'Отдельная — в шапке «№ договора, ДС № … от …»' }),
            F('dsScope', 'Эта КС оформляется по', 'select', { show: () => P.ks.dsMode === 'sep', opts: dsOpts, empty: 'Основному договору' })
          ] : []),
          F('ks3Mode', 'Строки КС-3', 'select', { opts: [{ v: 'items', l: 'По позициям сметы — как в КС-2' }], empty: 'Одной строкой — этап / «Работы по договору №…»' }),
          F('stageName', 'Наименование этапа для КС-3 (если одной строкой)', 'textarea', { show: () => P.ks.ks3Mode !== 'items', hint: 'Пусто — «Работы по договору № …»' }),
          F('worksOnly', 'КС-2 и КС-3 только на работы (стоимость материалов не включать)', 'check'),
          F('fitOnePage', 'Умещать смету, КС-2 и КС-3 на один лист, если чуть-чуть не помещаются (шрифт — не меньше 78 %)', 'check')
        ], true),
        setCard('Стороны в КС', [
          F('customerKey', 'Заказчик (Заказчик / Генподрядчик)', 'select', { opts: orgKeys, empty: 'По ролям: ' + ((C.customerOrg(P) || {}).key || 'застройщик не заведён'), hint: 'Если вы субподрядчик — выберите генподрядчика' }),
          F('contractorKey', 'Подрядчик (Подрядчик / Субподрядчик)', 'select', { opts: orgKeys, empty: 'По ролям: ' + ((C.builderOrg(P) || {}).key || 'подрядчик не заведён'), hint: 'Если вы субподрядчик — выберите свою организацию' })
        ], true)
      );
      tabs.panes.t3.appendChild(sg);
    },
    ozhr() {
      const o = P.ozhr;
      main.appendChild(head('Общий журнал работ', 'Приказ Минстроя от 02.12.2022 № 1026/пр. Разделы 3 и 5 заполняются из журнала актов автоматически.', [
        fmtSwitch(),
        ddBtn('Сформировать ▾', [
          ['<b>ОЖР целиком</b>', () => makeDoc('Общий журнал работ', () => IDPdf.ozhrDoc(P))],
          ['Титульный лист', () => makeDoc('ОЖР титул', () => IDPdf.ozhrDoc(P, { title: true }))],
          ['Раздел 3', () => makeDoc('ОЖР раздел 3', () => IDPdf.ozhrDoc(P, { r3: true }))],
          ['Раздел 5', () => makeDoc('ОЖР раздел 5', () => IDPdf.ozhrDoc(P, { r5: true }))]
        ], 'btn-primary')
      ]));
      const tabs = pageTabs([['t1', 'Титульный лист'], ['t2', 'Персонал и спецжурналы'], ['t3', 'Работы и контроль']], ozhrTab, k => { ozhrTab = k; });
      main.appendChild(tabs.bar);
      Object.values(tabs.panes).forEach(x => main.appendChild(x));
      let tgt = tabs.panes.t1;
      tgt.appendChild(card(null, [
        para('Представители застройщика, подрядчика, стройконтроля и авторского надзора берутся из раздела «Представители» (действующие на сегодня). Поля ниже — для того, чего нет в других разделах.'),
        formGrid(o, [
          F('builderRepName', 'Представитель застройщика: ФИО', 'text', { ph: (C.currentRep(P, C.REP_ROLES[0]) || {}).fullName || '', hint: 'Пусто — СК Заказчика' }),
          F('builderRepPos', 'Представитель застройщика: должность'),
          F('builderRepDoc', 'Представитель застройщика: документ о полномочиях'), F('builderRepNrs', 'Представитель застройщика: ID НРС'),
          F('techCustomer', 'Технический заказчик (реквизиты)', 'textarea', { wide: 1, ph: C.orgLine(C.parties(P).techCustomer), hint: 'Пусто — из организации с ролью «Технический заказчик»' }),
          F('techCustomerSro', 'Тех. заказчик: СРО', 'textarea', { wide: 1, ph: C.sroLine(C.parties(P).techCustomer) }),
          F('techRepName', 'Представитель тех. заказчика: ФИО'), F('techRepPos', 'Представитель тех. заказчика: должность'),
          F('techRepDoc', 'Представитель тех. заказчика: документ'), F('techRepNrs', 'Представитель тех. заказчика: ID НРС'),
          F('operator', 'Лицо, ответственное за эксплуатацию / рег. оператор', 'textarea', { wide: 1, ph: C.orgLine(C.parties(P).operator), hint: 'Пусто — из организации с ролью «Эксплуатирующая организация / региональный оператор»' }),
          F('operatorRepName', 'Его представитель: ФИО'), F('operatorRepPos', 'Его представитель: должность'),
          F('operatorRepDoc', 'Его представитель: документ', 'text', { wide: 1 }),
          F('operatorScName', 'Его представитель по СК: ФИО'), F('operatorScPos', 'Его представитель по СК: должность'),
          F('operatorScDoc', 'Его представитель по СК: документ', 'text', { wide: 1 }),
          F('gsnOrgan', 'ГСН: орган, реквизиты', 'textarea', { wide: 1 }), F('gsnPerson', 'ГСН: должностное лицо', 'text', { wide: 1 }),
          F('gsnOrder', 'ГСН: приказ о назначении', 'text', { wide: 1 }),
          F('pages', 'Страниц в журнале'), F('periodFrom', 'Учёт работ в период с', 'date'), F('periodTo', 'по', 'date'),
          F('titleSignerName', 'Подпись титула: расшифровка'), F('titleSignerPos', 'Подпись титула: должность')
        ])
      ]));
      const sub = (title, key, info) => {
        const c = card(title, info ? [para(info)] : []);
        tgt.appendChild(c);
        collection(c, key, () => P.ozhr[key], { noSearch: true });
      };
      tgt = tabs.panes.t2;
      sub('Другие лица, осуществляющие строительство', 'others');
      sub('Раздел 1. Инженерно-технический персонал', 'r1');
      sub('Раздел 2. Специальные журналы', 'r2');
      tgt = tabs.panes.t3;
      tgt.appendChild(card('Раздел 3. Сведения о выполнении работ', [para('Заполняется из «Актов освидетельствования»: даты, наименование работ. Условия производства работ — поле в карточке акта.')]));
      sub('Раздел 4. Строительный контроль', 'r4');
      tgt.appendChild(card('Раздел 5. Перечень исполнительной документации', [para('Заполняется из «Актов освидетельствования» автоматически.')]));
      sub('Раздел 6. Государственный строительный надзор', 'r6');
      sub('Изменения в записях титульного листа', 'titleChanges');
    },
    check() {
      const list = C.projectCheck(P);
      const errs = list.filter(x => x.lvl === 'err'), warns = list.filter(x => x.lvl === 'warn');
      main.appendChild(head('Проверка комплекта', 'Список дел перед сдачей: красное — в документах будет неверно или пусто, жёлтое — стоит проверить.', [btn('Проверить ещё раз', () => render())]));
      // итог: готово или сколько осталось
      const top = document.createElement('div'); top.className = 'ed-status ' + (errs.length ? 'w' : 'ok');
      top.innerHTML = '<div class="ic">' + (list.length ? (errs.length ? '⚠' : '✓') : '✓') + '</div><div><b>' + (list.length ? (errs.length ? 'Осталось исправить: ' + errs.length + (warns.length ? ' и проверить: ' + warns.length : '') : 'Ошибок нет — можно печатать. Проверить: ' + warns.length) : 'Всё в порядке — комплект готов к печати') + '</b></div>';
      main.appendChild(top);
      // дела — группами по разделам, в порядке шагов меню; у каждого «Исправить»
      const GROUPS = [['#/settings', '📄 Договор и доп. соглашения'], ['#/orgs', '👥 Участники строительства'], ['#/people', '👥 Представители'], ['#/rd', '📐 Проектная и рабочая документация'], ['#/materials', '🧱 Материалы'], ['#/balance', '📦 Движение материалов'], ['#/acts', '📝 Акты освидетельствования'], ['#/smeta', '💰 Смета и КС']];
      const groups = GROUPS.concat([...new Set(list.map(x => x.where))].filter(w => !GROUPS.some(g => g[0] === w)).map(w => [w, w.replace('#/', '')]));
      groups.forEach(([where, title]) => {
        const items = list.filter(x => x.where === where).sort((a, b) => (a.lvl === 'err' ? 0 : 1) - (b.lvl === 'err' ? 0 : 1));
        if (!items.length) return;
        const ne = items.filter(x => x.lvl === 'err').length;
        const c = document.createElement('div'); c.className = 'card todo-grp';
        c.innerHTML = '<div class="todo-h"><b>' + esc(title) + '</b>' + (ne ? '<span class="st r">● ' + ne + '</span>' : '') + (items.length - ne ? '<span class="st w">⚠ ' + (items.length - ne) + '</span>' : '') + '</div>';
        items.forEach(x => {
          const r = document.createElement('div'); r.className = 'iss';
          r.innerHTML = '<span class="d ' + (x.lvl === 'err' ? 'r' : 'w') + '"></span><span class="t">' + esc(x.text) + '</span>';
          const act = x.actId && P.acts.find(a => a.id === x.actId);
          r.appendChild(btn(act ? 'Открыть акт' : 'Исправить', () => {
            if (act) openEditor('acts', P.acts, act, false, () => render(), { focus: (actIssues(act).find(i => x.text.includes(i.text)) || {}).sec });
            else location.hash = where;
          }, 'btn-sm' + (x.lvl === 'err' ? ' btn-primary' : '')));
          c.appendChild(r);
        });
        main.appendChild(c);
      });
    },
    balance() {
      const rows = C.materialBalance(P);
      main.appendChild(head('Движение материалов', 'Поставлено (количество в «Материалах») − израсходовано по актам (поле «расход» у материала в карточке АОСР / АООК) = остаток на объекте.', [
        fmtSwitch(), btn('Ведомость', () => makeDoc('Ведомость материалов', () => IDPdf.balanceDoc(P)), 'btn-primary')
      ]));
      main.appendChild(subTabs([['#/materials', 'Материалы и документы', P.materials.length], ['#/balance', 'Движение материалов']], '#/balance'));
      if (!rows.length) { main.appendChild(card(null, [para('Материалов пока нет.')])); return; }
      const t = document.createElement('table'); t.className = 't';
      t.innerHTML = '<tr><th>№</th><th>Материал</th><th style="text-align:right">Поставлено</th><th style="text-align:right">По актам</th><th style="text-align:right">Остаток</th><th>В актах</th></tr>' + rows.map(b =>
        '<tr' + (b.rest !== null && b.rest < 0 ? ' class="row-bad"' : '') + '><td>' + C.matNo(P, b.m) + '</td><td>' + esc(C.matName(b.m)) + '</td>' +
        '<td style="text-align:right">' + (C.s(b.m.qty) === '' ? '—' : C.qty(b.supplied) + ' ' + esc(b.m.unit || '')) + '</td>' +
        '<td style="text-align:right">' + (b.used ? C.qty(b.used) + ' ' + esc(b.m.unit || '') : '—') + '</td>' +
        '<td style="text-align:right"><b>' + (b.rest === null ? '—' : C.qty(b.rest) + ' ' + esc(b.m.unit || '')) + '</b></td>' +
        '<td class="small">' + b.uses.map(u => esc(u.a.type + ' № ' + C.actNumber(P, u.a)) + (u.qty !== null ? ' — ' + C.qty(u.qty) : ' — <span class="muted">расход не указан</span>')).join('<br>') + '</td></tr>').join('');
      const w = document.createElement('div'); w.className = 'table-wrap'; w.appendChild(t);
      main.appendChild(w);
    },
    docs() {
      main.appendChild(head('Реестр и выгрузка ИД', 'Формирование печатных форм. Файлы создаются на этом устройстве, без интернета. Word (.docx) — если документ нужно поправить перед печатью.', [fmtSwitch()]));
      const grid = document.createElement('div'); grid.className = 'doc-grid';
      const dc = (title, desc, buttons) => {
        const c = document.createElement('div'); c.className = 'card doc-card';
        c.innerHTML = '<h2>' + esc(title) + '</h2><p class="muted small">' + esc(desc) + '</p><div class="btns"></div>';
        buttons.forEach(b => $('.btns', c).appendChild(b));
        grid.appendChild(c);
      };
      const sel = document.createElement('select');
      sel.innerHTML = P.acts.filter(a => a.type).map(a => { const v = C.actView(P, a); return '<option value="' + esc(a.id) + '">' + esc(a.type + ' № ' + v.number + ' — ' + v.name) + '</option>'; }).join('') || '<option value="">Нет актов</option>';
      const one = document.createElement('div'); one.className = 'card doc-card';
      one.innerHTML = '<h2>Один акт</h2><p class="muted small">АОСР, АООК, разбивка осей, ГРО — по форме приказа 344/пр.</p>';
      one.appendChild(sel);
      const ob = document.createElement('div'); ob.className = 'btns';
      ob.appendChild(btn('Сформировать PDF', () => { const a = P.acts.find(x => x.id === sel.value); if (a) makeAct(a); else toast('Нет актов'); }, 'btn-primary'));
      one.appendChild(ob);
      grid.appendChild(one);
      const marked = P.acts.filter(a => a.print && a.type).length;
      dc('Пакет актов', marked ? 'Отмечено к печати: ' + marked + '. Отметки ставятся в «Актах освидетельствования».' : 'Нет отметок — будут выгружены все акты.', [
        btn('ZIP: каждый отдельно', () => batchActs('zip'), 'btn-primary'), btn('Одним PDF', () => batchActs('one'))
      ]);
      const fitJ = document.createElement('label'); fitJ.className = 'check small';
      fitJ.innerHTML = '<input type="checkbox"' + (P.settings.fitJournals !== false ? ' checked' : '') + '> Реестр, ЖВК и ОЖР: убирать почти пустой последний лист (шрифт уменьшится, но не меньше 78 %)';
      fitJ.querySelector('input').addEventListener('change', e => { P.settings.fitJournals = e.target.checked; touch(); });
      main.appendChild(fitJ);
      const sg = document.createElement('label'); sg.className = 'check small'; sg.style.display = 'block';
      sg.innerHTML = '<input type="checkbox"' + (P.settings.printSigns ? ' checked' : '') + '> Подписи и печати в PDF — вставлять загруженные картинки подписей (у представителей и руководителей) и печатей (у организаций). Для согласований и отправки сканом; бумажные экземпляры подписывайте вживую';
      sg.querySelector('input').addEventListener('change', e => { P.settings.printSigns = e.target.checked; touch(); });
      main.appendChild(sg);
      // замечания перед печатью
      const chk = C.projectCheck(P), nErr = chk.filter(x => x.lvl === 'err').length;
      const ch = document.createElement('a'); ch.href = '#/check'; ch.className = 'notice' + (nErr ? ' warn' : '');
      ch.style.display = 'block'; ch.style.margin = '8px 0 12px';
      ch.textContent = chk.length ? 'Проверка комплекта: ошибок ' + nErr + ', предупреждений ' + (chk.length - nErr) + ' — открыть список' : 'Проверка комплекта: замечаний нет';
      main.appendChild(ch);
      dc('Реестр ИД', 'Перечень актов с датами и подписантами.', [btn('PDF', () => makeDoc('Реестр ИД', () => IDPdf.registryDoc(P)), 'btn-primary')]);
      dc('ЖВК', 'Журнал входного контроля — из раздела «Материалы».', [btn('PDF', () => makeDoc('ЖВК', () => IDPdf.jvkDoc(P)), 'btn-primary')]);
      dc('Ведомость материалов', 'Поставлено, израсходовано по актам, остаток.', [btn('PDF', () => makeDoc('Ведомость материалов', () => IDPdf.balanceDoc(P)), 'btn-primary')]);
      dc('Общий журнал работ', 'Титул и разделы 1–6.', [
        btn('Целиком', () => makeDoc('Общий журнал работ', () => IDPdf.ozhrDoc(P)), 'btn-primary'),
        btn('Титул', () => makeDoc('ОЖР титул', () => IDPdf.ozhrDoc(P, { title: true }))),
        btn('Разд. 3', () => makeDoc('ОЖР раздел 3', () => IDPdf.ozhrDoc(P, { r3: true }))),
        btn('Разд. 5', () => makeDoc('ОЖР раздел 5', () => IDPdf.ozhrDoc(P, { r5: true })))
      ]);
      dc('Смета, КС-2, КС-3', 'По позициям сметы и реквизитам КС.', [
        btn('ZIP', () => makeZip('КС', [['Смета', () => IDPdf.smetaDoc(P)], ['КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P)], ['КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P)]]), 'btn-primary'),
        btn('Смета', () => makeDoc('Смета', () => IDPdf.smetaDoc(P))),
        btn('КС-2', () => makeDoc('КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P))),
        btn('КС-3', () => makeDoc('КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P)))
      ]);
      dc('Весь комплект', 'Все акты, реестр, ЖВК, ОЖР, смета, КС-2, КС-3 одним архивом.', [btn('ZIP', () => fullSet(), 'btn-primary')]);
      main.appendChild(grid);
    },
    project() {
      main.appendChild(head('Проекты и файлы', 'Данные хранятся на этом устройстве. Чтобы перенести проект на другое устройство — сохраните файл и откройте его там.'));
      const acts = document.createElement('div'); acts.className = 'toolbar';
      acts.append(
        btn('Сохранить проект в файл', saveFile, 'btn-primary'),
        btn('Открыть файл проекта', () => $('#fileInput').click()),
        btn('Новый проект', () => { const p = C.emptyProject(); store.projects[p.id] = p; switchTo(p.id); location.hash = '#/home'; newObjectWizard(); }),
        btn('Новый объект на основе текущего…', newFromCurrent)
      );
      if (deferredInstall) acts.appendChild(btn('Установить приложение', installApp));
      main.appendChild(card('Текущий проект: ' + projTitle(P), [acts,
        para('Последнее изменение: ' + (P.updatedAt ? new Date(P.updatedAt).toLocaleString('ru-RU') : '—'))]));
      const list = document.createElement('div'); list.className = 'list';
      Object.values(store.projects).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).forEach(p => {
        const row = document.createElement('div'); row.className = 'row';
        const s = p.settings;
        row.innerHTML = '<button type="button" class="proj-name' + (s.shortName ? '' : ' empty') + '" title="Изменить короткое имя проекта">' + esc(s.shortName || '+ имя') + '</button>' +
          '<div class="row-main"><div class="row-title">' + esc((s.objectName || 'Без названия') + (s.contractNo ? ' · дог. ' + s.contractNo : '')) + (p.id === P.id ? ' <span class="badge ok">открыт</span>' : '') + '</div><div class="row-sub">Актов: ' + p.acts.length + ' · материалов: ' + p.materials.length + (p.updatedAt ? ' · изменён ' + new Date(p.updatedAt).toLocaleDateString('ru-RU') : '') + '</div></div><div class="row-actions"></div>';
        $('.proj-name', row).addEventListener('click', () => editShortName(p, render));
        const ra = $('.row-actions', row);
        if (p.id !== P.id) ra.appendChild(btn('Открыть', () => switchTo(p.id), 'btn-sm'));
        ra.appendChild(btn('Копия', () => { const cp = C.normalize(JSON.parse(JSON.stringify(p))); cp.id = C.uid(); cp.settings.objectName = (cp.settings.objectName || '') + ' (копия)'; store.projects[cp.id] = cp; touch(); render(); }, 'btn-sm'));
        ra.appendChild(btn('Удалить', () => confirmBox('Удалить проект «' + projTitle(p) + '» с этого устройства? Сначала сохраните его в файл, если он нужен.', 'Удалить', () => {
          delete store.projects[p.id];
          if (p.id === P.id) { const ids = Object.keys(store.projects); if (!ids.length) { const np = C.emptyProject(); store.projects[np.id] = np; ids.push(np.id); } switchTo(ids[0]); }
          else { touch(); render(); }
        }, true), 'btn-sm btn-danger'));
        list.appendChild(row);
      });
      main.appendChild(card('Проекты на этом устройстве', [list]));
      if (window.IDSync) IDSync.renderCard(main);
      if (window.IDBackup) IDBackup.renderCard(main);
    },
    lists() {
      main.appendChild(head('Списки', 'Значения выпадающих списков. В полях с этими списками можно и выбрать вариант, и вписать свой.'));
      // редактируемые
      const defs = [['sections', 'Разделы проекта', 'Используются в актах и справочнике работ (для нумерации: КЖ-01…)'], ['docTypes', 'Виды документов о качестве', 'Материалы: «Документ 1/2: вид»'], ['units', 'Единицы измерения', 'Материалы и смета']];
      const g = document.createElement('div'); g.className = 'grid';
      defs.forEach(([k, l, hint]) => {
        const f = document.createElement('label'); f.className = 'field';
        f.innerHTML = '<span>' + esc(l) + '</span><textarea rows="8"></textarea>' + (hint ? '<small>' + esc(hint) + '</small>' : '');
        const ta = $('textarea', f); ta.value = (P.lists[k] || []).join('\n');
        ta.addEventListener('input', () => { P.lists[k] = Array.from(new Set(ta.value.split('\n').map(x => x.trim()).filter(Boolean))); touch(); });
        g.appendChild(f);
      });
      main.appendChild(card('Можно изменять', [g, para('По одному значению в строке; повторы убираются автоматически.')]));
      // фиксированные: от них зависят формы и логика
      const fixed = document.createElement('div'); fixed.className = 'grid';
      [['Роли организаций на объекте', C.ORG_ROLES.map(r => r + (C.ROLE_HINT[r] ? ' — ' + C.ROLE_HINT[r] : ''))],
        ['Роли представителей в актах', C.REP_ROLES.map((r, i) => r + ' — ' + REP_HINT[i])],
        ['Типы актов (формы приказа 344/пр)', C.DEFAULT_LISTS.actTypes],
        ['Тип лица', ['ЮЛ — юридическое лицо', 'ИП — индивидуальный предприниматель', 'ФЛ — физическое лицо']],
        ['Результат входного контроля', C.DEFAULT_LISTS.vk]
      ].forEach(([l, items]) => {
        const f = document.createElement('div'); f.className = 'field';
        f.innerHTML = '<span>' + esc(l) + '</span><ul class="small fixed-list">' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
        fixed.appendChild(f);
      });
      main.appendChild(card('Фиксированные', [para('Эти списки нельзя менять: от них зависит, что попадает в шапки актов, ОЖР и КС, и какие формы печатаются. Если нужной роли нет, выберите «Иное» и напишите, какую роль добавить.'), fixed]));
    },
    help() {
      main.appendChild(head('Инструкция', 'Формы актов — приказ Минстроя России от 16.05.2023 № 344/пр (прил. 1–4); КС-2/КС-3 — постановление Госкомстата № 100 от 11.11.1999; ОЖР — приказ Минстроя № 1026/пр от 02.12.2022.'));
      const d = document.createElement('div'); d.className = 'card help';
      d.innerHTML = `
        <h3>Порядок работы</h3>
        <ol>
          <li><b>Объект и договор</b> — наименование, адрес, договор, шифр проекта, НДС.</li>
          <li><b>Организации</b> — участники с ролями на объекте. В шапки актов попадают: застройщик (или технический заказчик), генподрядчик или подрядчик («лицо, осуществляющее строительство») и проектировщик. Свою организацию выберите в поле «Наша организация». Если вы работаете у генподрядчика, назначьте себе роль «Субподрядчик»: тогда вы будете исполнителем в новых актах, а в КС-2/КС-3 можно указать генподрядчика заказчиком.</li>
          <li><b>Представители</b> — роль, организация, ФИО, должность, документ о полномочиях, ID в НРС. Сменился человек — новая запись с датами «с/по»: старые акты сохранят прежнего.</li>
          <li><b>Материалы</b> — каждая партия с документами о качестве. Истёкший документ подсвечивается.</li>
          <li><b>Справочник работ</b> — наименования, нормативы, последующие работы, исполнительные схемы по умолчанию.</li>
          <li><b>Журнал актов</b> — одна запись = один акт: тип, раздел, вид работ, оси, даты, материалы. Номер считается сам (отдельно по типу и разделу); свой номер — в поле «№ вручную». Пустые «вручную»-поля берут текст из справочника.</li>
          <li><b>Документы PDF</b> — один акт, пакет актов (ZIP или одним файлом), реестр ИД, ЖВК, ОЖР, смета, КС-2, КС-3.</li>
        </ol>
        <h3>Важно</h3>
        <ul>
          <li>Представитель в акте выбирается по дате акта (пусто — дата окончания работ) и датам «с/по».</li>
          <li>Исполнитель (субподряд) попадает в акт, только если он не совпадает с подрядчиком и для него заведён представитель с ролью «5. Исполнитель работ (субподряд)».</li>
          <li>АООК делается только на конструкции, которые проектировщик отнёс к ответственным.</li>
          <li>В «Разбивке осей» поле «2. Закрепление осей произведено» берётся из «Доп. сведений» акта, «произведена разбивка осей …» — из «Оси / участок».</li>
          <li>Нормативы в справочнике — заготовки. Форма требует структурные единицы: допишите пункты СП по своему проекту.</li>
        </ul>
        <h3>Перенос между ПК и телефоном</h3>
        <ul>
          <li>«Проекты и файлы» → «Сохранить проект в файл» — получится файл <code>.idproj.json</code>.</li>
          <li>Передайте его на другое устройство (облако, почта, мессенджер) и откройте через «Открыть файл проекта».</li>
          <li>Данные хранятся в браузере устройства. Периодически сохраняйте файл как резервную копию.</li>
        </ul>
        <h3>Установка</h3>
        <ul>
          <li><b>Windows</b>: откройте приложение в Edge или Chrome → меню «…» → «Приложения» → «Установить». Появится ярлык, приложение работает без интернета.</li>
          <li><b>Android</b>: Chrome → меню → «Добавить на главный экран» / «Установить приложение».</li>
          <li><b>iPhone</b>: Safari → «Поделиться» → «На экран «Домой»».</li>
        </ul>`;
      main.appendChild(d);
    }
  };

  // перенос представителей из другого проекта: организация ищется по ИНН / названию, при отсутствии — копируется
  function peopleFromProject(others, done) {
    const normName = s => String(s || '').toLowerCase().replace(/[«»"'\s]+/g, ' ').trim();
    const sameOrg = (a, b) => (a.inn && b.inn && a.inn === b.inn) || (a.name && normName(a.name) === normName(b.name));
    const body = document.createElement('div');
    body.innerHTML = '<div class="field"><label>Проект-источник</label><select class="pp-src"></select></div><div class="pp-list"></div>';
    const sel = $('.pp-src', body), list = $('.pp-list', body);
    others.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = projTitle(p) + ' — представителей: ' + p.people.length; sel.appendChild(o); });
    let src;
    const draw = () => {
      src = store.projects[sel.value];
      const our = C.orgByKey(src, src.settings.ourOrg);
      // по умолчанию отмечены действующие представители нашей организации (если не выбрана — подрядчиков)
      const builders = [C.ROLE.genContractor, C.ROLE.contractor, C.ROLE.subContractor];
      const pre = x => {
        if (x.to && x.to < C.todayISO()) return false;
        const o = C.orgByKey(src, x.orgKey);
        return our ? x.orgKey === our.key : !!(o && builders.includes(o.role));
      };
      const groups = {};
      src.people.forEach((x, i) => (groups[x.orgKey || '—'] = groups[x.orgKey || '—'] || []).push(i));
      list.innerHTML = Object.keys(groups).map(k => {
        const o = C.orgByKey(src, k);
        const here = o && P.orgs.find(po => sameOrg(po, o));
        return '<div class="pp-org"><b>' + esc(k) + '</b> <span class="muted small">' + esc(o ? (here ? 'есть в этом проекте как «' + here.key + '»' : 'нет в этом проекте — будет добавлена') : '') + '</span></div>' +
          groups[k].map(i => {
            const x = src.people[i];
            const dup = P.people.some(y => normName(y.fullName) === normName(x.fullName) && y.role === x.role);
            return '<label class="pp-row"><input type="checkbox" data-i="' + i + '"' + (pre(x) && !dup ? ' checked' : '') + (dup ? ' disabled' : '') + '> <span>' + esc(x.fullName || 'Без ФИО') + (x.position ? ', ' + esc(x.position.toLowerCase()) : '') +
              ' <span class="muted small">· ' + esc(x.role || '') + (dup ? ' · уже есть' : '') + (x.to && x.to < C.todayISO() ? ' · полномочия истекли' : '') + '</span></span></label>';
          }).join('');
      }).join('');
    };
    sel.addEventListener('change', draw);
    draw();
    openDialog('Представители из другого проекта', body, ['spacer', { label: 'Отмена', onClick: closeDialog }, {
      label: 'Добавить отмеченных', cls: 'btn-primary', onClick: () => {
        const idx = $$('input[data-i]:checked', list).map(c => +c.dataset.i);
        if (!idx.length) { toast('Никто не отмечен'); return; }
        const keyMap = {};
        let orgsAdded = 0;
        idx.forEach(i => {
          const x = src.people[i];
          if (!(x.orgKey in keyMap)) {
            const o = C.orgByKey(src, x.orgKey);
            let here = o && P.orgs.find(po => sameOrg(po, o));
            if (o && !here) {
              here = Object.assign(JSON.parse(JSON.stringify(o)), { id: C.uid() });
              let k = here.key, n = 2; while (P.orgs.some(po => po.key === k)) k = here.key + ' ' + n++;
              here.key = k; P.orgs.push(here); orgsAdded++;
            }
            keyMap[x.orgKey] = here ? here.key : x.orgKey;
          }
          // «действует с» пустое: иначе акты, датированные раньше начала по договору, остаются без подписанта
          P.people.push(Object.assign(JSON.parse(JSON.stringify(x)), { id: C.uid(), orgKey: keyMap[x.orgKey], from: '', to: '' }));
        });
        const srcOur = C.orgByKey(src, src.settings.ourOrg);
        if (!P.settings.ourOrg && srcOur && keyMap[srcOur.key]) P.settings.ourOrg = keyMap[srcOur.key];
        touch(); closeDialog(); done();
        toast('Добавлено представителей: ' + idx.length + (orgsAdded ? ', организаций: ' + orgsAdded : ''));
      }
    }]);
  }

  // напоминания на стартовой странице: сроки документов о качестве, период КС, ошибки комплекта
  function reminders() {
    const today = C.todayISO();
    try { if (localStorage.getItem('idgen.remindHide') === P.id + today) return null; } catch (e) { }
    const in30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate()); })();
    const items = [];
    const mats = P.materials.filter(m => m.name && C.matUntil(m));
    const expired = mats.filter(m => C.matUntil(m) < today), soon = mats.filter(m => C.matUntil(m) >= today && C.matUntil(m) <= in30);
    if (expired.length) items.push(['#/materials', 'Истёк документ о качестве: ' + expired.slice(0, 3).map(m => C.matNo(P, m) + ' ' + C.matName(m)).join('; ') + (expired.length > 3 ? ' и ещё ' + (expired.length - 3) : '') + '. Для новых актов нужен действующий документ.']);
    if (soon.length) items.push(['#/materials', 'В ближайшие 30 дней истекают документы: ' + soon.slice(0, 3).map(m => C.matNo(P, m) + ' ' + C.matName(m) + ' (до ' + C.fmtDate(C.matUntil(m)) + ')').join('; ') + (soon.length > 3 ? ' и ещё ' + (soon.length - 3) : '') + '.']);
    if (P.smeta.some(r => r.name) && P.ks.periodTo && P.ks.periodTo < today) items.push(['#/smeta', 'Отчётный период КС № ' + (P.ks.number || '—') + ' закончился ' + C.fmtDate(P.ks.periodTo) + '. Сформируйте КС и закройте её — начнётся следующий период.']);
    const errs = C.projectCheck(P).filter(x => x.lvl === 'err').length;
    if (errs) items.push(['#/check', 'Проверка комплекта: ошибок — ' + errs + '.']);
    if (!items.length) return null;
    const box = document.createElement('div'); box.className = 'notice remind';
    box.innerHTML = '<div class="remind-head"><b>Напоминания</b><button type="button" class="btn btn-sm">Скрыть до завтра</button></div>' +
      items.map(([h, t]) => '<a href="' + h + '">' + esc(t) + '</a>').join('');
    $('button', box).addEventListener('click', () => { try { localStorage.setItem('idgen.remindHide', P.id + today); } catch (e) { } box.remove(); });
    return box;
  }

  // новый объект «по шаблону» текущего: наша организация с представителями, справочник работ, настройки
  function newFromCurrent() {
    const our = C.orgByKey(P, P.settings.ourOrg);
    const opts = [
      ['our', 'Наша организация' + (our ? ' «' + our.key + '»' : '') + ' и её представители', !!our],
      ['orgs', 'Остальные организации (проектировщик, стройконтроль, лаборатория…) и их представители', false],
      ['works', 'Справочник работ (' + P.works.length + ')', true],
      ['rd', 'Разделы РД и шифры (' + P.rdSections.length + ') — обычно у нового объекта свои', false],
      ['ks', 'Подписант подрядчика в КС и настройки КС', true]
    ];
    const body = document.createElement('div');
    body.innerHTML = '<p class="small muted">Объект, договор, акты, материалы и смета будут пустыми. Списки и настройки печати переносятся всегда.</p>' +
      opts.map(([k, l, on]) => '<label class="pp-row"><input type="checkbox" data-k="' + k + '"' + (on ? ' checked' : '') + (k === 'our' && !our ? ' disabled' : '') + '> <span>' + esc(l) + '</span></label>').join('');
    openDialog('Новый объект на основе текущего', body, ['spacer', { label: 'Отмена', onClick: closeDialog }, {
      label: 'Создать', cls: 'btn-primary', onClick: () => {
        const on = k => { const c = $('input[data-k="' + k + '"]', body); return c && c.checked; };
        const cp = x => JSON.parse(JSON.stringify(x));
        const p = C.emptyProject();
        p.lists = cp(P.lists);
        ['vat', 'copies', 'fitActs', 'fitJournals', 'ourOrg', 'projectDocName'].forEach(k => { if (P.settings[k] !== undefined) p.settings[k] = P.settings[k]; });
        const keepOrg = o => (on('our') && our && o.key === our.key) || (on('orgs') && (!our || o.key !== our.key) && ![C.ROLE.developer, C.ROLE.techCustomer].includes(o.role));
        p.orgs = P.orgs.filter(keepOrg).map(o => Object.assign(cp(o), { id: C.uid() }));
        const keys = p.orgs.map(o => o.key);
        p.people = P.people.filter(x => keys.includes(x.orgKey) && (!x.to || x.to >= C.todayISO())).map(x => Object.assign(cp(x), { id: C.uid(), from: '', to: '' }));
        if (!keys.includes(p.settings.ourOrg)) p.settings.ourOrg = '';
        if (on('works')) p.works = P.works.map(w => Object.assign(cp(w), { id: C.uid() }));
        if (on('rd')) p.rdSections = P.rdSections.map(r => Object.assign(cp(r), { id: C.uid() }));
        if (on('ks')) ['contractorSignerPos', 'contractorSignerName', 'worksOnly', 'fitOnePage', 'ks3Mode', 'contractorKey'].forEach(k => { if (P.ks[k] !== undefined) p.ks[k] = P.ks[k]; });
        if (p.ks.contractorKey && !keys.includes(p.ks.contractorKey)) p.ks.contractorKey = '';
        closeDialog();
        store.projects[p.id] = C.normalize(p); switchTo(p.id);
        location.hash = '#/settings';
        toast('Создан новый объект: организаций ' + p.orgs.length + ', представителей ' + p.people.length + ', видов работ ' + p.works.length + '. Заполните объект и договор.');
      }
    }]);
  }

  function listView(key, arr, getArr, opts) {
    const sc = SCHEMA[key];
    main.appendChild(head(sc.title, sc.intro));
    collection(main, key, getArr, opts);
  }

  // ================= маршрутизация =================
  function render() {
    const view = (location.hash.replace(/^#\//, '') || 'home').split('?')[0];
    const cur = VIEWS[view] ? view : 'home';
    main.innerHTML = '';
    VIEWS[cur]();
    $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === cur || (a.dataset.also || '').split(',').includes(cur)));
    $$('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.view === cur || (cur === 'balance' && a.dataset.view === 'materials')));
    document.body.classList.remove('nav-open');
    updateHeader();
    updateNavCounts();
  }
  // счётчики в меню: сколько требует внимания (красный — срочно)
  function updateNavCounts() {
    const set = (k, n, red) => { const el = document.querySelector('.sidebar [data-cnt="' + k + '"]'); if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('r', !!red); } };
    try {
      const today = C.todayISO();
      set('parties', (P.candidates || []).length);
      const actsBad = P.acts.filter(a => a.type && ((a.imported && !a.importDone && C.importIssues(P, a).length) || C.actView(P, a).warnings.length)).length;
      set('acts', actsBad);
      // истёкший документ — проблема, только пока материал ещё на объекте (остаток не израсходован)
      const expired = C.materialBalance(P).filter(x => C.matExpired(x.m, today) && (x.rest === null || x.rest > 0)).length;
      set('materials', expired, expired > 0);
      const chk = C.projectCheck(P), errs = chk.filter(x => x.lvl === 'err').length;
      set('check', errs || chk.length, errs > 0);
      set('rd', chk.filter(x => x.where === '#/rd').length);
    } catch (e) { console.warn(e); }
  }
  // переключение не меняет «время изменения» проекта (иначе синхронизация считала бы его изменённым)
  function switchTo(id) { store.current = id; P = store.projects[id]; if (!P.updatedAt) P.updatedAt = new Date().toISOString(); saveStore(); render(); updateHeader(); }
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { } }
  window.addEventListener('hashchange', () => { closeDialog(); render(); window.scrollTo(0, 0); });
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#bnMenu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#qsBtn').addEventListener('click', () => quickSearch());
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  // ================= файлы проекта =================
  const safeName = t => String(t || 'документ').replace(/[\\/:*?"<>|\n\r]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

  function saveFile() {
    const blob = new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' });
    const st = P.settings;
    deliver(blob, safeName([st.shortName, st.objectName].filter(Boolean).join(' — ') || 'Проект ИД') + '.idproj.json', true);
  }
  $('#saveFileTop').addEventListener('click', saveFile);
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let p;
      try { p = JSON.parse(rd.result); } catch (err) { toast('Файл не читается: это не проект'); return; }
      if (!p || (p.app !== 'id-generator' && !p.acts)) { toast('Это не файл проекта «Генератор ИД»'); return; }
      p = C.normalize(p);
      const doOpen = (asNew) => { if (asNew) p.id = C.uid(); store.projects[p.id] = p; switchTo(p.id); toast('Проект открыт: ' + projTitle(p)); };
      if (store.projects[p.id]) {
        const d = document.createElement('div');
        d.innerHTML = '<p>Проект «' + esc(projTitle(p)) + '» уже есть на этом устройстве. Заменить его версией из файла или открыть как отдельный проект?</p>';
        openDialog('Открытие проекта', d, ['spacer', { label: 'Отмена', onClick: closeDialog }, { label: 'Отдельной копией', onClick: () => { closeDialog(); doOpen(true); } }, { label: 'Заменить', cls: 'btn-primary', onClick: () => { closeDialog(); doOpen(false); } }]);
      } else doOpen(false);
    };
    rd.readAsText(f);
  });

  // ================= PDF =================
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => { delete loaded[src]; rej(new Error('Не загрузился ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  async function pdfLibs() {
    await loadScript('vendor/pdfmake.min.js');
    await loadScript('vendor/vfs_tinos.js');
    await loadScript('js/pdf.js');
  }
  function busy(text) {
    const d = document.createElement('div');
    d.innerHTML = '<p style="display:flex;gap:10px;align-items:center"><span class="spinner"></span> ' + esc(text) + '</p>';
    openDialog('Формирование', d, []);
  }
  // формат выгрузки: PDF или Word (.docx) — переключатель на страницах с печатью, запоминается на устройстве
  const outFmt = () => { try { return localStorage.getItem('idgen.outFormat') === 'docx' ? 'docx' : 'pdf'; } catch (e) { return 'pdf'; } };
  // кнопка с выпадающим списком: items — [[подпись (html), действие], …] или функция, которая их вернёт (подписи на момент открытия)
  function ddBtn(label, items, cls) {
    const w = document.createElement('div'); w.className = 'dd';
    const m = document.createElement('div'); m.className = 'dd-menu';
    const close = () => { w.classList.remove('open'); document.removeEventListener('click', close); };
    const b = btn(label, e => {
      e.stopPropagation();
      if (w.classList.contains('open')) { close(); return; }
      m.innerHTML = '';
      (typeof items === 'function' ? items() : items).forEach(([l, fn]) => {
        const x = document.createElement('button'); x.type = 'button'; x.innerHTML = l;
        x.addEventListener('click', () => { close(); fn(); }); m.appendChild(x);
      });
      w.classList.add('open'); setTimeout(() => document.addEventListener('click', close));
    }, cls);
    w.append(b, m); return w;
  }
  // «?» с подсказкой при наведении / нажатии
  function helpTip(text) {
    const t = document.createElement('span'); t.className = 'help-q'; t.tabIndex = 0; t.textContent = '?'; t.dataset.tip = text;
    return t;
  }
  // вкладки внутри экрана (без смены адреса): items — [[ключ, подпись], …]; возвращает { bar, panes }
  function pageTabs(items, active, onSwitch) {
    const bar = document.createElement('div'); bar.className = 'subtabs';
    const panes = {};
    if (!items.some(x => x[0] === active)) active = items[0][0];
    items.forEach(([k, label]) => {
      const a = document.createElement('a'); a.tabIndex = 0; a.textContent = label; a.className = k === active ? 'on' : '';
      const p = document.createElement('div'); p.hidden = k !== active; panes[k] = p;
      const go = () => { $$('a', bar).forEach(x => x.classList.toggle('on', x === a)); Object.keys(panes).forEach(x => { panes[x].hidden = x !== k; }); onSwitch && onSwitch(k); };
      a.addEventListener('click', go); a.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      bar.appendChild(a);
    });
    return { bar, panes };
  }
  function fmtSwitch() {
    const w = document.createElement('div'); w.className = 'seg'; w.title = 'В каком формате выгружать документы';
    const draw = () => {
      w.innerHTML = '<span class="muted small">Формат:</span>' + [['pdf', 'PDF'], ['docx', 'Word']].map(([v, l]) => '<button type="button" class="btn btn-sm' + (outFmt() === v ? ' btn-primary' : '') + '" data-v="' + v + '">' + l + '</button>').join('');
      $$('button', w).forEach(b => b.addEventListener('click', () => { try { localStorage.setItem('idgen.outFormat', b.dataset.v); } catch (e) { } draw(); toast(b.dataset.v === 'docx' ? 'Документы будут выгружаться в Word (.docx) — их можно править' : 'Документы будут выгружаться в PDF'); }));
    };
    draw(); return w;
  }
  async function docBlob(ddFn) {
    if (outFmt() === 'docx') { await loadScript('vendor/jszip.min.js'); await loadScript('js/docx.js'); return { blob: await IDDocx.toBlob(ddFn()), ext: '.docx' }; }
    return { blob: await IDPdf.toBlob(ddFn()), ext: '.pdf' };
  }
  async function makeDoc(name, ddFn) {
    busy('Формирую ' + name + '…');
    try {
      await pdfLibs();
      const r = await docBlob(ddFn);
      deliver(r.blob, safeName(name) + r.ext);
    } catch (e) { console.error(e); closeDialog(); toast('Ошибка: ' + e.message); }
  }
  function actFileName(a) { const v = C.actView(P, a); return safeName(a.type + ' № ' + v.number + (v.date ? ' от ' + C.fmtDate(v.date) : '')); }
  // уведомление о готовности к освидетельствованию: дата осмотра и вызывать ли авторский надзор
  function makeNotice(acts) {
    const d = document.createElement('div');
    const def = acts.map(a => a.actDate || a.end).filter(Boolean).sort()[0] || '';
    d.innerHTML = '<p class="small muted">Актов: ' + acts.length + '. Письмо — от исполнителя работ застройщику (техзаказчику) и его стройконтролю; подписывает представитель подрядчика.</p>' +
      '<label class="field"><span>Дата освидетельствования</span><input type="date" data-k="date"></label>' +
      '<label class="check"><input type="checkbox" data-k="designer"> Вызвать также авторский надзор (проектировщика)</label>';
    $('[data-k=date]', d).value = def;
    openDialog('Уведомление о вызове на освидетельствование', d, ['spacer', { label: 'Отмена', onClick: closeDialog }, {
      label: 'Сформировать', cls: 'btn-primary', onClick: () => {
        const o = { date: $('[data-k=date]', d).value, designer: $('[data-k=designer]', d).checked };
        makeDoc('Уведомление о вызове ' + (acts.length === 1 ? acts[0].type + ' № ' + C.actNumber(P, acts[0]) : 'на освидетельствование (' + acts.length + ')'), () => IDPdf.noticeDoc(P, acts, o));
      }
    }]);
  }
  // номер на момент печати: проверка комплекта заметит, если он потом сдвинется (удалили / переставили акт выше)
  function markPrinted(list) { list.forEach(a => { if (a.type) a.printedNo = C.actNumber(P, a); }); touch(); }
  function makeAct(a) {
    if (!a.type) { toast('У акта не указан тип'); return; }
    markPrinted([a]);
    makeDoc(actFileName(a), () => IDPdf.actDoc(P, a));
  }
  async function makeZip(name, items) {
    busy('Формирую ' + items.length + ' файл(ов)…');
    try {
      await pdfLibs(); await loadScript('vendor/jszip.min.js');
      const zip = new JSZip();
      const used = {};
      for (let i = 0; i < items.length; i++) {
        $('#dlgBody').innerHTML = '<p style="display:flex;gap:10px;align-items:center"><span class="spinner"></span> ' + (i + 1) + ' из ' + items.length + ': ' + esc(items[i][0]) + '</p>';
        let fn = items[i][0].split('/').map(safeName).join('/'); if (used[fn]) fn += ' (' + (++used[fn]) + ')'; else used[fn] = 1;
        const r = await docBlob(items[i][1]);
        zip.file(fn + r.ext, r.blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      deliver(blob, safeName(name + ' ' + (P.settings.objectName || '')) + '.zip');
    } catch (e) { console.error(e); closeDialog(); toast('Ошибка: ' + e.message); }
  }
  // организации / представители, «засветившиеся» в загруженных документах (P.candidates): принять — откроется карточка
  // с заполненными полями, после сохранения кандидат уходит из списка; отклонить — убрать из списка
  function candidatesPanel(el, kind, after) {
    const draw = () => {
      el.innerHTML = '';
      const exists = c => kind === 'org'
        ? P.orgs.some(o => (c.data.inn && o.inn === c.data.inn) || C.s(o.name).toLowerCase().replace(/[«»"\s]/g, '') === C.s(c.data.name).toLowerCase().replace(/[«»"\s]/g, ''))
        : P.people.some(r => C.shortName(r.fullName).replace(/[\s.]/g, '').toLowerCase() === C.shortName(c.data.fullName).replace(/[\s.]/g, '').toLowerCase() && (!c.data.role || r.role === c.data.role));
      // уже заведённые — убираем из списка
      P.candidates = (P.candidates || []).filter(c => c.kind !== kind || !exists(c));
      const list = P.candidates.filter(c => c.kind === kind);
      if (!list.length) return;
      const box = card((kind === 'org' ? 'Организации' : 'Представители') + ' из загруженных документов (' + list.length + ')', [para('Нашлись в документах, но ещё не заведены в проекте. «Принять» откроет карточку с уже заполненными полями — проверьте и сохраните.')]);
      list.forEach(c => {
        const n = document.createElement('div'); n.className = 'row-note';
        const d = c.data;
        n.innerHTML = '<span><b>' + esc(kind === 'org' ? (d.name || d.key) : d.fullName) + '</b>' + esc(kind === 'org'
          ? (d.role ? ' — ' + d.role : '') + (d.inn ? ', ИНН ' + d.inn : '') + (d.ogrn ? ', ОГРН ' + d.ogrn : '')
          : (d.position ? ', ' + d.position.toLowerCase() : '') + (d.role ? ' — ' + d.role : '') + (d.orgKey || d._org ? ' (' + (d.orgKey || d._org) + ')' : '') + (d.authDoc ? ', ' + d.authDoc : '')) +
          '<br><span class="muted">из: ' + esc(c.source || 'документа') + '</span></span>';
        n.appendChild(btn('Принять', () => {
          const it = Object.assign({ id: C.uid() }, JSON.parse(JSON.stringify(d)));
          // организация представителя — если её уже приняли (по названию из документа)
          if (kind === 'person') { if (!it.orgKey && it._org) { const nm = x => C.s(x).toLowerCase().replace(/[«»"\s]/g, '').replace(/^(ооо|зао|ао|пао|оао|ип)/, ''); const o = P.orgs.find(o => nm(o.name) === nm(it._org) || nm(o.key) === nm(it._org)); if (o) it.orgKey = o.key; } delete it._org; }
          if (kind === 'org' && (!it.key || P.orgs.some(o => o.key === it.key))) { let k = it.key || (d.name || 'Организация').replace(/^(ООО|ЗАО|АО|ПАО|ИП)\s*/, '').replace(/[«»"]/g, '').slice(0, 30), i = 2; const b = k; while (P.orgs.some(o => o.key === k)) k = b + ' ' + i++; it.key = k; }
          openEditor(kind === 'org' ? 'orgs' : 'people', kind === 'org' ? P.orgs : P.people, it, true, () => { P.candidates = P.candidates.filter(x => x !== c); touch(); draw(); after && after(); });
        }, 'btn-sm btn-primary'));
        n.appendChild(btn('Отклонить', () => { P.candidates = P.candidates.filter(x => x !== c); touch(); draw(); }, 'btn-sm'));
        box.appendChild(n);
      });
      el.appendChild(box);
    };
    draw();
  }

  // пакетная правка актов из чужой ИД: раздел, замена текста (чужие шифры в пп. 4, 6, 7), подписанты, «приведены»
  function batchFixImported(list, after) {
    // самый частый чужой шифр из пп. 4, 6 — подставим в «Найти»
    const cnt = {};
    list.forEach(a => C.importIssues(P, a).forEach(t => { const m = /шифр «([^»]+)» — его нет/.exec(t); if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1; }));
    const top = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0] || '';
    const w = { section: '', find: top, repl: '', markDone: '' };
    const body = document.createElement('div');
    body.appendChild(para('Изменения применятся ко всем ' + list.length + ' актам из чужой ИД, которые ещё не приведены. Пустые поля — не менять. Перед изменением сохраняется снимок проекта (можно откатить в «Проекты и файлы → История версий»).'));
    const ppl = () => P.people.map(r => ({ v: r.id, l: C.shortName(r.fullName) + (r.position ? ', ' + r.position.toLowerCase() : '') + ' — ' + r.role }));
    body.appendChild(formGrid(w, [
      F('section', 'Раздел для всех актов', 'combo', { opts: () => P.lists.sections, hint: 'Шифр и листы в п. 2 берутся из раздела' }),
      F('find', 'Заменить текст (пп. 4, 6, 7, доп. сведения, приложения)', 'text', { wide: 1, hint: top ? 'Подставлен самый частый чужой шифр' : 'Например, чужой шифр проекта' }),
      F('repl', 'на', 'text', { wide: 1, ph: (C.rdFor(P, { section: w.section || (list[0] && list[0].section) }, null).code || ''), hint: 'Пусто — подставится шифр раздела акта' }),
      ...C.REP_ROLES.slice(0, 4).map((role, i) => F('rep' + i, 'Подписант: ' + role.replace(/^\d\.\s*/, ''), 'select', { opts: ppl, empty: 'не менять' })),
      F('markDone', 'Отметить все как приведённые к нашему формату', 'check', { wide: 1 })
    ]));
    openDialog('Исправить акты из чужой ИД', body, ['spacer', { label: 'Отмена', onClick: closeDialog }, {
      label: 'Применить', cls: 'btn-primary', onClick: () => {
        if (window.IDBackup) IDBackup.snapshot('перед пакетной правкой чужой ИД');
        let n = 0;
        const esc_ = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        list.forEach(a => {
          if (w.section) a.section = w.section;
          if (w.find) {
            const to = w.repl || C.rdFor(P, a, null).code || '';
            const re = new RegExp(esc_(String(w.find).trim()).replace(/\s+/g, '\\s*'), 'gi');
            ['docs', 'manualNorms', 'manualNext', 'extra', 'manualAttach'].forEach(k => { if (a[k] && re.test(a[k])) { a[k] = a[k].replace(re, to); n++; } re.lastIndex = 0; });
          }
          C.REP_ROLES.slice(0, 4).forEach((r, i) => { if (w['rep' + i]) a['rep' + i] = w['rep' + i]; });
          if (w.markDone) a.importDone = 1;
        });
        touch(); closeDialog(); after && after();
        toast('Готово: актов ' + list.length + (w.find ? ', замен текста: ' + n : ''));
      }
    }]);
  }

  function batchActs(mode) {
    let acts = P.acts.filter(a => a.print && a.type);
    const go = (list, m) => {
      if (!list.length) { toast('Нет актов'); return; }
      markPrinted(list);
      if (m === 'one') makeDoc('Акты ' + (P.settings.objectName || ''), () => IDPdf.actsDoc(P, list));
      else makeZip('Акты', list.map(a => [actFileName(a), () => IDPdf.actDoc(P, a)]));
    };
    const ask = (list) => {
      if (mode) { go(list, mode); return; }
      const d = document.createElement('div');
      d.innerHTML = '<p>Актов к выгрузке: ' + list.length + '.</p><p class="muted small">ZIP — каждый акт отдельным PDF-файлом. «Одним PDF» — все акты подряд в одном файле.</p>';
      openDialog('Пакетная выгрузка', d, ['spacer', { label: 'Одним PDF', onClick: () => go(list, 'one') }, { label: 'ZIP', cls: 'btn-primary', onClick: () => go(list, 'zip') }]);
    };
    if (!acts.length) {
      const all = P.acts.filter(a => a.type);
      if (!all.length) { toast('В журнале нет актов'); return; }
      confirmBox('Нет отмеченных актов. Выгрузить все (' + all.length + ')?', 'Выгрузить все', () => ask(all));
    } else ask(acts);
  }
  function fullSet() {
    markPrinted(P.acts);
    const items = P.acts.filter(a => a.type).map(a => ['Акты/' + actFileName(a), () => IDPdf.actDoc(P, a)]);
    items.push(['Реестр ИД', () => IDPdf.registryDoc(P)], ['ЖВК', () => IDPdf.jvkDoc(P)], ['Ведомость материалов', () => IDPdf.balanceDoc(P)], ['Общий журнал работ', () => IDPdf.ozhrDoc(P)]);
    if (P.smeta.some(r => r.name)) items.push(['КС/Смета', () => IDPdf.smetaDoc(P)], ['КС/КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P)], ['КС/КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P)]);
    makeZip('Комплект ИД', items);
  }

  // готовый файл: открыть / скачать / поделиться
  let lastUrl = null;
  function deliver(blob, filename, quiet) {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    const url = lastUrl = URL.createObjectURL(blob);
    const d = document.createElement('div');
    const kb = Math.max(1, Math.round(blob.size / 1024));
    d.innerHTML = '<p><b>' + esc(filename) + '</b></p><p class="muted small">' + (kb > 1024 ? (kb / 1024).toFixed(1) + ' МБ' : kb + ' КБ') + '</p>';
    const buttons = ['spacer'];
    let file = null;
    try { file = new File([blob], filename, { type: blob.type }); } catch (e) { /* старый браузер */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      buttons.push({ label: 'Поделиться', onClick: () => navigator.share({ files: [file], title: filename }).catch(() => { }) });
    }
    if (blob.type === 'application/pdf') buttons.push({ label: 'Открыть', href: url, target: '_blank' });
    buttons.push({ label: 'Скачать', cls: 'btn-primary', href: url, download: filename, onClick: () => setTimeout(closeDialog, 300) });
    openDialog(quiet ? 'Сохранение проекта' : 'Готово', d, buttons);
  }

  // ================= установка PWA =================
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  async function installApp() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => { });
    deferredInstall = null; render();
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
  }

  // До ноября 2026 приложение работало на localhost:8765, где теперь «Отчёты» и «Перемещение».
  // Проекты, сохранённые там в браузере, забираем через невидимую страницу со старого адреса (её отдаёт serve.ps1).
  function migrateFromOldAddress() {
    const DONE = 'idgen.migrated8765';
    if (location.hostname !== 'localhost' || location.port === '8765') return;
    try { if (localStorage.getItem(DONE)) return; } catch (e) { return; }
    const fr = document.createElement('iframe');
    fr.hidden = true; fr.src = 'http://localhost:8765/idgen-migrate.html';
    const finish = () => { window.removeEventListener('message', onMsg); fr.remove(); };
    const onMsg = e => {
      if (e.origin !== 'http://localhost:8765' || !e.data || !e.data.idgenMigrate) return;
      finish();
      let old = null;
      try { old = e.data.data ? JSON.parse(e.data.data) : null; } catch (err) { old = null; }
      const added = [];
      if (old && old.projects) {
        Object.values(old.projects).forEach(p => {
          // проект уже есть здесь (тот же id) — оставляем более свежую версию
          const here = store.projects[p.id];
          if (here && (here.updatedAt || '') >= (p.updatedAt || '')) return;
          store.projects[p.id] = C.normalize(p);
          added.push(p);
        });
        // пустой проект, созданный при первом запуске на новом адресе, больше не нужен
        Object.keys(store.projects).forEach(id => { const p = store.projects[id]; if (added.length && !p.updatedAt && !p.acts.length && !p.orgs.length && !p.materials.length) delete store.projects[id]; });
        if (added.length) { store.current = old.current && store.projects[old.current] ? old.current : added[0].id; P = store.projects[store.current]; }
      }
      try {
        if (e.data.ai && !localStorage.getItem('idgen.ai')) localStorage.setItem('idgen.ai', e.data.ai);
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
        localStorage.setItem(DONE, new Date().toISOString());
      } catch (err) { return; }
      if (added.length) { render(); toast('Перенесены проекты со старого адреса: ' + added.length); }
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(fr);
    // старый адрес недоступен (сервер запущен без него) — попробуем при следующем запуске
    setTimeout(finish, 15000);
  }
  // предупреждение при закрытии, если сохранение ещё не произошло
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { } });
  window.IDApp = {
    get project() { return P; }, store: () => store,
    // для модуля загрузки документов (importer.js)
    ui: { esc, head, card, btn, para, toast, undoable, openDialog, closeDialog, confirmBox, loadScript, main: () => main },
    touch, render, projTitle,
    openProject(p, replaceId) {
      p = C.normalize(p);
      if (replaceId) { delete store.projects[replaceId]; p.id = replaceId; }
      store.projects[p.id] = p; switchTo(p.id);
    },
    registerView(name, fn) { VIEWS[name] = fn; },
    // для синхронизации (sync.js): заменить / добавить / удалить проект, не меняя его «время изменения»
    putProject(p) {
      p = C.normalize(p);
      store.projects[p.id] = p;
      if (P && P.id === p.id) {
        // открытая карточка держит старую копию — закрываем, чтобы правки не ушли «в никуда»
        if ($('#dlg').open) { closeDialog(); toast('Проект обновлён с другого устройства — откройте карточку заново'); }
        P = p; render(); updateHeader();
      }
      saveStore();
    },
    removeProject(id) {
      delete store.projects[id];
      if (P && P.id === id) {
        const ids = Object.keys(store.projects);
        if (!ids.length) { const np = C.emptyProject(); np.updatedAt = new Date().toISOString(); store.projects[np.id] = np; ids.push(np.id); }
        switchTo(ids[0]);
      } else saveStore();
    }
  };
  // ================= старт =================
  // после объявления IDApp: экраны используют модули backup.js / sync.js, которым нужен IDApp
  loadStore();
  render();
  setSaveState('');
  { const v = $('#appVer'); if (v) v.textContent = 'Версия ' + APP_VERSION + (location.hostname === 'localhost' ? ' · ПК' : ' · ' + location.hostname); }
  migrateFromOldAddress();
  document.dispatchEvent(new Event('idapp-ready'));
  if (location.hash.startsWith('#/import')) render();
})();
