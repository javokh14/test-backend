const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// 1. TURSO ULANISHI (Siz bergan kalitlar bilan)
const db = createClient({
  url: "libsql://test-db-javokh14.aws-ap-northeast-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI5MDYzMDUsImlkIjoiMDFhMTcxOGEtZDYwMS03M2Q5LTg5ODktYzgwYjdjOThiNzEwIiwia2lkIjoiZElaN0NzZExlZXZIZkJwU29vWW9nVGNrd3NMczRXSG1LT0x0aTMzT0tPayIsInJpZCI6ImEyMjQ2OWE0LTliMTQtNDRlNC05ZTllLWZjNDMwZmQ4Y2ExYSJ9.NR7acD5Ucyjyr9eOYjLsQ5aLJGO8xIzyIpL9QqqUxbziCrZYl65xN1MrUjy5A1fW8o-tONVwKG69xnlShO_KBQ"
});

// 2. GROQ AI ULANISHI (Siz bergan kalit bilan)
const groq = new Groq({
  apiKey: "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"
});

// Bazadagi jadvallarni avtomatik yaratish
async function initDB() {
  try {
    // Testlar jadvali
    await db.execute(`
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

    // Natijalar jadvali
    await db.execute(`
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

    // Seyflar jadvali (6 xonali PIN)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS vaults (
        pin TEXT PRIMARY KEY,
        owner TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Turso bazasi muvaffaqiyatli ulandi va jadvallar tayyor!");
  } catch (err) {
    console.error("❌ Turso ulanishida xatolik:", err);
  }
}
initDB();

// --- API ENDPOINTLAR ---

// 1. GROQ ORQALI TEST GENERATSIYA QILISH
app.post('/api/generate-ai-test', async (req, res) => {
  const { subject, topic, count, difficulty } = req.body;

  const prompt = `
Siz professional o'qituvchisiz. O'zbek tilida berilgan parametrlarga mos test savollari tuzing.
Fan: ${subject}
Mavzu: ${topic}
Savollar soni: ${count || 5}
Qiyinlik darajasi: ${difficulty || 'orta'}

Qat'iy qoida:
- Har bir savolda FAQAT 3 ta variant bo'lsin (A, B, C). D varianti bo'lmasin!
- Toza JSON formatida javob bering, hech qanday markdown belgilarsiz (backtick yoki json so'zisiz).

Kutilayotgan JSON formati:
[
  {
    "q": "Savol matni",
    "options": ["Variant A matni", "Variant B matni", "Variant C matni"],
    "correct": 0,
    "expl": "Nega aynan shu to'g'ri ekanligi haqida qisqa tushuntirish"
  }
]
Eslatma: "correct" maydoni to'g'ri variant indeksini bildiradi (0 = A, 1 = B, 2 = C).
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

// 2. TESTNI SAQLASH
app.post('/api/tests', async (req, res) => {
  const { code, teacher, subject, topic, type, timer, data } = req.body;
  try {
    await db.execute({
      sql: "INSERT INTO tests (code, teacher, subject, topic, type, timer, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [code, teacher, subject, topic, type, timer, JSON.stringify(data)]
    });
    res.json({ success: true, code });
  } catch (err) {
    console.error("Test saqlash xatosi:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. TESTNI KOD BO'YICHA OLISH (O'quvchi kirganda)
app.get('/api/tests/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const rs = await db.execute({
      sql: "SELECT * FROM tests WHERE code = ?",
      args: [code]
    });
    if (rs.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Test topilmadi!" });
    }
    const test = rs.rows[0];
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
    await db.execute({
      sql: `INSERT INTO results (test_code, student_name, student_class, score, total, percentage, answers)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [test_code, student_name, student_class, score, total, percentage, JSON.stringify(answers)]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. NATIJALARNI KO'RISH ({code} yoki {code}result)
app.get('/api/results/:code', async (req, res) => {
  let code = req.params.code.toLowerCase().replace('result', '').trim();
  try {
    // Test ma'lumoti
    const testRs = await db.execute({
      sql: "SELECT * FROM tests WHERE code = ?",
      args: [code]
    });

    if (testRs.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Test topilmadi!" });
    }

    const test = testRs.rows[0];
    test.data = JSON.parse(test.data);

    // O'quvchilar natijalari
    const resultsRs = await db.execute({
      sql: "SELECT * FROM results WHERE test_code = ? ORDER BY submitted_at DESC",
      args: [code]
    });

    const students = resultsRs.rows.map(r => ({
      ...r,
      answers: JSON.parse(r.answers || "[]")
    }));

    res.json({ success: true, test, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. QULFLI QAYDLAR (PIN bo'yicha kirish yoki yangi ochish)
app.post('/api/vault/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const rs = await db.execute({
      sql: "SELECT * FROM vaults WHERE pin = ?",
      args: [pin]
    });
    if (rs.rows.length === 0) {
      return res.status(404).json({ success: false, message: "PIN kod topilmadi!" });
    }
    const vault = rs.rows[0];
    vault.notes = JSON.parse(vault.notes || "[]");
    res.json({ success: true, vault });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vault/register', async (req, res) => {
  const { pin, owner } = req.body;
  try {
    const check = await db.execute({
      sql: "SELECT pin FROM vaults WHERE pin = ?",
      args: [pin]
    });
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Ushbu 6 xonali PIN kod allaqachon band! Boshqa PIN tanlang." });
    }
    await db.execute({
      sql: "INSERT INTO vaults (pin, owner, notes) VALUES (?, ?, ?)",
      args: [pin, owner, JSON.stringify([])]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vault/save-note', async (req, res) => {
  const { pin, notes } = req.body;
  try {
    await db.execute({
      sql: "UPDATE vaults SET notes = ? WHERE pin = ?",
      args: [JSON.stringify(notes), pin]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server ishga tushdi: Port ${PORT}`);
});