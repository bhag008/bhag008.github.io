// 永続化状態管理（ゴールド・コレクション・デッキ・デイリーボーナス）
import { getCard } from "./cards.js";

const STORAGE_KEY = "arcanabattle.state.v1";
const DECK_SIZE = 30;
const MAX_COPIES = 2;
const MAX_DECK_SLOTS = 5;

const DEFAULT_DECK = [
  "std_squire", "std_squire",
  "std_shield", "std_shield",
  "std_spark",
  "std_scout",
  "std_archer", "std_archer",
  "std_healspring",
  "std_wolfpack",
  "std_guard", "std_guard",
  "std_knight", "std_knight",
  "std_bear",
  "std_fireball_small",
  "std_raider", "std_raider",
  "std_veteran", "std_veteran",
  "std_cleric",
  "std_lightning",
  "std_ogre",
  "std_dragonet",
  "std_healall",
  "std_giant_wolf",
  "std_golem",
  "std_meteor",
  "std_titan",
  "std_lastword",
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultState() {
  return {
    version: 1,
    gold: 300,
    collection: {},
    decks: [{ name: "デッキ1", cards: [...DEFAULT_DECK] }],
    activeDeckIndex: 0,
    lastDailyBonusDate: null,
    stats: { wins: 0, losses: 0 },
    updatedAt: 0,
  };
}

let state = load();
const saveListeners = [];

// 旧形式（単一デッキ = state.deck）のセーブデータを複数デッキ形式に移行する。
function migrateShape(parsed) {
  const merged = { ...defaultState(), ...parsed, stats: { ...defaultState().stats, ...(parsed.stats || {}) } };
  if (!Array.isArray(merged.decks) || !merged.decks.length) {
    if (Array.isArray(parsed.deck)) {
      merged.decks = [{ name: "デッキ1", cards: parsed.deck }];
      merged.activeDeckIndex = 0;
    }
  }
  delete merged.deck;
  return merged;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrateShape(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function save() {
  state.updatedAt = Date.now();
  persistLocal();
  for (const fn of saveListeners) fn(state);
}

// 他モジュール（クラウド同期など）が状態の変化を購読するためのフック。
// state.jsはこれを呼ぶ側の実装（Firebase等）を一切知らない＝オフラインでも本体機能に影響しない。
export function onStateSaved(fn) {
  saveListeners.push(fn);
}

// クラウドから取得したデータが手元より新しい場合のみ反映する（タイムスタンプ比較）。
export function applyRemoteState(remote) {
  if (!remote) return false;
  if ((remote.updatedAt || 0) <= (state.updatedAt || 0)) return false;
  state = migrateShape(remote);
  persistLocal();
  return true;
}

export function getState() {
  return state;
}

export function getGold() {
  return state.gold;
}

export function addGold(amount) {
  state.gold += amount;
  save();
  return state.gold;
}

export function spendGold(amount) {
  if (state.gold < amount) return false;
  state.gold -= amount;
  save();
  return true;
}

// スタンダードカードは常に所持数MAX_COPIES扱い。拡張カードはコレクション数を参照。
export function ownedCount(cardId) {
  const card = getCard(cardId);
  if (!card) return 0;
  if (card.set === "standard") return MAX_COPIES;
  return state.collection[cardId] || 0;
}

export function addCardsToCollection(cardIds) {
  for (const id of cardIds) {
    state.collection[id] = (state.collection[id] || 0) + 1;
  }
  save();
}

export function getCollectionEntries() {
  // 所持している拡張カードの一覧 [{cardId, count}]
  return Object.entries(state.collection)
    .filter(([, count]) => count > 0)
    .map(([cardId, count]) => ({ cardId, count }));
}

export function claimDailyBonusIfAvailable() {
  const today = todayStr();
  if (state.lastDailyBonusDate === today) return 0;
  state.lastDailyBonusDate = today;
  const bonus = 50;
  state.gold += bonus;
  save();
  return bonus;
}

export function isDailyBonusAvailable() {
  return state.lastDailyBonusDate !== todayStr();
}

export function getDecks() {
  return state.decks.map((d) => ({ name: d.name, cards: [...d.cards] }));
}

export function getActiveDeckIndex() {
  return state.activeDeckIndex;
}

// 対戦で実際に使うデッキ（使用中デッキ）。
export function getActiveDeck() {
  const slot = state.decks[state.activeDeckIndex] || state.decks[0];
  return slot ? [...slot.cards] : [];
}

export function setActiveDeckIndex(index) {
  if (!state.decks[index]) return;
  state.activeDeckIndex = index;
  save();
}

export function saveDeckSlot(index, cardIds) {
  if (!state.decks[index]) return;
  state.decks[index] = { ...state.decks[index], cards: [...cardIds] };
  save();
}

// 新しい空のデッキ枠を追加する。上限（5枠）に達している場合は-1を返す。
export function addDeckSlot() {
  if (state.decks.length >= MAX_DECK_SLOTS) return -1;
  state.decks.push({ name: `デッキ${state.decks.length + 1}`, cards: [] });
  save();
  return state.decks.length - 1;
}

// デッキ枠を削除する。最低1枠は残るため、残り1枠のときは何もしない。
export function deleteDeckSlot(index) {
  if (state.decks.length <= 1 || !state.decks[index]) return false;
  state.decks.splice(index, 1);
  if (state.activeDeckIndex >= state.decks.length) {
    state.activeDeckIndex = state.decks.length - 1;
  } else if (state.activeDeckIndex > index) {
    state.activeDeckIndex -= 1;
  }
  save();
  return true;
}

export function validateDeck(cardIds) {
  const errors = [];
  if (cardIds.length !== DECK_SIZE) {
    errors.push(`デッキは${DECK_SIZE}枚である必要があります（現在${cardIds.length}枚）`);
  }
  const counts = {};
  for (const id of cardIds) counts[id] = (counts[id] || 0) + 1;
  for (const [id, count] of Object.entries(counts)) {
    if (count > MAX_COPIES) {
      errors.push(`${getCard(id)?.name || id} は${MAX_COPIES}枚までです`);
    }
    if (count > ownedCount(id)) {
      errors.push(`${getCard(id)?.name || id} の所持数が足りません`);
    }
  }
  return errors;
}

export function recordBattleResult(won) {
  if (won) state.stats.wins++;
  else state.stats.losses++;
  save();
}

export { DECK_SIZE, MAX_COPIES, MAX_DECK_SLOTS };
