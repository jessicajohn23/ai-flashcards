require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const { extractText, generateDeck, MAX_CHARS_PER_FILE, MAX_TOTAL_CHARS } = require("./lib/deckGenerator");
const { verifyToken } = require("./lib/verifyAuth");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GROQ_API_KEY) {
  console.warn("\n⚠️  GROQ_API_KEY is not set. Copy .env.example to .env and add your free Groq key.\n");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 15 },
});

async function requireAuth(req, res, next) {
  const auth = await verifyToken(req.headers.authorization);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  req.userId = auth.userId;
  next();
}

app.post("/api/generate", requireAuth, upload.array("files", 15), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "Upload at least one file." });
    }

    const numCards = Math.min(40, Math.max(1, parseInt(req.body.numCards, 10) || 20));
    const deckHint = (req.body.deckName || "").trim();

    const extracted = [];
    const skipped = [];

    for (const file of files) {
      const result = await extractText(file);
      if (typeof result === "string") {
        const trimmed = result.trim().slice(0, MAX_CHARS_PER_FILE);
        if (trimmed.length < 20) {
          skipped.push({ name: file.originalname, reason: "No readable text found" });
        } else {
          extracted.push({ name: file.originalname, text: trimmed });
        }
      } else {
        skipped.push({ name: file.originalname, reason: result.error });
      }
    }

    if (extracted.length === 0) {
      return res.status(400).json({ error: "None of the uploaded files could be read.", skipped });
    }

    let combined = extracted.map((f) => `--- FILE: ${f.name} ---\n${f.text}`).join("\n\n");
    if (combined.length > MAX_TOTAL_CHARS) combined = combined.slice(0, MAX_TOTAL_CHARS);

    const deck = await generateDeck(combined, numCards, deckHint);
    res.json({ ...deck, sourceFiles: extracted.map((f) => f.name), skipped });
  } catch (err) {
    console.error(err);
    const msg = err.message || "";
    if (msg.includes("Groq API error (413")) {
      return res.status(413).json({
        error: "That's too much text for the free tier's per-minute limit. Try fewer flashcards or shorter/fewer documents.",
      });
    }
    if (msg.includes("Groq API error (429")) {
      return res.status(429).json({ error: "Free tier rate limit hit — wait about a minute and try again." });
    }
    res.status(500).json({ error: "Something went wrong generating the deck." });
  }
});

app.listen(PORT, () => {
  console.log(`✨ Neon Recall running at http://localhost:${PORT}`);
});