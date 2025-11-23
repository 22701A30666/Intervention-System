require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const db = require('./lib/db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Get student status
app.get('/student/:id/status', async (req, res) => {
  const studentId = req.params.id;
  try {
    const student = await db.getStudent(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const intervention = await db.getActiveIntervention(studentId);
    res.json({
      student_id: studentId,
      status: student.status,
      task: intervention ? intervention.task : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Daily check-in
// Body: { student_id, quiz_score, focus_minutes }
app.post('/daily-checkin', async (req, res) => {
  const { student_id, quiz_score, focus_minutes } = req.body || {};
  if (!student_id || typeof quiz_score !== 'number' || typeof focus_minutes !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  try {
    await db.ensureStudent(student_id);
    // Log the daily check-in
    await db.insertDailyLog({ student_id, quiz_score, focus_minutes });

    const isSuccess = quiz_score > 7 && focus_minutes > 60;
    if (isSuccess) {
      await db.updateStudentStatus(student_id, 'On Track');
      return res.json({ status: 'On Track' });
    }

    // Failure → Needs Intervention
    await db.updateStudentStatus(student_id, 'Needs Intervention');

    // Create a placeholder intervention (pending task to be assigned by mentor)
    const intervention = await db.createOrGetPendingIntervention(student_id);

    // Trigger n8n webhook (best-effort)
    if (N8N_WEBHOOK_URL) {
      try {
        await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id,
            quiz_score,
            focus_minutes,
            intervention_id: intervention.id,
          }),
        });
      } catch (err) {
        console.warn('n8n webhook call failed:', err.message);
      }
    }

    return res.json({ status: 'Pending Mentor Review' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign intervention (called by n8n after mentor approval)
// Body: { student_id, intervention_id, task }
app.post('/assign-intervention', async (req, res) => {
  const { student_id, intervention_id, task } = req.body || {};
  if (!student_id || !task) return res.status(400).json({ error: 'Invalid payload' });
  try {
    await db.ensureStudent(student_id);
    const intervention = await db.assignInterventionTask({ student_id, intervention_id, task });
    await db.updateStudentStatus(student_id, 'Remedial');
    res.json({ ok: true, intervention });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark remedial task complete, unlock student
// Body: { student_id }
app.post('/mark-complete', async (req, res) => {
  const { student_id } = req.body || {};
  if (!student_id) return res.status(400).json({ error: 'Invalid payload' });
  try {
    await db.ensureStudent(student_id);
    await db.completeActiveIntervention(student_id);
    await db.updateStudentStatus(student_id, 'On Track');
    res.json({ ok: true, status: 'On Track' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});