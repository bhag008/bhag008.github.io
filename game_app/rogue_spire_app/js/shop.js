// ショップの品揃え生成
import { rollCardRewards } from './cards.js';
import { rollRelicReward } from './relics.js';

export function generateShopStock(run) {
  return {
    cards: rollCardRewards(5),
    relicId: rollRelicReward(run.relics),
    removalPrice: 75 + 25 * (run.cardsRemoved || 0),
  };
}
