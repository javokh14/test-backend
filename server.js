const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// TURSO PARAMETRLARI
const TURSO_URL = "https://test-db-javokh14.aws-ap-northeast-1.turso.io/v2/pipeline";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5MDYzMDUsImlkIjoiMDFhMTcxOGEtZDYwMS03M2Q5LTg5ODktYzgwYjdjOThiNzEwIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6ImEyMjQ2OWE0LTliMTQtNDRlNC05ZTllLWZjNDMwZmQ4Y2ExYSJ9.NR7acD5Ucyjyr9eOYjLsQ5aLJGO8xIzyIpL9QqqUxbziCrZYl65xN1MrUjy5A1fW8o-tONVwKG69xnlShO_KBQ";

// Groq AI
const groq = new Groq({
  apiKey: "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"
});

// TURSO BILAN TO'G'RIDAN-TO'G'RI GAPLASHUVCHI UNIVERSAL FUNKSIYA (400 xatosi bermaydi)
async function tursoQuery(sql, params = []) {
  const args = params.map(val => {
    if (val === null || val === undefined) return { type: "null" };
    if (typeof val === "number") return { type: "integer", value: val };
    return { type: "text", value: String(val) };
  });

  const response = await fetch(TURSO_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TURSO_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args } },
        { type: "close" }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Turso xatosi: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const firstRes = data.results?.[0];
  if (firstRes?.type === "error") {
    throw new Error(firstRes.error?.message || "SQL so'rovida xatolik");
  }

  const result = firstRes?.response?.result;
  if (!result || !result.cols) return { rows: [] };

  const cols = result.cols.map(c => c.name);
  const rows = (result.rows || []).map(row => {
    const obj = {};
    cols.forEach((col, idx) => {
      obj[col] = row[idx]?.value !== undefined ? row[idx].value : null;
    });
    return obj;
  });

  return { rows };
}

// Jadvallarni avtomatik tekshirish va yaratish
async function initDB() {
  try {
    await tursoQuery(`
      CREATE TABLE IF NOT EXISTS tests (
        code TEXT PRIMARY KEY,
        teacher TEXT,
        subject TEXT,
        topic TEXT,
        type TEXT,
        timer INTEGER,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await tursoQuery(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_code TEXT,
        student_name TEXT,
        student_class TEXT,
        score INTEGER,
        total INTEGER,
        percentage INTEGER,
        answers TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await tursoQuery(`
      CREATE TABLE IF NOT EXISTS vaults (
        pin TEXT PRIMARY KEY,
        owner TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Turso bazasi muvaffaqiyatli ulandi va jadvallar tayyor!");
  } catch (err) {
    console.error("❌ Turso ulanishida xatolik:", err.message);
  }
}
initDB();

app.get('/', (req, res) => {
  res.send("🚀 Backend server va Turso to'liq ishlayapti!");
});

// 1. GROQ AI GENERATORI (Faqat A, B, C variantlar)
app.post('/api/generate-ai-test', async (req, res) => {
  const { subject, topic, count, difficulty } = req.body;

  const prompt = `
Siz professional o'qituvchisiz. O'zbek tilida test savollari tuzing.
Fan: ${subject}
Mavzu: ${topic}
Savollar soni: ${count || 5}
Qiyinlik darajasi: ${difficulty || 'orta'}

Qoidalar:
- Har bir savolda FAQAT 3 ta variant bo'lsin (A, B, C). D varianti bo'lmasin!
- Toza JSON formatida javob bering, hech qanday markdown belgilarsiz (backticksiz).

Format:
[
  {
    "q": "Savol matni?",
    "options": ["A variant matni", "B variant matni", "C variant matni"],
    "correct": 0
  }
]
Eslatma: "correct" to'g'ri variant indeksi (0 = A, 1 = B, 2 = C).
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
    });

    let text = chatCompletion.choices[0]?.message?.content || "[]";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const questions = JSON.parse(text);

    res.json({ success: true, questions });
  } catch (error) {
    console.error("Groq xatosi:", error);
    res.status(500).json({ success: false, message: "AI generatsiyasida xatolik yuz berdi" });
  }
});

// 2. TESTNI TURSOGA SAQLASH
app.post('/api/tests', async (req, res) => {
  const { code, teacher, subject, topic, type, timer, data } = req.body;
  try {
    await tursoQuery(
      "INSERT INTO tests (code, teacher, subject, topic, type, timer, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [code, teacher, subject, topic, type, timer || 0, JSON.stringify(data)]
    );
    res.json({ success: true, code });
  } catch (err) {
    console.error("Test saqlash xatosi:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. TESTNI KOD BO'YICHA OLISH (O'quvchi kirganda)
app.get('/api/tests/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { rows } = await tursoQuery("SELECT * FROM tests WHERE code = ?", [code]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Bunday test topilmadi!" });
    }
    const test = { ...rows[0] };
    test.data = JSON.parse(test.data);
    res.json({ success: true, test });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. O'QUVCHI NATIJASINI SAQLASH
app.post('/api/results', async (req, res) => {
  const { test_code, student_name, student_class, score, total, percentage, answers } = req.body;
  try {
    await tursoQuery(
      "INSERT INTO results (test_code, student_name, student_class, score, total, percentage, answers) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [test_code, student_name, student_class, score, total, percentage, JSON.stringify(answers || [])]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. NATIJALARNI KO'RISH ({code} yoki {code}result)
app.get('/api/results/:code', async (req, res) => {
  let cleanCode = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    const testResult = await tursoQuery("SELECT * FROM tests WHERE code = ?", [cleanCode]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Test topilmadi!" });
    }

    const test = { ...testResult.rows[0] };
    test.data = JSON.parse(test.data);

    const studentsResult = await tursoQuery(
      "SELECT * FROM results WHERE test_code = ? ORDER BY submitted_at DESC",
      [cleanCode]
    );

    const students = studentsResult.rows.map(r => ({
      ...r,
      answers: JSON.parse(r.answers || "[]")
    }));

    res.json({ success: true, test, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. SEYF: KIRISH (PIN)
app.post('/api/vault/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const { rows } = await tursoQuery("SELECT * FROM vaults WHERE pin = ?", [pin]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Bunday PIN kodli seyf topilmadi!" });
    }
    const vault = { ...rows[0] };
    vault.notes = JSON.parse(vault.notes || "[]");
    res.json({ success: true, vault });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. SEYF: YANGI OCHISH
app.post('/api/vault/register', async (req, res) => {
  const { pin, owner } = req.body;
  try {
    const check = await tursoQuery("SELECT pin FROM vaults WHERE pin = ?", [pin]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Ushbu 6 xonali PIN kod band! Boshqa PIN tanlang." });
    }
    await tursoQuery(
      "INSERT INTO vaults (pin, owner, notes) VALUES (?, ?, ?)",
      [pin, owner || "Ustoz", JSON.stringify([])]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. SEYFGA QAYD SAQLASH
app.post('/api/vault/save-note', async (req, res) => {
  const { pin, notes } = req.body;
  try {
    await tursoQuery("UPDATE vaults SET notes = ? WHERE pin = ?", [JSON.stringify(notes), pin]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server ishga tushdi: Port ${PORT}`);
});
