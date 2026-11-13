/* Генератор ИД — модель данных и расчёты (аналог формул книги «Генератор ИД ВИТ.xlsm») */
(function (global) {
  'use strict';

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const REP_ROLES = ['1. СК Заказчика', '2. Подрядчик', '3. СК Подрядчика', '4. Авторский надзор', '5. Исполнитель работ (субподряд)'];

  // роли организаций на объекте; от них зависит, кто попадает в шапки актов, ОЖР и КС
  const ROLE = {
    developer: 'Застройщик',
    techCustomer: 'Технический заказчик',
    genContractor: 'Генподрядчик',
    contractor: 'Подрядчик',
    subContractor: 'Субподрядчик',
    designer: 'Проектировщик',
    authorSupervision: 'Авторский надзор',
    techSupervision: 'Строительный контроль (технадзор)',
    operator: 'Эксплуатирующая организация / региональный оператор',
    surveyor: 'Геодезист',
    lab: 'Испытательная лаборатория',
    supplier: 'Поставщик',
    manufacturer: 'Изготовитель',
    other: 'Иное'
  };
  const ORG_ROLES = Object.values(ROLE);
  // пояснения в выпадающем списке
  const ROLE_HINT = {
    'Застройщик': 'в актах — «Застройщик, технический заказчик…»',
    'Технический заказчик': 'в актах вместо застройщика, если застройщик не заведён',
    'Генподрядчик': 'в актах — «Лицо, осуществляющее строительство»',
    'Подрядчик': 'в актах — «Лицо, осуществляющее строительство» (договор напрямую с заказчиком)',
    'Субподрядчик': 'в актах — «Лицо, выполнившее работы» (п. 5 представителей)',
    'Проектировщик': 'в актах — «Лицо, осуществляющее подготовку проектной документации»',
    'Строительный контроль (технадзор)': 'стройконтроль заказчика по договору',
    'Эксплуатирующая организация / региональный оператор': 'для титула ОЖР'
  };
  // старые названия ролей (книга Excel и первые версии приложения)
  const LEGACY_ROLE = {
    'Застройщик / тех. заказчик': ROLE.developer,
    'Лицо, осуществляющее строительство': ROLE.contractor,
    'Стройконтроль по договору': ROLE.techSupervision
  };
  // совместимость со старым кодом: «роль в шапке акта»
  const ORG_ROLE = { customer: ROLE.developer, builder: ROLE.contractor, designer: ROLE.designer };

  const DEFAULT_LISTS = {
    actTypes: ['АОСР', 'АООК', 'Разбивка осей', 'ГРО'],
    sections: ['АР', 'КЖ', 'КМ', 'КР', 'ГП', 'ОВ', 'ВК', 'ЭОМ', 'НВК', 'ЭС', 'СС', 'ТХ', 'ПЗУ'],
    docTypes: ['Паспорт качества', 'Сертификат соответствия', 'Декларация о соответствии', 'Сертификат пожарной безопасности', 'Протокол испытаний', 'Техническое свидетельство', 'Экспертное заключение', 'Сертификат качества', 'Документ о качестве', 'Свидетельство о государственной регистрации', 'Отказное письмо'],
    units: ['м²', 'м³', 'м', 'пог. м', 'шт', 'кг', 'т', 'л', 'компл.', 'упак.', 'рулон', 'усл. ед.'],
    repRoles: REP_ROLES.slice(),
    orgRoles: ORG_ROLES.slice(),
    personTypes: ['ЮЛ', 'ИП', 'ФЛ'],
    vk: ['Соответствует', 'Не соответствует']
  };
  // списки, от которых зависит логика, — не редактируются
  const FIXED_LISTS = ['actTypes', 'repRoles', 'orgRoles', 'personTypes', 'vk'];

  // ---------- утилиты ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const s = v => (v === null || v === undefined) ? '' : String(v);
  const pad2 = n => ('0' + n).slice(-2);

  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const r = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
    if (r) return new Date(+r[3], +r[2] - 1, +r[1]);
    return null;
  }
  function fmtDate(v) {
    const d = parseDate(v);
    return d ? pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() : '';
  }
  function dateParts(v) {
    const d = parseDate(v);
    if (!d) return { day: '', month: '', year: '' };
    return { day: pad2(d.getDate()), month: MONTHS_GEN[d.getMonth()], year: String(d.getFullYear()) };
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // сравнение ISO-дат строками; пусто = нет даты
  const dle = (a, b) => !a || !b ? null : a <= b;

  function round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
  function num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  // как FIXED(x;2) в русской локали: 7 562 868,75
  function money(x) {
    const n = round2(num(x));
    const neg = n < 0;
    const [i, f] = Math.abs(n).toFixed(2).split('.');
    return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + f;
  }
  // количество: без лишних нулей, запятая
  function qty(x) {
    if (x === '' || x === null || x === undefined) return '';
    const n = num(x);
    const t = (Math.round(n * 1e6) / 1e6).toString();
    const [i, f] = t.split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + f : '');
  }
  const lowerFirst = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : '';

  // «Климов Виктор Викторович» → «Климов В.В.»; «Василевский В. Я.» → «Василевский В.Я.»
  function shortName(full) {
    full = s(full).trim();
    if (!full) return '';
    const p = full.split(/\s+/);
    if (p.length < 2) return full;
    let r = p[0] + ' ' + p[1].charAt(0) + '.';
    if (p.length > 2) r += p[2].charAt(0) + '.';
    return r;
  }

  // ---------- новый проект ----------
  function emptyProject() {
    return {
      app: 'id-generator', version: 1,
      id: uid(),
      settings: {
        shortName: '', // короткое имя проекта для списка проектов (ВИТ, ТурбоТехМаш…) — в документы не попадает
        objectName: '', address: '', workKind: 'строительство',
        contractNo: '', contractDate: '', projectCode: '', projectDocName: '',
        vat: 0.22, copies: 3, permit: '', expertise: '', startDate: '', endDate: '', objectInfo: '',
        ourOrg: '' // ключ «нашей» организации — подставляется исполнителем в новые акты
      },
      ks: {
        number: '1', date: '', periodFrom: '', periodTo: '', opType: '', term: '', pricesAt: '',
        customerKey: '', contractorKey: '', // стороны КС-2/КС-3; пусто — заказчик и подрядчик по ролям
        contractorSignerPos: '', contractorSignerName: '', customerSignerPos: '', customerSignerName: '',
        stageName: ''
      },
      orgs: [], people: [], materials: [], works: [], acts: [], smeta: [],
      rdSections: [], // разделы рабочей документации: { section, code, docName, designerKey }
      ozhr: {
        builderRepName: '', builderRepPos: '', builderRepDoc: '', builderRepNrs: '',
        techCustomer: '', techCustomerSro: '', techRepName: '', techRepPos: '', techRepDoc: '', techRepNrs: '',
        operator: '', operatorRepName: '', operatorRepPos: '', operatorRepDoc: '',
        operatorScName: '', operatorScPos: '', operatorScDoc: '',
        gsnOrgan: '', gsnPerson: '', gsnOrder: '',
        pages: '', periodFrom: '', periodTo: '',
        titleSignerName: '', titleSignerPos: '',
        others: [], r1: [], r2: [], r4: [], r6: [], titleChanges: []
      },
      lists: JSON.parse(JSON.stringify(DEFAULT_LISTS))
    };
  }

  // приведение загруженного проекта к актуальной схеме
  function normalize(p) {
    const base = emptyProject();
    p = p || {};
    const out = Object.assign({}, base, p);
    out.settings = Object.assign({}, base.settings, p.settings || {});
    out.ks = Object.assign({}, base.ks, p.ks || {});
    out.ozhr = Object.assign({}, base.ozhr, p.ozhr || {});
    ['others', 'r1', 'r2', 'r4', 'r6', 'titleChanges'].forEach(k => { if (!Array.isArray(out.ozhr[k])) out.ozhr[k] = []; });
    out.lists = Object.assign({}, base.lists, p.lists || {});
    FIXED_LISTS.forEach(k => { out.lists[k] = DEFAULT_LISTS[k].slice(); });
    ['sections', 'docTypes', 'units'].forEach(k => { if (!Array.isArray(out.lists[k]) || !out.lists[k].length) out.lists[k] = DEFAULT_LISTS[k].slice(); });
    ['orgs', 'people', 'materials', 'works', 'acts', 'smeta', 'rdSections', 'ksHistory', 'supplements'].forEach(k => {
      if (!Array.isArray(out[k])) out[k] = [];
      out[k].forEach(r => { if (!r.id) r.id = uid(); });
    });
    // старые названия ролей → новые
    out.orgs.forEach(o => { if (LEGACY_ROLE[o.role]) o.role = LEGACY_ROLE[o.role]; else if (o.role && !ORG_ROLES.includes(o.role)) o.role = ROLE.other; });
    out.acts.forEach(a => { if (!Array.isArray(a.materials)) a.materials = []; if (!a.matQty || typeof a.matQty !== 'object') a.matQty = {}; });
    if (!out.id) out.id = uid();
    return out;
  }

  // ---------- организации и представители ----------
  function orgByKey(p, key) { return key ? p.orgs.find(o => o.key === key) || null : null; }
  function orgByRole(p, role) { return p.orgs.find(o => o.role === role) || null; }
  const firstRole = (p, roles) => { for (const r of roles) { const o = orgByRole(p, r); if (o) return o; } return null; };
  // стороны для шапок документов
  function customerOrg(p) { return firstRole(p, [ROLE.developer, ROLE.techCustomer]); }
  function builderOrg(p) { return firstRole(p, [ROLE.genContractor, ROLE.contractor]); }
  function designerOrg(p) { return firstRole(p, [ROLE.designer]); }
  function keyByRole(p, role) {
    const o = role === ORG_ROLE.builder ? builderOrg(p) : role === ORG_ROLE.customer ? customerOrg(p) : orgByRole(p, role);
    return o ? o.key : '';
  }

  function orgLine(o) {
    if (!o || !o.name) return '';
    let t = o.name;
    if (o.ogrn) t += ', ' + (o.type === 'ИП' ? 'ОГРНИП ' : o.type === 'ФЛ' ? 'паспорт ' : 'ОГРН ') + o.ogrn;
    if (o.inn) t += ', ИНН ' + o.inn;
    if (o.address) t += ', ' + o.address;
    if (o.phone) t += ', ' + o.phone;
    return t;
  }
  function sroLine(o) {
    if (!o || !o.sroName) return '';
    let t = o.sroName;
    if (o.sroOgrn) t += ', ОГРН ' + o.sroOgrn;
    if (o.sroInn) t += ', ИНН ' + o.sroInn;
    return t;
  }
  function personActLine(r) {
    if (!r || !r.fullName) return '';
    let t = (s(r.position) + ' ' + r.fullName).trim();
    if (r.nrs) t += ', идентификационный номер в НРС ' + r.nrs;
    if (r.authDoc) t += ', ' + r.authDoc;
    return t;
  }
  function personOrgLine(p, r) {
    if (!r || !r.fullName) return '';
    let t = personActLine(r);
    const o = orgByKey(p, r.orgKey);
    if (o) { const l = orgLine(o); if (l) t += ', ' + l; }
    return t;
  }

  // представитель роли, действующий на дату (последняя подходящая строка, как MAX(ROW) в книге)
  function pickRep(p, role, date, executorKey) {
    let found = null;
    const builderKey = keyByRole(p, ORG_ROLE.builder);
    p.people.forEach(r => {
      if (r.role !== role) return;
      if (date) {
        if (r.from && r.from > date) return;
        if (r.to && r.to < date) return;
      }
      if (role === REP_ROLES[4]) {
        if (r.orgKey !== executorKey) return;
        if (executorKey === builderKey) return;
      }
      found = r;
    });
    return found;
  }
  // почему на дату акта нет представителя роли — подсказка для проверки и карточки акта
  function repMissingReason(p, role, date) {
    const same = p.people.filter(r => r.role === role);
    if (!same.length) return 'в «Представителях» нет никого с ролью «' + role + '»';
    const near = same.map(r => shortName(r.fullName) + ' — ' + (r.from && r.from > date ? 'действует с ' + fmtDate(r.from) : r.to && r.to < date ? 'действовал по ' + fmtDate(r.to) : 'не подходит по организации')).join('; ');
    return 'на ' + fmtDate(date) + ' никто не действует (' + near + '). Поправьте даты «с/по» в «Представителях» или выберите представителя в карточке акта';
  }
  // текущий представитель (для титула ОЖР): «по» пусто или ≥ сегодня
  function currentRep(p, role) {
    const t = todayISO();
    let found = null, last = null;
    p.people.forEach(r => { if (r.role !== role) return; last = r; if (!r.to || r.to >= t) found = r; });
    // у всех срок вышел (объект сдан) — для титула ОЖР берём последнего, а не пустую строку
    return found || last;
  }

  // ---------- материалы ----------
  function matNo(p, m) { const i = p.materials.indexOf(m); return i < 0 ? '' : ('00' + (i + 1)).slice(-3); }
  function matName(m) { return s(m.name) + (m.mark ? ' ' + m.mark : ''); }
  function matLabel(p, m) { return matNo(p, m) + ' | ' + matName(m); }
  function docText(type, no, date, until) {
    // номер есть, а вид не выбран (бывает после загрузки скана) — документ не теряем
    if (!type && !no) return '';
    let t = type ? lowerFirst(type) : 'документ о качестве';
    if (no) t += ' № ' + no;
    if (date) t += ' от ' + fmtDate(date);
    if (until) t += ' (действ. до ' + fmtDate(until) + ')';
    return t;
  }
  function matDocs(m) {
    return [docText(m.doc1Type, m.doc1No, m.doc1Date, m.doc1Until), docText(m.doc2Type, m.doc2No, m.doc2Date, m.doc2Until)].filter(Boolean).join(', ');
  }
  function matText(m) {
    if (!m || !m.name) return '';
    let t = matName(m);
    if (m.gost) t += ', ' + m.gost;
    if (m.maker) t += ', изг. ' + m.maker;
    const d = matDocs(m);
    if (d) t += ', ' + d;
    return t;
  }
  // самый ранний срок действия документов материала
  function matUntil(m) {
    return [m.doc1Type || m.doc1No ? m.doc1Until : '', m.doc2Type || m.doc2No ? m.doc2Until : ''].filter(Boolean).sort()[0] || '';
  }
  function matExpired(m, onDate) {
    const u = matUntil(m);
    return !!u && u < (onDate || todayISO());
  }

  // ---------- справочник ----------
  function workLabel(w) { return w && w.name ? (s(w.code) + ' ' + w.name).trim() : ''; }

  // ---------- журнал актов ----------
  function actNumber(p, a) {
    if (a.manualNo) return a.manualNo;
    if (!a.type) return '';
    let c = 0;
    for (const x of p.acts) {
      if (x.type === a.type && s(x.section) === s(a.section)) c++;
      if (x === a) break;
    }
    return (a.section ? a.section + '-' : '') + pad2(c);
  }

  // ---------- раздел рабочей документации для акта ----------
  function rdSection(p, section) { return section ? (p.rdSections || []).find(r => r.section === section) || null : null; }
  // шифр и наименование РД: особый шифр вида работ → раздел РД → общий шифр объекта
  function rdFor(p, a, w) {
    const st = p.settings;
    const section = (a && a.section) || (w && w.section) || '';
    const r = rdSection(p, section);
    let code = st.projectCode, source = 'объект';
    if (r && r.code) { code = r.code; source = 'раздел ' + section; }
    if (w && w.projCode) { code = w.projCode; source = 'вид работ'; }
    const docName = (r && r.docName) || st.projectDocName || '';
    const designer = (r && orgByKey(p, r.designerKey)) || designerOrg(p);
    const projectDoc = docName + (designer && designer.name ? (docName ? ', ' : '') + 'разработчик ' + designer.name : '');
    return { code: s(code), docName, designer, projectDoc, source, section };
  }

  // листы раздела РД / тома ПД: [{no, name}] (из ведомости рабочих чертежей или вручную)
  const rdSheets = (p, section) => { const r = rdSection(p, section); return (r && r.sheetList) || []; };
  // «листы 1–3, 5, В1»: подряд идущие номера — диапазоном
  function sheetsText(nos) {
    const list = (nos || []).map(x => s(x)).filter(Boolean);
    if (!list.length) return '';
    const out = []; let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && /^\d+$/.test(list[j]) && /^\d+$/.test(list[j + 1]) && +list[j + 1] === +list[j] + 1) j++;
      out.push(j - i >= 2 ? list[i] + '–' + list[j] : j > i ? list[i] + ', ' + list[j] : list[i]);
      i = j + 1;
    }
    return (list.length > 1 ? 'листы ' : 'лист ') + out.join(', ');
  }
  // номера листов из текста «листы 1–3, 5» / «л. 2, 4» → ['1','2','3','5']
  function sheetsParse(text) {
    const t = s(text).replace(/^[^0-9А-Яа-яA-Za-z]*(листы|лист|л\.)\s*/i, '');
    const out = [];
    t.split(/[,;]\s*/).forEach(part => {
      const m = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(part.trim());
      if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 200) for (let k = +m[1]; k <= +m[2]; k++) out.push(String(k));
      else if (part.trim()) out.push(part.trim().replace(/^(листы|лист|л\.)\s*/i, ''));
    });
    return out;
  }
  // что исправить в акте из чужой ИД, чтобы он соответствовал нашему формату и данным проекта
  function importIssues(p, a) {
    if (!a.imported) return [];
    const out = [];
    const v = actView(p, a);
    const r = rdSection(p, a.section);
    if (!a.section) out.push('не указан раздел (КЖ, КМ…) — нужен для шифра и нумерации');
    else if (!r) out.push('раздела «' + a.section + '» нет в «Проектной и рабочей документации»');
    else if (!r.code) out.push('у раздела «' + a.section + '» не указан шифр');
    // шифр из их акта не совпадает с нашим (старая редакция или другой раздел)
    const theirCode = s(a.imported.code);
    if (theirCode && v.projectCode && compactCode(theirCode) !== compactCode(v.projectCode)) out.push('в исходном акте шифр «' + theirCode + '», в проекте — «' + v.projectCode + '»');
    // в п. 6 (нормативы) и п. 4 остались ссылки на шифры, которых нет в нашей документации
    const known = (p.rdSections || []).map(x => compactCode(x.code)).concat([compactCode(v.projectCode)]);
    [['п. 6', a.manualNorms], ['п. 4', a.docs]].forEach(([pt, txt]) => {
      // шифр: несколько частей через дефис и буквенный раздел в конце (КЖ1, КМД); оси «1-4/А-В» не считаем
      (s(txt).match(/[0-9A-Za-zА-ЯЁ][0-9A-Za-zА-ЯЁ.\/]*(?:-[0-9A-Za-zА-ЯЁ.\/]+)+-[А-ЯЁ]{2,5}\s?\d{0,2}(?![А-Яа-яЁё\/\-])/g) || [])
        .filter(c => !known.includes(compactCode(c))).forEach(c => out.push('в ' + pt + ' ссылка на шифр «' + c + '» — его нет в «Проектной и рабочей документации»'));
    });
    const list = rdSheets(p, a.section).map(x => s(x.no));
    if (list.length && a.sheets) { const bad = sheetsParse(a.sheets).filter(n => !list.includes(n)); if (bad.length) out.push('листов ' + bad.join(', ') + ' нет в ведомости раздела ' + a.section); }
    if (!a.sheets && list.length) out.push('не выбраны листы РД');
    const wd = workDates(p);
    if (a.start && wd.start && a.start < wd.start) out.push('начало работ ' + fmtDate(a.start) + ' раньше начала по договору ' + fmtDate(wd.start));
    if (a.end && wd.end && a.end > wd.end) out.push('окончание ' + fmtDate(a.end) + ' позже срока по договору ' + fmtDate(wd.end));
    (a.imported.matsLeft || []).forEach(t => out.push('материал не найден в «Материалах»: ' + t));
    if ((a.type === 'АОСР' || a.type === 'АООК') && !(a.materials || []).length && !(a.imported.matsLeft || []).length && a.imported.matsText) out.push('материалы из исходного акта не привязаны: ' + a.imported.matsText.slice(0, 120));
    (a.imported.repsLeft || []).forEach(t => out.push('подписант не найден в «Представителях»: ' + t));
    v.warnings.forEach(w => out.push(w));
    return out;
  }
  const compactCode = c => s(c).toUpperCase().replace(/[\s.]/g, '').replace(/[ABCEHKMOPTXY]/g, ch => ({ A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' })[ch]);

  function actView(p, a) {
    const st = p.settings;
    const w = p.works.find(x => x.id === a.workId) || null;
    const date = a.actDate || a.end || '';
    const builderKey = keyByRole(p, ORG_ROLE.builder);
    const executorKey = a.executor || builderKey;
    const mats = (a.materials || []).map(id => p.materials.find(m => m.id === id)).filter(Boolean);
    const name = (a.manualName || (w ? w.name : '') || '') + (a.axes ? ' ' + a.axes : '');
    const rd = rdFor(p, a, w);
    const project = (rd.code ? 'шифр ' + rd.code : '') + (a.sheets ? (rd.code ? ', ' : '') + a.sheets : '');
    const docs = a.docs || (w ? s(w.docs) : '');
    // представитель, выбранный в карточке акта (a.rep0…a.rep4), важнее автоматического выбора по роли и дате
    const reps = REP_ROLES.map((role, i) => (a['rep' + i] && p.people.find(r => r.id === a['rep' + i])) || pickRep(p, role, date, executorKey));
    const number = actNumber(p, a);
    const signers = reps.filter(Boolean).map(r => (s(r.position) + ' ' + shortName(r.fullName)).trim()).join('; ');
    const warnings = [];
    if (!a.type) warnings.push('не указан тип акта');
    if (!a.start || !a.end) warnings.push('не указаны даты работ');
    if (a.start && a.end && a.start > a.end) warnings.push('дата начала позже окончания');
    if (!reps[0]) warnings.push('нет представителя СК Заказчика: ' + repMissingReason(p, REP_ROLES[0], date));
    if (!reps[1]) warnings.push('нет представителя Подрядчика: ' + repMissingReason(p, REP_ROLES[1], date));
    // работы выполнил субподрядчик, а его представителя нет — строка 5 акта пустая
    if (a.executor && a.executor !== builderKey && !reps[4]) warnings.push('работы выполнил «' + a.executor + '», но нет его представителя с ролью «' + REP_ROLES[4] + '» на дату акта');
    mats.forEach(m => { if (matExpired(m, date)) warnings.push('истёк документ: ' + matName(m)); });
    // больше 5 документов о качестве — по форме 344/пр в п. 3 (АООК — п. 4) ссылка на реестр, реестр прикладывается к акту
    const docCount = mats.reduce((n, m) => n + (m.doc1Type || m.doc1No ? 1 : 0) + (m.doc2Type || m.doc2No ? 1 : 0), 0);
    const registry = (a.type === 'АОСР' || a.type === 'АООК') && st.matRegistry !== false && (docCount > 5 || a.forceRegistry);
    const regRef = 'Материалы и изделия согласно реестру документов о качестве (приложение к настоящему акту, позиций: ' + mats.length + ', документов: ' + docCount + '), являющемуся неотъемлемой частью акта';
    return {
      act: a, work: w, number, date, executorKey, materials: mats,
      name, registry, docCount,
      materialsText: registry ? regRef : mats.map(matText).filter(Boolean).join('; '),
      norms: a.manualNorms || (w ? s(w.norms) : ''),
      next: a.manualNext || (w ? s(w.next) : ''),
      project, docs, projectCode: rd.code, projectDoc: rd.projectDoc, rdSource: rd.source,
      attach: (a.manualAttach || docs) + (registry && !/реестр документов о качестве/i.test(a.manualAttach || '') ? ((a.manualAttach || docs) ? '; ' : '') + 'реестр документов о качестве применённых материалов' : ''),
      copies: s(a.copies || st.copies),
      reps, signers,
      title: a.type ? a.type + ' № ' + number + ' - ' + name : '',
      warnings
    };
  }

  // ---------- общие для форм ----------
  function parties(p) {
    const customer = customerOrg(p);
    const builder = builderOrg(p);
    const designer = designerOrg(p);
    const projectDoc = s(p.settings.projectDocName) + (designer && designer.name ? (p.settings.projectDocName ? ', ' : '') + 'разработчик ' + designer.name : '');
    // КС-2/КС-3: стороны можно выбрать явно (например, мы — субподрядчик, заказчик по КС — генподрядчик)
    const ksCustomer = orgByKey(p, p.ks && p.ks.customerKey) || customer;
    const ksContractor = orgByKey(p, p.ks && p.ks.contractorKey) || builder;
    return {
      customer, builder, designer, projectDoc, ksCustomer, ksContractor,
      developer: orgByRole(p, ROLE.developer), techCustomer: orgByRole(p, ROLE.techCustomer),
      operator: orgByRole(p, ROLE.operator), subContractors: p.orgs.filter(o => o.role === ROLE.subContractor)
    };
  }
  // проверка состава участников — подсказки в разделе «Организации»
  function partyWarnings(p) {
    const w = [];
    if (!customerOrg(p)) w.push('Нет застройщика или технического заказчика — шапка «Застройщик…» в актах будет пустой.');
    if (!builderOrg(p)) w.push('Нет генподрядчика или подрядчика — строка «Лицо, осуществляющее строительство» в актах будет пустой.');
    if (!designerOrg(p)) w.push('Нет проектировщика — строка «Лицо, осуществляющее подготовку проектной документации» будет пустой.');
    if (orgByRole(p, ROLE.genContractor) && orgByRole(p, ROLE.contractor)) w.push('Заведены и генподрядчик, и подрядчик: в актах «лицом, осуществляющим строительство» будет генподрядчик. Если ваша организация работает у генподрядчика, назначьте ей роль «Субподрядчик».');
    const keys = {};
    p.orgs.forEach(o => { if (o.key) { if (keys[o.key]) w.push('Ключ «' + o.key + '» повторяется у двух организаций.'); keys[o.key] = 1; } });
    return w;
  }

  // ---------- смета ----------
  // worksOnly — КС только на работы: материал не входит в цену и итоги, позиции без цены работ пропускаются
  function smetaRow(r, worksOnly) {
    const q = num(r.qty), w = num(r.priceWork), m = worksOnly ? 0 : num(r.priceMat);
    return { total: round2(q * (w + m)), work: round2(q * w), mat: round2(q * m), unitPrice: w + m };
  }
  // ---------- дополнительные соглашения ----------
  // ДС: {id, no, date, subject, priceMode: 'delta' | 'new', amount (±, с НДС), newPrice, startDate, endDate, note}
  const dsList = p => (p.supplements || []).slice().sort((a, b) => (s(a.date) || '9999').localeCompare(s(b.date) || '9999') || String(a.no).localeCompare(String(b.no), 'ru', { numeric: true }));
  const dsById = (p, id) => id ? (p.supplements || []).find(d => d.id === id) || null : null;
  // «ДС № 1 от 01.10.2026» — без падежа, годится в любую фразу; в документах — «по дополнительному соглашению № …»
  const dsLabel = d => d ? 'ДС № ' + s(d.no || '—') + (d.date ? ' от ' + fmtDate(d.date) : '') : '';
  // единицы измерения в одном виде: «усл», «Услуга», «усл.» → «услуга»; «компл», «комплект» → «компл.»; «м2» → «м²»…
  function unitNorm(u) {
    const t = s(u).replace(/\s+/g, ' ').trim();
    const l = t.toLowerCase().replace(/[\s.]/g, '');
    if (!l) return '';
    if (/^(усл|услуга|услуги)$/.test(l)) return 'услуга';
    if (/^(компл|комплект|кмпл|к-т|кт)$/.test(l)) return 'компл.';
    if (/^(шт|штука|штук|штуки)$/.test(l)) return 'шт';
    if (/^(т|тн|тонна|тонн|тонны)$/.test(l)) return 'т';
    if (/^(м2|м\^2|квм|м²)$/.test(l)) return 'м²';
    if (/^(м3|м\^3|кубм|м³)$/.test(l)) return 'м³';
    if (/^(пм|погм|мп)$/.test(l)) return 'пог. м';
    if (/^(м|метр)$/.test(l)) return 'м';
    if (/^(кг|килограмм)$/.test(l)) return 'кг';
    return t;
  }
  // сумма ДС по его позициям в смете (с НДС) — если в самом ДС сумма не указана
  function dsRowsGross(p, d) {
    let sum = 0;
    p.smeta.forEach(r => {
      if (r.name && r.dsId === d.id && r.excludedBy !== d.id) sum += smetaRow(r).total;
      if (r.name && r.excludedBy === d.id) sum -= smetaRow(r).total;
      (r.changes || []).forEach(ch => { if (ch.dsId === d.id) sum += smetaRow(ch.to).total - smetaRow(ch.from).total; });
    });
    return vatSplit(p, round2(sum)).gross;
  }
  // цена договора с учётом ДС (с НДС), по порядку дат. Цена = основные работы + доп. работы по ДС:
  //  «изменение на сумму» — к доп. работам (пусто — по позициям этого ДС в смете);
  //  «новая цена основных работ» (priceMode 'new') — заменяет цену основных работ, доп. работы по другим ДС сохраняются;
  //  «новая общая цена» ('total') — заменяет всё (в неё уже вошли прежние ДС)
  function contractPriceNow(p) {
    const start = num(p.settings.contractPrice);
    let base = start, extra = 0;
    const steps = dsList(p).map(d => {
      const before = base + extra;
      if (d.priceMode === 'new' && s(d.newPrice) !== '') base = num(d.newPrice);
      else if (d.priceMode === 'total' && s(d.newPrice) !== '') { base = num(d.newPrice); extra = 0; }
      else extra = round2(extra + (s(d.amount) !== '' ? num(d.amount) : dsRowsGross(p, d)));
      const after = round2(base + extra);
      return { ds: d, delta: round2(after - before), after };
    });
    return { base: start, mainNow: round2(base), total: round2(base + extra), steps, hasDs: steps.length > 0 };
  }
  // сроки работ с учётом ДС (последнее ДС, где срок указан)
  function workDates(p) {
    let start = p.settings.startDate || '', end = p.settings.endDate || '';
    dsList(p).forEach(d => { if (d.startDate) start = d.startDate; if (d.endDate) end = d.endDate; });
    return { start, end };
  }
  // позиции сметы: исключённые по ДС не участвуют; порядок — договор, затем ДС по датам (сквозная нумерация)
  function smetaGroups(p) {
    const ds = dsList(p), ids = ds.map(d => d.id);
    // исключена только по существующему ДС (если ДС удалили — позиция снова действует)
    const rows = p.smeta.filter(r => r.name && !(r.excludedBy && ids.includes(r.excludedBy)));
    const main = rows.filter(r => !r.dsId || !ids.includes(r.dsId));
    return [{ ds: null, rows: main }].concat(ds.map(d => ({ ds: d, rows: rows.filter(r => r.dsId === d.id) })));
  }
  const smetaOrdered = p => smetaGroups(p).flatMap(g => g.rows);
  const smetaRows = (p, worksOnly) => smetaOrdered(p).filter(r => !worksOnly || num(r.priceWork));
  // НДС: цены в смете с НДС (по умолчанию, как в договорах «в т.ч. НДС») или без НДС — НДС сверху (ks.vatMode = 'top').
  // total — сумма в ценах сметы; net — без НДС; vatSum — НДС; gross — с НДС
  const vatTop = p => p.ks && p.ks.vatMode === 'top';
  function vatSplit(p, total) {
    const vat = num(p.settings.vat);
    if (vatTop(p)) { const vatSum = round2(total * vat); return { net: total, vatSum, gross: round2(total + vatSum) }; }
    const vatSum = round2(total * vat / (1 + vat));
    return { net: round2(total - vatSum), vatSum, gross: total };
  }
  // сумма в ценах сметы → без НДС (для граф КС-3, где по бланку суммы без НДС)
  const netOf = (p, x) => vatSplit(p, round2(x)).net;
  function smetaTotals(p, worksOnly) {
    let total = 0, work = 0, mat = 0;
    smetaRows(p, worksOnly).forEach(r => { const c = smetaRow(r, worksOnly); total += c.total; work += c.work; mat += c.mat; });
    total = round2(total); work = round2(work); mat = round2(mat);
    return Object.assign({ total, work, mat, vatPct: Math.round(num(p.settings.vat) * 100), top: vatTop(p) }, vatSplit(p, total));
  }

  // ---------- КС за период ----------
  // если у позиций сметы заполнено «выполнено в этом периоде» (qtyNow) — КС-2 только по ним и на этот объём;
  // иначе — на всю смету, как раньше
  const ksPeriodMode = p => p.smeta.some(r => r.name && s(r.qtyNow) !== '');
  // область КС: одна КС на всё (по умолчанию) или отдельная на договор / на конкретное ДС (ks.dsMode = 'sep', ks.dsScope)
  const ksSeparate = p => p.ks.dsMode === 'sep' && (p.supplements || []).length > 0;
  const ksScopeDs = p => ksSeparate(p) ? dsById(p, p.ks.dsScope) : null;
  function inKsScope(p, r) {
    if (!ksSeparate(p)) return true;
    const d = ksScopeDs(p);
    return d ? r.dsId === d.id : !(r.dsId && dsById(p, r.dsId));
  }
  function ksItems(p) {
    const wo = !!p.ks.worksOnly, pm = ksPeriodMode(p);
    return smetaRows(p, wo).filter(r => inKsScope(p, r) && (!pm || num(r.qtyNow))).map(r => {
      const qty = pm ? r.qtyNow : r.qty;
      const d = dsById(p, r.dsId);
      return { r, qty, ds: d, c: smetaRow(Object.assign({}, r, { qty }), wo) };
    });
  }
  function ksTotals(p) {
    let total = 0, work = 0, mat = 0;
    ksItems(p).forEach(({ c }) => { total += c.total; work += c.work; mat += c.mat; });
    total = round2(total);
    return Object.assign({ total, work: round2(work), mat: round2(mat), vatPct: Math.round(num(p.settings.vat) * 100), top: vatTop(p) }, vatSplit(p, total));
  }
  // закрытые КС: сумма и объёмы по позициям
  const ksDoneBefore = p => round2((p.ksHistory || []).reduce((a, h) => a + num(h.total), 0));
  function ksYearBefore(p) {
    const y = (parseDate(p.ks.date) || new Date()).getFullYear();
    return round2((p.ksHistory || []).filter(h => (parseDate(h.date) || new Date(0)).getFullYear() === y).reduce((a, h) => a + num(h.total), 0));
  }
  // закрытые КС по текущей области (отдельная КС на договор / ДС считает только свои позиции); group — ДС id или '' (договор)
  function ksBeforeScoped(p, onlyYear, group) {
    const y = (parseDate(p.ks.date) || new Date()).getFullYear();
    const grpOf = id => { const r = p.smeta.find(x => x.id === id); return r && r.dsId && dsById(p, r.dsId) ? r.dsId : ''; };
    const want = group !== undefined ? group : ksSeparate(p) ? (ksScopeDs(p) ? ksScopeDs(p).id : '') : null;
    return round2((p.ksHistory || []).filter(h => !onlyYear || (parseDate(h.date) || new Date(0)).getFullYear() === y)
      .reduce((a, h) => a + (want === null ? num(h.total) : (h.rows || []).filter(x => grpOf(x.id) === want).reduce((b, x) => b + num(x.sum), 0)), 0));
  }
  const qtyDoneBefore = (p, rowId) => (p.ksHistory || []).reduce((a, h) => a + (h.rows || []).filter(x => x.id === rowId).reduce((b, x) => b + num(x.qty), 0), 0);

  // ---------- ведомость материалов: поставлено / израсходовано по актам / остаток ----------
  function materialBalance(p) {
    return p.materials.filter(m => m.name).map(m => {
      const uses = p.acts.filter(a => a.type && (a.materials || []).includes(m.id)).map(a => ({ a, qty: a.matQty && s(a.matQty[m.id]) !== '' ? num(a.matQty[m.id]) : null }));
      const used = round2(uses.reduce((x, u) => x + (u.qty || 0), 0) * 1000) / 1000;
      const supplied = num(m.qty);
      return { m, supplied, used, rest: s(m.qty) === '' ? null : Math.round((supplied - used) * 1000) / 1000, uses };
    });
  }

  // ---------- проверка комплекта перед печатью ----------
  // [{ lvl: 'err' | 'warn', where: '#/раздел', text }]
  function projectCheck(p) {
    const out = [], st = p.settings;
    const E = (where, text) => out.push({ lvl: 'err', where, text }), W = (where, text) => out.push({ lvl: 'warn', where, text });
    if (!st.objectName) E('#/settings', 'Не указано наименование объекта — пусто в актах и в строке «Объект» КС-2.');
    if (!st.address) W('#/settings', 'Не указан адрес объекта.');
    if (!st.contractNo) W('#/settings', 'Не указан номер договора (КС-2, КС-3, смета, реестр).');
    partyWarnings(p).forEach(t => W('#/orgs', t));
    // две организации с одной ролью — в шапки идёт первая по списку
    [ROLE.developer, ROLE.techCustomer, ROLE.genContractor, ROLE.contractor, ROLE.designer].forEach(role => {
      const same = p.orgs.filter(o => o.role === role);
      if (same.length > 1) W('#/orgs', 'Роль «' + role + '» у нескольких организаций (' + same.map(o => o.key).join(', ') + ') — в шапки документов попадёт первая: «' + same[0].key + '». Лишним поставьте другую роль.');
    });
    p.materials.filter(m => m.name && !m.doc1Type && m.doc1No).forEach(m => W('#/materials', matNo(p, m) + ' ' + matName(m) + ': у документа о качестве не выбран вид — в актах будет «документ о качестве № …».'));
    // акты
    const acts = p.acts.filter(a => a.type);
    const nums = {}, ambig = {};
    acts.forEach(a => {
      const v = actView(p, a), label = a.type + ' № ' + v.number;
      v.warnings.forEach(t => E('#/acts', label + ': ' + t + '.'));
      if (!v.name) E('#/acts', label + ': нет наименования работ.');
      const rd = rdFor(p, a, p.works.find(x => x.id === a.workId));
      if (!rd.code) W('#/works', label + ': не задан шифр РД (ни у раздела, ни общий).');
      // сроки — с учётом доп. соглашений
      const wd = workDates(p);
      if (wd.start && a.start && a.start < wd.start) W('#/acts', label + ': начало работ ' + fmtDate(a.start) + ' раньше начала по договору ' + fmtDate(wd.start) + '.');
      if (wd.end && a.end && a.end > wd.end) W('#/acts', label + ': окончание ' + fmtDate(a.end) + ' позже срока по договору' + (dsList(p).some(d => d.endDate) ? ' с учётом доп. соглашений' : '') + ' ' + fmtDate(wd.end) + '.');
      (a.materials || []).forEach(id => {
        const m = p.materials.find(x => x.id === id);
        if (!m) { W('#/acts', label + ': в акте указан удалённый материал.'); return; }
        if (m.deliveryDate && a.start && m.deliveryDate > (a.end || a.start)) W('#/acts', label + ': материал «' + matName(m) + '» поставлен ' + fmtDate(m.deliveryDate) + ', позже работ.');
      });
      const key = a.type + '|' + v.number;
      if (nums[key]) E('#/acts', 'Номер ' + label + ' повторяется.'); else nums[key] = 1;
      // номер считается по порядку: удалили / переставили акт — у уже распечатанного номер сдвинулся
      if (a.printedNo && a.printedNo !== v.number) E('#/acts', a.type + ' «' + (v.name || '').slice(0, 50) + '» печатался с № ' + a.printedNo + ', а сейчас получается № ' + v.number + ' (акт выше удалили или переставили). Впишите «№ вручную» или верните порядок.');
      const date = a.actDate || a.end || '';
      if (!v.reps[2] && (a.type === 'АОСР' || a.type === 'АООК')) W('#/people', label + ': нет представителя СК Подрядчика на ' + fmtDate(date) + ' — строка в акте будет пустой.');
      // на дату подходят двое с одной ролью — молча берётся последний в списке (собираем по ролям, выводим одной строкой)
      if (date) REP_ROLES.slice(0, 3).forEach((role, i) => {
        if (a['rep' + i]) return;
        const ok = p.people.filter(r => r.role === role && (!r.from || r.from <= date) && (!r.to || r.to >= date));
        if (ok.length < 2) return;
        const k = role + '|' + ok.map(r => r.id).join(',');
        (ambig[k] = ambig[k] || { role, ok, acts: [] }).acts.push(a.type + ' № ' + v.number);
      });
    });
    Object.values(ambig).forEach(x => {
      const who = x.ok.map(r => shortName(r.fullName));
      W('#/people', 'С ролью «' + x.role + '» одновременно действуют ' + who.join(', ') + ' В акты (' + (x.acts.length > 4 ? x.acts.slice(0, 3).join(', ') + ' и ещё ' + (x.acts.length - 3) : x.acts.join(', ')) + ') попадёт ' + who[who.length - 1] + ' Если нужен другой — проставьте даты «с/по» в «Представителях» или выберите подписанта в акте.');
    });
    // материалы
    p.materials.filter(m => m.name).forEach(m => {
      const lbl = matNo(p, m) + ' ' + matName(m);
      if (!matDocs(m)) W('#/materials', lbl + ': нет документа о качестве.');
      else if (matExpired(m, m.deliveryDate || todayISO())) W('#/materials', lbl + ': документ о качестве истёк ' + (m.deliveryDate ? 'к дате поставки' : 'на сегодня') + ' (' + fmtDate(matUntil(m)) + ').');
      if (!m.delivery) W('#/materials', lbl + ': не указан документ поставки (УПД / ТН).');
    });
    materialBalance(p).filter(b => b.rest !== null && b.rest < -1e-6).forEach(b => E('#/balance', matNo(p, b.m) + ' ' + matName(b.m) + ': по актам израсходовано ' + qty(b.used) + ' ' + s(b.m.unit) + ', а поставлено ' + qty(b.supplied) + '.'));
    // смета и КС
    if (p.smeta.some(r => r.name)) {
      const ks = p.ks, tot = ksTotals(p);
      p.smeta.filter(r => r.name && num(r.qtyNow) && num(r.qty) && qtyDoneBefore(p, r.id) + num(r.qtyNow) - num(r.qty) > 1e-6)
        .forEach(r => E('#/smeta', 'Смета: по позиции «' + r.name.slice(0, 60) + '» выполнено больше, чем в смете (' + qty(qtyDoneBefore(p, r.id) + num(r.qtyNow)) + ' из ' + qty(r.qty) + ').'));
      if (!ks.number || !ks.date) W('#/smeta', 'КС: не указан номер или дата составления.');
      if (!ks.periodFrom || !ks.periodTo) W('#/smeta', 'КС: не указан отчётный период.');
      if (!ks.contractorSignerName || !ks.customerSignerName) W('#/smeta', 'КС: не указаны подписанты.');
      p.smeta.filter(r => r.name && !num(r.qty)).forEach(r => W('#/smeta', 'Смета: у позиции «' + r.name.slice(0, 60) + '» нет количества.'));
      // цена договора с учётом ДС — с НДС; сравниваем с суммами с НДС (при ценах без НДС — после начисления НДС)
      const cp = contractPriceNow(p), price = cp.total;
      if (price) {
        const full = smetaTotals(p).gross;
        if (Math.abs(full - price) > 0.01) W('#/smeta', 'Смета с НДС ' + money(full) + ' ≠ цене договора' + (cp.hasDs ? ' с учётом доп. соглашений' : '') + ' ' + money(price) + ' (разница ' + money(full - price) + ').');
        const done = vatSplit(p, round2(ksDoneBefore(p) + tot.total)).gross;
        if (done - price > 0.01) E('#/smeta', 'С учётом прошлых КС выполнено на ' + money(done) + ' — больше цены договора' + (cp.hasDs ? ' с учётом доп. соглашений' : '') + ' ' + money(price) + '.');
      }
      // доп. соглашения: сумма позиций ДС = изменению цены; работы ДС — не раньше его подписания
      dsList(p).forEach(d => {
        const lbl = dsLabel(d);
        if (!d.no || !d.date) W('#/settings', 'У доп. соглашения не указан номер или дата (' + (lbl || 'без номера') + ').');
        // изменение по смете = добавленные позиции − исключённые этим ДС
        const added = p.smeta.filter(r => r.name && r.dsId === d.id && r.excludedBy !== d.id);
        const removed = p.smeta.filter(r => r.name && r.excludedBy === d.id);
        const pend = p.smeta.filter(r => (r.pendingDs || []).some(x => x.dsId === d.id)).length;
        if (pend) W('#/smeta', 'По ' + lbl + ' не приняты изменения позиций сметы: ' + pend + ' — примите или отклоните их в «Смете».');
        // + изменённые этим ДС позиции договора: «стало − было»
        const changed = [];
        p.smeta.forEach(r => (r.changes || []).forEach(ch => { if (ch.dsId === d.id) changed.push(ch); }));
        if (!d.priceMode && s(d.amount) !== '' && (added.length || removed.length || changed.length)) {
          let sum = 0; added.forEach(r => { sum += smetaRow(r).total; }); removed.forEach(r => { sum -= smetaRow(r).total; });
          changed.forEach(ch => { sum += smetaRow(ch.to).total - smetaRow(ch.from).total; });
          const g = vatSplit(p, round2(sum)).gross;
          if (Math.abs(g - num(d.amount)) > 0.01) W('#/smeta', 'Позиции по ' + lbl + ' в смете меняют цену на ' + money(g) + ', а в ДС указано ' + money(num(d.amount)) + '.');
        }
        if (d.date && ks.periodTo && ks.periodTo < d.date && ksItems(p).some(x => x.r.dsId === d.id)) W('#/smeta', 'В КС за период по ' + fmtDate(ks.periodTo) + ' попали работы по ' + lbl + ', подписанному позже.');
      });
    }
    // акты, загруженные из чужой ИД: что ещё не приведено к нашему формату
    const imp = p.acts.filter(a => a.imported && !a.importDone && importIssues(p, a).length);
    if (imp.length) W('#/acts', 'Акты из чужой ИД требуют исправлений: ' + imp.length + ' (в «Журнале актов» — отметка «чужая ИД», список «что исправить» в карточке акта).');
    return out;
  }

  global.IDCore = {
    MONTHS_GEN, REP_ROLES, ORG_ROLE, ROLE, ORG_ROLES, ROLE_HINT, DEFAULT_LISTS, FIXED_LISTS,
    customerOrg, builderOrg, designerOrg, partyWarnings, rdSection, rdFor,
    uid, s, pad2, parseDate, fmtDate, dateParts, todayISO, dle, round2, num, money, qty, lowerFirst, shortName,
    emptyProject, normalize,
    orgByKey, orgByRole, keyByRole, orgLine, sroLine, personActLine, personOrgLine, pickRep, currentRep, repMissingReason,
    matNo, matName, matLabel, matDocs, matText, matUntil, matExpired,
    workLabel, actNumber, actView, parties, smetaRow, smetaRows, smetaTotals,
    ksPeriodMode, ksItems, ksTotals, vatSplit, netOf, vatTop,
    rdSheets, sheetsText, sheetsParse, importIssues, compactCode, unitNorm, dsList, dsById, dsLabel, contractPriceNow, workDates, smetaGroups, smetaOrdered, ksSeparate, ksScopeDs, ksBeforeScoped, ksDoneBefore, ksYearBefore, qtyDoneBefore, projectCheck, materialBalance
  };
})(typeof window !== 'undefined' ? window : globalThis);
