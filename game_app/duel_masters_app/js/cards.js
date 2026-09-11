// カードデータベース: 第1弾(DM-01, 2002年発売)の実際のカードリスト・効果を
// dmwiki.net(https://dmwiki.net/DM-01)を参照して再現したもの。
// 全120種(SR10/VR10/R30/UC30/C40)を収録。イラストは著作権上の理由により実装していない。
//
// ---- 能力の表現方法 ----
// keywords: 静的なキーワード能力をまとめたオブジェクト。真偽値/数値/文字列/オブジェクトを混在させる。
//   blocker, doubleBreaker, shieldTrigger, slayer, cannotAttack, cannotAttackPlayer,
//   untapKiller, unblockable, unblockableByPowerAtMost, unblockableIfOwnCount,
//   powerAttacker(数値), powerAttackerCondition({race,amount}), powerAttackerPerGraveyardCiv({civ,amount}),
//   staticPowerBonusCondition({race,amount}), onDestroy('hand'|'mana'), selfDestructAfterBattle,
//   endOfTurnUntap('self'|'all'), forcedAttacker
// onPlay / spell: { target: null | {kind,min,max,filter}, resolve(engine, side, targetUids) }
//   target.kind: 'enemyCreature' | 'ownCreature' | 'anyCreature' | 'ownGraveyardCreature' | 'ownHandCard' | 'deckTutor'
//   target.min/max: 選択する対象の枚数の範囲(min=0は「てもよい/～まで」、min=maxで必須)
//   onPlay(クリーチャーの出た時能力)は実際の出た時能力の解決順を再現するため、
//   「先にバトルゾーンへ出てから対象を選ぶ」形でengine側から呼び出される(pendingCip参照)。
//
// 「相手が自分のクリーチャーを選ぶ」効果(腐食虫スワンプワーム等)は本来相手の任意選択だが、
// 本実装では簡略化のため常に一番パワーが低い自分のクリーチャーを自動選択する。

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

export function hasKeyword(def, key) { return !!(def.keywords && def.keywords[key]); }
export function keywordValue(def, key) { return def.keywords ? def.keywords[key] : undefined; }
export function isBlocker(def) { return hasKeyword(def, 'blocker'); }
export function isDoubleBreaker(def) { return hasKeyword(def, 'doubleBreaker'); }
export function hasShieldTrigger(def) { return hasKeyword(def, 'shieldTrigger'); }
export function cardSet(def) { return def.set || 'DM-01'; }

// ================= 効果ファクトリ =================
const destroyEnemyOne = (min, max, filter) => ({
  target: { kind: 'enemyCreature', min, max, filter },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.destroyCreature(opp, uid);
  },
});
const bounceEnemy = (min, max) => ({
  target: { kind: 'enemyCreature', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.bounceCreature(opp, uid);
  },
});
const bounceAny = (min, max, filter) => ({
  target: { kind: 'anyCreature', min, max, filter },
  resolve(engine, side, uids) {
    for (const uid of uids) {
      const owner = engine.ownerOfCreature(uid);
      if (owner) engine.bounceCreature(owner, uid);
    }
  },
});
const manaizeEnemyOne = (min, max) => ({
  target: { kind: 'enemyCreature', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.manaizeCreature(opp, uid);
  },
});
const tapEnemy = (min, max) => ({
  target: { kind: 'enemyCreature', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.tapCreature(opp, uid);
  },
});
const tapAllEnemy = () => ({
  target: null,
  resolve(engine, side) {
    const opp = engine.opponent(side);
    for (const c of engine.players[opp].battle) c.tapped = true;
  },
});
const drawAlways = (n) => ({ target: null, resolve(engine, side) { engine.drawCardsSafe(side, n); } });
const grantUnblockableSpell = (min, max) => ({
  target: { kind: 'ownCreature', min, max },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.grantUnblockable(side, uid);
  },
});
const graveyardToHand = (min, max) => ({
  target: { kind: 'ownGraveyardCreature', min, max },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.graveyardCreatureToHand(side, uid);
  },
});
const graveyardToManaOne = (min, max) => ({
  target: { kind: 'ownGraveyardCreature', min, max },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.graveyardCreatureToMana(side, uid);
  },
});
const handCardToManaOne = (min, max) => ({
  target: { kind: 'ownHandCard', min, max, intent: 'harmful' },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.handCardToMana(side, uid);
  },
});
const ownCreatureToManaOne = (min, max) => ({
  target: { kind: 'ownCreature', min, max, intent: 'harmful' },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.manaizeCreature(side, uid);
  },
});
const deckTutor = (min, max, filter) => ({
  target: { kind: 'deckTutor', min, max, filter },
  resolve(engine, side, uids) { engine.tutorFromDeck(side, uids[0] ?? null); },
});
const destroyOwnOne = (min, max, filter) => ({
  target: { kind: 'ownCreature', min, max, filter, intent: 'harmful' },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.destroyCreature(side, uid);
  },
});
const opponentForcedDestroyOwn = () => ({
  target: null,
  resolve(engine, side) {
    const opp = engine.opponent(side);
    const uid = engine.pickWeakestOwnCreatureUid(opp);
    if (uid != null) engine.destroyCreature(opp, uid);
  },
});
const opponentForcedManaizeOwn = () => ({
  target: null,
  resolve(engine, side) {
    const opp = engine.opponent(side);
    const uid = engine.pickWeakestOwnCreatureUid(opp);
    if (uid != null) engine.manaizeCreature(opp, uid);
  },
});
const randomDiscardOpponent = () => ({ target: null, resolve(engine, side) { engine.discardRandomFromHand(engine.opponent(side)); } });
const symmetricWipe = (maxPower) => ({ target: null, resolve(engine) { engine.symmetricDestroyByPower(maxPower); } });
const teamAttackBuffSpell = (amount) => ({ target: null, resolve(engine, side) { engine.teamAttackBuff(side, amount); } });
const grantAttackBuffOne = (amount, alsoDoubleBreaker, min = 1, max = 1) => ({
  target: { kind: 'ownCreature', min, max },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.grantAttackBuff(side, uid, amount, alsoDoubleBreaker);
  },
});
const grantIgnoreTapSpell = () => ({
  target: { kind: 'enemyCreature', min: 1, max: 1 },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.grantIgnoreTapRequirement(opp, uid);
  },
});
const reverseSlayerThisTurn = () => ({
  target: null,
  resolve(engine, side) {
    engine.turnFlags[side] = engine.turnFlags[side] || {};
    engine.turnFlags[side].blockersDieAfterBattle = true;
  },
});
const manaToGraveyardSelf = (n) => ({ target: null, resolve(engine, side) { engine.sendOwnManaToGraveyard(side, n); } });
const deckTopToManaSelf = (n) => ({ target: null, resolve(engine, side) { engine.deckTopToMana(side, n); } });

// ---- 第2弾で追加されたパターン ----
const graveyardCardToHand = (min, max, filter) => ({
  target: { kind: 'ownGraveyardCard', min, max, filter },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.graveyardCreatureToHand(side, uid);
  },
});
const destroyEnemyManaOne = (min, max) => ({
  target: { kind: 'enemyManaCard', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.manaCardToGraveyard(opp, uid);
  },
});
const eachPlayerManaToGraveyardAbility = (n) => ({ target: null, resolve(engine) { engine.eachPlayerManaToGraveyard(n); } });
const millOwnShieldAbility = () => ({ target: null, resolve(engine, side) { engine.millOwnShieldRandom(side); } });
const peekOpponentShieldsAbility = (n) => ({ target: null, resolve(engine, side) { engine.peekOpponentShields(side, n); } });
const creatureToDeckTopOne = (min, max) => ({
  target: { kind: 'enemyCreature', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.creatureToDeckTop(opp, uid);
  },
});
const tutorToManaAbility = (min, max, filter) => ({
  target: { kind: 'deckTutor', min, max, filter },
  resolve(engine, side, uids) { engine.tutorToMana(side, uids[0] ?? null); },
});
const discardAllHandAbility = () => ({ target: null, resolve(engine, side) { engine.discardAllHand(engine.opponent(side)); } });
const drawEqualToEnemyCount = () => ({
  target: null,
  resolve(engine, side) { engine.drawCardsSafe(side, engine.players[engine.opponent(side)].battle.length); },
});
const ignoreAttackRestrictionsSpell = () => ({
  target: null,
  resolve(engine, side) {
    engine.turnFlags[side] = engine.turnFlags[side] || {};
    engine.turnFlags[side].ignoreAttackRestrictions = true;
  },
});
const teamBuffAndIgnoreTapSpell = (amount) => ({
  target: null,
  resolve(engine, side) {
    engine.teamAttackBuff(side, amount);
    engine.turnFlags[side] = engine.turnFlags[side] || {};
    engine.turnFlags[side].teamIgnoreTapRequirement = true;
  },
});

const powerAtMost = (max) => (engine, side, c) => engine.cardOf(c).power <= max;
const untappedOnly = () => (engine, side, c) => !c.tapped;
const excludeSelf = () => (engine, side, c) => !engine.pendingCip || c.uid !== engine.pendingCip.casterUid;
const isType = (type) => (engine, side, c) => engine.cardOf(c).type === type;
const isCiv = (civ) => (engine, side, c) => {
  const cc = engine.cardOf(c).civ;
  return Array.isArray(cc) ? cc.includes(civ) : cc === civ;
};
const isBlockerCard = () => (engine, side, c) => isBlocker(engine.cardOf(c));

const CARD_DB = {
  // ===================== 火文明 (24) =====================
  crimsonWyvern: {
    id: 'crimsonWyvern', name: 'クリムゾン・ワイバーン', civ: 'fire', type: 'creature', rarity: 'SR',
    cost: 8, power: 3000, race: 'アーマード・ワイバーン',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある「ブロッカー」を持つクリーチャーをすべて、持ち主の墓地に置く。',
    onPlay: {
      target: null,
      resolve(engine) {
        for (const side of ['player', 'cpu']) {
          const uids = engine.players[side].battle.filter((c) => isBlocker(engine.cardOf(c))).map((c) => c.uid);
          for (const uid of uids) engine.destroyCreature(side, uid);
        }
      },
    },
  },
  meteorDragon: {
    id: 'meteorDragon', name: 'メテオ・ドラゴン', civ: 'fire', type: 'creature', rarity: 'SR',
    cost: 7, power: 6000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。パワーアタッカー+4000。',
    keywords: { doubleBreaker: true, powerAttacker: 4000 },
  },
  gatlingWyvern: {
    id: 'gatlingWyvern', name: 'ガトリング・ワイバーン', civ: 'fire', type: 'creature', rarity: 'VR',
    cost: 7, power: 7000, race: 'アーマード・ワイバーン',
    text: 'W・ブレイカー。このクリーチャーは、タップされていないクリーチャーを攻撃できる。',
    keywords: { doubleBreaker: true, untapKiller: true },
  },
  bolshackDragon: {
    id: 'bolshackDragon', name: 'ボルシャック・ドラゴン', civ: 'fire', type: 'creature', rarity: 'VR',
    cost: 6, power: 6000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。攻撃中、このクリーチャーのパワーを、自分の墓地にある火のカード1枚につき+1000する。',
    keywords: { doubleBreaker: true, powerAttackerPerGraveyardCiv: { civ: 'fire', amount: 1000 } },
  },
  bakuyushiYukarn: {
    id: 'bakuyushiYukarn', name: '爆勇士ユーカーン', civ: 'fire', type: 'creature', rarity: 'R',
    cost: 5, power: 9000, race: 'ドラゴノイド',
    text: 'W・ブレイカー。このクリーチャーをバトルゾーンに出した時、カードを2枚、自分のマナゾーンから墓地に置く。',
    keywords: { doubleBreaker: true },
    onPlay: manaToGraveyardSelf(2),
  },
  dragride: {
    id: 'dragride', name: 'ドラグライド', civ: 'fire', type: 'creature', rarity: 'R',
    cost: 5, power: 5000, race: 'アーマード・ワイバーン',
    text: 'このクリーチャーは、可能であれば毎ターン攻撃する。',
    keywords: { forcedAttacker: true },
  },
  horoNoYushaJijo: {
    id: 'horoNoYushaJijo', name: '放浪の勇者ジージョ', civ: 'fire', type: 'creature', rarity: 'R',
    cost: 5, power: 3000, race: 'マシン・イーター',
    text: 'このクリーチャーは、タップされていないクリーチャーを攻撃できる。',
    keywords: { untapKiller: true },
  },
  jushinheiDiolaios: {
    id: 'jushinheiDiolaios', name: '銃神兵ディオライオス', civ: 'fire', type: 'creature', rarity: 'R',
    cost: 4, power: 4000, race: 'アーマロイド',
    text: 'このクリーチャーをバトルゾーンに出した時、自分のクリーチャーを1体破壊する。その後、相手は自分自身のクリーチャーを1体選び、破壊する。',
    onPlay: {
      target: { kind: 'ownCreature', min: 1, max: 1, intent: 'harmful' },
      resolve(engine, side, uids) {
        for (const uid of uids) engine.destroyCreature(side, uid);
        const opp = engine.opponent(side);
        const w = engine.pickWeakestOwnCreatureUid(opp);
        if (w != null) engine.destroyCreature(opp, w);
      },
    },
  },
  magmaGazer: {
    id: 'magmaGazer', name: 'マグマ・ゲイザー', civ: 'fire', type: 'spell', rarity: 'R',
    cost: 3,
    text: 'このターンの終わりまで、バトルゾーンにある自分のクリーチャー1体は、「パワーアタッカー+4000」と「W・ブレイカー」を得る。',
    spell: grantAttackBuffOne(4000, true),
  },
  chaosStrike: {
    id: 'chaosStrike', name: 'カオス・ストライク', civ: 'fire', type: 'spell', rarity: 'R',
    cost: 2,
    text: 'バトルゾーンにある相手のクリーチャーを1体選ぶ。このターン、選んだクリーチャーがタップされていなくても攻撃できる。',
    spell: grantIgnoreTapSpell(),
  },
  stonesaurus: {
    id: 'stonesaurus', name: 'ストーンザウルス', civ: 'fire', type: 'creature', rarity: 'UC',
    cost: 5, power: 4000, race: 'ロック・ビースト',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  meteorsaurus: {
    id: 'meteorsaurus', name: 'メテオザウルス', civ: 'fire', type: 'creature', rarity: 'UC',
    cost: 5, power: 2000, race: 'ロック・ビースト',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手のパワー2000以下のクリーチャーを1体破壊してもよい。',
    onPlay: destroyEnemyOne(0, 1, powerAtMost(2000)),
  },
  sojinheiUruherion: {
    id: 'sojinheiUruherion', name: '走神兵ウルヘリオン', civ: 'fire', type: 'creature', rarity: 'UC',
    cost: 4, power: 3000, race: 'アーマロイド',
    text: 'バトルゾーンに自分のヒューマノイドがあれば、攻撃中、このクリーチャーのパワーは+2000される。',
    keywords: { powerAttackerCondition: { race: 'ヒューマノイド', amount: 2000 } },
  },
  chohoshuVolcanodon: {
    id: 'chohoshuVolcanodon', name: '超砲手ボルカノドン', civ: 'fire', type: 'creature', rarity: 'UC',
    cost: 4, power: 2000, race: 'ドラゴノイド',
    text: 'パワーアタッカー+4000。',
    keywords: { powerAttacker: 4000 },
  },
  kyoshuheiGigantos: {
    id: 'kyoshuheiGigantos', name: '強襲兵ギガントス', civ: 'fire', type: 'creature', rarity: 'UC',
    cost: 3, power: 5000, race: 'ドラゴノイド',
    text: 'このクリーチャーをバトルゾーンに出した時、カードを1枚、自分のマナゾーンから墓地に置く。',
    onPlay: manaToGraveyardSelf(1),
  },
  tornadoFlame: {
    id: 'tornadoFlame', name: 'トルネード・フレーム', civ: 'fire', type: 'spell', rarity: 'UC',
    cost: 5,
    text: 'S・トリガー。相手のパワー4000以下のクリーチャーを1体破壊する。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyOne(1, 1, powerAtMost(4000)),
  },
  soutoheiBurningHell: {
    id: 'soutoheiBurningHell', name: '掃討兵バーニング・ヘル', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 4, power: 3000, race: 'ドラゴノイド',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  ichigekihissatsuNoHorbus: {
    id: 'ichigekihissatsuNoHorbus', name: '一撃必殺のホーバス', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 3, power: 2000, race: 'ヒューマノイド',
    text: 'バトルゾーンに自分のアーマロイドがあれば、攻撃中、このクリーチャーのパワーは+2000される。',
    keywords: { powerAttackerCondition: { race: 'アーマロイド', amount: 2000 } },
  },
  fujishinDanshakuBorg: {
    id: 'fujishinDanshakuBorg', name: '不死身男爵ボーグ', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 2, power: 2000, race: 'ヒューマノイド', text: '',
  },
  kenkayaTyler: {
    id: 'kenkayaTyler', name: '喧嘩屋タイラー', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 2, power: 1000, race: 'ヒューマノイド',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  shokuninPicola: {
    id: 'shokuninPicola', name: '職人ピコラ', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 1, power: 2000, race: 'マシン・イーター',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分のマナゾーンからカードを1枚選び、自分の墓地に置く。',
    onPlay: manaToGraveyardSelf(1),
  },
  kyosenshiBlazeClaw: {
    id: 'kyosenshiBlazeClaw', name: '凶戦士ブレイズ・クロー', civ: 'fire', type: 'creature', rarity: 'C',
    cost: 1, power: 1000, race: 'ドラゴノイド',
    text: 'このクリーチャーは、可能なら毎ターン攻撃する。',
    keywords: { forcedAttacker: true },
  },
  crimsonHammer: {
    id: 'crimsonHammer', name: 'クリムゾン・ハンマー', civ: 'fire', type: 'spell', rarity: 'C',
    cost: 2,
    text: '相手のパワー2000以下のクリーチャーを1体選び、破壊する。',
    spell: destroyEnemyOne(1, 1, powerAtMost(2000)),
  },
  burningPower: {
    id: 'burningPower', name: 'バーニング・パワー', civ: 'fire', type: 'spell', rarity: 'C',
    cost: 1,
    text: 'バトルゾーンにある自分のクリーチャーを1体選ぶ。このターンの攻撃中、そのクリーチャーのパワーは+2000される。',
    spell: grantAttackBuffOne(2000, false),
  },

  // ===================== 水文明 (24) =====================
  aquaSniper: {
    id: 'aquaSniper', name: 'アクア・スナイパー', civ: 'water', type: 'creature', rarity: 'SR',
    cost: 8, power: 5000, race: 'リキッド・ピープル',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにあるクリーチャーを2体まで選び、持ち主の手札に戻す。',
    onPlay: bounceAny(0, 2),
  },
  kingOrion: {
    id: 'kingOrion', name: 'キング・オリオン', civ: 'water', type: 'creature', rarity: 'SR',
    cost: 7, power: 6000, race: 'リヴァイアサン',
    text: 'W・ブレイカー。このクリーチャーはブロックされない。',
    keywords: { doubleBreaker: true, unblockable: true },
  },
  kingPoseidon: {
    id: 'kingPoseidon', name: 'キング・ポセイドン', civ: 'water', type: 'creature', rarity: 'VR',
    cost: 7, power: 5000, race: 'リヴァイアサン',
    text: 'このクリーチャーをバトルゾーンに出した時、カードを2枚引いてもよい。',
    onPlay: drawAlways(2),
  },
  seamine: {
    id: 'seamine', name: 'シーマイン', civ: 'water', type: 'creature', rarity: 'VR',
    cost: 6, power: 4000, race: 'フィッシュ',
    text: 'ブロッカー。',
    keywords: { blocker: true },
  },
  aquaNight: {
    id: 'aquaNight', name: 'アクア・ナイト', civ: 'water', type: 'creature', rarity: 'R',
    cost: 5, power: 4000, race: 'リキッド・ピープル',
    text: 'このクリーチャーが破壊される時、墓地に置くかわりに自分の手札に戻す。',
    keywords: { onDestroy: 'hand' },
  },
  sorcererheadShark: {
    id: 'sorcererheadShark', name: 'ソーサーヘッド・シャーク', civ: 'water', type: 'creature', rarity: 'R',
    cost: 5, power: 3000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにあるパワー2000以下のクリーチャーをすべて、持ち主の手札に戻す。',
    onPlay: {
      target: null,
      resolve(engine) {
        for (const side of ['player', 'cpu']) {
          const uids = engine.players[side].battle.filter((c) => engine.powerBase(side, c) <= 2000).map((c) => c.uid);
          for (const uid of uids) engine.bounceCreature(side, uid);
        }
      },
    },
  },
  tropico: {
    id: 'tropico', name: 'トロピコ', civ: 'water', type: 'creature', rarity: 'R',
    cost: 5, power: 3000, race: 'サイバーロード',
    text: 'バトルゾーンに自分のクリーチャーが他に2体以上出ているなら、このクリーチャーはブロックされない。',
    keywords: { unblockableIfOwnCount: 3 },
  },
  ikkakugyo: {
    id: 'ikkakugyo', name: '一角魚', civ: 'water', type: 'creature', rarity: 'R',
    cost: 4, power: 1000, race: 'フィッシュ',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにあるクリーチャーを1体選び、持ち主の手札に戻してもよい。',
    onPlay: bounceAny(0, 1),
  },
  teleportation: {
    id: 'teleportation', name: 'テレポーテーション', civ: 'water', type: 'spell', rarity: 'R',
    cost: 5,
    text: 'バトルゾーンにあるクリーチャーを2体まで選び、持ち主の手札に戻す。',
    spell: bounceAny(0, 2),
  },
  crystalMemory: {
    id: 'crystalMemory', name: 'クリスタル・メモリー', civ: 'water', type: 'spell', rarity: 'R',
    cost: 4,
    text: 'S・トリガー。自分の山札を見る。その中からカードを1枚選び、自分の手札に加える。その後、山札をシャッフルする。',
    keywords: { shieldTrigger: true },
    spell: deckTutor(1, 1),
  },
  mirageMermaid: {
    id: 'mirageMermaid', name: 'ミラージュ・マーメイド', civ: 'water', type: 'creature', rarity: 'UC',
    cost: 5, power: 4000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンに自分のサイバーロードがあれば、カードを3枚引いてよい。',
    onPlay: {
      target: null,
      resolve(engine, side) { if (engine.hasRace(side, 'サイバーロード')) engine.drawCardsSafe(side, 3); },
    },
  },
  revolverFish: {
    id: 'revolverFish', name: 'リボルバー・フィッシュ', civ: 'water', type: 'creature', rarity: 'UC',
    cost: 4, power: 5000, race: 'ゲル・フィッシュ',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  fairyChild: {
    id: 'fairyChild', name: 'フェアリー・チャイルド', civ: 'water', type: 'creature', rarity: 'UC',
    cost: 4, power: 2000, race: 'サイバー・ウイルス',
    text: 'このクリーチャーはブロックされない。',
    keywords: { unblockable: true },
  },
  aquaSoldier: {
    id: 'aquaSoldier', name: 'アクア・ソルジャー', civ: 'water', type: 'creature', rarity: 'UC',
    cost: 3, power: 1000, race: 'リキッド・ピープル',
    text: 'このクリーチャーが破壊される時、墓地に置くかわりに自分の手札に戻す。',
    keywords: { onDestroy: 'hand' },
  },
  kingKraken: {
    id: 'kingKraken', name: 'キング・クラーケン', civ: 'water', type: 'creature', rarity: 'UC',
    cost: 3, power: 1000, race: 'リヴァイアサン',
    text: 'ブロッカー。',
    keywords: { blocker: true },
  },
  cyberBrain: {
    id: 'cyberBrain', name: 'サイバー・ブレイン', civ: 'water', type: 'spell', rarity: 'UC',
    cost: 4,
    text: 'S・トリガー。カードを3枚まで引く。',
    keywords: { shieldTrigger: true },
    spell: drawAlways(3),
  },
  phantomFish: {
    id: 'phantomFish', name: 'ファントム・フィッシュ', civ: 'water', type: 'creature', rarity: 'C',
    cost: 3, power: 4000, race: 'ゲル・フィッシュ',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  aquaHarukasu: {
    id: 'aquaHarukasu', name: 'アクア・ハルカス', civ: 'water', type: 'creature', rarity: 'C',
    cost: 3, power: 2000, race: 'リキッド・ピープル',
    text: 'このクリーチャーがバトルゾーンに出た時、カードを1枚引いてもよい。',
    onPlay: drawAlways(1),
  },
  candyDrop: {
    id: 'candyDrop', name: 'キャンディ・ドロップ', civ: 'water', type: 'creature', rarity: 'C',
    cost: 3, power: 1000, race: 'サイバー・ウイルス',
    text: 'このクリーチャーはブロックされない。',
    keywords: { unblockable: true },
  },
  shuryogyo: {
    id: 'shuryogyo', name: '狩猟魚', civ: 'water', type: 'creature', rarity: 'C',
    cost: 2, power: 3000, race: 'フィッシュ',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  aquaVehicle: {
    id: 'aquaVehicle', name: 'アクア・ビークル', civ: 'water', type: 'creature', rarity: 'C',
    cost: 2, power: 1000, race: 'リキッド・ピープル', text: '',
  },
  aquaGuard: {
    id: 'aquaGuard', name: 'アクア・ガード', civ: 'water', type: 'creature', rarity: 'C',
    cost: 1, power: 2000, race: 'リキッド・ピープル',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  elementalTrap: {
    id: 'elementalTrap', name: 'エレメンタル・トラップ', civ: 'water', type: 'spell', rarity: 'C',
    cost: 3,
    text: 'バトルゾーンにある相手のクリーチャーを1体選び、タップする。',
    spell: tapEnemy(1, 1),
  },
  spiralGate: {
    id: 'spiralGate', name: 'スパイラル・ゲート', civ: 'water', type: 'spell', rarity: 'C',
    cost: 2,
    text: 'S・トリガー。クリーチャーを1体選び、持ち主の手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: bounceAny(1, 1),
  },

  // ===================== 自然文明 (24) =====================
  hoekuruGreatHorn: {
    id: 'hoekuruGreatHorn', name: '咆哮するグレート・ホーン', civ: 'nature', type: 'creature', rarity: 'SR',
    cost: 7, power: 8000, race: 'ホーン・ビースト',
    text: 'W・ブレイカー。パワーアタッカー+2000。',
    keywords: { doubleBreaker: true, powerAttacker: 2000 },
  },
  deathbladeBeetle: {
    id: 'deathbladeBeetle', name: 'デスブレード・ビートル', civ: 'nature', type: 'creature', rarity: 'SR',
    cost: 5, power: 3000, race: 'ジャイアント・インセクト',
    text: 'W・ブレイカー。パワーアタッカー+4000。',
    keywords: { doubleBreaker: true, powerAttacker: 4000 },
  },
  shellTower: {
    id: 'shellTower', name: 'シェル・タワー', civ: 'nature', type: 'creature', rarity: 'VR',
    cost: 6, power: 5000, race: 'コロニー・ビートル',
    text: 'このクリーチャーは、パワー4000以下のクリーチャーにブロックされない。',
    keywords: { unblockableByPowerAtMost: 4000 },
  },
  togesashiMandra: {
    id: 'togesashiMandra', name: 'トゲ刺しマンドラ', civ: 'nature', type: 'creature', rarity: 'VR',
    cost: 5, power: 4000, race: 'ツリーフォーク',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分の墓地からクリーチャーを1体選び、自分のマナゾーンに置いてよい。',
    onPlay: graveyardToManaOne(0, 1),
  },
  shellStorm: {
    id: 'shellStorm', name: 'シェル・ストーム', civ: 'nature', type: 'creature', rarity: 'R',
    cost: 7, power: 2000, race: 'コロニー・ビートル',
    text: 'このクリーチャーがバトルゾーンに出たとき、相手はバトルゾーンから自分自身のクリーチャーを1体選び、持ち主のマナゾーンに置く。',
    onPlay: opponentForcedManaizeOwn(),
  },
  mureOMamoruTryHorn: {
    id: 'mureOMamoruTryHorn', name: '群れを守るトライ・ホーン', civ: 'nature', type: 'creature', rarity: 'R',
    cost: 5, power: 5000, race: 'ホーン・ビースト', text: '',
  },
  redEyeScorpion: {
    id: 'redEyeScorpion', name: 'レッドアイ・スコーピオン', civ: 'nature', type: 'creature', rarity: 'R',
    cost: 5, power: 4000, race: 'ジャイアント・インセクト',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれるとき、墓地に置くかわりに自分のマナゾーンに置く。',
    keywords: { onDestroy: 'mana' },
  },
  bosoSuruLongHorn: {
    id: 'bosoSuruLongHorn', name: '暴走するロング・ホーン', civ: 'nature', type: 'creature', rarity: 'R',
    cost: 5, power: 4000, race: 'ホーン・ビースト',
    text: 'このクリーチャーは、パワー3000以下のクリーチャーにブロックされない。',
    keywords: { unblockableByPowerAtMost: 3000 },
  },
  naturalTrap: {
    id: 'naturalTrap', name: 'ナチュラル・トラップ', civ: 'nature', type: 'spell', rarity: 'R',
    cost: 6,
    text: 'S・トリガー。相手のクリーチャーを1体選び、持ち主のマナゾーンに置く。',
    keywords: { shieldTrigger: true },
    spell: manaizeEnemyOne(1, 1),
  },
  auraBlaster: {
    id: 'auraBlaster', name: 'オーラ・ブラスター', civ: 'nature', type: 'spell', rarity: 'R',
    cost: 4,
    text: 'このターン、バトルゾーンにある自分のクリーチャーすべてのパワーは攻撃中+2000される。',
    spell: teamAttackBuffSpell(2000),
  },
  dokuhakiDahlia: {
    id: 'dokuhakiDahlia', name: '毒吐きダリア', civ: 'nature', type: 'creature', rarity: 'UC',
    cost: 4, power: 5000, race: 'ツリーフォーク',
    text: 'このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { cannotAttackPlayer: true },
  },
  forestHornet: {
    id: 'forestHornet', name: 'フォレスト・ホーネット', civ: 'nature', type: 'creature', rarity: 'UC',
    cost: 4, power: 4000, race: 'ジャイアント・インセクト', text: '',
  },
  karamiKazura: {
    id: 'karamiKazura', name: 'からみカズラ', civ: 'nature', type: 'creature', rarity: 'UC',
    cost: 4, power: 3000, race: 'ツリーフォーク',
    text: 'このクリーチャーが破壊された時、自分のマナゾーンに置く。',
    keywords: { onDestroy: 'mana' },
  },
  shellDome: {
    id: 'shellDome', name: 'シェル・ドーム', civ: 'nature', type: 'creature', rarity: 'UC',
    cost: 4, power: 3000, race: 'コロニー・ビートル',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  shibireashidake: {
    id: 'shibireashidake', name: 'シビレアシダケ', civ: 'nature', type: 'creature', rarity: 'UC',
    cost: 2, power: 1000, race: 'バルーン・マッシュルーム',
    text: 'このクリーチャーがバトルゾーンに出た時、自分の手札を1枚、マナゾーンに置いてもよい。',
    onPlay: handCardToManaOne(0, 1),
  },
  gaiasSong: {
    id: 'gaiasSong', name: 'ガイアズ・ソング', civ: 'nature', type: 'spell', rarity: 'UC',
    cost: 1,
    text: 'バトルゾーンにある自分のクリーチャーを1体、自分のマナゾーンに置く。',
    spell: ownCreatureToManaOne(1, 1),
  },
  hakuginNoKiba: {
    id: 'hakuginNoKiba', name: '白銀の牙', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 3, power: 3000, race: 'ビーストフォーク', text: '',
  },
  ogonNoTsubasa: {
    id: 'ogonNoTsubasa', name: '黄金の翼', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 3, power: 2000, race: 'ビーストフォーク',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  mutekiNoHoko: {
    id: 'mutekiNoHoko', name: '無敵の咆哮', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 3, power: 2000, race: 'ビーストフォーク',
    text: 'このクリーチャーが破壊される時、墓地に置くかわりに自分のマナゾーンに置く。',
    keywords: { onDestroy: 'mana' },
  },
  seidoNoYoroi: {
    id: 'seidoNoYoroi', name: '青銅の鎧', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 3, power: 1000, race: 'ビーストフォーク',
    text: 'このクリーチャーがバトルゾーンに出た時、自分の山札の上から1枚目をマナゾーンに置く。',
    onPlay: deckTopToManaSelf(1),
  },
  koutetsuNoTsuchi: {
    id: 'koutetsuNoTsuchi', name: '鋼鉄の鎚', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 2, power: 3000, race: 'ビーストフォーク',
    text: 'このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { cannotAttackPlayer: true },
  },
  honoNoTategami: {
    id: 'honoNoTategami', name: '炎のたてがみ', civ: 'nature', type: 'creature', rarity: 'C',
    cost: 2, power: 2000, race: 'ビーストフォーク', text: '',
  },
  ultimateForce: {
    id: 'ultimateForce', name: 'アルティメット・フォース', civ: 'nature', type: 'spell', rarity: 'C',
    cost: 5,
    text: '自分の山札の上から2枚を自分のマナゾーンに置く。',
    spell: deckTopToManaSelf(2),
  },
  dimensionGate: {
    id: 'dimensionGate', name: 'ディメンジョン・ゲート', civ: 'nature', type: 'spell', rarity: 'C',
    cost: 3,
    text: 'S・トリガー。自分の山札を見る。その中からクリーチャーを1体表向きにし、自分の手札に加えてもよい。その後、山札をシャッフルする。',
    keywords: { shieldTrigger: true },
    spell: deckTutor(0, 1, isType('creature')),
  },

  // ===================== 光文明 (24) =====================
  koRinNoSeireiShauna: {
    id: 'koRinNoSeireiShauna', name: '光輪の精霊シャウナ', civ: 'light', type: 'creature', rarity: 'SR',
    cost: 7, power: 9500, race: 'エンジェル・コマンド',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  jokaNoSeireiUrusu: {
    id: 'jokaNoSeireiUrusu', name: '浄化の精霊ウルス', civ: 'light', type: 'creature', rarity: 'SR',
    cost: 6, power: 6000, race: 'エンジェル・コマンド',
    text: 'W・ブレイカー。自分のターンの終わりに、このクリーチャーをアンタップしてもよい。',
    keywords: { doubleBreaker: true, endOfTurnUntap: 'self' },
  },
  tenkuNoShugoshaGranGure: {
    id: 'tenkuNoShugoshaGranGure', name: '天空の守護者グラン・ギューレ', civ: 'light', type: 'creature', rarity: 'VR',
    cost: 6, power: 9000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  shinriNoDendoshiReila: {
    id: 'shinriNoDendoshiReila', name: '真理の伝道師レイーラ', civ: 'light', type: 'creature', rarity: 'VR',
    cost: 6, power: 3000, race: 'バーサーカー',
    text: 'このクリーチャーをバトルゾーンに出した時、自分の山札を見る。その中から呪文を1枚選んで相手に見せ、自分の手札に加えてもよい。その後、山札をシャッフルする。',
    onPlay: deckTutor(0, 1, isType('spell')),
  },
  tasogareNoShugoshaShievesKeen: {
    id: 'tasogareNoShugoshaShievesKeen', name: '黄昏の守護者シーブス・キーン', civ: 'light', type: 'creature', rarity: 'R',
    cost: 5, power: 6000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  shukuseiNoDendoshiRah: {
    id: 'shukuseiNoDendoshiRah', name: '粛清の伝道師ラー', civ: 'light', type: 'creature', rarity: 'R',
    cost: 5, power: 5500, race: 'バーサーカー', text: '',
  },
  gekkoNoShugoshaDiaNork: {
    id: 'gekkoNoShugoshaDiaNork', name: '月光の守護者ディア・ノーク', civ: 'light', type: 'creature', rarity: 'R',
    cost: 4, power: 5000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  yogenshaKirias: {
    id: 'yogenshaKirias', name: '予言者キリアス', civ: 'light', type: 'creature', rarity: 'R',
    cost: 4, power: 2500, race: 'ライトブリンガー',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれるとき、墓地に置くかわりに自分の手札に戻す。',
    keywords: { onDestroy: 'hand' },
  },
  holySpark: {
    id: 'holySpark', name: 'ホーリー・スパーク', civ: 'light', type: 'spell', rarity: 'R',
    cost: 6,
    text: 'S・トリガー。バトルゾーンにある相手のクリーチャーをすべてタップする。',
    keywords: { shieldTrigger: true },
    spell: tapAllEnemy(),
  },
  laserWing: {
    id: 'laserWing', name: 'レーザー・ウイング', civ: 'light', type: 'spell', rarity: 'R',
    cost: 5,
    text: 'バトルゾーンにある自分のクリーチャーを2体まで選ぶ。このターン、そのクリーチャーはブロックされない。',
    spell: grantUnblockableSpell(0, 2),
  },
  kiboNoShitoThor: {
    id: 'kiboNoShitoThor', name: '希望の使徒トール', civ: 'light', type: 'creature', rarity: 'UC',
    cost: 5, power: 2000, race: 'イニシエート',
    text: '自分のターンの終わりに、バトルゾーンにある自分のクリーチャーをすべてアンタップしてもよい。',
    keywords: { endOfTurnUntap: 'all' },
  },
  tsuisekiNoShitoLoak: {
    id: 'tsuisekiNoShitoLoak', name: '追跡の使徒ローク', civ: 'light', type: 'creature', rarity: 'UC',
    cost: 4, power: 4000, race: 'イニシエート', text: '',
  },
  taikiNoShitoFrey: {
    id: 'taikiNoShitoFrey', name: '大気の使徒フレイ', civ: 'light', type: 'creature', rarity: 'UC',
    cost: 4, power: 3000, race: 'イニシエート',
    text: '自分のターンの終わりに、このクリーチャーをアンタップしてもよい。',
    keywords: { endOfTurnUntap: 'self' },
  },
  koGyokuSo: {
    id: 'koGyokuSo', name: '紅玉草', civ: 'light', type: 'creature', rarity: 'UC',
    cost: 3, power: 3000, race: 'スターライト・ツリー',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。自分のターンの終わりに、このクリーチャーをアンタップしてもよい。',
    keywords: { blocker: true, cannotAttackPlayer: true, endOfTurnUntap: 'self' },
  },
  yogenshaKatino: {
    id: 'yogenshaKatino', name: '予言者カティノ', civ: 'light', type: 'creature', rarity: 'UC',
    cost: 2, power: 2000, race: 'ライトブリンガー',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。バトルゾーンに自分のエンジェル・コマンドがあれば、このクリーチャーのパワーは+2000される。',
    keywords: { blocker: true, cannotAttackPlayer: true, staticPowerBonusCondition: { race: 'エンジェル・コマンド', amount: 2000 } },
  },
  moonlightFlash: {
    id: 'moonlightFlash', name: 'ムーンライト・フラッシュ', civ: 'light', type: 'spell', rarity: 'UC',
    cost: 4,
    text: 'バトルゾーンにある相手のクリーチャーを2体まで選び、タップする。',
    spell: tapEnemy(0, 2),
  },
  hisuiju: {
    id: 'hisuiju', name: '翡翠樹', civ: 'light', type: 'creature', rarity: 'C',
    cost: 3, power: 4000, race: 'スターライト・ツリー',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  dangganNoShitoEile: {
    id: 'dangganNoShitoEile', name: '弾丸の使徒イーレ', civ: 'light', type: 'creature', rarity: 'C',
    cost: 3, power: 3000, race: 'イニシエート', text: '',
  },
  raikoNoShitoMirl: {
    id: 'raikoNoShitoMirl', name: '雷光の使徒ミール', civ: 'light', type: 'creature', rarity: 'C',
    cost: 3, power: 1000, race: 'イニシエート',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手のクリーチャーを1体選び、タップしてもよい。',
    onPlay: tapEnemy(0, 1),
  },
  hekigyokuSo: {
    id: 'hekigyokuSo', name: '碧玉草', civ: 'light', type: 'creature', rarity: 'C',
    cost: 2, power: 3000, race: 'スターライト・ツリー',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  yogenshaRyuzol: {
    id: 'yogenshaRyuzol', name: '予言者リュゾル', civ: 'light', type: 'creature', rarity: 'C',
    cost: 2, power: 2000, race: 'ライトブリンガー', text: '',
  },
  sotenNoShugoshaLaUraGiga: {
    id: 'sotenNoShugoshaLaUraGiga', name: '蒼天の守護者ラ・ウラ・ギガ', civ: 'light', type: 'creature', rarity: 'C',
    cost: 1, power: 2000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  sonicWing: {
    id: 'sonicWing', name: 'ソニック・ウイング', civ: 'light', type: 'spell', rarity: 'C',
    cost: 3,
    text: 'バトルゾーンにある自分のクリーチャーを1体選ぶ。このターン、そのクリーチャーはブロックされない。',
    spell: grantUnblockableSpell(1, 1),
  },
  solarRay: {
    id: 'solarRay', name: 'ソーラー・レイ', civ: 'light', type: 'spell', rarity: 'C',
    cost: 2,
    text: 'S・トリガー。バトルゾーンにある相手のクリーチャーを1体選び、タップする。',
    keywords: { shieldTrigger: true },
    spell: tapEnemy(1, 1),
  },

  // ===================== 闇文明 (24) =====================
  konTonNoShishiDeathliger: {
    id: 'konTonNoShishiDeathliger', name: '混沌の獅子デスライガー', civ: 'dark', type: 'creature', rarity: 'SR',
    cost: 7, power: 9000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  ankokuNoKishiZagaan: {
    id: 'ankokuNoKishiZagaan', name: '暗黒の騎士ザガーン', civ: 'dark', type: 'creature', rarity: 'SR',
    cost: 6, power: 7000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  yokihiSylphy: {
    id: 'yokihiSylphy', name: '妖姫シルフィ', civ: 'dark', type: 'creature', rarity: 'VR',
    cost: 8, power: 4000, race: 'ダークロード',
    text: 'このクリーチャーがバトルゾーンに出たとき、各プレイヤーはバトルゾーンにあるパワー3000以下のクリーチャーすべてを、それぞれの墓地に置く。',
    onPlay: symmetricWipe(3000),
  },
  gigalgon: {
    id: 'gigalgon', name: 'ギガルゴン', civ: 'dark', type: 'creature', rarity: 'VR',
    cost: 8, power: 3000, race: 'キマイラ',
    text: 'このクリーチャーをバトルゾーンに出した時、クリーチャーを2体まで、自分の墓地から手札に戻す。',
    onPlay: graveyardToHand(0, 2),
  },
  horobiNoKageNightMaster: {
    id: 'horobiNoKageNightMaster', name: '滅びの影ナイト・マスター', civ: 'dark', type: 'creature', rarity: 'R',
    cost: 6, power: 3000, race: 'ゴースト',
    text: 'ブロッカー。',
    keywords: { blocker: true },
  },
  gigaberos: {
    id: 'gigaberos', name: 'ギガベロス', civ: 'dark', type: 'creature', rarity: 'R',
    cost: 5, power: 8000, race: 'キマイラ',
    text: 'W・ブレイカー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある自分の他のクリーチャー2体を自分の墓地に置く。そうしなければ、このクリーチャーを自分の墓地に置く。',
    keywords: { doubleBreaker: true },
    onPlay: {
      target: { kind: 'ownCreature', min: 0, max: 2, filter: excludeSelf(), intent: 'harmful' },
      resolve(engine, side, uids) {
        if (uids.length >= 2) {
          for (const uid of uids.slice(0, 2)) engine.destroyCreature(side, uid);
        } else if (engine.pendingCip) {
          engine.destroyCreature(side, engine.pendingCip.casterUid);
        }
      },
    },
  },
  gigazeel: {
    id: 'gigazeel', name: 'ギガジール', civ: 'dark', type: 'creature', rarity: 'R',
    cost: 5, power: 3000, race: 'キマイラ',
    text: 'スレイヤー。',
    keywords: { slayer: true },
  },
  darkCrown: {
    id: 'darkCrown', name: 'ダーク・クラウン', civ: 'dark', type: 'creature', rarity: 'R',
    cost: 4, power: 6000, race: 'ブレインジャッカー',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。このクリーチャーがバトルする時、バトルの後、このクリーチャーを破壊する。',
    keywords: { blocker: true, cannotAttack: true, selfDestructAfterBattle: true },
  },
  demonHand: {
    id: 'demonHand', name: 'デーモン・ハンド', civ: 'dark', type: 'spell', rarity: 'R',
    cost: 6,
    text: 'S・トリガー。相手のクリーチャーを1体選び、破壊する。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyOne(1, 1),
  },
  blackSlayer: {
    id: 'blackSlayer', name: 'ブラック・スレイヤー', civ: 'dark', type: 'spell', rarity: 'R',
    cost: 1,
    text: 'このターン、自分のクリーチャーをブロックした相手クリーチャーはすべて、バトルに勝っても持ち主の墓地に置かれる。',
    spell: reverseSlayerThisTurn(),
  },
  fushokuchuSwampWorm: {
    id: 'fushokuchuSwampWorm', name: '腐食虫スワンプワーム', civ: 'dark', type: 'creature', rarity: 'UC',
    cost: 7, power: 2000, race: 'パラサイトワーム',
    text: 'このクリーチャーをバトルゾーンに出した時、相手は自分自身のクリーチャーを1体選び、破壊する。',
    onPlay: opponentForcedDestroyOwn(),
  },
  azakeriNoKageMaskedHorror: {
    id: 'azakeriNoKageMaskedHorror', name: '嘲りの影マスクド・ホラー', civ: 'dark', type: 'creature', rarity: 'UC',
    cost: 5, power: 1000, race: 'ゴースト',
    text: 'このクリーチャーがバトルゾーンに出たとき、相手の手札からカードを1枚見ないで選び、相手はそれを持ち主の墓地に置く。',
    onPlay: randomDiscardOpponent(),
  },
  nagekiNoKageDarkRaven: {
    id: 'nagekiNoKageDarkRaven', name: '嘆きの影ダーク・レイブン', civ: 'dark', type: 'creature', rarity: 'UC',
    cost: 4, power: 1000, race: 'ゴースト',
    text: 'ブロッカー。',
    keywords: { blocker: true },
  },
  toraeruMonoBoneSpider: {
    id: 'toraeruMonoBoneSpider', name: '捕らえる者ボーン・スパイダー', civ: 'dark', type: 'creature', rarity: 'UC',
    cost: 3, power: 5000, race: 'リビング・デッド',
    text: 'このクリーチャーがバトルする時、バトルの後、このクリーチャーを破壊する。',
    keywords: { selfDestructAfterBattle: true },
  },
  kyoshokuchuStingerWorm: {
    id: 'kyoshokuchuStingerWorm', name: '凶食虫スティンガーワーム', civ: 'dark', type: 'creature', rarity: 'UC',
    cost: 3, power: 5000, race: 'パラサイトワーム',
    text: 'このクリーチャーをバトルゾーンに出した時、自分のクリーチャーを1体破壊する。',
    onPlay: destroyOwnOne(1, 1),
  },
  darkReverse: {
    id: 'darkReverse', name: 'ダーク・リバース', civ: 'dark', type: 'spell', rarity: 'UC',
    cost: 2,
    text: 'S・トリガー。クリーチャーを1体、自分の墓地から手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: graveyardToHand(1, 1),
  },
  yogoreTaMonoSkeletonSoldier: {
    id: 'yogoreTaMonoSkeletonSoldier', name: '汚れた者スケルトンソルジャー', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 4, power: 3000, race: 'リビング・デッド', text: '',
  },
  kirisakuMonoBoneAssassin: {
    id: 'kirisakuMonoBoneAssassin', name: '切り裂く者ボーン・アサシン', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 4, power: 2000, race: 'リビング・デッド',
    text: 'スレイヤー。',
    keywords: { slayer: true },
  },
  bloodyEarring: {
    id: 'bloodyEarring', name: 'ブラッディ・イヤリング', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 2, power: 4000, race: 'ブレインジャッカー',
    text: 'ブロッカー。このクリーチャーは攻撃できない。このクリーチャーがバトルする時、バトルの後、このクリーチャーを破壊する。',
    keywords: { blocker: true, cannotAttack: true, selfDestructAfterBattle: true },
  },
  ugomekuMonoBoneGhoul: {
    id: 'ugomekuMonoBoneGhoul', name: 'うごめく者ボーン・グール', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 2, power: 2000, race: 'リビング・デッド', text: '',
  },
  samayouMonoBrainEater: {
    id: 'samayouMonoBrainEater', name: 'さまよう者ブレイン・イーター', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 2, power: 2000, race: 'リビング・デッド',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  ikariNoKageBlackFeather: {
    id: 'ikariNoKageBlackFeather', name: '怒りの影ブラック・フェザー', civ: 'dark', type: 'creature', rarity: 'C',
    cost: 1, power: 3000, race: 'ゴースト',
    text: 'このクリーチャーが出た時、自分のクリーチャーを1体破壊する。',
    onPlay: destroyOwnOne(1, 1),
  },
  deathSmoke: {
    id: 'deathSmoke', name: 'デス・スモーク', civ: 'dark', type: 'spell', rarity: 'C',
    cost: 4,
    text: '相手のタップされていないクリーチャーを1体破壊する。',
    spell: destroyEnemyOne(1, 1, untappedOnly()),
  },
  ghostTouch: {
    id: 'ghostTouch', name: 'ゴースト・タッチ', civ: 'dark', type: 'spell', rarity: 'C',
    cost: 2,
    text: 'S・トリガー。相手の手札を1枚見ないで選び、捨てさせる。',
    keywords: { shieldTrigger: true },
    spell: randomDiscardOpponent(),
  },

  // ===================== 第2弾(DM-02) 火文明 (12) =====================
  kishinSokoValdios: {
    id: 'kishinSokoValdios', name: '機神装甲ヴァルディオス', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-02',
    cost: 4, power: 6000, race: 'ヒューマノイド',
    text: 'W・ブレイカー。バトルゾーンにある自分の他のヒューマノイドすべてのパワーは+1000される。',
    keywords: { doubleBreaker: true, auraBuffOthersOfRace: { race: 'ヒューマノイド', amount: 1000 } },
    evolution: { requirementText: '進化：自分のヒューマノイド1体の上に置く。', fromRaces: ['ヒューマノイド'] },
  },
  tosshinheiDogaan: {
    id: 'tosshinheiDogaan', name: '突神兵ドガーン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 3, power: 2000, race: 'アーマロイド',
    text: '攻撃中、このクリーチャーのパワーは、バトルゾーンにある自分の他のタップされているクリーチャー1体につき+2000される。',
    keywords: { powerAttackerPerTappedAlly: 2000 },
  },
  burstShot: {
    id: 'burstShot', name: 'バースト・ショット', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-02',
    cost: 6,
    text: 'S・トリガー。パワー2000以下のクリーチャーをすべて破壊する。',
    keywords: { shieldTrigger: true },
    spell: symmetricWipe(2000),
  },
  gishiPeepo: {
    id: 'gishiPeepo', name: '技師ピーポ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 2, power: 2000, race: 'マシン・イーター',
    text: 'このクリーチャーが破壊された時、各プレイヤーはカードを1枚、自身のマナゾーンから選び、それぞれの墓地に置く。',
    onDestroyed: eachPlayerManaToGraveyardAbility(1),
  },
  metalWingWyvern: {
    id: 'metalWingWyvern', name: 'メタルウイング・ワイバーン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 7, power: 6000, race: 'アーマード・ワイバーン',
    text: 'W・ブレイカー。このクリーチャーが攻撃する時、「ブロッカー」を持つクリーチャーを1体破壊する。',
    keywords: { doubleBreaker: true },
    onAttack: destroyEnemyOne(1, 1, isBlockerCard()),
  },
  kishinSokoValbaros: {
    id: 'kishinSokoValbaros', name: '機神装甲ヴァルバロス', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 3, power: 3000, race: 'ヒューマノイド',
    text: '攻撃中、このクリーチャーのパワーは、バトルゾーンにある他のヒューマノイド1体につき+2000される。',
    keywords: { powerAttackerPerOtherRaceCount: { race: 'ヒューマノイド', amount: 2000 } },
    evolution: { requirementText: '進化：自分のヒューマノイド1体の上に置く。', fromRaces: ['ヒューマノイド'] },
  },
  garzaurus: {
    id: 'garzaurus', name: 'ガルザウルス', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 5, power: 4000, race: 'ロック・ビースト',
    text: 'バトルゾーンに他に自分のクリーチャーがなければ、このクリーチャーは「パワーアタッカー+4000」と「W・ブレイカー」を得る。',
    keywords: { soloPowerAttacker: 4000, soloDoubleBreaker: true },
  },
  quakeGate: {
    id: 'quakeGate', name: 'クエイク・ゲート', civ: 'fire', type: 'spell', rarity: 'C', set: 'DM-02',
    cost: 4,
    text: 'このターン、バトルゾーンにある自分のクリーチャーすべてのパワーは+1000され、タップされていないクリーチャーを攻撃できる。',
    spell: teamBuffAndIgnoreTapSpell(1000),
  },
  volzardDragon: {
    id: 'volzardDragon', name: 'ボルザード・ドラゴン', civ: 'fire', type: 'creature', rarity: 'VR', set: 'DM-02',
    cost: 6, power: 5000, race: 'アーマード・ドラゴン',
    text: 'このクリーチャーが攻撃する時、相手のマナゾーンからカードを1枚選び、持ち主の墓地に置く。',
    onAttack: destroyEnemyManaOne(1, 1),
  },
  bomberSaurus: {
    id: 'bomberSaurus', name: 'ボマーザウルス', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 5, power: 5000, race: 'ロック・ビースト',
    text: 'このクリーチャーが破壊された時、各プレイヤーはカードを2枚、自身のマナゾーンから選び、それぞれの墓地に置く。',
    onDestroyed: eachPlayerManaToGraveyardAbility(2),
  },
  kiheiSochoCuratops: {
    id: 'kiheiSochoCuratops', name: '騎兵総長キュラトプス', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 3, power: 2000, race: 'ドラゴノイド',
    text: 'このクリーチャーは、タップされていないクリーチャーを攻撃できる。',
    keywords: { untapKiller: true },
  },
  chisanaYushaGet: {
    id: 'chisanaYushaGet', name: '小さな勇者ゲット', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 2, power: 2000, race: 'ヒューマノイド',
    text: 'パワーアタッカー+1000。このクリーチャーは、可能なら毎ターン攻撃する。',
    keywords: { powerAttacker: 1000, forcedAttacker: true },
  },

  // ===================== 第2弾(DM-02) 水文明 (12) =====================
  plasmaChaser: {
    id: 'plasmaChaser', name: 'プラズマ・チェイサー', civ: 'water', type: 'creature', rarity: 'VR', set: 'DM-02',
    cost: 6, power: 4000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーが攻撃する時、バトルゾーンにある相手のクリーチャーの数と同じ枚数のカードを引いてもよい。',
    onAttack: drawEqualToEnemyCount(),
  },
  worta: {
    id: 'worta', name: 'ウォルタ', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 3, power: 1000, race: 'サイバーロード',
    text: 'このクリーチャーが攻撃する時、カードを1枚引いてもよい。',
    onAttack: drawAlways(1),
  },
  deepOperation: {
    id: 'deepOperation', name: 'ディープ・オペレーション', civ: 'water', type: 'spell', rarity: 'UC', set: 'DM-02',
    cost: 4,
    text: 'S・トリガー。バトルゾーンにある相手のクリーチャーの数と同じ枚数のカードを引く。',
    keywords: { shieldTrigger: true },
    spell: drawEqualToEnemyCount(),
  },
  scissorEye: {
    id: 'scissorEye', name: 'シザー・アイ', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 4, power: 3000, race: 'ゲル・フィッシュ', text: '',
  },
  crystalPaladin: {
    id: 'crystalPaladin', name: 'クリスタル・パラディン', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-02',
    cost: 4, power: 5000, race: 'リキッド・ピープル',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある「ブロッカー」を持つクリーチャーをすべて、持ち主の手札に戻す。',
    evolution: { requirementText: '進化：自分のリキッド・ピープル1体の上に置く。', fromRaces: ['リキッド・ピープル'] },
    onPlay: {
      target: null,
      resolve(engine) {
        for (const side of ['player', 'cpu']) {
          const uids = engine.players[side].battle.filter((c) => isBlocker(engine.cardOf(c))).map((c) => c.uid);
          for (const uid of uids) engine.bounceCreature(side, uid);
        }
      },
    },
  },
  kingNautilus: {
    id: 'kingNautilus', name: 'キング・ノーチラス', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 8, power: 6000, race: 'リヴァイアサン',
    text: 'W・ブレイカー。このクリーチャーがバトルゾーンにある間、すべてのリキッド・ピープルはブロックされない。',
    keywords: { doubleBreaker: true, globalUnblockableRace: 'リキッド・ピープル' },
  },
  crystalLancer: {
    id: 'crystalLancer', name: 'クリスタル・ランサー', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 6, power: 8000, race: 'リキッド・ピープル',
    text: 'W・ブレイカー。このクリーチャーはブロックされない。',
    keywords: { doubleBreaker: true, unblockable: true },
    evolution: { requirementText: '進化：自分のリキッド・ピープル1体の上に置く。', fromRaces: ['リキッド・ピープル'] },
  },
  aquaShooter: {
    id: 'aquaShooter', name: 'アクア・シューター', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 4, power: 2000, race: 'リキッド・ピープル',
    text: 'ブロッカー。',
    keywords: { blocker: true },
  },
  aquaBouncer: {
    id: 'aquaBouncer', name: 'アクア・バウンサー', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 6, power: 1000, race: 'リキッド・ピープル',
    text: 'ブロッカー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるクリーチャーを1体選び、持ち主の手札に戻してよい。',
    keywords: { blocker: true },
    onPlay: bounceAny(0, 1),
  },
  stainedGlass: {
    id: 'stainedGlass', name: 'ステンドグラス', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 3, power: 1000, race: 'サイバー・ウイルス',
    text: 'このクリーチャーが攻撃するとき、相手がブロックする前に、バトルゾーンにある火または自然のクリーチャーを1体選び、持ち主の手札に戻してよい。',
    onAttack: bounceAny(0, 1, (engine, side, c) => ['fire', 'nature'].includes(engine.cardOf(c).civ)),
  },
  coraille: {
    id: 'coraille', name: 'コーライル', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 5, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手のクリーチャーを1体選び、持ち主の山札の一番上に置く。',
    onPlay: creatureToDeckTopOne(1, 1),
  },
  mindSearch: {
    id: 'mindSearch', name: 'マインド・サーチ', civ: 'water', type: 'spell', rarity: 'C', set: 'DM-02',
    cost: 2,
    text: '相手のシールドを3枚まで見る。その後、そのシールドを元の場所に戻す。',
    spell: peekOpponentShieldsAbility(3),
  },

  // ===================== 第2弾(DM-02) 自然文明 (12) =====================
  xenoMantis: {
    id: 'xenoMantis', name: 'ゼノ・マンティス', civ: 'nature', type: 'creature', rarity: 'VR', set: 'DM-02',
    cost: 7, power: 6000, race: 'ジャイアント・インセクト',
    text: 'W・ブレイカー。このクリーチャーは、パワー5000以下のクリーチャーにブロックされない。',
    keywords: { doubleBreaker: true, unblockableByPowerAtMost: 5000 },
  },
  nenbutsuElfin: {
    id: 'nenbutsuElfin', name: '念仏エルフィン', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 4, power: 2000, race: 'ツリーフォーク',
    text: '自分のクリーチャーを召喚する時、支払うコストは1少なくなる。ただし、コストは1より少なくならない。',
    keywords: { costReduction: { type: 'creature', amount: 1, minCost: 1 } },
  },
  manaCrisis: {
    id: 'manaCrisis', name: 'マナ・クライシス', civ: 'nature', type: 'spell', rarity: 'UC', set: 'DM-02',
    cost: 4,
    text: 'S・トリガー。カードを1枚相手のマナゾーンから選び、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyManaOne(1, 1),
  },
  ginNoSenpu: {
    id: 'ginNoSenpu', name: '銀の戦斧', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 3, power: 1000, race: 'ビーストフォーク',
    text: 'このクリーチャーが攻撃する時、自分の山札の一番上のカードを自分のマナゾーンに置いてもよい。',
    onAttack: deckTopToManaSelf(1),
  },
  daiyushaFutatsuKiba: {
    id: 'daiyushaFutatsuKiba', name: '大勇者「ふたつ牙」', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-02',
    cost: 6, power: 8000, race: 'ビーストフォーク',
    text: 'W・ブレイカー。このクリーチャーをバトルゾーンに出した時、自分の山札の上から2枚を、自分のマナゾーンに置く。',
    keywords: { doubleBreaker: true },
    evolution: { requirementText: '進化：自分のビーストフォーク1体の上に置く。', fromRaces: ['ビーストフォーク'] },
    onPlay: deckTopToManaSelf(2),
  },
  shellFortress: {
    id: 'shellFortress', name: 'シェル・フォートレス', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 9, power: 5000, race: 'コロニー・ビートル',
    text: 'このクリーチャーをバトルゾーンに出した時、相手のマナゾーンからカードを2枚まで選び、持ち主の墓地に置く。',
    onPlay: destroyEnemyManaOne(0, 2),
  },
  daiyushaDaichiNoMoko: {
    id: 'daiyushaDaichiNoMoko', name: '大勇者「大地の猛攻」', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 2, power: 5000, race: 'ビーストフォーク',
    text: 'このクリーチャーがタップされている時、バトルゾーンにある自分の他のビーストフォークすべてのパワーは+2000される。',
    keywords: { auraBuffOthersOfRace: { race: 'ビーストフォーク', amount: 2000, whileSelfTapped: true } },
    evolution: { requirementText: '進化：自分のビーストフォーク1体の上に置く。', fromRaces: ['ビーストフォーク'] },
  },
  loveElfin: {
    id: 'loveElfin', name: 'ラブ・エルフィン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 2, power: 1000, race: 'ツリーフォーク',
    text: '自分の呪文を唱えるコストを1少なくする。ただし、コストは0以下にはならない。',
    keywords: { costReduction: { type: 'spell', amount: 1, minCost: 1 } },
  },
  meidoSuruGigaHorn: {
    id: 'meidoSuruGigaHorn', name: '鳴動するギガ・ホーン', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 5, power: 3000, race: 'ホーン・ビースト',
    text: 'このクリーチャーがバトルゾーンに出た時、自分の山札を見る。その中からクリーチャーを1体選んで相手に見せ、自分の手札に加えてもよい。その後、山札をシャッフルする。',
    onPlay: deckTutor(0, 1, isType('creature')),
  },
  ginNoKobushi: {
    id: 'ginNoKobushi', name: '銀の拳', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 4, power: 3000, race: 'ビーストフォーク',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  choyakuSuruTornadoHorn: {
    id: 'choyakuSuruTornadoHorn', name: '跳躍するトルネード・ホーン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 3, power: 2000, race: 'ホーン・ビースト',
    text: '攻撃中、このクリーチャーのパワーは、バトルゾーンにある自分のクリーチャー1体につき+1000される。',
    keywords: { powerAttackerPerOwnCreatureCount: 1000 },
  },
  rainbowStone: {
    id: 'rainbowStone', name: 'レインボー・ストーン', civ: 'nature', type: 'spell', rarity: 'C', set: 'DM-02',
    cost: 4,
    text: '自分の山札を見る。その中からカードを1枚選び、自分のマナゾーンに置く。その後、山札をシャッフルする。',
    spell: tutorToManaAbility(1, 1),
  },

  // ===================== 第2弾(DM-02) 光文明 (12) =====================
  shugoseitenRadiaBarre: {
    id: 'shugoseitenRadiaBarre', name: '守護聖天ラディア・バーレ', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-02',
    cost: 6, power: 9500, race: 'ガーディアン',
    text: 'ブロッカー。W・ブレイカー。',
    keywords: { blocker: true, doubleBreaker: true },
    evolution: { requirementText: '進化：自分のガーディアン1体の上に置く。', fromRaces: ['ガーディアン'] },
  },
  tatsumakiSo: {
    id: 'tatsumakiSo', name: '竜巻草', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 4, power: 2500, race: 'スターライト・ツリー',
    text: 'ブロッカー。このクリーチャーをブロックのためにタップしたときは、バトルのあとでアンタップする。',
    keywords: { blocker: true, untapAfterBlocking: true },
  },
  diamondCutter: {
    id: 'diamondCutter', name: 'ダイヤモンド・カッター', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-02',
    cost: 5,
    text: 'このターン、相手プレイヤーを攻撃することができない効果をすべて無視する。(召喚酔いや、「このクリーチャーは攻撃できない」または「このクリーチャーは相手プレイヤーを攻撃できない」などの効果を無視する)',
    spell: ignoreAttackRestrictionsSpell(),
  },
  seitenNoShugoshaRezoPacos: {
    id: 'seitenNoShugoshaRezoPacos', name: '晴天の守護者レゾ・パコス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 3, power: 3000, race: 'ガーディアン', text: '',
  },
  akatsukiNoShugoshaFalIga: {
    id: 'akatsukiNoShugoshaFalIga', name: '暁の守護者ファル・イーガ', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 5, power: 4000, race: 'ガーディアン',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分の墓地から呪文を1枚選び、自分の手札に戻してよい。',
    onPlay: graveyardCardToHand(0, 1, isType('spell')),
  },
  shugoseitenRarubaGear: {
    id: 'shugoseitenRarubaGear', name: '守護聖天ラルバ・ギア', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 3, power: 5000, race: 'ガーディアン',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手の「ブロッカー」を持つクリーチャーをすべてタップする。',
    evolution: { requirementText: '進化：自分のガーディアン1体の上に置く。', fromRaces: ['ガーディアン'] },
    onPlay: {
      target: null,
      resolve(engine, side) {
        const opp = engine.opponent(side);
        for (const c of engine.players[opp].battle) if (isBlocker(engine.cardOf(c))) c.tapped = true;
      },
    },
  },
  jiryokuNoShitoMagris: {
    id: 'jiryokuNoShitoMagris', name: '磁力の使徒マグリス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 4, power: 3000, race: 'イニシエート',
    text: 'このクリーチャーをバトルゾーンに出した時、カードを1枚引いてもよい。',
    onPlay: drawAlways(1),
  },
  logicCube: {
    id: 'logicCube', name: 'ロジック・キューブ', civ: 'light', type: 'spell', rarity: 'C', set: 'DM-02',
    cost: 3,
    text: 'S・トリガー。自分の山札を見る。その中から呪文を1枚選んで相手に見せ、自分の手札に加えてもよい。その後、山札をシャッフルする。',
    keywords: { shieldTrigger: true },
    spell: deckTutor(0, 1, isType('spell')),
  },
  seikaiNoSeireiEther: {
    id: 'seikaiNoSeireiEther', name: '星海の精霊エーテル', civ: 'light', type: 'creature', rarity: 'VR', set: 'DM-02',
    cost: 6, power: 5500, race: 'エンジェル・コマンド',
    text: 'このクリーチャーはブロックされない。',
    keywords: { unblockable: true },
  },
  senkoNoDendoshiRagna: {
    id: 'senkoNoDendoshiRagna', name: '閃光の伝道師ラグナ', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 5, power: 2500, race: 'バーサーカー',
    text: 'このクリーチャーが攻撃するとき、自分の山札から呪文を1枚さがして相手に見せ、自分の手札に加えてよい。そのあと、山札をシャッフルする。',
    onAttack: deckTutor(0, 1, isType('spell')),
  },
  yogenshaWin: {
    id: 'yogenshaWin', name: '予言者ウィン', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 2, power: 1500, race: 'ライトブリンガー',
    text: 'このクリーチャーが攻撃するとき、相手のシールドを1枚選んで見てよい。そのあとそれを元に戻す。',
    onAttack: peekOpponentShieldsAbility(1),
  },
  yogenshaFinch: {
    id: 'yogenshaFinch', name: '予言者フィンチ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 4, power: 2000, race: 'ライトブリンガー',
    text: 'このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手のクリーチャーを1体選び、タップしてもよい。',
    onPlay: tapEnemy(0, 1),
  },

  // ===================== 第2弾(DM-02) 闇文明 (12) =====================
  magyokuchuGenocideWorm: {
    id: 'magyokuchuGenocideWorm', name: '魔翼虫ジェノサイド・ワーム', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-02',
    cost: 6, power: 11000, race: 'パラサイトワーム',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
    evolution: { requirementText: '進化：自分のパラサイトワーム1体の上に置く。', fromRaces: ['パラサイトワーム'] },
  },
  amberPierce: {
    id: 'amberPierce', name: 'アンバー・ピアス', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 4, power: 2000, race: 'ブレインジャッカー',
    text: 'このクリーチャーが攻撃する時、クリーチャーを1体、自分の墓地から手札に戻してもよい。',
    onAttack: graveyardToHand(0, 1),
  },
  lostSoul: {
    id: 'lostSoul', name: 'ロスト・ソウル', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-02',
    cost: 7,
    text: '相手は自身の手札をすべて捨てる。',
    spell: discardAllHandAbility(),
  },
  gigastand: {
    id: 'gigastand', name: 'ギガスタンド', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 4, power: 3000, race: 'キマイラ',
    text: 'このクリーチャーが破壊される時、かわりに自分の手札を1枚墓地に置いてよい。そうしたら、このクリーチャーを手札に戻す。',
    keywords: { onDestroy: 'handIfPay' },
  },
  criticalBlade: {
    id: 'criticalBlade', name: 'クリティカル・ブレード', civ: 'dark', type: 'spell', rarity: 'C', set: 'DM-02',
    cost: 2,
    text: 'S・トリガー。相手の「ブロッカー」を持つクリーチャーを1体破壊する。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyOne(1, 1, isBlockerCard()),
  },
  ankokukyoheiMagin: {
    id: 'ankokukyoheiMagin', name: '暗黒巨兵マギン', civ: 'dark', type: 'creature', rarity: 'VR', set: 'DM-02',
    cost: 6, power: 4000, race: 'デーモン・コマンド',
    text: 'このクリーチャーが攻撃するとき、相手の手札からカードを1枚見ないで選び、相手はそれを持ち主の墓地に置く。',
    onAttack: randomDiscardOpponent(),
  },
  mashoDarkFreed: {
    id: 'mashoDarkFreed', name: '魔将ダーク・フリード', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 5, power: 6000, race: 'ダークロード',
    text: 'W・ブレイカー。このクリーチャーが攻撃するとき、自分のシールドを1枚選び、自分の墓地に置く。',
    keywords: { doubleBreaker: true },
    onAttack: millOwnShieldAbility(),
  },
  majuchuChaosWorm: {
    id: 'majuchuChaosWorm', name: '魔獣虫カオス・ワーム', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 5, power: 5000, race: 'パラサイトワーム',
    text: 'このクリーチャーをバトルゾーンに出した時、相手のクリーチャーを1体破壊してもよい。',
    evolution: { requirementText: '進化：自分のパラサイトワーム1体の上に置く。', fromRaces: ['パラサイトワーム'] },
    onPlay: destroyEnemyOne(0, 1),
  },
  ranhochuJellyWorm: {
    id: 'ranhochuJellyWorm', name: '卵胞虫ゼリー・ワーム', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 3, power: 2000, race: 'パラサイトワーム',
    text: 'このクリーチャーが攻撃する時、相手の手札を1枚見ないで選び、捨てさせる。',
    onAttack: randomDiscardOpponent(),
  },
  dokuenchuPoisonWorm: {
    id: 'dokuenchuPoisonWorm', name: '毒煙虫ポイズン・ワーム', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-02',
    cost: 4, power: 4000, race: 'パラサイトワーム',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるパワー3000以下の自分のクリーチャーを1体選び、自分の墓地に置く。',
    onPlay: destroyOwnOne(1, 1, powerAtMost(3000)),
  },
  donyokuNoKageGreyBalloon: {
    id: 'donyokuNoKageGreyBalloon', name: '貪欲の影グレイ・バルーン', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-02',
    cost: 3, power: 3000, race: 'ゴースト',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  nejireruMonoBoneSlime: {
    id: 'nejireruMonoBoneSlime', name: 'ねじれる者ボーン・スライム', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-02',
    cost: 1, power: 1000, race: 'リビング・デッド',
    text: 'ブロッカー。このクリーチャーが相手プレイヤーを攻撃する時、攻撃の後、破壊する。',
    keywords: { blocker: true, selfDestructAfterAttackingPlayer: true },
  },
};

export function getCard(id) {
  return CARD_DB[id];
}

export function allCards() {
  return Object.values(CARD_DB);
}

export function cardsByCivilization(civ) {
  return allCards().filter((c) => c.civ === civ);
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
