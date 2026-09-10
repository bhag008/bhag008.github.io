// 敵データベース。パターンはターン番号を index として周期的に選択される。
// intent kind: 'attack'(value,hits) / 'defend'(value) / 'buff'(stat,value:自己強化)
// / 'poison'(value:プレイヤーに毒) / 'weaken'(value:プレイヤーに脱力)
// / 'attackDebuff'(value,debuffStat,debuffAmount:攻撃+デバフ付与)

const ENEMY_DB = {
  ashWolf: {
    name: '灰の狼', maxHp: [16, 20], isElite: false,
    pattern: [
      { kind: 'attack', value: 7 },
      { kind: 'attack', value: 7 },
      { kind: 'buff', stat: 'strength', value: 2 },
    ],
  },
  rottedKnight: {
    name: '朽ちた騎士', maxHp: [24, 28], isElite: false,
    pattern: [
      { kind: 'attack', value: 10 },
      { kind: 'defend', value: 7 },
      { kind: 'attack', value: 10 },
    ],
  },
  thornGolem: {
    name: '棘のゴーレム', maxHp: [30, 34], isElite: false, thorns: 3,
    pattern: [
      { kind: 'defend', value: 9 },
      { kind: 'attack', value: 9 },
    ],
  },
  shadowThief: {
    name: '影の盗賊', maxHp: [12, 15], isElite: false,
    pattern: [
      { kind: 'attackDebuff', value: 4, debuffStat: 'weak', debuffAmount: 1 },
      { kind: 'attack', value: 5 },
    ],
  },
  poisonVine: {
    name: '毒の蔦', maxHp: [20, 23], isElite: false,
    pattern: [
      { kind: 'poison', value: 3 },
      { kind: 'attack', value: 4 },
    ],
  },
  madPilgrim: {
    name: '狂った巡礼者', maxHp: [22, 26], isElite: false,
    pattern: [
      { kind: 'buff', stat: 'strength', value: 3 },
      { kind: 'attack', value: 14 },
    ],
  },
  stoneSentinel: {
    name: '石の番人', maxHp: [48, 52], isElite: true, thorns: 2,
    pattern: [
      { kind: 'defend', value: 12 },
      { kind: 'attack', value: 16 },
      { kind: 'attack', value: 16 },
    ],
  },
  witheredJudge: {
    name: '朽ちた審判者', maxHp: [44, 50], isElite: true,
    pattern: [
      { kind: 'attackDebuff', value: 11, debuffStat: 'vulnerable', debuffAmount: 2 },
      { kind: 'defend', value: 10 },
      { kind: 'attack', value: 15 },
    ],
  },
  lordOfSpire: {
    name: '灰塔の主', maxHp: [85, 85], isElite: true, isBoss: true,
    pattern: [
      { kind: 'attack', value: 16 },
      { kind: 'poison', value: 4 },
      { kind: 'buff', stat: 'strength', value: 4 },
      { kind: 'attack', value: 8, hits: 3 },
    ],
  },
};

export function getEnemyDef(id) {
  return ENEMY_DB[id];
}

export function randHp(def) {
  const [lo, hi] = def.maxHp;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

let enemyUidCounter = 1;

export function makeEnemyInstance(id) {
  const def = getEnemyDef(id);
  const hp = randHp(def);
  return {
    uid: enemyUidCounter++,
    id,
    name: def.name,
    hp,
    maxHp: hp,
    block: 0,
    strength: 0,
    statuses: { weak: 0, vulnerable: 0, poison: 0 },
    thorns: def.thorns || 0,
    patternIndex: 0,
    intent: null,
  };
}

export function rollIntent(enemyInst) {
  const def = getEnemyDef(enemyInst.id);
  const pattern = def.pattern;
  const raw = pattern[enemyInst.patternIndex % pattern.length];
  enemyInst.patternIndex++;
  return raw;
}

export const NORMAL_ENEMY_IDS = ['ashWolf', 'rottedKnight', 'thornGolem', 'shadowThief', 'poisonVine', 'madPilgrim'];
export const ELITE_ENEMY_IDS = ['stoneSentinel', 'witheredJudge'];
export const BOSS_ENEMY_ID = 'lordOfSpire';

export function rollNormalEncounter() {
  const roll = Math.random();
  if (roll < 0.5) {
    return [pick(NORMAL_ENEMY_IDS)];
  } else if (roll < 0.8) {
    return [pick(NORMAL_ENEMY_IDS), pick(NORMAL_ENEMY_IDS)];
  }
  return ['shadowThief', 'shadowThief'];
}

export function rollEliteEncounter() {
  return [pick(ELITE_ENEMY_IDS)];
}

export function rollBossEncounter() {
  return [BOSS_ENEMY_ID];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
