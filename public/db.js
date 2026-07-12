const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

const DB = {
  client: supabaseClient,

  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  onAuthChange(callback) {
    supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  },

  signInWithGoogle() {
    return supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  },

  signInWithEmail(email) {
    return supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
  },

  signOut() {
    return supabaseClient.auth.signOut();
  },

  async ensureProgress(userId) {
    const { data } = await supabaseClient
      .from("progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data;

    const { data: created, error } = await supabaseClient
      .from("progress")
      .insert({ user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return created;
  },

  async fetchAll(userId) {
    const [{ data: decks, error: deckErr }, { data: cards, error: cardErr }, progress] = await Promise.all([
      supabaseClient.from("decks").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseClient.from("cards").select("*").eq("user_id", userId).order("position", { ascending: true }),
      this.ensureProgress(userId),
    ]);
    if (deckErr) throw deckErr;
    if (cardErr) throw cardErr;

    const decksWithCards = (decks || []).map((d) => ({
      ...d,
      cards: (cards || []).filter((c) => c.deck_id === d.id),
    }));

    return { decks: decksWithCards, progress };
  },

  async createDeck(userId, deck) {
    const { data: deckRow, error: deckErr } = await supabaseClient
      .from("decks")
      .insert({
        user_id: userId,
        title: deck.title,
        summary: deck.summary,
        source_files: deck.sourceFiles,
      })
      .select()
      .single();
    if (deckErr) throw deckErr;

    const cardsPayload = deck.cards.map((c, i) => ({
      deck_id: deckRow.id,
      user_id: userId,
      question: c.question,
      answer: c.answer,
      topic: c.topic,
      status: "new",
      favorite: false,
      flagged: false,
      note: "",
      position: i,
    }));

    const { data: cardRows, error: cardErr } = await supabaseClient
      .from("cards")
      .insert(cardsPayload)
      .select();
    if (cardErr) throw cardErr;

    return { ...deckRow, cards: cardRows };
  },

  updateDeck(deckId, patch) {
    return supabaseClient.from("decks").update(patch).eq("id", deckId);
  },

  deleteDeck(deckId) {
    return supabaseClient.from("decks").delete().eq("id", deckId);
  },

  updateCard(cardId, patch) {
    return supabaseClient.from("cards").update(patch).eq("id", cardId);
  },

  async reorderCards(rows) {
    await Promise.all(rows.map((r) => supabaseClient.from("cards").update({ position: r.position }).eq("id", r.id)));
  },

  resetDeckCards(deckId) {
    return supabaseClient.from("cards").update({ status: "new" }).eq("deck_id", deckId);
  },

  updateProgress(userId, patch) {
    return supabaseClient.from("progress").update(patch).eq("user_id", userId);
  },
};