// デッキ保存・戦績の永続化と一意ID採番
const DECKS_KEY = 'duelmasters.decks.v1';
const META_KEY = 'duelmasters.meta.v1';

let uidCounter = 1;

export function nextUid() {
  return uidCounter++;
}

// デッキIDはlocalStorageに永続化され複数セッションをまたいで共存するため、
// セッション毎にリセットされるnextUid()ではなく、常にグローバルに一意な値を発行する
export function newDeckId() {
  return `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makeDefaultMeta() {
  return { gamesPlayed: 0, wins: 0, losses: 0 };
}

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return makeDefaultMeta();
    return { ...makeDefaultMeta(), ...JSON.parse(raw) };
  } catch {
    return makeDefaultMeta();
  }
}

export function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* storage unavailable - ignore */
  }
}

export function makeDefaultDecks() {
  return { decks: [], activeDeckId: null };
}

export function loadDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (!raw) return makeDefaultDecks();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.decks)) return makeDefaultDecks();
    return parsed;
  } catch {
    return makeDefaultDecks();
  }
}

export function saveDecks(data) {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable - ignore */
  }
}
