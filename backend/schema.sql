-- Students table
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'On Track', -- 'On Track' | 'Needs Intervention' | 'Remedial'
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Daily logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  quiz_score INTEGER NOT NULL,
  focus_minutes INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Interventions
CREATE TABLE IF NOT EXISTS interventions (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  task TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'assigned' | 'completed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_logs_student ON daily_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_interventions_student ON interventions(student_id);