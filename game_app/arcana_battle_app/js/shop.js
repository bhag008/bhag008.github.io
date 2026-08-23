// パック開封ロジック
import { EXPANSIONS, EXPANSION_CARDS } from "./cards.js";

function pickRarity(odds) {
  const r = Math.random();
  let acc = 0;
  for (const [rarity, prob] of Object.entries(odds)) {
    acc += prob;
    if (r <= acc) return rarity;
  }
  return "common";
}

function pickCardOfRarity(expansionId, rarity) {
  const pool = EXPANSION_CARDS[expansionId].filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

// パックを1つ開封し、獲得したカード配列を返す（レア以上が最低1枚確定）
export function openPack(expansionId) {
  const exp = EXPANSIONS[expansionId];
  const results = [];
  for (let i = 0; i < exp.cardsPerPack; i++) {
    results.push(pickRarity(exp.rarityOdds));
  }
  if (!results.some((r) => r !== "common")) {
    results[results.length - 1] = "rare";
  }
  return results.map((rarity) => pickCardOfRarity(expansionId, rarity));
}
