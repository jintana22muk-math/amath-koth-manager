const app = document.querySelector('#app');
const PUBLIC_CODE = new URLSearchParams(location.search).get('public');

const state = {
  authenticated: false,
  user: null,
  admins: [],
  tournaments: [],
  selectedId: localStorage.getItem('amath-koth:selected-tournament') || '',
  data: null,
  view: 'dashboard',
  modal: null,
  docxPreview: null,
  docxSourceName: '',
  docxLoading: false,
  toasts: []
};

const navItems = [
  ['dashboard', 'ภาพรวม', '01'],
  ['teams', 'รายชื่อทีม', '02'],
  ['koth', 'แข่งขันและบันทึกผล', '03'],
  ['standings', 'อันดับคะแนน', '04']
];

const utilityNavItems = [
  ['tournaments', 'ทัวร์นาเมนต์ทั้งหมด'],
  ['reports', 'ศูนย์เอกสาร'],
  ['settings', 'ตั้งค่าทัวร์นาเมนต์'],
  ['admins', 'จัดการผู้ดูแล']
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

async function loadAdmins() {
  const response = await api('/api/admins');
  state.admins = response.admins;
  state.user = response.current_user;
}

function pageHeading() {
  const tournament = state.data?.tournament;
  const titles = {
    dashboard: ['ศูนย์ควบคุมการแข่งขัน', 'ดูสถานะและทำงานสำคัญต่อได้ทันที'],
    tournaments: ['ทัวร์นาเมนต์ทั้งหมด', 'สลับรายการ สร้างรายการใหม่ และกลับมาจัดการรายการเดิม'],
    teams: ['รายชื่อทีม', 'เตรียมรายชื่อให้พร้อมก่อนเริ่มจับคู่'],
    koth: ['แข่งขันและบันทึกผล', 'สร้างคู่แข่ง กรอกคะแนน และติดตามงานที่ยังไม่เสร็จในหน้าเดียว'],
    standings: ['อันดับคะแนน', 'ตารางอันดับจะคำนวณใหม่ทันทีเมื่อยืนยันผล'],
    reports: ['ศูนย์เอกสาร', 'นำเข้ารายชื่อ สร้างใบแข่งขัน และส่งออกเอกสารจากข้อมูลชุดเดียว'],
    settings: ['ตั้งค่าทัวร์นาเมนต์', 'แก้ไขข้อมูลรายการและกติกาคะแนนเมื่อจำเป็น'],
    admins: ['จัดการผู้ดูแล', 'เพิ่มผู้ช่วยจัดการแข่งขันและควบคุมบัญชีที่เข้าใช้งานระบบ']
  };
  const [title, subtitle] = titles[state.view] || titles.dashboard;
  return `<div class="topbar"><div class="page-title"><span class="eyebrow">ระบบจัดการแข่งขัน A-Math · คิงออฟเดอะฮิลล์ (KOTH)</span><h2>${title}</h2><p>${subtitle}</p></div>${tournament ? tournamentPicker() : '<button class="button primary" data-action="new-tournament">สร้างทัวร์นาเมนต์</button>'}</div>`;
}

function tournamentPicker() {
  return `<div class="tournament-switch"><label for="tournament-selector">กำลังจัดการทัวร์นาเมนต์</label><div class="select-wrap"><select id="tournament-selector">${state.tournaments.map((tournament) => `<option value="${escapeHtml(tournament.id)}" ${tournament.id === state.selectedId ? 'selected' : ''}>${escapeHtml(tournament.name)}${tournament.academic_year ? ` · ${escapeHtml(tournament.academic_year)}` : ''}</option>`).join('')}</select></div></div>`;
}

function renderMobileHeader(tournament) {
  const name = tournament?.name || 'ระบบจัดการแข่งขัน A-Math';
  const detail = tournament
    ? [tournament.category, tournament.academic_year].filter(Boolean).join(' · ') || 'แตะเพื่อดูทัวร์นาเมนต์ทั้งหมด'
    : 'ยังไม่ได้เลือกทัวร์นาเมนต์';
  return `<header class="mobile-appbar"><div class="mobile-appbar-brand"><span class="mobile-appbar-logo">A</span><div><strong>${escapeHtml(short(name, 34))}</strong><span>${escapeHtml(detail)}</span></div></div><button class="mobile-appbar-switch" data-action="go-tournaments" type="button">รายการ</button></header>`;
}

function renderMobileNavigation() {
  const utilityViews = new Set(['tournaments', 'reports', 'settings', 'admins']);
  const item = (view, label, mark) => `<button class="mobile-tab-button ${state.view === view ? 'active' : ''}" data-action="nav" data-view="${view}" type="button" ${state.view === view ? 'aria-current="page"' : ''}><span class="mobile-tab-icon" aria-hidden="true">${mark}</span><span>${label}</span></button>`;
  return `<nav class="mobile-tabbar" aria-label="เมนูหลักบนมือถือ"><div class="mobile-tabbar-inner">${item('dashboard', 'ภาพรวม', '⌂')}${item('teams', 'ทีม', '●●')}${item('koth', 'แข่งขัน', '×')}${item('standings', 'อันดับ', '★')}<button class="mobile-tab-button ${utilityViews.has(state.view) ? 'active' : ''}" data-action="open-mobile-more" type="button"><span class="mobile-tab-icon more" aria-hidden="true">•••</span><span>เพิ่มเติม</span></button></div></nav>`;
}

function openMobileMore() {
  const menuItem = (view, mark, title, detail) => `<button class="mobile-more-item ${state.view === view ? 'active' : ''}" data-action="mobile-nav" data-view="${view}" type="button"><span class="mobile-more-mark" aria-hidden="true">${mark}</span><span><strong>${title}</strong><small>${detail}</small></span><b aria-hidden="true">›</b></button>`;
  state.modal = {
    kind: 'mobile-more',
    title: 'เมนูเพิ่มเติม',
    body: `<div class="mobile-more-menu"><span class="mobile-more-caption">จัดการรายการแข่งขัน</span>${menuItem('tournaments', 'ท', 'ทัวร์นาเมนต์ทั้งหมด', 'สร้าง สลับ หรือลบทัวร์นาเมนต์')}${menuItem('reports', 'อ', 'ศูนย์เอกสาร', 'นำเข้า ส่งออก และมาสเตอร์สกอร์การ์ด')}<span class="mobile-more-caption">ตั้งค่าระบบ</span>${menuItem('settings', 'ก', 'ตั้งค่าทัวร์นาเมนต์', 'ข้อมูลรายการ กติกาคะแนน และการเผยแพร่')}${menuItem('admins', 'ผ', 'จัดการผู้ดูแล', 'เพิ่มหรือลบบัญชีผู้ดูแล')}<button class="mobile-more-logout" data-action="logout" type="button">ออกจากระบบ</button></div>`
  };
  render();
}

function renderNoTournament() {
  return `<section class="empty-state card"><span class="empty-kicker">เริ่มต้นครั้งแรก</span><h2>สร้างทัวร์นาเมนต์แรกของคุณ</h2><p>ใช้เวลาไม่ถึง 1 นาที จากนั้นระบบจะพาไปเพิ่มทีม จับคู่ บันทึกผล และประกาศอันดับตามลำดับ</p><div class="hero-actions"><button class="button primary" data-action="new-tournament">สร้างทัวร์นาเมนต์</button>${state.tournaments.length ? '<button class="button secondary" data-action="go-tournaments">เลือกจากรายการเดิม</button>' : ''}</div></section>`;
}

function workflowStatus(data) {
  const activeTeams = data.teams.filter((team) => team.is_active);
  const koth = data.rounds.filter((round) => round.phase === 'koth');
  const current = koth.find((round) => round.status !== 'completed');
  const pendingMatches = current?.matches.filter((match) => !match.is_bye && match.status !== 'final').length || 0;
  if (activeTeams.length < 2) return { step: 1, action: 'go-teams', label: 'เพิ่มรายชื่อทีม', detail: `ตอนนี้มี ${activeTeams.length} ทีม ต้องมีอย่างน้อย 2 ทีมเพื่อเริ่มแข่งขัน` };
  if (current) return { step: 2, action: 'go-koth', label: `บันทึกผล ${current.title}`, detail: pendingMatches ? `เหลืออีก ${pendingMatches} คู่ที่ยังไม่ได้ยืนยันผล` : 'ตรวจสอบผลและไปต่อรอบถัดไป' };
  if (koth.length < Number(data.tournament.rounds_planned || 0)) return { step: 2, action: 'go-koth', label: `สร้างคู่เกมที่ ${koth.length + 1}`, detail: `แข่งขันแล้ว ${koth.length} จาก ${data.tournament.rounds_planned} เกมที่วางแผนไว้` };
  return { step: 3, action: 'go-standings', label: 'ตรวจสอบอันดับและประกาศผล', detail: 'ผลคิงออฟเดอะฮิลล์ (KOTH) ครบตามจำนวนเกมที่วางแผนแล้ว' };
}

function workflowSteps(data) {
  const activeTeams = data.teams.filter((team) => team.is_active).length;
  const koth = data.rounds.filter((round) => round.phase === 'koth');
  const hasOpenRound = koth.some((round) => round.status !== 'completed');
  const currentStep = activeTeams < 2 ? 1 : (hasOpenRound || koth.length < Number(data.tournament.rounds_planned || 0)) ? 2 : 3;
  const steps = [
    ['teams', '1', 'เตรียมทีม', `${activeTeams} ทีม`],
    ['koth', '2', 'แข่งขัน', `${koth.filter((round) => round.status === 'completed').length}/${data.tournament.rounds_planned} เกม`],
    ['standings', '3', 'สรุปอันดับ', data.standings.length ? 'พร้อมตรวจสอบ' : 'รอผลแข่ง'],
    ['reports', '4', 'เผยแพร่', data.tournament.public_enabled ? 'เปิดแล้ว' : 'ยังไม่เปิด']
  ];
  return `<section class="workflow" aria-label="ขั้นตอนการจัดการแข่งขัน">${steps.map(([view, number, title, meta], index) => `<button class="workflow-step ${index + 1 < currentStep ? 'done' : ''} ${index + 1 === currentStep ? 'current' : ''}" data-action="nav" data-view="${view}"><span class="step-number">${index + 1 < currentStep ? '✓' : number}</span><span><strong>${title}</strong><small>${meta}</small></span></button>`).join('')}</section>`;
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
  const next = workflowStatus(data);
  return `
    ${workflowSteps(data)}
    <section class="dashboard-hero">
      <div class="hero-copy"><span class="status-dot ${escapeHtml(tournament.status)}">${tournament.status === 'draft' ? 'กำลังเตรียมรายการ' : tournament.status === 'open' ? 'กำลังแข่งขัน' : 'เสร็จสิ้น'}</span><h2>${escapeHtml(tournament.name)}</h2><p>${[tournament.category, tournament.academic_year, tournament.venue].filter(Boolean).map(escapeHtml).join(' · ') || 'เพิ่มรายละเอียดปีและสถานที่ได้ในหน้าตั้งค่า'}</p></div>
      <aside class="next-action"><span>สิ่งที่ควรทำต่อ</span><h3>${next.label}</h3><p>${next.detail}</p><button class="button primary" data-action="${next.action}">ไปทำขั้นตอนนี้ <span aria-hidden="true">→</span></button></aside>
    </section>
    <section class="grid grid-3 dashboard-metrics">
      <article class="card metric"><div class="metric-label">ทีมที่พร้อมแข่ง</div><div class="metric-value">${active.length}</div><div class="metric-note">${active.length >= 2 ? 'พร้อมสำหรับการจับคู่' : 'เพิ่มอย่างน้อย 2 ทีม'}</div></article>
      <article class="card metric"><div class="metric-label">ความคืบหน้าคิงออฟเดอะฮิลล์ (KOTH)</div><div class="metric-value">${completed}<small> / ${tournament.rounds_planned}</small></div><div class="metric-note">${current ? `${escapeHtml(current.title)} กำลังดำเนินการ` : completed ? 'พร้อมสร้างเกมถัดไป' : 'ยังไม่เริ่มแข่งขัน'}</div></article>
      <article class="card metric"><div class="metric-label">การเผยแพร่ผล</div><div class="metric-value metric-text">${tournament.public_enabled ? 'เปิดแล้ว' : 'ยังไม่เปิด'}</div><div class="metric-note">${tournament.public_enabled ? `ผู้ชมเข้าดูด้วยรหัส ${escapeHtml(tournament.code)}` : 'เปิดเมื่อพร้อมประกาศผล'}</div></article>
    </section>
    <section class="section-head"><div><span class="section-kicker">อันดับคะแนนล่าสุด</span><h3>อันดับล่าสุด</h3><p>คำนวณจากผลที่ยืนยันแล้ว</p></div><button class="button ghost small" data-action="go-standings">ดูอันดับทั้งหมด</button></section>
    ${top.length ? standingsTable(top, true) : `<section class="card empty"><div class="empty-icon">⌁</div><h3>ยังไม่มีรายชื่อทีม</h3><p>เพิ่มทีมก่อนเริ่มจัดการแข่งขัน</p><button class="button primary" data-action="go-teams">เพิ่มทีมแข่งขัน</button></section>`}
  `;
}

function standingsTable(rows, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>อันดับ</th><th>ทีม</th><th class="right-align">คะแนน</th><th class="right-align">ชนะ</th><th class="right-align">เสมอ</th><th class="right-align">แพ้</th><th class="right-align">พักการแข่งขัน (BYE)</th><th class="right-align">ผลต่าง*</th><th class="right-align">แต้มได้</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.is_active === false ? 'is-muted' : ''}"><td class="rank ${row.rank <= 3 ? `top-${row.rank}` : ''}">${row.rank}</td><td><div class="team-title">${escapeHtml(row.name)} <span class="code-pill">${escapeHtml(row.code)}</span>${row.is_active === false ? ' <span class="badge archived">ถอนแล้ว</span>' : ''}</div>${row.school ? `<div class="team-meta">${escapeHtml(row.school)}</div>` : ''}</td><td class="right-align"><strong>${row.points}</strong></td><td class="right-align">${row.wins}</td><td class="right-align">${row.draws}</td><td class="right-align">${row.losses}</td><td class="right-align">${row.byes}</td><td class="right-align">${row.capped_diff > 0 ? '+' : ''}${row.capped_diff}</td><td class="right-align">${row.points_for}</td></tr>`).join('')}</tbody></table></div>${compact ? '' : '<p class="small muted" style="margin:9px 0 0">* ผลต่างคะแนนหลังใช้เพดานของแต่ละเกมตามที่ตั้งไว้ ทีมที่ถอนแล้วยังแสดงประวัติผลเดิม แต่จะไม่ถูกจับคู่รอบใหม่</p>'}`;
}

function renderTournaments() {
  return `<section class="tournament-toolbar"><div><strong>${state.tournaments.length} ทัวร์นาเมนต์</strong><span>แต่ละรายการแยกทีม ผล และกติกาออกจากกันอย่างชัดเจน</span></div><button class="button primary" data-action="new-tournament">สร้างทัวร์นาเมนต์ใหม่</button></section>${state.tournaments.length ? `<section class="tournament-grid">${state.tournaments.map((tournament) => `<article class="tournament-card card ${tournament.id === state.selectedId ? 'selected' : ''}"><div class="tournament-card-top"><span class="tournament-year">${escapeHtml(tournament.academic_year || 'ไม่ระบุปี')}</span>${badge(tournament.status)}</div><h3>${escapeHtml(tournament.name)}</h3><p>${escapeHtml([tournament.category, tournament.venue].filter(Boolean).join(' · ') || 'ยังไม่ได้ระบุประเภทและสถานที่')}</p><div class="tournament-stats"><span><strong>${tournament.team_count}</strong> ทีม</span><span><strong>${tournament.koth_round_count}</strong> เกมคิงออฟเดอะฮิลล์ (KOTH)</span></div><div class="tournament-card-footer"><span class="selected-label">${tournament.id === state.selectedId ? 'กำลังจัดการรายการนี้' : ''}</span><div class="tournament-card-actions"><button class="button danger-outline small" data-action="delete-tournament" data-id="${escapeHtml(tournament.id)}">ลบทัวร์นาเมนต์</button><button class="button secondary small" data-action="select-tournament" data-id="${escapeHtml(tournament.id)}">${tournament.id === state.selectedId ? 'เปิดศูนย์ควบคุม' : 'จัดการรายการนี้'}</button></div></div></article>`).join('')}</section>` : renderNoTournament()}`;
}

function tournamentForm(formName, tournament = {}) {
  const scoring = tournament.scoring || { win_points: 2, draw_points: 1, loss_points: 0, bye_points: 2, default_diff_cap: 250, round_caps: [250,250,250,250,200] };
  return `<form data-form="${formName}" class="form-grid">
    <div class="field full"><label>ชื่อทัวร์นาเมนต์ <span class="required">จำเป็น</span></label><input name="name" required value="${escapeHtml(tournament.name || '')}" placeholder="เช่น A-Math ชิงแชมป์ระดับมัธยม 2569" /></div>
    <div class="field"><label>ปีการศึกษา</label><input name="academic_year" value="${escapeHtml(tournament.academic_year || '')}" placeholder="2569" /></div>
    <div class="field"><label>ประเภท</label><input name="category" value="${escapeHtml(tournament.category || 'A-Math')}" /></div>
    <div class="field"><label>จำนวนเกมคิงออฟเดอะฮิลล์ (KOTH)</label><input type="number" min="1" max="99" name="rounds_planned" value="${escapeHtml(tournament.rounds_planned || 5)}" /><small>แก้ไขภายหลังได้</small></div>
    <div class="field wide"><label>หน่วยงาน / ผู้จัด</label><input name="organizer" value="${escapeHtml(tournament.organizer || '')}" /></div>
    <div class="field wide"><label>สถานที่</label><input name="venue" value="${escapeHtml(tournament.venue || '')}" /></div>
    <div class="field"><label>วันเริ่ม</label><input type="date" name="starts_on" value="${escapeHtml(tournament.starts_on || '')}" /></div>
    <div class="field"><label>วันสิ้นสุด</label><input type="date" name="ends_on" value="${escapeHtml(tournament.ends_on || '')}" /></div>
    ${formName === 'create-tournament' ? '<div class="field full form-actions"><button class="button primary" type="submit">สร้างและเริ่มเพิ่มทีม</button></div>' : ''}
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
  const teamRows = (items, inactive = false) => `<div class="table-wrap"><table><thead><tr><th>ลำดับเริ่มต้น (Seed)</th><th>ทีม</th><th>สังกัด</th><th>ผู้เข้าแข่งขัน</th><th>ครูผู้ควบคุม</th><th></th></tr></thead><tbody>${items.map((team) => `<tr class="${inactive ? 'is-muted' : ''}"><td><strong>${team.seed}</strong></td><td><div class="team-title">${escapeHtml(team.name)} <span class="code-pill">${escapeHtml(team.code)}</span>${inactive ? ' <span class="badge archived">ถอนแล้ว</span>' : ''}</div></td><td>${escapeHtml(team.school || '—')}</td><td>${escapeHtml([team.member_1, team.member_2].filter(Boolean).join(' / ') || '—')}</td><td>${escapeHtml(team.coach || '—')}</td><td class="right-align"><div class="button-row" style="justify-content:flex-end"><button class="button ghost small" data-action="edit-team" data-id="${escapeHtml(team.id)}">แก้ไข</button>${inactive ? `<button class="button secondary small" data-action="restore-team" data-id="${escapeHtml(team.id)}">กู้คืน</button>` : `<button class="button ghost small" data-action="delete-team" data-id="${escapeHtml(team.id)}" data-delete-mode="${finalTeamIds.has(team.id) ? 'withdraw' : matchedTeamIds.has(team.id) ? 'paired' : 'delete'}">${finalTeamIds.has(team.id) ? 'ถอนทีม' : 'ลบ'}</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
  return `
    ${kothStarted ? '<section class="notice info" style="margin-bottom:16px"><strong>รายการเริ่มแข่งขันแล้ว</strong><span> ทีมที่เพิ่มใหม่จะถูกใช้ในการจับคู่เกมถัดไป ส่วนทีมที่ถอนจะยังคงมีประวัติผลเดิม</span></section>' : ''}
    <section class="team-summary card"><div><span class="summary-number">${teams.length}</span><span>ทีมที่พร้อมแข่งขัน</span></div><div class="summary-rule"></div><p>${teams.length < 2 ? 'เพิ่มอีกอย่างน้อย 2 ทีมเพื่อเริ่มจับคู่' : `พร้อมสร้างคู่แข่งขัน${teams.length % 2 ? ' · จะมี 1 ทีมพักการแข่งขัน (BYE)' : ''}`}</p></section>
    <div class="grid grid-2 team-entry-grid">
      <section class="card card-pad"><span class="section-kicker">เพิ่มทีละทีม</span><h3>ข้อมูลทีมใหม่</h3><form data-form="add-team" class="form-grid compact-form">
        <div class="field full"><label>ชื่อทีม <span class="required">จำเป็น</span></label><input name="name" required placeholder="เช่น โรงเรียนตัวอย่าง ทีม A" /></div>
        <div class="field full"><label>โรงเรียน / สังกัด</label><input name="school" placeholder="ชื่อโรงเรียนหรือชมรม" /></div>
        <details class="advanced-fields field full"><summary>เพิ่มข้อมูลผู้แข่งขันสำหรับเอกสาร</summary><div class="form-grid"><div class="field"><label>ลำดับเริ่มต้น (Seed)</label><input name="seed" type="number" min="1" placeholder="อัตโนมัติ" /></div><div class="field"><label>รหัสทีม</label><input name="code" placeholder="เช่น A01" /></div><div class="field"><label>จังหวัด</label><input name="province" /></div><div class="field"><label>ครูผู้ควบคุม</label><input name="coach" /></div><div class="participant-fields field full"><strong>ผู้แข่งขันคนที่ 1</strong><div class="form-grid"><div class="field wide"><label>ชื่อ–นามสกุล</label><input name="member_1" /></div><div class="field"><label>ระดับชั้น / ห้อง</label><input name="member_1_level" /></div><div class="field"><label>เลขประจำตัว</label><input name="member_1_student_id" /></div><div class="field"><label>เบอร์โทรศัพท์</label><input name="member_1_phone" /></div></div></div><div class="participant-fields field full"><strong>ผู้แข่งขันคนที่ 2</strong><div class="form-grid"><div class="field wide"><label>ชื่อ–นามสกุล</label><input name="member_2" /></div><div class="field"><label>ระดับชั้น / ห้อง</label><input name="member_2_level" /></div><div class="field"><label>เลขประจำตัว</label><input name="member_2_student_id" /></div><div class="field"><label>เบอร์โทรศัพท์</label><input name="member_2_phone" /></div></div></div></div></details>
        <div class="field full"><button class="button primary" type="submit">เพิ่มทีมนี้</button></div>
      </form></section>
      <section class="card card-pad import-card"><span class="section-kicker">เพิ่มหลายทีม</span><h3>วางรายชื่อจาก Excel</h3><p class="muted small">หนึ่งบรรทัดต่อหนึ่งทีม เรียงข้อมูลเป็น: รหัส, ชื่อทีม, โรงเรียน, ผู้แข่งขัน 1, ผู้แข่งขัน 2, ครูผู้ควบคุม</p><form data-form="import-teams"><div class="field full"><textarea name="team_lines" placeholder="A01,ทีม 1,โรงเรียนตัวอย่าง,นักเรียน ก,นักเรียน ข,ครู ก\nA02,ทีม 2,โรงเรียนตัวอย่าง,นักเรียน ค,นักเรียน ง,ครู ข"></textarea></div><button class="button secondary" type="submit">นำเข้ารายชื่อทั้งหมด</button></form></section>
    </div>
    <section class="section-head"><div><span class="section-kicker">รายชื่อทีม</span><h3>ทีมที่ใช้จับคู่รอบถัดไป</h3><p>ลำดับเริ่มต้น (Seed) ใช้กำหนดการเรียงทีมของเกมแรกเท่านั้น</p></div>${teams.length >= 2 ? '<button class="button primary small" data-action="go-koth">ไปสร้างคู่แข่งขัน</button>' : ''}</section>
    ${teams.length ? teamRows(teams) : `<section class="card empty"><div class="empty-icon">♟</div><h3>ยังไม่มีทีมที่เปิดใช้งาน</h3><p>เพิ่มทีมทีละทีม หรือวางรายชื่อหลายทีมจาก Excel</p></section>`}
    ${inactiveTeams.length ? `<section class="section-head"><div><h3>ทีมที่ถอนจากรอบถัดไป (${inactiveTeams.length})</h3><p>ทีมเหล่านี้ไม่ถูกจับคู่ใหม่ แต่ผลเดิมยังอยู่ในประวัติและตารางคะแนน</p></div></section>${teamRows(inactiveTeams, true)}` : ''}`;
}

function kothControls(data) {
  const koth = data.rounds.filter((round) => round.phase === 'koth');
  const incomplete = koth.find((round) => round.status !== 'completed');
  const nextNo = koth.length + 1;
  const cap = data.tournament.scoring.round_caps[nextNo - 1] ?? data.tournament.scoring.default_diff_cap;
  const teamCount = data.teams.filter((team) => team.is_active).length;
  const pendingCount = incomplete?.matches.filter((match) => !match.is_bye && match.status !== 'final').length || 0;
  return `<section class="round-control ${incomplete ? 'has-active' : ''}"><div class="round-control-copy"><span class="section-kicker">${incomplete ? 'รอบที่กำลังแข่งขัน' : 'พร้อมสำหรับขั้นตอนถัดไป'}</span><h3>${incomplete ? escapeHtml(incomplete.title) : `สร้างคู่เกมที่ ${nextNo}`}</h3><p>${incomplete ? `ยังเหลือ ${pendingCount} คู่ที่ต้องบันทึกผล เมื่อครบแล้วจึงสร้างเกมถัดไปได้` : 'ระบบจะประกบทีมอันดับใกล้กันและพยายามหลีกเลี่ยงคู่ที่เคยพบกัน'}</p></div>${incomplete ? `<div class="round-progress"><strong>${incomplete.matches.length - pendingCount}/${incomplete.matches.length}</strong><span>คู่บันทึกแล้ว</span></div>` : `<form data-form="generate-round" class="round-create-form"><div class="field"><label>การจับคู่${nextNo > 1 ? '' : 'เกมแรก'}</label><select name="first_round_method" ${nextNo > 1 ? 'disabled' : ''}><option value="seed">ตามลำดับเริ่มต้น (Seed)</option><option value="random">สุ่มลำดับ</option></select></div><div class="field"><label>เพดานผลต่าง</label><input type="number" min="0" name="diff_cap" value="${cap}" /></div><div class="field"><label>ชื่อเกม (ไม่จำเป็น)</label><input name="title" placeholder="เกมที่ ${nextNo}" /></div><button class="button primary" type="submit" ${teamCount < 2 ? 'disabled' : ''}>สร้างคู่เกมที่ ${nextNo}</button><small>${teamCount < 2 ? 'ต้องมีอย่างน้อย 2 ทีม' : `${teamCount} ทีม${teamCount % 2 ? ' · พักการแข่งขัน (BYE) 1 ทีม' : ''}`}</small></form>`}</section>`;
}

function renderMatchRow(match, round) {
  if (match.is_bye) return `<div class="match-row is-final"><div class="match-table">โต๊ะ ${match.table_no}</div><div class="match-team"><strong>${teamName(match.team_a)}</strong><small>${escapeHtml(match.team_a?.school || '')}</small></div><div class="bye-label">พักการแข่งขัน (BYE)</div><div class="match-team right"><strong>—</strong></div><div class="match-action">${badge('final')}</div></div>`;
  const isFinals = round.phase !== 'koth';
  const winnerOptions = isFinals ? `<select name="winner_team_id" aria-label="ผู้ชนะกรณีคะแนนเสมอ"><option value="">เลือกผู้ชนะเมื่อเสมอ</option><option value="${escapeHtml(match.team_a_id)}" ${match.winner_team_id === match.team_a_id ? 'selected' : ''}>${escapeHtml(short(match.team_a?.name || '', 16))}</option><option value="${escapeHtml(match.team_b_id)}" ${match.winner_team_id === match.team_b_id ? 'selected' : ''}>${escapeHtml(short(match.team_b?.name || '', 16))}</option></select>` : '';
  const starterOptions = `<select name="starter_team_id" aria-label="ทีมที่เริ่มก่อน"><option value="">ผู้เริ่มก่อน (ไม่ระบุ)</option><option value="${escapeHtml(match.team_a_id)}" ${match.starter_team_id === match.team_a_id ? 'selected' : ''}>เริ่มก่อน: ${escapeHtml(short(match.team_a?.name || '', 13))}</option><option value="${escapeHtml(match.team_b_id)}" ${match.starter_team_id === match.team_b_id ? 'selected' : ''}>เริ่มก่อน: ${escapeHtml(short(match.team_b?.name || '', 13))}</option></select>`;
  return `<form class="match-row ${match.status === 'final' ? 'is-final' : ''}" data-form="match" data-match-id="${escapeHtml(match.id)}"><div class="match-table">โต๊ะ ${match.table_no}</div><div class="match-team"><strong>${teamName(match.team_a)}</strong><small>${escapeHtml(match.team_a?.school || '')}</small></div><div class="score-box"><input type="number" min="0" name="score_a" value="${match.score_a ?? ''}" aria-label="คะแนนทีม A" required /><span>:</span><input type="number" min="0" name="score_b" value="${match.score_b ?? ''}" aria-label="คะแนนทีม B" required /></div><div class="match-team right"><strong>${teamName(match.team_b)}</strong><small>${escapeHtml(match.team_b?.school || '')}</small></div><div class="match-action">${starterOptions}${winnerOptions}<button class="button ${match.status === 'final' ? 'secondary' : 'primary'} small" type="submit">${match.status === 'final' ? 'บันทึกแก้ไข' : 'ยืนยันผล'}</button>${match.status === 'final' ? `<button class="button ghost small" type="button" data-action="reset-match" data-id="${escapeHtml(match.id)}">ล้างผล</button>${badge('final')}` : ''}</div></form>`;
}

function renderRounds(data) {
  const allRounds = data.rounds;
  if (!allRounds.length) return `<section class="card empty"><div class="empty-icon">↔</div><h3>ยังไม่มีการจับคู่</h3><p>เมื่อพร้อมแล้วให้สร้างเกมคิงออฟเดอะฮิลล์ (KOTH) แรก ระบบจะเรียงตามลำดับเริ่มต้น (Seed) หรือสุ่มตามที่เลือก</p></section>`;
  return allRounds.slice().reverse().map((round, index) => `<section class="card round-card ${index === 0 ? 'latest-round' : ''}"><header class="round-title"><div><span class="section-kicker">${index === 0 ? 'ล่าสุด' : 'รอบก่อนหน้า'}</span><h4>${escapeHtml(round.title)}</h4><p>${round.phase === 'koth' ? `เกมคิงออฟเดอะฮิลล์ (KOTH) ${round.round_number} · เพดานผลต่าง ±${round.diff_cap}` : round.phase === 'finals-semifinal' ? '4 อันดับแรก (Top 4) · อันดับ 1 พบ 4 และอันดับ 2 พบ 3' : 'รอบชิงชนะเลิศและชิงอันดับ 3'}</p>${round.pairing_note ? `<p class="notice warning" style="margin:8px 0 0">${escapeHtml(round.pairing_note)}</p>` : ''}</div><div class="button-row">${badge(round.status)}${round.status !== 'completed' ? `<button class="button ghost small" data-action="edit-pairings" data-id="${escapeHtml(round.id)}">แก้ไขคู่</button>` : ''}</div></header><div class="match-list">${round.matches.map((match) => renderMatchRow(match, round)).join('')}</div></section>`).join('');
}

function finalControls(data) {
  const semis = data.rounds.find((round) => round.phase === 'finals-semifinal');
  const medals = data.rounds.find((round) => round.phase === 'finals-medal');
  const medalData = data.finals?.medals;
  let action = '';
  if (!semis) action = `<button class="button gold" data-action="create-finals" data-stage="semifinal">สร้างรอบชิง 4 อันดับแรก (Top 4)</button>`;
  else if (semis.status === 'completed' && !medals) action = `<button class="button gold" data-action="create-finals" data-stage="medal">สร้างรอบชิงชนะเลิศ / ชิงอันดับ 3</button>`;
  else if (semis.status !== 'completed') action = `<span class="small muted">ยืนยันผลรอบรองชนะเลิศก่อนสร้างรอบชิงเหรียญ</span>`;
  const medalsHtml = medalData ? `<div class="notice success" style="margin-top:12px"><strong>ผลรอบชิง:</strong> 🥇 ${escapeHtml(medalData.gold?.name || '')} · 🥈 ${escapeHtml(medalData.silver?.name || '')} · 🥉 ${escapeHtml(medalData.bronze?.name || '')}</div>` : '';
  return `<details class="finals-panel card"><summary><span><strong>รอบชิง 4 อันดับแรก (Top 4)</strong><small>ตัวเลือกสำหรับรายการที่ต้องการชิงเหรียญ</small></span><span class="details-chevron">⌄</span></summary><div class="finals-body"><p>ระบบจะนำ 4 อันดับแรกจากตารางคิงออฟเดอะฮิลล์ (KOTH) ไปสร้างรอบรองชนะเลิศและรอบชิง</p><div>${action}</div>${medalsHtml}</div></details>`;
}

function renderKoth() {
  const data = state.data;
  if (!data) return renderNoTournament();
  return `${kothControls(data)}<section class="section-head"><div><span class="section-kicker">โต๊ะแข่งขัน</span><h3>โต๊ะแข่งขันและผลคะแนน</h3><p>รอบล่าสุดอยู่ด้านบน กรอกคะแนนแล้วกด “ยืนยันผล” รายคู่</p></div></section>${renderRounds(data)}${finalControls(data)}`;
}

function renderStandings() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const leader = data.standings[0];
  return `${leader ? `<section class="standing-leader"><div><span class="section-kicker">อันดับ 1 ล่าสุด</span><h3>${escapeHtml(leader.name)}</h3><p>${escapeHtml(leader.school || leader.code)} · ชนะ ${leader.wins} · เสมอ ${leader.draws} · แพ้ ${leader.losses}</p></div><div class="leader-score"><strong>${leader.points}</strong><span>คะแนน</span></div></section><div class="standing-toolbar"><p>แสดงเฉพาะผลที่ยืนยันแล้ว</p><div class="button-row"><button class="button secondary small" data-action="export-csv">ดาวน์โหลดไฟล์ตาราง (CSV)</button><button class="button ghost small" data-action="print">พิมพ์ตาราง</button></div></div>` : ''}${data.standings.length ? standingsTable(data.standings) : '<section class="card empty"><div class="empty-icon">≡</div><h3>ตารางคะแนนจะปรากฏเมื่อเพิ่มทีม</h3><p>เพิ่มทีมแล้วระบบจะแสดงลำดับเริ่มต้นให้ทันที</p><button class="button primary" data-action="go-teams">เพิ่มทีม</button></section>'}`;
}

function renderReports() {
  const data = state.data;
  const importSection = `<section class="document-import card"><div><span class="section-kicker">นำเข้าข้อมูล</span><h3>สร้างทัวร์นาเมนต์จากรายชื่อในไฟล์ Word</h3><p>อ่านตารางรายชื่อ แยกประเภทการแข่งขัน ตรวจชื่อซ้ำ และให้คุณยืนยันก่อนสร้างข้อมูลจริง</p><div class="document-trust"><span>ไฟล์ Word (DOCX)</span><span>ตรวจข้อมูลซ้ำ</span><span>สร้างหลายรายการ</span></div></div><button class="button primary" data-action="import-docx">นำเข้ารายชื่อจาก Word</button></section>`;
  if (!data) return `${importSection}<section class="card empty document-empty"><div class="empty-icon">เอกสาร</div><h3>เลือกหรือสร้างทัวร์นาเมนต์เพื่อออกเอกสาร</h3><p>เมื่อนำเข้ารายชื่อแล้ว ระบบจะเปิดเครื่องมือมาสเตอร์สกอร์การ์ด (Master Score Card) ให้อัตโนมัติ</p></section>`;
  const t = data.tournament;
  const publicUrl = `${location.origin}${location.pathname}?public=${encodeURIComponent(t.code)}`;
  return `${importSection}<section class="section-head"><div><span class="section-kicker">มาสเตอร์สกอร์การ์ด (Master Score Card)</span><h3>ใบมาสเตอร์สกอร์การ์ด</h3><p>สร้างจากแม่แบบจริง หนึ่งหน้าต่อหนึ่งทีม รวมเป็นไฟล์พร้อมพิมพ์ (PDF) เดียว</p></div></section><section class="master-card-builder"><div class="master-preview"><img src="/assets/master-score-card.png" alt="ตัวอย่างใบมาสเตอร์สกอร์การ์ด" /></div><div class="master-options"><span class="document-status">${data.teams.filter((team) => team.is_active).length} ทีม · ${data.rounds.filter((round) => round.phase === 'koth').length} เกม</span><h3>เลือกฉบับที่ต้องการ</h3><div class="master-option"><div><strong>ฉบับเตรียมแข่งขัน</strong><p>กรอกข้อมูลทีมและนักกีฬา ส่วนผลการแข่งขันเว้นว่างไว้เขียนมือ</p></div><button class="button primary" data-action="export-master-card" data-mode="blank">สร้างไฟล์พร้อมพิมพ์ (PDF)</button></div><div class="master-option"><div><strong>ฉบับผลการแข่งขัน</strong><p>เติมโต๊ะ คู่แข่งขัน ผลชนะ/เสมอ/แพ้ และผลสะสมจากระบบ</p></div><button class="button secondary" data-action="export-master-card" data-mode="complete">สร้างไฟล์พร้อมผล (PDF)</button></div><p class="privacy-note">เอกสารนี้มีข้อมูลนักเรียน โปรดจัดเก็บและส่งต่อเฉพาะผู้เกี่ยวข้อง</p></div></section><section class="section-head"><div><span class="section-kicker">เอกสารอื่น</span><h3>เผยแพร่ ส่งออก และสำรองข้อมูล</h3><p>ข้อมูลทุกเอกสารมาจากทัวร์นาเมนต์เดียวกัน</p></div></section><div class="action-card-grid"><button class="action-card card" data-action="export-csv"><span class="action-mark">ไฟล์ตาราง (CSV)</span><strong>ตารางคะแนน</strong><small>เปิดต่อใน Excel (โปรแกรมตาราง) หรือ Google Sheets (ตารางออนไลน์)</small></button><button class="action-card card" data-action="print"><span class="action-mark">พิมพ์เอกสาร</span><strong>พิมพ์หน้าปัจจุบัน</strong><small>พิมพ์หรือบันทึกเป็นไฟล์พร้อมพิมพ์ (PDF)</small></button><button class="action-card card" data-action="export-backup"><span class="action-mark">ไฟล์สำรอง (JSON)</span><strong>สำรองทัวร์นาเมนต์</strong><small>เก็บทีม คู่แข่ง ผล และการตั้งค่า</small></button><label class="action-card card upload-card"><span class="action-mark">กู้คืนข้อมูล</span><strong>กู้คืนเป็นรายการใหม่</strong><small>ข้อมูลเดิมจะไม่ถูกเขียนทับ</small><input id="backup-file" type="file" accept="application/json,.json" /></label></div><section class="publish-card ${t.public_enabled ? 'is-live' : ''}" style="margin-top:28px"><div><span class="section-kicker">หน้าคะแนนสำหรับผู้ชม</span><h3>${t.public_enabled ? 'ตารางคะแนนเปิดให้ผู้ชมแล้ว' : 'พร้อมประกาศผลให้ผู้ชม'}</h3><p>${t.public_enabled ? 'ผู้ชมดูอันดับและผลล่าสุดได้ แต่ไม่สามารถแก้ไขข้อมูล' : 'เปิดการเผยแพร่จากหน้าตั้งค่าเมื่อข้อมูลพร้อม'}</p></div><div class="publish-actions"><button class="button primary" data-action="open-public" ${t.public_enabled ? '' : 'disabled'}>เปิดหน้าผู้ชม</button><button class="button secondary" data-action="copy-public" ${t.public_enabled ? '' : 'disabled'}>คัดลอกลิงก์</button></div></section><label class="share-link field full"><span>ลิงก์สำหรับผู้ชม</span><input readonly value="${escapeHtml(publicUrl)}" /></label>`;
}

function cleanImportedTitle(value, category) {
  const cleaned = String(value || '').replace(/^ประกาศรายชื่อผู้มีสิทธิ์แข่งขัน\s*/i, '').trim();
  return cleaned || `การแข่งขัน A-Math ${category || ''}`.trim();
}

function renderDocxImportModal() {
  const preview = state.docxPreview;
  if (state.docxLoading) return `<section class="docx-upload"><div class="loading-dot"></div><h3>กำลังอ่านตารางรายชื่อ</h3><p>ระบบกำลังแยกกลุ่มผู้แข่งขันและตรวจชื่อซ้ำจาก ${escapeHtml(state.docxSourceName)}</p></section>`;
  if (!preview) return `<section class="docx-upload"><div class="upload-mark">ไฟล์ Word (DOCX)</div><h3>เลือกไฟล์ประกาศรายชื่อผู้แข่งขัน</h3><p>ระบบรองรับตารางที่มีชื่อทีม ระดับชั้น ผู้แข่งขันคนที่ 1–2 และห้องเรียน ข้อมูลจะยังไม่ถูกบันทึกจนกว่าคุณจะตรวจสอบและยืนยัน</p><label class="file-drop"><input id="docx-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /><span>เลือกไฟล์ Word (.docx)</span><small>ขนาดไม่เกิน 8 เมกะไบต์ (MB)</small></label></section>`;
  const year = state.data?.tournament?.academic_year || String(new Date().getFullYear() + 543);
  return `<form data-form="commit-docx-import" class="docx-review"><div class="import-summary"><div><strong>${preview.team_count}</strong><span>ทีมที่อ่านได้</span></div><div><strong>${preview.groups.length}</strong><span>ทัวร์นาเมนต์ที่จะสร้าง</span></div><div class="${preview.warning_count ? 'has-warning' : ''}"><strong>${preview.warning_count}</strong><span>รายการที่ควรตรวจ</span></div></div><p class="notice info">ไฟล์: <strong>${escapeHtml(state.docxSourceName)}</strong> — ยกเลิกเครื่องหมายหน้าทีมที่ไม่ต้องการนำเข้า โดยระบบจะไม่เลือกแถวที่สงสัยว่าซ้ำไว้ให้</p>${preview.groups.map((group, groupIndex) => `<section class="import-group card"><header><label class="group-check"><input type="checkbox" name="group_${groupIndex}" checked /><span><strong>${escapeHtml(group.category)}</strong><small>${group.teams.length} ทีมจากตารางที่ ${group.table_index + 1}</small></span></label></header><div class="import-meta form-grid"><div class="field wide"><label>ชื่อทัวร์นาเมนต์</label><input name="name_${groupIndex}" value="${escapeHtml(cleanImportedTitle(group.title, group.category))}" /></div><div class="field"><label>ปีการศึกษา</label><input name="year_${groupIndex}" value="${escapeHtml(year)}" /></div><div class="field"><label>ประเภท</label><input name="category_${groupIndex}" value="${escapeHtml(group.category)}" /></div><div class="field wide"><label>โรงเรียน / ผู้จัด</label><input name="school_${groupIndex}" placeholder="ใช้กับทุกทีมในกลุ่มนี้" /></div><div class="field"><label>จังหวัด</label><input name="province_${groupIndex}" /></div><div class="field"><label>จำนวนเกมคิงออฟเดอะฮิลล์ (KOTH)</label><input type="number" min="1" max="12" name="rounds_${groupIndex}" value="5" /></div></div><div class="import-team-list"><table><thead><tr><th>นำเข้า</th><th>ทีม</th><th>ผู้แข่งขันคนที่ 1</th><th>ผู้แข่งขันคนที่ 2</th><th>สถานะ</th></tr></thead><tbody>${group.teams.map((team, teamIndex) => `<tr class="${team.suspected_duplicate ? 'is-warning' : ''}"><td><input type="checkbox" name="team_${groupIndex}_${teamIndex}" ${team.suspected_duplicate ? '' : 'checked'} aria-label="นำเข้า ${escapeHtml(team.name)}" /></td><td><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.level)}</small></td><td>${escapeHtml(team.member_1)}<small>${escapeHtml(team.member_1_room)}</small></td><td>${escapeHtml(team.member_2)}<small>${escapeHtml(team.member_2_room)}</small></td><td>${team.suspected_duplicate ? `<span class="duplicate-flag" title="${escapeHtml(team.duplicate_reason)}">ตรวจชื่อซ้ำ</span>` : '<span class="ready-flag">พร้อม</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}<div class="import-confirm"><div><strong>ระบบจะสร้างเป็นทัวร์นาเมนต์ใหม่</strong><span>ไม่แก้ไขหรือเขียนทับรายการที่มีอยู่</span></div><button class="button primary" type="submit">ยืนยันและสร้างทัวร์นาเมนต์</button></div></form>`;
}

function renderSettings() {
  const data = state.data;
  if (!data) return renderNoTournament();
  const t = data.tournament;
  const s = t.scoring;
  return `<form data-form="update-tournament" class="settings-form"><section class="card settings-section"><header><span class="settings-number">1</span><div><h3>ข้อมูลทัวร์นาเมนต์</h3><p>ชื่อ ปี สถานที่ และจำนวนเกมที่วางแผน</p></div></header><div class="form-grid">${tournamentForm('settings-embedded', t).replace(/^<form[^>]*>|<\/form>$/g, '')}</div></section><section class="card settings-section"><header><span class="settings-number">2</span><div><h3>กติกาคะแนน</h3><p>ค่าเริ่มต้นเหมาะกับการแข่งขันทั่วไป เปลี่ยนเมื่อกติกาของงานกำหนดไว้ต่างออกไป</p></div></header><div class="notice warning"><strong>การแก้กติกาจะคำนวณอันดับใหม่ทันที</strong><span> ผลการแข่งขันเดิมจะไม่หาย</span></div><div class="form-grid settings-fields"><div class="field"><label>ชนะ</label><input type="number" name="win_points" value="${s.win_points}" /><small>คะแนน</small></div><div class="field"><label>เสมอ</label><input type="number" name="draw_points" value="${s.draw_points}" /><small>คะแนน</small></div><div class="field"><label>แพ้</label><input type="number" name="loss_points" value="${s.loss_points}" /><small>คะแนน</small></div><div class="field"><label>พักการแข่งขัน (BYE)</label><input type="number" name="bye_points" value="${s.bye_points}" /><small>คะแนน</small></div><div class="field"><label>เพดานผลต่างมาตรฐาน</label><input type="number" min="0" name="default_diff_cap" value="${s.default_diff_cap}" /></div><div class="field wide"><label>เพดานแต่ละเกม</label><input name="round_caps" value="${escapeHtml(s.round_caps.join(', '))}" /><small>คั่นแต่ละเกมด้วยเครื่องหมายจุลภาค เช่น 250, 250, 250, 200</small></div><div class="field full"><label>เกณฑ์เรียงอันดับ</label><select name="ranking_order"><option value="points,capped_diff,points_for,wins,name" ${t.ranking_rules.join(',') === 'points,capped_diff,points_for,wins,name' ? 'selected' : ''}>คะแนน → ผลต่างคะแนน → แต้มได้ → จำนวนชนะ → ชื่อทีม</option><option value="points,capped_diff,wins,points_for,name" ${t.ranking_rules.join(',') === 'points,capped_diff,wins,points_for,name' ? 'selected' : ''}>คะแนน → ผลต่างคะแนน → จำนวนชนะ → แต้มได้ → ชื่อทีม</option></select></div></div></section><section class="card settings-section publish-setting"><header><span class="settings-number">3</span><div><h3>การเผยแพร่</h3><p>เปิดเมื่อพร้อมให้ผู้ชมดูอันดับและผลการแข่งขัน</p></div></header><label class="toggle-field"><input type="checkbox" name="public_enabled" ${t.public_enabled ? 'checked' : ''} /><span class="toggle-ui"></span><span><strong>เปิดตารางคะแนนสาธารณะ</strong><small>ผู้ชมดูได้อย่างเดียว ไม่สามารถแก้ไขข้อมูล</small></span></label></section><div class="settings-save"><button class="button primary" type="submit">บันทึกการเปลี่ยนแปลง</button><span>การตั้งค่ามีผลกับทัวร์นาเมนต์นี้เท่านั้น</span></div></form>`;
}

function renderAdmins() {
  const currentId = state.user?.id;
  const rows = state.admins.map((admin) => `<article class="admin-row card"><div class="admin-avatar">${escapeHtml((admin.display_name || admin.username).slice(0, 1).toUpperCase())}</div><div class="admin-identity"><div><strong>${escapeHtml(admin.display_name)}</strong>${admin.id === currentId ? '<span class="badge open">บัญชีของคุณ</span>' : ''}${admin.is_system ? '<span class="badge system">ผู้ดูแลหลัก</span>' : ''}</div><span>ชื่อผู้ใช้: ${escapeHtml(admin.username)}</span><small>${admin.is_system ? 'บัญชีหลักจากการตั้งค่าระบบ ไม่สามารถลบจากหน้านี้ได้' : `เพิ่มเมื่อ ${escapeHtml(new Date(admin.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}`}</small></div><div class="admin-actions"><button class="button danger-outline small" data-action="delete-admin" data-id="${escapeHtml(admin.id)}" data-name="${escapeHtml(admin.display_name)}" ${admin.is_system || admin.id === currentId ? 'disabled' : ''}>ลบผู้ดูแล</button></div></article>`).join('');
  return `<section class="admin-overview"><div><strong>${state.admins.length}</strong><span>บัญชีผู้ดูแลที่เข้าใช้งานได้</span></div><p>ผู้ดูแลทุกคนสามารถจัดการทัวร์นาเมนต์ ทีม ผลการแข่งขัน เอกสาร และบัญชีผู้ดูแลได้เท่ากัน</p></section><div class="admin-layout"><section class="admin-list"><div class="section-head"><div><span class="section-kicker">บัญชีที่ใช้งานได้</span><h3>รายชื่อผู้ดูแล</h3><p>บัญชีที่ถูกลบจะออกจากระบบทันทีและไม่สามารถเข้าสู่ระบบได้อีก</p></div></div>${rows || '<section class="card empty"><h3>ยังไม่มีบัญชีผู้ดูแล</h3></section>'}</section><section class="card admin-create"><span class="section-kicker">เพิ่มผู้ดูแล</span><h3>สร้างบัญชีใหม่</h3><p>ตั้งชื่อผู้ใช้ที่จำง่ายและส่งรหัสผ่านให้เจ้าของบัญชีผ่านช่องทางส่วนตัว</p><form data-form="create-admin" class="form-grid"><div class="field full"><label>ชื่อที่ใช้แสดง</label><input name="display_name" required maxlength="120" placeholder="เช่น ครูจินตนา" /></div><div class="field full"><label>ชื่อผู้ใช้ (Username)</label><input name="username" required minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9._-]{2,39}" autocomplete="off" placeholder="เช่น jintana" /><small>ใช้ตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง</small></div><div class="field full"><label>รหัสผ่าน</label><input type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="อย่างน้อย 10 ตัวอักษร" /></div><div class="field full"><label>ยืนยันรหัสผ่าน</label><input type="password" name="confirm_password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="พิมพ์รหัสผ่านเดิมอีกครั้ง" /></div><div class="field full"><button class="button primary" type="submit">เพิ่มผู้ดูแล</button></div></form><p class="admin-security-note">รหัสผ่านจะถูกแปลงเป็นค่าที่อ่านย้อนกลับไม่ได้ก่อนจัดเก็บ และจะไม่แสดงบนหน้าจอนี้ภายหลัง</p></section></div>`;
}

function renderView() {
  switch (state.view) {
    case 'tournaments': return renderTournaments();
    case 'teams': return renderTeams();
    case 'koth': return renderKoth();
    case 'standings': return renderStandings();
    case 'reports': return renderReports();
    case 'settings': return renderSettings();
    case 'admins': return renderAdmins();
    default: return renderDashboard();
  }
}

function renderModal() {
  if (!state.modal) return '';
  const body = state.modal.kind === 'import-docx' ? renderDocxImportModal() : state.modal.body;
  const modalClass = state.modal.kind === 'import-docx' ? 'modal-wide' : state.modal.kind === 'mobile-more' ? 'mobile-sheet' : '';
  return `<div class="modal-backdrop ${state.modal.kind === 'mobile-more' ? 'mobile-sheet-backdrop' : ''}" data-action="close-modal-bg"><section class="modal ${modalClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.modal.title)}"><header class="modal-header"><h3>${escapeHtml(state.modal.title)}</h3><button class="icon-button" data-action="close-modal" aria-label="ปิด">×</button></header><div class="modal-body">${body}</div></section></div>`;
}

function renderToasts() {
  return `<div class="toast-stack">${state.toasts.map((toast) => `<div class="toast ${escapeHtml(toast.type)}">${escapeHtml(toast.message)}</div>`).join('')}</div>`;
}

function renderLogin() {
  app.innerHTML = `<main class="login-screen"><section class="login-intro"><div class="brand-mark">A<span>MATH</span></div><span class="eyebrow">ระบบจัดการแข่งขัน</span><h1>จัดการแข่งขันให้ไหลลื่น<br>ตั้งแต่ทีมแรกถึงแชมป์</h1><p>ระบบจัด A-Math แบบคิงออฟเดอะฮิลล์ (King of the Hill) ที่พาผู้จัดทำงานตามลำดับ ลดการหลงหน้าและลดความผิดพลาดระหว่างแข่งขัน</p><div class="login-points"><span><b>1</b> เตรียมทีม</span><span><b>2</b> แข่งขัน</span><span><b>3</b> ประกาศผล</span></div></section><section class="login-card"><div><span class="eyebrow">ผู้จัดการแข่งขัน</span><h2>เข้าสู่ระบบ</h2><p>กรอกชื่อผู้ใช้และรหัสผ่านของผู้ดูแล</p></div><form data-form="login"><div class="field full"><label>ชื่อผู้ใช้</label><input name="username" required autofocus autocomplete="username" value="admin" placeholder="กรอกชื่อผู้ใช้" /></div><div class="field full"><label>รหัสผ่าน</label><input type="password" name="password" required autocomplete="current-password" placeholder="กรอกรหัสผ่านผู้ดูแล" /></div><button class="button primary" type="submit">เข้าสู่ศูนย์ควบคุม <span aria-hidden="true">→</span></button></form><details class="login-help"><summary>เพิ่งติดตั้งระบบครั้งแรก?</summary><p>บัญชีหลักใช้ชื่อผู้ใช้ <strong>admin</strong> และรหัสผ่านจากค่า <code>ADMIN_PASSWORD</code> พร้อมกำหนดกุญแจรักษาความปลอดภัย <code>AUTH_SECRET</code> บน Cloudflare (ระบบให้บริการเว็บ)</p></details></section></main>`;
}

function render() {
  if (!state.authenticated) { renderLogin(); return; }
  const tournament = state.data?.tournament;
  app.innerHTML = `<div class="app-shell">${renderMobileHeader(tournament)}<aside class="sidebar"><div class="brand"><div class="brand-mark">A<span>MATH</span></div><div><h1>ศูนย์จัดการแข่งขัน</h1><small>คิงออฟเดอะฮิลล์ (KOTH)</small></div></div><div class="nav-caption">ลำดับการทำงาน</div><nav class="nav-list">${navItems.map(([id, label, number]) => `<button class="nav-link ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}><span>${number}</span>${label}</button>`).join('')}</nav><div class="nav-caption utility-caption">จัดการระบบ</div><nav class="nav-list utility-nav">${utilityNavItems.map(([id, label]) => `<button class="nav-link ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav><div class="sidebar-footer">${tournament ? `<span class="sidebar-status"><i class="${escapeHtml(tournament.status)}"></i>${tournament.status === 'draft' ? 'กำลังเตรียมรายการ' : tournament.status === 'open' ? 'กำลังแข่งขัน' : 'รายการเสร็จสิ้น'}</span>` : ''}<div class="sidebar-user"><strong>${escapeHtml(state.user?.display_name || 'ผู้ดูแล')}</strong><span>@${escapeHtml(state.user?.username || 'admin')}</span></div><button data-action="logout">ออกจากระบบ</button></div></aside><main class="main">${pageHeading()}${renderView()}</main>${renderMobileNavigation()}</div>${renderModal()}${renderToasts()}`;
}

function editTeamModal(team) {
  const participant = (number) => `<section class="participant-editor field full"><h4>ผู้แข่งขันคนที่ ${number}</h4><div class="form-grid"><div class="field wide"><label>ชื่อ–นามสกุล</label><input name="member_${number}" value="${escapeHtml(team[`member_${number}`])}" /></div><div class="field"><label>ระดับชั้น / ห้อง</label><input name="member_${number}_level" value="${escapeHtml(team[`member_${number}_level`])}" /></div><div class="field"><label>เลขประจำตัวนักเรียน</label><input name="member_${number}_student_id" value="${escapeHtml(team[`member_${number}_student_id`])}" /></div><div class="field"><label>เบอร์โทรศัพท์</label><input name="member_${number}_phone" value="${escapeHtml(team[`member_${number}_phone`])}" /></div></div></section>`;
  state.modal = { title: `แก้ไขทีม: ${team.name}`, body: `<form data-form="edit-team" data-team-id="${escapeHtml(team.id)}" class="form-grid"><div class="field"><label>ลำดับเริ่มต้น (Seed)</label><input type="number" min="1" name="seed" value="${team.seed}" /></div><div class="field"><label>รหัสทีม</label><input name="code" value="${escapeHtml(team.code)}" /></div><div class="field wide"><label>ชื่อทีม *</label><input name="name" required value="${escapeHtml(team.name)}" /></div><div class="field wide"><label>โรงเรียน / สังกัด</label><input name="school" value="${escapeHtml(team.school)}" /></div><div class="field"><label>จังหวัด</label><input name="province" value="${escapeHtml(team.province)}" /></div>${participant(1)}${participant(2)}<div class="field"><label>ครูผู้ควบคุม</label><input name="coach" value="${escapeHtml(team.coach)}" /></div><div class="field wide"><label>ข้อมูลติดต่อทีม</label><input name="contact" value="${escapeHtml(team.contact)}" /></div><div class="field full"><label>หมายเหตุ</label><textarea name="notes">${escapeHtml(team.notes)}</textarea></div><div class="field full"><button class="button primary" type="submit">บันทึกข้อมูลทีม</button></div></form>` };
  render();
}

function tournamentModal() {
  state.modal = { title: 'สร้างรายการแข่งขันใหม่', body: tournamentForm('create-tournament') };
  render();
}

function deleteTournamentModal(tournament) {
  state.modal = {
    title: 'ลบทัวร์นาเมนต์',
    body: `<form data-form="delete-tournament" data-tournament-id="${escapeHtml(tournament.id)}" class="delete-tournament-form"><div class="delete-warning"><span aria-hidden="true">!</span><div><strong>ข้อมูลทั้งหมดจะถูกลบถาวร</strong><p>รายชื่อทีม คู่แข่งขัน ผลคะแนน และการตั้งค่าของ “${escapeHtml(tournament.name)}” จะไม่สามารถกู้คืนได้</p></div></div><div class="field full"><label>พิมพ์ชื่อทัวร์นาเมนต์เพื่อยืนยัน</label><input name="confirm_name" required autocomplete="off" placeholder="${escapeHtml(tournament.name)}" /><small>ต้องพิมพ์ให้ตรงกับ <strong>${escapeHtml(tournament.name)}</strong> ทุกตัวอักษร</small></div><div class="button-row delete-confirm-actions"><button class="button danger" type="submit">ยืนยันการลบถาวร</button><button class="button ghost" data-action="close-modal" type="button">ยกเลิก</button></div></form>`
  };
  render();
}

function pairingModal(roundId) {
  const round = state.data?.rounds.find((item) => item.id === roundId);
  if (!round) return;
  const teams = state.data.teams.filter((team) => team.is_active).sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name, 'th'));
  const optionList = (selected, blank = false) => `${blank ? '<option value="">พักการแข่งขัน (BYE) — ไม่มีคู่แข่งขัน</option>' : ''}${teams.map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === selected ? 'selected' : ''}>${escapeHtml(team.code)} — ${escapeHtml(team.name)}</option>`).join('')}`;
  state.modal = { title: `แก้ไขคู่ · ${round.title}`, body: `<p class="notice info">คู่ที่ยังไม่ยืนยันผลสามารถแก้ไขได้ทันที ส่วนโต๊ะที่ยืนยันผลแล้วจะถูกล็อกไว้เพื่อรักษาประวัติ ทีมหนึ่งใช้ได้เพียงครั้งเดียวในรอบเดียวกัน และพักการแข่งขัน (BYE) ใช้ได้ 1 ทีมเมื่อมีจำนวนทีมเป็นคี่</p><form data-form="save-pairings" data-round-id="${escapeHtml(round.id)}"><div class="pair-editor">${round.matches.map((match, index) => `<div class="pair-edit-row"><strong>โต๊ะ ${index + 1}</strong><select name="a_${index}" ${match.status === 'final' && !match.is_bye ? 'disabled' : ''}>${optionList(match.team_a_id)}</select><span>พบ</span><select name="b_${index}" ${match.status === 'final' && !match.is_bye ? 'disabled' : ''}>${optionList(match.team_b_id, true)}</select>${match.status === 'final' && !match.is_bye ? `<input type="hidden" name="a_${index}" value="${escapeHtml(match.team_a_id)}" /><input type="hidden" name="b_${index}" value="${escapeHtml(match.team_b_id || '')}" />` : ''}</div>`).join('')}</div><input type="hidden" name="count" value="${round.matches.length}" /><div class="button-row" style="margin-top:18px"><button class="button primary" type="submit">บันทึกคู่แข่งขัน</button><button class="button ghost" data-action="close-modal" type="button">ยกเลิก</button></div></form>` };
  render();
}

function openDocxImport() {
  state.docxPreview = null;
  state.docxSourceName = '';
  state.modal = { kind: 'import-docx', title: 'นำเข้ารายชื่อผู้แข่งขันจาก Word' };
  render();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ไม่สามารถโหลดแม่แบบ Master Score Card ได้'));
    image.src = src;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('สร้างภาพเอกสารไม่สำเร็จ')), 'image/jpeg', 0.95));
}

async function loadDocumentFonts() {
  if (!document.fonts?.load) return;
  const sample = 'กขค A-Math 123';
  const [regular, bold] = await Promise.all([
    document.fonts.load('400 24px "TH Sarabun PSK"', sample),
    document.fonts.load('700 24px "TH Sarabun PSK"', sample)
  ]);
  if (!regular.length || !bold.length) throw new Error('โหลดฟอนต์ TH Sarabun PSK สำหรับเอกสารไม่สำเร็จ');
}

function drawFittedText(context, value, x, y, maxWidth, options = {}) {
  const text = String(value ?? '').trim();
  if (!text) return;
  const align = options.align || 'left';
  const weight = options.weight || 700;
  let size = options.size || 17;
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.fillStyle = options.color || '#073785';
  do {
    context.font = `${weight} ${size}px "TH Sarabun PSK", "IBM Plex Sans Thai", sans-serif`;
    if (context.measureText(text).width <= maxWidth || size <= 9) break;
    size -= 1;
  } while (size > 8);
  context.fillText(text, x, y, maxWidth);
}

function teamMatchHistory(team) {
  const scoring = state.data.tournament.scoring;
  let accumulatedPoints = 0;
  let accumulatedDiff = 0;
  return state.data.rounds.filter((round) => round.phase === 'koth').map((round) => {
    const match = round.matches.find((item) => item.team_a_id === team.id || item.team_b_id === team.id);
    if (!match) return null;
    const sideA = match.team_a_id === team.id;
    const opponent = sideA ? match.team_b : match.team_a;
    const final = match.status === 'final';
    const storedResult = final ? (sideA ? match.result_a : match.result_b) : '';
    const result = match.is_bye ? 'BYE' : storedResult === 'D' ? 'T' : storedResult;
    const scoreFor = final ? Number(sideA ? match.score_a : match.score_b) : null;
    const scoreAgainst = final ? Number(sideA ? match.score_b : match.score_a) : null;
    const diff = final && !match.is_bye ? scoreFor - scoreAgainst : 0;
    const points = result === 'W' ? scoring.win_points : result === 'T' ? scoring.draw_points : result === 'L' ? scoring.loss_points : result === 'BYE' ? scoring.bye_points : 0;
    if (final) {
      accumulatedPoints += Number(points || 0);
      accumulatedDiff += diff;
    }
    return {
      table: match.table_no,
      round: round.round_number,
      result,
      points: final ? accumulatedPoints : '',
      scoreFor: final && !match.is_bye ? scoreFor : '',
      scoreAgainst: final && !match.is_bye ? scoreAgainst : '',
      diff: final && !match.is_bye ? (diff > 0 ? `+${diff}` : String(diff)) : '',
      accumulatedDiff: final ? (accumulatedDiff > 0 ? `+${accumulatedDiff}` : String(accumulatedDiff)) : '',
      opponentName: match.is_bye ? 'BYE' : opponent?.name || '',
      opponentSchool: match.is_bye ? '' : opponent?.school || '',
      opponentCode: match.is_bye ? '' : opponent?.code || '',
      starter: match.starter_team_id ? (match.starter_team_id === team.id ? '1' : '2') : ''
    };
  }).filter(Boolean).slice(0, 12);
}

function drawMasterCard(context, template, team, mode) {
  context.clearRect(0, 0, 1536, 1024);
  context.drawImage(template, 0, 0, 1536, 1024);
  const ranking = state.data.standings.find((row) => row.id === team.id)?.rank;
  drawFittedText(context, team.code, 1293, 105, 120, { align: 'center', size: 25 });
  drawFittedText(context, mode === 'complete' ? ranking : team.seed, 1435, 105, 110, { align: 'center', size: 25 });

  drawFittedText(context, team.member_1, 265, 263, 285, { size: 22 });
  drawFittedText(context, team.member_1_level || team.member_1_room, 615, 263, 118, { size: 20 });
  drawFittedText(context, team.school, 235, 310, 320, { size: 20 });
  drawFittedText(context, team.province, 610, 310, 120, { size: 20 });
  drawFittedText(context, team.member_1_student_id, 305, 357, 200, { size: 19 });
  drawFittedText(context, team.member_1_phone, 600, 357, 135, { size: 19 });

  drawFittedText(context, team.member_2, 882, 263, 330, { size: 22 });
  drawFittedText(context, team.member_2_level || team.member_2_room, 1260, 263, 120, { size: 20 });
  drawFittedText(context, team.school, 850, 310, 370, { size: 20 });
  drawFittedText(context, team.province, 1255, 310, 135, { size: 20 });
  drawFittedText(context, team.member_2_student_id, 930, 357, 235, { size: 19 });
  drawFittedText(context, team.member_2_phone, 1250, 357, 140, { size: 19 });

  if (mode !== 'complete') return;
  const columns = [66, 153, 223, 321, 453, 574, 688, 804, 951, 1147, 1328, 1455];
  teamMatchHistory(team).forEach((match, index) => {
    const y = 503 + index * 38.7;
    const values = [match.table, match.round, match.result, match.points, match.scoreFor, match.scoreAgainst, match.diff, match.accumulatedDiff, match.opponentName, match.opponentSchool, match.opponentCode, match.starter];
    const widths = [70, 64, 50, 115, 105, 105, 100, 105, 160, 198, 128, 88];
    values.forEach((value, columnIndex) => drawFittedText(context, value, columns[columnIndex], y, widths[columnIndex], { align: 'center', size: columnIndex >= 8 ? 16 : 18, weight: columnIndex >= 8 ? 400 : 700 }));
  });
}

async function exportMasterCards(mode) {
  if (!state.data) return;
  const teams = state.data.teams.filter((team) => team.is_active);
  if (!teams.length) { notify('ยังไม่มีทีมสำหรับสร้าง Master Score Card', 'error'); return; }
  if (!window.PDFLib?.PDFDocument) { notify('เครื่องมือสร้าง PDF ยังโหลดไม่สำเร็จ กรุณารีเฟรชหน้า', 'error'); return; }
  notify(`กำลังสร้าง Master Score Card ${teams.length} หน้า…`);
  try {
    await loadDocumentFonts();
    const template = await loadImage('/assets/master-score-card.png');
    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    const pdf = await window.PDFLib.PDFDocument.create();
    for (const team of teams) {
      drawMasterCard(context, template, team, mode);
      const blob = await canvasBlob(canvas);
      const image = await pdf.embedJpg(await blob.arrayBuffer());
      const pageWidth = 841.89;
      const pageHeight = 595.28;
      const imageHeight = pageWidth * (canvas.height / canvas.width);
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: (pageHeight - imageHeight) / 2, width: pageWidth, height: imageHeight });
    }
    pdf.setTitle(`Master Score Card - ${state.data.tournament.name}`);
    pdf.setSubject('A-Math Master Score Card');
    pdf.setCreator('ระบบจัดการแข่งขัน A-Math');
    const bytes = await pdf.save();
    download(`Master_Score_Card_${slug(state.data.tournament.name)}_${mode === 'complete' ? 'results' : 'blank'}.pdf`, bytes, 'application/pdf');
    notify(`สร้าง Master Score Card ${teams.length} หน้าเรียบร้อย`, 'success');
  } catch (error) {
    notify(`สร้าง PDF ไม่สำเร็จ: ${error.message}`, 'error');
  }
}

async function handleAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-modal-bg' && event.target !== button) return;
  if (action === 'nav') {
    state.modal = null;
    state.view = button.dataset.view;
    if (state.view === 'admins') {
      try { await loadAdmins(); } catch (error) { notify(error.message, 'error'); return; }
    }
    render();
    return;
  }
  if (action === 'open-mobile-more') { openMobileMore(); return; }
  if (action === 'mobile-nav') {
    state.modal = null;
    state.view = button.dataset.view;
    if (state.view === 'admins') {
      try { await loadAdmins(); } catch (error) { notify(error.message, 'error'); return; }
    }
    render();
    return;
  }
  if (action === 'go-tournaments') { state.view = 'tournaments'; render(); return; }
  if (action === 'go-teams') { state.view = 'teams'; render(); return; }
  if (action === 'go-koth') { state.view = 'koth'; render(); return; }
  if (action === 'go-standings') { state.view = 'standings'; render(); return; }
  if (action === 'new-tournament') { tournamentModal(); return; }
  if (action === 'delete-tournament') {
    const tournament = state.tournaments.find((item) => item.id === button.dataset.id);
    if (tournament) deleteTournamentModal(tournament);
    return;
  }
  if (action === 'delete-admin') {
    if (!confirm(`ต้องการลบผู้ดูแล “${button.dataset.name || ''}” ใช่หรือไม่? บัญชีนี้จะออกจากระบบและเข้าใช้งานไม่ได้ทันที`)) return;
    try {
      const response = await api(`/api/admins/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      await loadAdmins();
      render();
      notify(`ลบผู้ดูแล “${response.deleted.display_name}” แล้ว`, 'success');
    } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'import-docx') { openDocxImport(); return; }
  if (action === 'export-master-card') { await exportMasterCards(button.dataset.mode || 'blank'); return; }
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
    if (!confirm(stage === 'semifinal' ? 'สร้างรอบรองชนะเลิศจาก 4 อันดับแรก (Top 4) ของตารางคะแนนปัจจุบันใช่หรือไม่?' : 'สร้างรอบชิงชนะเลิศและชิงอันดับ 3 ใช่หรือไม่?')) return;
    try { await api(`/api/tournaments/${state.selectedId}/finals`, { method: 'POST', body: JSON.stringify({ stage }) }); await loadTournament(); render(); notify('สร้างรอบชิงเรียบร้อย', 'success'); } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (action === 'export-backup') { try { const data = await api(`/api/tournaments/${state.selectedId}/export`); download(`KOTH_${slug(state.data.tournament.name)}_backup.json`, JSON.stringify(data, null, 2), 'application/json'); notify('ดาวน์โหลดข้อมูลสำรองแล้ว', 'success'); } catch (error) { notify(error.message, 'error'); } return; }
  if (action === 'export-csv') { exportStandingsCSV(); return; }
  if (action === 'open-public') { window.open(`${location.origin}${location.pathname}?public=${encodeURIComponent(state.data.tournament.code)}`, '_blank', 'noopener'); return; }
  if (action === 'copy-public') { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?public=${encodeURIComponent(state.data.tournament.code)}`); notify('คัดลอกลิงก์แล้ว', 'success'); } catch { notify('คัดลอกลิงก์ไม่สำเร็จ กรุณาคัดลอกจากช่องข้อความ', 'error'); } return; }
  if (action === 'print') { window.print(); return; }
  if (action === 'close-modal' || action === 'close-modal-bg') { state.modal = null; render(); return; }
  if (action === 'logout') { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } finally { state.authenticated = false; state.user = null; state.admins = []; state.data = null; state.modal = null; render(); } }
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
      const response = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
      state.authenticated = true; state.user = response.user; await refreshAll(); notify('เข้าสู่ระบบแล้ว', 'success'); return;
    }
    if (kind === 'create-admin') {
      if (values.password !== values.confirm_password) throw new Error('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
      const response = await api('/api/admins', {
        method: 'POST',
        body: JSON.stringify({ username: values.username, display_name: values.display_name, password: values.password })
      });
      form.reset();
      await loadAdmins();
      render();
      notify(`เพิ่มผู้ดูแล “${response.admin.display_name}” แล้ว`, 'success');
      return;
    }
    if (kind === 'create-tournament') {
      const response = await api('/api/tournaments', { method: 'POST', body: JSON.stringify(values) });
      state.modal = null; setSelected(response.tournament.id); state.view = 'dashboard'; await refreshAll(); notify('สร้างรายการแข่งขันแล้ว', 'success'); return;
    }
    if (kind === 'delete-tournament') {
      const tournamentId = form.dataset.tournamentId;
      const tournament = state.tournaments.find((item) => item.id === tournamentId);
      if (!tournament) throw new Error('ไม่พบทัวร์นาเมนต์ที่ต้องการลบ');
      const response = await api(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm_name: values.confirm_name })
      });
      if (state.selectedId === tournamentId) setSelected('');
      state.modal = null;
      state.data = null;
      state.view = 'tournaments';
      await refreshAll();
      notify(`ลบทัวร์นาเมนต์ “${response.deleted.name}” แล้ว`, 'success');
      return;
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
    if (kind === 'commit-docx-import') {
      const groups = state.docxPreview.groups.map((group, groupIndex) => {
        if (!form.querySelector(`[name="group_${groupIndex}"]`)?.checked) return null;
        const teams = group.teams.filter((_, teamIndex) => form.querySelector(`[name="team_${groupIndex}_${teamIndex}"]`)?.checked);
        if (!teams.length) return null;
        return {
          name: values[`name_${groupIndex}`],
          academic_year: values[`year_${groupIndex}`],
          category: values[`category_${groupIndex}`],
          school: values[`school_${groupIndex}`],
          organizer: values[`school_${groupIndex}`],
          province: values[`province_${groupIndex}`],
          rounds_planned: values[`rounds_${groupIndex}`],
          teams
        };
      }).filter(Boolean);
      if (!groups.length) throw new Error('กรุณาเลือกอย่างน้อยหนึ่งทีมสำหรับนำเข้า');
      const response = await api('/api/documents/docx/commit', { method: 'POST', body: JSON.stringify({ source_name: state.docxSourceName, groups }) });
      state.modal = null;
      state.docxPreview = null;
      setSelected(response.created[0].id);
      state.view = 'dashboard';
      await refreshAll();
      notify(`สร้าง ${response.created.length} ทัวร์นาเมนต์จาก Word เรียบร้อย`, 'success');
      return;
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
  if (event.target.id === 'docx-file' && event.target.files?.[0]) {
    const file = event.target.files[0];
    if (!file.name.toLowerCase().endsWith('.docx')) { notify('กรุณาเลือกไฟล์ Word .docx', 'error'); return; }
    state.docxSourceName = file.name;
    state.docxLoading = true;
    render();
    try {
      const response = await fetch('/api/documents/docx/preview', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'อ่านไฟล์ Word ไม่สำเร็จ');
      state.docxPreview = payload.preview;
    } catch (error) {
      state.docxPreview = null;
      notify(error.message, 'error');
    } finally {
      state.docxLoading = false;
      render();
    }
    return;
  }
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
    state.user = auth.user || null;
    if (state.authenticated) await refreshAll(); else render();
  } catch (error) {
    state.authenticated = false;
    render();
  }
}

bootstrap();
