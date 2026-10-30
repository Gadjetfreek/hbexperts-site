// Minimal dependency-free PDF writer (Helvetica text, vector signature strokes, diagonal watermark).
const te = new TextEncoder();

export function pdfSafe(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function wrap(text, max = 96) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

// blocks: [{text, size?, bold?, gap?}] | [{signature:{kind,text,strokes}, label}]
export function buildPdf(blocks, { watermark = '', footer = '' } = {}) {
  const pages = []; let ops = []; let y = 748;
  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = 748; };
  const need = h => { if (y - h < 60) newPage(); };
  for (const b of blocks) {
    if (b.signature) {
      need(70);
      ops.push(`BT /F1 9 Tf 54 ${y} Td (${pdfSafe(b.label)}) Tj ET`);
      y -= 14;
      const s = b.signature;
      if (s.kind === 'drawn' && Array.isArray(s.strokes)) {
        ops.push('0.1 0.1 0.3 RG 1.2 w 1 J 1 j');
        for (const stroke of s.strokes) {
          if (!Array.isArray(stroke) || stroke.length < 2) continue;
          const pt = p => `${(54 + Number(p[0]) * 0.5).toFixed(1)} ${(y - Number(p[1]) * 0.5).toFixed(1)}`;
          ops.push(`${pt(stroke[0])} m ` + stroke.slice(1).map(p => `${pt(p)} l`).join(' ') + ' S');
        }
        y -= 52;
      } else {
        ops.push(`BT /F3 18 Tf 54 ${y - 18} Td (${pdfSafe(s.text)}) Tj ET`);
        y -= 30;
      }
      ops.push(`0 0 0 RG 0.5 w 54 ${y} m 320 ${y} l S`);
      y -= 16;
      continue;
    }
    const size = b.size || 9.5; const lh = size * 1.3; const font = b.bold ? 'F2' : 'F1';
    const lines = wrap(b.text, Math.floor(96 * 9.5 / size));
    if (b.eho) { // Equal Housing Opportunity mark (drawn house + bars) and caption
      need(34); const x = 54, top = y + 8;
      ops.push(`0 0 0 rg ${x + 13} ${top} m ${x} ${top - 9} l ${x + 3} ${top - 9} l ${x + 3} ${top - 24} l ${x + 23} ${top - 24} l ${x + 23} ${top - 9} l ${x + 26} ${top - 9} l f`);
      ops.push(`1 1 1 rg ${x + 7} ${top - 14} 12 2.5 re f ${x + 7} ${top - 19} 12 2.5 re f 0 0 0 rg`);
      ops.push(`BT /F2 ${size} Tf ${x + 34} ${top - 16} Td (${pdfSafe(b.text)}) Tj ET`);
      y -= 30; continue;
    }
    if (b.box) { // conspicuous boxed statement
      const bl = wrap(b.text, Math.floor(90 * 9.5 / size)); const h = bl.length * lh + 8;
      need(h + 6); ops.push(`0 0 0 RG 1.2 w 50 ${(y - h + lh).toFixed(1)} 512 ${h.toFixed(1)} re S`);
      y -= 2; for (const l of bl) { ops.push(`BT /F2 ${size} Tf 58 ${y} Td (${pdfSafe(l)}) Tj ET`); y -= lh; }
      y -= 10; continue;
    }
    for (const l of lines) { need(lh); ops.push(`BT /${font} ${size} Tf 54 ${y} Td (${pdfSafe(l)}) Tj ET`); y -= lh; }
    y -= b.gap ?? 4;
  }
  newPage();
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const catalog = add(''); const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const gs = add('<< /Type /ExtGState /ca 0.18 /CA 0.18 >>');
  const kids = [];
  pages.forEach((p, i) => {
    const wm = watermark ? `q /GS1 gs 0.75 0 0 RG 0.75 0 0 rg BT /F2 40 Tf 0.7071 0.7071 -0.7071 0.7071 110 220 Tm (${pdfSafe(watermark)}) Tj ET Q` : '';
    const ft = `BT /F1 8 Tf 54 36 Td (${pdfSafe(footer)}  Page ${i + 1} of ${pages.length}) Tj ET`;
    const content = [...p, wm, ft].join('\n');
    const c = add(`<< /Length ${te.encode(content).length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> /ExtGState << /GS1 ${gs} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(te.encode(out).length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = te.encode(out).length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return te.encode(out);
}
