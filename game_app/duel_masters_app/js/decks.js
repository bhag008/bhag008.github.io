// CPU用プリセットデッキ(各文明単色。レアリティに応じて採用枚数を決め、40枚以上にする)
import { cardsByCivilization } from './cards.js';

const COPIES_BY_RARITY = { C: 3, UC: 2, R: 1, VR: 1, SR: 1 };

function monoCivDeck(civ) {
  const ids = [];
  for (const card of cardsByCivilization(civ)) {
    const copies = COPIES_BY_RARITY[card.rarity] ?? 1;
    for (let i = 0; i < copies; i++) ids.push(card.id);
  }
  return ids;
}

export const CPU_DECKS = [
  { id: 'cpuFire', name: '業火の軍勢', civ: 'fire', description: '火文明単色。パワーアタッカーと除去で押し切るデッキ。' },
  { id: 'cpuWater', name: '深海の守り', civ: 'water', description: '水文明単色。ブロッカーとバウンス・タップで粘り強く戦うデッキ。' },
  { id: 'cpuNature', name: '大森林の咆哮', civ: 'nature', description: '自然文明単色。マナ加速から高パワークリーチャーへ繋ぐデッキ。' },
  { id: 'cpuLight', name: '光輝の守護', civ: 'light', description: '光文明単色。ブロッカーとタップでじっくり戦うデッキ。' },
  { id: 'cpuDark', name: '深淵の呪縛', civ: 'dark', description: '闇文明単色。除去とスレイヤーで相手の展開を妨げるデッキ。' },
].map((d) => ({ ...d, cardIds: monoCivDeck(d.civ) }));

export function getCpuDeck(id) {
  return CPU_DECKS.find((d) => d.id === id);
}
