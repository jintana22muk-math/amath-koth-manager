const app = document.querySelector('#app');
const PUBLIC_CODE = new URLSearchParams(location.search).get('public');

const state = {
  authenticated: false,
  tournaments: [],
  selectedId: localStorage.getItem('amath-koth:selected-tournament') || '',
  data: null,
  view: 'dashboard',
  modal: null,
  toasts: []
};

const navItems = [
  ['dashboard', 'ภาพรวม'],
  ['tournaments', 'รายการแข่งขัน'],
  ['teams', 'ทีมแข่งขัน'],
  ['koth', 'จับคู่และบันทึกผล'],
  ['standings', 'ตารางคะแนน'],
  ['reports', 'รายงานและเผยแพร่'],
  ['settings', 'ตั้งค่ารายการ']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function short(value, length = 50) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function badge(status) {
  return `<span class="badge ${escapeHtml(status)}">${({ open: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', draft: 'ร่าง', pending: 'รอผล', final: 'ยืนยันผลแล้ว', archived: 'เก็บถาวร' }[status] || escapeHtml(status))}</span>`;
}

function teamName(team) {
  return team ? `${escapeHtml(team.name)} <span class="team-meta">${escapeHtml(team.code)}</span>` : '<span class="muted">—</span>';
}

function notify(message, type = '') {
  const item = { id: crypto.randomUUID(), message, type };
  state.toasts.push(item);
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((toast) => toast.id !== item.id);
    render();
  }, 4200);
}

async function api(path, options = {}) {
  const config = { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } };
  const response = await fetch(path, config);
  let data;
  try { data = await response.json(); } catch { data = { ok: false, error: 'ระบบตอบกลับข้อมูลไม่ถูกต้อง' }; }
  if (!response.ok || data.ok === false) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ');
  return data;
}

function setSelected(id) {
  state.selectedId = id || '';
  if (id) localStorage.setItem('amath-koth:selected-tournament', id);
  else localStorage.removeItem('amath-koth:selected-tournament');
}

async function loadTournaments() {
  const response = await api('/api/tournaments');
  state.tournaments = response.tournaments;
  if (!state.tournaments.some((tournament) => tournament.id === state.selectedId)) setSelected(state.tournaments[0]?.id || '');
}

async function loadTournament() {
  if (!state.selectedId) { state.data = null; return; }
  const response = await api(`/api/tournaments/${encodeURIComponent(state.selectedId)}`);
  state.data = response;
}

async function refreshAll() {
  await loadTournaments();
  await loadTournament();
  render();
}

function pageHeading() {
  const tournament = state.data?.tournament;
  const titles = {
    dashboard: ['ภาพรวมการแข่งขัน', 'ติดตามความพร้อมของรายการและไปยังขั้นตอนถัดไป'],
    tournaments: ['รายการแข่งขัน', 'สร้างรายการใหม่ เก็บประวัติเดิม และสำรองข้อมูลได้ไม่จำกัดปี'],
    teams: ['ทีมแข่งขัน', 'เพิ่ม แก้ไข ถอน หรือกู้คืนทีมได้ตลอดรายการ'],
    koth: ['จับคู่และบันทึกผล', 'จับคู่แบบ King of the Hill พร้อมกันพบซ้ำ และบันทึกคะแนนรายโต๊ะ'],
    standings: ['ตารางคะแนน KOTH', 'เรียงอันดับตามกติกาที่กำหนดไว้ และอัปเดตทันทีเมื่อยืนยันผล'],
    reports: ['รายงานและเผยแพร่', 'ส่งออกข้อมูล พิมพ์เอกสาร และเปิดตารางคะแนนสาธารณะ'],
    settings: ['ตั้งค่ารายการแข่งขัน', 'กำหนดระบบคะแนน ผลต่างคะแนน และการเผยแพร่ข้อมูล']
  };
  const [title, subtitle] = titles[state.view] || titles.dashboard;
  return `<div class="topbar"><div><h2>${title}</h2><p>${subtitle}</p></div>${tournament ? tournamentPicker() : ''}</div>`;
}

function tournamentPicker() {
  return `<div class="tournament-switch"><label for="tournament-selector">รายการที่กำลังจัดการ</label><select id="tournament-selector">${state.tournaments.map((tournament) => `<option value="${escapeHtml(tournament.id)}" ${tournament.id === state.selectedId ? 'selected' : ''}>${escapeHtml(tournament.name)}${tournament.academic_year ? ` · ${escapeHtml(tournament.academic_year)}` : ''}</option>`).join('')}</select></div>`;
}

function renderNoTournament() {
  return `<section class="card hero"><h2>เริ่มระบบจัดการแข่งขัน A-Math KOTH ของคุณ</h2><p>สร้างรายการแข่งขันใหม่ก่อน แล้วเพิ่มทีม ตั้งค่ากติกา จับคู่การแข่งขัน บันทึกผล และเผยแพร่ตารางคะแนนได้จากที่เดียว</p><div class="hero-actions"><button class="button primary" data-action="new-tournament">＋ สร้างรายการแข่งขันแรก</button><button class="button secondary" data-action="go-tournaments">ดูรายการแข่งขัน</button></div></section>`;
}

function renderDashboard() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const tournament = data.tournament;
  const koth = data.rounds.filter((round) => round.phase === 'koth');
  const active = data.teams.filter((team) => team.is_active);
  const completed = koth.filter((round) => round.status === 'completed').length;
  const current = koth.find((round) => round.status === 'open');
  const top = data.standings.slice(0, 5);
  return `
    <section class="card hero">
      <div class="split"><div><span class="badge ${escapeHtml(tournament.status)}">${tournament.status === 'draft' ? 'กำลังเตรียมรายการ' : tournament.status === 'open' ? 'กำลังแข่งขัน' : 'เสร็จสิ้น'}</span><h2>${escapeHtml(tournament.name)}</h2><p>${[tournament.category, tournament.academic_year, tournament.venue].filter(Boolean).map(escapeHtml).join(' · ') || 'ยังไม่ได้ระบุรายละเอียดสถานที่และปีการศึกษา'}</p></div><div class="button-row"><button class="button secondary" data-action="go-teams">จัดการทีม</button><button class="button primary" data-action="go-koth">ไปที่การจับคู่</button></div></div>
    </section>
    <section class="grid grid-4" style="margin-top:16px">
      <article class="card metric"><div class="metric-label">ทีมที่เข้าร่วม</div><div class="metric-value">${active.length}</div><div class="metric-note">ทีมที่เปิดใช้งาน</div></article>
      <article class="card metric"><div class="metric-label">เกม KOTH ที่เสร็จแล้ว</div><div class="metric-value">${completed}/${tournament.rounds_planned}</div><div class="metric-note">สร้างเพิ่มได้ตามต้องการ</div></article>
      <article class="card metric"><div class="metric-label">สถานะรอบปัจจุบัน</div><div class="metric-value" style="font-size:21px">${current ? escapeHtml(current.title) : (completed ? 'พร้อมรอบถัดไป' : 'รอสร้างคู่')}</div><div class="metric-note">${current ? 'บันทึกผลให้ครบก่อนสร้างเกมถัดไป' : 'เริ่มต้นได้เมื่อมีอย่างน้อย 2 ทีม'}</div></article>
      <article class="card metric"><div class="metric-label">ตารางคะแนนสาธารณะ</div><div class="metric-value" style="font-size:21px">${tournament.public_enabled ? 'เปิดแล้ว' : 'ปิดอยู่'}</div><div class="metric-note">${tournament.public_enabled ? `รหัส: ${escapeHtml(tournament.code)}` : 'เปิดได้ในหน้าตั้งค่า'}</div></article>
    </section>
    <section class="section-head"><div><h3>ผู้นำคะแนนล่าสุด</h3><p>อัปเดตจากผลที่ยืนยันแล้วเท่านั้น</p></div><button class="button ghost small" data-action="go-standings">ดูตารางเต็ม</button></section>
    ${top.length ? standingsTable(top, true) : `<section class="card empty"><div class="empty-icon">⌁</div><h3>ยังไม่มีรายชื่อทีม</h3><p>เพิ่มทีมก่อนเริ่มจัดการแข่งขัน</p><button class="button primary" data-action="go-teams">เพิ่มทีมแข่งขัน</button></section>`}
  `;
}

function standingsTable(rows, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>#</th><th>ทีม</th><th class="right-align">คะแนน</th><th class="right-align">ชนะ</th><th class="right-align">เสมอ</th><th class="right-align">แพ้</th><th class="right-align">BYE</th><th class="right-align">ผลต่าง*</th><th class="right-align">แต้มได้</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.is_active === false ? 'is-muted' : ''}"><td class="rank ${row.rank <= 3 ? `top-${row.rank}` : ''}">${row.rank}</td><td><div class="team-title">${escapeHtml(row.name)} <span class="code-pill">${escapeHtml(row.code)}</span>${row.is_active === false ? ' <span class="badge archived">ถอนแล้ว</span>' : ''}</div>${row.school ? `<div class="team-meta">${escapeHtml(row.school)}</div>` : ''}</td><td class="right-align"><strong>${row.points}</strong></td><td class="right-align">${row.wins}</td><td class="right-align">${row.draws}</td><td class="right-align">${row.losses}</td><td class="right-align">${row.byes}</td><td class="right-align">${row.capped_diff > 0 ? '+' : ''}${row.capped_diff}</td><td class="right-align">${row.points_for}</td></tr>`).join('')}</tbody></table></div>${compact ? '' : '<p class="small muted" style="margin:9px 0 0">* ผลต่างคะแนนหลังใช้เพดานของแต่ละเกมตามที่ตั้งไว้ ทีมที่ถอนแล้วยังแสดงประวัติผลเดิม แต่จะไม่ถูกจับคู่รอบใหม่</p>'}`;
}

function renderTournaments() {
  return `<div class="grid grid-2"><section class="card card-pad"><h3>สร้างรายการแข่งขันใหม่</h3><p class="muted small">เริ่มจากข้อมูลว่างทุกครั้ง เพื่อเก็บรายการในอนาคตได้ไม่จำกัด</p>${tournamentForm('create-tournament')}</section><section class="card card-pad"><h3>รายการที่บันทึกไว้</h3>${state.tournaments.length ? `<div class="table-wrap"><table><thead><tr><th>ชื่อรายการ</th><th>ทีม</th><th>KOTH</th><th>สถานะ</th><th></th></tr></thead><tbody>${state.tournaments.map((tournament) => `<tr><td><div class="team-title">${escapeHtml(tournament.name)}</div><div class="team-meta">${escapeHtml([tournament.academic_year, tournament.category].filter(Boolean).join(' · '))}</div></td><td>${tournament.team_count}</td><td>${tournament.koth_round_count}</td><td>${badge(tournament.status)}</td><td class="right-align"><button class="button ghost small" data-action="select-tournament" data-id="${escapeHtml(tournament.id)}">จัดการ</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><div class="empty-icon">＋</div><h3>ยังไม่มีรายการแข่งขัน</h3><p>ใช้แบบฟอร์มด้านซ้ายเพื่อสร้างรายการแรก</p></div>'}</section></div>`;
}

function tournamentForm(formName, tournament = {}) {
  const scoring = tournament.scoring || { win_points: 2, draw_points: 1, loss_points: 0, bye_points: 2, default_diff_cap: 250, round_caps: [250,250,250,250,200] };
  return `<form data-form="${formName}" class="form-grid">
    <div class="field full"><label>ชื่อรายการแข่งขัน *</label><input name="name" required value="${escapeHtml(tournament.name || '')}" placeholder="เช่น การแข่งขัน A-Math King of the Hill ปีการศึกษา 2569" /></div>
    <div class="field"><label>ปีการศึกษา / ปีแข่งขัน</label><input name="academic_year" value="${escapeHtml(tournament.academic_year || '')}" placeholder="2569" /></div>
    <div class="field"><label>ประเภทการแข่งขัน</label><input name="category" value="${escapeHtml(tournament.category || 'A-Math')}" /></div>
    <div class="field"><label>จำนวนเกม KOTH ที่วางแผน</label><input type="number" min="1" max="99" name="rounds_planned" value="${escapeHtml(tournament.rounds_planned || 5)}" /></div>
    <div class="field wide"><label>หน่วยงาน / ผู้จัด</label><input name="organizer" value="${escapeHtml(tournament.organizer || '')}" /></div>
    <div class="field wide"><label>สถานที่</label><input name="venue" value="${escapeHtml(tournament.venue || '')}" /></div>
    <div class="field"><label>วันเริ่ม</label><input type="date" name="starts_on" value="${escapeHtml(tournament.starts_on || '')}" /></div>
    <div class="field"><label>วันสิ้นสุด</label><input type="date" name="ends_on" value="${escapeHtml(tournament.ends_on || '')}" /></div>
    ${formName === 'create-tournament' ? '<div class="field full"><button class="button primary" type="submit">สร้างรายการแข่งขัน</button></div>' : ''}
  </form>`;
}

function renderTeams() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const teams = data.teams.filter((team) => team.is_active);
  const inactiveTeams = data.teams.filter((team) => !team.is_active);
  const kothStarted = data.rounds.some((round) => round.phase === 'koth');
  const matchedTeamIds = new Set(data.matches.flatMap((match) => [match.team_a_id, match.team_b_id].filter(Boolean)));
  const finalTeamIds = new Set(data.matches.filter((match) => match.status === 'final').flatMap((match) => [match.team_a_id, match.team_b_id].filter(Boolean)));
  const teamRows = (items, inactive = false) => `<div class="table-wrap"><table><thead><tr><th>Seed</th><th>ทีม</th><th>สังกัด</th><th>ผู้เข้าแข่งขัน</th><th>ครูผู้ควบคุม</th><th></th></tr></thead><tbody>${items.map((team) => `<tr class="${inactive ? 'is-muted' : ''}"><td><strong>${team.seed}</strong></td><td><div class="team-title">${escapeHtml(team.name)} <span class="code-pill">${escapeHtml(team.code)}</span>${inactive ? ' <span class="badge archived">ถอนแล้ว</span>' : ''}</div></td><td>${escapeHtml(team.school || '—')}</td><td>${escapeHtml([team.member_1, team.member_2].filter(Boolean).join(' / ') || '—')}</td><td>${escapeHtml(team.coach || '—')}</td><td class="right-align"><div class="button-row" style="justify-content:flex-end"><button class="button ghost small" data-action="edit-team" data-id="${escapeHtml(team.id)}">แก้ไข</button>${inactive ? `<button class="button secondary small" data-action="restore-team" data-id="${escapeHtml(team.id)}">กู้คืน</button>` : `<button class="button ghost small" data-action="delete-team" data-id="${escapeHtml(team.id)}" data-delete-mode="${finalTeamIds.has(team.id) ? 'withdraw' : matchedTeamIds.has(team.id) ? 'paired' : 'delete'}">${finalTeamIds.has(team.id) ? 'ถอนทีม' : 'ลบ'}</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
  return `
    ${kothStarted ? '<section class="notice info" style="margin-bottom:16px"><strong>รายการเริ่มแล้ว</strong> ยังเพิ่มทีมใหม่ได้ ทีมใหม่จะเข้ารอบถัดไปหลังรอบที่กำลังแข่งบันทึกผลครบ ส่วนการถอนทีมจะไม่ลบประวัติผลเดิม</section>' : ''}
    <div class="grid grid-2">
      <section class="card card-pad"><h3>เพิ่มทีม</h3><form data-form="add-team" class="form-grid">
        <div class="field"><label>Seed</label><input name="seed" type="number" min="1" placeholder="ระบบเรียงต่อให้" /></div>
        <div class="field"><label>รหัสทีม</label><input name="code" placeholder="เช่น A01" /></div>
        <div class="field wide"><label>ชื่อทีม *</label><input name="name" required placeholder="เช่น โรงเรียน... ทีม 1" /></div>
        <div class="field full"><label>โรงเรียน / สังกัด</label><input name="school" /></div>
        <div class="field"><label>ผู้เข้าแข่งขัน 1</label><input name="member_1" /></div>
        <div class="field"><label>ผู้เข้าแข่งขัน 2</label><input name="member_2" /></div>
        <div class="field"><label>ครูผู้ควบคุม</label><input name="coach" /></div>
        <div class="field full"><button class="button primary" type="submit">เพิ่มทีม</button></div>
      </form></section>
      <section class="card card-pad"><h3>นำเข้าทีมหลายรายการ</h3><p class="muted small">วางข้อมูลแบบ 1 บรรทัดต่อ 1 ทีม: <code>รหัสทีม,ชื่อทีม,โรงเรียน,ผู้แข่งขัน1,ผู้แข่งขัน2,ครูผู้ควบคุม</code></p><form data-form="import-teams"><div class="field full"><textarea name="team_lines" placeholder="A01,ทีม 1,โรงเรียนตัวอย่าง,นักเรียน ก,นักเรียน ข,ครู ก\nA02,ทีม 2,โรงเรียนตัวอย่าง,นักเรียน ค,นักเรียน ง,ครู ข"></textarea></div><button class="button secondary" type="submit">นำเข้ารายชื่อ</button></form><p class="small muted" style="margin:10px 0 0">หากนำเข้าระหว่างแข่งขัน ทีมจะเริ่มถูกใช้เมื่อสร้างเกม KOTH ถัดไป</p></section>
    </div>
    <section class="section-head"><div><h3>ทีมที่ใช้จับคู่รอบถัดไป (${teams.length})</h3><p>Seed ใช้เป็นลำดับเริ่มต้นของเกมที่ 1 เมื่อเลือก “จับคู่ตาม Seed”</p></div></section>
    ${teams.length ? teamRows(teams) : `<section class="card empty"><div class="empty-icon">♟</div><h3>ยังไม่มีทีมที่เปิดใช้งาน</h3><p>เพิ่มทีมทีละทีม หรือวางรายชื่อหลายทีมจาก Excel</p></section>`}
    ${inactiveTeams.length ? `<section class="section-head"><div><h3>ทีมที่ถอนจากรอบถัดไป (${inactiveTeams.length})</h3><p>ทีมเหล่านี้ไม่ถูกจับคู่ใหม่ แต่ผลเดิมยังอยู่ในประวัติและตารางคะแนน</p></div></section>${teamRows(inactiveTeams, true)}` : ''}`;
}

function kothControls(data) {
  const koth = data.rounds.filter((round) => round.phase === 'koth');
  const incomplete = koth.find((round) => round.status !== 'completed');
  const nextNo = koth.length + 1;
  const cap = data.tournament.scoring.round_caps[nextNo - 1] ?? data.tournament.scoring.default_diff_cap;
  const teamCount = data.teams.filter((team) => team.is_active).length;
  return `<section class="card card-pad"><div class="split"><div><h3 style="margin:0">สร้างเกม KOTH ถัดไป</h3><p class="muted small" style="margin:5px 0 0">ระบบจัดอันดับปัจจุบันแล้วประกบทีมที่มีอันดับใกล้กัน พร้อมพยายามหลีกเลี่ยงคู่เดิม</p></div>${incomplete ? badge('pending') : badge('open')}</div>${incomplete ? `<div class="notice warning" style="margin-top:15px">ต้องยืนยันผลใน <strong>${escapeHtml(incomplete.title)}</strong> ให้ครบก่อน จึงจะสร้างเกมถัดไปได้</div>` : `<form data-form="generate-round" class="form-grid" style="margin-top:14px"><div class="field"><label>วิธีจับคู่เกมแรก</label><select name="first_round_method"><option value="seed">ตาม Seed</option><option value="random">สุ่มลำดับ</option></select></div><div class="field"><label>เพดานผลต่างของเกมนี้</label><input type="number" min="0" name="diff_cap" value="${cap}" /></div><div class="field wide"><label>ชื่อเกม (เว้นว่างเพื่อใช้ “เกมที่ ${nextNo}”)</label><input name="title" /></div><div class="field full"><button class="button primary" type="submit" ${teamCount < 2 ? 'disabled' : ''}>สร้างคู่เกมที่ ${nextNo}</button> <span class="small muted">${teamCount < 2 ? 'ต้องเพิ่มอย่างน้อย 2 ทีม' : `มี ${teamCount} ทีม${teamCount % 2 ? ' · ระบบจะให้ BYE 1 ทีม' : ''}`}</span></div></form>`}</section>`;
}

function renderMatchRow(match, round) {
  if (match.is_bye) return `<div class="match-row is-final"><div class="match-table">โต๊ะ ${match.table_no}</div><div class="match-team"><strong>${teamName(match.team_a)}</strong><small>${escapeHtml(match.team_a?.school || '')}</small></div><div class="bye-label">BYE</div><div class="match-team right"><strong>—</strong></div><div class="match-action">${badge('final')}</div></div>`;
  const isFinals = round.phase !== 'koth';
  const winnerOptions = isFinals ? `<select name="winner_team_id" aria-label="ผู้ชนะกรณีคะแนนเสมอ"><option value="">เลือกผู้ชนะเมื่อเสมอ</option><option value="${escapeHtml(match.team_a_id)}" ${match.winner_team_id === match.team_a_id ? 'selected' : ''}>${escapeHtml(short(match.team_a?.name || '', 16))}</option><option value="${escapeHtml(match.team_b_id)}" ${match.winner_team_id === match.team_b_id ? 'selected' : ''}>${escapeHtml(short(match.team_b?.name || '', 16))}</option></select>` : '';
  return `<form class="match-row ${match.status === 'final' ? 'is-final' : ''}" data-form="match" data-match-id="${escapeHtml(match.id)}"><div class="match-table">โต๊ะ ${match.table_no}</div><div class="match-team"><strong>${teamName(match.team_a)}</strong><small>${escapeHtml(match.team_a?.school || '')}</small></div><div class="score-box"><input type="number" min="0" name="score_a" value="${match.score_a ?? ''}" aria-label="คะแนนทีม A" required /><span>:</span><input type="number" min="0" name="score_b" value="${match.score_b ?? ''}" aria-label="คะแนนทีม B" required /></div><div class="match-team right"><strong>${teamName(match.team_b)}</strong><small>${escapeHtml(match.team_b?.school || '')}</small></div><div class="match-action">${winnerOptions}<button class="button ${match.status === 'final' ? 'secondary' : 'primary'} small" type="submit">${match.status === 'final' ? 'บันทึกแก้ไข' : 'ยืนยันผล'}</button>${match.status === 'final' ? `<button class="button ghost small" type="button" data-action="reset-match" data-id="${escapeHtml(match.id)}">ล้างผล</button>${badge('final')}` : ''}</div></form>`;
}

function renderRounds(data) {
  const allRounds = data.rounds;
  if (!allRounds.length) return `<section class="card empty"><div class="empty-icon">↔</div><h3>ยังไม่มีการจับคู่</h3><p>เมื่อพร้อมแล้วให้สร้างเกม KOTH แรก ระบบจะเรียงตาม Seed หรือสุ่มลำดับตามที่เลือก</p></section>`;
  return allRounds.map((round) => `<section class="card round-card"><header class="round-title"><div><h4>${escapeHtml(round.title)}</h4><p>${round.phase === 'koth' ? `เกม KOTH ${round.round_number} · จำกัดผลต่าง ±${round.diff_cap}` : round.phase === 'finals-semifinal' ? 'Top 4 · อันดับ 1 พบ 4 และอันดับ 2 พบ 3' : 'ผู้ชนะรอบรองชนะเลิศพบกัน และชิงอันดับ 3'}</p>${round.pairing_note ? `<p class="notice warning" style="margin:8px 0 0">${escapeHtml(round.pairing_note)}</p>` : ''}</div><div class="button-row">${badge(round.status)}${round.status !== 'completed' ? `<button class="button ghost small" data-action="edit-pairings" data-id="${escapeHtml(round.id)}">แก้ไขคู่</button>` : ''}</div></header><div class="match-list">${round.matches.map((match) => renderMatchRow(match, round)).join('')}</div></section>`).join('');
}

function finalControls(data) {
  const semis = data.rounds.find((round) => round.phase === 'finals-semifinal');
  const medals = data.rounds.find((round) => round.phase === 'finals-medal');
  const medalData = data.finals?.medals;
  let action = '';
  if (!semis) action = `<button class="button gold" data-action="create-finals" data-stage="semifinal">สร้างรอบชิง Top 4</button>`;
  else if (semis.status === 'completed' && !medals) action = `<button class="button gold" data-action="create-finals" data-stage="medal">สร้างรอบชิงชนะเลิศ / ชิงอันดับ 3</button>`;
  else if (semis.status !== 'completed') action = `<span class="small muted">ยืนยันผลรอบรองชนะเลิศก่อนสร้างรอบชิงเหรียญ</span>`;
  const medalsHtml = medalData ? `<div class="notice success" style="margin-top:12px"><strong>ผลรอบชิง:</strong> 🥇 ${escapeHtml(medalData.gold?.name || '')} · 🥈 ${escapeHtml(medalData.silver?.name || '')} · 🥉 ${escapeHtml(medalData.bronze?.name || '')}</div>` : '';
  return `<section class="section-head"><div><h3>รอบชิง (ตัวเลือก)</h3><p>ใช้เมื่อรายการต้องการคัด 4 อันดับแรกจากตาราง KOTH เพื่อชิงเหรียญ</p></div><div>${action}</div>${medalsHtml}</section>`;
}

function renderKoth() {
  const data = state.data;
  if (!data) return renderNoTournament();
  return `${kothControls(data)}${finalControls(data)}<section class="section-head"><div><h3>รอบการแข่งขัน</h3><p>แก้ไขคู่ได้ก่อนยืนยันผลของแมตช์จริง ระบบจะแจ้งเตือนหากทีมซ้ำในรอบเดียวกัน</p></div></section>${renderRounds(data)}`;
}

function renderStandings() {
  const data = state.data;
  if (!data) return renderNoTournament();
  return `${data.standings.length ? standingsTable(data.standings) : '<section class="card empty"><div class="empty-icon">≡</div><h3>ตารางคะแนนจะปรากฏเมื่อเพิ่มทีม</h3><p>สามารถตรวจสอบลำดับเริ่มต้นได้ทันทีหลังเพิ่มรายชื่อทีม</p></section>'}`;
}

function renderReports() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const t = data.tournament;
  const publicUrl = `${location.origin}${location.pathname}?public=${encodeURIComponent(t.code)}`;
  return `<div class="grid grid-2"><section class="card card-pad"><h3>เอกสารและข้อมูลสำรอง</h3><p class="muted small">สำรองเป็น JSON เพื่อเก็บประวัติ ย้ายระบบ หรือทำสำเนารายการในปีถัดไป</p><div class="button-row"><button class="button primary" data-action="export-backup">ดาวน์โหลดข้อมูลสำรอง</button><button class="button secondary" data-action="export-csv">ส่งออกตารางคะแนน CSV</button><button class="button ghost" data-action="print">พิมพ์หน้าปัจจุบัน</button></div><hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><label class="field full"><span>กู้คืน / ทำสำเนาจากไฟล์สำรอง JSON</span><input id="backup-file" type="file" accept="application/json,.json" /></label><p class="small muted">ระบบจะสร้างเป็นรายการใหม่ จึงไม่ทับข้อมูลเดิม</p></section><section class="card card-pad"><h3>ตารางคะแนนสาธารณะ</h3><p class="muted small">เปิดให้ผู้ชมดูอันดับและผลการแข่งขัน โดยไม่สามารถแก้ไขข้อมูลได้</p><div class="notice ${t.public_enabled ? 'success' : 'warning'}">${t.public_enabled ? 'เปิดเผยข้อมูลสาธารณะแล้ว' : 'ยังปิดการเผยแพร่ — เปิดได้ในหน้าตั้งค่า'}</div><label class="field full" style="margin-top:14px"><span>ลิงก์หน้าสาธารณะ</span><input readonly value="${escapeHtml(publicUrl)}" /></label><div class="button-row"><button class="button ${t.public_enabled ? 'primary' : 'ghost'}" data-action="open-public" ${t.public_enabled ? '' : 'disabled'}>เปิดหน้าสาธารณะ</button><button class="button secondary" data-action="copy-public" ${t.public_enabled ? '' : 'disabled'}>คัดลอกลิงก์</button></div></section></div>`;
}

function renderSettings() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const t = data.tournament;
  const s = t.scoring;
  return `<section class="card card-pad"><h3>ข้อมูลและกติกาการจัดอันดับ</h3><p class="muted small">การเปลี่ยนคะแนนหรือเพดานผลต่างจะคำนวณตารางอันดับใหม่จากผลการแข่งขันทั้งหมดทันที</p><form data-form="update-tournament" class="form-grid">${tournamentForm('settings-embedded', t).replace(/^<form[^>]*>|<\/form>$/g, '')}<div class="field"><label>คะแนนชนะ</label><input type="number" name="win_points" value="${s.win_points}" /></div><div class="field"><label>คะแนนเสมอ</label><input type="number" name="draw_points" value="${s.draw_points}" /></div><div class="field"><label>คะแนนแพ้</label><input type="number" name="loss_points" value="${s.loss_points}" /></div><div class="field"><label>คะแนน BYE</label><input type="number" name="bye_points" value="${s.bye_points}" /></div><div class="field"><label>เพดานผลต่างมาตรฐาน</label><input type="number" min="0" name="default_diff_cap" value="${s.default_diff_cap}" /></div><div class="field wide"><label>เพดานผลต่างแต่ละเกม (คั่นด้วย ,)</label><input name="round_caps" value="${escapeHtml(s.round_caps.join(', '))}" /><small>ตัวอย่าง: 250, 250, 250, 250, 200 — หากสร้างเกมเกินจำนวนนี้ ระบบใช้เพดานมาตรฐาน</small></div><div class="field full"><label>ลำดับเกณฑ์จัดอันดับ</label><select name="ranking_order"><option value="points,capped_diff,points_for,wins,name" ${t.ranking_rules.join(',') === 'points,capped_diff,points_for,wins,name' ? 'selected' : ''}>คะแนน → ผลต่างคะแนน → แต้มได้ → ชนะ → ชื่อทีม</option><option value="points,capped_diff,wins,points_for,name" ${t.ranking_rules.join(',') === 'points,capped_diff,wins,points_for,name' ? 'selected' : ''}>คะแนน → ผลต่างคะแนน → ชนะ → แต้มได้ → ชื่อทีม</option></select></div><div class="field full"><label class="checkbox-field"><input type="checkbox" name="public_enabled" ${t.public_enabled ? 'checked' : ''} /> เปิดเผยตารางคะแนนและผลการแข่งขันผ่านลิงก์สาธารณะ</label></div><div class="field full"><button class="button primary" type="submit">บันทึกการตั้งค่า</button></div></form></section>`;
}

function renderView() {
  switch (state.view) {
    case 'tournaments': return renderTournaments();
    case 'teams': return renderTeams();
    case 'koth': return renderKoth();
    case 'standings': return renderStandings();
    case 'reports': return renderReports();
    case 'settings': return renderSettings();
    default: return renderDashboard();
  }
}

function renderModal() {
  if (!state.modal) return '';
  return `<div class="modal-backdrop" data-action="close-modal-bg"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.modal.title)}"><header class="modal-header"><h3>${escapeHtml(state.modal.title)}</h3><button class="icon-button" data-action="close-modal" aria-label="ปิด">×</button></header><div class="modal-body">${state.modal.body}</div></section></div>`;
}

function renderToasts() {
  return `<div class="toast-stack">${state.toasts.map((toast) => `<div class="toast ${escapeHtml(toast.type)}">${escapeHtml(toast.message)}</div>`).join('')}</div>`;
}

function renderLogin() {
  app.innerHTML = `<main class="login-screen"><section class="login-card"><div class="login-brand"><div class="brand-mark">KOTH</div><div><h1>A-Math KOTH Manager</h1><p>ระบบจัดการแข่งขันแบบ King of the Hill</p></div></div><form data-form="login"><div class="field full"><label>รหัสผ่านผู้ดูแลระบบ</label><input type="password" name="password" required autofocus placeholder="กรอกรหัสผ่านที่ตั้งบน Cloudflare" /></div><button class="button primary" type="submit" style="width:100%;margin-top:8px">เข้าสู่ระบบ</button></form><p class="small muted" style="margin-top:19px">หากเพิ่งติดตั้งระบบ ให้กำหนดตัวแปรลับ <code>ADMIN_PASSWORD</code> และ <code>AUTH_SECRET</code> บน Cloudflare ก่อน</p></section></main>`;
}

function render() {
  if (!state.authenticated) { renderLogin(); return; }
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">KOTH</div><div><h1>A-Math Manager</h1><small>King of the Hill</small></div></div><nav class="nav-list">${navItems.map(([id, label]) => `<button class="nav-link ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}">${label}</button>`).join('')}</nav><div class="sidebar-footer">ข้อมูลเก็บในฐานข้อมูลของคุณบน Cloudflare D1<br><button data-action="logout">ออกจากระบบ</button></div></aside><main class="main">${pageHeading()}${renderView()}</main></div>${renderModal()}${renderToasts()}`;
}

function editTeamModal(team) {
  state.modal = { title: `แก้ไขทีม: ${team.name}`, body: `<form data-form="edit-team" data-team-id="${escapeHtml(team.id)}" class="form-grid"><div class="field"><label>Seed</label><input type="number" min="1" name="seed" value="${team.seed}" /></div><div class="field"><label>รหัสทีม</label><input name="code" value="${escapeHtml(team.code)}" /></div><div class="field wide"><label>ชื่อทีม *</label><input name="name" required value="${escapeHtml(team.name)}" /></div><div class="field full"><label>โรงเรียน / สังกัด</label><input name="school" value="${escapeHtml(team.school)}" /></div><div class="field"><label>ผู้เข้าแข่งขัน 1</label><input name="member_1" value="${escapeHtml(team.member_1)}" /></div><div class="field"><label>ผู้เข้าแข่งขัน 2</label><input name="member_2" value="${escapeHtml(team.member_2)}" /></div><div class="field"><label>ครูผู้ควบคุม</label><input name="coach" value="${escapeHtml(team.coach)}" /></div><div class="field wide"><label>ติดต่อ</label><input name="contact" value="${escapeHtml(team.contact)}" /></div><div class="field full"><label>หมายเหตุ</label><textarea name="notes">${escapeHtml(team.notes)}</textarea></div><div class="field full"><button class="button primary" type="submit">บันทึกทีม</button></div></form>` };
  render();
}

function tournamentModal() {
  state.modal = { title: 'สร้างรายการแข่งขันใหม่', body: tournamentForm('create-tournament') };
  render();
}

function pairingModal(roundId) {
  const round = state.data?.rounds.find((item) => item.id === roundId);
  if (!round) return;
  const teams = state.data.teams.filter((team) => team.is_active).sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name, 'th'));
  const optionList = (selected, blank = false) => `${blank ? '<option value="">BYE (ไม่มีคู่แข่งขัน)</option>' : ''}${teams.map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === selected ? 'selected' : ''}>${escapeHtml(team.code)} — ${escapeHtml(team.name)}</option>`).join('')}`;
  state.modal = { title: `แก้ไขคู่ · ${round.title}`, body: `<p class="notice info">คู่ที่ยังไม่ยืนยันผลสามารถแก้ไขได้ทันที ส่วนโต๊ะที่ยืนยันผลแล้วจะถูกล็อกไว้เพื่อรักษาประวัติ ทีมหนึ่งใช้ได้เพียงครั้งเดียวในรอบเดียวกัน และ BYE ใช้ได้ 1 ทีมเมื่อมีจำนวนทีมเป็นคี่</p><form data-form="save-pairings" data-round-id="${escapeHtml(round.id)}"><div class="pair-editor">${round.matches.map((match, index) => `<div class="pair-edit-row"><strong>โต๊ะ ${index + 1}</strong><select name="a_${index}" ${match.status === 'final' && !match.is_bye ? 'disabled' : ''}>${optionList(match.team_a_id)}</select><span>พบ</span><select name="b_${index}" ${match.status === 'final' && !match.is_bye ? 'disabled' : ''}>${optionList(match.team_b_id, true)}</select>${match.status === 'final' && !match.is_bye ? `<input type="hidden" name="a_${index}" value="${escapeHtml(match.team_a_id)}" /><input type="hidden" name="b_${index}" value="${escapeHtml(match.team_b_id || '')}" />` : ''}</div>`).join('')}</div><input type="hidden" name="count" value="${round.matches.length}" /><div class="button-row" style="margin-top:18px"><button class="button primary" type="submit">บันทึกคู่แข่งขัน</button><button class="button ghost" data-action="close-modal" type="button">ยกเลิก</button></div></form>` };
  render();
}

async function handleAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-modal-bg' && event.target !== button) return;
  if (action === 'nav') { state.view = button.dataset.view; render(); return; }
  if (action === 'go-tournaments') { state.view = 'tournaments'; render(); return; }
  if (action === 'go-teams') { state.view = 'teams'; render(); return; }
  if (action === 'go-koth') { state.view = 'koth'; render(); return; }
  if (action === 'go-standings') { state.view = 'standings'; render(); return; }
  if (action === 'new-tournament') { tournamentModal(); return; }
  if (action === 'select-tournament') { setSelected(button.dataset.id); state.view = 'dashboard'; await loadTournament(); render(); return; }
  if (action === 'edit-team') { const team = state.data?.teams.find((item) => item.id === button.dataset.id); if (team) editTeamModal(team); return; }
  if (action === 'restore-team') {
    const team = state.data?.teams.find((item) => item.id === button.dataset.id);
    if (!team || !confirm(`ต้องการกู้คืนทีม “${team.name}” ให้ใช้จับคู่รอบถัดไปใช่หรือไม่?`)) return;
    try { await api(`/api/tournaments/${state.selectedId}/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ ...team, is_active: true }) }); await refreshAll(); notify('กู้คืนทีมแล้ว', 'success'); } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'delete-team') {
    const team = state.data?.teams.find((item) => item.id === button.dataset.id);
    const mode = button.dataset.deleteMode || 'delete';
    const message = mode === 'withdraw'
      ? `ต้องการถอนทีม “${team?.name || ''}” ออกจากการจับคู่รอบถัดไปใช่หรือไม่? ระบบจะเก็บประวัติผลเดิมไว้`
      : mode === 'paired'
        ? `ทีม “${team?.name || ''}” อยู่ในคู่แข่งขันที่ยังรอผลอยู่ ต้องการลองลบใช่หรือไม่? หากลบไม่ได้ให้ไปแก้คู่แข่งขันของรอบนั้นก่อน`
        : `ต้องการลบทีม “${team?.name || ''}” ออกจากรายการถาวรใช่หรือไม่?`;
    if (!team || !confirm(message)) return;
    try {
      const result = await api(`/api/tournaments/${state.selectedId}/teams/${team.id}`, { method: 'DELETE' });
      await refreshAll();
      notify(result.mode === 'withdrawn' ? 'ถอนทีมแล้ว และยังเก็บประวัติผลเดิมไว้' : 'ลบทีมออกจากรายการถาวรแล้ว', 'success');
    } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'reset-match') {
    if (!confirm('ต้องการล้างผลคู่นี้และกลับเป็นรอผลใช่หรือไม่? ตารางคะแนนจะคำนวณใหม่ทันที')) return;
    try { await api(`/api/matches/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pending' }) }); await loadTournament(); render(); notify('ล้างผลแล้ว', 'success'); } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'edit-pairings') { pairingModal(button.dataset.id); return; }
  if (action === 'create-finals') {
    const stage = button.dataset.stage;
    if (!confirm(stage === 'semifinal' ? 'สร้างรอบรองชนะเลิศ Top 4 จากตารางคะแนนปัจจุบันใช่หรือไม่?' : 'สร้างรอบชิงชนะเลิศและชิงอันดับ 3 ใช่หรือไม่?')) return;
    try { await api(`/api/tournaments/${state.selectedId}/finals`, { method: 'POST', body: JSON.stringify({ stage }) }); await loadTournament(); render(); notify('สร้างรอบชิงเรียบร้อย', 'success'); } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'export-backup') { try { const data = await api(`/api/tournaments/${state.selectedId}/export`); download(`KOTH_${slug(state.data.tournament.name)}_backup.json`, JSON.stringify(data, null, 2), 'application/json'); notify('ดาวน์โหลดข้อมูลสำรองแล้ว', 'success'); } catch (error) { notify(error.message, 'error'); } return; }
  if (action === 'export-csv') { exportStandingsCSV(); return; }
  if (action === 'open-public') { window.open(`${location.origin}${location.pathname}?public=${encodeURIComponent(state.data.tournament.code)}`, '_blank', 'noopener'); return; }
  if (action === 'copy-public') { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?public=${encodeURIComponent(state.data.tournament.code)}`); notify('คัดลอกลิงก์แล้ว', 'success'); } catch { notify('คัดลอกลิงก์ไม่สำเร็จ กรุณาคัดลอกจากช่องข้อความ', 'error'); } return; }
  if (action === 'print') { window.print(); return; }
  if (action === 'close-modal' || action === 'close-modal-bg') { state.modal = null; render(); return; }
  if (action === 'logout') { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } finally { state.authenticated = false; state.data = null; state.modal = null; render(); } }
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const values = Object.fromEntries(new FormData(form).entries());
  const bool = (name) => form.querySelector(`[name="${name}"]`)?.checked ?? false;
  try {
    if (kind === 'login') {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
      state.authenticated = true; await refreshAll(); notify('เข้าสู่ระบบแล้ว', 'success'); return;
    }
    if (kind === 'create-tournament') {
      const response = await api('/api/tournaments', { method: 'POST', body: JSON.stringify(values) });
      state.modal = null; setSelected(response.tournament.id); state.view = 'dashboard'; await refreshAll(); notify('สร้างรายการแข่งขันแล้ว', 'success'); return;
    }
    if (kind === 'add-team') {
      await api(`/api/tournaments/${state.selectedId}/teams`, { method: 'POST', body: JSON.stringify(values) });
      form.reset(); await loadTournament(); render(); notify('เพิ่มทีมแล้ว', 'success'); return;
    }
    if (kind === 'import-teams') {
      const lines = values.team_lines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const teams = lines.map((line) => { const [code='', name='', school='', member_1='', member_2='', coach=''] = line.split(',').map((value) => value.trim()); return { code, name, school, member_1, member_2, coach }; }).filter((team) => team.name);
      if (!teams.length) throw new Error('ไม่พบรายชื่อทีมที่นำเข้าได้');
      await api(`/api/tournaments/${state.selectedId}/teams/import`, { method: 'POST', body: JSON.stringify({ teams }) });
      form.reset(); await loadTournament(); render(); notify(`นำเข้าทีม ${teams.length} ทีมแล้ว`, 'success'); return;
    }
    if (kind === 'edit-team') {
      await api(`/api/tournaments/${state.selectedId}/teams/${form.dataset.teamId}`, { method: 'PATCH', body: JSON.stringify(values) });
      state.modal = null; await loadTournament(); render(); notify('บันทึกข้อมูลทีมแล้ว', 'success'); return;
    }
    if (kind === 'generate-round') {
      await api(`/api/tournaments/${state.selectedId}/rounds`, { method: 'POST', body: JSON.stringify(values) });
      await loadTournament(); render(); notify('สร้างคู่แข่งขันเรียบร้อย', 'success'); return;
    }
    if (kind === 'match') {
      await api(`/api/matches/${form.dataset.matchId}`, { method: 'PATCH', body: JSON.stringify({ ...values, status: 'final' }) });
      await loadTournament(); render(); notify('บันทึกผลการแข่งขันแล้ว', 'success'); return;
    }
    if (kind === 'save-pairings') {
      const count = Number(values.count || 0);
      const matches = Array.from({ length: count }, (_, index) => ({ team_a_id: values[`a_${index}`], team_b_id: values[`b_${index}`] || null }));
      await api(`/api/tournaments/${state.selectedId}/rounds/${form.dataset.roundId}/matches`, { method: 'PUT', body: JSON.stringify({ matches }) });
      state.modal = null; await loadTournament(); render(); notify('บันทึกคู่แข่งขันแล้ว', 'success'); return;
    }
    if (kind === 'update-tournament') {
      const scoring = {
        win_points: Number(values.win_points), draw_points: Number(values.draw_points), loss_points: Number(values.loss_points), bye_points: Number(values.bye_points), default_diff_cap: Number(values.default_diff_cap),
        round_caps: values.round_caps.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value >= 0)
      };
      const payload = { ...values, public_enabled: bool('public_enabled'), scoring, ranking_rules: values.ranking_order.split(',') };
      await api(`/api/tournaments/${state.selectedId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      await refreshAll(); notify('บันทึกการตั้งค่าแล้ว', 'success'); return;
    }
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function handleChange(event) {
  if (event.target.id === 'tournament-selector') { setSelected(event.target.value); await loadTournament(); render(); return; }
  if (event.target.id === 'backup-file' && event.target.files?.[0]) {
    try {
      const text = await event.target.files[0].text();
      const payload = JSON.parse(text);
      const response = await api('/api/tournaments/import', { method: 'POST', body: JSON.stringify(payload) });
      setSelected(response.tournament.id); state.view = 'dashboard'; await refreshAll(); notify('กู้คืนเป็นรายการใหม่เรียบร้อย', 'success');
    } catch (error) { notify(`นำเข้าข้อมูลสำรองไม่สำเร็จ: ${error.message}`, 'error'); }
  }
}

function slug(value) { return String(value || 'KOTH').trim().replace(/[^\wก-๙]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'KOTH'; }
function download(filename, content, mime) { const blob = new Blob([content], { type: `${mime};charset=utf-8` }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
function exportStandingsCSV() { const rows = state.data?.standings || []; const header = ['อันดับ','รหัสทีม','ทีม','โรงเรียน','คะแนน','ชนะ','เสมอ','แพ้','BYE','ผลต่าง(คุมเพดาน)','แต้มได้']; const line = (cells) => cells.map((cell) => { const value = String(cell ?? ''); return /[",\n]/.test(value) ? `"${value.replaceAll('"','""')}"` : value; }).join(','); const csv = `\ufeff${line(header)}\n${rows.map((row) => line([row.rank,row.code,row.name,row.school,row.points,row.wins,row.draws,row.losses,row.byes,row.capped_diff,row.points_for])).join('\n')}`; download(`KOTH_${slug(state.data.tournament.name)}_standings.csv`, csv, 'text/csv'); notify('ส่งออกตารางคะแนน CSV แล้ว', 'success'); }

async function renderPublic() {
  app.innerHTML = '<main class="loading-screen"><div class="loading-dot"></div></main>';
  try {
    const data = await api(`/api/public/tournaments/${encodeURIComponent(PUBLIC_CODE)}`);
    const latest = data.rounds.at(-1);
    app.innerHTML = `<main class="public-screen"><div class="public-wrap"><header class="public-header"><div class="split"><div><h1>${escapeHtml(data.tournament.name)}</h1><p>${escapeHtml([data.tournament.category, data.tournament.academic_year, data.tournament.venue].filter(Boolean).join(' · '))}</p></div><button class="button secondary" data-action="public-reload">รีเฟรช</button></div></header><section class="section-head"><div><h3>ตารางคะแนนล่าสุด</h3><p>อัปเดตจากผลการแข่งขันที่ผู้ดูแลยืนยันแล้ว</p></div></section>${standingsTable(data.standings)}${latest ? `<section class="section-head"><div><h3>${escapeHtml(latest.title)}</h3><p>${latest.status === 'completed' ? 'บันทึกผลครบแล้ว' : 'กำลังแข่งขัน'}</p></div></section><section class="card round-card"><div class="match-list">${latest.matches.map((match) => `<div class="match-row ${match.status === 'final' ? 'is-final' : ''}"><div class="match-table">โต๊ะ ${match.table_no}</div><div class="match-team"><strong>${teamName(match.team_a)}</strong><small>${escapeHtml(match.team_a?.school || '')}</small></div><div class="score-box"><input readonly value="${match.is_bye ? 'BYE' : (match.score_a ?? '—')}" /><span>${match.is_bye ? '' : ':'}</span><input readonly value="${match.is_bye ? '' : (match.score_b ?? '—')}" /></div><div class="match-team right"><strong>${match.is_bye ? '—' : teamName(match.team_b)}</strong><small>${escapeHtml(match.team_b?.school || '')}</small></div><div class="match-action">${badge(match.status)}</div></div>`).join('')}</div></section>` : ''}<p class="public-credit">เผยแพร่ด้วย A-Math KOTH Manager</p></div></main>`;
    app.querySelector('[data-action="public-reload"]')?.addEventListener('click', renderPublic);
  } catch (error) {
    app.innerHTML = `<main class="public-screen"><section class="login-card"><h1>ไม่พบตารางคะแนน</h1><p>${escapeHtml(error.message)}</p></section></main>`;
  }
}

app.addEventListener('click', handleAction);
app.addEventListener('submit', handleSubmit);
app.addEventListener('change', handleChange);

async function bootstrap() {
  if (PUBLIC_CODE) { renderPublic(); return; }
  app.innerHTML = '<main class="loading-screen"><div class="loading-dot"></div></main>';
  try {
    const auth = await api('/api/auth/me');
    state.authenticated = Boolean(auth.authenticated);
    if (state.authenticated) await refreshAll(); else render();
  } catch (error) {
    state.authenticated = false;
    render();
  }
}

bootstrap();
