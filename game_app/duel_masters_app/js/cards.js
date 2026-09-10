// カードデータベース(第1弾カードプールの記憶ベース再現) + 効果解決ヘルパー
//
// 効果タイプ一覧 (spell.effects / creature.onPlay で使用):
//   destroy          - 相手クリーチャー1体を破壊。maxPower指定でパワー制限
//   destroyAllTapped - 相手のタップされているクリーチャーを全て破壊
//   bounce           - 相手クリーチャー1体を手札に戻す
//   draw             - 自分がN枚ドロー
//   manaCharge       - 自分の山札の一番上をマナゾーンに(表向き・アンタップで)置く
//   addShield        - 自分の山札の一番上をシールドとして裏向きに追加
//   discardHand      - 相手が手札からN枚ランダムに捨てる
//   returnFromGraveyard - 自分の墓地からクリーチャーを1体手札に戻す
//   buffPower        - 自分のクリーチャー1体をこのターン中+N000パワー

export const CIVILIZATIONS = {
  fire: { name: '火', color: '#e0525a' },
  water: { name: '水', color: '#4f8fc9' },
  nature: { name: '自然', color: '#5ea85e' },
  light: { name: '光', color: '#d9c441' },
  dark: { name: '闇', color: '#8a5ec9' },
};

export const DECK_MIN_SIZE = 40;
export const MAX_COPIES = 4;
export const START_SHIELDS = 5;
export const START_HAND = 5;

const CARD_DB = {
  // ================= 火文明 =================
  fireImp: {
    id: 'fireImp', name: '火の玉オヤジ', civ: 'fire', type: 'creature',
    cost: 1, power: 500, race: 'ファイアー・ウォーカー',
    text: 'コスト1・パワー500のクリーチャー。',
  },
  coroSlider: {
    id: 'coroSlider', name: 'コロコロ・スライダー', civ: 'fire', type: 'creature',
    cost: 2, power: 1000, race: 'ファイアー・ウォーカー',
    text: 'コスト2・パワー1000のクリーチャー。',
  },
  crimsonArrow: {
    id: 'crimsonArrow', name: '紅蓮の弓矢', civ: 'fire', type: 'spell',
    cost: 1, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。相手のクリーチャーを1体選び、それのパワーが2000以下なら破壊する。',
    effects: () => [{ type: 'destroy', maxPower: 2000 }],
  },
  blazeApostle: {
    id: 'blazeApostle', name: '爆炎の使徒', civ: 'fire', type: 'creature',
    cost: 3, power: 2000, race: 'デーモン',
    text: 'コスト3・パワー2000のクリーチャー。',
  },
  demonFlame: {
    id: 'demonFlame', name: 'デーモン・フレイム', civ: 'fire', type: 'creature',
    cost: 3, power: 2500, race: 'デーモン',
    text: 'コスト3・パワー2500のクリーチャー。',
  },
  salamanderLord: {
    id: 'salamanderLord', name: 'サラマンダー・ロード', civ: 'fire', type: 'creature',
    cost: 4, power: 4000, race: 'アーマロイド',
    text: 'コスト4・パワー4000のクリーチャー。',
  },
  infernoGiant: {
    id: 'infernoGiant', name: '業火の巨人', civ: 'fire', type: 'creature',
    cost: 5, power: 5000, race: 'デーモン',
    text: 'コスト5・パワー5000のクリーチャー。',
  },
  bolshackDragon: {
    id: 'bolshackDragon', name: 'ボルシャック・ドラゴン', civ: 'fire', type: 'creature',
    cost: 5, power: 6000, race: 'アーマード・ドラゴン',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト5・パワー6000のクリーチャー。',
  },
  crimsonTyrant: {
    id: 'crimsonTyrant', name: '紅の暴君', civ: 'fire', type: 'creature',
    cost: 6, power: 7000, race: 'アーマード・ドラゴン',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト6・パワー7000のクリーチャー。',
  },
  twinBladeRush: {
    id: 'twinBladeRush', name: '爆走ツインブレード', civ: 'fire', type: 'spell',
    cost: 2, race: null,
    text: '自分のクリーチャーを1体選び、そのクリーチャーはこのターン、パワーが+2000される。',
    effects: () => [{ type: 'buffPower', amount: 2000 }],
  },

  // ================= 水文明 =================
  pacoFish: {
    id: 'pacoFish', name: 'パコパコ・フィッシュ', civ: 'water', type: 'creature',
    cost: 1, power: 500, race: 'フィッシュ',
    text: 'コスト1・パワー500のクリーチャー。',
  },
  aquaWing: {
    id: 'aquaWing', name: 'アクア・ウィング', civ: 'water', type: 'creature',
    cost: 2, power: 1000, race: 'ビークル',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト2・パワー1000のクリーチャー。',
  },
  aquaSurfer: {
    id: 'aquaSurfer', name: 'アクア・サーファー', civ: 'water', type: 'creature',
    cost: 3, power: 1000, race: 'リキッド・ピープル',
    keywords: { blocker: true, shieldTrigger: true },
    text: 'S・トリガー、ブロッカー。コスト3・パワー1000のクリーチャー。',
  },
  marineWalker: {
    id: 'marineWalker', name: 'マリン・ウォーカー', civ: 'water', type: 'creature',
    cost: 3, power: 2000, race: 'リキッド・ピープル',
    text: 'コスト3・パワー2000のクリーチャー。',
  },
  tidalFairy: {
    id: 'tidalFairy', name: '潮流の妖精', civ: 'water', type: 'spell',
    cost: 2, race: null,
    text: '相手のクリーチャーを1体選び、手札に戻す。',
    effects: () => [{ type: 'bounce' }],
  },
  tritonHarpoon: {
    id: 'tritonHarpoon', name: 'トリトンの銛', civ: 'water', type: 'spell',
    cost: 4, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。相手のクリーチャーを1体選び、手札に戻す。',
    effects: () => [{ type: 'bounce' }],
  },
  deepSeaDragon: {
    id: 'deepSeaDragon', name: 'ディープ・シー・ドラゴン', civ: 'water', type: 'creature',
    cost: 5, power: 5000, race: 'シー・ドラゴン',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト5・パワー5000のクリーチャー。',
  },
  tideGiant: {
    id: 'tideGiant', name: '潮のジャイアント', civ: 'water', type: 'creature',
    cost: 6, power: 6000, race: 'リキッド・ピープル',
    text: 'コスト6・パワー6000のクリーチャー。',
  },
  wisdomCannon: {
    id: 'wisdomCannon', name: 'アクア・キャノン', civ: 'water', type: 'spell',
    cost: 3, race: null,
    text: 'カードを2枚引く。',
    effects: () => [{ type: 'draw', amount: 2 }],
  },
  bubbleShield: {
    id: 'bubbleShield', name: 'バブル・シールド', civ: 'water', type: 'creature',
    cost: 4, power: 2000, race: 'リキッド・ピープル',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト4・パワー2000のクリーチャー。',
  },

  // ================= 自然文明 =================
  wandBudo: {
    id: 'wandBudo', name: 'ワンド・ボタン', civ: 'nature', type: 'creature',
    cost: 1, power: 500, race: 'フェアリー',
    text: 'コスト1・パワー500のクリーチャー。',
  },
  kotsubuTeam: {
    id: 'kotsubuTeam', name: 'こつぶ団', civ: 'nature', type: 'creature',
    cost: 2, power: 1500, race: 'ビースト・フォーク',
    text: 'コスト2・パワー1500のクリーチャー。',
  },
  forestWill: {
    id: 'forestWill', name: '森の意志', civ: 'nature', type: 'spell',
    cost: 2, race: null,
    text: '自分の山札の一番上を見て、マナゾーンに置く。',
    effects: () => [{ type: 'manaCharge' }],
  },
  arboreaMoth: {
    id: 'arboreaMoth', name: 'アルボレア・モス', civ: 'nature', type: 'creature',
    cost: 3, power: 2500, race: 'インセクト',
    text: 'コスト3・パワー2500のクリーチャー。',
  },
  greenTurtle: {
    id: 'greenTurtle', name: 'グリーン・タートル', civ: 'nature', type: 'creature',
    cost: 3, power: 2000, race: 'ビースト・フォーク',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト3・パワー2000のクリーチャー。',
  },
  giantBear: {
    id: 'giantBear', name: 'ジャイアント・ベアー', civ: 'nature', type: 'creature',
    cost: 4, power: 5000, race: 'ビースト・フォーク',
    text: 'コスト4・パワー5000のクリーチャー。',
  },
  earthWorm: {
    id: 'earthWorm', name: 'アース・ワーム', civ: 'nature', type: 'creature',
    cost: 5, power: 6000, race: 'インセクト',
    text: 'コスト5・パワー6000のクリーチャー。',
  },
  jungleGuardian: {
    id: 'jungleGuardian', name: '密林の守護獣', civ: 'nature', type: 'creature',
    cost: 6, power: 8000, race: 'ビースト・フォーク',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト6・パワー8000のクリーチャー。',
  },
  fairyPrayer: {
    id: 'fairyPrayer', name: '妖精の祈り', civ: 'nature', type: 'spell',
    cost: 1, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。カードを1枚引く。',
    effects: () => [{ type: 'draw', amount: 1 }],
  },
  greatwoodDragon: {
    id: 'greatwoodDragon', name: 'グレートウッド・ドラゴン', civ: 'nature', type: 'creature',
    cost: 7, power: 9000, race: 'アース・ドラゴン',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト7・パワー9000のクリーチャー。',
  },

  // ================= 光文明 =================
  lightPixie: {
    id: 'lightPixie', name: 'ライト・ピクシー', civ: 'light', type: 'creature',
    cost: 1, power: 500, race: 'フェアリー',
    text: 'コスト1・パワー500のクリーチャー。',
  },
  shieldGuard: {
    id: 'shieldGuard', name: 'シールド・ガード', civ: 'light', type: 'creature',
    cost: 2, power: 1000, race: 'アーマロイド',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト2・パワー1000のクリーチャー。',
  },
  guardianFairy: {
    id: 'guardianFairy', name: '守りの妖精', civ: 'light', type: 'spell',
    cost: 1, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。自分の山札の一番上をシールドとして追加する。',
    effects: () => [{ type: 'addShield' }],
  },
  lightOfWisdom: {
    id: 'lightOfWisdom', name: '知識の光', civ: 'light', type: 'spell',
    cost: 3, race: null,
    text: 'カードを2枚引く。',
    effects: () => [{ type: 'draw', amount: 2 }],
  },
  angelFeather: {
    id: 'angelFeather', name: 'エンジェル・フェザー', civ: 'light', type: 'creature',
    cost: 3, power: 1500, race: 'エンジェル・コマンド',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト3・パワー1500のクリーチャー。',
  },
  holySpark: {
    id: 'holySpark', name: 'ホーリー・スパーク', civ: 'light', type: 'spell',
    cost: 4, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。相手のタップされているクリーチャーをすべて破壊する。',
    effects: () => [{ type: 'destroyAllTapped' }],
  },
  artemisKnight: {
    id: 'artemisKnight', name: '聖騎士アルテミス', civ: 'light', type: 'creature',
    cost: 4, power: 3000, race: 'エンジェル・コマンド',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト4・パワー3000のクリーチャー。',
  },
  guardianAngel: {
    id: 'guardianAngel', name: '天使の守護者', civ: 'light', type: 'creature',
    cost: 5, power: 4000, race: 'エンジェル・コマンド',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト5・パワー4000のクリーチャー。',
  },
  radiantColossus: {
    id: 'radiantColossus', name: '光輝の巨神', civ: 'light', type: 'creature',
    cost: 6, power: 6000, race: 'アーマロイド',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト6・パワー6000のクリーチャー。',
  },
  saintDragon: {
    id: 'saintDragon', name: 'セイント・ドラゴン', civ: 'light', type: 'creature',
    cost: 5, power: 5000, race: 'アーマード・ドラゴン',
    keywords: { blocker: true },
    text: 'ブロッカー。コスト5・パワー5000のクリーチャー。',
  },

  // ================= 闇文明 =================
  demonSeed: {
    id: 'demonSeed', name: 'デーモン・シード', civ: 'dark', type: 'creature',
    cost: 1, power: 500, race: 'デーモン',
    text: 'コスト1・パワー500のクリーチャー。',
  },
  shadowBat: {
    id: 'shadowBat', name: 'シャドー・バット', civ: 'dark', type: 'creature',
    cost: 2, power: 1500, race: 'デーモン',
    text: 'コスト2・パワー1500のクリーチャー。',
  },
  demonHand: {
    id: 'demonHand', name: 'デーモン・ハンド', civ: 'dark', type: 'spell',
    cost: 3, race: null,
    keywords: { shieldTrigger: true },
    text: 'S・トリガー。相手のクリーチャーを1体選び、破壊する。',
    effects: () => [{ type: 'destroy' }],
  },
  nightmareWorm: {
    id: 'nightmareWorm', name: 'ナイトメア・ワーム', civ: 'dark', type: 'creature',
    cost: 3, power: 2500, race: 'デス・ワーム',
    text: 'コスト3・パワー2500のクリーチャー。',
  },
  deathKnight: {
    id: 'deathKnight', name: '死霊の騎士', civ: 'dark', type: 'creature',
    cost: 4, power: 3500, race: 'デーモン',
    text: 'コスト4・パワー3500のクリーチャー。',
  },
  darkGrasp: {
    id: 'darkGrasp', name: '闇の掌握', civ: 'dark', type: 'spell',
    cost: 2, race: null,
    text: '相手は手札を1枚選び、捨てる。',
    effects: () => [{ type: 'discardHand', amount: 1 }],
  },
  deathPuppet: {
    id: 'deathPuppet', name: 'デス・パペット', civ: 'dark', type: 'creature',
    cost: 4, power: 3000, race: 'デス・パペット',
    text: 'コスト4・パワー3000のクリーチャー。',
  },
  evilEyeRuler: {
    id: 'evilEyeRuler', name: '邪眼の支配者', civ: 'dark', type: 'creature',
    cost: 5, power: 5000, race: 'デーモン',
    text: 'コスト5・パワー5000のクリーチャー。',
  },
  finalMessenger: {
    id: 'finalMessenger', name: '終焉の使者', civ: 'dark', type: 'creature',
    cost: 6, power: 6500, race: 'デス・ワーム',
    keywords: { doubleBreaker: true },
    text: 'W・ブレイカー。コスト6・パワー6500のクリーチャー。',
  },
  gateOfUnderworld: {
    id: 'gateOfUnderworld', name: '冥界の門', civ: 'dark', type: 'spell',
    cost: 5, race: null,
    text: '自分の墓地からクリーチャーを1体選び、手札に戻す。',
    effects: () => [{ type: 'returnFromGraveyard' }],
  },
};

export function getCard(id) {
  return CARD_DB[id];
}

export function allCards() {
  return Object.values(CARD_DB);
}

export function cardsByCivilization(civ) {
  return allCards().filter(c => c.civ === civ);
}

export function isBlocker(card) {
  return !!(card.keywords && card.keywords.blocker);
}

export function isDoubleBreaker(card) {
  return !!(card.keywords && card.keywords.doubleBreaker);
}

export function hasShieldTrigger(card) {
  return !!(card.keywords && card.keywords.shieldTrigger);
}

export function cardEffects(card) {
  return card.effects ? card.effects() : [];
}

export function validateDeck(cardIds) {
  const errors = [];
  if (cardIds.length < DECK_MIN_SIZE) {
    errors.push(`デッキ枚数が不足しています(${cardIds.length}/${DECK_MIN_SIZE}枚以上)`);
  }
  const counts = {};
  for (const id of cardIds) {
    counts[id] = (counts[id] || 0) + 1;
    if (!getCard(id)) errors.push(`不明なカードID: ${id}`);
  }
  for (const [id, count] of Object.entries(counts)) {
    if (count > MAX_COPIES) {
      const def = getCard(id);
      errors.push(`${def ? def.name : id} は同名${MAX_COPIES}枚までです(現在${count}枚)`);
    }
  }
  return errors;
}
