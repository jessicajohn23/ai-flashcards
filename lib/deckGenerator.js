const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_CHARS_PER_FILE = 6000; // keeps prompt size sane per document
const MAX_TOTAL_CHARS = 16000; // Groq's free tier caps at 12k tokens/min (input+output combined)

/**
 * Pulls plain text out of whatever the user threw at us.
 * Falls back to a raw utf8 read for anything we don't have a parser for
 * (txt, md, csv, code files, etc). Truly binary/unreadable files are skipped.
 */
async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  try {
    if (ext === ".pdf") {
      const data = await pdfParse(file.buffer);
      return data.text;
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value;
    }

    if (ext === ".doc") {
      throw new Error("Legacy .doc files aren't supported — please save as .docx or .pdf");
    }

    const text = file.buffer.toString("utf8");
    const junkRatio = (text.match(/\uFFFD/g) || []).length / Math.max(text.length, 1);
    if (junkRatio > 0.05) {
      throw new Error("Unsupported or unreadable file format");
    }
    return text;
  } catch (err) {
    return { error: err.message || "Could not read this file" };
  }
}

async function generateDeck(sourceText, numCards, deckHint) {
  const tool = {
    type: "function",
    function: {
      name: "create_flashcard_deck",
      description:
        "Create a study deck of flashcards and a summary from source material.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "A short, clear title for this deck describing the chapter/topic covered (max 6 words).",
          },
          summary: {
            type: "string",
            description:
              "A well-organized 150-300 word summary of the source material, in plain prose paragraphs, that the learner can read independently of the flashcards.",
          },
          flashcards: {
            type: "array",
            description: `Exactly ${numCards} flashcards, no more and no fewer.`,
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The front of the card." },
                answer: { type: "string", description: "The back of the card — concise but complete." },
                topic: {
                  type: "string",
                  description: "A short sub-topic/category label for filtering, e.g. 'Definitions', 'Formulas'.",
                },
              },
              required: ["question", "answer", "topic"],
            },
          },
        },
        required: ["title", "summary", "flashcards"],
      },
    },
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: Math.min(4000, 500 + numCards * 60),
      messages: [
        {
          role: "system",
          content:
            "You are an expert study coach turning source documents into high-quality active-recall flashcards. " +
            "Questions should test understanding, not just word-matching. Vary question types (definitions, 'why', 'how', application, comparison). " +
            "Answers should be self-contained and correct on their own. You MUST produce exactly the requested number of flashcards — not fewer, not more. " +
            "Base everything strictly on the provided source text; do not invent facts not supported by it. " +
            "Always respond by calling the create_flashcard_deck tool — never reply in plain text.",
        },
        {
          role: "user",
          content: `${
            deckHint ? `Suggested deck topic/name: "${deckHint}"\n\n` : ""
          }Generate exactly ${numCards} flashcards and a summary from this source material:\n\n${sourceText}`,
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "create_flashcard_deck" } },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Groq API error (${response.status}): ${errBody.slice(0, 300)}`);
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Model did not return structured flashcard data.");

  let data;
  try {
    data = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("Model returned malformed JSON — try again.");
  }

  if (Array.isArray(data.flashcards) && data.flashcards.length > numCards) {
    data.flashcards = data.flashcards.slice(0, numCards);
  }

  return data;
}

module.exports = { extractText, generateDeck, MAX_CHARS_PER_FILE, MAX_TOTAL_CHARS };