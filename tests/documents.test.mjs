import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { parseDocxRegistration } from '../src/documents.js';

function paragraph(text) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(text) {
  return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr>${values.map(cell).join('')}</w:tr>`;
}

test('DOCX registration parser groups tables and flags repeated participants', () => {
  const headers = ['ทีม', 'ระดับชั้น', 'รายชื่อผู้เข้าแข่งขัน คนที่ 1', 'ห้อง', 'รายชื่อผู้เข้าแข่งขัน คนที่ 2', 'ห้อง'];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      ${paragraph('ประกาศรายชื่อ A-Math ม.ต้น')}
      <w:tbl>
        ${row(headers)}
        ${row(['ทีม 1', 'ม.ต้น', 'นักเรียน ก', 'ม.1/1', 'นักเรียน ข', 'ม.1/1'])}
        ${row(['ทีม 2', 'ม.ต้น', 'นักเรียน ก', 'ม.1/1', 'นักเรียน ค', 'ม.1/2'])}
      </w:tbl>
    </w:body></w:document>`;
  const docx = zipSync({ 'word/document.xml': strToU8(xml) });
  const result = parseDocxRegistration(docx.buffer);
  assert.equal(result.groups.length, 1);
  assert.equal(result.team_count, 2);
  assert.equal(result.groups[0].teams[0].member_1_room, 'ม.1/1');
  assert.equal(result.groups[0].teams[1].suspected_duplicate, true);
  assert.match(result.groups[0].teams[1].duplicate_reason, /นักเรียน ก/);
});

test('DOCX registration parser rejects documents without registration tables', () => {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph('ไม่มีตาราง')}</w:body></w:document>`;
  const docx = zipSync({ 'word/document.xml': strToU8(xml) });
  assert.throws(() => parseDocxRegistration(docx.buffer), /ไม่พบตาราง/);
});

test('document exports bundle and load TH Sarabun PSK faces', async () => {
  const fontDirectory = new URL('../public/assets/fonts/', import.meta.url);
  for (const file of ['THSarabunPSK-Regular.ttf', 'THSarabunPSK-Bold.ttf', 'THSarabunPSK-Italic.ttf', 'THSarabunPSK-BoldItalic.ttf']) {
    assert.ok((await stat(new URL(file, fontDirectory))).size > 90_000);
  }

  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(styles, /font-family: "TH Sarabun PSK"/);
  assert.match(app, /loadDocumentFonts/);
  assert.match(app, /document\.fonts\.load\('700 24px "TH Sarabun PSK"'/);
  assert.match(app, /data-action="export-pairing-sheet"/);
  assert.match(app, /async function exportPairingSheet/);
  assert.match(app, /const maxRowsPerPage = 10/);
  assert.match(app, /const rowsPerPage = Math\.ceil/);
  assert.match(app, /สร้างใบมาสเตอร์เปล่า \(PDF\)/);
  assert.match(app, /data-mode="empty"/);
  assert.match(app, /mode === 'empty' \? \[null\] : teams/);
});
