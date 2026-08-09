import { unzipSync } from 'fflate';

function decodeXml(value) {
  return String(value || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textFromXml(xml) {
  return [...String(xml).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[.\-–—]/g, '').toLocaleLowerCase('th');
}

function tableRows(xml) {
  return [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((rowMatch) =>
    [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) => textFromXml(cellMatch[0]))
  );
}

function findColumn(headers, patterns, fallback) {
  const index = headers.findIndex((header) => patterns.some((pattern) => normalize(header).includes(normalize(pattern))));
  return index >= 0 ? index : fallback;
}

function mapRegistrationTable(rows, heading, tableIndex) {
  if (rows.length < 2) return null;
  const headers = rows[0];
  const teamIndex = findColumn(headers, ['ทีม'], 0);
  const levelIndex = findColumn(headers, ['ระดับชั้น'], 1);
  const nameIndices = headers.map((header, index) => normalize(header).includes(normalize('รายชื่อผู้เข้าแข่งขัน')) ? index : -1).filter((index) => index >= 0);
  const roomIndices = headers.map((header, index) => normalize(header).includes(normalize('ห้อง')) ? index : -1).filter((index) => index >= 0);
  const member1Index = nameIndices[0] ?? 2;
  const member2Index = nameIndices[1] ?? 4;
  const room1Index = roomIndices[0] ?? 3;
  const room2Index = roomIndices[1] ?? 5;
  const teams = rows.slice(1).map((cells, index) => ({
    row_number: index + 2,
    code: '',
    name: cells[teamIndex] || `ทีม ${index + 1}`,
    level: cells[levelIndex] || '',
    member_1: cells[member1Index] || '',
    member_1_room: cells[room1Index] || '',
    member_2: cells[member2Index] || '',
    member_2_room: cells[room2Index] || '',
    suspected_duplicate: false,
    duplicate_reason: ''
  })).filter((team) => team.name || team.member_1 || team.member_2);
  if (!teams.length) return null;

  const pairSeen = new Map();
  const memberSeen = new Map();
  for (const team of teams) {
    const pairKey = [normalize(team.member_1), normalize(team.member_2)].filter(Boolean).sort().join('|');
    const repeated = [];
    for (const member of [team.member_1, team.member_2]) {
      const key = normalize(member);
      if (key && memberSeen.has(key)) repeated.push(member);
    }
    if (pairKey && pairSeen.has(pairKey)) {
      team.suspected_duplicate = true;
      team.duplicate_reason = `ผู้แข่งขันตรงกับ ${pairSeen.get(pairKey)}`;
    } else if (repeated.length) {
      team.suspected_duplicate = true;
      team.duplicate_reason = `พบชื่อซ้ำ: ${repeated.join(', ')}`;
    }
    if (pairKey) pairSeen.set(pairKey, team.name);
    for (const member of [team.member_1, team.member_2]) {
      const key = normalize(member);
      if (key) memberSeen.set(key, team.name);
    }
  }

  const category = teams.find((team) => team.level)?.level || `กลุ่ม ${tableIndex + 1}`;
  return {
    title: heading || `รายชื่อผู้แข่งขัน ${category}`,
    category,
    table_index: tableIndex,
    teams,
    warnings: teams.filter((team) => team.suspected_duplicate).map((team) => `${team.name}: ${team.duplicate_reason}`)
  };
}

export function parseDocxRegistration(buffer) {
  let files;
  let documentTooLarge = false;
  try {
    files = unzipSync(new Uint8Array(buffer), { filter: (file) => {
      if (file.name !== 'word/document.xml') return false;
      if (file.originalSize > 5 * 1024 * 1024) { documentTooLarge = true; return false; }
      return true;
    } });
  } catch {
    throw new Error('ไม่สามารถเปิดไฟล์ Word นี้ได้ กรุณาใช้ไฟล์ .docx ที่ไม่เสียหาย');
  }
  if (documentTooLarge) throw new Error('ตารางในไฟล์ Word มีขนาดใหญ่เกินไป กรุณาแบ่งรายชื่อเป็นหลายไฟล์');
  const documentXml = files['word/document.xml'];
  if (!documentXml) throw new Error('ไฟล์นี้ไม่ใช่เอกสาร Word .docx ที่รองรับ');
  const xml = new TextDecoder().decode(documentXml);
  const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
  const groups = [];
  let heading = '';
  for (const block of blocks) {
    if (block.startsWith('<w:p')) {
      const text = textFromXml(block);
      if (text) heading = text;
      continue;
    }
    const group = mapRegistrationTable(tableRows(block), heading, groups.length);
    if (group) groups.push(group);
  }
  if (!groups.length) throw new Error('ไม่พบตารางรายชื่อผู้แข่งขันในเอกสาร');
  return {
    groups,
    team_count: groups.reduce((sum, group) => sum + group.teams.length, 0),
    warning_count: groups.reduce((sum, group) => sum + group.warnings.length, 0)
  };
}
