import {
  DEFAULT_RANKING_RULES,
  DEFAULT_SCORING,
  computeRankings,
  makeKothPairings,
  normalizeRules,
  normalizeScoring,
  parseJson,
  slugify,
  toInt
} from './core.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function error(message, status = 400, details = undefined) {
  return json({ ok: false, error: message, details }, status);
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function safeString(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

async function bodyJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('กรุณาส่งข้อมูลในรูปแบบ JSON');
  return request.json();
}

function cookieMap(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToText(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) mismatch |= (a[i % a.length] || 0) ^ (b[i % b.length] || 0);
  return mismatch === 0;
}

async function makeSession(env) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ role: 'admin', exp: Date.now() + SESSION_TTL_SECONDS * 1000 })));
  const signature = await hmac(payload, env.AUTH_SECRET);
  return `${payload}.${signature}`;
}

async function verifySession(request, env) {
  if (!env.AUTH_SECRET) return false;
  const token = cookieMap(request).session;
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = await hmac(payload, env.AUTH_SECRET);
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(base64UrlToText(payload));
    return data.role === 'admin' && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

async function requireAuth(request, env) {
  if (!(await verifySession(request, env))) return error('กรุณาเข้าสู่ระบบผู้ดูแล', 401);
  return null;
}

function asTournament(row) {
  if (!row) return null;
  return {
    ...row,
    public_enabled: Number(row.public_enabled) === 1,
    rounds_planned: toInt(row.rounds_planned, 5),
    scoring: normalizeScoring(parseJson(row.scoring_json, DEFAULT_SCORING)),
    ranking_rules: normalizeRules(parseJson(row.ranking_rules_json, DEFAULT_RANKING_RULES))
  };
}

function asTeam(row) {
  return { ...row, is_active: Number(row.is_active) === 1, seed: toInt(row.seed, 9999) };
}

function asRound(row) {
  return { ...row, round_number: toInt(row.round_number), diff_cap: toInt(row.diff_cap), };
}

async function getTournament(env, tournamentId) {
  const row = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(tournamentId).first();
  return asTournament(row);
}

async function ensureTournament(env, tournamentId) {
  const tournament = await getTournament(env, tournamentId);
  if (!tournament) throw new Error('ไม่พบรายการแข่งขันนี้');
  if (tournament.status === 'archived') throw new Error('รายการนี้ถูกเก็บถาวรแล้ว');
  return tournament;
}

async function uniqueCode(env, suggested) {
  const base = slugify(suggested);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const code = suffix ? `${base}-${suffix + 1}` : base;
    const existing = await env.DB.prepare('SELECT id FROM tournaments WHERE code = ?').bind(code).first();
    if (!existing) return code;
  }
  return `${base}-${id().slice(0, 6)}`;
}

async function audit(env, tournamentId, action, detail = {}) {
  await env.DB.prepare('INSERT INTO audit_logs (id, tournament_id, action, detail_json) VALUES (?, ?, ?, ?)')
    .bind(id(), tournamentId || null, action, JSON.stringify(detail)).run();
}

async function getBundle(env, tournamentId) {
  const tournament = await getTournament(env, tournamentId);
  if (!tournament) return null;
  const [teamQuery, roundQuery, matchQuery] = await Promise.all([
    env.DB.prepare('SELECT * FROM teams WHERE tournament_id = ? ORDER BY is_active DESC, seed ASC, name COLLATE NOCASE ASC').bind(tournamentId).all(),
    env.DB.prepare('SELECT * FROM rounds WHERE tournament_id = ? ORDER BY CASE phase WHEN \'koth\' THEN 1 WHEN \'finals-semifinal\' THEN 2 ELSE 3 END, round_number ASC').bind(tournamentId).all(),
    env.DB.prepare(`SELECT m.*, r.tournament_id, r.phase, r.round_number, r.title AS round_title, r.diff_cap AS round_diff_cap
      FROM matches m JOIN rounds r ON r.id = m.round_id
      WHERE r.tournament_id = ?
      ORDER BY CASE r.phase WHEN 'koth' THEN 1 WHEN 'finals-semifinal' THEN 2 ELSE 3 END, r.round_number ASC, m.table_no ASC`).bind(tournamentId).all()
  ]);
  const teams = teamQuery.results.map(asTeam);
  const rounds = roundQuery.results.map(asRound);
  const matches = matchQuery.results.map((match) => ({ ...match, is_bye: Number(match.is_bye) === 1 }));
  const standings = computeRankings({ teams, rounds, matches, scoring: tournament.scoring, rules: tournament.ranking_rules });
  return { tournament, teams, rounds, matches, standings };
}

function groupRounds(bundle) {
  const teamMap = new Map(bundle.teams.map((team) => [team.id, team]));
  return bundle.rounds.map((round) => ({
    ...round,
    matches: bundle.matches.filter((match) => match.round_id === round.id).map((match) => ({
      ...match,
      team_a: teamMap.get(match.team_a_id) || null,
      team_b: teamMap.get(match.team_b_id) || null,
      winner_team: teamMap.get(match.winner_team_id) || null
    }))
  }));
}

async function refreshRoundStatus(env, roundId) {
  const states = await env.DB.prepare('SELECT status FROM matches WHERE round_id = ?').bind(roundId).all();
  const complete = states.results.length > 0 && states.results.every((match) => match.status === 'final');
  await env.DB.prepare('UPDATE rounds SET status = ?, updated_at = ? WHERE id = ?')
    .bind(complete ? 'completed' : 'open', now(), roundId).run();
  return complete ? 'completed' : 'open';
}

function validateTeamInput(input) {
  const name = safeString(input.name, 120);
  if (!name) throw new Error('กรุณาระบุชื่อทีม');
  return {
    code: safeString(input.code, 24),
    name,
    school: safeString(input.school, 160),
    member_1: safeString(input.member_1, 120),
    member_2: safeString(input.member_2, 120),
    coach: safeString(input.coach, 120),
    contact: safeString(input.contact, 160),
    notes: safeString(input.notes, 500),
    seed: Math.max(1, toInt(input.seed, 9999))
  };
}

async function createTournament(request, env) {
  const input = await bodyJson(request);
  const name = safeString(input.name, 160);
  if (!name) return error('กรุณาตั้งชื่อรายการแข่งขัน');
  const tournamentId = id();
  const code = await uniqueCode(env, input.code || name);
  const scoring = normalizeScoring(input.scoring);
  const rules = normalizeRules(input.ranking_rules);
  const roundsPlanned = Math.max(1, Math.min(99, toInt(input.rounds_planned, 5)));
  await env.DB.prepare(`INSERT INTO tournaments (
    id, code, name, academic_year, category, organizer, venue, starts_on, ends_on,
    rounds_planned, scoring_json, ranking_rules_json, status, public_enabled, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
    .bind(
      tournamentId, code, name,
      safeString(input.academic_year, 50), safeString(input.category || 'A-Math', 80),
      safeString(input.organizer, 160), safeString(input.venue, 160), safeString(input.starts_on, 20), safeString(input.ends_on, 20),
      roundsPlanned, JSON.stringify(scoring), JSON.stringify(rules), input.public_enabled ? 1 : 0, now()
    ).run();
  await audit(env, tournamentId, 'tournament.create', { name, code });
  return json({ ok: true, tournament: await getTournament(env, tournamentId) }, 201);
}

async function updateTournament(request, env, tournamentId) {
  const current = await ensureTournament(env, tournamentId);
  const input = await bodyJson(request);
  const scoring = input.scoring ? normalizeScoring(input.scoring) : current.scoring;
  const rules = input.ranking_rules ? normalizeRules(input.ranking_rules) : current.ranking_rules;
  const name = input.name === undefined ? current.name : safeString(input.name, 160);
  if (!name) return error('กรุณาตั้งชื่อรายการแข่งขัน');
  const status = ['draft', 'open', 'completed', 'archived'].includes(input.status) ? input.status : current.status;
  await env.DB.prepare(`UPDATE tournaments SET name = ?, academic_year = ?, category = ?, organizer = ?, venue = ?, starts_on = ?, ends_on = ?,
      rounds_planned = ?, scoring_json = ?, ranking_rules_json = ?, status = ?, public_enabled = ?, updated_at = ? WHERE id = ?`)
    .bind(
      name,
      input.academic_year === undefined ? current.academic_year : safeString(input.academic_year, 50),
      input.category === undefined ? current.category : safeString(input.category, 80),
      input.organizer === undefined ? current.organizer : safeString(input.organizer, 160),
      input.venue === undefined ? current.venue : safeString(input.venue, 160),
      input.starts_on === undefined ? current.starts_on : safeString(input.starts_on, 20),
      input.ends_on === undefined ? current.ends_on : safeString(input.ends_on, 20),
      input.rounds_planned === undefined ? current.rounds_planned : Math.max(1, Math.min(99, toInt(input.rounds_planned, current.rounds_planned))),
      JSON.stringify(scoring), JSON.stringify(rules), status,
      input.public_enabled === undefined ? (current.public_enabled ? 1 : 0) : (input.public_enabled ? 1 : 0),
      now(), tournamentId
    ).run();
  await audit(env, tournamentId, 'tournament.update', { name });
  return json({ ok: true, tournament: await getTournament(env, tournamentId) });
}

async function listTournaments(env) {
  const query = await env.DB.prepare(`SELECT t.*, 
    (SELECT COUNT(*) FROM teams x WHERE x.tournament_id = t.id AND x.is_active = 1) AS team_count,
    (SELECT COUNT(*) FROM rounds y WHERE y.tournament_id = t.id AND y.phase = 'koth') AS koth_round_count
    FROM tournaments t WHERE t.status != 'archived' ORDER BY t.created_at DESC`).all();
  return query.results.map((row) => ({ ...asTournament(row), team_count: toInt(row.team_count), koth_round_count: toInt(row.koth_round_count) }));
}

async function addTeam(request, env, tournamentId) {
  await ensureTournament(env, tournamentId);
  const input = validateTeamInput(await bodyJson(request));
  const maxSeed = await env.DB.prepare('SELECT MAX(seed) AS max_seed FROM teams WHERE tournament_id = ?').bind(tournamentId).first();
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM teams WHERE tournament_id = ?').bind(tournamentId).first();
  const code = input.code || `T${String(toInt(count?.total, 0) + 1).padStart(2, '0')}`;
  const teamId = id();
  try {
    await env.DB.prepare(`INSERT INTO teams (id, tournament_id, seed, code, name, school, member_1, member_2, coach, contact, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(teamId, tournamentId, input.seed === 9999 ? toInt(maxSeed?.max_seed, 0) + 1 : input.seed, code, input.name, input.school, input.member_1, input.member_2, input.coach, input.contact, input.notes, now()).run();
  } catch (cause) {
    return error('รหัสทีมซ้ำ กรุณาใช้รหัสอื่น', 409, String(cause));
  }
  await audit(env, tournamentId, 'team.create', { teamId, code, name: input.name });
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  return json({ ok: true, team: asTeam(team) }, 201);
}

async function updateTeam(request, env, tournamentId, teamId) {
  await ensureTournament(env, tournamentId);
  const existing = await env.DB.prepare('SELECT * FROM teams WHERE id = ? AND tournament_id = ?').bind(teamId, tournamentId).first();
  if (!existing) return error('ไม่พบทีมนี้', 404);
  const patch = await bodyJson(request);
  const input = validateTeamInput({ ...existing, ...patch });
  const code = input.code || existing.code;
  const isActive = patch.is_active === undefined ? Number(existing.is_active) : (patch.is_active ? 1 : 0);
  try {
    await env.DB.prepare(`UPDATE teams SET seed=?, code=?, name=?, school=?, member_1=?, member_2=?, coach=?, contact=?, notes=?, is_active=?, updated_at=? WHERE id=?`)
      .bind(input.seed, code, input.name, input.school, input.member_1, input.member_2, input.coach, input.contact, input.notes, isActive, now(), teamId).run();
  } catch (cause) {
    return error('รหัสทีมซ้ำ กรุณาใช้รหัสอื่น', 409, String(cause));
  }
  await audit(env, tournamentId, 'team.update', { teamId, code });
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  return json({ ok: true, team: asTeam(team) });
}


async function archiveTeam(env, tournamentId, teamId) {
  await ensureTournament(env, tournamentId);
  const team = await env.DB.prepare('SELECT id FROM teams WHERE id=? AND tournament_id=?').bind(teamId, tournamentId).first();
  if (!team) return error('ไม่พบทีมนี้', 404);
  const usage = await env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN m.status='final' THEN 1 ELSE 0 END) AS final_total
    FROM matches m JOIN rounds r ON r.id=m.round_id
    WHERE r.tournament_id=? AND (m.team_a_id=? OR m.team_b_id=?)`).bind(tournamentId, teamId, teamId).first();
  const matchCount = toInt(usage?.total);
  const finalCount = toInt(usage?.final_total);
  if (matchCount === 0) {
    await env.DB.prepare('DELETE FROM teams WHERE id=? AND tournament_id=?').bind(teamId, tournamentId).run();
    await audit(env, tournamentId, 'team.delete', { teamId });
    return json({ ok: true, mode: 'deleted' });
  }
  if (finalCount === 0) return error('ทีมนี้อยู่ในคู่แข่งขันที่ยังรอผล กรุณาแก้คู่แข่งขันของรอบนั้นก่อน แล้วจึงลบทีมนี้', 409);
  await env.DB.prepare('UPDATE teams SET is_active=0, updated_at=? WHERE id=? AND tournament_id=?').bind(now(), teamId, tournamentId).run();
  await audit(env, tournamentId, 'team.withdraw', { teamId, matchCount, finalCount });
  return json({ ok: true, mode: 'withdrawn' });
}

async function importTeams(request, env, tournamentId) {
  await ensureTournament(env, tournamentId);
  const payload = await bodyJson(request);
  const list = Array.isArray(payload.teams) ? payload.teams : [];
  if (!list.length) return error('ไม่พบรายชื่อทีมสำหรับนำเข้า');
  if (list.length > 300) return error('นำเข้าได้ครั้งละไม่เกิน 300 ทีม');
  const existingRows = await env.DB.prepare('SELECT code FROM teams WHERE tournament_id = ?').bind(tournamentId).all();
  const used = new Set(existingRows.results.map((x) => String(x.code).toLowerCase()));
  const statements = [];
  let seed = toInt((await env.DB.prepare('SELECT MAX(seed) AS max_seed FROM teams WHERE tournament_id = ?').bind(tournamentId).first())?.max_seed, 0);
  for (let index = 0; index < list.length; index += 1) {
    const team = validateTeamInput(list[index]);
    seed += 1;
    let code = team.code || `T${String(seed).padStart(2, '0')}`;
    const base = code;
    let suffix = 2;
    while (used.has(code.toLowerCase())) code = `${base}-${suffix++}`;
    used.add(code.toLowerCase());
    statements.push(env.DB.prepare(`INSERT INTO teams (id, tournament_id, seed, code, name, school, member_1, member_2, coach, contact, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), tournamentId, team.seed === 9999 ? seed : team.seed, code, team.name, team.school, team.member_1, team.member_2, team.coach, team.contact, team.notes, now()));
  }
  await env.DB.batch(statements);
  await audit(env, tournamentId, 'team.import', { count: statements.length });
  return json({ ok: true, imported: statements.length });
}

function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function generateKothRound(request, env, tournamentId) {
  const tournament = await ensureTournament(env, tournamentId);
  const input = await bodyJson(request);
  const bundle = await getBundle(env, tournamentId);
  const activeTeams = bundle.teams.filter((team) => team.is_active);
  if (activeTeams.length < 2) return error('ต้องมีอย่างน้อย 2 ทีมก่อนสร้างรอบแข่งขัน');
  const kothRounds = bundle.rounds.filter((round) => round.phase === 'koth');
  const unfinished = kothRounds.find((round) => round.status !== 'completed');
  if (unfinished) return error(`ยังมี ${unfinished.title} ที่บันทึกผลไม่ครบ`);
  const roundNumber = kothRounds.length + 1;
  const firstMethod = input.first_round_method || 'seed';
  let rankedTeams;
  if (!kothRounds.length) {
    rankedTeams = firstMethod === 'random'
      ? shuffle(activeTeams)
      : [...activeTeams].sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name, 'th'));
  } else {
    const rankMap = new Map(bundle.standings.map((row) => [row.team_id, row]));
    rankedTeams = activeTeams.slice().sort((a, b) => rankMap.get(a.id).rank - rankMap.get(b.id).rank);
  }
  const historyPairs = new Set(bundle.matches
    .filter((match) => match.phase === 'koth' && match.status === 'final' && !match.is_bye && match.team_b_id)
    .map((match) => [match.team_a_id, match.team_b_id].sort().join('|')));
  const byeCounts = new Map();
  for (const match of bundle.matches.filter((match) => match.phase === 'koth' && match.status === 'final' && match.is_bye)) {
    byeCounts.set(match.team_a_id, (byeCounts.get(match.team_a_id) || 0) + 1);
  }
  const pairing = makeKothPairings({ rankedTeams, historyPairs, byeCounts });
  const diffCap = Math.max(0, toInt(input.diff_cap, tournament.scoring.round_caps[roundNumber - 1] ?? tournament.scoring.default_diff_cap));
  const roundId = id();
  const roundTitle = safeString(input.title, 100) || `เกมที่ ${roundNumber}`;
  const statements = [
    env.DB.prepare(`INSERT INTO rounds (id, tournament_id, phase, round_number, title, diff_cap, status, pairing_note, updated_at)
      VALUES (?, ?, 'koth', ?, ?, ?, 'open', ?, ?)`)
      .bind(roundId, tournamentId, roundNumber, roundTitle, diffCap, pairing.warnings.join('\n'), now())
  ];
  pairing.pairings.forEach((pair, index) => {
    const isBye = pair.isBye ? 1 : 0;
    statements.push(env.DB.prepare(`INSERT INTO matches (id, round_id, table_no, team_a_id, team_b_id, score_a, score_b, result_a, result_b, winner_team_id, is_bye, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), roundId, index + 1, pair.teamA.id, pair.teamB?.id || null, isBye ? 0 : null, isBye ? 0 : null,
        isBye ? 'BYE' : '', '', isBye ? pair.teamA.id : null, isBye, isBye ? 'final' : 'pending', now()));
  });
  statements.push(env.DB.prepare('UPDATE tournaments SET status=?, updated_at=? WHERE id=?').bind('open', now(), tournamentId));
  await env.DB.batch(statements);
  await refreshRoundStatus(env, roundId);
  await audit(env, tournamentId, 'round.generate', { roundNumber, diffCap, firstMethod, warnings: pairing.warnings });
  return json({ ok: true, round_id: roundId, warnings: pairing.warnings, bundle: await getBundle(env, tournamentId) }, 201);
}

async function replaceRoundMatches(request, env, tournamentId, roundId) {
  await ensureTournament(env, tournamentId);
  const round = await env.DB.prepare('SELECT * FROM rounds WHERE id=? AND tournament_id=?').bind(roundId, tournamentId).first();
  if (!round) return error('ไม่พบรอบแข่งขัน', 404);
  const old = await env.DB.prepare('SELECT * FROM matches WHERE round_id=?').bind(roundId).all();
  const existing = old.results.sort((a, b) => toInt(a.table_no) - toInt(b.table_no));
  const hasFinalMatch = existing.some((match) => match.status === 'final' && Number(match.is_bye) !== 1);
  const input = await bodyJson(request);
  const list = Array.isArray(input.matches) ? input.matches : [];
  if (!list.length) return error('ต้องมีอย่างน้อย 1 คู่แข่งขัน');
  if (hasFinalMatch && list.length !== existing.length) return error('รอบนี้มีผลที่ยืนยันแล้ว จึงเพิ่มหรือลดจำนวนโต๊ะไม่ได้');
  const active = await env.DB.prepare('SELECT id FROM teams WHERE tournament_id=? AND is_active=1').bind(tournamentId).all();
  const lockedTeamIds = existing
    .filter((match) => match.status === 'final' && Number(match.is_bye) !== 1)
    .flatMap((match) => [match.team_a_id, match.team_b_id].filter(Boolean));
  const allowed = new Set([...active.results.map((row) => row.id), ...lockedTeamIds]);
  const seen = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const prior = existing[index];
    if (prior?.status === 'final' && Number(prior.is_bye) !== 1) {
      if (item.team_a_id !== prior.team_a_id || (item.team_b_id || null) !== (prior.team_b_id || null)) return error(`โต๊ะ ${prior.table_no} ยืนยันผลแล้ว จึงเปลี่ยนคู่ไม่ได้`);
    }
    if (!allowed.has(item.team_a_id)) return error('มีทีมที่ไม่อยู่ในรายการแข่งขัน');
    if (seen.has(item.team_a_id)) return error('ห้ามใช้ทีมซ้ำในรอบเดียวกัน');
    seen.add(item.team_a_id);
    if (item.team_b_id) {
      if (!allowed.has(item.team_b_id) || item.team_b_id === item.team_a_id || seen.has(item.team_b_id)) return error('คู่แข่งขันไม่ถูกต้องหรือมีทีมซ้ำ');
      seen.add(item.team_b_id);
    }
  }
  if (hasFinalMatch) {
    const statements = [];
    list.forEach((item, index) => {
      const prior = existing[index];
      if (!prior || (prior.status === 'final' && Number(prior.is_bye) !== 1)) return;
      const bye = !item.team_b_id;
      statements.push(env.DB.prepare(`UPDATE matches SET team_a_id=?, team_b_id=?, score_a=?, score_b=?, result_a=?, result_b=?, winner_team_id=?, is_bye=?, status=?, updated_at=? WHERE id=?`)
        .bind(item.team_a_id, item.team_b_id || null, bye ? 0 : null, bye ? 0 : null, bye ? 'BYE' : '', '', bye ? item.team_a_id : null, bye ? 1 : 0, bye ? 'final' : 'pending', now(), prior.id));
    });
    if (statements.length) await env.DB.batch(statements);
    await refreshRoundStatus(env, roundId);
    await audit(env, tournamentId, 'round.pairing.partial_update', { roundId, matchCount: list.length });
    return json({ ok: true, bundle: await getBundle(env, tournamentId) });
  }
  const statements = [env.DB.prepare('DELETE FROM matches WHERE round_id=?').bind(roundId)];
  list.forEach((item, index) => {
    const bye = !item.team_b_id;
    statements.push(env.DB.prepare(`INSERT INTO matches (id, round_id, table_no, team_a_id, team_b_id, score_a, score_b, result_a, winner_team_id, is_bye, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), roundId, index + 1, item.team_a_id, item.team_b_id || null, bye ? 0 : null, bye ? 0 : null, bye ? 'BYE' : '', bye ? item.team_a_id : null, bye ? 1 : 0, bye ? 'final' : 'pending', now()));
  });
  await env.DB.batch(statements);
  await refreshRoundStatus(env, roundId);
  await audit(env, tournamentId, 'round.pairing.update', { roundId, matchCount: list.length });
  return json({ ok: true, bundle: await getBundle(env, tournamentId) });
}

async function updateMatch(request, env, matchId) {
  const input = await bodyJson(request);
  const match = await env.DB.prepare(`SELECT m.*, r.id AS r_id, r.tournament_id, r.phase FROM matches m JOIN rounds r ON r.id=m.round_id WHERE m.id=?`).bind(matchId).first();
  if (!match) return error('ไม่พบแมตช์นี้', 404);
  await ensureTournament(env, match.tournament_id);
  const isBye = Number(match.is_bye) === 1;
  let scoreA = input.score_a === '' || input.score_a === undefined ? match.score_a : toInt(input.score_a, NaN);
  let scoreB = input.score_b === '' || input.score_b === undefined ? match.score_b : toInt(input.score_b, NaN);
  let status = input.status === 'pending' ? 'pending' : input.status === 'final' ? 'final' : match.status;
  let resultA = '';
  let resultB = '';
  let winner = null;
  if (isBye) {
    scoreA = 0; scoreB = 0; status = 'final'; resultA = 'BYE'; winner = match.team_a_id;
  } else if (status === 'final') {
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA < 0 || scoreB < 0) return error('กรุณากรอกคะแนนเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
    if (scoreA > scoreB) { resultA = 'W'; resultB = 'L'; winner = match.team_a_id; }
    else if (scoreB > scoreA) { resultA = 'L'; resultB = 'W'; winner = match.team_b_id; }
    else {
      resultA = 'D'; resultB = 'D';
      const tieWinner = input.winner_team_id || null;
      if (String(match.phase).startsWith('finals-')) {
        if (![match.team_a_id, match.team_b_id].includes(tieWinner)) return error('รอบชิงต้องระบุผู้ชนะกรณีคะแนนเสมอ');
        winner = tieWinner;
      }
    }
  } else {
    scoreA = null; scoreB = null;
  }
  await env.DB.prepare(`UPDATE matches SET score_a=?, score_b=?, result_a=?, result_b=?, winner_team_id=?, status=?, notes=?, updated_at=? WHERE id=?`)
    .bind(scoreA, scoreB, resultA, resultB, winner, status, safeString(input.notes, 500), now(), matchId).run();
  const roundStatus = await refreshRoundStatus(env, match.round_id);
  await audit(env, match.tournament_id, 'match.update', { matchId, roundId: match.round_id, status, roundStatus });
  return json({ ok: true, round_status: roundStatus, bundle: await getBundle(env, match.tournament_id) });
}

function winnerOf(match) {
  if (match.winner_team_id) return match.winner_team_id;
  const a = toInt(match.score_a, 0);
  const b = toInt(match.score_b, 0);
  if (a > b) return match.team_a_id;
  if (b > a) return match.team_b_id;
  return null;
}

async function generateFinals(request, env, tournamentId) {
  await ensureTournament(env, tournamentId);
  const input = await bodyJson(request);
  const stage = input.stage || 'semifinal';
  const bundle = await getBundle(env, tournamentId);
  const existingSemis = bundle.rounds.find((round) => round.phase === 'finals-semifinal');
  const existingMedal = bundle.rounds.find((round) => round.phase === 'finals-medal');

  if (stage === 'semifinal') {
    if (existingSemis) return error('สร้างรอบรองชนะเลิศแล้ว', 409);
    if (bundle.standings.length < 4) return error('ต้องมีอย่างน้อย 4 ทีมเพื่อสร้างรอบชิง 4 ทีม');
    const top = bundle.standings.slice(0, 4);
    const roundId = id();
    const statements = [
      env.DB.prepare(`INSERT INTO rounds (id,tournament_id,phase,round_number,title,diff_cap,status,updated_at)
        VALUES (?, ?, 'finals-semifinal', 1, 'รอบรองชนะเลิศ (Top 4)', 0, 'open', ?)`).bind(roundId, tournamentId, now()),
      env.DB.prepare(`INSERT INTO matches (id,round_id,table_no,team_a_id,team_b_id,status,updated_at)
        VALUES (?, ?, 1, ?, ?, 'pending', ?)`).bind(id(), roundId, top[0].team_id, top[3].team_id, now()),
      env.DB.prepare(`INSERT INTO matches (id,round_id,table_no,team_a_id,team_b_id,status,updated_at)
        VALUES (?, ?, 2, ?, ?, 'pending', ?)`).bind(id(), roundId, top[1].team_id, top[2].team_id, now())
    ];
    await env.DB.batch(statements);
    await audit(env, tournamentId, 'finals.semifinal.generate', { teams: top.map((row) => row.team_id) });
    return json({ ok: true, bundle: await getBundle(env, tournamentId) }, 201);
  }

  if (stage === 'medal') {
    if (!existingSemis) return error('กรุณาสร้างและยืนยันผลรอบรองชนะเลิศก่อน');
    if (existingMedal) return error('สร้างรอบชิงเหรียญแล้ว', 409);
    const semis = bundle.matches.filter((match) => match.round_id === existingSemis.id);
    if (semis.length !== 2 || semis.some((match) => match.status !== 'final')) return error('กรุณายืนยันผลรอบรองชนะเลิศทั้ง 2 คู่ก่อน');
    const winners = semis.map(winnerOf);
    if (winners.some((winner) => !winner)) return error('กรณีคะแนนเสมอในรอบรอง กรุณาเลือกผู้ชนะก่อน');
    const losers = semis.map((match, index) => match.team_a_id === winners[index] ? match.team_b_id : match.team_a_id);
    const roundId = id();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO rounds (id,tournament_id,phase,round_number,title,diff_cap,status,updated_at)
        VALUES (?, ?, 'finals-medal', 1, 'รอบชิงชนะเลิศและชิงอันดับ 3', 0, 'open', ?)`).bind(roundId, tournamentId, now()),
      env.DB.prepare(`INSERT INTO matches (id,round_id,table_no,team_a_id,team_b_id,status,updated_at)
        VALUES (?, ?, 1, ?, ?, 'pending', ?)`).bind(id(), roundId, winners[0], winners[1], now()),
      env.DB.prepare(`INSERT INTO matches (id,round_id,table_no,team_a_id,team_b_id,status,updated_at)
        VALUES (?, ?, 2, ?, ?, 'pending', ?)`).bind(id(), roundId, losers[0], losers[1], now())
    ]);
    await audit(env, tournamentId, 'finals.medal.generate', {});
    return json({ ok: true, bundle: await getBundle(env, tournamentId) }, 201);
  }
  return error('ไม่รู้จักรอบชิงที่ต้องการสร้าง');
}

async function getFinalStatus(env, tournamentId) {
  const bundle = await getBundle(env, tournamentId);
  const semis = bundle.rounds.find((round) => round.phase === 'finals-semifinal');
  const medals = bundle.rounds.find((round) => round.phase === 'finals-medal');
  const result = { semifinal: semis || null, medal_round: medals || null, medals: null };
  if (!medals || medals.status !== 'completed') return result;
  const matches = bundle.matches.filter((match) => match.round_id === medals.id).sort((a, b) => a.table_no - b.table_no);
  const teamMap = new Map(bundle.teams.map((team) => [team.id, team]));
  const goldId = winnerOf(matches[0]);
  const silverId = matches[0].team_a_id === goldId ? matches[0].team_b_id : matches[0].team_a_id;
  const bronzeId = winnerOf(matches[1]);
  const fourthId = matches[1].team_a_id === bronzeId ? matches[1].team_b_id : matches[1].team_a_id;
  result.medals = { gold: teamMap.get(goldId), silver: teamMap.get(silverId), bronze: teamMap.get(bronzeId), fourth: teamMap.get(fourthId) };
  return result;
}

async function exportTournament(env, tournamentId) {
  const bundle = await getBundle(env, tournamentId);
  if (!bundle) return error('ไม่พบรายการแข่งขัน', 404);
  const logs = await env.DB.prepare('SELECT action, detail_json, created_at FROM audit_logs WHERE tournament_id=? ORDER BY created_at ASC').bind(tournamentId).all();
  return json({
    format: 'amath-koth-backup/v1',
    exported_at: now(),
    tournament: bundle.tournament,
    teams: bundle.teams,
    rounds: bundle.rounds,
    matches: bundle.matches,
    audit_logs: logs.results
  });
}

async function importTournament(request, env) {
  const payload = await bodyJson(request);
  if (payload.format !== 'amath-koth-backup/v1' || !payload.tournament || !Array.isArray(payload.teams)) return error('ไฟล์สำรองข้อมูลไม่ถูกต้อง');
  const sourceTournament = payload.tournament;
  const sourceTeams = payload.teams;
  const sourceRounds = Array.isArray(payload.rounds) ? payload.rounds : [];
  const sourceMatches = Array.isArray(payload.matches) ? payload.matches : [];
  if (sourceTeams.length > 300 || sourceRounds.length > 150 || sourceMatches.length > 5000) return error('ข้อมูลสำรองมีขนาดเกินขอบเขตที่ระบบรับได้');
  const tournamentId = id();
  const code = await uniqueCode(`${sourceTournament.code || sourceTournament.name || 'koth'}-copy`);
  const teamMap = new Map(sourceTeams.map((team) => [team.id, id()]));
  const roundMap = new Map(sourceRounds.map((round) => [round.id, id()]));
  const scoring = normalizeScoring(sourceTournament.scoring || parseJson(sourceTournament.scoring_json, DEFAULT_SCORING));
  const rules = normalizeRules(sourceTournament.ranking_rules || parseJson(sourceTournament.ranking_rules_json, DEFAULT_RANKING_RULES));
  const statements = [
    env.DB.prepare(`INSERT INTO tournaments (id,code,name,academic_year,category,organizer,venue,starts_on,ends_on,rounds_planned,scoring_json,ranking_rules_json,status,public_enabled,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tournamentId, code, `${safeString(sourceTournament.name, 140)} (สำเนา)`, safeString(sourceTournament.academic_year, 50), safeString(sourceTournament.category || 'A-Math', 80), safeString(sourceTournament.organizer, 160), safeString(sourceTournament.venue, 160), safeString(sourceTournament.starts_on, 20), safeString(sourceTournament.ends_on, 20), Math.max(1, toInt(sourceTournament.rounds_planned, 5)), JSON.stringify(scoring), JSON.stringify(rules), ['draft', 'open', 'completed'].includes(sourceTournament.status) ? sourceTournament.status : 'draft', sourceTournament.public_enabled ? 1 : 0, now())
  ];
  for (const source of sourceTeams) {
    statements.push(env.DB.prepare(`INSERT INTO teams (id,tournament_id,seed,code,name,school,member_1,member_2,coach,contact,notes,is_active,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(teamMap.get(source.id), tournamentId, Math.max(1, toInt(source.seed, 9999)), safeString(source.code, 24), safeString(source.name, 120), safeString(source.school, 160), safeString(source.member_1, 120), safeString(source.member_2, 120), safeString(source.coach, 120), safeString(source.contact, 160), safeString(source.notes, 500), source.is_active === false ? 0 : 1, now()));
  }
  for (const source of sourceRounds) {
    statements.push(env.DB.prepare(`INSERT INTO rounds (id,tournament_id,phase,round_number,title,diff_cap,status,pairing_note,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(roundMap.get(source.id), tournamentId, ['koth', 'finals-semifinal', 'finals-medal'].includes(source.phase) ? source.phase : 'koth', Math.max(1, toInt(source.round_number, 1)), safeString(source.title, 100) || 'รอบแข่งขัน', Math.max(0, toInt(source.diff_cap, 250)), ['open', 'completed', 'locked', 'draft'].includes(source.status) ? source.status : 'open', safeString(source.pairing_note, 1000), now()));
  }
  for (const source of sourceMatches) {
    if (!roundMap.has(source.round_id) || !teamMap.has(source.team_a_id)) continue;
    statements.push(env.DB.prepare(`INSERT INTO matches (id,round_id,table_no,team_a_id,team_b_id,score_a,score_b,result_a,result_b,winner_team_id,is_bye,status,notes,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), roundMap.get(source.round_id), Math.max(1, toInt(source.table_no, 1)), teamMap.get(source.team_a_id), source.team_b_id ? teamMap.get(source.team_b_id) || null : null,
        source.score_a === null ? null : toInt(source.score_a, 0), source.score_b === null ? null : toInt(source.score_b, 0), safeString(source.result_a, 10), safeString(source.result_b, 10), source.winner_team_id ? teamMap.get(source.winner_team_id) || null : null, source.is_bye ? 1 : 0, source.status === 'final' ? 'final' : 'pending', safeString(source.notes, 500), now()));
  }
  await env.DB.batch(statements);
  await audit(env, tournamentId, 'tournament.import', { sourceName: sourceTournament.name });
  return json({ ok: true, tournament: await getTournament(env, tournamentId) }, 201);
}

async function publicTournament(env, code) {
  const record = await env.DB.prepare('SELECT * FROM tournaments WHERE code=? AND public_enabled=1 AND status != \'archived\'').bind(code).first();
  if (!record) return error('ไม่พบหน้าตารางคะแนนสาธารณะ หรือผู้ดูแลยังไม่เปิดเผยข้อมูล', 404);
  const bundle = await getBundle(env, record.id);
  const rounds = groupRounds(bundle).map((round) => ({
    id: round.id, phase: round.phase, round_number: round.round_number, title: round.title, status: round.status, diff_cap: round.diff_cap,
    matches: round.matches.map((match) => ({
      table_no: match.table_no, score_a: match.score_a, score_b: match.score_b, status: match.status, is_bye: match.is_bye,
      team_a: match.team_a ? { code: match.team_a.code, name: match.team_a.name, school: match.team_a.school } : null,
      team_b: match.team_b ? { code: match.team_b.code, name: match.team_b.name, school: match.team_b.school } : null
    }))
  }));
  return json({
    ok: true,
    tournament: {
      code: bundle.tournament.code, name: bundle.tournament.name, academic_year: bundle.tournament.academic_year, category: bundle.tournament.category,
      organizer: bundle.tournament.organizer, venue: bundle.tournament.venue, starts_on: bundle.tournament.starts_on, ends_on: bundle.tournament.ends_on,
      status: bundle.tournament.status
    },
    standings: bundle.standings.map((row) => ({ rank: row.rank, code: row.code, name: row.name, school: row.school, is_active: row.is_active, points: row.points, wins: row.wins, draws: row.draws, losses: row.losses, byes: row.byes, capped_diff: row.capped_diff, points_for: row.points_for })),
    rounds
  });
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.AUTH_SECRET) return error('ยังไม่ได้กำหนด ADMIN_PASSWORD และ AUTH_SECRET บน Cloudflare', 503);
  const input = await bodyJson(request);
  if (!constantTimeEqual(safeString(input.password, 300), env.ADMIN_PASSWORD)) return error('รหัสผ่านไม่ถูกต้อง', 401);
  const token = await makeSession(env);
  return json({ ok: true, user: { role: 'admin' } }, 200, { 'set-cookie': sessionCookie(token) });
}

function notFound() {
  return error('ไม่พบเส้นทางที่ร้องขอ', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method === 'GET' && path === '/api/health') return json({ ok: true, service: 'A-Math KOTH Manager', time: now() });
      if (request.method === 'POST' && path === '/api/auth/login') return login(request, env);
      if (request.method === 'POST' && path === '/api/auth/logout') return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
      if (request.method === 'GET' && path === '/api/auth/me') return json({ ok: true, authenticated: await verifySession(request, env), user: (await verifySession(request, env)) ? { role: 'admin' } : null });
      if (request.method === 'GET' && path.startsWith('/api/public/tournaments/')) return publicTournament(env, decodeURIComponent(path.split('/').at(-1)));

      const denied = await requireAuth(request, env);
      if (denied) return denied;

      if (request.method === 'GET' && path === '/api/tournaments') return json({ ok: true, tournaments: await listTournaments(env) });
      if (request.method === 'POST' && path === '/api/tournaments') return createTournament(request, env);
      if (request.method === 'POST' && path === '/api/tournaments/import') return importTournament(request, env);

      const parts = path.split('/').filter(Boolean);
      // /api/tournaments/:id
      if (parts[1] === 'tournaments' && parts[2]) {
        const tournamentId = decodeURIComponent(parts[2]);
        if (parts.length === 3 && request.method === 'GET') {
          const bundle = await getBundle(env, tournamentId);
          return bundle ? json({ ok: true, ...bundle, rounds: groupRounds(bundle), finals: await getFinalStatus(env, tournamentId) }) : error('ไม่พบรายการแข่งขัน', 404);
        }
        if (parts.length === 3 && request.method === 'PATCH') return updateTournament(request, env, tournamentId);
        if (parts.length === 4 && parts[3] === 'teams' && request.method === 'GET') {
          const teams = await env.DB.prepare('SELECT * FROM teams WHERE tournament_id=? ORDER BY is_active DESC, seed ASC, name').bind(tournamentId).all();
          return json({ ok: true, teams: teams.results.map(asTeam) });
        }
        if (parts.length === 4 && parts[3] === 'teams' && request.method === 'POST') return addTeam(request, env, tournamentId);
        if (parts.length === 5 && parts[3] === 'teams' && parts[4] === 'import' && request.method === 'POST') return importTeams(request, env, tournamentId);
        if (parts.length === 5 && parts[3] === 'teams' && request.method === 'PATCH') return updateTeam(request, env, tournamentId, decodeURIComponent(parts[4]));
        if (parts.length === 5 && parts[3] === 'teams' && request.method === 'DELETE') return archiveTeam(env, tournamentId, decodeURIComponent(parts[4]));
        if (parts.length === 4 && parts[3] === 'standings' && request.method === 'GET') {
          const bundle = await getBundle(env, tournamentId); return bundle ? json({ ok: true, standings: bundle.standings }) : error('ไม่พบรายการแข่งขัน', 404);
        }
        if (parts.length === 4 && parts[3] === 'rounds' && request.method === 'POST') return generateKothRound(request, env, tournamentId);
        if (parts.length === 6 && parts[3] === 'rounds' && parts[5] === 'matches' && request.method === 'PUT') return replaceRoundMatches(request, env, tournamentId, decodeURIComponent(parts[4]));
        if (parts.length === 4 && parts[3] === 'finals' && request.method === 'POST') return generateFinals(request, env, tournamentId);
        if (parts.length === 4 && parts[3] === 'finals' && request.method === 'GET') return json({ ok: true, ...(await getFinalStatus(env, tournamentId)) });
        if (parts.length === 4 && parts[3] === 'export' && request.method === 'GET') return exportTournament(env, tournamentId);
      }
      if (parts[1] === 'matches' && parts[2] && request.method === 'PATCH') return updateMatch(request, env, decodeURIComponent(parts[2]));
      return notFound();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด';
      console.error('API error', { path, message, cause });
      return error(message, 500);
    }
  }
};
