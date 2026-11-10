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
    ['orgs', 'people', 'materials', 'works', 'acts', 'smeta', 'rdSections', 'ksHistory'].forEach(k => {
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
    let found = null;
    p.people.forEach(r => { if (r.role === role && (!r.to || r.to >= t)) found = r; });
    return found;
  }

  // ---------- материалы ----------
  function matNo(p, m) { const i = p.materials.indexOf(m); return i < 0 ? '' : ('00' + (i + 1)).slice(-3); }
  function matName(m) { return s(m.name) + (m.mark ? ' ' + m.mark : ''); }
  function matLabel(p, m) { return matNo(p, m) + ' | ' + matName(m); }
  function docText(type, no, date, until) {
    if (!type) return '';
    let t = lowerFirst(type);
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
    return [m.doc1Type ? m.doc1Until : '', m.doc2Type ? m.doc2Until : ''].filter(Boolean).sort()[0] || '';
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
  const smetaRows = (p, worksOnly) => p.smeta.filter(r => r.name && (!worksOnly || num(r.priceWork)));
  function smetaTotals(p, worksOnly) {
    let total = 0, work = 0, mat = 0;
    smetaRows(p, worksOnly).forEach(r => { const c = smetaRow(r, worksOnly); total += c.total; work += c.work; mat += c.mat; });
    total = round2(total); work = round2(work); mat = round2(mat);
    const vat = num(p.settings.vat);
    return { total, work, mat, vatSum: round2(total * vat / (1 + vat)), vatPct: Math.round(vat * 100) };
  }

  // ---------- КС за период ----------
  // если у позиций сметы заполнено «выполнено в этом периоде» (qtyNow) — КС-2 только по ним и на этот объём;
  // иначе — на всю смету, как раньше
  const ksPeriodMode = p => p.smeta.some(r => r.name && s(r.qtyNow) !== '');
  function ksItems(p) {
    const wo = !!p.ks.worksOnly, pm = ksPeriodMode(p);
    return smetaRows(p, wo).filter(r => !pm || num(r.qtyNow)).map(r => {
      const qty = pm ? r.qtyNow : r.qty;
      return { r, qty, c: smetaRow(Object.assign({}, r, { qty }), wo) };
    });
  }
  function ksTotals(p) {
    let total = 0, work = 0, mat = 0;
    ksItems(p).forEach(({ c }) => { total += c.total; work += c.work; mat += c.mat; });
    total = round2(total);
    const vat = num(p.settings.vat);
    return { total, work: round2(work), mat: round2(mat), vatSum: round2(total * vat / (1 + vat)), vatPct: Math.round(vat * 100) };
  }
  // закрытые КС: сумма и объёмы по позициям
  const ksDoneBefore = p => round2((p.ksHistory || []).reduce((a, h) => a + num(h.total), 0));
  function ksYearBefore(p) {
    const y = (parseDate(p.ks.date) || new Date()).getFullYear();
    return round2((p.ksHistory || []).filter(h => (parseDate(h.date) || new Date(0)).getFullYear() === y).reduce((a, h) => a + num(h.total), 0));
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
    // акты
    const acts = p.acts.filter(a => a.type);
    const nums = {};
    acts.forEach(a => {
      const v = actView(p, a), label = a.type + ' № ' + v.number;
      v.warnings.forEach(t => E('#/acts', label + ': ' + t + '.'));
      if (!v.name) E('#/acts', label + ': нет наименования работ.');
      const rd = rdFor(p, a, p.works.find(x => x.id === a.workId));
      if (!rd.code) W('#/works', label + ': не задан шифр РД (ни у раздела, ни общий).');
      if (st.startDate && a.start && a.start < st.startDate) W('#/acts', label + ': начало работ ' + fmtDate(a.start) + ' раньше начала по договору ' + fmtDate(st.startDate) + '.');
      if (st.endDate && a.end && a.end > st.endDate) W('#/acts', label + ': окончание ' + fmtDate(a.end) + ' позже срока по договору ' + fmtDate(st.endDate) + '.');
      (a.materials || []).forEach(id => {
        const m = p.materials.find(x => x.id === id);
        if (!m) { W('#/acts', label + ': в акте указан удалённый материал.'); return; }
        if (m.deliveryDate && a.start && m.deliveryDate > (a.end || a.start)) W('#/acts', label + ': материал «' + matName(m) + '» поставлен ' + fmtDate(m.deliveryDate) + ', позже работ.');
      });
      const key = a.type + '|' + v.number;
      if (nums[key]) E('#/acts', 'Номер ' + label + ' повторяется.'); else nums[key] = 1;
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
      const price = num(st.contractPrice);
      if (price) {
        const full = smetaTotals(p).total;
        if (Math.abs(full - price) > 0.01) W('#/smeta', 'Смета ' + money(full) + ' ≠ цене договора ' + money(price) + ' (разница ' + money(full - price) + ').');
        const done = ksDoneBefore(p) + tot.total;
        if (done - price > 0.01) E('#/smeta', 'С учётом прошлых КС выполнено на ' + money(done) + ' — больше цены договора ' + money(price) + '.');
      }
    }
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
    ksPeriodMode, ksItems, ksTotals, ksDoneBefore, ksYearBefore, qtyDoneBefore, projectCheck, materialBalance
  };
})(typeof window !== 'undefined' ? window : globalThis);
