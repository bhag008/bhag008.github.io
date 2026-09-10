// CPU用プリセットデッキ(各文明の全カードを4枚ずつ=ちょうど40枚)
import { cardsByCivilization, MAX_COPIES } from './cards.js';

function monoCivDeck(civ) {
  const ids = [];
  for (const card of cardsByCivilization(civ)) {
    for (let i = 0; i < MAX_COPIES; i++) ids.push(card.id);
  }
  return ids;
}

export const CPU_DECKS = [
  { id: 'cpuFire', name: '業火の軍勢', civ: 'fire', description: '火文明単色。高パワーのクリーチャーで押し切る速攻寄りデッキ。' },
  { id: 'cpuWater', name: '深海の守り', civ: 'water', description: '水文明単色。ブロッカーとバウンスで粘り強く戦うデッキ。' },
  { id: 'cpuNature', name: '大森林の咆哮', civ: 'nature', description: '自然文明単色。マナブーストから高パワークリーチャーへ繋ぐデッキ。' },
  { id: 'cpuLight', name: '光輝の守護', civ: 'light', description: '光文明単色。ブロッカーとシールド関連でじっくり戦うデッキ。' },
  { id: 'cpuDark', name: '深淵の呪縛', civ: 'dark', description: '闇文明単色。除去とハンデスで相手の展開を妨げるデッキ。' },
].map(d => ({ ...d, cardIds: monoCivDeck(d.civ) }));

export function getCpuDeck(id) {
  return CPU_DECKS.find(d => d.id === id);
}
