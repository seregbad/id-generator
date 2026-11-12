/* Генератор ИД — интерфейс */
(function () {
  'use strict';
  const C = window.IDCore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = t => String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE_KEY = 'idgen.v1';
  // версия приложения — видна внизу меню; меняется вместе с VERSION в sw.js
  const APP_VERSION = '48 (12.11.2026)';

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
  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ================= диалог =================
  const dlg = $('#dlg');
  let dlgOnClose = null;
  function openDialog(title, bodyEl, buttons, onClose) {
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
  dlg.addEventListener('close', () => { const f = dlgOnClose; dlgOnClose = null; if (f) f(); });
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
  const pendingOf = r => (r.pendingDs || []).filter(x => C.dsById(P, x.dsId));
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
      title: 'Материалы', one: 'Материал',
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
      row: m => ({
        num: C.matNo(P, m), title: C.matName(m) || 'Без названия', sub: C.matDocs(m) || 'нет документов о качестве',
        badges: [C.matExpired(m) ? { t: 'документ истёк ' + C.fmtDate(C.matUntil(m)), c: 'warn' } : null, m.vk === 'Не соответствует' ? { t: 'не соответствует', c: 'danger' } : null],
        warn: C.matExpired(m)
      }),
      preview: m => C.matText(m),
      search: m => [m.name, m.mark, m.doc1No, m.doc2No, m.supplier].join(' ')
    },
    works: {
      title: 'Справочник работ', one: 'Вид работ',
      intro: 'Заготовки текстов для актов. Пустые поля акта берут текст отсюда. Нормативы сверьте со своим проектом и допишите пункты СП.',
      fields: () => [
        F('code', 'Код', 'text', { hint: 'Например ФП-01' }),
        F('actType', 'Тип акта', 'select', { opts: () => P.lists.actTypes }),
        F('section', 'Раздел', 'combo', { opts: () => P.lists.sections, hint: 'Шифр РД берётся по разделу из таблицы «Разделы РД»' }),
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
          F('manualNo', '№ вручную', 'text', { ph: C.actNumber(P, a) || 'авто', hint: 'Пусто — номер считается сам' }),
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
          F('sheets', 'Листы проекта', 'text', { hint: (() => { const v = C.actView(P, a); return 'В акте, п. 2: «' + (v.project || '—') + '» — шифр взят: ' + v.rdSource + '. Листы добавляются после шифра.'; })() }),
          F('materials', 'Материалы', 'mats', { wide: 1, show: () => a.type === 'АОСР' || isAOOK }),
          F('forceRegistry', 'Реестр документов о качестве — приложением к акту, даже если документов 5 и меньше (при 6 и больше — всегда, по форме 344/пр)', 'check', { wide: 1, show: () => a.type === 'АОСР' || isAOOK }),
          F('docs', isAOOK ? 'Исполнительные геодезические схемы (п. 5а)' : 'Исполнительные схемы, документы (п. 4)', 'textarea', { wide: 1, ph: w ? w.docs : '' }),
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
      onChange: (a, k) => {
        if (k === 'workId') {
          const w = P.works.find(x => x.id === a.workId);
          if (w) { if (!a.type && w.actType) a.type = w.actType; if (!a.section && w.section) a.section = w.section; }
        }
      },
      row: a => {
        const v = C.actView(P, a);
        return {
          num: '', title: (a.type ? a.type + ' № ' + v.number + ' — ' : '') + (v.name || 'Без наименования'),
          sub: [a.start || a.end ? C.fmtDate(a.start) + ' – ' + C.fmtDate(a.end) : '', v.date ? 'акт от ' + C.fmtDate(v.date) : '', v.signers].filter(Boolean).join(' · '),
          badges: v.warnings.map(w => ({ t: w, c: 'warn' })),
          warn: v.warnings.length > 0
        };
      },
      search: a => { const v = C.actView(P, a); return [v.number, v.name, a.type, a.section].join(' '); }
    },
    rdSections: {
      title: 'Разделы РД', one: 'Раздел рабочей документации',
      fields: () => [
        F('section', 'Раздел', 'combo', { req: 1, opts: () => P.lists.sections, hint: 'Как в поле «Раздел» видов работ и актов: КЖ, КМ, АР…' }),
        F('code', 'Шифр раздела РД', 'text', { req: 1, hint: 'Как в штампе чертежей, например 038-2024-КЖ0' }),
        F('docName', 'Наименование раздела', 'text', { wide: 1, ph: P.settings.projectDocName || '', hint: 'Например: Рабочая документация. Конструкции железобетонные. Пусто — наименование из «Объекта и договора»' }),
        F('designerKey', 'Проектировщик раздела', 'select', { opts: orgKeys, empty: 'Проектировщик объекта' + (C.designerOrg(P) ? ': ' + C.designerOrg(P).key : ''), hint: 'Если раздел разрабатывала другая организация' })
      ],
      row: r => ({
        title: (r.section || '?') + ' — шифр ' + (r.code || 'не указан'),
        sub: C.rdFor(P, { section: r.section }, null).projectDoc,
        badges: [P.works.filter(w => w.section === r.section).length ? { t: 'видов работ: ' + P.works.filter(w => w.section === r.section).length } : { t: 'нет видов работ с этим разделом', c: 'warn' }]
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
          badges: [n ? { t: 'позиций в смете: ' + n, c: 'ok' } : null, ex ? { t: 'исключено позиций: ' + ex, c: 'warn' } : null, !d.no || !d.date ? { t: 'нет номера или даты', c: 'warn' } : null]
        };
      },
      search: d => [d.no, d.subject, d.note].join(' ')
    },
    smeta: {
      title: 'Позиции сметы', one: 'Позиция сметы',
      fields: () => [
        F('name', 'Наименование работ и затрат', 'textarea', { req: 1, wide: 1 }),
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
          title: r.name || 'Без названия', sub: C.qty(r.qty) + ' ' + (r.unit || '') + ' × ' + C.money(c.unitPrice) + ' = ' + C.money(c.total) + ' руб.' + (before ? ' · по прошлым КС: ' + C.qty(before) : '') +
            (was ? ' · по договору было: ' + C.qty(was.qty) + ' × ' + C.money(C.num(was.priceWork) + C.num(was.priceMat)) + ' = ' + C.money(C.smetaRow(was).total) : ''),
          badges: [ds ? { t: 'ДС № ' + (ds.no || '—'), c: 'ok' } : null, ex ? { t: 'исключена по ДС № ' + (ex.no || '—'), c: 'warn' } : null,
            ...chs.map(ch => ({ t: 'изменена по ДС № ' + (C.dsById(P, ch.dsId).no || '—') })),
            pendingOf(r).length ? { t: 'есть изменение по ДС — не принято', c: 'warn' } : null,
            left < -1e-6 ? { t: 'больше, чем в смете', c: 'danger' } : before || C.num(r.qtyNow) ? { t: 'осталось ' + C.qty(Math.max(0, left)) + ' ' + (r.unit || '') } : null],
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
    wrap.innerHTML = '<span>' + esc(f.l) + (f.req ? ' <b>*</b>' : '') + '</span>';
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
  function openEditor(schemaKey, arr, item, isNew, after) {
    const sc = SCHEMA[schemaKey];
    const work = JSON.parse(JSON.stringify(item));
    const body = document.createElement('div');
    const draw = () => {
      body.innerHTML = '';
      const g = document.createElement('div'); g.className = 'grid';
      sc.fields(work).forEach(f => {
        if (f.show && !f.show(work)) return;
        g.appendChild(fieldEl(f, work, (ff, val, rerender) => {
          work[ff.k] = val;
          if (sc.onChange) sc.onChange(work, ff.k);
          if (ff.rerender && (rerender || ff.t === 'select')) { const top = $('#dlgBody').scrollTop; draw(); $('#dlgBody').scrollTop = top; }
          else if (sc.preview) updPrev();
        }));
      });
      body.appendChild(g);
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
      confirmBox(refs ? 'На организацию «' + item.key + '» ссылаются: ' + refs + '. После удаления эти ссылки станут пустыми. Удалить?' : 'Удалить запись?', 'Удалить', () => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); touch(); after && after(); }, true);
    } });
    buttons.push('spacer', { label: 'Отмена', onClick: closeDialog }, {
      label: 'Сохранить', cls: 'btn-primary', onClick: () => {
        const miss = sc.fields(work).filter(f => f.req && (!f.show || f.show(work)) && (work[f.k] === undefined || work[f.k] === ''));
        if (miss.length) { toast('Заполните: ' + miss.map(f => f.l).join(', ')); return; }
        if (schemaKey === 'orgs') {
          work.key = String(work.key).trim();
          if (P.orgs.some(o => o !== item && o.key === work.key)) { toast('Ключ «' + work.key + '» уже занят другой организацией'); return; }
          if (!isNew && item.key && item.key !== work.key) renameOrgKey(item.key, work.key);
        }
        Object.keys(item).forEach(k => delete item[k]);
        Object.assign(item, work);
        if (isNew) arr.push(item);
        touch(); closeDialog(); after && after();
      }
    });
    openDialog((isNew ? 'Новая запись: ' : '') + sc.one, body, buttons);
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
    (opts.tools || []).forEach(t => tb.appendChild(t));
    const list = document.createElement('div'); list.className = 'list';
    wrap.append(tb, list);
    el.appendChild(wrap);
    const draw = () => {
      const arr = getArr();
      list.innerHTML = '';
      const items = arr.filter(it => !q || (sc.search ? sc.search(it) : JSON.stringify(it)).toLowerCase().includes(q));
      if (!items.length) { list.innerHTML = '<div class="empty">' + (arr.length ? 'Ничего не найдено' : 'Пока пусто. Нажмите «+ Добавить».') + '</div>'; }
      items.forEach(it => {
        const r = sc.row(it);
        const row = document.createElement('div'); row.className = 'row' + (r.warn ? ' warn' : '');
        let html = '';
        if (opts.check) html += '<label class="check" title="' + esc(opts.check.title) + '"><input type="checkbox" data-chk' + (it[opts.check.key] ? ' checked' : '') + '></label>';
        if (r.num) html += '<div class="num">' + esc(r.num) + '</div>';
        html += '<div class="row-main"><div class="row-title">' + esc(r.title) + '</div>';
        if (r.sub) html += '<div class="row-sub">' + esc(r.sub) + '</div>';
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
        row.addEventListener('click', e => {
          if (e.target.closest('.row-inline')) return;
          const btn = e.target.closest('button');
          if (btn && btn.dataset.note) { const [ni, bi] = btn.dataset.note.split(':').map(Number); r.notes[ni].buttons[bi].onClick(); return; }
          if (e.target.closest('.row-note')) return;
          const chk = e.target.closest('[data-chk]');
          if (chk) { it[opts.check.key] = chk.checked ? 1 : ''; touch(); opts.onCheck && opts.onCheck(); return; }
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
  function para(html, cls) { const p = document.createElement('p'); p.className = cls || 'muted small'; p.innerHTML = html; return p; }

  const VIEWS = {
    settings() {
      main.appendChild(head('Объект и договор', 'Общие данные для всех документов'));
      const st = P.settings;
      main.appendChild(card('1. Объект и договор', [formGrid(st, [
        F('shortName', 'Короткое имя проекта', 'text', { hint: 'Для списка проектов: ВИТ, ТурбоТехМаш… В документы не попадает' }),
        F('objectName', 'Наименование объекта (как в проекте)', 'text', { wide: 1 }),
        F('address', 'Адрес объекта', 'textarea', { wide: 1 }),
        F('contractNo', 'Номер договора подряда'), F('contractDate', 'Дата договора', 'date'),
        F('contractPrice', 'Цена договора, руб. с НДС', 'number', { hint: 'Для КС-2 («договорная стоимость») и проверки: КС не больше цены договора. Пусто — по смете' }),
        F('projectCode', 'Шифр проекта (общий)', 'text', { hint: 'Используется, если для раздела не задан свой шифр в «Справочник работ → Разделы РД»' }),
        F('copies', 'Экземпляров акта по умолчанию', 'number'),
        F('projectDocName', 'Наименование проектной / рабочей документации', 'text', { wide: 1, hint: 'В актах дополняется «разработчик …» по проектировщику' }),
        F('vat', 'Ставка НДС (0,22 = 22%)', 'number')
      ], () => { updateHeader(); updPrice(); })]));
      // дополнительные соглашения: меняют цену, сроки, добавляют или исключают позиции сметы
      const dsCard = card('2. Дополнительные соглашения', [para('Каждое ДС — отдельной строкой: на сколько меняется цена договора (или новая цена) и сроки. Дополнительные работы добавьте в «Смету» с основанием «ДС № …», исключённые — отметьте «Исключена из договора». ДС можно загрузить файлом через «Загрузку документов».')]);
      const priceBox = document.createElement('div'); priceBox.className = 'kpi'; priceBox.style.marginBottom = '10px';
      const updPrice = () => {
        const cp = C.contractPriceNow(P);
        priceBox.style.display = cp.hasDs ? '' : 'none';
        priceBox.innerHTML = '<div><span class="muted small">Цена по договору</span><b>' + C.money(cp.base) + '</b></div>' +
          cp.steps.map(x => '<div><span class="muted small">ДС № ' + esc(x.ds.no || '—') + '</span><b>' + (x.delta >= 0 ? '+' : '−') + C.money(Math.abs(x.delta)) + '</b></div>').join('') +
          '<div><span class="muted small">Цена с учётом ДС</span><b>' + C.money(cp.total) + '</b></div>';
      };
      dsCard.appendChild(priceBox);
      main.appendChild(dsCard);
      collection(dsCard, 'supplements', () => P.supplements, { noSearch: true, after: updPrice });
      const wd = C.workDates(P);
      if (P.supplements.some(d => d.startDate || d.endDate)) dsCard.appendChild(para('Сроки работ с учётом ДС: ' + esc((C.fmtDate(wd.start) || '…') + ' – ' + (C.fmtDate(wd.end) || '…'))));
      main.appendChild(card('Для общего журнала работ', [formGrid(st, [
        F('workKind', 'Вид работ', 'combo', { opts: () => ['строительство', 'реконструкция', 'капитальный ремонт'] }),
        F('permit', 'Разрешение на строительство', 'textarea', { wide: 1 }),
        F('expertise', 'Заключение экспертизы', 'textarea', { wide: 1 }),
        F('startDate', 'Начало работ', 'date'), F('endDate', 'Окончание работ', 'date'),
        F('objectInfo', 'Краткие характеристики объекта', 'textarea', { wide: 1 })
      ])]));
    },
    orgs() {
      const sc = SCHEMA.orgs;
      main.appendChild(head(sc.title, sc.intro));
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
      const ctl = collection(main, 'orgs', () => P.orgs, {
        after: () => drawTop(),
        onCopy: cp => { let k = cp.key + ' (копия)', n = 2; while (P.orgs.some(o => o.key === k)) k = cp.key + ' (копия ' + n++ + ')'; cp.key = k; }
      });
    },
    people() {
      const sc = SCHEMA.people;
      const others = Object.values(store.projects).filter(p => p.id !== P.id && p.people.length);
      main.appendChild(head(sc.title, sc.intro, others.length ? [btn('Взять из другого проекта…', () => peopleFromProject(others, () => ctl.draw()))] : []));
      const ctl = collection(main, 'people', () => P.people, { defaults: () => ({}) });
    },
    materials() {
      listView('materials', P.materials, () => P.materials, {
        inline: [
          { k: 'qty', l: 'Кол-во', t: 'number', cls: 'inl-s' },
          { k: 'unit', l: 'Ед. изм.', t: 'combo', opts: units, cls: 'inl-s' },
          { k: 'delivery', l: 'УПД / ТН №', t: 'text' },
          { k: 'deliveryDate', l: 'Дата поставки', t: 'date' }
        ]
      });
    },
    works() {
      const sc = SCHEMA.works;
      main.appendChild(head(sc.title, sc.intro));
      // разделы РД: шифр подставляется в п. 2 актов по разделу вида работ / акта
      const rdCard = card('Разделы рабочей документации — шифры', [para('Шифр и наименование раздела попадают в п. 2 актов «Работы выполнены по проектной документации». Акт берёт шифр по своему разделу; если раздел здесь не заведён — общий шифр из «Объекта и договора»' + (P.settings.projectCode ? ' (' + esc(P.settings.projectCode) + ')' : '') + '.')]);
      main.appendChild(rdCard);
      let worksCtl;
      collection(rdCard, 'rdSections', () => P.rdSections, {
        noSearch: true,
        after: () => {
          // новый раздел — сразу в список разделов, чтобы выбирался в видах работ и актах
          P.rdSections.forEach(r => { if (r.section && !P.lists.sections.includes(r.section)) P.lists.sections.push(r.section); });
          if (worksCtl) worksCtl.draw();
        }
      });
      worksCtl = collection(main, 'works', () => P.works);
    },
    acts() {
      const cntEl = document.createElement('span'); cntEl.className = 'muted small';
      const updCnt = () => { const n = P.acts.filter(a => a.print).length; cntEl.textContent = n ? 'Отмечено к печати: ' + n : ''; };
      main.appendChild(head('Журнал актов', 'Одна запись = один акт. Номер считается сам по типу и разделу (КЖ-01, КЖ-02…).', [
        btn('Отметить все', () => { const all = P.acts.every(a => a.print); P.acts.forEach(a => a.print = all ? '' : 1); touch(); ctl.draw(); }),
        btn('Уведомление по отмеченным', () => { const l = P.acts.filter(a => a.print && a.type); if (!l.length) toast('Отметьте акты галочкой «Печать»'); else makeNotice(l); }),
        btn('Выгрузить отмеченные…', () => batchActs(), 'btn-primary'), fmtSwitch()
      ]));
      main.appendChild(cntEl);
      const rem = reminders(); if (rem) main.appendChild(rem);
      const fit = document.createElement('label'); fit.className = 'check small';
      fit.innerHTML = '<input type="checkbox"' + (P.settings.fitActs !== false ? ' checked' : '') + '> Умещать акт на один лист, если он чуть-чуть не помещается (шрифт уменьшится, но не меньше 78 %)';
      fit.querySelector('input').addEventListener('change', e => { P.settings.fitActs = e.target.checked; touch(); });
      main.appendChild(fit);
      const reg = document.createElement('label'); reg.className = 'check small'; reg.style.display = 'block';
      reg.innerHTML = '<input type="checkbox"' + (P.settings.matRegistry !== false ? ' checked' : '') + '> Больше 5 документов о качестве — в п. 3 АОСР (п. 4 АООК) ссылка на реестр, реестр — отдельным листом приложения к акту';
      reg.querySelector('input').addEventListener('change', e => { P.settings.matRegistry = e.target.checked; touch(); });
      main.appendChild(reg);
      const ctl = collection(main, 'acts', () => P.acts, {
        check: { key: 'print', title: 'Печать' },
        onCheck: updCnt, after: updCnt,
        rowButtons: [{ icon: '&#128462;', title: 'PDF этого акта', onClick: a => makeAct(a) },
          { icon: '&#9993;', title: 'Уведомление о вызове на освидетельствование по этому акту', onClick: a => makeNotice([a]) },
          { icon: '&#10549;', title: 'Следующий акт: копия, даты — сразу после этого акта', onClick: a => nextAct(a) }],
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
      // «следующий захватка / этап»: те же поля, даты — сразу после этого акта, такой же длительности
      function nextAct(a) {
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
        touch(); ctl.draw();
        openEditor('acts', P.acts, cp, false, () => ctl.draw());
        toast('Создан следующий акт — проверьте оси, листы и материалы');
      }
    },
    smeta() {
      main.appendChild(head('Смета, КС-2, КС-3', C.vatTop(P) ? 'Цены — без НДС; НДС начисляется сверху (переключатель — в «Реквизитах КС-2 / КС-3»).' : 'Цены — с НДС, как в договоре; НДС выделяется «в т.ч.» (переключатель — в «Реквизитах КС-2 / КС-3»).', [
        btn('Смета', () => makeDoc('Смета', () => IDPdf.smetaDoc(P))),
        btn('КС-2', () => makeDoc('КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P))),
        btn('КС-3', () => makeDoc('КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P))),
        btn('Все три (ZIP)', () => makeZip('КС', [['Смета', () => IDPdf.smetaDoc(P)], ['КС-2 № ' + P.ks.number, () => IDPdf.ks2Doc(P)], ['КС-3 № ' + P.ks.number, () => IDPdf.ks3Doc(P)]]), 'btn-primary'),
        fmtSwitch()
      ]));
      const kpi = document.createElement('div'); kpi.className = 'kpi';
      const updKpi = () => {
        // все суммы в сводке — с НДС (цена договора тоже с НДС)
        const t = C.smetaTotals(P), k = C.ksTotals(P), before = C.vatSplit(P, C.ksDoneBefore(P)).gross;
        const price = C.contractPriceNow(P).total || C.smetaTotals(P, !!P.ks.worksOnly).gross;
        kpi.innerHTML = '<div><span class="muted small">Смета с НДС' + (t.top ? ' (без НДС ' + C.money(t.net) + ')' : '') + '</span><b>' + C.money(t.gross) + '</b></div>' +
          '<div><span class="muted small">в т.ч. НДС ' + t.vatPct + '%</span><b>' + C.money(t.vatSum) + '</b></div>' +
          '<div><span class="muted small">КС № ' + esc(P.ks.number || '—') + (C.ksPeriodMode(P) ? ' (объёмы за период)' : ' (вся смета)') + ', с НДС</span><b>' + C.money(k.gross) + '</b></div>' +
          (P.ksHistory.length ? '<div><span class="muted small">Закрыто КС: ' + P.ksHistory.length + '</span><b>' + C.money(before) + '</b></div>' +
            '<div><span class="muted small">Остаток по договору</span><b>' + C.money(price - before - k.gross) + '</b></div>' : '');
      };
      main.appendChild(card(null, [kpi]));
      const c = card('Позиции сметы', [para('Поле «В этой КС» — объём, выполненный за текущий отчётный период. Если оно заполнено хотя бы у одной позиции, КС-2 и КС-3 формируются только по таким позициям и на эти объёмы. Если везде пусто — на всю смету.')]);
      main.appendChild(c);
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
      const smetaCtl = collection(c, 'smeta', () => P.smeta, {
        noSearch: true, after: updKpi,
        inline: [{ k: 'qtyNow', l: 'В этой КС', t: 'number', cls: 'inl-s' }],
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
        } }],
        onInline: () => { updKpi(); smetaCtl && smetaCtl.draw(); }
      });
      smetaRedraw = () => { smetaCtl.draw(); updKpi(); drawPend(); };
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
      const hist = card('КС по объекту', []);
      main.appendChild(hist);
      const drawHist = () => {
        hist.querySelectorAll(':scope > :not(h2)').forEach(x => x.remove());
        if (P.ksHistory.length) {
          const t = document.createElement('table'); t.className = 't small';
          t.innerHTML = '<tr><th>№</th><th>Дата</th><th>Период</th><th style="text-align:right">Сумма, руб.</th></tr>' + P.ksHistory.map(h =>
            '<tr><td>' + esc(h.number) + '</td><td>' + esc(C.fmtDate(h.date)) + '</td><td>' + esc(C.fmtDate(h.periodFrom) + ' – ' + C.fmtDate(h.periodTo)) + '</td><td style="text-align:right">' + C.money(h.total) + '</td></tr>').join('');
          const w = document.createElement('div'); w.className = 'table-wrap'; w.appendChild(t); hist.appendChild(w);
        } else hist.appendChild(para('Закрытых КС пока нет. Когда КС подписана — закройте её: объёмы запомнятся, номер увеличится, а в КС-3 «с начала работ» и «с начала года» пойдёт нарастающий итог.'));
        const tb = document.createElement('div'); tb.className = 'toolbar'; tb.style.marginTop = '10px';
        tb.appendChild(btn('Закрыть КС № ' + (P.ks.number || '—') + ' и начать следующую', closeKs, 'btn-primary'));
        if (P.ksHistory.length) tb.appendChild(btn('Вернуть последнюю закрытую', reopenKs));
        hist.appendChild(tb);
      };
      const closeKs = () => {
        const k = C.ksTotals(P);
        if (!k.total) { toast('В КС нет сумм'); return; }
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
          P.smeta.forEach(r => { r.qtyNow = ''; });
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
      main.appendChild(card('Реквизиты КС-2 / КС-3', [formGrid(P.ks, [
        F('vatMode', 'НДС в смете и КС', 'select', { wide: 1, rerender: 1, opts: [{ v: 'top', l: 'Цены без НДС — НДС сверху: «Итого (без НДС)», «НДС», «Всего с НДС»' }], empty: 'Цены с НДС, как в договоре — «Итого» и «в т.ч. НДС» (по умолчанию)', hint: 'КС-3 по бланку всегда: «Итого» (без НДС), «Сумма НДС», «Всего с учетом НДС»' }),
        F('ks2Style', 'Расчёт в КС-2', 'select', { wide: 1, opts: [{ v: 'smeta', l: 'Как в смете — в ценах сметы, итоги по настройке НДС выше' }], empty: 'Как в КС-3 — цена и стоимость без НДС; «Итого», «Сумма НДС», «Всего с учетом НДС» (по умолчанию)', hint: 'Как в КС-3: суммы КС-2 и КС-3 совпадают до копейки' }),
        F('worksOnly', 'КС-2 и КС-3 только на работы (стоимость материалов не включать)', 'check', { wide: 1 }),
        F('fitOnePage', 'Умещать смету, КС-2 и КС-3 на один лист, если они чуть-чуть не помещаются (шрифт уменьшится, но не меньше 78 %)', 'check', { wide: 1 }),
        F('customerKey', 'Заказчик по КС (Заказчик / Генподрядчик)', 'select', { opts: orgKeys, empty: 'По ролям: ' + ((C.customerOrg(P) || {}).key || 'застройщик не заведён'), hint: 'Если вы субподрядчик — выберите генподрядчика' }),
        F('contractorKey', 'Подрядчик по КС (Подрядчик / Субподрядчик)', 'select', { opts: orgKeys, empty: 'По ролям: ' + ((C.builderOrg(P) || {}).key || 'подрядчик не заведён'), hint: 'Если вы субподрядчик — выберите свою организацию' }),
        F('number', 'Номер КС-2 / КС-3'), F('date', 'Дата составления', 'date'),
        F('periodFrom', 'Отчётный период с', 'date'), F('periodTo', 'Отчётный период по', 'date'),
        F('opType', 'Вид операции (код)'), F('pricesAt', 'Смета составлена в ценах на'),
        F('term', 'Срок выполнения работ (для сметы)', 'textarea', { wide: 1 }),
        ...(P.supplements.length ? [
          F('dsMode', 'КС при доп. соглашениях', 'select', { wide: 1, opts: [{ v: 'sep', l: 'Отдельная КС на договор и на каждое ДС — в шапке «№ договора (ДС № … от …)»' }], empty: 'Одна КС: работы по договору и по ДС разделами, в КС-3 — отдельные этапы (по умолчанию)' }),
          F('dsScope', 'Эта КС оформляется по', 'select', { wide: 1, show: () => P.ks.dsMode === 'sep', opts: dsOpts, empty: 'Основному договору' })
        ] : []),
        F('ks3Mode', 'Строки КС-3', 'select', { opts: [{ v: 'items', l: 'По позициям сметы — как в КС-2' }], empty: 'Одной строкой — этап / «Работы по договору №…»' }),
        F('stageName', 'Наименование этапа для КС-3 (если одной строкой)', 'textarea', { wide: 1, hint: 'Пусто — «Работы по договору № …»' }),
        F('contractorSignerPos', 'Подписант Подрядчика: должность'), F('contractorSignerName', 'Подписант Подрядчика: Фамилия И.О.'),
        F('customerSignerPos', 'Подписант Заказчика: должность'), F('customerSignerName', 'Подписант Заказчика: Фамилия И.О.')
      ], f => { if (f.k === 'vatMode' || f.k === 'dsMode') render(); else updKpi(); })]));
    },
    ozhr() {
      const o = P.ozhr;
      main.appendChild(head('Общий журнал работ', 'Приказ Минстроя от 02.12.2022 № 1026/пр. Разделы 3 и 5 заполняются из журнала актов автоматически.', [
        btn('ОЖР целиком', () => makeDoc('Общий журнал работ', () => IDPdf.ozhrDoc(P)), 'btn-primary'), fmtSwitch()
      ]));
      main.appendChild(card('Титульный лист', [
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
        main.appendChild(c);
        collection(c, key, () => P.ozhr[key], { noSearch: true });
      };
      sub('Другие лица, осуществляющие строительство', 'others');
      sub('Раздел 1. Инженерно-технический персонал', 'r1');
      sub('Раздел 2. Специальные журналы', 'r2');
      main.appendChild(card('Раздел 3. Сведения о выполнении работ', [para('Заполняется из «Журнала актов»: даты, наименование работ. Условия производства работ — поле в карточке акта.')]));
      sub('Раздел 4. Строительный контроль', 'r4');
      main.appendChild(card('Раздел 5. Перечень исполнительной документации', [para('Заполняется из «Журнала актов» автоматически.')]));
      sub('Раздел 6. Государственный строительный надзор', 'r6');
      sub('Изменения в записях титульного листа', 'titleChanges');
    },
    check() {
      const list = C.projectCheck(P);
      const errs = list.filter(x => x.lvl === 'err'), warns = list.filter(x => x.lvl === 'warn');
      main.appendChild(head('Проверка комплекта', 'Что исправить перед печатью: пустые поля, подписанты, сроки документов, даты, суммы. Нажмите на строку — откроется нужный раздел.', [btn('Проверить ещё раз', () => render())]));
      main.appendChild(card(null, [para(list.length ? '<b>' + errs.length + '</b> ошибок, <b>' + warns.length + '</b> предупреждений.' : 'Всё в порядке — замечаний нет.', '')]));
      const section = (title, items, cls) => {
        if (!items.length) return;
        const c = card(title, []);
        const ul = document.createElement('div'); ul.className = 'check-list';
        items.forEach(x => {
          const a = document.createElement('a'); a.href = x.where; a.className = 'check-item ' + cls; a.textContent = x.text;
          ul.appendChild(a);
        });
        c.appendChild(ul); main.appendChild(c);
      };
      section('Ошибки — в документах будет неверно или пусто', errs, 'err');
      section('Предупреждения — стоит проверить', warns, 'warn');
    },
    balance() {
      const rows = C.materialBalance(P);
      main.appendChild(head('Остатки материалов', 'Поставлено (количество в «Материалах») − израсходовано по актам (поле «расход» у материала в карточке АОСР / АООК) = остаток на объекте.', [
        btn('Ведомость', () => makeDoc('Ведомость материалов', () => IDPdf.balanceDoc(P)), 'btn-primary'), fmtSwitch()
      ]));
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
      main.appendChild(head('Документы PDF и Word', 'Формирование печатных форм. Файлы создаются на этом устройстве, без интернета. Word (.docx) — если документ нужно поправить перед печатью.', [fmtSwitch()]));
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
      dc('Пакет актов', marked ? 'Отмечено к печати: ' + marked + '. Отметки ставятся в «Журнале актов».' : 'Нет отметок — будут выгружены все акты.', [
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
        btn('Новый проект', () => { const p = C.emptyProject(); store.projects[p.id] = p; switchTo(p.id); toast('Создан новый проект'); }),
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
    const view = (location.hash.replace(/^#\//, '') || 'acts').split('?')[0];
    const fn = VIEWS[view] || VIEWS.acts;
    main.innerHTML = '';
    fn();
    $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === (VIEWS[view] ? view : 'acts')));
    document.body.classList.remove('nav-open');
    updateHeader();
  }
  // переключение не меняет «время изменения» проекта (иначе синхронизация считала бы его изменённым)
  function switchTo(id) { store.current = id; P = store.projects[id]; if (!P.updatedAt) P.updatedAt = new Date().toISOString(); saveStore(); render(); updateHeader(); }
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { } }
  window.addEventListener('hashchange', () => { closeDialog(); render(); window.scrollTo(0, 0); });
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
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
    ui: { esc, head, card, btn, para, toast, openDialog, closeDialog, confirmBox, loadScript, main: () => main },
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
      if (P && P.id === p.id) { P = p; render(); updateHeader(); }
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
