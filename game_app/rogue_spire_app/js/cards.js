// カードデータベースと効果解決ヘルパー
import { nextUid } from './state.js';

// 効果タイプ: damage, block, draw, energy, buff(strength/dexterity),
// debuff(weak/vulnerable/frail/poison), heal, thorns, regen, exhaustAllDiscard

const CARD_DB = {
  // --- ベーシック(初期デッキのみ・報酬プールには出ない) ---
  strike: {
    name: '打撃', type: 'attack', cost: 1, rarity: 'basic', target: 'enemy',
    values: { dmg: 6 }, upgradedValues: { dmg: 9 },
    desc: v => `敵に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg }],
  },
  defend: {
    name: '防御', type: 'skill', cost: 1, rarity: 'basic', target: 'self',
    values: { block: 5 }, upgradedValues: { block: 8 },
    desc: v => `${v.block}ブロックを得る。`,
    effects: v => [{ type: 'block', amount: v.block }],
  },
  bash: {
    name: '渾身の一撃', type: 'attack', cost: 2, rarity: 'basic', target: 'enemy',
    values: { dmg: 8, vuln: 2 }, upgradedValues: { dmg: 11, vuln: 3 },
    desc: v => `敵に${v.dmg}ダメージ。${v.vuln}ターンの弱体(被ダメ+50%)を与える。`,
    effects: v => [{ type: 'damage', amount: v.dmg }, { type: 'debuff', stat: 'vulnerable', amount: v.vuln, target: 'enemy' }],
  },

  // --- コモン攻撃 ---
  twinSlash: {
    name: '双撃', type: 'attack', cost: 1, rarity: 'common', target: 'enemy',
    values: { dmg: 4, hits: 2 }, upgradedValues: { dmg: 5, hits: 2 },
    desc: v => `敵に${v.dmg}ダメージを${v.hits}回。`,
    effects: v => [{ type: 'damage', amount: v.dmg, hits: v.hits }],
  },
  heavyBlow: {
    name: '重撃', type: 'attack', cost: 2, rarity: 'common', target: 'enemy',
    values: { dmg: 15 }, upgradedValues: { dmg: 19 },
    desc: v => `敵に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg }],
  },
  cleave: {
    name: '薙ぎ払い', type: 'attack', cost: 1, rarity: 'common', target: 'all',
    values: { dmg: 6 }, upgradedValues: { dmg: 9 },
    desc: v => `敵全体に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg, target: 'all' }],
  },
  quickJab: {
    name: '牽制突き', type: 'attack', cost: 0, rarity: 'common', target: 'enemy',
    values: { dmg: 3 }, upgradedValues: { dmg: 5 },
    desc: v => `敵に${v.dmg}ダメージ。コスト0。`,
    effects: v => [{ type: 'damage', amount: v.dmg }],
  },
  venomEdge: {
    name: '毒刃', type: 'attack', cost: 1, rarity: 'common', target: 'enemy',
    values: { dmg: 3, poison: 3 }, upgradedValues: { dmg: 4, poison: 4 },
    desc: v => `敵に${v.dmg}ダメージ。毒${v.poison}を付与。`,
    effects: v => [{ type: 'damage', amount: v.dmg }, { type: 'debuff', stat: 'poison', amount: v.poison, target: 'enemy' }],
  },
  recklessSwing: {
    name: '捨て身の一振り', type: 'attack', cost: 1, rarity: 'common', target: 'enemy',
    values: { dmg: 11, selfDmg: 3 }, upgradedValues: { dmg: 15, selfDmg: 3 },
    desc: v => `敵に${v.dmg}ダメージ。自身も${v.selfDmg}ダメージを受ける。`,
    effects: v => [{ type: 'damage', amount: v.dmg }, { type: 'selfDamage', amount: v.selfDmg }],
  },

  // --- コモンスキル ---
  ironSkin: {
    name: '鉄の肌', type: 'skill', cost: 1, rarity: 'common', target: 'self',
    values: { block: 8 }, upgradedValues: { block: 11 },
    desc: v => `${v.block}ブロックを得る。`,
    effects: v => [{ type: 'block', amount: v.block }],
  },
  quickStep: {
    name: '軽やかな足取り', type: 'skill', cost: 0, rarity: 'common', target: 'self',
    values: { block: 4 }, upgradedValues: { block: 6 },
    desc: v => `${v.block}ブロックを得る。コスト0。`,
    effects: v => [{ type: 'block', amount: v.block }],
  },
  focus: {
    name: '精神統一', type: 'skill', cost: 1, rarity: 'common', target: 'self',
    values: { draw: 2 }, upgradedValues: { draw: 3 },
    desc: v => `カードを${v.draw}枚引く。`,
    effects: v => [{ type: 'draw', amount: v.draw }],
  },
  battleTrance: {
    name: '闘気昂揚', type: 'skill', cost: 0, rarity: 'common', target: 'self',
    values: { energy: 1 }, upgradedValues: { energy: 2 },
    desc: v => `エナジーを${v.energy}獲得する。`,
    effects: v => [{ type: 'energy', amount: v.energy }],
  },
  hexOfWeakness: {
    name: '弱体の呪い', type: 'skill', cost: 1, rarity: 'common', target: 'enemy',
    values: { weak: 2 }, upgradedValues: { weak: 3 },
    desc: v => `敵に${v.weak}ターンの脱力(与ダメ-25%)を与える。`,
    effects: v => [{ type: 'debuff', stat: 'weak', amount: v.weak, target: 'enemy' }],
  },
  guardBreak: {
    name: '守りを崩す', type: 'skill', cost: 1, rarity: 'common', target: 'all',
    values: { frail: 2 }, upgradedValues: { frail: 3 },
    desc: v => `敵全体に${v.frail}ターンの防御低下(ブロック-25%)を与える。`,
    effects: v => [{ type: 'debuff', stat: 'frail', amount: v.frail, target: 'all' }],
  },
  fieldMedic: {
    name: '応急手当', type: 'skill', cost: 1, rarity: 'common', target: 'self',
    values: { heal: 4 }, upgradedValues: { heal: 7 },
    desc: v => `HPを${v.heal}回復する。`,
    effects: v => [{ type: 'heal', amount: v.heal }],
  },

  // --- アンコモン ---
  doubleStrike: {
    name: '三連撃', type: 'attack', cost: 2, rarity: 'uncommon', target: 'enemy',
    values: { dmg: 6, hits: 3 }, upgradedValues: { dmg: 7, hits: 3 },
    desc: v => `敵に${v.dmg}ダメージを${v.hits}回。`,
    effects: v => [{ type: 'damage', amount: v.dmg, hits: v.hits }],
  },
  execute: {
    name: '処刑の一撃', type: 'attack', cost: 2, rarity: 'uncommon', target: 'enemy',
    values: { dmg: 10, dmgLowHp: 20 }, upgradedValues: { dmg: 12, dmgLowHp: 26 },
    desc: v => `敵のHPが50%以下なら${v.dmgLowHp}、それ以外は${v.dmg}ダメージ。`,
    effects: v => [{ type: 'executeDamage', amount: v.dmg, amountLow: v.dmgLowHp }],
  },
  barrage: {
    name: '乱れ撃ち', type: 'attack', cost: 3, rarity: 'uncommon', target: 'all',
    values: { dmg: 10 }, upgradedValues: { dmg: 14 },
    desc: v => `敵全体に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg, target: 'all' }],
  },
  drainStrike: {
    name: '吸血の刃', type: 'attack', cost: 2, rarity: 'uncommon', target: 'enemy',
    values: { dmg: 10, heal: 3 }, upgradedValues: { dmg: 13, heal: 5 },
    desc: v => `敵に${v.dmg}ダメージ。自身のHPを${v.heal}回復する。`,
    effects: v => [{ type: 'damage', amount: v.dmg }, { type: 'heal', amount: v.heal }],
  },
  fortify: {
    name: '要塞化', type: 'skill', cost: 2, rarity: 'uncommon', target: 'self',
    values: { block: 16 }, upgradedValues: { block: 20 },
    desc: v => `${v.block}ブロックを得る。`,
    effects: v => [{ type: 'block', amount: v.block }],
  },
  adrenaline: {
    name: 'アドレナリン', type: 'skill', cost: 1, rarity: 'uncommon', target: 'self',
    values: { energy: 2, draw: 1 }, upgradedValues: { energy: 2, draw: 2 },
    desc: v => `エナジーを${v.energy}獲得し、カードを${v.draw}枚引く。この手札は消滅する。`,
    exhaustSelf: true,
    effects: v => [{ type: 'energy', amount: v.energy }, { type: 'draw', amount: v.draw }],
  },
  toxicCloud: {
    name: '毒霧', type: 'skill', cost: 2, rarity: 'uncommon', target: 'all',
    values: { poison: 4 }, upgradedValues: { poison: 6 },
    desc: v => `敵全体に毒${v.poison}を付与。`,
    effects: v => [{ type: 'debuff', stat: 'poison', amount: v.poison, target: 'all' }],
  },

  // --- パワー(恒久バフ、使用後は消滅) ---
  ritualOfStrength: {
    name: '力の誓い', type: 'power', cost: 1, rarity: 'uncommon', target: 'self',
    values: { strength: 2 }, upgradedValues: { strength: 3 },
    desc: v => `このバトル中、力+${v.strength}(攻撃力上昇)。`,
    exhaustSelf: true,
    effects: v => [{ type: 'buff', stat: 'strength', amount: v.strength }],
  },
  ritualOfWarding: {
    name: '守りの誓い', type: 'power', cost: 1, rarity: 'uncommon', target: 'self',
    values: { dexterity: 2 }, upgradedValues: { dexterity: 3 },
    desc: v => `このバトル中、敏捷+${v.dexterity}(ブロック獲得量上昇)。`,
    exhaustSelf: true,
    effects: v => [{ type: 'buff', stat: 'dexterity', amount: v.dexterity }],
  },
  spikedArmor: {
    name: '棘の鎧', type: 'power', cost: 1, rarity: 'rare', target: 'self',
    values: { thorns: 3 }, upgradedValues: { thorns: 5 },
    desc: v => `このバトル中、攻撃を受けるたびに${v.thorns}ダメージを反射する。`,
    exhaustSelf: true,
    effects: v => [{ type: 'thornsBuff', amount: v.thorns }],
  },
  regeneration: {
    name: '再生の加護', type: 'power', cost: 1, rarity: 'rare', target: 'self',
    values: { regen: 4 }, upgradedValues: { regen: 6 },
    desc: v => `このバトル中、毎ターン開始時にHPを${v.regen}回復する。`,
    exhaustSelf: true,
    effects: v => [{ type: 'regenBuff', amount: v.regen }],
  },

  // --- レア ---
  annihilate: {
    name: '滅殺', type: 'attack', cost: 3, rarity: 'rare', target: 'enemy',
    values: { dmg: 28 }, upgradedValues: { dmg: 36 },
    desc: v => `敵に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg }],
  },
  meteor: {
    name: '隕石落とし', type: 'attack', cost: 4, rarity: 'rare', target: 'all',
    values: { dmg: 18 }, upgradedValues: { dmg: 23 },
    desc: v => `敵全体に${v.dmg}ダメージ。`,
    effects: v => [{ type: 'damage', amount: v.dmg, target: 'all' }],
  },
  perfectGuard: {
    name: '完全防御', type: 'skill', cost: 2, rarity: 'rare', target: 'self',
    values: { block: 24 }, upgradedValues: { block: 30 },
    desc: v => `${v.block}ブロックを得る。`,
    effects: v => [{ type: 'block', amount: v.block }],
  },
  secondWind: {
    name: '不屈の闘志', type: 'skill', cost: 2, rarity: 'rare', target: 'self',
    values: { heal: 10, energy: 1 }, upgradedValues: { heal: 15, energy: 1 },
    desc: v => `HPを${v.heal}回復し、エナジーを${v.energy}獲得する。`,
    effects: v => [{ type: 'heal', amount: v.heal }, { type: 'energy', amount: v.energy }],
  },
};

export const BASIC_IDS = ['strike', 'defend', 'bash'];
export const STARTER_DECK = ['strike', 'strike', 'strike', 'strike', 'defend', 'defend', 'defend', 'defend', 'bash'];

export function getCardDef(id) {
  return CARD_DB[id];
}

export function allRewardEligibleIds() {
  return Object.keys(CARD_DB).filter(id => CARD_DB[id].rarity !== 'basic');
}

export function allCardIds() {
  return Object.keys(CARD_DB);
}

export function randomCardIdByRarity(rarity) {
  const pool = Object.keys(CARD_DB).filter(id => CARD_DB[id].rarity === rarity);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function makeCardInstance(id, upgraded = false) {
  return { uid: nextUid(), defId: id, upgraded };
}

function resolvedValues(def, upgraded) {
  return upgraded ? { ...def.values, ...def.upgradedValues } : def.values;
}

export function cardDisplayName(instance) {
  const def = getCardDef(instance.defId);
  return def.name + (instance.upgraded ? '+' : '');
}

export function cardDescription(instance) {
  const def = getCardDef(instance.defId);
  return def.desc(resolvedValues(def, instance.upgraded));
}

export function cardCost(instance) {
  return getCardDef(instance.defId).cost;
}

export function cardType(instance) {
  return getCardDef(instance.defId).type;
}

export function cardTarget(instance) {
  return getCardDef(instance.defId).target;
}

export function cardEffects(instance) {
  const def = getCardDef(instance.defId);
  return def.effects(resolvedValues(def, instance.upgraded));
}

export function cardExhaustsSelf(instance) {
  return !!getCardDef(instance.defId).exhaustSelf;
}

const RARITY_WEIGHTS = { common: 60, uncommon: 30, rare: 10 };
export const RARITY_PRICE = { common: 50, uncommon: 80, rare: 150 };

export function cardPrice(instance) {
  return RARITY_PRICE[getCardDef(instance.defId).rarity] || 50;
}

export function rollCardRewards(count, existingUpgradeableCheck) {
  const pool = allRewardEligibleIds();
  const picks = [];
  const usedIds = new Set();
  let guardLoops = 0;
  while (picks.length < count && guardLoops < 200) {
    guardLoops++;
    const id = weightedPick(pool);
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    picks.push(makeCardInstance(id, false));
  }
  return picks;
}

function weightedPick(pool) {
  const weighted = [];
  for (const id of pool) {
    const w = RARITY_WEIGHTS[CARD_DB[id].rarity] || 10;
    weighted.push([id, w]);
  }
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of weighted) {
    if (r < w) return id;
    r -= w;
  }
  return weighted[weighted.length - 1][0];
}
