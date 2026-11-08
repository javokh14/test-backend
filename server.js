const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// TURSO PARAMETRLARI
const TURSO_URL = "https://test-db-javokh14.aws-ap-northeast-1.turso.io/v2/pipeline";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5MzczOTMsImlkIjoiMDFhMTcxOGEtZDYwMS03M2Q5LTg5ODktYzgwYjdjOThiNzEwIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6ImEyMjQ2OWE0LTliMTQtNDRlNC05ZTllLWZjNDMwZmQ4Y2ExYSJ9.z08Y5v1D-2aRxwPq1CdsOlL4o2gTfSRhMiT9rnewTptHtJx5_HZQu-YJ2UQe1F0IxzjUkexmf_7ceyGN1Lw6DA";

const clearedApprovedCache = new Set();

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
  if (!response.ok) {
    throw new Error(data.message || `Turso xatosi: ${response.status}`);
  }

  const resObj = data.results && data.results[0];
  if (resObj && resObj.type === "error") {
    throw new Error(resObj.error && resObj.error.message ? resObj.error.message : "SQL xatosi");
  }

  const result = resObj && resObj.response && resObj.response.result;
  if (!result || !result.cols) return [];

  const cols = result.cols.map(c => c.name);
  const rows = result.rows || [];

  return rows.map(row => {
    const item = {};
    cols.forEach((col, idx) => {
      item[col] = (row[idx] && row[idx].value !== undefined) ? row[idx].value : null;
    });
    return item;
  });
}

// Bosh sahifa
app.get('/', (req, res) => {
  res.send("🚀 EduSmart Backend to'liq ishlamoqda!");
});

// 1. SAYT VA FON XOLATI
app.get('/api/site-status', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT key, value FROM site_settings");
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({
      success: true,
      status: settings.site_status || 'active',
      reason: settings.site_reason || '',
      view_mode: settings.site_view_mode || 'only_bg', // 'only_bg' yoki 'full_panel'
      bg_type: settings.bg_type || 'image', // 'image' yoki 'video'
      bg_url: settings.bg_url || 'https://i.pinimg.com/1200x/3f/44/63/3f4463a3878147b4d719ba0e83f68b5d.jpg'
    });
  } catch (err) {
    res.json({
      success: true,
      status: 'active',
      reason: '',
      view_mode: 'only_bg',
      bg_type: 'image',
      bg_url: 'https://i.pinimg.com/1200x/3f/44/63/3f4463a3878147b4d719ba0e83f68b5d.jpg'
    });
  }
});

app.post('/api/site-status', async (req, res) => {
  const { status, reason, adminPin } = req.body;
  if (adminPin !== "201049") {
    return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  }
  try {
    await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('site_status', ?)", [status]);
    await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('site_reason', ?)", [reason || '']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. BACKGROUND VA SAYT KO'RINISHINI SAQLASH
app.post('/api/admin/background-settings', async (req, res) => {
  const { view_mode, bg_type, bg_url, adminPin } = req.body;
  if (adminPin !== "201049") {
    return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  }
  try {
    if (view_mode) {
      await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('site_view_mode', ?)", [view_mode]);
    }
    if (bg_type) {
      await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('bg_type', ?)", [bg_type]);
    }
    if (bg_url !== undefined) {
      await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('bg_url', ?)", [bg_url.trim()]);
    }
    res.json({ success: true, message: "Fon va sayt ko'rinishi sozlamalari saqlandi!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. GEMINI BOSHQARUVI VA API CHECKER
app.get('/api/admin/gemini-status', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT value FROM site_settings WHERE key = 'gemini_api_key'");
    const hasKey = rows.length > 0 && rows[0].value && rows[0].value.trim().length > 0;
    res.json({ success: true, configured: Boolean(hasKey) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/gemini-key', async (req, res) => {
  const { apiKey, adminPin } = req.body;
  if (adminPin !== "201049") {
    return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  }
  try {
    await executeSQL("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('gemini_api_key', ?)", [apiKey.trim()]);
    res.json({ success: true, message: "Gemini API kaliti muvaffaqiyatli saqlandi!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/check-gemini', async (req, res) => {
  const { adminPin } = req.body;
  if (adminPin !== "201049") {
    return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  }
  try {
    const rows = await executeSQL("SELECT value FROM site_settings WHERE key = 'gemini_api_key'");
    if (rows.length === 0 || !rows[0].value || !rows[0].value.trim()) {
      return res.json({ success: false, status: 'empty', message: "API kalit kiritilmagan!" });
    }

    const key = rows[0].value.trim();
    const testUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + key;
    const testResp = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
    });

    const testData = await testResp.json();
    if (!testResp.ok) {
      const errMsg = (testData.error && testData.error.message) ? testData.error.message : "API xatosi";
      if (testResp.status === 429 || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("limit")) {
        return res.json({ success: false, status: 'limit', message: "Kalitning limiti tugagan (Quota Exceeded)!" });
      }
      return res.json({ success: false, status: 'invalid', message: "API kalit yaroqsiz: " + errMsg });
    }

    res.json({ success: true, status: 'active', message: "Gemini API kaliti faol va ishlamoqda!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. AI TEST GENERATORI
app.post('/api/ai/generate-test', async (req, res) => {
  const { subject, topic, details, count, adminPin } = req.body;
  if (adminPin !== "201049") {
    return res.status(403).json({ success: false, message: "Ruxsat berilmadi!" });
  }

  try {
    const rows = await executeSQL("SELECT value FROM site_settings WHERE key = 'gemini_api_key'");
    if (rows.length === 0 || !rows[0].value || !rows[0].value.trim()) {
      return res.status(400).json({ success: false, message: "Gemini API kaliti topilmadi! Admin paneldan kiriting." });
    }

    const key = rows[0].value.trim();
    const qCount = parseInt(count, 10) || 5;

    const promptText = `Sen o'quvchilar uchun test tuzuvchi professional o'qituvchisan.
Fan: "${subject}".
Mavzu: "${topic}".
Qo'shimcha talablar: "${details || 'Mavzuni to\'liq qamrab oluvchi savollar'}".
Savollar soni: aynan ${qCount} ta.

QAT'IY QOIDALAR:
1. Har bir savol uchun "options" massivida 3 ta TO'LIQ javob varianti matni bo'lsin.
2. Variant matniga "A", "B", "C" yoki "A)" deb harf qo'shma, faqat javob so'zlarini yoz!
3. "correct": to'g'ri javob indeksi (0 bo'lsa 1-variant, 1 bo'lsa 2-variant, 2 bo'lsa 3-variant).
4. FAQAT toza JSON massiv qaytar, boshqa hech qanday so'z yozma.

Namunaviy format:
[
  {
    "q": "O'zbekiston Respublikasining poytaxti qaysi shahar?",
    "options": ["Toshkent shahri", "Samarqand shahri", "Buxoro shahri"],
    "correct": 0
  }
]`;

    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + key;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      throw new Error((geminiData.error && geminiData.error.message) ? geminiData.error.message : "Gemini javob bermadi");
    }

    let rawOutput = "[]";
    if (geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts) {
      rawOutput = geminiData.candidates[0].content.parts[0].text || "[]";
    }

    const jsonMatch = rawOutput.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      rawOutput = jsonMatch[0];
    } else {
      rawOutput = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
    }

    let parsed = JSON.parse(rawOutput);
    if (!Array.isArray(parsed)) parsed = [];

    const cleanQuestions = parsed.map(item => {
      let opts = [];
      if (Array.isArray(item.options)) {
        opts = item.options.map(o => (typeof o === 'string' ? o : (o.text || o.title || Object.values(o)[0] || '')).trim());
      } else if (item.options && typeof item.options === 'object') {
        opts = Object.values(item.options).map(v => String(v).trim());
      }

      opts = opts.map(o => o.replace(/^[A-Ca-c][\)\.\:\-\s]+/g, '').trim());
      while (opts.length < 3) opts.push("Javob varianti " + (opts.length + 1));
      opts = opts.slice(0, 3);

      let corr = parseInt(item.correct, 10);
      if (isNaN(corr) || corr < 0 || corr > 2) corr = 0;

      return {
        q: String(item.q || item.question || "Savol matni").trim(),
        options: opts,
        correct: corr
      };
    });

    res.json({ success: true, questions: cleanQuestions });
  } catch (err) {
    res.status(500).json({ success: false, message: "AI generatsiyasida xatolik: " + err.message });
  }
});

// 5. TESTLARNI SAQLASH VA OLISH
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
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Bunday test topilmadi!" });
    }
    const test = rows[0];
    test.data = JSON.parse(test.data);
    res.json({ success: true, test });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. TESTGA RUXSAT SO'ROVLARI
app.post('/api/request-access', async (req, res) => {
  const { test_code, student_name, student_class } = req.body;
  try {
    const cleanCode = test_code.toLowerCase().replace('result', '').trim();
    const tests = await executeSQL("SELECT code FROM tests WHERE code = ?", [cleanCode]);
    if (tests.length === 0) {
      return res.status(404).json({ success: false, message: "Bunday test kodi mavjud emas!" });
    }

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
      reqId = last[0] ? last[0].id : null;
    }

    res.json({ success: true, requestId: reqId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/check-request-status/:id', async (req, res) => {
  try {
    const rows = await executeSQL("SELECT status FROM test_requests WHERE id = ?", [req.params.id]);
    if (rows.length === 0) {
      if (clearedApprovedCache.has(String(req.params.id))) {
        return res.json({ success: true, status: 'approved' });
      }
      return res.json({ success: true, status: 'pending' });
    }
    res.json({ success: true, status: rows[0].status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. ADMIN SO'ROVLAR BOSHQARUVI VA TOZALASH
app.get('/api/admin/requests/:code', async (req, res) => {
  const cleanCode = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    const rows = await executeSQL("SELECT * FROM test_requests WHERE test_code = ? ORDER BY id DESC", [cleanCode]);
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/update-request', async (req, res) => {
  const { id, status, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  try {
    await executeSQL("UPDATE test_requests SET status = ? WHERE id = ?", [status, id]);
    if (status === 'approved') {
      clearedApprovedCache.add(String(id));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/update-all-requests', async (req, res) => {
  const { test_code, status, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  try {
    const cleanCode = test_code.toLowerCase().replace('result', '').trim();
    if (status === 'approved') {
      const rows = await executeSQL("SELECT id FROM test_requests WHERE test_code = ?", [cleanCode]);
      rows.forEach(r => clearedApprovedCache.add(String(r.id)));
    }
    await executeSQL("UPDATE test_requests SET status = ? WHERE test_code = ?", [status, cleanCode]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/clear-requests', async (req, res) => {
  const { test_code, adminPin } = req.body;
  if (adminPin !== "201049") return res.status(403).json({ success: false, message: "Parol noto'g'ri!" });
  try {
    const cleanCode = test_code.toLowerCase().replace('result', '').trim();
    const rows = await executeSQL("SELECT id FROM test_requests WHERE test_code = ? AND status = 'approved'", [cleanCode]);
    rows.forEach(r => clearedApprovedCache.add(String(r.id)));

    await executeSQL("DELETE FROM test_requests WHERE test_code = ?", [cleanCode]);
    res.json({ success: true, message: "So'rovlar tozalandi!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. NATIJALAR
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
    const students = studentRows.map(r => {
      const clone = Object.assign({}, r);
      clone.answers = JSON.parse(r.answers || "[]");
      return clone;
    });
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

// 9. SEYF
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
app.listen(PORT, () => {
  console.log("Server " + PORT + "-portda muvaffaqiyatli ishga tushdi!");
});
