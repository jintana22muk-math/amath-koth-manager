import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRankings, makeKothPairings } from '../src/core.js';

test('standings apply per-round capped differential and win/draw/loss points', () => {
  const teams = [
    { id: 'a', code: 'A', name: 'Alpha', is_active: 1, seed: 1 },
    { id: 'b', code: 'B', name: 'Beta', is_active: 1, seed: 2 },
    { id: 'c', code: 'C', name: 'Gamma', is_active: 1, seed: 3 }
  ];
  const rounds = [{ id: 'r1', phase: 'koth', diff_cap: 250 }];
  const matches = [
    { round_id: 'r1', team_a_id: 'a', team_b_id: 'b', score_a: 600, score_b: 100, status: 'final', is_bye: 0 },
    { round_id: 'r1', team_a_id: 'c', team_b_id: null, status: 'final', is_bye: 1 }
  ];
  const standings = computeRankings({ teams, rounds, matches });
  assert.equal(standings[0].team_id, 'a');
  assert.equal(standings[0].capped_diff, 250);
  assert.equal(standings.find((x) => x.team_id === 'c').points, 2);
});

test('pairing avoids a repeated pairing when another opponent exists', () => {
  const teams = [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }
  ];
  const result = makeKothPairings({ rankedTeams: teams, historyPairs: new Set(['a|b']) });
  assert.equal(result.pairings[0].teamA.id, 'a');
  assert.notEqual(result.pairings[0].teamB.id, 'b');
});

test('odd entries produce exactly one BYE', () => {
  const teams = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const result = makeKothPairings({ rankedTeams: teams, historyPairs: new Set(), byeCounts: new Map([['c', 1]]) });
  assert.equal(result.pairings.filter((x) => x.isBye).length, 1);
  assert.equal(result.pairings.length, 2);
});
