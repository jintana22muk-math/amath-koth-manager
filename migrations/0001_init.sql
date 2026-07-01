PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  academic_year TEXT DEFAULT '',
  category TEXT DEFAULT 'A-Math',
  organizer TEXT DEFAULT '',
  venue TEXT DEFAULT '',
  starts_on TEXT DEFAULT '',
  ends_on TEXT DEFAULT '',
  rounds_planned INTEGER NOT NULL DEFAULT 5,
  scoring_json TEXT NOT NULL,
  ranking_rules_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','completed','archived')),
  public_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  seed INTEGER NOT NULL DEFAULT 9999,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  school TEXT DEFAULT '',
  member_1 TEXT DEFAULT '',
  member_2 TEXT DEFAULT '',
  coach TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, code),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id, is_active, seed);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'koth' CHECK (phase IN ('koth','finals-semifinal','finals-medal')),
  round_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  diff_cap INTEGER NOT NULL DEFAULT 250,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','completed','locked')),
  pairing_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, phase, round_number),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rounds_tournament ON rounds(tournament_id, phase, round_number);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  table_no INTEGER NOT NULL,
  team_a_id TEXT NOT NULL,
  team_b_id TEXT,
  score_a INTEGER,
  score_b INTEGER,
  result_a TEXT DEFAULT '',
  result_b TEXT DEFAULT '',
  winner_team_id TEXT,
  is_bye INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','final')),
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(round_id, table_no),
  FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY(team_a_id) REFERENCES teams(id),
  FOREIGN KEY(team_b_id) REFERENCES teams(id),
  FOREIGN KEY(winner_team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id, table_no);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(team_a_id, team_b_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tournament_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_tournament ON audit_logs(tournament_id, created_at DESC);
