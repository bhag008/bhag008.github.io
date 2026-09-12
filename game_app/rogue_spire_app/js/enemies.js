// 敵データベース。パターンはターン番号を index として周期的に選択される。
// intent kind: 'attack'(value,hits) / 'defend'(value) / 'buff'(stat,value:自己強化)
// / 'poison'(value:プレイヤーに毒) / 'weaken'(value:プレイヤーに脱力)
// / 'attackDebuff'(value,debuffStat,debuffAmount:攻撃+デバフ付与)

const ENEMY_DB = {
  // --- 第1層 ---
  ashWolf: {
    name: '灰の狼', maxHp: [19, 23], isElite: false,
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
    name: '影の盗賊', maxHp: [12, 15], isElite: false, alwaysPaired: true,
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

  // --- 第2層 ---
  boneReaper: {
    name: '骨の死神', maxHp: [30, 34], isElite: false,
    pattern: [
      { kind: 'attack', value: 12 },
      { kind: 'attack', value: 12 },
      { kind: 'buff', stat: 'strength', value: 3 },
    ],
  },
  crimsonHound: {
    name: '紅蓮の猟犬', maxHp: [24, 28], isElite: false,
    pattern: [
      { kind: 'attackDebuff', value: 9, debuffStat: 'weak', debuffAmount: 1 },
      { kind: 'attack', value: 11 },
      { kind: 'attack', value: 11 },
    ],
  },
  ironWraith: {
    name: '鉄の亡霊', maxHp: [38, 42], isElite: false, thorns: 4,
    pattern: [
      { kind: 'defend', value: 14 },
      { kind: 'attack', value: 15 },
    ],
  },
  twinBlades: {
    name: '双刃の狩人', maxHp: [16, 19], isElite: false,
    pattern: [
      { kind: 'attackDebuff', value: 7, debuffStat: 'vulnerable', debuffAmount: 1 },
      { kind: 'attack', value: 10 },
    ],
  },
  ashScholar: {
    name: '灰の学者', maxHp: [28, 32], isElite: false,
    pattern: [
      { kind: 'poison', value: 6 },
      { kind: 'attack', value: 11 },
    ],
  },
  ragingBrute: {
    name: '怒れる巨漢', maxHp: [34, 38], isElite: false,
    pattern: [
      { kind: 'buff', stat: 'strength', value: 4 },
      { kind: 'attack', value: 20 },
    ],
  },
  voidSentinel: {
    name: '虚無の番人', maxHp: [60, 65], isElite: true, thorns: 3,
    pattern: [
      { kind: 'defend', value: 16 },
      { kind: 'attack', value: 20 },
      { kind: 'attack', value: 20 },
    ],
  },
  plagueBringer: {
    name: '疫病の使者', maxHp: [55, 60], isElite: true,
    pattern: [
      { kind: 'poison', value: 8 },
      { kind: 'attackDebuff', value: 14, debuffStat: 'weak', debuffAmount: 2 },
      { kind: 'attack', value: 18 },
    ],
  },
  theHollowKing: {
    name: '虚ろなる王', maxHp: [140, 140], isElite: true, isBoss: true,
    pattern: [
      { kind: 'attack', value: 22 },
      { kind: 'poison', value: 6 },
      { kind: 'attack', value: 11, hits: 3 },
      { kind: 'buff', stat: 'strength', value: 5 },
    ],
  },

  // --- 第3層 ---
  obsidianGolem: {
    name: '黒曜石の巨像', maxHp: [45, 50], isElite: false, thorns: 5,
    pattern: [
      { kind: 'defend', value: 20 },
      { kind: 'attack', value: 24 },
    ],
  },
  soulReaver: {
    name: '魂喰らいの影', maxHp: [38, 42], isElite: false,
    pattern: [
      { kind: 'attackDebuff', value: 16, debuffStat: 'vulnerable', debuffAmount: 2 },
      { kind: 'attack', value: 20 },
    ],
  },
  infernoWisp: {
    name: '業火の鬼火', maxHp: [22, 26], isElite: false,
    pattern: [
      { kind: 'poison', value: 8 },
      { kind: 'attack', value: 12 },
    ],
  },
  ashenSpawn: {
    name: '灰塔の眷属', maxHp: [50, 55], isElite: false,
    pattern: [
      { kind: 'buff', stat: 'strength', value: 6 },
      { kind: 'attack', value: 28 },
    ],
  },
  witheredPriest: {
    name: '朽ちた司祭', maxHp: [40, 45], isElite: false,
    pattern: [
      { kind: 'poison', value: 10 },
      { kind: 'attack', value: 18 },
    ],
  },
  ragingWraith: {
    name: '怨嗟の亡霊', maxHp: [42, 46], isElite: false,
    pattern: [
      { kind: 'attack', value: 16, hits: 2 },
      { kind: 'buff', stat: 'strength', value: 4 },
    ],
  },
  twinTyrants: {
    name: '双王の残影', maxHp: [80, 85], isElite: true, thorns: 4,
    pattern: [
      { kind: 'attack', value: 26 },
      { kind: 'defend', value: 22 },
      { kind: 'attack', value: 26 },
    ],
  },
  deathHarbinger: {
    name: '死を告げる者', maxHp: [75, 80], isElite: true,
    pattern: [
      { kind: 'poison', value: 12 },
      { kind: 'attackDebuff', value: 24, debuffStat: 'weak', debuffAmount: 3 },
      { kind: 'attack', value: 30 },
    ],
  },
  theAshenSovereign: {
    name: '灰塔の女王', maxHp: [220, 220], isElite: true, isBoss: true,
    pattern: [
      { kind: 'attack', value: 30 },
      { kind: 'poison', value: 10 },
      { kind: 'attack', value: 14, hits: 3 },
      { kind: 'buff', stat: 'strength', value: 6 },
      { kind: 'defend', value: 25 },
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
    statuses: { weak: 0, vulnerable: 0, frail: 0, poison: 0 },
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

export const ACT_POOLS = {
  1: {
    normal: ['ashWolf', 'rottedKnight', 'thornGolem', 'shadowThief', 'poisonVine', 'madPilgrim'],
    elite: ['stoneSentinel', 'witheredJudge'],
    boss: 'lordOfSpire',
    pairId: 'shadowThief',
  },
  2: {
    normal: ['boneReaper', 'crimsonHound', 'ironWraith', 'twinBlades', 'ashScholar', 'ragingBrute'],
    elite: ['voidSentinel', 'plagueBringer'],
    boss: 'theHollowKing',
    pairId: 'twinBlades',
  },
  3: {
    normal: ['obsidianGolem', 'soulReaver', 'infernoWisp', 'ashenSpawn', 'witheredPriest', 'ragingWraith'],
    elite: ['twinTyrants', 'deathHarbinger'],
    boss: 'theAshenSovereign',
    pairId: 'infernoWisp',
  },
};

// 単体では弱すぎる敵(alwaysPaired)は「1枠」として抽選されても2体セットで出す
function pickNormalSlot(pool) {
  const id = pick(pool);
  return getEnemyDef(id).alwaysPaired ? [id, id] : [id];
}

export function rollNormalEncounter(act = 1, forceSingle = false) {
  const pool = ACT_POOLS[act] || ACT_POOLS[1];
  if (forceSingle) {
    return pickNormalSlot(pool.normal);
  }
  const roll = Math.random();
  if (roll < 0.5) {
    return pickNormalSlot(pool.normal);
  } else if (roll < 0.8) {
    return [...pickNormalSlot(pool.normal), ...pickNormalSlot(pool.normal)];
  }
  return [pool.pairId, pool.pairId];
}

export function rollEliteEncounter(act = 1) {
  const pool = ACT_POOLS[act] || ACT_POOLS[1];
  return [pick(pool.elite)];
}

export function rollBossEncounter(act = 1) {
  const pool = ACT_POOLS[act] || ACT_POOLS[1];
  return [pool.boss];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
