const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// TURSO PARAMETRLARI
const TURSO_URL = "https://test-db-javokh14.aws-ap-northeast-1.turso.io/v2/pipeline";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5MzczOTMsImlkIjoiMDFhMTcxOGEtZDYwMS03M2Q5LTg5ODktYzgwYjdjOThiNzEwIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6ImEyMjQ2OWE0LTliMTQtNDRlNC05ZTllLWZjNDMwZmQ4Y2ExYSJ9.z08Y5v1D-2aRxwPq1CdsOlL4o2gTfSRhMiT9rnewTptHtJx5_HZQu-YJ2UQe1F0IxzjUkexmf_7ceyGN1Lw6DA";

// GROQ AI
const groq = new Groq({
  apiKey: "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"
});

// TURSO BILAN ISHLASH UCHUN FUNKSIYA
async function executeSQL(sql, args = []) {
  const formattedArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === "number") return { type: "integer", value: arg };
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
    throw new Error(data.message || `Status ${response.status}`);
  }

  const resObj = data.results?.[0];
  if (resObj?.type === "error") {
    throw new Error(resObj.error?.message || "SQL xatosi");
  }

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
app.get('/', (req, res) => {
  res.send("🚀 Backend va Turso to'liq ulandi!");
});

// 1. GROQ AI GENERATOR (llama-3.1-8b-instant bilan 100% bepul va tez)
app.post('/api/generate-ai-test', async (req, res) => {
  const { subject, topic, count, difficulty } = req.body;

  const prompt = `
Siz professional o'qituvchisiz. O'zbek tilida berilgan parametrlar bo'yicha test savollari tuzing:
Fan: ${subject}
Mavzu: ${topic}
Savollar soni: ${count || 5}
Qiyinlik darajasi: ${difficulty || 'orta'}

Qat'iy qoidalar:
- Har bir savolda aniq 3 ta variant bo'lsin: A, B, C. D varianti bo'lmasin!
- Faqat toza JSON massiv formatida javob bering, hech qanday markdown belgilarsiz (backticksiz).

Format:
[
  {
    "q": "Savol matni?",
    "options": ["A varianti matni", "B varianti matni", "C varianti matni"],
    "correct": 0
  }
]
Eslatma: "correct" to'g'ri variant indeksi (0 = A, 1 = B, 2 = C).
`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.5,
    });

    let text = completion.choices[0]?.message?.content || "[]";
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const questions = JSON.parse(text);

    res.json({ success: true, questions });
  } catch (error) {
    console.error("Groq xatosi:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. TESTNI SAQLASH
app.post('/api/tests', async (req, res) => {
  const { code, teacher, subject, topic, type, timer, data } = req.body;
  try {
    await executeSQL(
      "INSERT INTO tests (code, teacher, subject, topic, type, timer, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [code, teacher, subject, topic, type, timer || 0, JSON.stringify(data)]
    );
    res.json({ success: true, code });
  } catch (err) {
    console.error("Test saqlash xatosi:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. TESTNI KOD BO'YICHA OLISH
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

// 4. O'QUVCHI NATIJASINI SAQLASH
app.post('/api/results', async (req, res) => {
  const { test_code, student_name, student_class, score, total, percentage, answers } = req.body;
  try {
    await executeSQL(
      "INSERT INTO results (test_code, student_name, student_class, score, total, percentage, answers) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [test_code, student_name, student_class, score, total, percentage, JSON.stringify(answers || [])]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. NATIJALARNI KO'RISH
app.get('/api/results/:code', async (req, res) => {
  const code = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    const testRows = await executeSQL("SELECT * FROM tests WHERE code = ?", [code]);
    if (testRows.length === 0) return res.status(404).json({ success: false, message: "Test topilmadi!" });

    const test = testRows[0];
    test.data = JSON.parse(test.data);

    const studentRows = await executeSQL(
      "SELECT * FROM results WHERE test_code = ? ORDER BY submitted_at DESC",
      [code]
    );

    const students = studentRows.map(r => ({
      ...r,
      answers: JSON.parse(r.answers || "[]")
    }));

    res.json({ success: true, test, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. SEYF: KIRISH
app.post('/api/vault/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const rows = await executeSQL("SELECT * FROM vaults WHERE pin = ?", [pin]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Bunday PIN kodli seyf topilmadi!" });

    const vault = rows[0];
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
    const check = await executeSQL("SELECT pin FROM vaults WHERE pin = ?", [pin]);
    if (check.length > 0) {
      return res.status(400).json({ success: false, message: "Ushbu 6 xonali PIN kod allaqachon band! Boshqa PIN tanlang." });
    }
    await executeSQL(
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
    await executeSQL("UPDATE vaults SET notes = ? WHERE pin = ?", [JSON.stringify(notes), pin]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda muvaffaqiyatli ishga tushdi`);
});
