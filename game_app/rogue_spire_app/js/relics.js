// 遺物データベース。効果は combat.js / map.js 側で relic id を直接参照して適用する。
export const RELIC_DB = {
  ashenHeart: { name: '灰の心臓', desc: '戦闘終了後、HPを5回復する。', rarity: 'starter' },
  hardShell: { name: '硬い甲羅', desc: '戦闘開始時、ブロックを3獲得する。', rarity: 'common' },
  markOfFury: { name: '闘志の証', desc: '戦闘開始時、力を1獲得する。', rarity: 'common' },
  swiftFeet: { name: '素早い足', desc: '毎ターン、カードを1枚多く引く。', rarity: 'uncommon' },
  vengefulThorns: { name: '復讐の棘', desc: '常時、攻撃を受けると3ダメージを反射する。', rarity: 'uncommon' },
  alchemicVial: { name: '錬金の瓶', desc: '最大エナジーが1増える。', rarity: 'boss' },
  travelersCharm: { name: '旅人のお守り', desc: '休憩所での回復量が10%増える。', rarity: 'common' },
};

export function relicName(id) {
  return RELIC_DB[id]?.name || id;
}

export function relicDesc(id) {
  return RELIC_DB[id]?.desc || '';
}

const NON_STARTER_RELIC_IDS = Object.keys(RELIC_DB).filter(id => RELIC_DB[id].rarity !== 'starter' && RELIC_DB[id].rarity !== 'boss');
const BOSS_RELIC_IDS = Object.keys(RELIC_DB).filter(id => RELIC_DB[id].rarity === 'boss');

export function rollRelicReward(ownedIds, pool = NON_STARTER_RELIC_IDS) {
  const candidates = pool.filter(id => !ownedIds.includes(id));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function rollBossRelicReward(ownedIds) {
  return rollRelicReward(ownedIds, BOSS_RELIC_IDS) || rollRelicReward(ownedIds, NON_STARTER_RELIC_IDS);
}
