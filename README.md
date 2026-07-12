# ⚡ Neon Recall

**Turn any document into a flashcard deck.** 
Upload notes, PDFs, slides; anything and pick how many cards you want. An LLM builds a study deck for you: exact card count, an AI-written summary, and a neon-dark, gamified interface to actually study it in.


##  Features

**Upload & generation**
- Drop in multiple files at once, mixed formats: PDF, DOCX, TXT, MD, CSV, JSON
- Set the *exact* number of flashcards you want; the AI is instructed (and server-checked) to
  hit that number precisely
- Files that can't be read (corrupt, unsupported, empty) are reported back individually instead
  of failing the whole upload
- AI also writes a standalone summary of the source material, readable independently of the cards

**Studying**
- Cards presented as a swipeable, stacked deck with a 3D flip animation (tap the card or hit Flip; both work)
- Score system: **Got it** scores a point and builds your streak; **Don't know it** is neutral; no penalty, ever
- Filter the deck by All / Unknown / Known / Favorites / Flagged
- Shuffle, reset progress, or delete a deck at any time
- Flag cards for later, mark favorites, skip with Next
- Personal sticky notes on any card; pinned, colored, styled like an actual sticky note
- Optional study timer (3/5/10/15 min); entirely optional, session ends gracefully if it runs out

**Gamification**
- XP for every correct answer, with bonus XP every 5-card streak in a session
- Live in-session streak counter with an animated badge
- Daily streak tracking (separate from in-session streaks) across days you actually studied
- Leveling system (100 XP per level) with a visual progress bar
- 5-week activity heatmap on the Progress page

**Organization**
- Decks overview: mastery %, cards known/total, at a glance
- "Due for review" surfaced on the home screen for decks you haven't touched in 3+ days or
  never studied
- Per-deck stats: known, unknown, favorites; all visible on the Progress page

**Accounts & sync**
- Sign in with Google or an email magic link (Supabase Auth), no passwords to manage
- Every deck, card, and stat syncs across devices via Supabase Postgres
- Row Level Security means your data is only ever visible to you, enforced at the database level


## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| AI generation | [Groq](https://groq.com): Llama 3.3 70B |
| Auth + database | [Supabase](https://supabase.com) |
| Backend (local) | Express (`server.js`) |
| Backend (prod) | Vercel Serverless Functions (`api/generate.js`) |
| File parsing | `pdf-parse`, `mammoth` |
| Hosting | Vercel |


## 🏗️ Architecture

```
Browser
  │
  ├─ public/db.js  ──────────────► Supabase (auth, decks, cards, progress)
  │                                 protected by Row Level Security
  │
  └─ public/app.js ──── POST /api/generate ────► lib/deckGenerator.js ──► Groq API
                          (with Supabase session                 lib/verifyAuth.js
                           token in Authorization header)         (verifies the session
                                                                    against Supabase)
```

The key design decision: **decks are never routed through the backend.** 
The frontend talks to Supabase directly for all reads/writes, protected by RLS policies (see `supabase/schema.sql`).
The only thing the backend does is the one operation that needs a secret API key; turning uploaded text into flashcards via Groq and it checks that the caller has a valid Supabase session before doing that, so the AI endpoint can't be hit by random visitors.

`server.js` (Express, for local dev) and `api/generate.js` (Vercel serverless function, for
production) are two thin entry points into the same shared logic in `lib/`, so there's one
source of truth instead of two implementations that could drift apart.



## 📁 Project structure

flashcard-ai/

├── lib/

│   ├── deckGenerator.js   --> file text extraction + Groq API call

│   └── verifyAuth.js      --> Supabase session verification

├── api/

│   └── generate.js        --> Vercel serverless function (production)

├── server.js              --> Express server (local dev)

├── supabase/

│   └── schema.sql         --> tables + Row Level Security policies

├── public/

│   ├── index.html

│   ├── style.css          --> neon/arcade design system

│   ├── config.js          --> Supabase URL + anon key

│   ├── db.js              --> Supabase data layer

│   └── app.js             --> study logic, gamification, UI state

├── vercel.json

├── package.json

└── .env.example


##  Run it

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd flashcard-ai
npm install
cp .env.example .env       # fill in GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm start
```
Open `http://localhost:3000`.


## 🗺️ Possible extensions

- Spaced repetition scheduling (SM-2) instead of the simple "3+ days since last review" rule
- Text-to-speech readback for audio flashcards
- Streamed generation so cards appear one-by-one instead of all at once
- Shareable/public decks


## Author

**Jessica John** 

[GitHub](https://github.com/jessicajohn23) · [LinkedIn](https://linkedin.com/in/jessicajohn07)
