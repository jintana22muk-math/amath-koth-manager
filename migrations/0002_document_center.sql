ALTER TABLE teams ADD COLUMN province TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_1_level TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_1_room TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_1_student_id TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_1_phone TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_2_level TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_2_room TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_2_student_id TEXT DEFAULT '';
ALTER TABLE teams ADD COLUMN member_2_phone TEXT DEFAULT '';

ALTER TABLE matches ADD COLUMN starter_team_id TEXT REFERENCES teams(id);

