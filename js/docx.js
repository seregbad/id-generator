/* Генератор ИД — выгрузка в Word (.docx).
   Те же формы, что и PDF: описание документа для pdfmake (pdf.js) переводится в WordprocessingML —
   абзацы, таблицы с рамками и объединёнными ячейками, разрывы страниц, книжные/альбомные разделы,
   номера страниц, картинки подписей и печатей. Файл собирается JSZip, без интернета. */
(function (global) {
  'use strict';
  const TW = 20;                 // пункт → twips
  const EMU = 12700;             // пункт → EMU (картинки)
  const PAGE = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const STYLE_KEYS = ['fontSize', 'bold', 'italics', 'alignment', 'color', 'lineHeight'];
  const inherit = (base, node) => { const o = Object.assign({}, base); STYLE_KEYS.forEach(k => { if (node && node[k] !== undefined) o[k] = node[k]; }); return o; };

  function convert(dd) {
    const media = [];             // {name, data(base64)}
    const orient0 = dd.pageOrientation || 'portrait';
    const margins = dd.pageMargins || [40, 40, 40, 40];
    const contentW = o => PAGE[o][0] - margins[0] - margins[2];
    let orient = orient0;
    const base = { fontSize: (dd.defaultStyle && dd.defaultStyle.fontSize) || 10, alignment: 'left' };

    // ---------- текст ----------
    function runs(t, st) {
      if (t === null || t === undefined) return '';
      if (Array.isArray(t)) return t.map(x => typeof x === 'object' && x ? runs(x.text, inherit(st, x)) : runs(x, st)).join('');
      if (typeof t === 'object') return runs(t.text, inherit(st, t));
      const rpr = '<w:rPr>' + (st.bold ? '<w:b/>' : '') + (st.italics ? '<w:i/>' : '') + (st.color ? '<w:color w:val="' + String(st.color).replace('#', '') + '"/>' : '') +
        '<w:sz w:val="' + Math.round(st.fontSize * 2) + '"/><w:szCs w:val="' + Math.round(st.fontSize * 2) + '"/></w:rPr>';
      return String(t).split('\n').map((line, i) => (i ? '<w:r>' + rpr + '<w:br/></w:r>' : '') + (line ? '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(line) + '</w:t></w:r>' : '')).join('');
    }
    const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };
    function para(inner, st, node, extraPPr) {
      const m = (node && node.margin) || [0, 0, 0, 0];
      const mm = Array.isArray(m) ? (m.length === 2 ? [m[0], m[1], m[0], m[1]] : m) : [m, m, m, m];
      const lh = st.lineHeight ? Math.round(240 * st.lineHeight) : 240;
      const ppr = '<w:pPr>' + (extraPPr || '') + '<w:spacing w:before="' + Math.max(0, Math.round(mm[1] * TW)) + '" w:after="' + Math.max(0, Math.round(mm[3] * TW)) + '" w:line="' + lh + '" w:lineRule="auto"/>' +
        (mm[0] || mm[2] ? '<w:ind w:left="' + Math.max(0, Math.round(mm[0] * TW)) + '" w:right="' + Math.max(0, Math.round(mm[2] * TW)) + '"/>' : '') +
        '<w:jc w:val="' + (JC[st.alignment] || 'left') + '"/><w:rPr><w:sz w:val="' + Math.round(st.fontSize * 2) + '"/></w:rPr></w:pPr>';
      return '<w:p>' + ppr + inner + '</w:p>';
    }
    const emptyPara = st => para('', st || base, null);
    // пустой абзац точной высоты (отступы вокруг таблиц; обязательный абзац после таблицы в ячейке и в конце документа)
    const spacer = pt => '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="' + Math.max(20, Math.round(pt * TW)) + '" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';

    // ---------- картинки (подписи, печати) ----------
    function image(node, st) {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(node.image || '');
      if (!m) return '';
      const ext = m[1] === 'png' ? 'png' : 'jpeg';
      const name = 'image' + (media.length + 1) + '.' + (ext === 'png' ? 'png' : 'jpg');
      media.push({ name, data: m[2], ext });
      const rid = 'rIdImg' + media.length;
      let w = 100, h = 50;
      const bin = atob(m[2].slice(0, 400));
      if (ext === 'png' && bin.length > 24) { w = (bin.charCodeAt(16) << 24 | bin.charCodeAt(17) << 16 | bin.charCodeAt(18) << 8 | bin.charCodeAt(19)) * 0.75; h = (bin.charCodeAt(20) << 24 | bin.charCodeAt(21) << 16 | bin.charCodeAt(22) << 8 | bin.charCodeAt(23)) * 0.75; }
      const fit = node.fit || [node.width || w, node.height || h];
      const k = Math.min(fit[0] / w, fit[1] / h, 1e9);
      const cx = Math.round(w * k * EMU), cy = Math.round(h * k * EMU);
      const id = media.length;
      const drawing = '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Рисунок ' + id + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
      return para(drawing, inherit(st, node), null);
    }

    // ---------- таблицы ----------
    function colWidths(widths, rows, avail) {
      const fixed = widths.map(w => typeof w === 'number' ? w : null);
      const autoW = widths.map((w, i) => w === 'auto' ? Math.min(avail / 2, Math.max(18, ...rows.map(r => textLen(r[i]) * 5 + 6))) : null);
      const used = fixed.reduce((a, w) => a + (w || 0), 0) + autoW.reduce((a, w) => a + (w || 0), 0);
      const stars = widths.filter(w => typeof w === 'string' && w !== 'auto').length;
      const starW = stars ? Math.max(20, (avail - used) / stars) : 0;
      return widths.map((w, i) => fixed[i] !== null ? fixed[i] : autoW[i] !== null ? autoW[i] : starW);
    }
    const textLen = c => { if (!c) return 0; if (typeof c === 'string') return c.length; if (Array.isArray(c)) return c.reduce((a, x) => a + textLen(x), 0); if (c.text !== undefined) return typeof c.text === 'string' ? Math.max(...c.text.split('\n').map(x => x.length)) : textLen(c.text); return 0; };
    function table(node, st, avail) {
      // avail = null — ширина текущего листа (книжный / альбомный меняется по ходу документа)
      avail = avail || contentW(orient);
      const t = node.table, rows = t.body || [];
      if (!rows.length) return '';
      const n = Math.max(...rows.map(r => r.length));
      const widths = colWidths((t.widths || Array(n).fill('*')).slice(0, n).concat(Array(Math.max(0, n - (t.widths || []).length)).fill('*')), rows, avail);
      const grid = node.layout && node.layout.hLineWidth && node.layout.hLineWidth() === 0 ? 'none' : node.layout && node.layout.paddingLeft && node.layout.paddingLeft() >= 3 ? 'grid' : 'ul';
      const tst = inherit(st, node);
      const pad = grid === 'grid' ? 50 : 20;
      let xml = '<w:tbl><w:tblPr><w:tblW w:w="' + Math.round(widths.reduce((a, b) => a + b, 0) * TW) + '" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
        '<w:tblCellMar><w:top w:w="' + (grid === 'grid' ? 30 : 10) + '" w:type="dxa"/><w:left w:w="' + pad + '" w:type="dxa"/><w:bottom w:w="' + (grid === 'grid' ? 30 : 0) + '" w:type="dxa"/><w:right w:w="' + pad + '" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
        '<w:tblGrid>' + widths.map(w => '<w:gridCol w:w="' + Math.round(w * TW) + '"/>').join('') + '</w:tblGrid>';
      const pending = {};   // столбец → {left, span, border} — ячейки, продолжающие rowSpan
      rows.forEach((row, ri) => {
        xml += '<w:tr><w:trPr>' + (ri < (t.headerRows || 0) ? '<w:tblHeader/>' : '') + (node.unbreakable || t.dontBreakRows ? '<w:cantSplit/>' : '') + '</w:trPr>';
        for (let c = 0; c < n;) {
          if (pending[c] && pending[c].left > 0) {
            const pd = pending[c]; pd.left--;
            xml += cellXml(widths.slice(c, c + pd.span), pd.span, 'continue', pd.border, pd.fill, emptyPara(tst));
            c += pd.span; continue;
          }
          let cell = row[c];
          if (cell === undefined) cell = '';
          const cs = (cell && cell.colSpan) || 1, rs = (cell && cell.rowSpan) || 1;
          const border = cell && Array.isArray(cell.border) ? cell.border : grid === 'none' ? [false, false, false, false] : [true, true, true, true];
          const fill = cell && cell.fillColor;
          const cst = typeof cell === 'object' && cell ? inherit(tst, cell) : tst;
          let inner = blocks(cell, tst, widths.slice(c, c + cs).reduce((a, b) => a + b, 0) - 4);
          if (!inner) inner = emptyPara(cst);
          else if (/<\/w:tbl>$/.test(inner)) inner += spacer(1);
          if (rs > 1) pending[c] = { left: rs - 1, span: cs, border, fill };
          xml += cellXml(widths.slice(c, c + cs), cs, rs > 1 ? 'restart' : '', border, fill, inner, cell && cell.verticalAlign);
          c += cs;
        }
        xml += '</w:tr>';
      });
      return xml + '</w:tbl>';
    }
    function cellXml(ws, span, vmerge, border, fill, inner) {
      const b = (side, on) => '<w:' + side + ' w:val="' + (on ? 'single' : 'nil') + '"' + (on ? ' w:sz="4" w:space="0" w:color="000000"' : '') + '/>';
      return '<w:tc><w:tcPr><w:tcW w:w="' + Math.round(ws.reduce((a, x) => a + x, 0) * TW) + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') +
        (vmerge ? '<w:vMerge' + (vmerge === 'restart' ? ' w:val="restart"' : '') + '/>' : '') +
        '<w:tcBorders>' + b('top', border[1]) + b('left', border[0]) + b('bottom', border[3]) + b('right', border[2]) + '</w:tcBorders>' +
        (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + String(fill).replace('#', '') + '"/>' : '') + '<w:vAlign w:val="center"/></w:tcPr>' + inner + '</w:tc>';
    }

    // ---------- блоки ----------
    function sectPr(o) {
      const [w, h] = PAGE[o];
      return '<w:sectPr>' + (dd.footer ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '') + '<w:pgSz w:w="' + Math.round(w * TW) + '" w:h="' + Math.round(h * TW) + '"' + (o === 'landscape' ? ' w:orient="landscape"' : '') + '/>' +
        '<w:pgMar w:top="' + Math.round(margins[1] * TW) + '" w:right="' + Math.round(margins[2] * TW) + '" w:bottom="' + Math.round(margins[3] * TW) + '" w:left="' + Math.round(margins[0] * TW) + '" w:header="200" w:footer="200" w:gutter="0"/></w:sectPr>';
    }
    function blocks(node, st, avail) {
      if (node === null || node === undefined || node === '') return '';
      if (typeof node === 'string' || typeof node === 'number') return para(runs(String(node), st), st, null);
      if (Array.isArray(node)) return node.map(x => blocks(x, st, avail)).join('');
      let pre = '';
      // разрыв страницы; смена ориентации листа — новый раздел
      if (node.pageBreak === 'before') {
        if (node.pageOrientation && node.pageOrientation !== orient) { pre = '<w:p><w:pPr>' + sectPr(orient) + '</w:pPr></w:p>'; orient = node.pageOrientation; }
        else pre = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
      const nst = inherit(st, node);
      let out;
      if (node.table) out = table(node, st, avail) + (node.margin ? '' : '');
      else if (node.stack) out = blocks(node.stack, nst, avail);
      else if (node.columns) {
        const cols = node.columns, aw = avail || contentW(orient);
        const ws = colWidths(cols.map(c => (c && c.width) || '*'), [cols], aw - (node.columnGap || 0) * (cols.length - 1));
        out = table({ table: { widths: ws, body: [cols.map(c => c)] }, layout: { hLineWidth: () => 0 } }, nst, avail);
      }
      else if (node.image) out = image(node, nst);
      else if (node.ul || node.ol) out = (node.ul || node.ol).map((x, i) => para(runs((node.ol ? (i + 1) + '. ' : '• '), nst) + runs(typeof x === 'object' ? x.text : x, nst), nst, null)).join('');
      else if (node.text !== undefined) out = para(runs(node.text, nst), nst, node);
      else out = '';
      // отступы над / под таблицей — абзацами точной высоты (у таблиц в Word своих отступов нет)
      if ((node.table || node.columns) && Array.isArray(node.margin)) {
        if (node.margin[1] > 1) out = spacer(node.margin[1]) + out;
        if (node.margin[3] > 1) out += spacer(node.margin[3]);
      }
      // две таблицы подряд Word склеивает в одну — разделяем
      return pre + out;
    }

    let body = blocks(dd.content, base, null).replace(/<\/w:tbl><w:tbl>/g, '</w:tbl>' + spacer(1) + '<w:tbl>');
    if (/<\/w:tbl>$/.test(body) || !body) body += spacer(1);
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<w:body>' + body + sectPr(orient) + '</w:body></w:document>';
    return { doc, media, footer: !!dd.footer, title: (dd.info && dd.info.title) || 'Документ', fontSize: base.fontSize };
  }

  async function toBlob(dd) {
    if (!global.JSZip) throw new Error('JSZip не загружен');
    const r = convert(dd);
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      (r.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    z.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(r.title) + '</dc:title><dc:creator>Генератор ИД</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>');
    z.file('word/document.xml', r.doc);
    z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="' + Math.round(r.fontSize * 2) + '"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="20" w:type="dxa"/><w:right w:w="20" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>');
    let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    if (r.footer) {
      rels += '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';
      const f = (instr) => '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + instr + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
      z.file('word/footer1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:sz w:val="14"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t xml:space="preserve">стр. </w:t></w:r>' + f('PAGE') + '<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t xml:space="preserve"> из </w:t></w:r>' + f('NUMPAGES') + '</w:p></w:ftr>');
    }
    r.media.forEach((m, i) => {
      rels += '<Relationship Id="rIdImg' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.name + '"/>';
      z.file('word/media/' + m.name, m.data, { base64: true });
    });
    z.file('word/_rels/document.xml.rels', rels + '</Relationships>');
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  global.IDDocx = { toBlob, convert };
})(window);
