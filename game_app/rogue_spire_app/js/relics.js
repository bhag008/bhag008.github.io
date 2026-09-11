// 遺物データベース。効果は combat.js / map.js 側で relic id を直接参照して適用する。
export const RELIC_DB = {
  ashenHeart: { name: '灰の心臓', desc: '戦闘終了後、HPを5回復する。', rarity: 'starter' },
  hardShell: { name: '硬い甲羅', desc: '常時、受ける攻撃ダメージを1軽減する。', rarity: 'common' },
  markOfFury: { name: '闘志の証', desc: '戦闘開始時、力を1獲得する。', rarity: 'common' },
  swiftFeet: { name: '素早い足', desc: '毎ターン、カードを1枚多く引く。', rarity: 'uncommon' },
  vengefulThorns: { name: '復讐の棘', desc: '常時、攻撃を受けると3ダメージを反射する。', rarity: 'uncommon' },
  alchemicVial: { name: '錬金の瓶', desc: '最大エナジーが1増える。', rarity: 'boss' },
  travelersCharm: { name: '旅人のお守り', desc: '休憩所での回復量が10%増える。', rarity: 'common' },
  guardianAmulet: { name: '守護の護符', desc: '戦闘開始時、ブロックを6獲得する。', rarity: 'common' },
  nimbleBoots: { name: '軽やかな靴', desc: '戦闘開始時、敏捷を2獲得する。', rarity: 'common' },
  merchantsRing: { name: '商人の指輪', desc: '戦闘勝利で得られるゴールドが20%増える。', rarity: 'common' },
  bloodPact: { name: '血の契約', desc: '戦闘開始時、HPを3失う代わりに力を3獲得する。', rarity: 'uncommon' },
  luckyCoin: { name: '幸運のコイン', desc: 'ショップの価格が15%安くなる。', rarity: 'uncommon' },
  whetstone: { name: '砥石', desc: '獲得時、ランダムなカードを1枚強化する。', rarity: 'uncommon' },
  vitalCrystal: { name: '生命の結晶', desc: '獲得時、最大HPが10増える。', rarity: 'boss' },
  phoenixFeather: { name: '不死鳥の羽根', desc: 'HPが50%以下の状態で戦闘に勝利すると、HPを12回復する。', rarity: 'boss' },
};

export function relicName(id) {
  return RELIC_DB[id]?.name || id;
}

export function relicDesc(id) {
  return RELIC_DB[id]?.desc || '';
}

export function relicRarity(id) {
  return RELIC_DB[id]?.rarity;
}

export function allRelicIds() {
  return Object.keys(RELIC_DB);
}

export const RELIC_RARITY_ORDER = ['starter', 'common', 'uncommon', 'boss'];
export const RELIC_RARITY_LABELS = { starter: 'スターター', common: 'コモン', uncommon: 'アンコモン', boss: 'ボス' };

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

// 獲得した瞬間に一度だけ発動する遺物効果。run.relics.push(id) の直後に呼び出す。
export function applyRelicPickupEffect(run, relicId) {
  if (relicId === 'vitalCrystal') {
    run.maxHp += 10;
    run.hp += 10;
  } else if (relicId === 'whetstone') {
    const candidates = run.deck.filter(c => !c.upgraded);
    if (candidates.length > 0) {
      candidates[Math.floor(Math.random() * candidates.length)].upgraded = true;
    }
  }
}
