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
const isEvolved = () => (engine, side, c) => c.stack && c.stack.length > 1;
const costAtLeast = (min) => (engine, side, c) => engine.cardOf(c).cost >= min;
const and = (...fns) => (engine, side, c) => fns.every((fn) => fn(engine, side, c));

// ---- 第3弾で追加されたパターン ----
const manaCardToHandOne = (min, max, filter) => ({
  target: { kind: 'ownManaCard', min, max, filter },
  resolve(engine, side, uids) { for (const uid of uids) engine.manaCardToHand(side, uid); },
});
const manaCardToShieldOne = (min, max) => ({
  target: { kind: 'ownManaCard', min, max, intent: 'harmful' },
  resolve(engine, side, uids) { for (const uid of uids) engine.manaCardToShield(side, uid); },
});
const handCardToShieldOne = (min, max) => ({
  target: { kind: 'ownHandCard', min, max },
  resolve(engine, side, uids) { for (const uid of uids) engine.handCardToShield(side, uid); },
});
const randomShieldToHandAbility = () => ({ target: null, resolve(engine, side) { engine.randomOwnShieldToHand(side); } });
const allShieldsToHandAbility = () => ({ target: null, resolve(engine, side) { engine.allShieldsToHand(side); } });
const shieldsToManaByChoice = () => ({
  target: { kind: 'shieldQuantity', min: 1, max: 1 },
  resolve(engine, side, uids) { engine.shieldsToMana(side, uids[0] ?? 0); },
});
const destroyEnemyByPowerAll = (maxPower) => ({ target: null, resolve(engine, side) { engine.destroyByPowerOneSide(engine.opponent(side), maxPower); } });
const revealTopTakeCiv = (n, civ) => ({ target: null, resolve(engine, side) { engine.revealTopTakeCiv(side, n, civ); } });
const eachPlayerManaToHandAbility = (n) => ({ target: null, resolve(engine) { engine.eachPlayerManaToHand(n); } });
const eachPlayerManaToGraveyardExcludingAbility = (civ, n) => ({ target: null, resolve(engine) { engine.eachPlayerManaToGraveyardExcluding(civ, n); } });
const peelTopOfEvolutionOne = (min, max) => ({
  target: { kind: 'enemyCreature', min, max, filter: isEvolved() },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.peelTopOfEvolution(opp, uid);
  },
});
const peekOpponentHandAndShieldsAbility = () => ({ target: null, resolve(engine, side) { engine.peekOpponentHandAndShields(side); } });

// ---- 第4弾で追加されたパターン ----
const isRace = (race) => (engine, side, c) => engine.cardOf(c).race === race;
const isCivAnyOf = (civs) => (engine, side, c) => civs.includes(engine.cardOf(c).civ);
const isNotCiv = (civ) => (engine, side, c) => engine.cardOf(c).civ !== civ;
const excludeAttacker = () => (engine, side, c) => !engine._resolvingAttackerUid || c.uid !== engine._resolvingAttackerUid;

// 自分のマナゾーンにある、タップされていない指定文明のカードの枚数だけ、相手クリーチャーを選んでタップできる(彗星の精霊リムエル)
const tapEnemyByOwnUntappedManaCiv = (civ) => ({
  target: {
    kind: 'enemyCreature', min: 0,
    max: (engine, side) => engine.players[side].mana.filter((m) => !m.tapped && getCard(m.cardId).civ === civ).length,
  },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.tapCreature(opp, uid);
  },
});
// 自分の墓地にある、指定した複数種族すべてを手札に戻す(キング・アクアカムイ)
const graveyardRacesToHandAbility = (races) => ({
  target: null,
  resolve(engine, side) {
    const ps = engine.players[side];
    const matches = ps.graveyard.filter((c) => races.includes(getCard(c.cardId).race));
    for (const c of matches) engine.graveyardCreatureToHand(side, c.uid);
  },
});
const destroyAllExceptCivAbility = (civ) => ({ target: null, resolve(engine) { engine.destroyAllCreaturesExceptCiv(civ); } });
const destroyCivPowerBothSidesAbility = (civ, maxPower) => ({ target: null, resolve(engine) { engine.destroyByCivAndPowerBothSides(civ, maxPower); } });
const destroyExactPowerBothSidesAbility = (exactPower) => ({ target: null, resolve(engine) { engine.destroyByExactPowerBothSides(exactPower); } });
const massTapExceptCivAbility = (civ) => ({ target: null, resolve(engine) { engine.massTapExceptCiv(civ); } });
const revealTopTakeCivsAbility = (n, civs) => ({ target: null, resolve(engine, side) { engine.revealTopTakeCivs(side, n, civs); } });
const deckTopToShieldAbility = (n) => ({ target: null, resolve(engine, side) { engine.deckTopToShield(side, n); } });
const grantTeamBlockerAbility = () => ({ target: null, resolve(engine, side) { engine.grantTeamBlockerThisTurn(side); } });
const hydroHurricaneAbility = () => ({ target: null, resolve(engine, side) { engine.hydroHurricaneEffect(side); } });
const bounceEnemyManaOne = (min, max) => ({
  target: { kind: 'enemyManaCard', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.manaCardToHand(opp, uid);
  },
});
// 自分の他のダーク文明クリーチャーの数だけ、相手の手札をランダムに捨てさせる(凶骨の邪将クエイクス)
const discardOpponentPerOtherOwnCivAbility = (civ) => ({
  target: null,
  resolve(engine, side) {
    const count = engine.players[side].battle.filter((c) => c.uid !== engine._resolvingCipUid && engine.cardOf(c).civ === civ).length;
    if (count > 0) engine.discardRandomFromHand(engine.opponent(side), count);
  },
});
// 相手の光クリーチャーの数だけ、相手自身に手札を選んで捨てさせる(手札がそれ以下ならすべて捨てる)。選択は簡略化のためコスト最低のものを自動選択(ソウル・イーター)
const forceDiscardPerOpponentCivAbility = (civ) => ({
  target: null,
  resolve(engine, side) {
    const opp = engine.opponent(side);
    const count = engine.players[opp].battle.filter((c) => engine.cardOf(c).civ === civ).length;
    if (count > 0) engine.forceDiscardWorstN(opp, count);
  },
});
// このターンの攻撃中、自分のマナゾーンにある指定文明のカード1枚につき、自分のクリーチャーすべてのパワーが上がる(デーモン・ソード)
const attackBuffPerOwnManaCivAbility = (civ, amount) => ({
  target: null,
  resolve(engine, side) {
    const count = engine.players[side].mana.filter((m) => getCard(m.cardId).civ === civ).length;
    if (count > 0) engine.teamAttackBuff(side, amount * count);
  },
});
// このターン、自分のバトルゾーンにある指定文明のクリーチャー1体につき、自分のクリーチャーすべてのパワーが上がる(常時。攻撃中に限らない)(ブレス・ソード)
const staticBuffPerOwnCivAbility = (civ, amount) => ({
  target: null,
  resolve(engine, side) {
    const count = engine.players[side].battle.filter((c) => engine.cardOf(c).civ === civ).length;
    if (count > 0) engine.teamStaticBuff(side, amount * count);
  },
});
// 好きな枚数を自分のマナゾーンから墓地に置き、同じ枚数だけドローする(悪魔の契約)
const manaToGraveyardThenDraw = () => ({
  target: { kind: 'ownManaCard', min: 0, max: (engine, side) => engine.players[side].mana.length, intent: 'harmful' },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.manaCardToGraveyard(side, uid);
    if (uids.length > 0) engine.drawCardsSafe(side, uids.length);
  },
});
// 手札を好きな枚数捨て、同じ数の自分のクリーチャーに「W・ブレイカー」を与える。対象クリーチャーは簡略化のため、攻撃可能なものから優先して自動選択する(メガ・ブラスター)
const discardThenGrantDoubleBreakerToN = () => ({
  target: { kind: 'ownHandCard', min: 0, max: (engine, side) => engine.players[side].hand.length },
  resolve(engine, side, uids) {
    for (const uid of uids) {
      const ps = engine.players[side];
      const idx = ps.hand.findIndex((c) => c.uid === uid);
      if (idx !== -1) { const [c] = ps.hand.splice(idx, 1); ps.graveyard.push(c); }
    }
    const n = Math.min(uids.length, engine.players[side].battle.length);
    if (n === 0) return;
    const ranked = [...engine.players[side].battle].sort((a, b) => {
      const aReady = !a.tapped && !a.sickness ? 1 : 0;
      const bReady = !b.tapped && !b.sickness ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return engine.powerBase(side, b) - engine.powerBase(side, a);
    });
    for (let i = 0; i < n; i++) ranked[i].tempDoubleBreaker = true;
  },
});
// 攻撃時、自分の他のクリーチャーを1体生け贄に捧げてもよい。捧げたなら、このターンパワー+2000とW・ブレイカーを得る(スリーアイズ・ドラゴンフライ)
const sacrificeOnAttackForBuff = (amount) => ({
  target: { kind: 'ownCreature', min: 0, max: 1, filter: excludeAttacker(), intent: 'harmful' },
  resolve(engine, side, uids) {
    if (uids[0] == null) return;
    engine.destroyCreature(side, uids[0]);
    engine.grantAttackBuff(side, engine._resolvingAttackerUid, amount, true);
  },
});
// 相手のクリーチャーを2体まで破壊する。自分のクリーチャーがいれば、その中から最も弱いもの1体も破壊する(いけにえの鎖)
const destroyEnemyUpToTwoWithSelfSacrifice = () => ({
  target: { kind: 'enemyCreature', min: 0, max: 2 },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.destroyCreature(opp, uid);
    const weakest = engine.pickWeakestOwnCreatureUid(side);
    if (weakest != null) engine.destroyCreature(side, weakest);
  },
});

// ---- 第5弾で追加されたパターン(サバイバー/T・ブレイカー/スピードアタッカー導入) ----
const destroyByPowerBothSidesAbility = (maxPower) => ({ target: null, resolve(engine) { engine.destroyByPowerBothSides(maxPower); } });
// このクリーチャー以外の全クリーチャー(両陣営)を持ち主の手札に戻す(キング・アトランティス)
const bounceAllOtherAbility = () => ({ target: null, resolve(engine) { engine.bounceAllOtherCreatures(engine._resolvingCipUid); } });
// 自分の他のクリーチャーをすべて自分の墓地に置く(殺戮の羅刹デス・クルーザー)
const destroyAllOtherOwnAbility = () => ({ target: null, resolve(engine, side) { engine.destroyAllOtherOwnCreatures(side, engine._resolvingCipUid); } });
// 破壊された時、自分のマナゾーンから同名カードを1枚選び、バトルゾーンに置いてよい(オブシディアン・ビートル/アンブッシュ・スコーピオン)
const recursionFromManaByNameAbility = (cardId) => ({ target: null, resolve(engine, side) { engine.recurFromManaByName(side, cardId); } });
// 相手のマナゾーンが自分より多ければ、山札の上からN枚を自分のマナゾーンに置く(グローリー・スノー/光魂の伝道士クルス)
const conditionalManaRampAbility = (n) => ({
  target: null,
  resolve(engine, side) {
    if (engine.players[engine.opponent(side)].mana.length > engine.players[side].mana.length) engine.deckTopToMana(side, n);
  },
});
// 自分のバトルゾーンにある指定文明のクリーチャー1体につき、相手のマナゾーンからカードを選び墓地に置いてよい(竜脈噴火)
const destroyEnemyManaScaledByOwnCiv = (civ) => ({
  target: { kind: 'enemyManaCard', min: 0, max: (engine, side) => engine.players[side].battle.filter((c) => engine.cardOf(c).civ === civ).length },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.manaCardToGraveyard(opp, uid);
  },
});
// 自分のバトルゾーンにある指定文明のクリーチャー1体につき、相手のクリーチャーを選んでタップしてよい(サンダー・ネット)
const tapEnemyScaledByOwnCiv = (civ) => ({
  target: { kind: 'enemyCreature', min: 0, max: (engine, side) => engine.players[side].battle.filter((c) => engine.cardOf(c).civ === civ).length },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.tapCreature(opp, uid);
  },
});
// 自分のマナゾーンにあるクリーチャーを2体(1体しかいなければ1体)自分の手札に戻す(ブラッドウイング・マンティス、攻撃時に強制)
const manaCreatureBounceMandatoryUpTo2 = () => {
  const countFn = (engine, side) => Math.min(2, engine.players[side].mana.filter((m) => getCard(m.cardId).type === 'creature').length);
  return {
    target: { kind: 'ownManaCard', min: countFn, max: countFn, filter: isType('creature') },
    resolve(engine, side, uids) { for (const uid of uids) engine.manaCardToHand(side, uid); },
  };
};
// このターンの終わりに、相手シールドをブレイクした枚数だけ山札からクリーチャーを手札に加える(ビースト・チャージ)
const beastChargeSpell = () => ({
  target: null,
  resolve(engine, side) {
    engine.turnFlags[side] = engine.turnFlags[side] || {};
    engine.turnFlags[side].beastChargeActive = true;
  },
});
// 相手の手札から呪文を1枚選び、相手はそれを唱える手段を選ばず持ち主の墓地に置く、ではなく単に指定カードを捨てさせる(策略の手)
const discardChosenEnemyHandCard = (min, max) => ({
  target: { kind: 'enemyHandCard', min, max },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.handCardToGraveyard(opp, uid);
  },
});
// このターン、自分のクリーチャーがシールドをブレイクするたびに、カードをN枚引いてもよい(ミラクル・サーチャー)
const drawOnBreakSpell = (amount) => ({
  target: null,
  resolve(engine, side) {
    engine.turnFlags[side] = engine.turnFlags[side] || {};
    engine.turnFlags[side].drawOnBreak = amount;
  },
});
// 各プレイヤーが自分自身のマナゾーンのカードをすべて手札に戻す(神々の逆流)
const allManaToHandBothPlayersAbility = () => ({ target: null, resolve(engine) { engine.allManaToHandBothPlayers(); } });
// 相手の次のターン、攻撃できるクリーチャーはすべて攻撃しなければならない(ファントム・ベール)
const forceAllAttackSpell = () => ({ target: null, resolve(engine, side) { engine.forceAllAttackSide = engine.opponent(side); } });
// このターン、各プレイヤーが自分自身の手札を山札に戻してシャッフルし、同じ枚数を引き直す(サイクロン・パニック)
const cyclonePanicSpell = () => ({
  target: null,
  resolve(engine) {
    engine.shuffleHandBackAndRedraw('player');
    engine.shuffleHandBackAndRedraw('cpu');
  },
});
// バトルゾーンにあるクリーチャーを1体選んでタップする(自分・相手どちらも対象にできる)(予言者レクイル)
const tapAnyOne = (min, max, filter) => ({
  target: { kind: 'anyCreature', min, max, filter },
  resolve(engine, side, uids) {
    for (const uid of uids) {
      const owner = engine.ownerOfCreature(uid);
      if (owner) engine.tapCreature(owner, uid);
    }
  },
});
// 攻撃するとき、相手の手札が1枚でもあれば、相手はその中から1枚選んで持ち主の墓地に置く(ダーク・ティアラγ)
const forceDiscardOnAttackAbility = () => ({ target: null, resolve(engine, side) { engine.forceDiscardWorstN(engine.opponent(side), 1); } });
const peekOwnShieldsAbility = () => ({ target: null, resolve(engine, side) { engine.peekOwnShields(side); } });

// ---- 第6弾で追加されたパターン(タップ能力/マッドネス/山札破壊/シールド焼却導入) ----
const isRaceAnyOf = (races) => (engine, side, c) => races.includes(engine.cardOf(c).race);

// タップ能力(TT): 攻撃するかわりにこのクリーチャーをタップして能力を使う。tapAbilityそのものは
// 通常のonPlay/onAttackと同じ {target, resolve} 形式。tapAbilityGrantToCivを付けると、その文明の
// 自分の他のクリーチャーもこの能力を(自分自身をタップして)使えるようになる。
const tapEnemyTT = (min, max) => ({
  target: { kind: 'enemyCreature', min, max },
  resolve(engine, side, uids) { const opp = engine.opponent(side); for (const uid of uids) engine.tapCreature(opp, uid); },
});
const drawTT = (n) => ({ target: null, resolve(engine, side) { engine.drawCardsSafe(side, n); } });
const bounceAnyTT = (min, max) => ({
  target: { kind: 'anyCreature', min, max },
  resolve(engine, side, uids) { for (const uid of uids) { const owner = engine.ownerOfCreature(uid); if (owner) engine.bounceCreature(owner, uid); } },
});
const destroyEnemyBlockerTT = () => ({
  target: { kind: 'enemyCreature', min: 1, max: 1, filter: isBlockerCard() },
  resolve(engine, side, uids) { const opp = engine.opponent(side); for (const uid of uids) engine.destroyCreature(opp, uid); },
});
const opponentForcedDestroyOwnTT = () => ({
  target: null,
  resolve(engine, side) {
    const opp = engine.opponent(side);
    const uid = engine.pickWeakestOwnCreatureUid(opp);
    if (uid != null) engine.destroyCreature(opp, uid);
  },
});
const manaCardToHandTT = (min, max) => ({
  target: { kind: 'ownManaCard', min, max, filter: isType('spell') },
  resolve(engine, side, uids) { for (const uid of uids) engine.manaCardToHand(side, uid); },
});
const handDiscardOpponentRandomTT = () => ({ target: null, resolve(engine, side) { engine.discardRandomFromHand(engine.opponent(side), 1); } });
const manaAccelSelfTT = () => ({ target: null, resolve(engine, side) { engine.deckTopToMana(side, 1); } });
const deckSearchAnyCreatureTT = () => ({
  target: { kind: 'deckTutor', min: 0, max: 1, filter: isType('creature') },
  resolve(engine, side, uids) { engine.tutorFromDeck(side, uids[0] ?? null); },
});
const shieldPeekOpponentTT = () => ({ target: null, resolve(engine, side) { engine.peekOpponentShields(side, 1); } });
const grantSlayerToOneOwnTT = () => ({
  target: { kind: 'ownCreature', min: 1, max: 1 },
  resolve(engine, side, uids) {
    for (const uid of uids) {
      const c = engine.players[side].battle.find((x) => x.uid === uid);
      if (c) c.tempSlayerGrant = true;
    }
  },
});
const grantSpeedAttackerToOneOwnTT = () => ({
  target: { kind: 'ownCreature', min: 1, max: 1 },
  resolve(engine, side, uids) {
    for (const uid of uids) {
      const c = engine.players[side].battle.find((x) => x.uid === uid);
      if (c) c.sickness = false;
    }
  },
});
const grantAttackBuffOneFiltered = (amount, alsoDoubleBreaker, filter) => ({
  target: { kind: 'ownCreature', min: 1, max: 1, filter },
  resolve(engine, side, uids) { for (const uid of uids) engine.grantAttackBuff(side, uid, amount, alsoDoubleBreaker); },
});
const grantUnblockableOneOwnTT = () => ({
  target: { kind: 'ownCreature', min: 1, max: 1 },
  resolve(engine, side, uids) { for (const uid of uids) engine.grantUnblockable(side, uid); },
});
const graveyardDarkCreatureToHandTT = () => graveyardCardToHand(1, 1, and(isType('creature'), isCiv('dark')));
const manaToGraveyardUpTo3Ability = () => ({
  target: { kind: 'ownGraveyardCard', min: 0, max: 3 },
  resolve(engine, side, uids) { for (const uid of uids) engine.graveyardCreatureToMana(side, uid); },
});

// 相手クリーチャーを好きな数バウンスした後、同じ数の相手クリーチャーを自動選択でバウンスする(ショック・ハリケーン)
const pairedBounceSpell = () => ({
  target: { kind: 'ownCreature', min: 0, max: (engine, side) => engine.players[side].battle.length },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.bounceCreature(side, uid);
    for (let i = 0; i < uids.length; i++) engine.bounceStrongestEnemyCreature(side);
  },
});
// 自分のクリーチャーを好きな数生け贄にし、その数×2枚ドローする(邪魂転生)
const sacrificeOwnForDrawSpell = () => ({
  target: { kind: 'ownCreature', min: 0, max: (engine, side) => engine.players[side].battle.length, intent: 'harmful' },
  resolve(engine, side, uids) {
    for (const uid of uids) engine.destroyCreature(side, uid);
    if (uids.length > 0) engine.drawCardsSafe(side, uids.length * 2);
  },
});
// 山札から好きな枚数を選んで手札に加える(インビンシブル・テクノロジー)
const deckTutorMultiAbility = () => ({
  target: { kind: 'deckTutor', min: 0, max: (engine, side) => engine.players[side].deck.length },
  resolve(engine, side, uids) { engine.tutorMultiFromDeck(side, uids); },
});
// 相手の山札を見て、好きな枚数(最大n)を墓地に置く(ヘル・スラッシュ)
const millChosenFromDeckAbility = (n) => ({
  target: { kind: 'enemyDeckCard', min: 0, max: n },
  resolve(engine, side, uids) { engine.millChosenFromDeck(side, uids); },
});
// 相手のシールドを最大n枚、公開せずそのまま焼却する(インビンシブル・フォートレス)
const burnOpponentShieldsAbility = (n) => ({ target: null, resolve(engine, side) { engine.burnOpponentShields(side, n); } });
// 相手のクリーチャーをすべて破壊する(インビンシブル・アビス)
const wipeOpponentBoardAbility = () => ({ target: null, resolve(engine, side) { engine.destroyByPowerOneSide(engine.opponent(side), Infinity); } });
// このターン、自分のクリーチャーすべてのパワーを+amountし、T・ブレイカーを与える(インビンシブル・パワー)
const teamBuffAndTripleBreakerAbility = (amount) => ({
  target: null,
  resolve(engine, side) {
    engine.teamStaticBuff(side, amount);
    engine.teamGrantTripleBreaker(side);
  },
});
// 相手の手札を見て、条件に合うカードをすべて捨てさせる(レイン・アロー)
const discardAllMatchingHandAbility = (filterFn) => ({
  target: null,
  resolve(engine, side) { engine.discardAllMatchingFromHand(engine.opponent(side), (def) => filterFn(def)); },
});
// 相手はバトルゾーンかマナゾーンから自分自身のカードを1枚選び、持ち主の墓地に置く(クライシス・ボーラー)
const opponentForcedDestroyCreatureOrManaAbility = () => ({ target: null, resolve(engine, side) { engine.opponentForcedDestroyCreatureOrMana(side); } });
// バトルゾーンにある、ブロッカー以外のクリーチャーをすべてタップする(ジャスティス・バインド)
const tapAllNonBlockersAbility = () => ({ target: null, resolve(engine) { engine.tapAllNonBlockers(); } });
// 進化クリーチャーの一番上のカードをマナゾーンに置く(大自然の意志)
const peelTopOfEvolutionToManaOne = (min, max) => ({
  target: { kind: 'enemyCreature', min, max, filter: isEvolved() },
  resolve(engine, side, uids) {
    const opp = engine.opponent(side);
    for (const uid of uids) engine.peelTopOfEvolutionToMana(opp, uid);
  },
});
// 相手のシールドが自分より多ければ、山札の上から1枚をシールドに加える(エレメンタル・シールド)
const conditionalShieldAddAbility = () => ({
  target: null,
  resolve(engine, side) {
    if (engine.players[engine.opponent(side)].shields.length > engine.players[side].shields.length) engine.deckTopToShield(side, 1);
  },
});
// 自分の手札をすべて山札に戻してシャッフルし、同じ枚数を引き直す(ラプター・フィッシュ)
const selfHandRefreshAbility = () => ({ target: null, resolve(engine, side) { engine.shuffleHandBackAndRedraw(side); } });
// 各プレイヤーが自分自身の手札をすべて、それぞれの墓地に置く(闇侯爵ハウクス)
const symmetricDiscardAllAbility = () => ({
  target: null,
  resolve(engine) { engine.discardAllHand('player'); engine.discardAllHand('cpu'); },
});

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

  // ===================== 第3弾(DM-03) 火文明 (12) =====================
  galcargoDragon: {
    id: 'galcargoDragon', name: 'ガルカーゴ・ドラゴン', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-03',
    cost: 7, power: 6000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。このクリーチャーのパワーは、バトルゾーンにある自分の他の火のクリーチャー1体につき+1000される。このクリーチャーは、タップされていないクリーチャーを攻撃できる。',
    keywords: { doubleBreaker: true, untapKiller: true, powerPerOtherSameCivInBattle: 1000 },
  },
  choryuJabaha: {
    id: 'choryuJabaha', name: '超竜ジャバハ', civ: 'fire', type: 'creature', rarity: 'VR', set: 'DM-03',
    cost: 7, power: 11000, race: 'アーマード・ドラゴン',
    text: '進化：自分のアーマード・ドラゴン1体の上に置く。W・ブレイカー。このクリーチャーがバトルゾーンにある間、攻撃中、バトルゾーンにある自分の他の火のクリーチャーのパワーは+2000される。',
    keywords: { doubleBreaker: true, auraBuffOthersOfCivWhileAttacking: { civ: 'fire', amount: 2000 } },
    evolution: { requirementText: '進化：自分のアーマード・ドラゴン1体の上に置く。', fromRaces: ['アーマード・ドラゴン'] },
  },
  volteilDragon: {
    id: 'volteilDragon', name: 'ボルテール・ドラゴン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 7, power: 9000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  flametrops: {
    id: 'flametrops', name: 'フレムトロプス', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 4, power: 3000, race: 'ロック・ビースト',
    text: 'このクリーチャーが攻撃するとき、自分のマナゾーンからカードを1枚選び、自分の墓地に置いてよい。そうしたなら、このターン、このクリーチャーは「パワーアタッカー+3000」と「W・ブレイカー」を得る。',
    onAttack: {
      target: null,
      resolve(engine, side) {
        if (engine.players[side].mana.length > 0) {
          engine.sendOwnManaToGraveyard(side, 1);
          engine.grantAttackBuff(side, engine._resolvingAttackerUid, 3000, true);
        }
      },
    },
  },
  buraseKyanon: {
    id: 'buraseKyanon', name: 'ブレイズ・キャノン', civ: 'fire', type: 'spell', rarity: 'R', set: 'DM-03',
    cost: 7,
    text: '自分のマナゾーンのカードがすべて火のカードであれば、このターン、バトルゾーンにある自分のクリーチャーはすべて「パワーアタッカー+4000」と「W・ブレイカー」を得る。',
    spell: {
      target: null,
      resolve(engine, side) {
        if (engine.isManaMonoColor(side, 'fire')) {
          engine.teamAttackBuff(side, 4000);
          engine.teamGrantDoubleBreaker(side);
        }
      },
    },
  },
  kiridanhakuMurasama: {
    id: 'kiridanhakuMurasama', name: '切断伯爵ムラマサ', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 6, power: 3000, race: 'ヒューマノイド',
    text: 'このクリーチャーが攻撃する時、パワー2000以下の相手のクリーチャーを1体破壊してもよい。',
    onAttack: destroyEnemyOne(0, 1, powerAtMost(2000)),
  },
  koshinheiQueros: {
    id: 'koshinheiQueros', name: '甲神兵クエロス', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 5, power: 2000, race: 'アーマロイド',
    text: 'このクリーチャーが攻撃するとき、各プレイヤーは自分自身のマナゾーンから火以外のカードを1枚選び、それぞれの墓地に置く。',
    onAttack: eachPlayerManaToGraveyardExcludingAbility('fire', 1),
  },
  sessOnpaFire: {
    id: 'sessOnpaFire', name: '灼熱波', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-03',
    cost: 5,
    text: '相手は、バトルゾーンにある自分自身のパワー3000以下のクリーチャーすべてを、持ち主の墓地に置く。自分のシールドが1枚でもあれば、裏向きのまま1枚選び、自分の墓地に置く。',
    spell: {
      target: null,
      resolve(engine, side) {
        engine.destroyByPowerOneSide(engine.opponent(side), 3000);
        engine.millOwnShieldRandom(side);
      },
    },
  },
  bakuenYaroJoe: {
    id: 'bakuenYaroJoe', name: '爆炎野郎ジョー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 3, power: 3000, race: 'ヒューマノイド', text: '',
  },
  chicchiHoppy: {
    id: 'chicchiHoppy', name: 'チッチ・ホッピー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 3, power: 2000, race: 'ファイアー・バード',
    text: '自分のマナゾーンにあるカードがすべて火のカードである間、このクリーチャーのパワーは+2000される。',
    keywords: { staticPowerIfManaMonoColor: 2000 },
  },
  kishuheiBullRaiser: {
    id: 'kishuheiBullRaiser', name: '奇襲兵ブルレイザー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 2, power: 3000, race: 'ドラゴノイド',
    text: 'バトルゾーンにある相手のクリーチャーの数が自分より多いとき、このクリーチャーは攻撃することができない。',
    keywords: { cannotAttackIfOutnumbered: true },
  },
  volcanicArrow: {
    id: 'volcanicArrow', name: 'ボルカニック・アロー', civ: 'fire', type: 'spell', rarity: 'C', set: 'DM-03',
    cost: 2,
    text: 'パワー6000以下のクリーチャーを1体破壊する。自分のシールドをひとつ選び、墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: {
      target: { kind: 'enemyCreature', min: 1, max: 1, filter: powerAtMost(6000) },
      resolve(engine, side, uids) {
        const opp = engine.opponent(side);
        for (const uid of uids) engine.destroyCreature(opp, uid);
        engine.millOwnShieldRandom(side);
      },
    },
  },

  // ===================== 第3弾(DM-03) 水文明 (12) =====================
  konTonGyo: {
    id: 'konTonGyo', name: '混沌魚', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-03',
    cost: 7, power: 1000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーのパワーは、バトルゾーンにある自分の他の水のクリーチャー1体につき+1000される。このクリーチャーが攻撃するとき、自分の山札から好きな枚数のカードを引いてよい。ただし、その枚数は、バトルゾーンにある自分の他の水のクリーチャーの数までであること。',
    keywords: { powerPerOtherSameCivInBattle: 1000 },
    onAttack: {
      target: null,
      resolve(engine, side) {
        const count = engine.players[side].battle.filter((c) => c.uid !== engine._resolvingAttackerUid && engine.cardOf(c).civ === 'water').length;
        if (count > 0) engine.drawCardsSafe(side, count);
      },
    },
  },
  legendaryByron: {
    id: 'legendaryByron', name: 'レジェンダリー・バイロン', civ: 'water', type: 'creature', rarity: 'VR', set: 'DM-03',
    cost: 6, power: 8000, race: 'リヴァイアサン',
    text: '進化：自分のリヴァイアサン1体の上に置く。W・ブレイカー。このクリーチャーがバトルゾーンにある間、バトルゾーンにある自分の他の水のクリーチャーはブロックされない。',
    keywords: { doubleBreaker: true, auraGrantUnblockableToOthersOfCiv: 'water' },
    evolution: { requirementText: '進化：自分のリヴァイアサン1体の上に置く。', fromRaces: ['リヴァイアサン'] },
  },
  akuaDeformer: {
    id: 'akuaDeformer', name: 'アクア・デフォーマー', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 8, power: 3000, race: 'リキッド・ピープル',
    text: 'このクリーチャーがバトルゾーンに出たとき、各プレイヤーは自分自身のマナゾーンからカードを2枚ずつ選び、それぞれの手札に戻す。',
    onPlay: eachPlayerManaToHandAbility(2),
  },
  kingNeptas: {
    id: 'kingNeptas', name: 'キング・ネプタス', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 6, power: 5000, race: 'リヴァイアサン',
    text: 'このクリーチャーが攻撃するとき、相手がブロックする前に、バトルゾーンにあるパワー2000以下のクリーチャーを1体選び、持ち主の手札に戻してよい。',
    onAttack: bounceAny(0, 1, powerAtMost(2000)),
  },
  streamingShaper: {
    id: 'streamingShaper', name: 'ストリーミング・シェイパー', civ: 'water', type: 'spell', rarity: 'R', set: 'DM-03',
    cost: 3,
    text: '自分の山札のカードを、上から4枚をすべてのプレイヤーに見せる。その中の水のカードをすべて自分の手札に加え、それ以外のカードを自分の墓地に置く。',
    spell: revealTopTakeCiv(4, 'water'),
  },
  kingBonitas: {
    id: 'kingBonitas', name: 'キング・ボニータス', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 8, power: 4000, race: 'リヴァイアサン',
    text: 'このクリーチャーが攻撃する時、自分の山札を見る。その中から水のカードを1枚選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    onAttack: deckTutor(0, 1, isCiv('water')),
  },
  stingerBall: {
    id: 'stingerBall', name: 'スティンガー・ボール', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 3, power: 1000, race: 'サイバー・ウイルス',
    text: 'このクリーチャーが攻撃する時、相手のシールドを1枚見てもよい。その後、そのシールドを元の場所に戻す。',
    onAttack: peekOpponentShieldsAbility(1),
  },
  hyperWave: {
    id: 'hyperWave', name: 'ハイパー・ウェーブ', civ: 'water', type: 'spell', rarity: 'UC', set: 'DM-03',
    cost: 2,
    text: 'S・トリガー。自分のマナゾーンからカードを1枚選び、自分の手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: manaCardToHandOne(1, 1),
  },
  shutora: {
    id: 'shutora', name: 'シュトラ', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 4, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーが出た時、各プレイヤーはカードを1枚、自身のマナゾーンから手札に戻す。',
    onPlay: eachPlayerManaToHandAbility(1),
  },
  anglerCluster: {
    id: 'anglerCluster', name: 'アングラー・クラスター', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 3, power: 3000, race: 'サイバー・クラスター',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。自分のマナゾーンにあるカードがすべて水のカードなら、このクリーチャーのパワーは+3000される。',
    keywords: { blocker: true, cannotAttack: true, staticPowerIfManaMonoColor: 3000 },
  },
  emeral: {
    id: 'emeral', name: 'エメラル', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 2, power: 1000, race: 'サイバーロード',
    text: 'このクリーチャーがバトルゾーンに出た時、自分の手札を1枚裏向きにして、新しいシールドとしてシールドゾーンに置いてもよい。そうしたら、自分のシールドをひとつ、手札に戻す。ただし、その「S・トリガー」は使えない。',
    onPlay: {
      target: { kind: 'ownHandCard', min: 0, max: 1 },
      resolve(engine, side, uids) {
        if (uids[0] != null) {
          engine.handCardToShield(side, uids[0]);
          engine.randomOwnShieldToHand(side);
        }
      },
    },
  },
  liquidScope: {
    id: 'liquidScope', name: 'リキッド・スコープ', civ: 'water', type: 'spell', rarity: 'C', set: 'DM-03',
    cost: 4,
    text: 'S・トリガー。相手の手札とシールドを見る。',
    keywords: { shieldTrigger: true },
    spell: peekOpponentHandAndShieldsAbility(),
  },

  // ===================== 第3弾(DM-03) 自然文明 (12) =====================
  tenkuNoChojin: {
    id: 'tenkuNoChojin', name: '天空の超人', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-03',
    cost: 5, power: 8000, race: 'ジャイアント',
    text: 'W・ブレイカー。このクリーチャーが攻撃するとき、自分のマナゾーンにあるクリーチャーをすべて、自分の手札に戻す。',
    keywords: { doubleBreaker: true },
    onAttack: {
      target: null,
      resolve(engine, side) {
        const ps = engine.players[side];
        const creatureMana = ps.mana.filter((m) => getCard(m.cardId).type === 'creature');
        for (const m of creatureMana) {
          const idx = ps.mana.indexOf(m);
          if (idx !== -1) ps.mana.splice(idx, 1);
          ps.hand.push({ uid: m.uid, cardId: m.cardId });
        }
        if (creatureMana.length > 0) engine.logMsg(`${side === 'player' ? 'あなた' : 'CPU'}はマナゾーンのクリーチャーを${creatureMana.length}枚手札に戻した。`);
      },
    },
  },
  daikonchuGigamantis: {
    id: 'daikonchuGigamantis', name: '大昆虫ギガマンティス', civ: 'nature', type: 'creature', rarity: 'VR', set: 'DM-03',
    cost: 4, power: 5000, race: 'ジャイアント・インセクト',
    text: '進化：自分のジャイアント・インセクト1体の上に置く。このクリーチャーがバトルゾーンにある間に、自分の他の自然のクリーチャーがバトルゾーンから墓地に置かれるとき、その自然のクリーチャーを自分のマナゾーンに置く。',
    keywords: { redirectAllyDeathTo: 'mana' },
    evolution: { requirementText: '進化：自分のジャイアント・インセクト1体の上に置く。', fromRaces: ['ジャイアント・インセクト'] },
  },
  yoakeNoChojin: {
    id: 'yoakeNoChojin', name: '夜明けの超人', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 7, power: 11000, race: 'ジャイアント',
    text: 'W・ブレイカー。このクリーチャーは、クリーチャーを攻撃できない。',
    keywords: { doubleBreaker: true, cannotAttackCreatures: true },
  },
  maboroshikiridake: {
    id: 'maboroshikiridake', name: 'マボロシキリダケ', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 4, power: 2000, race: 'バルーン・マッシュルーム',
    text: 'このクリーチャーが攻撃するとき、自分の墓地から自然のカードを1枚選び、自分のマナゾーンに置いてよい。',
    onAttack: {
      target: { kind: 'ownGraveyardCard', min: 0, max: 1, filter: isCiv('nature') },
      resolve(engine, side, uids) { for (const uid of uids) engine.graveyardCreatureToMana(side, uid); },
    },
  },
  gyakutenNoAurora: {
    id: 'gyakutenNoAurora', name: '逆転のオーロラ', civ: 'nature', type: 'spell', rarity: 'R', set: 'DM-03',
    cost: 5,
    text: '自分のシールドを好きな数、自分のマナゾーンに置く。',
    spell: shieldsToManaByChoice(),
  },
  kimenZakuro: {
    id: 'kimenZakuro', name: '奇面ざくろ', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 5, power: 1000, race: 'ツリーフォーク',
    text: 'このクリーチャーのパワーは、バトルゾーンにある自分の他の自然のクリーチャー1体につき+1000される。このクリーチャーは、パワー4000以下のクリーチャーにブロックされない。',
    keywords: { powerPerOtherSameCivInBattle: 1000, unblockableByPowerAtMost: 4000 },
  },
  shellPouch: {
    id: 'shellPouch', name: 'シェル・ポーチ', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 4, power: 1000, race: 'コロニー・ビートル',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある相手の進化クリーチャーを1体選び、そのクリーチャーの一番上のカードを持ち主の墓地に置いてよい。',
    onPlay: peelTopOfEvolutionOne(0, 1),
  },
  shinryokuNoMahojin: {
    id: 'shinryokuNoMahojin', name: '深緑の魔方陣', civ: 'nature', type: 'spell', rarity: 'UC', set: 'DM-03',
    cost: 4,
    text: 'S・トリガー。自分のマナゾーンのカードを1枚、シールド化する。',
    keywords: { shieldTrigger: true },
    spell: manaCardToShieldOne(1, 1),
  },
  gekikoSuruDashHorn: {
    id: 'gekikoSuruDashHorn', name: '激昂するダッシュ・ホーン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 5, power: 4000, race: 'ホーン・ビースト',
    text: '自分のマナゾーンにあるカードがすべて自然のカードである間、このクリーチャーのパワーは+3000され、「W・ブレイカー」を得る。',
    keywords: { staticPowerIfManaMonoColor: 3000, doubleBreakerIfManaMonoColor: true },
  },
  swordButterfly: {
    id: 'swordButterfly', name: 'ソード・バタフライ', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 3, power: 2000, race: 'ジャイアント・インセクト',
    text: 'パワーアタッカー+3000。',
    keywords: { powerAttacker: 3000 },
  },
  snipeMosquito: {
    id: 'snipeMosquito', name: 'スナイプ・モスキート', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 1, power: 2000, race: 'ジャイアント・インセクト',
    text: 'このクリーチャーが攻撃する時、カードを1枚、自分のマナゾーンから手札に戻す。',
    onAttack: manaCardToHandOne(1, 1),
  },
  daichiNoHoko: {
    id: 'daichiNoHoko', name: '大地の咆哮', civ: 'nature', type: 'spell', rarity: 'C', set: 'DM-03',
    cost: 2,
    text: 'S・トリガー。コスト6以上のクリーチャーを1体、自分のマナゾーンから自分の手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: manaCardToHandOne(1, 1, costAtLeast(6)),
  },

  // ===================== 第3弾(DM-03) 光文明 (12) =====================
  ryuseiNoSeireiMeer: {
    id: 'ryuseiNoSeireiMeer', name: '流星の精霊ミーア', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-03',
    cost: 8, power: 11500, race: 'エンジェル・コマンド',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  seitenshiJiekuBarikyura: {
    id: 'seitenshiJiekuBarikyura', name: '聖天使ジーク・バリキューラ', civ: 'light', type: 'creature', rarity: 'VR', set: 'DM-03',
    cost: 3, power: 5000, race: 'イニシエート',
    text: '進化：自分のイニシエート1体の上に置く。このクリーチャーがバトルゾーンにある間、バトルゾーンにある自分の他の光のクリーチャーは「ブロッカー」を得る。',
    keywords: { auraGrantBlockerToOthersOfCiv: 'light' },
    evolution: { requirementText: '進化：自分のイニシエート1体の上に置く。', fromRaces: ['イニシエート'] },
  },
  raiunNoShugoshaRazaVega: {
    id: 'raiunNoShugoshaRazaVega', name: '雷雲の守護者ラーザ・ベガ', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 10, power: 3000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーが破壊された時、裏向きにして、新しいシールドとして自分のシールドゾーンに置く。',
    keywords: { blocker: true, onDestroy: 'shield' },
  },
  kenroNoDendoshiAreku: {
    id: 'kenroNoDendoshiAreku', name: '堅牢の伝道師アレーク', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 7, power: 4000, race: 'バーサーカー',
    text: 'ブロッカー。このクリーチャーのパワーは、バトルゾーンにある自分の他の光のクリーチャー1体につき+1000される。',
    keywords: { blocker: true, powerPerOtherSameCivInBattle: 1000 },
  },
  protectCube: {
    id: 'protectCube', name: 'プロテクト・キューブ', civ: 'light', type: 'spell', rarity: 'R', set: 'DM-03',
    cost: 3,
    text: 'S・トリガー。自分のマナゾーンから呪文を1枚選び、自分の手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: manaCardToHandOne(1, 1, isType('spell')),
  },
  raidenNoGudoshaRaByu: {
    id: 'raidenNoGudoshaRaByu', name: '雷電の求道者ラ・ビュー', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 6, power: 4000, race: 'メカサンダー',
    text: 'このクリーチャーが攻撃する時、光の呪文を1枚、自分の墓地から手札に戻してもよい。',
    onAttack: { target: { kind: 'ownGraveyardCard', min: 0, max: 1, filter: and(isCiv('light'), isType('spell')) }, resolve(engine, side, uids) { for (const uid of uids) engine.graveyardCreatureToHand(side, uid); } },
  },
  senkoBana: {
    id: 'senkoBana', name: '線光花', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 4, power: 3000, race: 'スターライト・ツリー',
    text: '自分のマナゾーンにあるカードがすべて光のカードである間、このクリーチャーは「ブロッカー」を得る。',
    keywords: { blockerIfManaMonoColor: true },
  },
  lightBoomerang: {
    id: 'lightBoomerang', name: 'ライト・ブーメラン', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-03',
    cost: 6,
    text: 'S・トリガー。この呪文を、自分の墓地ではなく自分のマナゾーンに置く。その後、自分のマナゾーンからカードを1枚選び、自分の手札に戻す。',
    keywords: { shieldTrigger: true, castGoesToMana: true },
    spell: manaCardToHandOne(1, 1),
  },
  yogenshaAres: {
    id: 'yogenshaAres', name: '予言者アレス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 6, power: 1000, race: 'ライトブリンガー',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれるとき、裏向きにして自分のシールドに加える。',
    keywords: { onDestroy: 'shield' },
  },
  yokoNoGudoshaLuPerle: {
    id: 'yokoNoGudoshaLuPerle', name: '陽光の求道者ル・パーレ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 4, power: 2500, race: 'メカサンダー',
    text: '自分のマナゾーンにあるカードがすべて光のカードである間、このクリーチャーのパワーは+2000される。',
    keywords: { staticPowerIfManaMonoColor: 2000 },
  },
  senkoNoShitoRena: {
    id: 'senkoNoShitoRena', name: '閃光の使徒レーナ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 4, power: 2000, race: 'イニシエート',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分のマナゾーンから呪文を1枚選び、自分の手札に戻してよい。',
    onPlay: manaCardToHandOne(0, 1, isType('spell')),
  },
  holyMail: {
    id: 'holyMail', name: 'ホーリー・メール', civ: 'light', type: 'spell', rarity: 'C', set: 'DM-03',
    cost: 4,
    text: '自分の手札を1枚、裏向きにして自分のシールドに加える。',
    spell: handCardToShieldOne(1, 1),
  },

  // ===================== 第3弾(DM-03) 闇文明 (12) =====================
  kyotoNoMajinGiriel: {
    id: 'kyotoNoMajinGiriel', name: '凶闘の魔人ギリエル', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-03',
    cost: 8, power: 11000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  zetsuboNoMakokuJackViper: {
    id: 'zetsuboNoMakokuJackViper', name: '絶望の魔黒ジャックバイパー', civ: 'dark', type: 'creature', rarity: 'VR', set: 'DM-03',
    cost: 3, power: 4000, race: 'ゴースト',
    text: '進化：自分のゴースト1体の上に置く。このクリーチャーがバトルゾーンにあり、自分の他の闇のクリーチャーがバトルゾーンから墓地に置かれるとき、その闇のクリーチャーを自分の手札に戻してよい。',
    keywords: { redirectAllyDeathTo: 'hand' },
    evolution: { requirementText: '進化：自分のゴースト1体の上に置く。', fromRaces: ['ゴースト'] },
  },
  zoOnoKishiGamiru: {
    id: 'zoOnoKishiGamiru', name: '憎悪の騎士ガミル', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 6, power: 4000, race: 'デーモン・コマンド',
    text: 'このクリーチャーが攻撃するとき、自分の墓地から闇のクリーチャーを1体選び、自分の手札に戻してよい。',
    onAttack: graveyardCardToHand(0, 1, and(isCiv('dark'), isType('creature'))),
  },
  kibaOtoko: {
    id: 'kibaOtoko', name: '牙男', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-03',
    cost: 4, power: 1000, race: 'ヘドリアン',
    text: 'スレイヤー。このクリーチャーのパワーは、バトルゾーンにある自分の他の闇のクリーチャー1体につき+1000される。',
    keywords: { slayer: true, powerPerOtherSameCivInBattle: 1000 },
  },
  devilDrain: {
    id: 'devilDrain', name: 'デビル・ドレーン', civ: 'dark', type: 'spell', rarity: 'R', set: 'DM-03',
    cost: 3,
    text: '自分のシールドを好きな数、自分の手札に加える。ただし、その中の「S・トリガー」は使えない。',
    spell: allShieldsToHandAbility(),
  },
  fukuranchuHangworm: {
    id: 'fukuranchuHangworm', name: '腐卵虫ハングワーム', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 5, power: 4000, race: 'パラサイトワーム', text: '',
  },
  jakenBaraga: {
    id: 'jakenBaraga', name: '邪剣バラガ', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-03',
    cost: 4, power: 4000, race: 'ダークロード',
    text: 'このクリーチャーがバトルゾーンに出た時、自分のシールドが1枚でもあれば、その中から1枚を裏向きのまま選び、自分の手札に加える。ただし、その「S・トリガー」は使えない。',
    onPlay: randomShieldToHandAbility(),
  },
  maryudoku: {
    id: 'maryudoku', name: '魔流毒', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-03',
    cost: 1,
    text: 'S・トリガー。自分の闇のクリーチャーを1体破壊しなければ、この呪文を唱えることはできない。クリーチャーを1体、自分のマナゾーンから手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: {
      target: { kind: 'ownCreature', min: 1, max: 1, filter: isCiv('dark'), intent: 'harmful' },
      resolve(engine, side, uids) {
        if (uids[0] == null) return;
        engine.destroyCreature(side, uids[0]);
        const ps = engine.players[side];
        const idx = ps.mana.findIndex((m) => getCard(m.cardId).type === 'creature');
        if (idx !== -1) {
          const [c] = ps.mana.splice(idx, 1);
          ps.hand.push({ uid: c.uid, cardId: c.cardId });
          engine.logMsg(`${side === 'player' ? 'あなた' : 'CPU'}はマナゾーンからクリーチャーを1体手札に戻した。`);
        }
      },
    },
  },
  doroOtoko: {
    id: 'doroOtoko', name: '泥男', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 4, power: 2000, race: 'ヘドリアン',
    text: '自分のマナゾーンにあるカードがすべて闇のカードである間、このクリーチャーのパワーは+2000される。',
    keywords: { staticPowerIfManaMonoColor: 2000 },
  },
  nagekiNoKageVelvetFlow: {
    id: 'nagekiNoKageVelvetFlow', name: '嘆きの影ベルベットフロー', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 3, power: 1000, race: 'ゴースト',
    text: 'スレイヤー。',
    keywords: { slayer: true },
  },
  bonePierce: {
    id: 'bonePierce', name: 'ボーン・ピアース', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-03',
    cost: 2, power: 1000, race: 'ブレインジャッカー',
    text: 'このクリーチャーが破壊された時、クリーチャーを1体、自分のマナゾーンから手札に戻してもよい。',
    onDestroyed: {
      target: null,
      resolve(engine, side) {
        const ps = engine.players[side];
        const idx = ps.mana.findIndex((m) => getCard(m.cardId).type === 'creature');
        if (idx !== -1) {
          const [c] = ps.mana.splice(idx, 1);
          ps.hand.push({ uid: c.uid, cardId: c.cardId });
          engine.logMsg(`${side === 'player' ? 'あなた' : 'CPU'}はマナゾーンからクリーチャーを1体手札に戻した。`);
        }
      },
    },
  },
  snakeAttack: {
    id: 'snakeAttack', name: 'スネークアタック', civ: 'dark', type: 'spell', rarity: 'C', set: 'DM-03',
    cost: 4,
    text: 'このターン、自分のクリーチャーすべてに「W・ブレイカー」を与える。自分のシールドを1つ墓地に置く。',
    spell: {
      target: null,
      resolve(engine, side) {
        engine.teamGrantDoubleBreaker(side);
        engine.millOwnShieldRandom(side);
      },
    },
  },

  // ===================== 第4弾(DM-04) 火文明 (10) =====================
  garukuraifuDragon: {
    id: 'garukuraifuDragon', name: 'ガルクライフ・ドラゴン', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-04',
    cost: 7, power: 6000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるパワー4000以下の光のクリーチャーすべてを、持ち主の墓地に置く。',
    keywords: { doubleBreaker: true },
    onPlay: destroyCivPowerBothSidesAbility('light', 4000),
  },
  chokyoganjuDoborugaiza: {
    id: 'chokyoganjuDoborugaiza', name: '超巨岩獣ドボルガイザー', civ: 'fire', type: 'creature', rarity: 'VR', set: 'DM-04',
    cost: 6, power: 8000, race: 'ロック・ビースト',
    text: '進化：自分のロック・ビースト1体の上に置く。W・ブレイカー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるパワー3000以下の相手のクリーチャーを1体選び、持ち主の墓地に置いてもよい。',
    keywords: { doubleBreaker: true },
    onPlay: destroyEnemyOne(0, 1, powerAtMost(3000)),
    evolution: { requirementText: '進化：自分のロック・ビースト1体の上に置く。', fromRaces: ['ロック・ビースト'] },
  },
  chaoticWyvern: {
    id: 'chaoticWyvern', name: 'カオティック・ワイバーン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 5, power: 4000, race: 'アーマード・ワイバーン',
    text: 'このクリーチャーがバトルゾーンにある間、バトルゾーンにあるすべてのデーモン・コマンドは「パワーアタッカー+4000」と「W・ブレイカー」を得る。',
    keywords: { symmetricAura: { matchRace: 'デーモン・コマンド', powerAttackerBonus: 4000, grantsDoubleBreaker: true } },
  },
  magmaTyranosu: {
    id: 'magmaTyranosu', name: 'マグマティラノス', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 5, power: 3000, race: 'ロック・ビースト',
    text: 'S・トリガー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるパワー1000のクリーチャーすべてを、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    onPlay: destroyExactPowerBothSidesAbility(1000),
  },
  megaBlaster: {
    id: 'megaBlaster', name: 'メガ・ブラスター', civ: 'fire', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 2,
    text: '自分の手札から好きな枚数を選び、自分の墓地に置く。その後、その枚数と同じ数の自分のクリーチャーをバトルゾーンから選ぶ。このターン、選ばれたクリーチャーは「W・ブレイカー」を得る。',
    spell: discardThenGrantDoubleBreakerToN(),
  },
  bakudankozoMissileBoy: {
    id: 'bakudankozoMissileBoy', name: '爆弾小僧ミサイルボーイ', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 3, power: 1000, race: 'ヒューマノイド',
    text: 'このクリーチャーがバトルゾーンにある間、光のクリーチャーを召喚するコストと光の呪文を唱えるコストは、それぞれ+1される。',
    keywords: { taxCiv: { civ: 'light', amount: 1 } },
  },
  demonSword: {
    id: 'demonSword', name: 'デーモン・ソード', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-04',
    cost: 4,
    text: 'このターンの攻撃中、バトルゾーンにある自分のクリーチャーすべてのパワーは、自分のマナゾーンにある闇のカード1枚につき+1000される。',
    spell: attackBuffPerOwnManaCivAbility('dark', 1000),
  },
  pippiKuppy: {
    id: 'pippiKuppy', name: 'ピッピ・クッピー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 2, power: 1000, race: 'ファイアー・バード',
    text: 'バトルゾーンにあるアーマード・ドラゴンすべてのパワーは+1000される。',
    keywords: { symmetricAura: { matchRace: 'アーマード・ドラゴン', powerBonus: 1000 } },
  },
  bakuretsuheiDarkBlaster: {
    id: 'bakuretsuheiDarkBlaster', name: '爆裂兵ダーク・ブラスター', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 3, power: 2000, race: 'ドラゴノイド',
    text: 'バトルゾーンに自分の闇のクリーチャーがある間、このクリーチャーのパワーは+2000される。',
    keywords: { staticPowerBonusIfOwnCivPresent: { civ: 'dark', amount: 2000 } },
  },
  sojinheiKamikaze: {
    id: 'sojinheiKamikaze', name: '双神兵カミカゼ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 2, power: 1000, race: 'アーマロイド',
    text: 'S・トリガー。',
    keywords: { shieldTrigger: true },
  },

  // ===================== 第4弾(DM-04) 水文明 (10) =====================
  kingAquakamui: {
    id: 'kingAquakamui', name: 'キング・アクアカムイ', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-04',
    cost: 7, power: 5000, race: 'リヴァイアサン',
    text: 'このクリーチャーをバトルゾーンに出した時、エンジェル・コマンドとデーモン・コマンドをすべて、自分の墓地から手札に戻してもよい。バトルゾーンにあるエンジェル・コマンドとデーモン・コマンドすべてのパワーは+2000される。',
    keywords: { symmetricAura: { matchRace: ['エンジェル・コマンド', 'デーモン・コマンド'], powerBonus: 2000 } },
    onPlay: graveyardRacesToHandAbility(['エンジェル・コマンド', 'デーモン・コマンド']),
  },
  astralLeaf: {
    id: 'astralLeaf', name: 'アストラル・リーフ', civ: 'water', type: 'creature', rarity: 'VR', set: 'DM-04',
    cost: 2, power: 4000, race: 'サイバー・ウイルス',
    text: '進化：自分のサイバー・ウイルス1体の上に置く。このクリーチャーが出た時、カードを3枚引いてもよい。',
    onPlay: drawAlways(3),
    evolution: { requirementText: '進化：自分のサイバー・ウイルス1体の上に置く。', fromRaces: ['サイバー・ウイルス'] },
  },
  smileAngler: {
    id: 'smileAngler', name: 'スマイル・アングラー', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 6, power: 3000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーが攻撃する時、相手のマナゾーンからカードを1枚選び、持ち主の手札に戻してもよい。',
    onAttack: bounceEnemyManaOne(0, 1),
  },
  aquan: {
    id: 'aquan', name: 'アクアン', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 4, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーが出た時、自分の山札の上から5枚を表向きにしてもよい。その中から光のカードと闇のカードをすべて手札に加え、残りを墓地に置く。',
    onPlay: revealTopTakeCivsAbility(5, ['light', 'dark']),
  },
  hydroHurricane: {
    id: 'hydroHurricane', name: 'ハイドロ・ハリケーン', civ: 'water', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 6,
    text: 'バトルゾーンにある自分の光のクリーチャー1体につきカードを1枚、相手のマナゾーンから選び、持ち主の手札に戻してもよい。バトルゾーンにある自分の闇のクリーチャー1体につき、バトルゾーンにある相手のクリーチャーを1体選び、持ち主の手札に戻してもよい。',
    spell: hydroHurricaneAbility(),
  },
  hunterCluster: {
    id: 'hunterCluster', name: 'ハンター・クラスター', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 1, power: 1000, race: 'サイバー・クラスター',
    text: 'S・トリガー。ブロッカー。',
    keywords: { shieldTrigger: true, blocker: true },
  },
  cheerfulAbyss: {
    id: 'cheerfulAbyss', name: 'チアフル・アビス', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 2000, race: 'サイバー・ウイルス',
    text: 'このクリーチャーがバトルゾーンにある間、バトルゾーンにある光と闇のクリーチャーすべてのパワーはそれぞれ+1000される。',
    keywords: { symmetricAura: { matchCiv: ['light', 'dark'], powerBonus: 1000 } },
  },
  aquaCharger: {
    id: 'aquaCharger', name: 'アクア・チャージャー', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 3, power: 2000, race: 'リキッド・ピープル',
    text: 'S・トリガー。',
    keywords: { shieldTrigger: true },
  },
  marineFlower: {
    id: 'marineFlower', name: 'マリン・フラワー', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 1, power: 2000, race: 'サイバー・ウイルス',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  cloneFactory: {
    id: 'cloneFactory', name: 'クローン・ファクトリー', civ: 'water', type: 'spell', rarity: 'C', set: 'DM-04',
    cost: 3,
    text: '自分のマナゾーンから2枚まで選び、手札に戻してもよい。',
    spell: manaCardToHandOne(0, 2),
  },

  // ===================== 第4弾(DM-04) 自然文明 (10) =====================
  mamoriNoTsunoFiona: {
    id: 'mamoriNoTsunoFiona', name: '護りの角フィオナ', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-04',
    cost: 6, power: 9000, race: 'ホーン・ビースト',
    text: '進化：自分のホーン・ビースト1体の上に置く。W・ブレイカー。このクリーチャーをバトルゾーンに出した時、自分の山札を見る。その中から自然のクリーチャーを1体選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    keywords: { doubleBreaker: true },
    onPlay: deckTutor(0, 1, and(isCiv('nature'), isType('creature'))),
    evolution: { requirementText: '進化：自分のホーン・ビースト1体の上に置く。', fromRaces: ['ホーン・ビースト'] },
  },
  ouenTulip: {
    id: 'ouenTulip', name: '応援チューリップ', civ: 'nature', type: 'creature', rarity: 'VR', set: 'DM-04',
    cost: 5, power: 4000, race: 'ツリーフォーク',
    text: 'このクリーチャーがバトルゾーンにある間、バトルゾーンにあるすべてのエンジェル・コマンドは「パワーアタッカー+4000」を得る。',
    keywords: { symmetricAura: { matchRace: 'エンジェル・コマンド', powerAttackerBonus: 4000 } },
  },
  inishieNoChojin: {
    id: 'inishieNoChojin', name: 'いにしえの超人', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 8, power: 9000, race: 'ジャイアント',
    text: 'W・ブレイカー。このクリーチャーは、闇のクリーチャーにブロックされない。',
    keywords: { doubleBreaker: true, cannotBeBlockedByCiv: 'dark' },
  },
  mysteryBreath: {
    id: 'mysteryBreath', name: 'ミステリー・ブレス', civ: 'nature', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 6,
    text: '自分の山札の上から1枚目を、裏向きのまま自分のシールドに加える。',
    spell: deckTopToShieldAbility(1),
  },
  breathSword: {
    id: 'breathSword', name: 'ブレス・ソード', civ: 'nature', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 2,
    text: 'このターン、バトルゾーンにある自分の光のクリーチャー1体につき、バトルゾーンにある自分のクリーチャーすべてのパワーはそれぞれ+1000される。',
    spell: staticBuffPerOwnCivAbility('light', 1000),
  },
  threeEyesDragonfly: {
    id: 'threeEyesDragonfly', name: 'スリーアイズ・ドラゴンフライ', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 5, power: 4000, race: 'ジャイアント・インセクト',
    text: 'このクリーチャーが攻撃するとき、相手がブロックする前に、バトルゾーンにある自分の他のクリーチャーを1体選び、墓地に置いてもよい。そうした場合、このターン、このクリーチャーのパワーは+2000され、「W・ブレイカー」を得る。',
    onAttack: sacrificeOnAttackForBuff(2000),
  },
  kasumidake: {
    id: 'kasumidake', name: 'カスミダケ', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 3, power: 1000, race: 'バルーン・マッシュルーム',
    text: 'このクリーチャーがバトルゾーンにある間、闇のクリーチャーを召喚するコストと闇の呪文を唱えるコストは、それぞれ+1される。',
    keywords: { taxCiv: { civ: 'dark', amount: 1 } },
  },
  shellCannon: {
    id: 'shellCannon', name: 'シェル・キャノン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 1000, race: 'コロニー・ビートル',
    text: 'S・トリガー。このクリーチャーがバトルゾーンにある間、このクリーチャーのパワーは、自分のシールドゾーンにあるカード1枚につき+1000される。',
    keywords: { shieldTrigger: true, powerPerOwnShieldCard: 1000 },
  },
  bakuhatsuSaboten: {
    id: 'bakuhatsuSaboten', name: '爆発サボテン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 3, power: 2000, race: 'ツリーフォーク',
    text: 'バトルゾーンに自分の光のクリーチャーがある間、このクリーチャーのパワーは+2000される。',
    keywords: { staticPowerBonusIfOwnCivPresent: { civ: 'light', amount: 2000 } },
  },
  kokoNoNegai: {
    id: 'kokoNoNegai', name: '孤高の願', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 2, power: 1000, race: 'ビーストフォーク',
    text: 'S・トリガー。',
    keywords: { shieldTrigger: true },
  },

  // ===================== 第4弾(DM-04) 光文明 (15) =====================
  suiseiNoSeireiRimuel: {
    id: 'suiseiNoSeireiRimuel', name: '彗星の精霊リムエル', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-04',
    cost: 8, power: 6000, race: 'エンジェル・コマンド',
    text: 'W・ブレイカー。このクリーチャーがバトルゾーンに出たとき、自分のマナゾーンにあるタップされていない光のカード1枚につき、バトルゾーンにある相手のクリーチャーを1体選んでタップしてもよい。',
    keywords: { doubleBreaker: true },
    onPlay: tapEnemyByOwnUntappedManaCiv('light'),
  },
  seireiOArcadias: {
    id: 'seireiOArcadias', name: '聖霊王アルカディアス', civ: 'light', type: 'creature', rarity: 'VR', set: 'DM-04',
    cost: 6, power: 12500, race: 'エンジェル・コマンド',
    text: '進化：自分のエンジェル・コマンド・クリーチャー1体の上に置く。W・ブレイカー。すべてのプレイヤーは、光ではない呪文を唱えられない。',
    keywords: { doubleBreaker: true, lockNonCivSpells: 'light' },
    evolution: { requirementText: '進化：自分のエンジェル・コマンド・クリーチャー1体の上に置く。', fromRaces: ['エンジェル・コマンド'] },
  },
  hishoNoSeireiAries: {
    id: 'hishoNoSeireiAries', name: '飛翔の精霊アリエス', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 5, power: 9000, race: 'エンジェル・コマンド',
    text: 'このクリーチャーは、タップされていない闇のクリーチャーを攻撃できる。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { canAttackUntappedOfCiv: 'dark', cannotAttackPlayer: true },
  },
  shufukuNoShitoOaks: {
    id: 'shufukuNoShitoOaks', name: '修復の使徒オークス', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 5, power: 1000, race: 'イニシエート',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれるとき、裏向きにして自分のシールドに加える。',
    keywords: { onDestroy: 'shield' },
  },
  fullDefenser: {
    id: 'fullDefenser', name: 'フル・ディフェンサー', civ: 'light', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 2,
    text: 'S・トリガー。自分の次のターンが始まるまで、バトルゾーンにある自分のクリーチャーはすべて「ブロッカー」を得る。',
    keywords: { shieldTrigger: true },
    spell: grantTeamBlockerAbility(),
  },
  seikyuNoGudoshaLeVeil: {
    id: 'seikyuNoGudoshaLeVeil', name: '聖弓の求道者レ・ビール', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 7, power: 6000, race: 'メカサンダー',
    text: 'W・ブレイカー。バトルゾーンにある他の光のクリーチャーすべてのパワーは+2000される。',
    keywords: { doubleBreaker: true, symmetricAura: { matchCiv: 'light', powerBonus: 2000 } },
  },
  bofuNoGudoshaFuReil: {
    id: 'bofuNoGudoshaFuReil', name: '暴風の求道者フ・レイル', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 6, power: 5000, race: 'メカサンダー',
    text: 'このクリーチャーがバトルゾーンにある間、誰も闇のカードの「S・トリガー」を使えない。',
    keywords: { lockShieldTriggerCiv: 'dark' },
  },
  rokokuNoDendoshiMillies: {
    id: 'rokokuNoDendoshiMillies', name: '牢黒の伝道師ミリエス', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 5, power: 2500, race: 'バーサーカー',
    text: 'ブロッカー。このクリーチャーがバトルゾーンにある間、闇のクリーチャーを召喚するコストと闇の呪文を唱えるコストは、それぞれ+2される。',
    keywords: { blocker: true, taxCiv: { civ: 'dark', amount: 2 } },
  },
  raimeiNoShugoshaMistLies: {
    id: 'raimeiNoShugoshaMistLies', name: '雷鳴の守護者ミスト・リエス', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 5, power: 2000, race: 'ガーディアン',
    text: '他のクリーチャーがバトルゾーンに出た時、カードを1枚引いてもよい。',
    keywords: { drawOnAnyCreatureEtb: true },
  },
  angelSong: {
    id: 'angelSong', name: 'エンジェル・ソング', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-04',
    cost: 3,
    text: 'バトルゾーンにある、光以外のクリーチャーをすべてタップする。',
    spell: massTapExceptCivAbility('light'),
  },
  kohakuSo: {
    id: 'kohakuSo', name: '琥珀草', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 3000, race: 'スターライト・ツリー',
    text: 'S・トリガー。',
    keywords: { shieldTrigger: true },
  },
  yogenshaColon: {
    id: 'yogenshaColon', name: '予言者コロン', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 1000, race: 'ライトブリンガー',
    text: 'S・トリガー。このクリーチャーをバトルゾーンに出した時、バトルゾーンにある相手のクリーチャーを1体選び、タップしてもよい。',
    keywords: { shieldTrigger: true },
    onPlay: tapEnemy(0, 1),
  },
  shinsokuNoShugoshaGranLies: {
    id: 'shinsokuNoShugoshaGranLies', name: '神速の守護者グラン・リエス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 3, power: 2000, race: 'ガーディアン',
    text: 'このクリーチャーは、闇のクリーチャーに攻撃またはブロックされない。',
    keywords: { evadeCiv: 'dark' },
  },
  chinatsuNoShitoSalies: {
    id: 'chinatsuNoShitoSalies', name: '鎮圧の使徒サリエス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 2, power: 3000, race: 'イニシエート',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  lightDefense: {
    id: 'lightDefense', name: 'ライト・ディフェンス', civ: 'light', type: 'spell', rarity: 'C', set: 'DM-04',
    cost: 1,
    text: '自分のターンの終わりに、バトルゾーンにある自分のクリーチャーをすべてアンタップする。',
    spell: {
      target: null,
      resolve(engine, side) {
        engine.turnFlags[side] = engine.turnFlags[side] || {};
        engine.turnFlags[side].untapAllAtEndOfTurn = true;
      },
    },
  },

  // ===================== 第4弾(DM-04) 闇文明 (15) =====================
  akumashinBaroms: {
    id: 'akumashinBaroms', name: '悪魔神バロム', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-04',
    cost: 8, power: 12000, race: 'デーモン・コマンド',
    text: '進化：自分のデーモン・コマンド・クリーチャー1体の上に置く。W・ブレイカー。このクリーチャーが出た時、闇ではないクリーチャーをすべて破壊する。',
    keywords: { doubleBreaker: true },
    onPlay: destroyAllExceptCivAbility('dark'),
    evolution: { requirementText: '進化：自分のデーモン・コマンド・クリーチャー1体の上に置く。', fromRaces: ['デーモン・コマンド'] },
  },
  kyokotsuNoJashoQuakes: {
    id: 'kyokotsuNoJashoQuakes', name: '凶骨の邪将クエイクス', civ: 'dark', type: 'creature', rarity: 'VR', set: 'DM-04',
    cost: 7, power: 6000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。このクリーチャーをバトルゾーンに出した時、バトルゾーンにある自分の他の闇のクリーチャー1体につき相手の手札を1枚見ないで選び、捨てさせる。',
    keywords: { doubleBreaker: true },
    onPlay: discardOpponentPerOtherOwnCivAbility('dark'),
  },
  jahiGregoria: {
    id: 'jahiGregoria', name: '邪妃グレゴリア', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 6, power: 5000, race: 'ダークロード',
    text: 'このクリーチャーがバトルゾーンにある間、バトルゾーンにあるデーモン・コマンドすべてのパワーは+2000され、「ブロッカー」を得る。',
    keywords: { symmetricAura: { matchRace: 'デーモン・コマンド', powerBonus: 2000, grantsBlocker: true } },
  },
  koharaiNoKyooGenocide: {
    id: 'koharaiNoKyooGenocide', name: '荒廃の巨王ジェノサイド', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-04',
    cost: 5, power: 9000, race: 'デーモン・コマンド',
    text: 'このクリーチャーは、タップされていない光のクリーチャーを攻撃できる。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { canAttackUntappedOfCiv: 'light', cannotAttackPlayer: true },
  },
  ikenieNoKusari: {
    id: 'ikenieNoKusari', name: 'いけにえの鎖', civ: 'dark', type: 'spell', rarity: 'R', set: 'DM-04',
    cost: 8,
    text: 'バトルゾーンにある相手のクリーチャーを2体まで選び、持ち主の墓地に置く。バトルゾーンに自分のクリーチャーが1体でもあれば、その中から1体選び、自分の墓地に置く。',
    spell: destroyEnemyUpToTwoWithSelfSacrifice(),
  },
  itsuwariNoKageHellSmoke: {
    id: 'itsuwariNoKageHellSmoke', name: '偽りの影ヘル・スモーク', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 6, power: 5000, race: 'ゴースト',
    text: 'このクリーチャーがバトルゾーンにある間、光のクリーチャーを召喚するコストと光の呪文を唱えるコストは、それぞれ+2される。',
    keywords: { taxCiv: { civ: 'light', amount: 2 } },
  },
  kuzuOtoko: {
    id: 'kuzuOtoko', name: '屑男', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 5, power: 2000, race: 'ヘドリアン',
    text: '他のクリーチャーが破壊された時、カードを1枚引いてもよい。',
    keywords: { drawOnAnyCreatureDestroyed: true },
  },
  kishaOtoko: {
    id: 'kishaOtoko', name: '汽車男', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 4, power: 1000, race: 'ヘドリアン',
    text: 'S・トリガー。このクリーチャーが出た時、相手の手札を1枚見ないで選び、捨てさせる。',
    keywords: { shieldTrigger: true },
    onPlay: randomDiscardOpponent(),
  },
  gigaVolva: {
    id: 'gigaVolva', name: 'ギガボルバ', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-04',
    cost: 4, power: 3000, race: 'キマイラ',
    text: 'このクリーチャーがバトルゾーンにある間、誰も光のカードの「S・トリガー」を使えない。',
    keywords: { lockShieldTriggerCiv: 'light' },
  },
  soulEater: {
    id: 'soulEater', name: 'ソウル・イーター', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-04',
    cost: 4,
    text: 'バトルゾーンにある相手の光のクリーチャー1体につき、相手は自分自身の手札から1枚選んで持ち主の墓地に置く。相手の手札がそれ以下の場合は、相手は自分自身の手札をすべて持ち主の墓地に置く。',
    spell: forceDiscardPerOpponentCivAbility('light'),
  },
  bosyokuchuGregoriaWorm: {
    id: 'bosyokuchuGregoriaWorm', name: '暴食虫グレゴリア・ワーム', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 3000, race: 'パラサイトワーム',
    text: 'S・トリガー。',
    keywords: { shieldTrigger: true },
  },
  noroiNoKageShadowMoon: {
    id: 'noroiNoKageShadowMoon', name: '呪いの影シャドウ・ムーン', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 3000, race: 'ゴースト',
    text: '他の闇のクリーチャーすべてのパワーを+2000する。',
    keywords: { symmetricAura: { matchCiv: 'dark', powerBonus: 2000 } },
  },
  yamiOAbakuMonoSkeletonThief: {
    id: 'yamiOAbakuMonoSkeletonThief', name: '闇をあばく者スケルトン・シーフ', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 4, power: 2000, race: 'リビング・デッド',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分の墓地からリビング・デッドを1体選び、自分の手札に戻してもよい。',
    onPlay: graveyardCardToHand(0, 1, isRace('リビング・デッド')),
  },
  purplePierce: {
    id: 'purplePierce', name: 'パープル・ピアス', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-04',
    cost: 3, power: 2000, race: 'ブレインジャッカー',
    text: 'このクリーチャーは、光のクリーチャーに攻撃またはブロックされない。',
    keywords: { evadeCiv: 'light' },
  },
  akumaNoKeiyaku: {
    id: 'akumaNoKeiyaku', name: '悪魔の契約', civ: 'dark', type: 'spell', rarity: 'C', set: 'DM-04',
    cost: 2,
    text: '好きな枚数のカードを、自分のマナゾーンから墓地に置く。その後、同じ枚数のカードを引く。',
    spell: manaToGraveyardThenDraw(),
  },

  // ===================== 第5弾(DM-05) 火文明 (12) =====================
  gradianRedDragon: {
    id: 'gradianRedDragon', name: 'グラディアン・レッド・ドラゴン', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-05',
    cost: 10, power: 15000, race: 'アーマード・ドラゴン',
    text: 'T(トリプル)・ブレイカー。',
    keywords: { tripleBreaker: true },
  },
  bladeRushWyvernDelta: {
    id: 'bladeRushWyvernDelta', name: 'ブレイドラッシュ・ワイバーンδ', civ: 'fire', type: 'creature', rarity: 'VR', set: 'DM-05',
    cost: 7, power: 5000, race: 'アーマード・ワイバーン/サバイバー',
    text: 'W・ブレイカー。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { doubleBreaker: true, survivorGrants: 'doubleBreaker' },
  },
  twinCannonWyvern: {
    id: 'twinCannonWyvern', name: 'ツインキャノン・ワイバーン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 7, power: 7000, race: 'アーマード・ワイバーン',
    text: 'スピードアタッカー。W・ブレイカー。',
    keywords: { speedAttacker: true, doubleBreaker: true },
  },
  hoshinheiBagoon: {
    id: 'hoshinheiBagoon', name: '砲神兵バゴーン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 4, power: 4000, race: 'アーマロイド',
    text: 'S・トリガー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { shieldTrigger: true, cannotAttackPlayer: true },
  },
  ryumyakuFunka: {
    id: 'ryumyakuFunka', name: '竜脈噴火', civ: 'fire', type: 'spell', rarity: 'R', set: 'DM-05',
    cost: 8,
    text: 'バトルゾーンにある自分の自然のクリーチャー1体につき、相手のマナゾーンから1枚選び、持ち主の墓地に置いてもよい。',
    spell: destroyEnemyManaScaledByOwnCiv('nature'),
  },
  volgashDragon: {
    id: 'volgashDragon', name: 'ボルガッシュ・ドラゴン', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 8, power: 4000, race: 'アーマード・ドラゴン',
    text: 'パワーアタッカー+8000。T・ブレイカー。',
    keywords: { powerAttacker: 8000, tripleBreaker: true },
  },
  mobakuGunsoBombat: {
    id: 'mobakuGunsoBombat', name: '猛爆軍曹ボンバット', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 5, power: 3000, race: 'ドラゴノイド',
    text: 'スピードアタッカー。',
    keywords: { speedAttacker: true },
  },
  cyclonePanic: {
    id: 'cyclonePanic', name: 'サイクロン・パニック', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-05',
    cost: 3,
    text: 'S・トリガー。各プレイヤーは自分自身の手札を数え、それぞれの山札に戻してシャッフルし、戻した手札と同じ枚数のカードを引く。',
    keywords: { shieldTrigger: true },
    spell: cyclonePanicSpell(),
  },
  stormJavelinWyvern: {
    id: 'stormJavelinWyvern', name: 'ストームジャベリン・ワイバーン', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 4, power: 7000, race: 'アーマード・ワイバーン',
    text: 'このクリーチャーは、相手プレイヤーを攻撃できない。このクリーチャーは、タップされていない光と水のクリーチャーを攻撃できる。',
    keywords: { cannotAttackPlayer: true, canOnlyAttackUntappedOfCivs: ['light', 'water'] },
  },
  kaitaiyaPeekap: {
    id: 'kaitaiyaPeekap', name: '解体屋ピーカプ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 1000, race: 'マシン・イーター',
    text: 'スピードアタッカー。',
    keywords: { speedAttacker: true },
  },
  poppoChappy: {
    id: 'poppoChappy', name: 'ポッポ・チャッピー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 1000, race: 'ファイアー・バード',
    text: 'セイバー：アーマード・ドラゴン(このクリーチャーがバトルゾーンにある間、自分のアーマード・ドラゴンが自分の墓地に置かれる時、かわりにこのクリーチャーを自分の墓地に置いてもよい)。',
    keywords: { saberProtectsRace: 'アーマード・ドラゴン' },
  },
  blazeSaurusAlpha: {
    id: 'blazeSaurusAlpha', name: 'ブレイズザウルスα', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 2, power: 1000, race: 'ロック・ビースト/サバイバー',
    text: 'パワーアタッカー+1000。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { powerAttacker: 1000, survivorGrants: 'powerAttacker' },
  },

  // ===================== 第5弾(DM-05) 水文明 (12) =====================
  kingAtlantis: {
    id: 'kingAtlantis', name: 'キング・アトランティス', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-05',
    cost: 12, power: 12000, race: 'リヴァイアサン',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある他のクリーチャーすべてを、持ち主の手札に戻す。T・ブレイカー。',
    keywords: { tripleBreaker: true },
    onPlay: bounceAllOtherAbility(),
  },
  kingMagellan: {
    id: 'kingMagellan', name: 'キング・マゼラン', civ: 'water', type: 'creature', rarity: 'VR', set: 'DM-05',
    cost: 8, power: 7000, race: 'リヴァイアサン',
    text: 'W・ブレイカー。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにあるクリーチャーを1体選び、持ち主の手札に戻してもよい。',
    keywords: { doubleBreaker: true },
    onPlay: bounceAny(0, 1),
  },
  seaSlug: {
    id: 'seaSlug', name: 'シー・スラッグ', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 8, power: 6000, race: 'ゲル・フィッシュ',
    text: 'ブロッカー。このクリーチャーは、ブロックされない。',
    keywords: { blocker: true, unblockable: true },
  },
  pokoruru: {
    id: 'pokoruru', name: 'ポコルル', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 4, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーがシールドをブレイクし、相手が「S・トリガー」を使った場合、このクリーチャーをアンタップしてもよい。',
    keywords: { untapOnTriggerUse: true },
  },
  kamigamiNoGyakuryu: {
    id: 'kamigamiNoGyakuryu', name: '神々の逆流', civ: 'water', type: 'spell', rarity: 'R', set: 'DM-05',
    cost: 9,
    text: '各プレイヤーは自分自身のマナゾーンにあるカードをすべて、それぞれの手札に戻す。',
    spell: allManaToHandBothPlayersAbility(),
  },
  aquaSurfer: {
    id: 'aquaSurfer', name: 'アクア・サーファー', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 6, power: 2000, race: 'リキッド・ピープル',
    text: 'S・トリガー。このクリーチャーがバトルゾーンに出た時、クリーチャーを1体選び、持ち主の手札に戻してもよい。',
    keywords: { shieldTrigger: true },
    onPlay: bounceAny(0, 1),
  },
  twinHeadTurtleBeta: {
    id: 'twinHeadTurtleBeta', name: 'ツインヘッド・タートルβ', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 5, power: 2000, race: 'ゲルフィッシュ/サバイバー',
    text: 'SV－このクリーチャーが攻撃するとき、カードを1枚引いてもよい。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { survivorGrants: 'onAttack' },
    onAttack: drawAlways(1),
  },
  miracleSearcher: {
    id: 'miracleSearcher', name: 'ミラクル・サーチャー', civ: 'water', type: 'spell', rarity: 'UC', set: 'DM-05',
    cost: 3,
    text: 'このターン、自分のクリーチャーがシールドをブレイクするたびに、カードを2枚引いてもよい。',
    spell: drawOnBreakSpell(2),
  },
  bouncerEel: {
    id: 'bouncerEel', name: 'バウンサー・イール', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 6, power: 4000, race: 'ゲル・フィッシュ',
    text: '火・自然ブロッカー(相手の火または自然のクリーチャーが攻撃する時、このクリーチャーをタップして、その攻撃を阻止してよい)。',
    keywords: { blocker: true, blockerVsCiv: ['fire', 'nature'] },
  },
  ryuseigyoAlpha: {
    id: 'ryuseigyoAlpha', name: '流星魚α', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 6, power: 3000, race: 'フィッシュ/サバイバー',
    text: 'SV－このクリーチャーはブロックされない。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { unblockable: true, survivorGrants: 'unblockable' },
  },
  steelArmCluster: {
    id: 'steelArmCluster', name: 'スチールアーム・クラスター', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 5, power: 3000, race: 'サイバー・クラスター',
    text: '火と自然のクリーチャーは、このクリーチャーを攻撃することができない。',
    keywords: { cannotBeAttackedByCiv: ['fire', 'nature'] },
  },
  iwahadagyo: {
    id: 'iwahadagyo', name: '岩肌魚', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 3000, race: 'フィッシュ',
    text: 'このクリーチャーがバトルゾーンに出た時、自分のマナゾーンから1枚選び、自分の手札に戻す。',
    onPlay: manaCardToHandOne(1, 1),
  },

  // ===================== 第5弾(DM-05) 自然文明 (12) =====================
  shinkenNoChojin: {
    id: 'shinkenNoChojin', name: '神拳の超人', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-05',
    cost: 6, power: 8000, race: 'ジャイアント',
    text: 'W・ブレイカー。このクリーチャーは、クリーチャーを攻撃できない。このクリーチャーがブロックされたとき、相手のシールドが1枚でもあれば、そのうちの1枚をブレイクする。',
    keywords: { doubleBreaker: true, cannotAttackCreatures: true, breakShieldWhenBlocked: true },
  },
  obsidianBeetle: {
    id: 'obsidianBeetle', name: 'オブシディアン・ビートル', civ: 'nature', type: 'creature', rarity: 'VR', set: 'DM-05',
    cost: 6, power: 5000, race: 'ジャイアント・インセクト',
    text: 'パワーアタッカー+3000。W・ブレイカー。このクリーチャーがバトルゾーンから自分の墓地に置かれたとき、自分のマナゾーンからオブシディアン・ビートルを1体選び、バトルゾーンに置いてもよい。',
    keywords: { powerAttacker: 3000, doubleBreaker: true },
    onDestroyed: recursionFromManaByNameAbility('obsidianBeetle'),
  },
  aikokuNoChojin: {
    id: 'aikokuNoChojin', name: '哀哭の超人', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 7, power: 7000, race: 'ジャイアント',
    text: 'T・ブレイカー。パワーアタッカー+7000。このクリーチャーは、クリーチャーを攻撃できない。',
    keywords: { tripleBreaker: true, powerAttacker: 7000, cannotAttackCreatures: true },
  },
  bloodWingMantis: {
    id: 'bloodWingMantis', name: 'ブラッドウイング・マンティス', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 5, power: 6000, race: 'ジャイアント・インセクト',
    text: 'W・ブレイカー。このクリーチャーが攻撃するとき、自分のマナゾーンからクリーチャーを2体選び、自分の手札に戻す。1体しかいない場合は、その1体を自分の手札に戻す。',
    keywords: { doubleBreaker: true },
    onAttack: manaCreatureBounceMandatoryUpTo2(),
  },
  beastCharge: {
    id: 'beastCharge', name: 'ビースト・チャージ', civ: 'nature', type: 'spell', rarity: 'R', set: 'DM-05',
    cost: 2,
    text: 'このターンの終わりに、自分の山札を見る。その中から、このターンに自分のクリーチャーがブレイクした相手のシールド1枚につきクリーチャー1体を選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    spell: beastChargeSpell(),
  },
  tsukiabiSuruMoonHorn: {
    id: 'tsukiabiSuruMoonHorn', name: '月浴するムーン・ホーン', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 6, power: 6000, race: 'ホーン・ビースト',
    text: 'W・ブレイカー。バトルゾーンにある間、このクリーチャーのパワーは、バトルゾーンにある相手の水と闇のクリーチャー1体につき+1000される。',
    keywords: { doubleBreaker: true, powerPerEnemyCivUnion: { civs: ['water', 'dark'], amount: 1000 } },
  },
  fusenAwadakeBeta: {
    id: 'fusenAwadakeBeta', name: 'フウセンアワダケβ', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 4, power: 2000, race: 'バルーン・マッシュルーム/サバイバー',
    text: 'SV－このクリーチャーが破壊された時、自分のマナゾーンに置く。サバイバー(自分の他のサバイバーすべてに、上のSV能力を与える)。',
    keywords: { onDestroy: 'mana', survivorGrants: 'onDestroy' },
  },
  saitanNoMori: {
    id: 'saitanNoMori', name: '再誕の森', civ: 'nature', type: 'spell', rarity: 'UC', set: 'DM-05',
    cost: 4,
    text: 'クリーチャーを2体まで、自分の墓地から自分のマナゾーンに置く。',
    spell: graveyardToManaOne(0, 2),
  },
  scissorsBeetle: {
    id: 'scissorsBeetle', name: 'シザーズ・ビートル', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 7, power: 5000, race: 'ジャイアント・インセクト',
    text: 'このクリーチャーがバトルゾーンに出た時、自分の山札を見る。その中からジャイアント・インセクトを1体選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    onPlay: deckTutor(0, 1, and(isType('creature'), isRace('ジャイアント・インセクト'))),
  },
  ambushScorpion: {
    id: 'ambushScorpion', name: 'アンブッシュ・スコーピオン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 5, power: 3000, race: 'ジャイアント・インセクト',
    text: 'パワーアタッカー+3000。このクリーチャーがバトルゾーンから自分の墓地に置かれた時、自分のマナゾーンからアンブッシュ・スコーピオンを1体選び、バトルゾーンに置いてもよい。',
    keywords: { powerAttacker: 3000 },
    onDestroyed: recursionFromManaByNameAbility('ambushScorpion'),
  },
  ikakuSuruSmashHornAlpha: {
    id: 'ikakuSuruSmashHornAlpha', name: '威嚇するスマッシュ・ホーンα', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 2000, race: 'ホーン・ビースト/サバイバー',
    text: 'バトルゾーンにある間、このクリーチャーのパワーは+1000される。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { staticPowerFlat: 1000, survivorGrants: 'staticPowerFlat' },
  },
  kyoyokuNoTsume: {
    id: 'kyoyokuNoTsume', name: '巨翼の爪', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 2, power: 1000, race: 'ビーストフォーク',
    text: 'バトルゾーンにある間、このクリーチャーのパワーは、バトルゾーンにある相手の水と闇のクリーチャー1体につき+1000される。',
    keywords: { powerPerEnemyCivUnion: { civs: ['water', 'dark'], amount: 1000 } },
  },

  // ===================== 第5弾(DM-05) 光文明 (12) =====================
  tenkaiNoSeireiSirius: {
    id: 'tenkaiNoSeireiSirius', name: '天海の精霊シリウス', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-05',
    cost: 11, power: 12000, race: 'エンジェル・コマンド',
    text: 'ブロッカー。T・ブレイカー。',
    keywords: { blocker: true, tripleBreaker: true },
  },
  fugekiNoGudoshaLaVeil: {
    id: 'fugekiNoGudoshaLaVeil', name: '風撃の求道者ラ・バイル', civ: 'light', type: 'creature', rarity: 'VR', set: 'DM-05',
    cost: 7, power: 5000, race: 'メカサンダー',
    text: 'ブロッカー。このクリーチャーがブロックしたとき、バトルの後でアンタップする。',
    keywords: { blocker: true, untapAfterBlocking: true },
  },
  koyokuNoSeireiSiphos: {
    id: 'koyokuNoSeireiSiphos', name: '光翼の精霊サイフォス', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 7, power: 7000, race: 'エンジェル・コマンド',
    text: 'ブロッカー。このクリーチャーがバトルゾーンに出たとき、自分のマナゾーンから呪文を1枚選び、自分の手札に戻してもよい。W・ブレイカー。',
    keywords: { blocker: true, doubleBreaker: true },
    onPlay: manaCardToHandOne(0, 1, isType('spell')),
  },
  shinkonNoShugoshaShunokRah: {
    id: 'shinkonNoShugoshaShunokRah', name: '神魂の守護者シュノーク・ラー', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 3, power: 3000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。このクリーチャーがバトルゾーンにある間、相手によって自分のマナゾーンのカードが自分の墓地に置かれるとき、そのカードを自分のマナゾーンに戻してもよい。',
    keywords: { blocker: true, cannotAttackPlayer: true, manaGraveyardProtection: true },
  },
  grorySnow: {
    id: 'grorySnow', name: 'グローリー・スノー', civ: 'light', type: 'spell', rarity: 'R', set: 'DM-05',
    cost: 4,
    text: 'S・トリガー。相手のマナゾーンにあるカードの数が自分のより多い場合、自分の山札の上から2枚を、自分のマナゾーンに置く。',
    keywords: { shieldTrigger: true },
    spell: conditionalManaRampAbility(2),
  },
  raigekiNoGudoshaLaGuile: {
    id: 'raigekiNoGudoshaLaGuile', name: '雷撃の求道者ラ・ガイル', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 6, power: 7500, race: 'メカサンダー',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  senkuNoDendoshiBalsBeta: {
    id: 'senkuNoDendoshiBalsBeta', name: '戦空の伝道士バルスβ', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 5, power: 3000, race: 'バーサーカー/サバイバー',
    text: 'SV－このクリーチャーがバトルゾーンにある間、自分のターンの終わりに、これをアンタップする。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { endOfTurnUntap: 'self', survivorGrants: 'endOfTurnUntap' },
  },
  thunderNet: {
    id: 'thunderNet', name: 'サンダー・ネット', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-05',
    cost: 2,
    text: 'バトルゾーンにある自分の水のクリーチャー1体につき、バトルゾーンにある相手のクリーチャーを1体選び、タップしてもよい。',
    spell: tapEnemyScaledByOwnCiv('water'),
  },
  teppekiNoShugoshaGaliaZolAlpha: {
    id: 'teppekiNoShugoshaGaliaZolAlpha', name: '鉄壁の守護者ガリア・ゾールα', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 5, power: 2000, race: 'ガーディアン/サバイバー',
    text: 'ブロッカー。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { blocker: true, survivorGrants: 'blocker' },
  },
  kokonNoDendoshiKurusu: {
    id: 'kokonNoDendoshiKurusu', name: '光魂の伝道士クルス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 4, power: 3500, race: 'バーサーカー',
    text: 'このクリーチャーがバトルゾーンに出た時、相手のマナゾーンにあるカードの数が自分より多い場合、自分の山札の上から1枚目を、自分のマナゾーンに置く。',
    onPlay: conditionalManaRampAbility(1),
  },
  ranunNoShitoKarugo: {
    id: 'ranunNoShitoKarugo', name: '乱雲の使徒カルゴ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 2000, race: 'イニシエート',
    text: 'このクリーチャーは、パワー4000以上のクリーチャーにブロックされない。',
    keywords: { cannotBeBlockedByPowerAtLeast: 4000 },
  },
  yogenshaRekuiru: {
    id: 'yogenshaRekuiru', name: '予言者レクイル', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 2, power: 1500, race: 'ライトブリンガー',
    text: 'このクリーチャーが攻撃する時、バトルゾーンにある闇または火のクリーチャーを1体選び、タップしてもよい。',
    onAttack: tapAnyOne(0, 1, isCivAnyOf(['dark', 'fire'])),
  },

  // ===================== 第5弾(DM-05) 闇文明 (12) =====================
  satsurikuNoRasetsuDeathCruiser: {
    id: 'satsurikuNoRasetsuDeathCruiser', name: '殺戮の羅刹デス・クルーザー', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-05',
    cost: 7, power: 13000, race: 'デーモン・コマンド',
    text: 'このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある自分の他のクリーチャーすべてを、自分の墓地に置く。T・ブレイカー。',
    keywords: { tripleBreaker: true },
    onPlay: destroyAllOtherOwnAbility(),
  },
  meishoDamd: {
    id: 'meishoDamd', name: '冥将ダムド', civ: 'dark', type: 'creature', rarity: 'VR', set: 'DM-05',
    cost: 6, power: 5000, race: 'ダークロード',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれたとき、バトルゾーンにあるパワー3000以下のクリーチャーすべてを、持ち主の墓地に置く。',
    onDestroyed: destroyByPowerBothSidesAbility(3000),
  },
  kenbuNoShuraVashuna: {
    id: 'kenbuNoShuraVashuna', name: '剣舞の修羅ヴァシュナ', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 5, power: 7000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。相手にシールドが1枚もなければ、このクリーチャーは攻撃することができない。',
    keywords: { doubleBreaker: true, cannotAttackIfEnemyShieldless: true },
  },
  darkTiaraGamma: {
    id: 'darkTiaraGamma', name: 'ダーク・ティアラγ', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-05',
    cost: 4, power: 1000, race: 'ブレインジャッカー/サバイバー',
    text: 'このクリーチャーが攻撃するとき、相手の手札が1枚でもあれば、相手はその中から1枚選んで持ち主の墓地に置く。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { survivorGrants: 'onAttack' },
    onAttack: forceDiscardOnAttackAbility(),
  },
  phantomVeil: {
    id: 'phantomVeil', name: 'ファントム・ベール', civ: 'dark', type: 'spell', rarity: 'R', set: 'DM-05',
    cost: 1,
    text: '相手の次のターンに、相手の攻撃できるクリーチャーはすべて、攻撃しなければならない。',
    spell: forceAllAttackSpell(),
  },
  gigaGale: {
    id: 'gigaGale', name: 'ギガゲイル', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 5, power: 4000, race: 'キマイラ',
    text: '自然・光スレイヤー(このクリーチャーとバトルした相手の自然または光のクリーチャーは、勝っても持ち主の墓地に置かれる)。',
    keywords: { slayerVsCiv: ['nature', 'light'] },
  },
  tsunoOtoko: {
    id: 'tsunoOtoko', name: '角男', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-05',
    cost: 5, power: 3000, race: 'ヘドリアン',
    text: 'このクリーチャーがバトルゾーンにある間、自然のクリーチャーを召喚するコストと自然の呪文を唱えるコストは、それぞれ+1される。',
    keywords: { taxCiv: { civ: 'nature', amount: 1 } },
  },
  sakuryakuNoTe: {
    id: 'sakuryakuNoTe', name: '策略の手', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-05',
    cost: 5,
    text: '相手の手札を見てその中から1枚選び、捨てさせる。',
    spell: discardChosenEnemyHandCard(1, 1),
  },
  gigaRingAlpha: {
    id: 'gigaRingAlpha', name: 'ギガリングα', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 5, power: 2000, race: 'キマイラ/サバイバー',
    text: 'スレイヤー。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { slayer: true, survivorGrants: 'slayer' },
  },
  gigazoul: {
    id: 'gigazoul', name: 'ギガゾウル', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 3000, race: 'キマイラ',
    text: '相手にシールドが1枚もなければ、このクリーチャーは攻撃することができない。',
    keywords: { cannotAttackIfEnemyShieldless: true },
  },
  magenNoKageEternalCry: {
    id: 'magenNoKageEternalCry', name: '魔幻の影エターナル・クライ', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 3, power: 2000, race: 'ゴースト',
    text: '自然・光スレイヤー(このクリーチャーとバトルした相手の自然または光のクリーチャーは、勝っても持ち主の墓地に置かれる)。',
    keywords: { slayerVsCiv: ['nature', 'light'] },
  },
  spiderJewel: {
    id: 'spiderJewel', name: 'スパイダー・ジュエル', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-05',
    cost: 2, power: 1000, race: 'ブレインジャッカー',
    text: 'このクリーチャーがバトルゾーンから自分の墓地に置かれた時、自分のシールドを1枚裏向きのまま選び、自分の手札に加えてもよい。ただし、その「S・トリガー」は使えない。',
    onDestroyed: randomShieldToHandAbility(),
  },

  // ===================== 第6弾(DM-06) 火文明 (24) =====================
  kachuShinryuExecutor: {
    id: 'kachuShinryuExecutor', name: '甲冑神龍エグゼキューター', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 4, power: 5000, race: 'ドラゴノイド',
    text: '進化－自分のドラゴノイド1体の上に置く。このクリーチャーがバトルゾーンにある間、自分の火のクリーチャーをタップし、攻撃するかわりに次の能力を使ってもよい。自分の火のクリーチャーを1体選ぶ。そのクリーチャーはターンの終わりまでパワー+3000される。',
    keywords: { tapAbilityGrantToCiv: 'fire' },
    tapAbility: grantAttackBuffOneFiltered(3000, false, isCiv('fire')),
    evolution: { requirementText: '自分のドラゴノイド1体の上に置く', fromRaces: ['ドラゴノイド'] },
  },
  volmeteusWhiteDragon: {
    id: 'volmeteusWhiteDragon', name: 'ボルメテウス・ホワイト・ドラゴン', civ: 'fire', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 7, power: 7000, race: 'アーマード・ドラゴン',
    text: 'W・ブレイカー。このクリーチャーがシールドをブレイクした時、相手はそのシールドを持ち主の墓地に置く。(その「S・トリガー」は使えない)',
    keywords: { doubleBreaker: true, shieldBurnOnBreak: true },
  },
  yushinheiExorius: {
    id: 'yushinheiExorius', name: '勇神兵エグゾリウス', civ: 'fire', type: 'creature', rarity: 'VR', set: 'DM-06',
    cost: 6, power: 4000, race: 'アーマロイド',
    text: 'このクリーチャーは、タップされていないクリーチャーを攻撃できる。パワーアタッカー+3000。',
    keywords: { untapKiller: true, powerAttacker: 3000 },
  },
  invincibleFortress: {
    id: 'invincibleFortress', name: 'インビンシブル・フォートレス', civ: 'fire', type: 'spell', rarity: 'VR', set: 'DM-06',
    cost: 13,
    text: '相手のシールドを裏向きのまま3枚まで選び、表にして持ち主の墓地に置く。(その「S・トリガー」は使えない)',
    spell: burnOpponentShieldsAbility(3),
  },
  sigmaTrait: {
    id: 'sigmaTrait', name: 'シグマ・トゥレイト', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 9000, race: 'サバイバー',
    text: '進化－自分のサバイバー1体の上に置く。クルー・ブレイカー：サバイバー(シールドを攻撃したとき、バトルゾーンにある自分の他のサバイバー1体につき、シールドをさらにもう1枚ブレイクする)',
    keywords: { breakerBonusPerOtherSurvivor: true },
    evolution: { requirementText: '進化－自分のサバイバー1体の上に置く', fromRaces: ['サバイバー'] },
  },
  kishinSokoValkaiser: {
    id: 'kishinSokoValkaiser', name: '機神装甲ヴァルカイザー', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 5000, race: 'ヒューマノイド',
    text: '進化－自分のヒューマノイド1体の上に置く。このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある、パワー4000以下の相手のクリーチャーを1体選び、持ち主の墓地に置いてもよい。',
    onPlay: destroyEnemyOne(0, 1, powerAtMost(4000)),
    evolution: { requirementText: '進化－自分のヒューマノイド1体の上に置く', fromRaces: ['ヒューマノイド'] },
  },
  bazagajiruDragon: {
    id: 'bazagajiruDragon', name: 'バザガジール・ドラゴン', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 8, power: 8000, race: 'アーマード・ドラゴン',
    text: 'スピードアタッカー。W・ブレイカー。このクリーチャーは、アンタップしているクリーチャーを攻撃できる。自分のターンの終わりに、このクリーチャーを自分の手札に戻す。',
    keywords: { speedAttacker: true, doubleBreaker: true, untapKiller: true, returnToHandEndOfTurn: true },
  },
  peekapuLizard: {
    id: 'peekapuLizard', name: 'ピーカプ・リザード', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 3, power: 3000, race: 'デューンゲッコー',
    text: 'パワーアタッカー+3000。このクリーチャーの攻撃がブロックされた場合、バトルは行われない。ただし、両方のクリーチャーはタップしたままである。',
    keywords: { powerAttacker: 3000, noBattleWhenBlocked: true },
  },
  peekapuNoDriver: {
    id: 'peekapuNoDriver', name: 'ピーカプのドライバー', civ: 'fire', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 2, power: 1000, race: 'ゼノパーツ',
    text: 'このクリーチャーで攻撃するかわりに、タップして次のTT能力を使ってもよい。TT：相手の「ブロッカー」を持つクリーチャーを1体破壊する。',
    tapAbility: destroyEnemyBlockerTT(),
  },
  crisisBowler: {
    id: 'crisisBowler', name: 'クライシス・ボーラー', civ: 'fire', type: 'spell', rarity: 'R', set: 'DM-06',
    cost: 4,
    text: 'S・トリガー。相手は、バトルゾーンかマナゾーンから自分自身のカードを1枚選び、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: opponentForcedDestroyCreatureOrManaAbility(),
  },
  sphinTyrannosBeta: {
    id: 'sphinTyrannosBeta', name: 'スフィンティラノスβ', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 6, power: 3000, race: 'ロック・ビースト/サバイバー',
    text: 'スピードアタッカー。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上の能力を得る)。',
    keywords: { speedAttacker: true, survivorGrants: 'speedAttacker' },
  },
  exesWyvern: {
    id: 'exesWyvern', name: 'エグゼズ・ワイバーン', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 3, power: 5000, race: 'アーマード・ワイバーン',
    text: 'スピードアタッカー。このクリーチャーは、相手プレイヤーを攻撃できない。自分のターンが終わるとき、このクリーチャーがバトルゾーンにあれば、自分の手札に戻す。',
    keywords: { speedAttacker: true, cannotAttackPlayer: true, returnToHandEndOfTurn: true },
  },
  arahoshiMigasa: {
    id: 'arahoshiMigasa', name: '荒法師ミガサ', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 3, power: 2000, race: 'ヒューマノイド',
    text: 'このクリーチャーで攻撃するかわりに、タップして次の能力を使ってもよい。自分の火のクリーチャーを1体選ぶ。このターンが終わるまで、そのクリーチャーは「W・ブレイカー」を得る。',
    tapAbility: grantAttackBuffOneFiltered(0, true, isCiv('fire')),
  },
  kokkoRupia: {
    id: 'kokkoRupia', name: 'コッコ・ルピア', civ: 'fire', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 3, power: 1000, race: 'ファイアー・バード',
    text: '自分のドラゴンの召喚コストを2少なくする。ただし、コストは1以下にならない。',
    keywords: { costReductionRace: { race: 'ドラゴン', amount: 2, minCost: 2 } },
  },
  picottoMissile: {
    id: 'picottoMissile', name: 'ピコット・ミサイル', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 3,
    text: 'バトルゾーンにある、パワー3000以下の相手のクリーチャーを1体選び、持ち主の墓地に置く。',
    spell: destroyEnemyOne(1, 1, powerAtMost(3000)),
  },
  kaenRyuseidan: {
    id: 'kaenRyuseidan', name: '火炎流星弾', civ: 'fire', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 1,
    text: 'S・トリガー。バトルゾーンにある、相手の「ブロッカー」を持つパワー6000以下のクリーチャーを1体選び、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyOne(1, 1, and(isBlockerCard(), powerAtMost(6000))),
  },
  muramasaLizard: {
    id: 'muramasaLizard', name: 'ムラマサ・リザード', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 6, power: 4000, race: 'デューンゲッコー',
    text: 'スピードアタッカー。このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。自分のクリーチャーを1体選ぶ。このターンが終わるまで、そのクリーチャーは「スピードアタッカー」を得る。',
    keywords: { speedAttacker: true },
    tapAbility: grantSpeedAttackerToOneOwnTT(),
  },
  sojinheiGucherarion: {
    id: 'sojinheiGucherarion', name: '捜神兵グチェラリオン', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 5, power: 4000, race: 'アーマロイド',
    text: 'バトルゾーンに自分の火のクリーチャーが他に1体もなければ、このクリーチャーは「パワーアタッカー+3000」と「W・ブレイカー」を得る。',
    keywords: {
      powerAttackerIfOwnCivCondition: { civ: 'fire', amount: 3000, requireAbsent: true },
      doubleBreakerIfOwnCivAbsent: 'fire',
    },
  },
  gekishinheiMachinegar: {
    id: 'gekishinheiMachinegar', name: '撃神兵マシンガー', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 4, power: 4000, race: 'アーマロイド',
    text: 'このクリーチャーは、攻撃可能であれば、必ず攻撃する。',
    keywords: { forcedAttacker: true },
  },
  shugekishaExeDrive: {
    id: 'shugekishaExeDrive', name: '襲撃者エグゼドライブ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 3000, race: 'ドラゴノイド',
    text: 'スピードアタッカー。自分のターンが終わるとき、このクリーチャーがバトルゾーンにあれば、自分の手札に戻す。',
    keywords: { speedAttacker: true, returnToHandEndOfTurn: true },
  },
  enjuheiMagnumBruce: {
    id: 'enjuheiMagnumBruce', name: '炎獣兵マグナム・ブルース', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 2000, race: 'ドラゴノイド',
    text: 'バトルゾーンに自分の火のクリーチャーが他に1体でもあれば、このクリーチャーは「パワーアタッカー+3000」を得る。',
    keywords: { powerAttackerIfOwnCivCondition: { civ: 'fire', amount: 3000, requireAbsent: false } },
  },
  picolaNoSpanner: {
    id: 'picolaNoSpanner', name: 'ピコラのスパナ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 2000, race: 'ゼノパーツ', text: '',
  },
  mubouTetsujinChoiya: {
    id: 'mubouTetsujinChoiya', name: '無謀鉄人チョイヤ', civ: 'fire', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 1000, race: 'ヒューマノイド',
    text: 'パワーアタッカー+1000。このクリーチャーの攻撃がブロックされた場合、バトルは行われない。ただし、両方のクリーチャーはタップされたままである。',
    keywords: { powerAttacker: 1000, noBattleWhenBlocked: true },
  },
  genryuHo: {
    id: 'genryuHo', name: '幻竜砲', civ: 'fire', type: 'spell', rarity: 'C', set: 'DM-06',
    cost: 3,
    text: 'S・トリガー。バトルゾーンにある、パワー2000以下の相手のクリーチャーを1体選び、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: destroyEnemyOne(1, 1, powerAtMost(2000)),
  },

  // ===================== 第6弾(DM-06) 水文明 (23) =====================
  zetaTrait: {
    id: 'zetaTrait', name: 'ゼータ・トゥレイト', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 8, power: 8000, race: 'サバイバー',
    text: '進化ー自分のサバイバー1体の上に置く。このクリーチャーがバトルゾーンに出た時、バトルゾーンにあるサバイバーの数と同じ枚数のカードを引いてもよい。W・ブレイカー。',
    keywords: { doubleBreaker: true },
    onPlay: {
      target: null,
      resolve(engine, side) {
        const count = ['player', 'cpu'].reduce((n, s) => n + engine.players[s].battle.filter((c) => (engine.cardOf(c).race || '').includes('サバイバー')).length, 0);
        if (count > 0) engine.drawCardsSafe(side, count);
      },
    },
    evolution: { requirementText: '自分のサバイバー1体の上に置く', fromRaces: ['サバイバー'] },
  },
  crystalJavelin: {
    id: 'crystalJavelin', name: 'クリスタル・ジャベリン', civ: 'water', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 7, power: 7000, race: 'リキッド・ピープル',
    text: '進化ー自分のリキッド・ピープル1体の上に置く。W・ブレイカー。このクリーチャーがバトルゾーンから自分の墓地に置かれた場合、このクリーチャーを自分の手札に戻す。',
    keywords: { doubleBreaker: true, onDestroy: 'hand' },
    evolution: { requirementText: '自分のリキッド・ピープル1体の上に置く', fromRaces: ['リキッド・ピープル'] },
  },
  invincibleTechnology: {
    id: 'invincibleTechnology', name: 'インビンシブル・テクノロジー', civ: 'water', type: 'spell', rarity: 'VR', set: 'DM-06',
    cost: 13,
    text: '自分の山札を見る。その中から好きな枚数のカードを選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    spell: deckTutorMultiAbility(),
  },
  europica: {
    id: 'europica', name: 'エウロピカ', civ: 'water', type: 'creature', rarity: 'VR', set: 'DM-06',
    cost: 7, power: 4000, race: 'シー・ハッカー',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。バトルゾーンにあるクリーチャーを1体選び、持ち主の手札に戻す。',
    tapAbility: bounceAnyTT(1, 1),
  },
  fortMegaCluster: {
    id: 'fortMegaCluster', name: 'フォート・メガクラスター', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 5000, race: 'サイバー・クラスター',
    text: '進化－自分のサイバー・クラスター1体の上に置く。このクリーチャーがバトルゾーンにある間、自分の水のクリーチャーをタップし、攻撃する代わりに次の能力を使ってもよい。カードを1枚引く。',
    keywords: { tapAbilityGrantToCiv: 'water' },
    tapAbility: drawTT(1),
    evolution: { requirementText: '進化－自分のサイバー・クラスター1体の上に置く', fromRaces: ['サイバー・クラスター'] },
  },
  kingTrafalgar: {
    id: 'kingTrafalgar', name: 'キング・トラファルガー', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 8, power: 7000, race: 'リヴァイアサン',
    text: 'W・ブレイカー。相手がクリーチャーを召喚するか呪文を唱えた場合、そのターンが終わるまで、このクリーチャーは「ブロッカー」を得る。',
    keywords: { doubleBreaker: true, blockerOnOpponentAction: true },
  },
  nightCrawler: {
    id: 'nightCrawler', name: 'ナイト・クロウラー', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 8, power: 6000, race: 'アースイーター',
    text: 'このクリーチャーがバトルゾーンに出たとき、相手のマナゾーンからカードを1枚選び、持ち主の手札に戻す。W・ブレイカー。',
    keywords: { doubleBreaker: true },
    onPlay: bounceEnemyManaOne(1, 1),
  },
  raptorFish: {
    id: 'raptorFish', name: 'ラプター・フィッシュ', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 3000, race: 'ゲル・フィッシュ',
    text: 'このクリーチャーがバトルゾーンに出たとき、自分の手札を山札に戻してシャッフルし、その枚数と同じ枚数のカードを引く。',
    onPlay: selfHandRefreshAbility(),
  },
  kyuroro: {
    id: 'kyuroro', name: 'キュロロ', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーがバトルゾーンにある間、自分のシールドが相手のクリーチャーにブレイクされるとき、ブレイクされるシールドを裏向きのまま自分で選ぶ。', // シールドは非公開のため実質的な効果差は無い(簡略化)
  },
  lotusMintGamma: {
    id: 'lotusMintGamma', name: 'ロータス・ミントγ', civ: 'water', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 2000, race: 'サイバー・ウイルス/サバイバー',
    text: 'SV－このクリーチャーがバトルゾーンに出たとき、バトルゾーンにある相手のクリーチャーを1体選び、タップしてもよい。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { survivorGrants: 'onPlay' },
    onPlay: tapEnemy(0, 1),
  },
  shockHurricane: {
    id: 'shockHurricane', name: 'ショック・ハリケーン', civ: 'water', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 5,
    text: 'バトルゾーンにある自分のクリーチャーを好きな数選び、自分の手札に戻す。その後、バトルゾーンにある相手のクリーチャーを同じ数選び、持ち主の手札に戻してもよい。',
    spell: pairedBounceSpell(),
  },
  mysticCreation: {
    id: 'mysticCreation', name: 'ミスティック・クリエーション', civ: 'water', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 4,
    text: 'S・トリガー。自分のマナゾーンからカードを3枚まで選び、自分の手札に戻す。',
    keywords: { shieldTrigger: true },
    spell: manaCardToHandOne(0, 3),
  },
  shineShellCluster: {
    id: 'shineShellCluster', name: 'シャインシェル・クラスター', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 7, power: 4000, race: 'サイバー・クラスター',
    text: 'このクリーチャーで攻撃する代わりに、タップして次のTT能力を使ってもよい。TT：カードを2枚引く。',
    tapAbility: drawTT(2),
  },
  hazardCrawler: {
    id: 'hazardCrawler', name: 'ハザード・クロウラー', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 5, power: 6000, race: 'アースイーター',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  decoCluster: {
    id: 'decoCluster', name: 'デコ・クラスター', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 5, power: 4000, race: 'サイバー・クラスター',
    text: '相手がクリーチャーを召喚するか呪文を唱えた場合、そのターンが終わるまで、このクリーチャーは「ブロッカー」を得る。',
    keywords: { blockerOnOpponentAction: true },
  },
  stormCrawler: {
    id: 'stormCrawler', name: 'ストーム・クロウラー', civ: 'water', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 5000, race: 'アースイーター',
    text: 'ブロッカー。このクリーチャーをバトルゾーンに出した時、カードを1枚、自分のマナゾーンから手札に戻す。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
    onPlay: manaCardToHandOne(1, 1),
  },
  sopian: {
    id: 'sopian', name: 'ソピアン', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 4, power: 2000, race: 'サイバーロード',
    text: 'このクリーチャーで攻撃するかわりに、タップして次のTT能力を使ってもよい。TT－バトルゾーンにある自分のクリーチャーを1体選ぶ。このターン、そのクリーチャーはブロックされない。',
    tapAbility: grantUnblockableOneOwnTT(),
  },
  aquaRider: {
    id: 'aquaRider', name: 'アクア・ライダー', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 4, power: 2000, race: 'リキッド・ピープル',
    text: '相手がクリーチャーを召喚するか呪文を唱えた場合、そのターンが終わるまで、このクリーチャーは「ブロッカー」を得る。',
    keywords: { blockerOnOpponentAction: true },
  },
  prometheusAlpha: {
    id: 'prometheusAlpha', name: 'プロメフィウスα', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 2000, race: 'シー・ハッカー/サバイバー', text: '',
  },
  madrionFish: {
    id: 'madrionFish', name: 'マドリオン・フィッシュ', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 3000, race: 'ゲル・フィッシュ',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  elegantLamp: {
    id: 'elegantLamp', name: 'エレガント・ランプ', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 1000, race: 'サイバー・ウイルス', text: '',
  },
  zepimetheus: {
    id: 'zepimetheus', name: 'ゼピメテウス', civ: 'water', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 1, power: 2000, race: 'シー・ハッカー',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true },
  },
  energyLight: {
    id: 'energyLight', name: 'エナジー・ライト', civ: 'water', type: 'spell', rarity: 'C', set: 'DM-06',
    cost: 3,
    text: 'カードを2枚引く。',
    spell: drawAlways(2),
  },

  // ===================== 第6弾(DM-06) 自然文明 (23) =====================
  daikonchuGaiaMantis: {
    id: 'daikonchuGaiaMantis', name: '大昆虫ガイアマンティス', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 6, power: 9000, race: 'ジャイアント・インセクト',
    text: '進化－自分のジャイアント・インセクト1体の上に置く。パワー9000以下のクリーチャーは、このクリーチャーをブロックできない。W・ブレイカー。',
    keywords: { unblockableByPowerAtMost: 9000, doubleBreaker: true },
    evolution: { requirementText: '進化－自分のジャイアント・インセクト1体の上に置く', fromRaces: ['ジャイアント・インセクト'] },
  },
  shinpiNoChojin: {
    id: 'shinpiNoChojin', name: '神秘の超人', civ: 'nature', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 5, power: 7000, race: 'ジャイアント',
    text: 'バトルゾーンにタップされていない自分のクリーチャーが他に1体でもあれば、このクリーチャーは攻撃することができない。W・ブレイカー。',
    keywords: { cannotAttackIfOtherUntapped: true, doubleBreaker: true },
  },
  gaiaClawWasp: {
    id: 'gaiaClawWasp', name: 'ガイアクロウ・ワスプ', civ: 'nature', type: 'creature', rarity: 'VR', set: 'DM-06',
    cost: 7, power: 4000, race: 'ジャイアント・インセクト',
    text: 'パワーアタッカー+3000。W・ブレイカー。このクリーチャーがブロックされる時、相手のシールドが1枚でもあれば、そのうちの1枚をブレイクする。',
    keywords: { powerAttacker: 3000, doubleBreaker: true, breakShieldWhenBlocked: true },
  },
  invinciblePower: {
    id: 'invinciblePower', name: 'インビンシブル・パワー', civ: 'nature', type: 'spell', rarity: 'VR', set: 'DM-06',
    cost: 13,
    text: 'このターンが終わるまで、バトルゾーンにある自分のクリーチャーのパワーはそれぞれ+8000され、「T・ブレイカー」を得る。',
    spell: teamBuffAndTripleBreakerAbility(8000),
  },
  chokuYosaiBabylon: {
    id: 'chokuYosaiBabylon', name: '超空要塞バビロン', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 5000, race: 'コロニー・ビートル',
    text: '進化：自分のコロニー・ビートル1体の上に置く。このクリーチャーがバトルゾーンにある間、自分の自然のクリーチャーをタップし、攻撃する代わりに次のTT能力を使ってもよい。TT：自分の山札の上から1枚目を、自分のマナゾーンに置く。',
    keywords: { tapAbilityGrantToCiv: 'nature' },
    tapAbility: manaAccelSelfTT(),
    evolution: { requirementText: '進化：自分のコロニー・ビートル1体の上に置く', fromRaces: ['コロニー・ビートル'] },
  },
  satsurikuNoKeshin: {
    id: 'satsurikuNoKeshin', name: '殺戮の化身', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 4000, race: 'ミステリー・トーテム',
    text: 'パワーアタッカー+2000。このクリーチャーは、パワー5000以下のクリーチャーにブロックされない。W・ブレイカー。',
    keywords: { powerAttacker: 2000, unblockableByPowerAtMost: 5000, doubleBreaker: true },
  },
  shellFactoryGamma: {
    id: 'shellFactoryGamma', name: 'シェル・ファクトリーγ', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 2000, race: 'コロニー・ビートル/サバイバー',
    text: 'SV：このクリーチャーがバトルゾーンに出た時、自分の山札を見る。その中からサバイバーを1体選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    onPlay: deckTutor(0, 1, isRaceAnyOf(['サバイバー'])),
  },
  tatakaiNoKeshin: {
    id: 'tatakaiNoKeshin', name: '戦いの化身', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 4000, race: 'ミステリー・トーテム',
    text: 'このクリーチャーがバトルゾーンにある間、相手の攻撃クリーチャーは、可能であればミステリー・トーテムを攻撃する。',
    keywords: { forcesAttacksAgainstRace: 'ミステリー・トーテム' },
  },
  miryoYouseiChamiria: {
    id: 'miryoYouseiChamiria', name: '魅了妖精チャミリア', civ: 'nature', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 4, power: 3000, race: 'スノーフェアリー',
    text: 'このクリーチャーで攻撃する代わりに、タップして次のTT能力を使ってもよい。TT：自分の山札を見る。その中からクリーチャーを1体選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。',
    tapAbility: deckSearchAnyCreatureTT(),
  },
  shinpiNoTakara: {
    id: 'shinpiNoTakara', name: '神秘の宝箱', civ: 'nature', type: 'spell', rarity: 'R', set: 'DM-06',
    cost: 3,
    text: '自分の山札を見る。その中から自然以外のカードを1枚選び、自分のマナゾーンに置いてもよい。その後、山札をシャッフルする。',
    spell: tutorToManaAbility(0, 1, isNotCiv('nature')),
  },
  choyakuNoChojin: {
    id: 'choyakuNoChojin', name: '跳躍の超人', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 7, power: 8000, race: 'ジャイアント',
    text: 'W・ブレイカー。',
    keywords: { doubleBreaker: true },
  },
  meguminoKeshin: {
    id: 'meguminoKeshin', name: '恵みの化身', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 6, power: 5000, race: 'ミステリー・トーテム',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。自分の墓地からカードを3枚まで選び、自分のマナゾーンに置く。',
    tapAbility: manaToGraveyardUpTo3Ability(),
  },
  gekitoSuruFeatherHorn: {
    id: 'gekitoSuruFeatherHorn', name: '激闘するフェザー・ホーン', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 4000, race: 'ホーン・ビースト', text: '',
  },
  jukaiWoMamoruParadiseHorn: {
    id: 'jukaiWoMamoruParadiseHorn', name: '樹界を守るパラダイス・ホーン', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 3000, race: 'ホーン・ビースト',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  mukuNoHoken: {
    id: 'mukuNoHoken', name: '無垢の宝剣', civ: 'nature', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 1000, race: 'ビーストフォーク',
    text: 'どんな種族の進化クリーチャーを、このクリーチャーの上に置いてもよい。',
    keywords: { universalEvolutionBase: true },
  },
  daishizenNoIshi: {
    id: 'daishizenNoIshi', name: '大自然の意志', civ: 'nature', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 3,
    text: 'S・トリガー。バトルゾーンにある、相手の進化クリーチャーを1体選び、一番上のカードを持ち主のマナゾーンに置く。',
    keywords: { shieldTrigger: true },
    spell: peelTopOfEvolutionToManaOne(1, 1),
  },
  blueRazorBeetle: {
    id: 'blueRazorBeetle', name: 'ブルーレイザー・ビートル', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 4000, race: 'ジャイアント・インセクト',
    text: 'このクリーチャーは、相手プレイヤーを攻撃できない。パワーアタッカー+4000。',
    keywords: { cannotAttackPlayer: true, powerAttacker: 4000 },
  },
  genwakuBerry: {
    id: 'genwakuBerry', name: '幻惑ベリー', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 3000, race: 'ツリーフォーク', text: '',
  },
  shellCarrier: {
    id: 'shellCarrier', name: 'シェル・キャリアー', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 2000, race: 'コロニー・ビートル',
    text: 'パワーアタッカー+3000。',
    keywords: { powerAttacker: 3000 },
  },
  touzokuNoTate: {
    id: 'touzokuNoTate', name: '盗賊の盾', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 2000, race: 'ビーストフォーク',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。自分のクリーチャーを1体選ぶ。このターンが終わるまで、そのクリーチャーのパワーは+5000される。',
    tapAbility: grantAttackBuffOne(5000, false, 1, 1),
  },
  shellRack: {
    id: 'shellRack', name: 'シェル・ラック', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 2000, race: 'コロニー・ビートル', text: '',
  },
  kakkoYouseiGarabon: {
    id: 'kakkoYouseiGarabon', name: '滑降妖精ガラボン', civ: 'nature', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 1000, race: 'スノーフェアリー',
    text: 'パワーアタッカー+2000。',
    keywords: { powerAttacker: 2000 },
  },
  fairyLife: {
    id: 'fairyLife', name: 'フェアリー・ライフ', civ: 'nature', type: 'spell', rarity: 'C', set: 'DM-06',
    cost: 2,
    text: 'S・トリガー。自分の山札の上から1枚目を、自分のマナゾーンに置く。',
    keywords: { shieldTrigger: true },
    spell: deckTopToManaSelf(1),
  },

  // ===================== 第6弾(DM-06) 光文明 (24) =====================
  seitenshiClauseValkyura: {
    id: 'seitenshiClauseValkyura', name: '聖天使クラウゼ・バルキューラ', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 6, power: 7500, race: 'イニシエート',
    text: '進化ー自分のイニシエート1体の上に置く。このクリーチャーがバトルゾーンに出た時、バトルゾーンにある相手のクリーチャーを2体まで選び、タップする。W・ブレイカー。',
    keywords: { doubleBreaker: true },
    onPlay: tapEnemyTT(0, 2),
    evolution: { requirementText: '自分のイニシエート1体の上に置く', fromRaces: ['イニシエート'] },
  },
  senkoNoGudoshaLaVeil: {
    id: 'senkoNoGudoshaLaVeil', name: '閃光の求道者ラ・ベイル', civ: 'light', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 8, power: 8500, race: 'メカサンダー',
    text: 'ブロッカー。W・ブレイカー。ターンの終わりに、このクリーチャーをアンタップしてもよい。',
    keywords: { blocker: true, doubleBreaker: true, endOfTurnUntap: 'self' },
  },
  ginkaiNoShugoshaLeGiraLeSil: {
    id: 'ginkaiNoShugoshaLeGiraLeSil', name: '銀界の守護者ル・ギラ・レシール', civ: 'light', type: 'creature', rarity: 'VR', set: 'DM-06',
    cost: 5, power: 4000, race: 'ガーディアン',
    text: 'ブロッカー。このクリーチャーがバトルゾーンにある間、進化クリーチャーはタップされた状態でバトルゾーンに出る。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true, evolutionEntersTapped: true },
  },
  invincibleAura: {
    id: 'invincibleAura', name: 'インビンシブル・オーラ', civ: 'light', type: 'spell', rarity: 'VR', set: 'DM-06',
    cost: 13,
    text: '自分の山札のカードを上から3枚まで、自分のシールドに加える。',
    spell: deckTopToShieldAbility(3),
  },
  shugoseitenArcVein: {
    id: 'shugoseitenArcVein', name: '守護聖天アーク・バイン', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 5000, race: 'ガーディアン',
    text: '進化－自分のガーディアン1体の上に置く。バトルゾーンにある自分の光のクリーチャーをタップし、攻撃する代わりに次のTT能力を使ってもよい。TT－バトルゾーンにある相手のクリーチャーを1体選び、タップする。',
    keywords: { tapAbilityGrantToCiv: 'light' },
    tapAbility: tapEnemyTT(1, 1),
    evolution: { requirementText: '進化－自分のガーディアン1体の上に置く', fromRaces: ['ガーディアン'] },
  },
  seiikiNoShugoshaPhobosElaineGamma: {
    id: 'seiikiNoShugoshaPhobosElaineGamma', name: '聖域の守護者フォボス・エレインγ', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 4000, race: 'ガーディアン/サバイバー',
    text: 'SV－このクリーチャーがバトルゾーンに出たとき、自分の山札を見る。その中から呪文を1枚選び、相手に見せてから自分の手札に加えてもよい。その後、山札をシャッフルする。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { survivorGrants: 'onPlay' },
    onPlay: deckTutor(0, 1, isType('spell')),
  },
  kiraboshiNoSeireiGalial: {
    id: 'kiraboshiNoSeireiGalial', name: '綺羅星の精霊ガリアル', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 7500, race: 'エンジェル・コマンド',
    text: '呪文を唱えたターンのみ、このクリーチャーを召喚できる。W・ブレイカー。',
    keywords: { requiresSpellCastThisTurn: true, doubleBreaker: true },
  },
  seikishiCosmoGould: {
    id: 'seikishiCosmoGould', name: '聖騎士コスモグールド', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 4, power: 3000, race: 'レインボー・ファントム',
    text: 'このクリーチャーで攻撃するかわりに、タップして次のTT能力を使ってもよい。TT－自分のマナゾーンから呪文を1枚選び、自分の手札に戻す。',
    tapAbility: manaCardToHandTT(1, 1),
  },
  senkyoushiElliott: {
    id: 'senkyoushiElliott', name: '宣凶師エルリオット', civ: 'light', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 4, power: 3000, race: 'グラディエーター',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。このクリーチャーがバトルゾーンに出たとき、自分のシールドをすべて見てもよい。その後、それを元に戻す。',
    keywords: { blocker: true, cannotAttackPlayer: true },
    onPlay: peekOwnShieldsAbility(),
  },
  justiceBind: {
    id: 'justiceBind', name: 'ジャスティス・バインド', civ: 'light', type: 'spell', rarity: 'R', set: 'DM-06',
    cost: 4,
    text: 'S・トリガー。バトルゾーンにある、「ブロッカー」以外のクリーチャーをすべてタップする。',
    keywords: { shieldTrigger: true },
    spell: tapAllNonBlockersAbility(),
  },
  hiunNoGudoshaDabaTore: {
    id: 'hiunNoGudoshaDabaTore', name: '飛雲の求道者ダバ・トーレ', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 6, power: 5500, race: 'メカサンダー',
    text: '相手のターンに、このクリーチャーが自分の手札から自分の墓地に置かれるとき、墓地に置くかわりにバトルゾーンに置く。',
    keywords: { madness: true },
  },
  kobashiraJu: {
    id: 'kobashiraJu', name: '光柱樹', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 5, power: 1000, race: 'スターライト・ツリー',
    text: 'バトルゾーンにある間、このクリーチャーのパワーは、自分のシールド1枚につき+2000される。',
    keywords: { powerPerOwnShieldCard: 2000 },
  },
  yogenshaAdmis: {
    id: 'yogenshaAdmis', name: '予言者アドミス', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 3, power: 2000, race: 'ライトブリンガー',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。シールドを1枚選んで見る。その後、それを元に戻す。',
    tapAbility: shieldPeekOpponentTT(),
  },
  seikishiMoonTear: {
    id: 'seikishiMoonTear', name: '聖騎士ムーンティアー', civ: 'light', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 2, power: 3500, race: 'レインボー・ファントム',
    text: '呪文を唱えたターンのみ、このクリーチャーを召喚することができる。',
    keywords: { requiresSpellCastThisTurn: true },
  },
  rainArrow: {
    id: 'rainArrow', name: 'レイン・アロー', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 2,
    text: '相手の手札を見る。その中から闇の呪文をすべて選び出し、持ち主の墓地に置く。',
    spell: discardAllMatchingHandAbility((def) => def.type === 'spell' && def.civ === 'dark'),
  },
  protectForce: {
    id: 'protectForce', name: 'プロテクト・フォース', civ: 'light', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 1,
    text: 'S・トリガー。バトルゾーンにある、自分の「ブロッカー」を持つクリーチャー1体を選ぶ。このターンが終わるまで、そのクリーチャーのパワーは+4000される。',
    keywords: { shieldTrigger: true },
    spell: grantAttackBuffOneFiltered(4000, false, (engine, side, c) => engine.isBlockerNow(side, c)),
  },
  eijinNoShitoGureChain: {
    id: 'eijinNoShitoGureChain', name: '鋭刃の使徒グーレ・チェーン', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 5, power: 2000, race: 'イニシエート',
    text: 'このクリーチャーで攻撃するかわりに、タップして次のTT能力を使ってもよい。TT−バトルゾーンにある相手のクリーチャーを1体選び、タップする。',
    tapAbility: tapEnemyTT(1, 1),
  },
  fukutsuNoShitoChiiKure: {
    id: 'fukutsuNoShitoChiiKure', name: '不屈の使徒チーキ・クーレ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 5, power: 1000, race: 'イニシエート',
    text: 'ブロッカー。このクリーチャーが攻撃をブロックした時、バトルは行われない。ただし、両クリーチャーはタップしたままである。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, cannotAttack: true, noBattleWhenBlocking: true },
  },
  senkyoushiKinzera: {
    id: 'senkyoushiKinzera', name: '宣凶師キンゼラ', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 4000, race: 'グラディエーター',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  aidenSou: {
    id: 'aidenSou', name: '藍電草', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 3000, race: 'スターライト・ツリー', text: '',
  },
  denjiNoShitoBaruAsu: {
    id: 'denjiNoShitoBaruAsu', name: '電磁の使徒バルアス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 2000, race: 'イニシエート', text: '',
  },
  yogenshaYuk: {
    id: 'yogenshaYuk', name: '予言者ユーク', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 1, power: 2500, race: 'ライトブリンガー',
    text: '呪文を唱えたターンのみ、このクリーチャーを召喚することができる。',
    keywords: { requiresSpellCastThisTurn: true },
  },
  yogenshaJess: {
    id: 'yogenshaJess', name: '予言者ジェス', civ: 'light', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 1, power: 2000, race: 'ライトブリンガー',
    text: 'ブロッカー。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { blocker: true, cannotAttackPlayer: true },
  },
  elementalShield: {
    id: 'elementalShield', name: 'エレメンタル・シールド', civ: 'light', type: 'spell', rarity: 'C', set: 'DM-06',
    cost: 4,
    text: '相手のシールドが自分のより多い場合、自分の山札の上から1枚目を、自分のシールドに加える。',
    spell: conditionalShieldAddAbility(),
  },

  // ===================== 第6弾(DM-06) 闇文明 (23) =====================
  chogenjuGrazald: {
    id: 'chogenjuGrazald', name: '超幻獣グラザルド', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 5, power: 5000, race: 'キマイラ',
    text: '進化－自分のキマイラ1体の上に置く。このクリーチャーがバトルゾーンにある間、バトルゾーンにある自分の闇のクリーチャーをタップし、攻撃する代わりに次の能力を使ってもよい。相手の手札からカードを1枚見ないで選び、持ち主の墓地に置く。',
    keywords: { tapAbilityGrantToCiv: 'dark' },
    tapAbility: handDiscardOpponentRandomTT(),
    evolution: { requirementText: '進化－自分のキマイラ1体の上に置く', fromRaces: ['キマイラ'] },
  },
  funNoMoshoDaidalos: {
    id: 'funNoMoshoDaidalos', name: '憤怒の猛将ダイダロス', civ: 'dark', type: 'creature', rarity: 'SR', set: 'DM-06',
    cost: 4, power: 11000, race: 'デーモン・コマンド',
    text: 'バトルゾーンにある、自分の他のクリーチャー1体を自分の墓地に置かなければ、このクリーチャーは攻撃することができない。W・ブレイカー。',
    keywords: { mustSacrificeToAttack: true, doubleBreaker: true },
  },
  senshaOtoko: {
    id: 'senshaOtoko', name: '戦車男', civ: 'dark', type: 'creature', rarity: 'VR', set: 'DM-06',
    cost: 9, power: 6000, race: 'ヘドリアン',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。相手はバトルゾーンにある自分自身のクリーチャーを1体選び、持ち主の墓地に置く。',
    tapAbility: opponentForcedDestroyOwnTT(),
  },
  invincibleAbyss: {
    id: 'invincibleAbyss', name: 'インビンシブル・アビス', civ: 'dark', type: 'spell', rarity: 'VR', set: 'DM-06',
    cost: 13,
    text: '相手は、バトルゾーンにある自分自身のクリーチャーすべてを持ち主の墓地に置く。',
    spell: wipeOpponentBoardAbility(),
  },
  kyokoNoMakokuDeathSpecter: {
    id: 'kyokoNoMakokuDeathSpecter', name: '恐慌の魔黒デス・スペクター', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 3, power: 5000, race: 'ゴースト',
    text: '進化－自分のゴースト1体の上に置く。バトルゾーンにある自分のゴーストはすべて「スレイヤー」を得る。',
    keywords: { auraGrantSlayerToOwnRace: 'ゴースト' },
    evolution: { requirementText: '進化－自分のゴースト1体の上に置く', fromRaces: ['ゴースト'] },
  },
  senritsuNoGoshoAbrin: {
    id: 'senritsuNoGoshoAbrin', name: '戦慄の剛将アブリン', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 8000, race: 'デーモン・コマンド',
    text: 'W・ブレイカー。自分のターンが終わるとき、バトルゾーンにある自分のクリーチャーがこのクリーチャーだけであれば、自分の墓地に置く。',
    keywords: { doubleBreaker: true, selfDestructIfAloneEndOfTurn: true },
  },
  yamikoushakuHawks: {
    id: 'yamikoushakuHawks', name: '闇侯爵ハウクス', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 6, power: 5000, race: 'ダークロード',
    text: 'このクリーチャーが破壊された時、各プレイヤーは自身の手札をすべて、それぞれの墓地に置く。',
    onDestroyed: symmetricDiscardAllAbility(),
  },
  shibakuchuGraveWormGamma: {
    id: 'shibakuchuGraveWormGamma', name: '死縛虫グレイブ・ワームγ', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 5, power: 3000, race: 'パラサイトワーム/サバイバー',
    text: 'SV－このクリーチャーがバトルゾーンに出たとき、自分の墓地からサバイバーを1体選び、自分の手札に戻してもよい。サバイバー(このクリーチャーがバトルゾーンにある間、自分の他のサバイバーも上のSV能力を得る)。',
    keywords: { survivorGrants: 'onPlay' },
    onPlay: graveyardCardToHand(0, 1, and(isType('creature'), isRaceAnyOf(['サバイバー']))),
  },
  kokuNoTsubasaDarkMolder: {
    id: 'kokuNoTsubasaDarkMolder', name: '虚空の翼ダークモルダー', civ: 'dark', type: 'creature', rarity: 'R', set: 'DM-06',
    cost: 4, power: 7000, race: 'デーモン・コマンド',
    text: 'このクリーチャーは、クリーチャーを攻撃できない。W・ブレイカー。このクリーチャーはバトルに勝っても、バトルの後、持ち主の墓地に置かれる。',
    keywords: { cannotAttackCreatures: true, doubleBreaker: true, selfDestructAfterBattle: true },
  },
  jakonTensei: {
    id: 'jakonTensei', name: '邪魂転生', civ: 'dark', type: 'spell', rarity: 'R', set: 'DM-06',
    cost: 3,
    text: 'S・トリガー。バトルゾーンにある自分のクリーチャーを好きな数選び、自分の墓地に置く。その後、そのクリーチャー1体につき2枚カードを引く。',
    keywords: { shieldTrigger: true },
    spell: sacrificeOwnForDrawSpell(),
  },
  gigaBoar: {
    id: 'gigaBoar', name: 'ギガボアー', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 6, power: 4000, race: 'キマイラ',
    text: 'ブロッカー。スレイヤー。このクリーチャーは攻撃することができない。',
    keywords: { blocker: true, slayer: true, cannotAttack: true },
  },
  senOtoko: {
    id: 'senOtoko', name: '戦男', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 8000, race: 'ヘドリアン',
    text: 'このクリーチャーは、「ブロッカー」を持つクリーチャーだけを攻撃できる。このクリーチャーは、相手プレイヤーを攻撃できない。',
    keywords: { canOnlyAttackBlockers: true, cannotAttackPlayer: true },
  },
  kiganKaijinSkullCutter: {
    id: 'kiganKaijinSkullCutter', name: '鬼眼怪人スカルカッター', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 4, power: 4000, race: 'デビルマスク',
    text: '自分のターンが終わるとき、バトルゾーンにある自分のクリーチャーがこのクリーチャーだけであれば、自分の墓地に置く。',
    keywords: { selfDestructIfAloneEndOfTurn: true },
  },
  jinmetsuNingyoPaul: {
    id: 'jinmetsuNingyoPaul', name: '刃滅人形ポール', civ: 'dark', type: 'creature', rarity: 'UC', set: 'DM-06',
    cost: 2, power: 1000, race: 'デスパペット',
    text: 'このクリーチャーで攻撃する代わりに、タップして次の能力を使ってもよい。バトルゾーンにある自分のクリーチャーを1体選ぶ。このターンが終わるまで、そのクリーチャーは「スレイヤー」を得る。',
    tapAbility: grantSlayerToOneOwnTT(),
  },
  hellSlash: {
    id: 'hellSlash', name: 'ヘル・スラッシュ', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 8,
    text: '相手の山札を見る。その中から3枚選び、持ち主の墓地に置いてもよい。その後、相手は自分自身の山札をシャッフルする。',
    spell: millChosenFromDeckAbility(3),
  },
  shiNoSenkoku: {
    id: 'shiNoSenkoku', name: '死の宣告', civ: 'dark', type: 'spell', rarity: 'UC', set: 'DM-06',
    cost: 4,
    text: 'S・トリガー。相手はバトルゾーンにある自分自身のクリーチャーを1体選び、持ち主の墓地に置く。',
    keywords: { shieldTrigger: true },
    spell: opponentForcedDestroyOwn(),
  },
  saikotsuNoShikakuZolbath: {
    id: 'saikotsuNoShikakuZolbath', name: '砕骨の刺客ゾルバス', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 5, power: 8000, race: 'デーモン・コマンド',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。このクリーチャーはバトルに勝っても、バトルの後、持ち主の墓地に置かれる。',
    keywords: { blocker: true, cannotAttack: true, selfDestructAfterBattle: true },
  },
  yukiNoKageReverseSoul: {
    id: 'yukiNoKageReverseSoul', name: '幽鬼の影リバース・ソウル', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 5, power: 3000, race: 'ゴースト',
    text: 'このクリーチャーで攻撃する代わりに、タップして次のTT能力を使ってもよい。TT−自分の墓地から闇クリーチャーを1体選び、自分の手札に戻す。',
    tapAbility: graveyardDarkCreatureToHandTT(),
  },
  rerretsuchuTentacleWorm: {
    id: 'rerretsuchuTentacleWorm', name: '烈裂虫テンタクル・ワーム', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 4, power: 3000, race: 'パラサイトワーム', text: '',
  },
  cursePendant: {
    id: 'cursePendant', name: 'カース・ペンダント', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 4, power: 2000, race: 'ブレインジャッカー',
    text: 'ブロッカー。このクリーチャーは攻撃することができない。スレイヤー。',
    keywords: { blocker: true, cannotAttack: true, slayer: true },
  },
  gyakushiKaijinTomahawk: {
    id: 'gyakushiKaijinTomahawk', name: '逆歯怪人トマホーク', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 3, power: 1000, race: 'デビルマスク',
    text: 'スレイヤー。',
    keywords: { slayer: true },
  },
  kyokenNingyoJunkatsu: {
    id: 'kyokenNingyoJunkatsu', name: '凶犬人形ジュンカツ', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 2, power: 2000, race: 'デスパペット', text: '',
  },
  kodokuNoKageLonelyWalker: {
    id: 'kodokuNoKageLonelyWalker', name: '孤独の影ロンリー・ウォーカー', civ: 'dark', type: 'creature', rarity: 'C', set: 'DM-06',
    cost: 1, power: 2000, race: 'ゴースト',
    text: '自分のターンが終わるとき、バトルゾーンにある自分のクリーチャーがこのクリーチャーだけであれば、自分の墓地に置く。',
    keywords: { selfDestructIfAloneEndOfTurn: true },
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
