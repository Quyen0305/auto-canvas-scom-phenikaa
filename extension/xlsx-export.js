// Small, dependency-free OOXML writer for the extension. All cells are literal
// strings or numbers: question text can never turn into an Excel formula.
globalThis.SuiteXlsx = (() => {
  const enc = new TextEncoder();
  const table = Array.from({length: 256}, (_, i) => {
    for (let n = 0; n < 8; n++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
    return i >>> 0;
  });
  function crc(bytes) { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function concat(parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
  function zip(files) {
    if (files.length > 65535) throw Error('Quá nhiều file trong một lần xuất.');
    const locals = [], central = []; let offset = 0;
    for (const {name, data} of files) {
      const filename = enc.encode(name), bytes = typeof data === 'string' ? enc.encode(data) : data;
      if (offset + bytes.length > 0xffffffff) throw Error('File xuất vượt giới hạn ZIP 4 GB.');
      const local = new Uint8Array(30), l = new DataView(local.buffer), checksum = crc(bytes);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(12, 33, true);
      l.setUint32(14, checksum, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, filename.length, true);
      locals.push(local, filename, bytes);
      const header = new Uint8Array(46), h = new DataView(header.buffer);
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x800, true); h.setUint16(14, 33, true);
      h.setUint32(16, checksum, true); h.setUint32(20, bytes.length, true); h.setUint32(24, bytes.length, true); h.setUint16(28, filename.length, true); h.setUint32(42, offset, true);
      central.push(header, filename); offset += local.length + filename.length + bytes.length;
    }
    const directory = concat(central), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directory.length, true); e.setUint32(16, offset, true);
    return concat([...locals, directory, end]);
  }
  const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  function col(n) { let out = ''; do { out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26) - 1; } while (n >= 0); return out; }
  function sheet({rows, widths = [], instructions = false}) {
    if (rows.length > 1048576) throw Error('Lịch sử vượt số dòng tối đa của Excel.');
    const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    let body = '';
    for (let r = 0; r < rows.length; r++) {
      const style = r === 0 ? 1 : r === 1 && instructions ? 2 : 0;
      const height = style === 1 ? 32 : style === 2 ? 110 : Math.min(260, Math.max(44, ...rows[r].map((v, c) => Math.ceil(String(v ?? '').length / (widths[c] || 28)) * 15)));
      body += `<row r="${r + 1}" ht="${height}" customHeight="1">`;
      for (let c = 0; c < rows[r].length; c++) {
        const value = rows[r][c]; if (value == null || value === '') continue;
        if (String(value).length > 32767) throw Error(`Ô ${col(c)}${r + 1} vượt 32.767 ký tự; chưa xuất để tránh mất dữ liệu.`);
        const ref = `${col(c)}${r + 1}`;
        body += typeof value === 'number' && Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }
      body += '</row>';
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${col(columns - 1)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${instructions ? 2 : 1}" topLeftCell="A${instructions ? 3 : 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({length: columns}, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i] || 28}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
  }
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF266953"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF4F1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function workbook(sheets) {
    const files = [{name: '[Content_Types].xml', data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`},
      {name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name: 'xl/workbook.xml', data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`},
      {name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
      {name: 'xl/styles.xml', data: styles}];
    sheets.forEach((s, i) => files.push({name: `xl/worksheets/sheet${i + 1}.xml`, data: sheet(s)}));
    return zip(files);
  }
  return {zip, workbook};
})();
