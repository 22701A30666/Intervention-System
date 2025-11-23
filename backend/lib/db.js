const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

// In-memory fallback for local demo if DATABASE_URL is not provided
const memory = {
  students: new Map(), // id -> { id, status }
  interventions: new Map(), // id -> { id, student_id, task, status, created_at, completed_at }
  daily_logs: [],
};
let interventionAutoId = 1;

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

async function query(sql, params) {
  if (!pool) throw new Error('DB not configured');
  const res = await pool.query(sql, params);
  return res.rows;
}

module.exports = {
  async ensureStudent(student_id) {
    if (pool) {
      await query(
        `INSERT INTO students (id, status) VALUES ($1, 'On Track')
         ON CONFLICT (id) DO NOTHING`,
        [student_id]
      );
      return;
    }
    if (!memory.students.has(student_id)) memory.students.set(student_id, { id: student_id, status: 'On Track' });
  },

  async getStudent(student_id) {
    if (pool) {
      const rows = await query('SELECT * FROM students WHERE id = $1', [student_id]);
      return rows[0] || null;
    }
    return memory.students.get(student_id) || null;
  },

  async updateStudentStatus(student_id, status) {
    if (pool) {
      await query('UPDATE students SET status = $2, updated_at = NOW() WHERE id = $1', [student_id, status]);
      return;
    }
    const s = memory.students.get(student_id) || { id: student_id };
    s.status = status;
    memory.students.set(student_id, s);
  },

  async insertDailyLog({ student_id, quiz_score, focus_minutes }) {
    if (pool) {
      await query(
        `INSERT INTO daily_logs (student_id, quiz_score, focus_minutes, status)
         VALUES ($1, $2, $3, CASE WHEN $2 > 7 AND $3 > 60 THEN 'success' ELSE 'failed' END)`,
        [student_id, quiz_score, focus_minutes]
      );
      return;
    }
    memory.daily_logs.push({ student_id, quiz_score, focus_minutes, status: quiz_score > 7 && focus_minutes > 60 ? 'success' : 'failed', ts: Date.now() });
  },

  async createOrGetPendingIntervention(student_id) {
    if (pool) {
      const rows = await query(
        `SELECT * FROM interventions WHERE student_id = $1 AND status IN ('pending','assigned') ORDER BY created_at DESC LIMIT 1`,
        [student_id]
      );
      if (rows[0]) return rows[0];
      const created = await query(
        `INSERT INTO interventions (student_id, task, status)
         VALUES ($1, NULL, 'pending') RETURNING *`,
        [student_id]
      );
      return created[0];
    }
    // memory mode: return existing pending/assigned or create new
    for (const i of memory.interventions.values()) {
      if (i.student_id === student_id && (i.status === 'pending' || i.status === 'assigned')) return i;
    }
    const id = interventionAutoId++;
    const newInt = { id, student_id, task: null, status: 'pending', created_at: Date.now(), completed_at: null };
    memory.interventions.set(id, newInt);
    return newInt;
  },

  async assignInterventionTask({ student_id, intervention_id, task }) {
    if (pool) {
      let res;
      if (intervention_id) {
        res = await query(
          `UPDATE interventions SET task = $2, status = 'assigned' WHERE id = $1 RETURNING *`,
          [intervention_id, task]
        );
      } else {
        res = await query(
          `INSERT INTO interventions (student_id, task, status)
           VALUES ($1, $2, 'assigned') RETURNING *`,
          [student_id, task]
        );
      }
      return res[0];
    }
    // memory
    let target = intervention_id ? memory.interventions.get(Number(intervention_id)) : null;
    if (!target) {
      target = await this.createOrGetPendingIntervention(student_id);
    }
    target.task = task;
    target.status = 'assigned';
    memory.interventions.set(target.id, target);
    return target;
  },

  async getActiveIntervention(student_id) {
    if (pool) {
      const rows = await query(
        `SELECT * FROM interventions WHERE student_id = $1 AND status IN ('pending','assigned') ORDER BY created_at DESC LIMIT 1`,
        [student_id]
      );
      return rows[0] || null;
    }
    for (const i of memory.interventions.values()) {
      if (i.student_id === student_id && (i.status === 'pending' || i.status === 'assigned')) return i;
    }
    return null;
  },

  async completeActiveIntervention(student_id) {
    if (pool) {
      const rows = await query(
        `UPDATE interventions SET status = 'completed', completed_at = NOW()
         WHERE student_id = $1 AND status IN ('pending','assigned') RETURNING *`,
        [student_id]
      );
      return rows[0] || null;
    }
    for (const i of memory.interventions.values()) {
      if (i.student_id === student_id && (i.status === 'pending' || i.status === 'assigned')) {
        i.status = 'completed';
        i.completed_at = Date.now();
        memory.interventions.set(i.id, i);
        return i;
      }
    }
    return null;
  },
};