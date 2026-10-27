const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// TURSO PARAMETRLARI
const TURSO_URL = "https://test-db-javokh14.aws-ap-northeast-1.turso.io/v2/pipeline";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5MzczOTMsImlkIjoiMDFhMTcxOGEtZDYwMS03M2Q5LTg5ODktYzgwYjdjOThiNzEwIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6ImEyMjQ2OWE0LTliMTQtNDRlNC05ZTllLWZjNDMwZmQ4Y2ExYSJ9.z08Y5v1D-2aRxwPq1CdsOlL4o2gTfSRhMiT9rnewTptHtJx5_HZQu-YJ2UQe1F0IxzjUkexmf_7ceyGN1Lw6DA";

async function executeSQL(sql, args = []) {
  const formattedArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    return { type: "text", value: String(arg) };
  });

  const response = await fetch(TURSO_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TURSO_TOKEN.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: formattedArgs } },
        { type: "close" }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `Status ${response.status}`);

  const resObj = data.results?.[0];
  if (resObj?.type === "error") throw new Error(resObj.error?.message || "SQL xatosi");

  const result = resObj?.response?.result;
  if (!result || !result.cols) return [];

  const cols = result.cols.map(c => c.name);
  return (result.rows || []).map(row => {
    const item = {};
    cols.forEach((col, idx) => {
      item[col] = row[idx]?.value !== undefined ? row[idx].value : null;
    });
    return item;
  });
}

// Bosh sahifa
app.get('/', (req, res) => res.send("🚀 Backend to'liq ishlamoqda!"));

// 1. SAYT XOLATI
app.get('/api/site-status', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT key, value FROM site_settings");
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json({ success: true, status: settings.site_status || 'active', reason: settings.site_reason || '' });
  } catch (err) {
    res.json({ success: true, status: 'active', reason: '' });
  }
});

app.post('/api/site-status', async (req, res) => {
  const { status, reason, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "PIN noto'g'ri!" });
  try {
    await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('site_status', ?)", [status]);
    await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('site_reason', ?)", [reason || '']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. TESTLARNI SAQLASH VA OLISH
app.post('/api/tests', async (req, res) => {
  const { code, teacher, subject, topic, type, timer, data } = req.body;
  try {
    await executeSQL(
      "INSERT OR REPLACE INTO tests (code, teacher, subject, topic, type, timer, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [code, teacher, subject, topic, type, timer || 0, JSON.stringify(data)]
    );
    res.json({ success: true, code });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/tests/:code', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT * FROM tests WHERE code = ?", [req.params.code]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Test topilmadi!" });
    const test = rows[0];
    test.data = JSON.parse(test.data);
    res.json({ success: true, test });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. TESTGA RUXSAT SO'ROVLARI (O'quvchi)
app.post('/api/request-access', async (req, res) => {
  const { test_code, student_name, student_class } = req.body;
  try {
    const cleanCode = test_code.toLowerCase().replace('result', '').trim();
    const tests = await executeSQL("SELECT code FROM tests WHERE code = ?", [cleanCode]);
    if (tests.length === 0) return res.status(404).json({ success: false, message: "Bunday test kodi mavjud emas!" });

    const existing = await executeSQL(
      "SELECT id FROM test_requests WHERE test_code = ? AND LOWER(student_name) = LOWER(?) AND student_class = ?",
      [cleanCode, student_name, student_class]
    );

    let reqId;
    if (existing.length > 0) {
      reqId = existing[0].id;
      await executeSQL("UPDATE test_requests SET status = 'pending' WHERE id = ?", [reqId]);
    } else {
      await executeSQL(
        "INSERT INTO test_requests (test_code, student_name, student_class, status) VALUES (?, ?, ?, 'pending')",
        [cleanCode, student_name, student_class]
      );
      const last = await executeSQL("SELECT id FROM test_requests WHERE test_code = ? AND student_name = ? ORDER BY id DESC LIMIT 1", [cleanCode, student_name]);
      reqId = last[0]?.id;
    }

    res.json({ success: true, requestId: reqId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/check-request-status/:id', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT status FROM test_requests WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, status: 'rejected' });
    res.json({ success: true, status: rows[0].status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. ADMIN: SO'ROVLARNI KO'RISH VA BOSHQARISH
app.get('/api/admin/requests/:code', async (req, res) => {
  const cleanCode = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    const rows = await executeSQL("SELECT * FROM test_requests WHERE test_code = ? ORDER BY id DESC", [cleanCode]);
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bittalab status o'zgartirish (approved, rejected, review)
app.post('/api/admin/update-request', async (req, res) => {
  const { id, status, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "PIN noto'g'ri!" });
  try {
    await executeSQL("UPDATE test_requests SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Barchasini birdaniga o'zgartirish (Batch Update)
app.post('/api/admin/update-all-requests', async (req, res) => {
  const { test_code, status, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "PIN noto'g'ri!" });
  try {
    const cleanCode = test_code.toLowerCase().replace('result', '').trim();
    await executeSQL("UPDATE test_requests SET status = ? WHERE test_code = ?", [status, cleanCode]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. NATIJALAR
app.post('/api/results', async (req, res) => {
  const { test_code, student_name, student_class, score, total, percentage, answers } = req.body;
  try {
    await executeSQL(
      "INSERT INTO results (test_code, student_name, student_class, score, total, percentage, answers) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [test_code, student_name, student_class, score || 0, total || 0, percentage || 0, JSON.stringify(answers || [])]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/results/:code', async (req, res) => {
  const code = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    const testRows = await executeSQL("SELECT * FROM tests WHERE code = ?", [code]);
    if (testRows.length === 0) return res.status(404).json({ success: false, message: "Test topilmadi!" });
    const test = testRows[0];
    test.data = JSON.parse(test.data);

    const studentRows = await executeSQL("SELECT * FROM results WHERE test_code = ? ORDER BY submitted_at DESC", [code]);
    const students = studentRows.map(r => ({ ...r, answers: JSON.parse(r.answers || "[]") }));
    res.json({ success: true, test, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/results/:id', async (req, res) => {
  try {
    await executeSQL("DELETE FROM results WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/results/clear-all/:code', async (req, res) => {
  const code = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    await executeSQL("DELETE FROM results WHERE test_code = ?", [code]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. SEYF
app.post('/api/vault/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const rows = await executeSQL("SELECT * FROM vaults WHERE pin = ?", [pin]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "PIN topilmadi!" });
    const vault = rows[0];
    vault.notes = JSON.parse(vault.notes || "[]");
    res.json({ success: true, vault });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vault/register', async (req, res) => {
  const { pin, owner } = req.body;
  try {
    const check = await executeSQL("SELECT pin FROM vaults WHERE pin = ?", [pin]);
    if (check.length > 0) return res.status(400).json({ success: false, message: "PIN band!" });
    await executeSQL("INSERT INTO vaults (pin, owner, notes) VALUES (?, ?, ?)", [pin, owner || "Ustoz", JSON.stringify([])]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vault/save-note', async (req, res) => {
  const { pin, notes } = req.body;
  try {
    await executeSQL("UPDATE vaults SET notes = ? WHERE pin = ?", [JSON.stringify(notes), pin]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server port: ${PORT}`));
