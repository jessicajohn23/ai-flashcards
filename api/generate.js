const multer = require("multer");
const { extractText, generateDeck, MAX_CHARS_PER_FILE, MAX_TOTAL_CHARS } = require("../lib/deckGenerator");
const { verifyToken } = require("../lib/verifyAuth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 8 },
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => (result instanceof Error ? reject(result) : resolve(result)));
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await runMiddleware(req, res, upload.array("files", 8));
  } catch (err) {
    res.status(400).json({ error: "Upload failed, files may be too large (4MB each on this deployment)." });
    return;
  }

  const auth = await verifyToken(req.headers.authorization);
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const files = req.files || [];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one file." });
      return;
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
      res.status(400).json({ error: "None of the uploaded files could be read.", skipped });
      return;
    }

    let combined = extracted.map((f) => `--- FILE: ${f.name} ---\n${f.text}`).join("\n\n");
    if (combined.length > MAX_TOTAL_CHARS) combined = combined.slice(0, MAX_TOTAL_CHARS);

    const deck = await generateDeck(combined, numCards, deckHint);
    res.status(200).json({ ...deck, sourceFiles: extracted.map((f) => f.name), skipped });
  } catch (err) {
    console.error(err);
    const msg = err.message || "";
    if (msg.includes("Groq API error (413")) {
      res.status(413).json({
        error: "That's too much text for the free tier's per-minute limit. Try fewer flashcards or shorter/fewer documents.",
      });
      return;
    }
    if (msg.includes("Groq API error (429")) {
      res.status(429).json({ error: "Free tier rate limit hit, wait about a minute and try again." });
      return;
    }
    res.status(500).json({ error: "Something went wrong generating the deck." });
  }
};