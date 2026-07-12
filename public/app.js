/* ============================================================
   NEON RECALL: app logic
   State is loaded from / persisted to Supabase (see db.js).
   `state` is an in-memory cache used to render instantly; every
   mutation updates it locally AND fires the matching Supabase
   write so other devices see the change next time they load.
   ============================================================ */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const now = new Date(todayStr() + "T00:00:00");
  return Math.round((now - then) / 86400000);
}

function defaultState() {
  return {
    decks: [],
    progress: { xp: 0, streak: 0, best_streak: 0, last_active_date: null, activity: {} },
  };
}

let state = defaultState();
let currentUser = null;

/* ------------------------------------------------------------
   TOAST
   ------------------------------------------------------------ */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   AUTH
   ============================================================ */
function showAuthGate() { document.getElementById("authGate").hidden = false; }
function hideAuthGate() { document.getElementById("authGate").hidden = true; }
function showLoading() { document.getElementById("dataLoading").hidden = false; }
function hideLoading() { document.getElementById("dataLoading").hidden = true; }

function renderUserChip(user) {
  const chip = document.getElementById("userChip");
  chip.hidden = false;
  document.getElementById("userEmail").textContent = user.email || "Signed in";
  document.getElementById("userAvatar").textContent = (user.email || "?")[0].toUpperCase();
}

async function onSignedIn(user) {
  console.log("[NeonRecall] session detected for", user.email);
  currentUser = user;
  hideAuthGate();
  renderUserChip(user);
  showLoading();
  try {
    const { decks, progress } = await DB.fetchAll(user.id);
    state.decks = decks;
    state.progress = progress;
  } catch (err) {
    console.error("[NeonRecall] fetchAll failed:", err);
    toast("⚠️ Couldn't load your decks — try refreshing.");
  }
  hideLoading();
  renderTopbar();
  switchView("home");
}

async function initAuth() {
  // Register the listener FIRST. If we check getSession() before this, there's a
  // race: a session created by an in-flight OAuth/magic-link redirect can fire its
  // SIGNED_IN event before we're listening for it, and we'd miss it entirely.
  DB.onAuthChange(async (session) => {
    if (session && (!currentUser || currentUser.id !== session.user.id)) {
      await onSignedIn(session.user);
    } else if (!session && currentUser) {
      currentUser = null;
      state = defaultState();
      document.getElementById("userChip").hidden = true;
      showAuthGate();
    }
  });

  const session = await DB.getSession();
  if (session) await onSignedIn(session.user);
}

document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("authStatus");
  statusEl.textContent = "";
  try {
    const { error } = await DB.signInWithGoogle();
    if (error) statusEl.textContent = error.message;
  } catch (err) {
    console.error("[NeonRecall] Google sign-in threw:", err);
    statusEl.textContent = "Something went wrong reaching Supabase — check the console for details.";
  }
});

document.getElementById("emailSignInBtn").addEventListener("click", async () => {
  const email = document.getElementById("authEmail").value.trim();
  const statusEl = document.getElementById("authStatus");
  if (!email) { statusEl.textContent = "Enter your email first."; return; }
  statusEl.textContent = "Sending magic link…";
  try {
    const { error } = await DB.signInWithEmail(email);
    statusEl.textContent = error ? error.message : "Check your inbox for a sign-in link ✉️";
  } catch (err) {
    console.error("[NeonRecall] Magic link send threw:", err);
    statusEl.textContent = "Something went wrong reaching Supabase — check the console for details.";
  }
});

document.getElementById("userChip").addEventListener("click", async () => {
  if (confirm("Sign out of Neon Recall?")) await DB.signOut();
});

/* ------------------------------------------------------------
   NAVIGATION
   ------------------------------------------------------------ */
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "decks") renderDecks();
  if (name === "progress") renderProgress();
  if (name === "home") renderDueSection();
}

document.getElementById("mainNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn) switchView(btn.dataset.view);
});

function renderTopbar() {
  document.getElementById("xpStreakVal").textContent = state.progress.streak;
  document.getElementById("xpLevelVal").textContent = levelFromXP(state.progress.xp);
}

function levelFromXP(xp) {
  return Math.floor(xp / 100) + 1;
}

/* ------------------------------------------------------------
   GAMIFICATION HELPERS
   ------------------------------------------------------------ */
function recordActivityToday() {
  const today = todayStr();
  state.progress.activity[today] = (state.progress.activity[today] || 0) + 1;

  const last = state.progress.last_active_date;
  const lastDay = last ? last.slice(0, 10) : null;
  if (lastDay !== today) {
    state.progress.streak = lastDay === daysAgoStr(1) ? state.progress.streak + 1 : 1;
    state.progress.last_active_date = today;
    state.progress.best_streak = Math.max(state.progress.best_streak, state.progress.streak);
  }
}

function syncProgress() {
  if (!currentUser) return;
  DB.updateProgress(currentUser.id, {
    xp: state.progress.xp,
    streak: state.progress.streak,
    best_streak: state.progress.best_streak,
    last_active_date: state.progress.last_active_date,
    activity: state.progress.activity,
  }).then(({ error }) => { if (error) toast("⚠️ Sync failed — changes stayed local"); });
}

function persistCard(card, patch) {
  DB.updateCard(card.id, patch).then(({ error }) => { if (error) toast("⚠️ Sync failed — changes stayed local"); });
}

/* ============================================================
   HOME / UPLOAD
   ============================================================ */
let selectedFiles = [];

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", () => addFiles(fileInput.files));

function addFiles(fileListObj) {
  for (const f of fileListObj) {
    if (!selectedFiles.some((sf) => sf.name === f.name && sf.size === f.size)) {
      selectedFiles.push(f);
    }
  }
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = "";
  selectedFiles.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>📎 ${escapeHtml(f.name)}</span>`;
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.addEventListener("click", () => { selectedFiles.splice(i, 1); renderFileList(); });
    li.appendChild(rm);
    fileList.appendChild(li);
  });
}

const generateBtn = document.getElementById("generateBtn");
const uploadError = document.getElementById("uploadError");

const loadingMessages = [
  "Reading your files…",
  "Distilling the key ideas…",
  "Writing flashcards…",
  "Polishing the deck…",
];

generateBtn.addEventListener("click", async () => {
  uploadError.textContent = "";
  if (!currentUser) { uploadError.textContent = "Sign in first."; return; }
  if (selectedFiles.length === 0) {
    uploadError.textContent = "Add at least one file first.";
    return;
  }
  const numCards = document.getElementById("numCards").value;
  const deckName = document.getElementById("deckName").value;

  const form = new FormData();
  selectedFiles.forEach((f) => form.append("files", f));
  form.append("numCards", numCards);
  form.append("deckName", deckName);

  generateBtn.disabled = true;
  let msgIndex = 0;
  document.querySelector("#generateBtn .btn-label").textContent = "⚡ " + loadingMessages[0];
  const msgInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % loadingMessages.length;
    document.querySelector("#generateBtn .btn-label").textContent = "⚡ " + loadingMessages[msgIndex];
  }, 1800);

  try {
    const session = await DB.getSession();
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      body: form,
    });
    const data = await res.json();
    clearInterval(msgInterval);
    generateBtn.disabled = false;
    document.querySelector("#generateBtn .btn-label").textContent = "⚡ Generate Deck";

    if (!res.ok) {
      uploadError.textContent = data.error || "Something went wrong.";
      return;
    }
    if (data.skipped && data.skipped.length) {
      toast(`Skipped ${data.skipped.length} file(s) we couldn't read`);
    }

    const deckDraft = {
      title: data.title || deckName || "Untitled deck",
      summary: data.summary || "",
      sourceFiles: data.sourceFiles || [],
      cards: (data.flashcards || []).map((c) => ({
        question: c.question,
        answer: c.answer,
        topic: c.topic || "General",
      })),
    };

    const savedDeck = await DB.createDeck(currentUser.id, deckDraft);
    state.decks.unshift(savedDeck);

    selectedFiles = [];
    renderFileList();
    document.getElementById("deckName").value = "";

    document.getElementById("readyDeckTitle").textContent = savedDeck.title;
    document.getElementById("readyDeckCount").textContent = `${savedDeck.cards.length} cards ready to study`;
    document.getElementById("readyOverlay").hidden = false;
    document.getElementById("readyOverlay").dataset.deckId = savedDeck.id;
  } catch (err) {
    console.error(err);
    clearInterval(msgInterval);
    generateBtn.disabled = false;
    document.querySelector("#generateBtn .btn-label").textContent = "⚡ Generate Deck";
    uploadError.textContent = "Couldn't reach the server. Is it running?";
  }
});

document.getElementById("openNewDeckBtn").addEventListener("click", () => {
  const deckId = document.getElementById("readyOverlay").dataset.deckId;
  document.getElementById("readyOverlay").hidden = true;
  openDeck(deckId);
});
document.getElementById("stayHomeBtn").addEventListener("click", () => {
  document.getElementById("readyOverlay").hidden = true;
});

/* ---- Due for review, shown on Home ---- */
function renderDueSection() {
  const due = state.decks.filter((d) => daysSince(d.last_reviewed) >= 3 || d.last_reviewed === null);
  const section = document.getElementById("dueSection");
  const list = document.getElementById("dueList");
  if (due.length === 0 || state.decks.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = "";
  due.slice(0, 4).forEach((d) => {
    const row = document.createElement("div");
    row.className = "due-item";
    const label = d.last_reviewed === null ? "Never studied" : `${daysSince(d.last_reviewed)}d since last review`;
    row.innerHTML = `<span>${escapeHtml(d.title)} <span style="color:var(--text-faint); font-size:12px;">— ${label}</span></span>`;
    const btn = document.createElement("button");
    btn.textContent = "Open";
    btn.addEventListener("click", () => openDeck(d.id));
    row.appendChild(btn);
    list.appendChild(row);
  });
}

/* ============================================================
   DECKS VIEW
   ============================================================ */
function renderDecks() {
  const grid = document.getElementById("deckGrid");
  const hint = document.getElementById("decksEmptyHint");
  grid.innerHTML = "";

  if (state.decks.length === 0) {
    hint.textContent = "No decks yet — head to Upload to generate your first one.";
    return;
  }
  hint.textContent = "Generated decks show up here.";

  state.decks.forEach((deck) => {
    const total = deck.cards.length;
    const known = deck.cards.filter((c) => c.status === "known").length;
    const pct = total ? Math.round((known / total) * 100) : 0;
    const isDue = daysSince(deck.last_reviewed) >= 3 || deck.last_reviewed === null;

    const card = document.createElement("div");
    card.className = "deck-card";
    card.innerHTML = `
      ${isDue ? '<span class="deck-due-tag">REVIEW</span>' : ""}
      <div class="deck-card-topic">${escapeHtml((deck.source_files || [])[0] || "Deck")}</div>
      <h3>${escapeHtml(deck.title)}</h3>
      <div class="deck-card-bar"><div class="deck-card-bar-fill" style="width:${pct}%"></div></div>
      <div class="deck-card-meta"><span>${known}/${total} mastered</span><span>${pct}%</span></div>
      <div class="deck-card-actions">
        <button class="deck-open-btn">📂 Open deck</button>
        <button class="deck-icon-btn" title="Delete deck">🗑</button>
      </div>
    `;
    card.querySelector(".deck-open-btn").addEventListener("click", () => openDeck(deck.id));
    card.querySelector(".deck-icon-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${deck.title}"? This can't be undone.`)) return;
      const { error } = await DB.deleteDeck(deck.id);
      if (error) { toast("⚠️ Couldn't delete deck"); return; }
      state.decks = state.decks.filter((d) => d.id !== deck.id);
      renderDecks();
      toast("Deck deleted");
    });
    grid.appendChild(card);
  });
}

/* ============================================================
   STUDY VIEW
   ============================================================ */
let currentDeckId = null;
let currentFilter = "all";
let queue = [];
let sessionIndex = 0;
let liveStreak = 0;
let sessionStats = { reviewed: 0, gotIt: 0, xp: 0 };
let flipped = false;
let timerInterval = null;

function currentDeck() {
  return state.decks.find((d) => d.id === currentDeckId);
}

function openDeck(deckId) {
  currentDeckId = deckId;
  currentFilter = "all";
  document.querySelectorAll(".chip[data-filter]").forEach((c) => c.classList.toggle("active", c.dataset.filter === "all"));
  buildQueue();
  sessionStats = { reviewed: 0, gotIt: 0, xp: 0 };
  liveStreak = 0;
  updateLiveStreakBadge();

  const deck = currentDeck();
  document.getElementById("studyDeckTitle").textContent = deck.title;
  document.getElementById("studyDeckSub").textContent = `${deck.cards.length} cards · ${(deck.source_files || []).join(", ")}`;

  switchView("study");
  renderStack();
}

function buildQueue() {
  const deck = currentDeck();
  if (!deck) return;
  let cards = deck.cards;
  if (currentFilter === "known") cards = cards.filter((c) => c.status === "known");
  else if (currentFilter === "unknown") cards = cards.filter((c) => c.status === "unknown");
  else if (currentFilter === "favorite") cards = cards.filter((c) => c.favorite);
  else if (currentFilter === "flagged") cards = cards.filter((c) => c.flagged);
  queue = cards.map((c) => c.id);
  sessionIndex = 0;
  flipped = false;
}

document.getElementById("filterRow").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip[data-filter]");
  if (!chip) return;
  currentFilter = chip.dataset.filter;
  document.querySelectorAll(".chip[data-filter]").forEach((c) => c.classList.toggle("active", c === chip));
  buildQueue();
  renderStack();
});

function getCardById(id) {
  return currentDeck().cards.find((c) => c.id === id);
}

function renderStack() {
  const stackEl = document.getElementById("cardStack");
  const emptyEl = document.getElementById("stackEmpty");
  const progressEl = document.getElementById("stackProgress");
  stackEl.innerHTML = "";

  if (sessionIndex >= queue.length) {
    emptyEl.hidden = false;
    stackEl.style.display = "none";
    progressEl.textContent = "";
    updateActionStates(null);
    return;
  }
  emptyEl.hidden = true;
  stackEl.style.display = "block";

  const visibleIds = queue.slice(sessionIndex, sessionIndex + 3);
  visibleIds.forEach((id, layer) => {
    const card = getCardById(id);
    const el = document.createElement("div");

    if (layer > 0) {
      // Background cards are a pure depth cue — no text, so nothing peeks through confusingly.
      el.className = `flashcard stack-${layer}`;
      el.innerHTML = `<div class="flashcard-inner"><div class="flashcard-face front blank-face"></div></div>`;
      stackEl.appendChild(el);
      return;
    }

    el.className = "flashcard" + (flipped ? " flipped" : "");
    el.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-face front">
          <span class="face-tag">Question</span>
          <span class="face-topic">${escapeHtml(card.topic)}</span>
          <div class="face-text">${escapeHtml(card.question)}</div>
          <span class="face-hint">tap to flip</span>
          ${faceBadges(card)}
        </div>
        <div class="flashcard-face back">
          <span class="face-tag">Answer</span>
          <span class="face-topic">${escapeHtml(card.topic)}</span>
          <div class="face-text">${escapeHtml(card.answer)}</div>
          <span class="face-hint">tap to flip back</span>
          ${faceBadges(card)}
        </div>
      </div>
    `;
    el.addEventListener("click", toggleFlip);
    stackEl.appendChild(el);
  });

  progressEl.textContent = `Card ${sessionIndex + 1} of ${queue.length} · ${currentFilter}`;
  updateActionStates(getCardById(queue[sessionIndex]));
}

function faceBadges(card) {
  let badges = "";
  if (card.flagged) badges += "⚑";
  if (card.favorite) badges += " ★";
  const badgeHtml = badges ? `<span class="face-badges">${badges}</span>` : "";
  const noteHtml = card.note ? `<span class="face-note-dot">🗒</span>` : "";
  return badgeHtml + noteHtml;
}

function updateActionStates(card) {
  document.getElementById("flagBtn").classList.toggle("active-flag", !!card?.flagged);
  document.getElementById("favBtn").classList.toggle("active-fav", !!card?.favorite);
}

function toggleFlip() {
  flipped = !flipped;
  const top = document.querySelector(".flashcard:not(.stack-1):not(.stack-2)");
  if (top) top.classList.toggle("flipped", flipped);
}
document.getElementById("flipBtn").addEventListener("click", toggleFlip);

function updateLiveStreakBadge() {
  const badge = document.getElementById("liveStreakBadge");
  if (liveStreak >= 3) {
    badge.hidden = false;
    document.getElementById("liveStreakVal").textContent = liveStreak;
  } else {
    badge.hidden = true;
  }
}

function advance() {
  flipped = false;
  sessionIndex++;
  if (sessionIndex >= queue.length) finishSession();
  else renderStack();
}

document.getElementById("gotItBtn").addEventListener("click", () => {
  if (sessionIndex >= queue.length) return;
  const card = getCardById(queue[sessionIndex]);
  card.status = "known";
  persistCard(card, { status: "known" });

  liveStreak++;
  let gain = 10;
  if (liveStreak > 0 && liveStreak % 5 === 0) { gain += 15; toast(`🔥 ${liveStreak}-streak bonus! +15 XP`); }
  state.progress.xp += gain;
  sessionStats.xp += gain;
  sessionStats.reviewed++;
  sessionStats.gotIt++;
  recordActivityToday();
  syncProgress();
  renderTopbar();
  updateLiveStreakBadge();
  advance();
});

document.getElementById("dontKnowBtn").addEventListener("click", () => {
  if (sessionIndex >= queue.length) return;
  const card = getCardById(queue[sessionIndex]);
  card.status = "unknown";
  persistCard(card, { status: "unknown" });

  liveStreak = 0;
  sessionStats.reviewed++;
  recordActivityToday();
  syncProgress();
  renderTopbar();
  updateLiveStreakBadge();
  advance();
});

document.getElementById("nextBtn").addEventListener("click", () => advance());

document.getElementById("flagBtn").addEventListener("click", () => {
  if (sessionIndex >= queue.length) return;
  const card = getCardById(queue[sessionIndex]);
  card.flagged = !card.flagged;
  persistCard(card, { flagged: card.flagged });
  renderStack();
});

document.getElementById("favBtn").addEventListener("click", () => {
  if (sessionIndex >= queue.length) return;
  const card = getCardById(queue[sessionIndex]);
  card.favorite = !card.favorite;
  persistCard(card, { favorite: card.favorite });
  renderStack();
});

document.getElementById("backToDecks").addEventListener("click", () => {
  clearTimerInterval();
  switchView("decks");
});

/* ---- Shuffle / Reset / Delete ---- */
document.getElementById("shuffleBtn").addEventListener("click", () => {
  const deck = currentDeck();
  for (let i = deck.cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]];
  }
  DB.reorderCards(deck.cards.map((c, i) => ({ id: c.id, position: i })))
    .then(() => {})
    .catch(() => toast("⚠️ Sync failed — changes stayed local"));
  buildQueue();
  renderStack();
  toast("🔀 Shuffled");
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  if (!confirm("Reset known/unknown progress for this deck? Notes, favorites and flags stay put.")) return;
  const deck = currentDeck();
  deck.cards.forEach((c) => (c.status = "new"));
  const { error } = await DB.resetDeckCards(deck.id);
  if (error) toast("⚠️ Sync failed — changes stayed local");
  liveStreak = 0;
  updateLiveStreakBadge();
  buildQueue();
  renderStack();
  toast("↺ Progress reset");
});

document.getElementById("deleteDeckBtn").addEventListener("click", async () => {
  const deck = currentDeck();
  if (!confirm(`Delete "${deck.title}"? This can't be undone.`)) return;
  const { error } = await DB.deleteDeck(deck.id);
  if (error) { toast("⚠️ Couldn't delete deck"); return; }
  state.decks = state.decks.filter((d) => d.id !== deck.id);
  switchView("decks");
  toast("Deck deleted");
});

/* ---- Session complete ---- */
function finishSession() {
  clearTimerInterval();
  const deck = currentDeck();
  if (deck) {
    deck.last_reviewed = new Date().toISOString();
    DB.updateDeck(deck.id, { last_reviewed: deck.last_reviewed }).then(({ error }) => {
      if (error) toast("⚠️ Sync failed — changes stayed local");
    });
  }
  document.getElementById("completeHeadline").textContent =
    sessionStats.reviewed === 0 ? "No cards reviewed" : "Deck complete! 🎉";
  document.getElementById("completeStats").textContent =
    `${sessionStats.gotIt}/${sessionStats.reviewed} known this round · +${sessionStats.xp} XP earned`;
  document.getElementById("completeOverlay").hidden = false;
}
document.getElementById("completeCloseBtn").addEventListener("click", () => {
  document.getElementById("completeOverlay").hidden = true;
  switchView("decks");
});

/* ---- Sticky notes ---- */
document.getElementById("noteBtn").addEventListener("click", () => {
  if (sessionIndex >= queue.length) return;
  const card = getCardById(queue[sessionIndex]);
  document.getElementById("stickyText").value = card.note || "";
  document.getElementById("stickyOverlay").hidden = false;
  document.getElementById("stickyText").focus();
});
document.getElementById("stickyClose").addEventListener("click", () => {
  document.getElementById("stickyOverlay").hidden = true;
});
document.getElementById("stickySave").addEventListener("click", () => {
  if (sessionIndex < queue.length) {
    const card = getCardById(queue[sessionIndex]);
    card.note = document.getElementById("stickyText").value.trim();
    persistCard(card, { note: card.note });
    renderStack();
    toast("🗒 Note pinned");
  }
  document.getElementById("stickyOverlay").hidden = true;
});

/* ---- Summary modal ---- */
document.getElementById("summaryBtn").addEventListener("click", () => {
  const deck = currentDeck();
  document.getElementById("summaryModalTitle").textContent = deck.title + " — Summary";
  document.getElementById("summaryModalText").textContent = deck.summary || "No summary available.";
  document.getElementById("summaryOverlay").hidden = false;
});
document.getElementById("summaryClose").addEventListener("click", () => {
  document.getElementById("summaryOverlay").hidden = true;
});

/* ---- Timer ---- */
document.getElementById("timerBtn").addEventListener("click", () => {
  document.getElementById("timerOverlay").hidden = false;
});
document.getElementById("timerClose").addEventListener("click", () => {
  document.getElementById("timerOverlay").hidden = true;
});
document.getElementById("skipTimerBtn").addEventListener("click", () => {
  document.getElementById("timerOverlay").hidden = true;
});
document.querySelectorAll("#timerOverlay .chip[data-min]").forEach((chip) => {
  chip.addEventListener("click", () => {
    startTimer(parseInt(chip.dataset.min, 10));
    document.getElementById("timerOverlay").hidden = true;
  });
});
document.getElementById("cancelTimerBtn").addEventListener("click", clearTimerInterval);

function startTimer(minutes) {
  clearTimerInterval();
  let remaining = minutes * 60;
  const bar = document.getElementById("timerBar");
  const display = document.getElementById("timerDisplay");
  bar.hidden = false;
  updateTimerDisplay(remaining, display);
  timerInterval = setInterval(() => {
    remaining--;
    updateTimerDisplay(remaining, display);
    if (remaining <= 0) {
      clearTimerInterval();
      toast("⏱ Time's up!");
      finishSession();
    }
  }, 1000);
}
function updateTimerDisplay(remaining, display) {
  const m = Math.floor(remaining / 60).toString().padStart(2, "0");
  const s = (remaining % 60).toString().padStart(2, "0");
  display.textContent = `${m}:${s}`;
}
function clearTimerInterval() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  document.getElementById("timerBar").hidden = true;
}

/* ============================================================
   PROGRESS VIEW
   ============================================================ */
function renderProgress() {
  const xp = state.progress.xp;
  const level = levelFromXP(xp);
  const xpInLevel = xp % 100;

  document.getElementById("statXP").textContent = xp;
  document.getElementById("statStreak").textContent = state.progress.streak;
  document.getElementById("statBestStreak").textContent = state.progress.best_streak;
  const cardsKnown = state.decks.reduce((sum, d) => sum + d.cards.filter((c) => c.status === "known").length, 0);
  document.getElementById("statCardsKnown").textContent = cardsKnown;

  document.getElementById("levelNum").textContent = level;
  document.getElementById("levelXpText").textContent = `${xpInLevel} / 100 XP`;
  document.getElementById("levelBarFill").style.width = `${xpInLevel}%`;

  renderHeatmap();
  renderDeckStatsTable();
}

function renderHeatmap() {
  const el = document.getElementById("heatmap");
  el.innerHTML = "";
  for (let i = 34; i >= 0; i--) {
    const dateStr = daysAgoStr(i);
    const count = state.progress.activity[dateStr] || 0;
    let level = 0;
    if (count >= 10) level = 4;
    else if (count >= 6) level = 3;
    else if (count >= 3) level = 2;
    else if (count >= 1) level = 1;
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    cell.dataset.level = level;
    cell.title = `${dateStr}: ${count} card${count === 1 ? "" : "s"}`;
    el.appendChild(cell);
  }
}

function renderDeckStatsTable() {
  const el = document.getElementById("deckStatsTable");
  el.innerHTML = "";
  if (state.decks.length === 0) {
    el.innerHTML = `<p class="hero-sub">No decks yet.</p>`;
    return;
  }
  state.decks.forEach((deck) => {
    const known = deck.cards.filter((c) => c.status === "known").length;
    const unknown = deck.cards.filter((c) => c.status === "unknown").length;
    const favs = deck.cards.filter((c) => c.favorite).length;
    const row = document.createElement("div");
    row.className = "deck-stat-row";
    row.innerHTML = `
      <span class="dsr-title">${escapeHtml(deck.title)}</span>
      <span><span class="dsr-label">Known</span>${known}/${deck.cards.length}</span>
      <span><span class="dsr-label">Unknown</span>${unknown}</span>
      <span><span class="dsr-label">Favorites</span>${favs}</span>
    `;
    el.appendChild(row);
  });
}

/* ============================================================
   INIT
   ============================================================ */
initAuth();