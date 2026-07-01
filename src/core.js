export const DEFAULT_SCORING = Object.freeze({
  win_points: 2,
  draw_points: 1,
  loss_points: 0,
  bye_points: 2,
  default_diff_cap: 250,
  round_caps: [250, 250, 250, 250, 200]
});

export const DEFAULT_RANKING_RULES = Object.freeze([
  'points',
  'capped_diff',
  'points_for',
  'wins',
  'name'
]);

export function parseJson(value, fallback) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeScoring(value = {}) {
  const merged = { ...DEFAULT_SCORING, ...(value || {}) };
  const roundCaps = Array.isArray(merged.round_caps)
    ? merged.round_caps.map((x) => Math.max(0, toInt(x, merged.default_diff_cap))).filter((x) => Number.isFinite(x))
    : [...DEFAULT_SCORING.round_caps];
  return {
    win_points: toInt(merged.win_points, 2),
    draw_points: toInt(merged.draw_points, 1),
    loss_points: toInt(merged.loss_points, 0),
    bye_points: toInt(merged.bye_points, 2),
    default_diff_cap: Math.max(0, toInt(merged.default_diff_cap, 250)),
    round_caps: roundCaps.length ? roundCaps : [...DEFAULT_SCORING.round_caps]
  };
}

export function normalizeRules(value) {
  const allowed = new Set(['points', 'capped_diff', 'points_for', 'wins', 'name']);
  const rules = Array.isArray(value) ? value.filter((x) => allowed.has(x)) : [];
  return rules.length ? rules : [...DEFAULT_RANKING_RULES];
}

export function rankingComparator(rules) {
  const normalized = normalizeRules(rules);
  return (a, b) => {
    for (const rule of normalized) {
      if (rule === 'name') {
        const result = a.name.localeCompare(b.name, 'th');
        if (result !== 0) return result;
      } else if (b[rule] !== a[rule]) {
        return b[rule] - a[rule];
      }
    }
    return a.seed - b.seed || a.code.localeCompare(b.code);
  };
}

/**
 * Calculate standings from raw rows. Only phase='koth' matches contribute to KOTH ranking.
 */
export function computeRankings({ teams = [], rounds = [], matches = [], scoring = DEFAULT_SCORING, rules = DEFAULT_RANKING_RULES }) {
  const cfg = normalizeScoring(scoring);
  const teamMap = new Map(teams.filter((t) => Number(t.is_active ?? 1) === 1).map((team) => [team.id, team]));
  const roundMap = new Map(rounds.map((round) => [round.id, round]));
  const rows = new Map();
  for (const team of teamMap.values()) {
    rows.set(team.id, {
      team_id: team.id,
      code: team.code,
      name: team.name,
      school: team.school || '',
      member_1: team.member_1 || '',
      member_2: team.member_2 || '',
      seed: toInt(team.seed, 9999),
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      byes: 0,
      played: 0,
      points_for: 0,
      points_against: 0,
      capped_diff: 0,
      raw_diff: 0
    });
  }

  for (const match of matches) {
    const round = roundMap.get(match.round_id);
    if (!round || round.phase !== 'koth' || match.status !== 'final') continue;
    const a = rows.get(match.team_a_id);
    const b = rows.get(match.team_b_id);
    if (!a) continue;

    if (Number(match.is_bye) === 1 || !match.team_b_id) {
      a.points += cfg.bye_points;
      a.byes += 1;
      continue;
    }
    if (!b || match.score_a === null || match.score_b === null || match.score_a === undefined || match.score_b === undefined) continue;

    const scoreA = toInt(match.score_a, 0);
    const scoreB = toInt(match.score_b, 0);
    const cap = Math.max(0, toInt(round.diff_cap, cfg.default_diff_cap));
    const diff = scoreA - scoreB;

    a.played += 1;
    b.played += 1;
    a.points_for += scoreA;
    a.points_against += scoreB;
    b.points_for += scoreB;
    b.points_against += scoreA;
    a.raw_diff += diff;
    b.raw_diff -= diff;
    a.capped_diff += clamp(diff, -cap, cap);
    b.capped_diff += clamp(-diff, -cap, cap);

    if (scoreA > scoreB) {
      a.points += cfg.win_points;
      b.points += cfg.loss_points;
      a.wins += 1;
      b.losses += 1;
    } else if (scoreB > scoreA) {
      b.points += cfg.win_points;
      a.points += cfg.loss_points;
      b.wins += 1;
      a.losses += 1;
    } else {
      a.points += cfg.draw_points;
      b.points += cfg.draw_points;
      a.draws += 1;
      b.draws += 1;
    }
  }

  const result = [...rows.values()].sort(rankingComparator(rules));
  return result.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function hasPlayed(historyPairs, teamAId, teamBId) {
  if (!teamAId || !teamBId) return false;
  return historyPairs.has([teamAId, teamBId].sort().join('|'));
}

/**
 * Greedy KOTH pairing: rank-adjacent whenever possible, swaps only to avoid a prior rematch.
 * Caller supplies teams in current ranking order.
 */
export function makeKothPairings({ rankedTeams = [], historyPairs = new Set(), byeCounts = new Map() }) {
  const queue = [...rankedTeams];
  const warnings = [];
  let bye = null;

  if (queue.length % 2 === 1) {
    // Give the BYE to the lowest-ranked team with the fewest previous BYEs.
    const candidates = queue
      .map((team, index) => ({ team, index, byes: byeCounts.get(team.id) || 0 }))
      .sort((x, y) => x.byes - y.byes || y.index - x.index);
    const selected = candidates[0];
    bye = selected.team;
    queue.splice(selected.index, 1);
  }

  const pairings = [];
  while (queue.length) {
    const teamA = queue.shift();
    let chosenIndex = queue.findIndex((candidate) => !hasPlayed(historyPairs, teamA.id, candidate.id));
    if (chosenIndex < 0) {
      chosenIndex = 0;
      warnings.push(`ไม่สามารถหลีกเลี่ยงการพบกันซ้ำได้: ${teamA.name} พบ ${queue[0].name}`);
    }
    const [teamB] = queue.splice(chosenIndex, 1);
    pairings.push({ teamA, teamB, rematch: hasPlayed(historyPairs, teamA.id, teamB.id) });
  }

  if (bye) pairings.push({ teamA: bye, teamB: null, isBye: true, rematch: false });
  return { pairings, bye, warnings };
}

export function slugify(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return cleaned || 'koth';
}

export function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
