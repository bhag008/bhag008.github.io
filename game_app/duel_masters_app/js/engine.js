// デュエルマスターズ・エンジン: フェーズ管理、マナ支払い、攻撃/ブロック、シールドブレイクとS・トリガーを解決する
import { nextUid } from './state.js';
import {
  getCard, isBlocker, isDoubleBreaker, hasShieldTrigger, hasKeyword, keywordValue,
  START_SHIELDS, START_HAND,
} from './cards.js';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeInstance(cardId) {
  return { uid: nextUid(), cardId };
}

function labelOf(side) {
  return side === 'player' ? 'あなた' : 'CPU';
}

// symmetricAura(第4弾で追加): 両プレイヤーのクリーチャーを対象にできるオーラ・キーワードの一致判定
function auraMatches(aura, def) {
  if (aura.matchRace) {
    const races = Array.isArray(aura.matchRace) ? aura.matchRace : [aura.matchRace];
    if (races.includes(def.race)) return true;
  }
  if (aura.matchCiv) {
    const civs = Array.isArray(aura.matchCiv) ? aura.matchCiv : [aura.matchCiv];
    if (civs.includes(def.civ)) return true;
  }
  return false;
}

// 文明限定スレイヤー(第5弾: ギガゲイル=自然・光スレイヤー等)の判定。selfDefが相手のcivsを持つ側にのみ効果
function civSlayerMatches(selfDef, opponentDef) {
  const civs = keywordValue(selfDef, 'slayerVsCiv');
  if (!civs) return false;
  const oc = Array.isArray(opponentDef.civ) ? opponentDef.civ : [opponentDef.civ];
  return civs.some((c) => oc.includes(c));
}

// バトルゾーンのクリーチャーは「スタック」として表現する: stack[stack.length-1]が現在の姿(進化クリーチャー)。
// 進化元は束になっていて、バトルゾーンを離れる際は全員まとめて移動し、移動先で個別のカードに戻る。
function makeCreatureInstance(uid, cardId) {
  return {
    uid, tapped: false, sickness: true,
    tempPowerAttackerBonus: 0, tempDoubleBreaker: false,
    tempUnblockable: false, tempIgnoreTapRequirement: false,
    tempStaticPowerBonus: 0, tempBlockerGrant: false, tempTripleBreaker: false, tempSlayerGrant: false,
    stack: [{ uid, cardId }],
  };
}

export class DuelEngine {
  constructor(playerDeckIds, cpuDeckIds) {
    this.players = {
      player: this.buildPlayerState(playerDeckIds),
      cpu: this.buildPlayerState(cpuDeckIds),
    };
    this.log = [];
    this.result = null;
    this.pendingBlock = null;
    this.pendingShieldTriggers = [];
    this.pendingCip = null;
    this.pendingAttackTrigger = null;
    this.pendingTapAbility = null;
    this.forceAllAttackSide = null;
    this.turnFlags = { player: {}, cpu: {} };

    this.firstSide = Math.random() < 0.5 ? 'player' : 'cpu';
    this.turnSide = this.firstSide;
    this.turnNumber = 1;
    this.manaChargedThisTurn = false;
    this.phase = 'main';

    for (const side of ['player', 'cpu']) {
      const ps = this.players[side];
      for (let i = 0; i < START_SHIELDS; i++) ps.shields.push(ps.deck.pop());
      for (let i = 0; i < START_HAND; i++) ps.hand.push(ps.deck.pop());
    }
    this.logMsg(`${labelOf(this.firstSide)}が先攻です。`);
    this.logMsg(`--- ${labelOf(this.turnSide)}のターン${this.turnNumber} ---`);
  }

  buildPlayerState(deckIds) {
    return {
      deck: shuffle(deckIds.map(makeInstance)),
      hand: [], mana: [], battle: [], shields: [], graveyard: [],
    };
  }

  logMsg(m) { this.log.push(m); }

  opponent(side) { return side === 'player' ? 'cpu' : 'player'; }

  isGameOver() { return !!this.result; }

  // inst がバトルゾーンのクリーチャー(stack持ち)ならスタック最上段、それ以外(手札/マナ/墓地/山札のカード)ならそのカード自身
  cardOf(inst) {
    const cardId = inst.stack ? inst.stack[inst.stack.length - 1].cardId : inst.cardId;
    return getCard(cardId);
  }

  // 進化元(スタックの下2段目)。進化していない場合はnull
  evolutionBaseOf(inst) {
    if (!inst.stack || inst.stack.length < 2) return null;
    return getCard(inst.stack[inst.stack.length - 2].cardId);
  }

  // ---- パワー計算 ----
  hasRace(side, race) {
    return this.players[side].battle.some((c) => this.cardOf(c).race === race);
  }

  // 自分のマナゾーンにあるカードが1枚以上あり、かつ全て指定文明かどうか
  isManaMonoColor(side, civ) {
    const mana = this.players[side].mana;
    return mana.length > 0 && mana.every((m) => getCard(m.cardId).civ === civ);
  }

  // サバイバー(第5弾で追加): 自分の場にいる「サバイバーの長」から、同じ能力を他の自分のサバイバーも得る。
  // キーワードを持っているか(真偽値)を、自身の印刷キーワード + サバイバー付与の両方から判定する
  hasEffectiveKeyword(side, inst, key) {
    const def = this.cardOf(inst);
    if (hasKeyword(def, key)) return true;
    if (!(def.race || '').includes('サバイバー')) return false;
    return this.players[side].battle.some((other) => other !== inst && keywordValue(this.cardOf(other), 'survivorGrants') === key);
  }

  // 上記の数値/オブジェクト版: 自身の印刷値、無ければサバイバーの長から付与された値を返す
  effectiveKeywordValue(side, inst, key) {
    const def = this.cardOf(inst);
    if (def.keywords && def.keywords[key] !== undefined) return def.keywords[key];
    if (!(def.race || '').includes('サバイバー')) return undefined;
    const grantor = this.players[side].battle.find((other) => other !== inst && keywordValue(this.cardOf(other), 'survivorGrants') === key);
    return grantor ? keywordValue(this.cardOf(grantor), key) : undefined;
  }

  staticPowerBonus(side, inst) {
    const def = this.cardOf(inst);
    let bonus = 0;
    const cond = keywordValue(def, 'staticPowerBonusCondition');
    if (cond && this.hasRace(side, cond.race)) bonus += cond.amount;
    // 自分と同じ文明の他のクリーチャーの数につき常時パワーが上がる(第3弾の単色シナジー)
    const perOwnCiv = keywordValue(def, 'powerPerOtherSameCivInBattle');
    if (perOwnCiv) {
      const count = this.players[side].battle.filter((c) => c !== inst && this.cardOf(c).civ === def.civ).length;
      bonus += perOwnCiv * count;
    }
    // 自分のマナゾーンが自分の文明で単色の間、常時パワーが上がる(第3弾の単色シナジー)
    const monoBonus = keywordValue(def, 'staticPowerIfManaMonoColor');
    if (monoBonus && this.isManaMonoColor(side, def.civ)) bonus += monoBonus;
    // 他の自分のクリーチャー(場合によっては自分がタップ中の時のみ)から常時パワーを得る「オーラ」
    for (const other of this.players[side].battle) {
      if (other === inst) continue;
      const otherDef = this.cardOf(other);
      const aura = keywordValue(otherDef, 'auraBuffOthersOfRace');
      if (aura && aura.race === def.race && (!aura.whileSelfTapped || other.tapped)) bonus += aura.amount;
    }
    // 自分の場に指定文明のクリーチャーがいる間、常時パワーが上がる(第4弾: 爆裂兵ダーク・ブラスター等)
    const civPresentCond = keywordValue(def, 'staticPowerBonusIfOwnCivPresent');
    if (civPresentCond && this.players[side].battle.some((c) => c !== inst && this.cardOf(c).civ === civPresentCond.civ)) {
      bonus += civPresentCond.amount;
    }
    // 自分のシールドゾーンのカード枚数につき常時パワーが上がる(第4弾: シェル・キャノン)
    const perShield = keywordValue(def, 'powerPerOwnShieldCard');
    if (perShield) bonus += perShield * this.players[side].shields.length;
    // このターンだけの一時的な常時パワーボーナス(第4弾: ブレス・ソード)
    bonus += inst.tempStaticPowerBonus || 0;
    // 常時(攻撃中に限らない)固定パワーボーナス。サバイバーの長からの付与にも対応(第5弾: 威嚇するスマッシュ・ホーンα)
    const staticFlat = this.effectiveKeywordValue(side, inst, 'staticPowerFlat');
    if (staticFlat) bonus += staticFlat;
    // 相手の指定文明群のクリーチャー数につき常時パワーが上がる(第5弾: 月浴するムーン・ホーン/巨翼の爪)
    const enemyCivUnion = keywordValue(def, 'powerPerEnemyCivUnion');
    if (enemyCivUnion) {
      const opp = this.opponent(side);
      const count = this.players[opp].battle.filter((c) => {
        const cc = this.cardOf(c).civ;
        const civs = Array.isArray(cc) ? cc : [cc];
        return civs.some((cv) => enemyCivUnion.civs.includes(cv));
      }).length;
      bonus += enemyCivUnion.amount * count;
    }
    // 両プレイヤーのクリーチャーを対象にできる種族/文明オーラ(第4弾: 邪妃グレゴリア等の「部族の長」系カード)
    for (const s of ['player', 'cpu']) {
      for (const other of this.players[s].battle) {
        if (other === inst) continue;
        const aura = keywordValue(this.cardOf(other), 'symmetricAura');
        if (aura && aura.powerBonus && auraMatches(aura, def)) bonus += aura.powerBonus;
      }
    }
    return bonus;
  }

  powerBase(side, inst) {
    const def = this.cardOf(inst);
    return (def.power || 0) + this.staticPowerBonus(side, inst);
  }

  powerWhileAttacking(side, inst) {
    const def = this.cardOf(inst);
    let p = this.powerBase(side, inst);
    // サバイバーの長から付与された「パワーアタッカー」にも対応(第5弾: ブレイズザウルスα)
    const pa = this.effectiveKeywordValue(side, inst, 'powerAttacker');
    if (pa) p += pa;
    // 自分の場に指定文明の他のクリーチャーがいる/いないかで攻撃中のみパワーが変わる(第6弾: グチェラリオン=不在時、マグナム・ブルース=在時)
    const civCond = keywordValue(def, 'powerAttackerIfOwnCivCondition');
    if (civCond) {
      const present = this.players[side].battle.some((c) => c !== inst && this.cardOf(c).civ === civCond.civ);
      if (civCond.requireAbsent ? !present : present) p += civCond.amount;
    }
    const cond = keywordValue(def, 'powerAttackerCondition');
    if (cond && this.hasRace(side, cond.race)) p += cond.amount;
    const gyCond = keywordValue(def, 'powerAttackerPerGraveyardCiv');
    if (gyCond) {
      const count = this.players[side].graveyard.filter((c) => getCard(c.cardId).civ === gyCond.civ).length;
      p += gyCond.amount * count;
    }
    const tappedAllyCond = keywordValue(def, 'powerAttackerPerTappedAlly');
    if (tappedAllyCond) {
      const count = this.players[side].battle.filter((c) => c !== inst && c.tapped).length;
      p += tappedAllyCond * count;
    }
    const ownCountCond = keywordValue(def, 'powerAttackerPerOwnCreatureCount');
    if (ownCountCond) p += ownCountCond * this.players[side].battle.length;
    const otherRaceCond = keywordValue(def, 'powerAttackerPerOtherRaceCount');
    if (otherRaceCond) {
      const count = this.players[side].battle.filter((c) => c !== inst && this.cardOf(c).race === otherRaceCond.race).length;
      p += otherRaceCond.amount * count;
    }
    if (hasKeyword(def, 'soloPowerAttacker') && this.players[side].battle.length === 1) {
      p += keywordValue(def, 'soloPowerAttacker');
    }
    // 他の自分のクリーチャーから、攻撃中のみ働く固定値のパワーオーラを得る(超竜ジャバハ等)
    for (const other of this.players[side].battle) {
      if (other === inst) continue;
      const otherDef = this.cardOf(other);
      const atkAura = keywordValue(otherDef, 'auraBuffOthersOfCivWhileAttacking');
      if (atkAura && atkAura.civ === def.civ) p += atkAura.amount;
    }
    // 両プレイヤーのクリーチャーを対象にできる「攻撃中のみパワーアタッカーを得る」オーラ(第4弾: カオティック・ワイバーン等)
    for (const s of ['player', 'cpu']) {
      for (const other of this.players[s].battle) {
        if (other === inst) continue;
        const aura = keywordValue(this.cardOf(other), 'symmetricAura');
        if (aura && aura.powerAttackerBonus && auraMatches(aura, def)) p += aura.powerAttackerBonus;
      }
    }
    p += inst.tempPowerAttackerBonus || 0;
    return p;
  }

  isDoubleBreakerNow(side, inst) {
    const def = this.cardOf(inst);
    if (isDoubleBreaker(def) || inst.tempDoubleBreaker) return true;
    if (hasKeyword(def, 'soloDoubleBreaker') && this.players[side].battle.length === 1) return true;
    if (hasKeyword(def, 'doubleBreakerIfManaMonoColor') && this.isManaMonoColor(side, def.civ)) return true;
    // サバイバーの長からのW・ブレイカー付与(第5弾: ブレイドラッシュ・ワイバーンδ)
    if (this.hasEffectiveKeyword(side, inst, 'doubleBreaker')) return true;
    // 自分の場に指定文明の他のクリーチャーがいなければW・ブレイカーを得る(第6弾: グチェラリオン)
    const dbAbsentCiv = keywordValue(def, 'doubleBreakerIfOwnCivAbsent');
    if (dbAbsentCiv && !this.players[side].battle.some((c) => c !== inst && this.cardOf(c).civ === dbAbsentCiv)) return true;
    for (const s of ['player', 'cpu']) {
      for (const other of this.players[s].battle) {
        if (other === inst) continue;
        const aura = keywordValue(this.cardOf(other), 'symmetricAura');
        if (aura && aura.grantsDoubleBreaker && auraMatches(aura, def)) return true;
      }
    }
    return false;
  }

  // シールドブレイク枚数(1/2/3)。T・ブレイカー(第5弾)を考慮する
  breakerCountNow(side, inst) {
    const def = this.cardOf(inst);
    let n = 1;
    if (inst.tempTripleBreaker || this.hasEffectiveKeyword(side, inst, 'tripleBreaker')) n = 3;
    else if (this.isDoubleBreakerNow(side, inst)) n = 2;
    // クルー・ブレイカー：サバイバー(第6弾: シグマ・トゥレイト) — 自分の他のサバイバー1体につき+1枚
    if (hasKeyword(def, 'breakerBonusPerOtherSurvivor')) {
      n += this.players[side].battle.filter((c) => c !== inst && (this.cardOf(c).race || '').includes('サバイバー')).length;
    }
    return n;
  }

  // ブロッカーかどうか(常時に加え、他クリーチャーからのオーラ付与・マナ単色条件も考慮)
  isBlockerNow(side, inst) {
    const def = this.cardOf(inst);
    if (isBlocker(def)) return true;
    if (inst.tempBlockerGrant) return true;
    if (hasKeyword(def, 'blockerIfManaMonoColor') && this.isManaMonoColor(side, def.civ)) return true;
    // サバイバーの長からのブロッカー付与(第5弾: 鉄壁の守護者ガリア・ゾールα)
    if (this.hasEffectiveKeyword(side, inst, 'blocker')) return true;
    for (const other of this.players[side].battle) {
      if (other === inst) continue;
      const grantCiv = keywordValue(this.cardOf(other), 'auraGrantBlockerToOthersOfCiv');
      if (grantCiv && grantCiv === def.civ) return true;
    }
    for (const s of ['player', 'cpu']) {
      for (const other of this.players[s].battle) {
        if (other === inst) continue;
        const aura = keywordValue(this.cardOf(other), 'symmetricAura');
        if (aura && aura.grantsBlocker && auraMatches(aura, def)) return true;
      }
    }
    return false;
  }

  // ---- ターン進行 ----
  untapAll(side) {
    const ps = this.players[side];
    for (const m of ps.mana) m.tapped = false;
    for (const c of ps.battle) { c.tapped = false; c.sickness = false; }
  }

  clearTurnTempEffects() {
    for (const side of ['player', 'cpu']) {
      for (const c of this.players[side].battle) {
        c.tempPowerAttackerBonus = 0;
        c.tempDoubleBreaker = false;
        c.tempUnblockable = false;
        c.tempIgnoreTapRequirement = false;
        c.tempStaticPowerBonus = 0;
        c.tempBlockerGrant = false;
        c.tempTripleBreaker = false;
        c.tempSlayerGrant = false;
      }
    }
  }

  drawCards(side, n) {
    const ps = this.players[side];
    for (let i = 0; i < n; i++) {
      if (this.isGameOver()) return;
      if (ps.deck.length === 0) {
        this.result = this.opponent(side);
        this.logMsg(`${labelOf(side)}は山札が無くドローできず敗北した。`);
        return;
      }
      ps.hand.push(ps.deck.pop());
    }
  }

  // 効果によるドロー: 山札が尽きても敗北にはならず、引けるだけ引いて止まる
  drawCardsSafe(side, n) {
    const ps = this.players[side];
    let drawn = 0;
    for (let i = 0; i < n && ps.deck.length > 0; i++) { ps.hand.push(ps.deck.pop()); drawn++; }
    if (drawn > 0) this.logMsg(`${labelOf(side)}はカードを${drawn}枚引いた。`);
  }

  startTurn() {
    const side = this.turnSide;
    this.untapAll(side);
    const skipDraw = this.turnNumber === 1 && side === this.firstSide;
    if (!skipDraw) this.drawCards(side, 1);
    if (this.isGameOver()) return;
    this.manaChargedThisTurn = false;
    this.phase = 'main';
  }

  // クリーチャーが自身のターン終了時に自身をアンタップできる/全アンタップできる能力を処理
  applyEndOfTurnUntap(side) {
    const ps = this.players[side];
    for (const c of ps.battle) {
      // サバイバーの長からの「ターン終了時アンタップ」付与にも対応(第5弾: 戦空の伝道士バルスβ)
      const mode = this.effectiveKeywordValue(side, c, 'endOfTurnUntap');
      if (mode === 'all') {
        for (const other of ps.battle) other.tapped = false;
      } else if (mode === 'self' && c.tapped) {
        c.tapped = false;
      }
    }
  }

  // 強制攻撃クリーチャーの扱い: 攻撃フェーズ開始直後にmain.js/ai.jsから呼ぶ想定
  runForcedAttackers(side) {
    if (this.phase !== 'attack') return [];
    const results = [];
    const ps = this.players[side];
    // 相手の次の攻撃可能なクリーチャーすべてを強制攻撃させる効果(第5弾: ファントム・ベール)。一度使ったら消える
    const forceAll = this.forceAllAttackSide === side;
    if (forceAll) this.forceAllAttackSide = null;
    const forced = ps.battle.filter((c) => !c.tapped && !c.sickness && (forceAll || hasKeyword(this.cardOf(c), 'forcedAttacker')));
    for (const c of forced) {
      if (this.isGameOver()) break;
      let r = this.declareAttack(side, c.uid, { type: 'player' });
      if (r.awaitingAttackTrigger) r = this.resolveAttackTrigger([]);
      results.push({ attackerUid: c.uid, result: r });
    }
    return results;
  }

  // ---- マナ ----
  untappedMana(side) { return this.players[side].mana.filter((m) => !m.tapped); }

  chargeMana(side, handUid) {
    if (this.manaChargedThisTurn || this.phase !== 'main' || this.isGameOver()) return false;
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) return false;
    const [card] = ps.hand.splice(idx, 1);
    ps.mana.push({ uid: card.uid, cardId: card.cardId, tapped: false });
    this.manaChargedThisTurn = true;
    const def = getCard(card.cardId);
    this.logMsg(`${labelOf(side)}は${def.name}をマナゾーンに置いた。`);
    return true;
  }

  // 自分の場にいるコスト軽減オーラ(念仏エルフィン/ラブ・エルフィンなど)を考慮した実際の支払いコスト
  effectiveCost(side, def) {
    let cost = def.cost;
    let minCost = 0;
    for (const c of this.players[side].battle) {
      const d = this.cardOf(c);
      const red = keywordValue(d, 'costReduction');
      if (red && red.type === def.type) {
        cost -= red.amount;
        minCost = Math.max(minCost, red.minCost || 0);
      }
      // 特定種族のクリーチャーの召喚コストを下げる(第6弾: コッコ・ルピア=ドラゴン)
      const redRace = keywordValue(d, 'costReductionRace');
      if (redRace && def.type === 'creature' && def.race === redRace.race) {
        cost -= redRace.amount;
        minCost = Math.max(minCost, redRace.minCost || 0);
      }
    }
    // 特定文明のカードを出す/唱えるコストを増やす「税」(第4弾: 牢黒の伝道師ミリエス等)。
    // 誰の場にあっても両プレイヤーに等しく作用する(自分の場にあれば自分自身にも課税される)。
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        const tax = keywordValue(this.cardOf(c), 'taxCiv');
        if (tax && tax.civ === def.civ) cost += tax.amount;
      }
    }
    return Math.max(cost, minCost, 0);
  }

  // 文明はマナゾーンに存在してさえいればよく(タップ状態は問わない)、実際にタップする札とは
  // 無関係に判定する(デュエルマスタープレイスと同じ仕様)。数量さえ足りればどの札をタップしてもよい。
  canPayCost(side, def) {
    const cost = this.effectiveCost(side, def);
    const untapped = this.untappedMana(side);
    if (untapped.length < cost) return false;
    if (cost === 0) return true;
    return this.players[side].mana.some((m) => getCard(m.cardId).civ === def.civ);
  }

  payCost(side, def) {
    const cost = this.effectiveCost(side, def);
    const ps = this.players[side];
    const untapped = ps.mana.filter((m) => !m.tapped);
    for (let i = 0; i < cost && i < untapped.length; i++) untapped[i].tapped = true;
  }

  // 自分のマナゾーンからN枚、墓地に送る(コスト/CIPの一部) - どの札を送るかは自動選択
  sendOwnManaToGraveyard(side, n) {
    const ps = this.players[side];
    const civCounts = {};
    for (const m of ps.mana) { const c = getCard(m.cardId).civ; civCounts[c] = (civCounts[c] || 0) + 1; }
    const sorted = [...ps.mana].sort((a, b) => (civCounts[getCard(b.cardId).civ] || 0) - (civCounts[getCard(a.cardId).civ] || 0));
    const toSend = sorted.slice(0, Math.min(n, sorted.length));
    for (const m of toSend) {
      const idx = ps.mana.indexOf(m);
      if (idx !== -1) ps.mana.splice(idx, 1);
      ps.graveyard.push({ uid: m.uid, cardId: m.cardId });
    }
    if (toSend.length > 0) this.logMsg(`${labelOf(side)}はマナゾーンから${toSend.length}枚を墓地に置いた。`);
  }

  // 指定サイドの自分のクリーチャーの中で最もパワーが低いものを返す(自動選択が必要な効果で使用)
  pickWeakestOwnCreatureUid(side, excludeUid) {
    const pool = this.players[side].battle.filter((c) => c.uid !== excludeUid);
    if (pool.length === 0) return null;
    let best = pool[0];
    for (const c of pool) if (this.powerBase(side, c) < this.powerBase(side, best)) best = c;
    return best.uid;
  }

  // ---- 効果プリミティブ ----
  // 進化クリーチャーは進化元ごと束になって移動し、移動先でバラバラの個別カードに戻る
  bounceCreature(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [slot] = ps.battle.splice(idx, 1);
    for (const layer of slot.stack) ps.hand.push({ uid: layer.uid, cardId: layer.cardId });
    const suffix = slot.stack.length > 1 ? '(進化元ごと)' : '';
    this.logMsg(`${this.cardOf(slot).name}が手札に戻された。${suffix}`);
  }

  manaizeCreature(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [slot] = ps.battle.splice(idx, 1);
    for (const layer of slot.stack) ps.mana.push({ uid: layer.uid, cardId: layer.cardId, tapped: false });
    const suffix = slot.stack.length > 1 ? '(進化元ごと)' : '';
    this.logMsg(`${this.cardOf(slot).name}がマナゾーンに置かれた。${suffix}`);
  }

  tapCreature(ownerSide, uid) {
    const c = this.players[ownerSide].battle.find((x) => x.uid === uid);
    if (c) c.tapped = true;
  }

  ownerOfCreature(uid) {
    if (this.players.player.battle.some((c) => c.uid === uid)) return 'player';
    if (this.players.cpu.battle.some((c) => c.uid === uid)) return 'cpu';
    return null;
  }

  deckTopToMana(side, n = 1) {
    const ps = this.players[side];
    let moved = 0;
    for (let i = 0; i < n && ps.deck.length > 0; i++) {
      const c = ps.deck.pop();
      ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
      moved++;
    }
    if (moved > 0) this.logMsg(`${labelOf(side)}は山札の上から${moved}枚をマナゾーンに置いた。`);
  }

  handCardToMana(side, handUid) {
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) return;
    const [c] = ps.hand.splice(idx, 1);
    ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
    this.logMsg(`${labelOf(side)}は手札を1枚マナゾーンに置いた。`);
  }

  graveyardCreatureToHand(side, uid) {
    const ps = this.players[side];
    const idx = ps.graveyard.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.graveyard.splice(idx, 1);
    ps.hand.push(c);
    this.logMsg(`${labelOf(side)}は${this.cardOf(c).name}を墓地から手札に戻した。`);
  }

  graveyardCreatureToMana(side, uid) {
    const ps = this.players[side];
    const idx = ps.graveyard.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.graveyard.splice(idx, 1);
    ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
    this.logMsg(`${labelOf(side)}は${this.cardOf(c).name}を墓地からマナゾーンに置いた。`);
  }

  // マッドネス(第6弾): 相手のターン中に手札から自分の墓地に置かれるはずの時、かわりにバトルゾーンに出る
  sendHandCardToGraveyardOrMadness(side, cardObj) {
    const ps = this.players[side];
    const def = getCard(cardObj.cardId);
    if (def.type === 'creature' && hasKeyword(def, 'madness') && this.turnSide !== side) {
      const creature = makeCreatureInstance(cardObj.uid, cardObj.cardId);
      ps.battle.push(creature);
      this.onCreatureEnteredBattle(creature.uid);
      this.triggerSurvivorOnPlay(side, creature);
      this.logMsg(`${labelOf(side)}の${def.name}はマッドネスでバトルゾーンに出た!`);
      if (def.onPlay) {
        this._resolvingCipUid = creature.uid;
        if (def.onPlay.target) {
          const candidates = this.getTargetCandidates(side, def.onPlay.target) || [];
          const max = typeof def.onPlay.target.max === 'function' ? def.onPlay.target.max(this, side) : (def.onPlay.target.max ?? 1);
          this.resolveCardAbility(side, def, def.onPlay, candidates.slice(0, max));
        } else {
          this.resolveCardAbility(side, def, def.onPlay, []);
        }
        this._resolvingCipUid = null;
      }
      return;
    }
    ps.graveyard.push(cardObj);
  }

  discardRandomFromHand(side, n = 1) {
    const ps = this.players[side];
    let discarded = 0;
    for (let i = 0; i < n && ps.hand.length > 0; i++) {
      const idx = Math.floor(Math.random() * ps.hand.length);
      const [c] = ps.hand.splice(idx, 1);
      this.sendHandCardToGraveyardOrMadness(side, c);
      discarded++;
    }
    if (discarded > 0) this.logMsg(`${labelOf(side)}は手札を${discarded}枚(ランダムに選ばれて)捨てた。`);
  }

  // 相手(の視点で最も惜しくない)手札からN枚を捨てさせる(選ぶのは本来相手自身だが簡略化のためコストが最も低いものを自動選択)
  forceDiscardWorstN(side, n) {
    const ps = this.players[side];
    const count = Math.min(n, ps.hand.length);
    for (let i = 0; i < count; i++) {
      let worstIdx = 0;
      ps.hand.forEach((c, ci) => { if (getCard(c.cardId).cost < getCard(ps.hand[worstIdx].cardId).cost) worstIdx = ci; });
      const [c] = ps.hand.splice(worstIdx, 1);
      this.sendHandCardToGraveyardOrMadness(side, c);
    }
    if (count > 0) this.logMsg(`${labelOf(side)}は手札を${count}枚捨てた。`);
  }

  // 指定した側の手札から、選ばれた1枚を持ち主の墓地に置く(策略の手: 相手の手札を見て選ぶ効果に使用)
  handCardToGraveyard(side, uid) {
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.hand.splice(idx, 1);
    this.sendHandCardToGraveyardOrMadness(side, c);
    this.logMsg(`${labelOf(side)}は手札を1枚捨てさせられた。`);
  }

  discardAllHand(side) {
    const ps = this.players[side];
    const n = ps.hand.length;
    const hand = ps.hand;
    ps.hand = [];
    for (const c of hand) this.sendHandCardToGraveyardOrMadness(side, c);
    if (n > 0) this.logMsg(`${labelOf(side)}は手札をすべて(${n}枚)捨てた。`);
  }

  // 相手の手札を見て、条件に合うカードをすべて持ち主の墓地に置く(第6弾: レイン・アロー)
  discardAllMatchingFromHand(side, filterFn) {
    const ps = this.players[side];
    const matches = ps.hand.filter((c) => filterFn(getCard(c.cardId)));
    for (const c of matches) {
      const idx = ps.hand.indexOf(c);
      if (idx !== -1) ps.hand.splice(idx, 1);
      this.sendHandCardToGraveyardOrMadness(side, c);
    }
    if (matches.length > 0) this.logMsg(`${labelOf(side)}の手札から${matches.length}枚が墓地に置かれた。`);
  }

  // 山札を検索して1枚(条件を満たすもの)を手札に加え、シャッフルする
  tutorFromDeck(side, uid) {
    const ps = this.players[side];
    if (uid != null) {
      const idx = ps.deck.findIndex((c) => c.uid === uid);
      if (idx !== -1) {
        const [c] = ps.deck.splice(idx, 1);
        ps.hand.push(c);
        this.logMsg(`${labelOf(side)}は山札から${this.cardOf(c).name}を手札に加えた。`);
      }
    }
    ps.deck = shuffle(ps.deck);
  }

  // 山札から好きな枚数を選んで手札に加え、シャッフルする(第6弾: インビンシブル・テクノロジー)
  tutorMultiFromDeck(side, uids) {
    const ps = this.players[side];
    let taken = 0;
    for (const uid of uids) {
      const idx = ps.deck.findIndex((c) => c.uid === uid);
      if (idx !== -1) { const [c] = ps.deck.splice(idx, 1); ps.hand.push(c); taken++; }
    }
    ps.deck = shuffle(ps.deck);
    if (taken > 0) this.logMsg(`${labelOf(side)}は山札から${taken}枚を手札に加えた。`);
  }

  // 山札を検索して1枚を自分のマナゾーンに置き、シャッフルする
  tutorToMana(side, uid) {
    const ps = this.players[side];
    if (uid != null) {
      const idx = ps.deck.findIndex((c) => c.uid === uid);
      if (idx !== -1) {
        const [c] = ps.deck.splice(idx, 1);
        ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
        this.logMsg(`${labelOf(side)}は山札から${this.cardOf(c).name}をマナゾーンに置いた。`);
      }
    }
    ps.deck = shuffle(ps.deck);
  }

  // 相手のマナゾーンのカードを1枚、持ち主の墓地に置く
  manaCardToGraveyard(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.mana.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    // 相手の効果でマナが墓地に置かれる代わりにマナゾーンにとどめる守護効果(第5弾: 神魂の守護者シュノーク・ラー)
    if (this.players[ownerSide].battle.some((c) => hasKeyword(this.cardOf(c), 'manaGraveyardProtection'))) {
      this.logMsg(`${this.cardOf(ps.mana[idx]).name}は守護の効果でマナゾーンにとどまった。`);
      return;
    }
    const [c] = ps.mana.splice(idx, 1);
    ps.graveyard.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${this.cardOf(c).name}がマナゾーンから墓地に置かれた。`);
  }

  // 各プレイヤーが自分のマナゾーンからN枚を自分の墓地に置く(技師ピーポ/ボマーザウルス等)
  eachPlayerManaToGraveyard(n) {
    for (const side of ['player', 'cpu']) this.sendOwnManaToGraveyard(side, n);
  }

  // 自分のシールドを1枚(内容を見ずに)墓地に置く(魔将ダーク・フリード)
  millOwnShieldRandom(side) {
    const ps = this.players[side];
    if (ps.shields.length === 0) return;
    const idx = Math.floor(Math.random() * ps.shields.length);
    const [c] = ps.shields.splice(idx, 1);
    ps.graveyard.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${labelOf(side)}は自分のシールドを1枚墓地に置いた。`);
  }

  // 相手のクリーチャーを、持ち主の山札の一番上に置く(コーライル)
  creatureToDeckTop(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [slot] = ps.battle.splice(idx, 1);
    for (const layer of slot.stack) ps.deck.push({ uid: layer.uid, cardId: layer.cardId });
    this.logMsg(`${this.cardOf(slot).name}が山札の一番上に置かれた。`);
  }

  // 相手のシールドをのぞき見る(情報効果のみ・状態は変化しない)。相手の手の内は人間プレイヤー側が覗いた時だけログに出す。
  peekOpponentShields(side, maxCount) {
    const opp = this.opponent(side);
    const seen = this.players[opp].shields.slice(0, maxCount);
    if (side === 'player') {
      const names = seen.map((s) => getCard(s.cardId).name).join('、');
      this.logMsg(`あなたは相手のシールドを見た: ${names || 'なし'}`);
    } else {
      this.logMsg(`${labelOf(side)}は相手のシールドを確認した。`);
    }
  }

  // 自分自身のシールドをすべて見る(第6弾: 宣凶師エルリオット)。中身は変わらず元の位置のまま
  peekOwnShields(side) {
    if (side === 'player') {
      const names = this.players.player.shields.map((s) => getCard(s.cardId).name).join('、');
      this.logMsg(`あなたは自分のシールドを見た: ${names || 'なし'}`);
    } else {
      this.logMsg(`${labelOf(side)}は自分のシールドを確認した。`);
    }
  }

  symmetricDestroyByPower(maxPower) {
    for (const side of ['player', 'cpu']) {
      const ps = this.players[side];
      const toDestroy = ps.battle.filter((c) => this.powerBase(side, c) <= maxPower).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(side, uid);
    }
  }

  // 相手側だけ、パワーX以下のクリーチャーを全て破壊する(灼熱波)
  destroyByPowerOneSide(side, maxPower) {
    const toDestroy = this.players[side].battle.filter((c) => this.powerBase(side, c) <= maxPower).map((c) => c.uid);
    for (const uid of toDestroy) this.destroyCreature(side, uid);
  }

  // 両プレイヤーの、指定文明ではないクリーチャーをすべて破壊する(第4弾: 悪魔神バロム)
  destroyAllCreaturesExceptCiv(civ) {
    for (const s of ['player', 'cpu']) {
      const toDestroy = this.players[s].battle.filter((c) => this.cardOf(c).civ !== civ).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(s, uid);
    }
  }

  // 両プレイヤーの、指定文明かつパワーX以下のクリーチャーをすべて破壊する(第4弾: ガルクライフ・ドラゴン)
  destroyByCivAndPowerBothSides(civ, maxPower) {
    for (const s of ['player', 'cpu']) {
      const toDestroy = this.players[s].battle.filter((c) => this.cardOf(c).civ === civ && this.powerBase(s, c) <= maxPower).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(s, uid);
    }
  }

  // 両プレイヤーの、パワーがちょうど指定値のクリーチャーをすべて破壊する(第4弾: マグマティラノス)
  destroyByExactPowerBothSides(exactPower) {
    for (const s of ['player', 'cpu']) {
      const toDestroy = this.players[s].battle.filter((c) => this.powerBase(s, c) === exactPower).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(s, uid);
    }
  }

  // 両プレイヤーの、パワーX以下のクリーチャーをすべて破壊する(文明を問わない版)(第5弾: 冥将ダムド)
  destroyByPowerBothSides(maxPower) {
    for (const s of ['player', 'cpu']) {
      const toDestroy = this.players[s].battle.filter((c) => this.powerBase(s, c) <= maxPower).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(s, uid);
    }
  }

  // このクリーチャー以外の、バトルゾーンにある全クリーチャー(両プレイヤー)を持ち主の手札に戻す(第5弾: キング・アトランティス)
  bounceAllOtherCreatures(excludeUid) {
    for (const s of ['player', 'cpu']) {
      const uids = this.players[s].battle.filter((c) => c.uid !== excludeUid).map((c) => c.uid);
      for (const uid of uids) this.bounceCreature(s, uid);
    }
  }

  // 自分の他のクリーチャーをすべて自分の墓地に置く(第5弾: 殺戮の羅刹デス・クルーザー)
  destroyAllOtherOwnCreatures(side, excludeUid) {
    const uids = this.players[side].battle.filter((c) => c.uid !== excludeUid).map((c) => c.uid);
    for (const uid of uids) this.destroyCreature(side, uid);
  }

  // 自分のマナゾーンから、指定したカードIDと同名のカードを1枚選び、バトルゾーンに直接置く(第5弾: オブシディアン・ビートル/アンブッシュ・スコーピオン)
  recurFromManaByName(side, cardId) {
    const ps = this.players[side];
    const idx = ps.mana.findIndex((m) => m.cardId === cardId);
    if (idx === -1) return;
    const [c] = ps.mana.splice(idx, 1);
    const creature = makeCreatureInstance(c.uid, c.cardId);
    ps.battle.push(creature);
    this.onCreatureEnteredBattle(creature.uid);
    this.logMsg(`${labelOf(side)}はマナゾーンから${this.cardOf(creature).name}をバトルゾーンに置いた。`);
  }

  // 両プレイヤーが自分自身のマナゾーンのカードをすべて手札に戻す(第5弾: 神々の逆流)
  allManaToHandBothPlayers() {
    for (const s of ['player', 'cpu']) {
      const ps = this.players[s];
      const n = ps.mana.length;
      for (const m of ps.mana) ps.hand.push({ uid: m.uid, cardId: m.cardId });
      ps.mana = [];
      if (n > 0) this.logMsg(`${labelOf(s)}はマナゾーンのカードをすべて(${n}枚)手札に戻した。`);
    }
  }

  // 指定した側の手札をすべて山札に戻してシャッフルし、同じ枚数を引き直す
  shuffleHandBackAndRedraw(side) {
    const ps = this.players[side];
    const n = ps.hand.length;
    ps.deck.push(...ps.hand);
    ps.hand = [];
    ps.deck = shuffle(ps.deck);
    this.drawCardsSafe(side, n);
  }

  // 山札からフィルタ条件に合うカードを最大n枚(コスト降順で自動選択)手札に加え、シャッフルする
  // (本来は公開しながら任意に選べるが、複数選択UIの制約のため自動選択に簡略化する。第5弾: ビースト・チャージ)
  autoTutorMultiFromDeck(side, n, filter) {
    const ps = this.players[side];
    const candidates = ps.deck.filter((c) => filter(this, side, c)).sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
    const chosen = candidates.slice(0, n);
    for (const c of chosen) {
      const idx = ps.deck.findIndex((d) => d.uid === c.uid);
      if (idx !== -1) { const [taken] = ps.deck.splice(idx, 1); ps.hand.push(taken); }
    }
    ps.deck = shuffle(ps.deck);
    if (chosen.length > 0) this.logMsg(`${labelOf(side)}は山札から${chosen.length}枚を手札に加えた。`);
  }

  // 両プレイヤーの、指定文明以外のクリーチャーをすべてタップする(第4弾: エンジェル・ソング)
  massTapExceptCiv(civ) {
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        if (this.cardOf(c).civ !== civ) c.tapped = true;
      }
    }
  }

  // 相手のマナゾーンのカードを1枚、持ち主の手札に戻す
  manaCardToHand(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.mana.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.mana.splice(idx, 1);
    ps.hand.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${this.cardOf(c).name}がマナゾーンから手札に戻された。`);
  }

  // 自分のマナゾーンのカードを1枚、裏向きの新しいシールドにする
  manaCardToShield(side, uid) {
    const ps = this.players[side];
    const idx = ps.mana.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.mana.splice(idx, 1);
    ps.shields.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${labelOf(side)}はマナゾーンのカードを裏向きのシールドにした。`);
  }

  // 自分の手札のカードを1枚、裏向きの新しいシールドにする
  handCardToShield(side, uid) {
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.hand.splice(idx, 1);
    ps.shields.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${labelOf(side)}は手札を1枚、裏向きのシールドにした。`);
  }

  // 自分のシールドを1枚(内容を見ずに)手札に加える。S・トリガーとしては使えない(通常のシールドブレイクを経由しないため)
  randomOwnShieldToHand(side) {
    const ps = this.players[side];
    if (ps.shields.length === 0) return;
    const idx = Math.floor(Math.random() * ps.shields.length);
    const [c] = ps.shields.splice(idx, 1);
    ps.hand.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${labelOf(side)}は自分のシールドを1枚(見ずに)手札に加えた。`);
  }

  // 自分のシールドを指定枚数、自分のマナゾーンに置く(逆転のオーロラ)
  shieldsToMana(side, count) {
    const ps = this.players[side];
    const n = Math.min(count, ps.shields.length);
    for (let i = 0; i < n; i++) {
      const c = ps.shields.pop();
      ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
    }
    if (n > 0) this.logMsg(`${labelOf(side)}はシールドを${n}枚マナゾーンに置いた。`);
  }

  // 自分のシールドを全て(トリガーを解決せずに)手札に加える(デビル・ドレーン)
  allShieldsToHand(side) {
    const ps = this.players[side];
    const n = ps.shields.length;
    ps.hand.push(...ps.shields);
    ps.shields = [];
    if (n > 0) this.logMsg(`${labelOf(side)}はシールドをすべて(${n}枚)手札に加えた。(S・トリガーとしては使えない)`);
  }

  // 山札の上からN枚を公開し、指定文明のカードを手札に、それ以外を墓地に置く
  revealTopTakeCiv(side, n, civ) {
    const ps = this.players[side];
    let taken = 0, discarded = 0;
    for (let i = 0; i < n && ps.deck.length > 0; i++) {
      const c = ps.deck.pop();
      if (getCard(c.cardId).civ === civ) { ps.hand.push(c); taken++; }
      else { ps.graveyard.push(c); discarded++; }
    }
    this.logMsg(`${labelOf(side)}は山札の上から${taken + discarded}枚を公開し、${taken}枚を手札に加えた。`);
  }

  // 山札の上からN枚を公開し、指定した複数文明のカードすべてを手札に、それ以外を墓地に置く(第4弾: アクアン)
  revealTopTakeCivs(side, n, civs) {
    const ps = this.players[side];
    let taken = 0, discarded = 0;
    for (let i = 0; i < n && ps.deck.length > 0; i++) {
      const c = ps.deck.pop();
      if (civs.includes(getCard(c.cardId).civ)) { ps.hand.push(c); taken++; }
      else { ps.graveyard.push(c); discarded++; }
    }
    this.logMsg(`${labelOf(side)}は山札の上から${taken + discarded}枚を公開し、${taken}枚を手札に加えた。`);
  }

  // 山札の上からN枚を、公開せず裏向きのまま自分のシールドに加える(第4弾: ミステリー・ブレス)
  deckTopToShield(side, n) {
    const ps = this.players[side];
    let moved = 0;
    for (let i = 0; i < n && ps.deck.length > 0; i++) {
      const c = ps.deck.pop();
      ps.shields.push({ uid: c.uid, cardId: c.cardId });
      moved++;
    }
    if (moved > 0) this.logMsg(`${labelOf(side)}は山札の上から${moved}枚を裏向きのままシールドに加えた。`);
  }

  // このターン、自分のクリーチャーすべてに常時(攻撃中に限らない)パワーボーナスを与える(第4弾: ブレス・ソード)
  teamStaticBuff(side, amount) {
    for (const c of this.players[side].battle) c.tempStaticPowerBonus = (c.tempStaticPowerBonus || 0) + amount;
  }

  // このターン、自分のクリーチャーすべてに「ブロッカー」を与える(第4弾: フル・ディフェンサー)
  // 本来は「自分の次のターンが始まるまで」だが、S・トリガーで使われる典型的なタイミング(相手ターン中)では
  // ターン終了時のクリアと実質的に一致するため、他の一時効果と同様「このターンの終わりまで」として簡略化する
  grantTeamBlockerThisTurn(side) {
    for (const c of this.players[side].battle) c.tempBlockerGrant = true;
  }

  // 相手のマナゾーンから高コストのカードを1枚、持ち主の手札に戻す(自動選択)。ハイドロ・ハリケーンの水クリーチャー分の効果で使用。
  bounceHighestCostEnemyMana(side) {
    const opp = this.opponent(side);
    const pool = this.players[opp].mana;
    if (pool.length === 0) return;
    let best = pool[0];
    for (const m of pool) if (getCard(m.cardId).cost > getCard(best.cardId).cost) best = m;
    this.manaCardToHand(opp, best.uid);
  }

  // 相手のバトルゾーンから最もパワーの高いクリーチャーを1体、持ち主の手札に戻す(自動選択)。ハイドロ・ハリケーンの闇クリーチャー分の効果で使用。
  bounceStrongestEnemyCreature(side) {
    const opp = this.opponent(side);
    const pool = this.players[opp].battle;
    if (pool.length === 0) return;
    let best = pool[0];
    for (const c of pool) if (this.powerBase(opp, c) > this.powerBase(opp, best)) best = c;
    this.bounceCreature(opp, best.uid);
  }

  // 自分の光/闇のクリーチャーの数に応じて、相手のマナ/クリーチャーをそれぞれバウンスする(第4弾: ハイドロ・ハリケーン)
  // 本来はカードごとに個別に「してもよい」選択だが、簡略化のため常に最も価値の高いものを自動選択してバウンスする
  hydroHurricaneEffect(side) {
    const lightCount = this.players[side].battle.filter((c) => this.cardOf(c).civ === 'light').length;
    const darkCount = this.players[side].battle.filter((c) => this.cardOf(c).civ === 'dark').length;
    for (let i = 0; i < lightCount; i++) this.bounceHighestCostEnemyMana(side);
    for (let i = 0; i < darkCount; i++) this.bounceStrongestEnemyCreature(side);
  }

  // 各プレイヤーが自分のマナゾーンからN枚を自分の手札に戻す(選び方はどれでも等価なので自動選択)
  eachPlayerManaToHand(n) {
    for (const side of ['player', 'cpu']) {
      const ps = this.players[side];
      const n2 = Math.min(n, ps.mana.length);
      for (let i = 0; i < n2; i++) {
        const c = ps.mana.pop();
        ps.hand.push({ uid: c.uid, cardId: c.cardId });
      }
      if (n2 > 0) this.logMsg(`${labelOf(side)}はマナゾーンから${n2}枚を手札に戻した。`);
    }
  }

  // 各プレイヤーが自分のマナゾーンから、指定文明以外のカードをN枚選び、自分の墓地に置く
  eachPlayerManaToGraveyardExcluding(civ, n) {
    for (const side of ['player', 'cpu']) {
      const ps = this.players[side];
      const candidates = ps.mana.filter((m) => getCard(m.cardId).civ !== civ);
      const toSend = candidates.slice(0, Math.min(n, candidates.length));
      for (const m of toSend) {
        const idx = ps.mana.indexOf(m);
        if (idx !== -1) ps.mana.splice(idx, 1);
        ps.graveyard.push({ uid: m.uid, cardId: m.cardId });
      }
      if (toSend.length > 0) this.logMsg(`${labelOf(side)}はマナゾーンから${toSend.length}枚を墓地に置いた。`);
    }
  }

  // 進化クリーチャーの一番上のカードだけを剥がして持ち主の墓地に置く(シェル・ポーチ)。破壊ではないので各種「破壊時」効果は発生しない。
  peelTopOfEvolution(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const slot = ps.battle.find((c) => c.uid === uid);
    if (!slot || !slot.stack || slot.stack.length < 2) return;
    const removed = slot.stack.pop();
    ps.graveyard.push({ uid: removed.uid, cardId: removed.cardId });
    this.logMsg(`${getCard(removed.cardId).name}が進化元を残して墓地に置かれた。`);
  }

  // 進化クリーチャーの一番上のカードだけを剥がして持ち主のマナゾーンに置く(第6弾: 大自然の意志)
  peelTopOfEvolutionToMana(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const slot = ps.battle.find((c) => c.uid === uid);
    if (!slot || !slot.stack || slot.stack.length < 2) return;
    const removed = slot.stack.pop();
    ps.mana.push({ uid: removed.uid, cardId: removed.cardId, tapped: false });
    this.logMsg(`${getCard(removed.cardId).name}が進化元を残してマナゾーンに置かれた。`);
  }

  // 相手のシールドを裏向きのまま最大n枚選び、公開せずそのまま持ち主の墓地に置く(第6弾: インビンシブル・フォートレス)
  burnOpponentShields(side, n) {
    const opp = this.opponent(side);
    const ps = this.players[opp];
    const count = Math.min(n, ps.shields.length);
    for (let i = 0; i < count; i++) {
      const shield = ps.shields.pop();
      ps.graveyard.push(shield);
    }
    if (count > 0) this.logMsg(`${labelOf(opp)}のシールドが${count}枚焼却された。`);
  }

  // バトルゾーンにある、ブロッカーを持たないクリーチャーをすべてタップする(第6弾: ジャスティス・バインド)
  tapAllNonBlockers() {
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        if (!this.isBlockerNow(s, c)) c.tapped = true;
      }
    }
  }

  // 相手はバトルゾーンかマナゾーンから自分自身のカードを1枚選び、持ち主の墓地に置く(第6弾: クライシス・ボーラー)。
  // 本来は相手の任意選択だが、簡略化のため最も安価な方(クリーチャーはコスト、マナは文明内訳を考慮せず単純比較)を自動選択する
  opponentForcedDestroyCreatureOrMana(side) {
    const opp = this.opponent(side);
    const ps = this.players[opp];
    const weakestCreatureUid = this.pickWeakestOwnCreatureUid(opp);
    const weakestCreature = weakestCreatureUid != null ? ps.battle.find((c) => c.uid === weakestCreatureUid) : null;
    let weakestMana = null;
    for (const m of ps.mana) { if (!weakestMana || getCard(m.cardId).cost < getCard(weakestMana.cardId).cost) weakestMana = m; }
    if (!weakestCreature && !weakestMana) return;
    if (weakestCreature && (!weakestMana || this.cardOf(weakestCreature).cost <= getCard(weakestMana.cardId).cost)) {
      this.destroyCreature(opp, weakestCreature.uid);
    } else if (weakestMana) {
      this.manaCardToGraveyard(opp, weakestMana.uid);
    }
  }

  // 相手の山札をすべて見て、選んだカードを持ち主の墓地に置き、その後シャッフルする(第6弾: ヘル・スラッシュ)
  millChosenFromDeck(side, uids) {
    const opp = this.opponent(side);
    const ps = this.players[opp];
    let milled = 0;
    for (const uid of uids) {
      const idx = ps.deck.findIndex((c) => c.uid === uid);
      if (idx !== -1) { const [c] = ps.deck.splice(idx, 1); ps.graveyard.push(c); milled++; }
    }
    ps.deck = shuffle(ps.deck);
    if (milled > 0) this.logMsg(`${labelOf(opp)}の山札から${milled}枚が墓地に置かれた。`);
  }

  // 相手の手札とシールドをのぞき見る(情報効果のみ)。人間プレイヤー側が見た時だけログに内容を出す。
  peekOpponentHandAndShields(side) {
    const opp = this.opponent(side);
    if (side === 'player') {
      const handNames = this.players[opp].hand.map((c) => getCard(c.cardId).name).join('、');
      const shieldNames = this.players[opp].shields.map((c) => getCard(c.cardId).name).join('、');
      this.logMsg(`あなたは相手の手札を見た: ${handNames || 'なし'}`);
      this.logMsg(`あなたは相手のシールドを見た: ${shieldNames || 'なし'}`);
    } else {
      this.logMsg(`${labelOf(side)}は相手の手札とシールドを確認した。`);
    }
  }

  grantUnblockable(side, uid) {
    const c = this.players[side].battle.find((x) => x.uid === uid);
    if (c) c.tempUnblockable = true;
  }

  grantIgnoreTapRequirement(side, uid) {
    const c = this.players[side].battle.find((x) => x.uid === uid);
    if (c) c.tempIgnoreTapRequirement = true;
  }

  grantAttackBuff(side, uid, amount, alsoDoubleBreaker) {
    const c = this.players[side].battle.find((x) => x.uid === uid);
    if (!c) return;
    c.tempPowerAttackerBonus = (c.tempPowerAttackerBonus || 0) + amount;
    if (alsoDoubleBreaker) c.tempDoubleBreaker = true;
  }

  teamAttackBuff(side, amount) {
    for (const c of this.players[side].battle) c.tempPowerAttackerBonus = (c.tempPowerAttackerBonus || 0) + amount;
  }

  teamGrantDoubleBreaker(side) {
    for (const c of this.players[side].battle) c.tempDoubleBreaker = true;
  }

  teamGrantTripleBreaker(side) {
    for (const c of this.players[side].battle) c.tempTripleBreaker = true;
  }

  // 指定文明以外の呪文をすべて封じるロックがバトルゾーンに存在するか(第4弾: 聖霊王アルカディアス)。
  // 「すべてのプレイヤーは」という記述のため、封じたクリーチャーの持ち主自身にも及ぶ。
  isSpellCastLocked(def) {
    if (def.type !== 'spell') return false;
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        const civ = keywordValue(this.cardOf(c), 'lockNonCivSpells');
        if (civ && def.civ !== civ) return true;
      }
    }
    return false;
  }

  // 指定文明のカードのS・トリガーがすべて封じられているか(第4弾: 暴風の求道者フ・レイル/ギガボルバ)
  isShieldTriggerLocked(civ) {
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        if (keywordValue(this.cardOf(c), 'lockShieldTriggerCiv') === civ) return true;
      }
    }
    return false;
  }

  // クリーチャーがバトルゾーンに出た(進化・召喚・S・トリガー召喚を問わず)ときに、他のクリーチャーが持つ
  // 「他のクリーチャーが出た時ドローしてよい」系の常時能力を発火させる(第4弾: 雷鳴の守護者ミスト・リエス)
  onCreatureEnteredBattle(enteringUid) {
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        if (c.uid === enteringUid) continue;
        if (hasKeyword(this.cardOf(c), 'drawOnAnyCreatureEtb')) this.drawCardsSafe(s, 1);
      }
    }
  }

  // ---- ターゲット候補取得 ----
  // kind: 'enemyCreature' | 'anyCreature' | 'ownCreature' | 'ownGraveyardCreature' | 'deckTutor'
  getTargetCandidates(side, spec) {
    if (!spec) return null;
    const opp = this.opponent(side);
    // シールド枚数のような「カードではなく数量を選ぶ」疑似ターゲット。候補は0〜現在のシールド枚数の整数。
    if (spec.kind === 'shieldQuantity') {
      const max = this.players[side].shields.length;
      return Array.from({ length: max + 1 }, (_, i) => i);
    }
    const filter = spec.filter || (() => true);
    let pool = [];
    if (spec.kind === 'enemyCreature') pool = this.players[opp].battle;
    else if (spec.kind === 'ownCreature') pool = this.players[side].battle;
    else if (spec.kind === 'anyCreature') pool = [...this.players[side].battle, ...this.players[opp].battle];
    else if (spec.kind === 'ownGraveyardCreature') pool = this.players[side].graveyard.filter((c) => this.cardOf(c).type === 'creature');
    else if (spec.kind === 'ownGraveyardCard') pool = this.players[side].graveyard;
    else if (spec.kind === 'deckTutor') pool = this.players[side].deck;
    else if (spec.kind === 'ownHandCard') pool = this.players[side].hand;
    else if (spec.kind === 'enemyHandCard') pool = this.players[opp].hand;
    else if (spec.kind === 'enemyManaCard') pool = this.players[opp].mana;
    else if (spec.kind === 'ownManaCard') pool = this.players[side].mana;
    else if (spec.kind === 'enemyDeckCard') pool = this.players[opp].deck;
    return pool.filter((c) => filter(this, side, c)).map((c) => c.uid);
  }

  // 相手が召喚/呪文詠唱したとき、自分の「相手の行動時ブロッカーを得る」持ちにこのターン限りブロッカーを付与する(第6弾)
  triggerBlockerOnOpponentAction(actingSide) {
    const opp = this.opponent(actingSide);
    for (const c of this.players[opp].battle) {
      if (hasKeyword(this.cardOf(c), 'blockerOnOpponentAction')) c.tempBlockerGrant = true;
    }
  }

  // ---- カードプレイ ----
  playCard(side, handUid, opts = {}) {
    if (this.phase !== 'main' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) return { ok: false };
    const inst = ps.hand[idx];
    const def = getCard(inst.cardId);
    if (!this.canPayCost(side, def)) return { ok: false };
    if (this.isSpellCastLocked(def)) return { ok: false };
    // 呪文を唱えたターンのみ召喚できる(第6弾: 綺羅星の精霊ガリアル等)
    if (def.type === 'creature' && hasKeyword(def, 'requiresSpellCastThisTurn') && !this.turnFlags[side]?.spellCastThisTurn) return { ok: false };
    ps.hand.splice(idx, 1);
    this.payCost(side, def);
    if (def.type === 'creature') {
      const creature = makeCreatureInstance(inst.uid, inst.cardId);
      ps.battle.push(creature);
      // スピードアタッカー(第5弾): 召喚酔いしない。サバイバーの長からの付与にも対応(第6弾: スフィンティラノスβ)
      if (this.hasEffectiveKeyword(side, creature, 'speedAttacker')) creature.sickness = false;
      this.onCreatureEnteredBattle(creature.uid);
      this.triggerSurvivorOnPlay(side, creature);
      this.triggerBlockerOnOpponentAction(side);
      this.logMsg(`${labelOf(side)}は${def.name}を召喚した。`);
      if (def.onPlay) {
        // CIP(出た時)能力は「先にバトルゾーンへ出てから対象を選ぶ」実タイミングを再現するため、
        // 対象が必要な場合はここでは解決せず pendingCip に積んで呼び出し側に対象選択を委ねる。
        if (def.onPlay.target) {
          this.pendingCip = { side, casterUid: creature.uid, def, ability: def.onPlay };
          return { ok: true, awaitingCipTarget: true };
        }
        this._resolvingCipUid = creature.uid;
        this.resolveCardAbility(side, def, def.onPlay, []);
        this._resolvingCipUid = null;
      }
    } else {
      this.turnFlags[side] = this.turnFlags[side] || {};
      this.turnFlags[side].spellCastThisTurn = true;
      this.triggerBlockerOnOpponentAction(side);
      this.logMsg(`${labelOf(side)}は${def.name}を唱えた。`);
      if (def.spell) this.resolveCardAbility(side, def, def.spell, opts.targetUids || (opts.targetUid != null ? [opts.targetUid] : []));
      if (hasKeyword(def, 'castGoesToMana')) ps.mana.push({ uid: inst.uid, cardId: inst.cardId, tapped: false });
      else ps.graveyard.push(inst);
    }
    this.checkStateBasedLoss();
    return { ok: true };
  }

  // ---- 進化 ----
  // defの進化条件を満たす、自分のバトルゾーンのスタック(uid)一覧を返す
  getEvolutionTargets(side, def) {
    const req = def.evolution;
    if (!req) return [];
    return this.players[side].battle.filter((slot) => {
      const topDef = this.cardOf(slot);
      // 種族を問わずどんな進化クリーチャーでも上に置ける汎用進化元(第6弾: 無垢の宝剣)
      if (hasKeyword(topDef, 'universalEvolutionBase')) return true;
      if (req.fromRaces) return req.fromRaces.includes(topDef.race);
      if (req.fromCivilization) {
        return Array.isArray(topDef.civ) ? topDef.civ.includes(req.fromCivilization) : topDef.civ === req.fromCivilization;
      }
      return false;
    }).map((slot) => slot.uid);
  }

  // 進化クリーチャーを手札から出し、既存のクリーチャーの上に重ねる。召喚酔いは受けない。
  playEvolutionCard(side, handUid, targetSlotUid) {
    if (this.phase !== 'main' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const idx = ps.hand.findIndex((c) => c.uid === handUid);
    if (idx === -1) return { ok: false };
    const inst = ps.hand[idx];
    const def = getCard(inst.cardId);
    if (!def.evolution || !this.canPayCost(side, def)) return { ok: false };
    const validTargets = this.getEvolutionTargets(side, def);
    if (!validTargets.includes(targetSlotUid)) return { ok: false };
    const slot = ps.battle.find((s) => s.uid === targetSlotUid);
    if (!slot) return { ok: false };
    ps.hand.splice(idx, 1);
    this.payCost(side, def);
    slot.stack.push({ uid: inst.uid, cardId: inst.cardId });
    slot.sickness = false;
    // 進化クリーチャーがタップされた状態でバトルゾーンに出る効果(第6弾: 銀界の守護者ル・ギラ・レシール、両陣営どちらにあっても作用)
    if (['player', 'cpu'].some((s) => this.players[s].battle.some((c) => hasKeyword(this.cardOf(c), 'evolutionEntersTapped')))) {
      slot.tapped = true;
    }
    this.onCreatureEnteredBattle(slot.uid);
    this.triggerSurvivorOnPlay(side, slot);
    this.logMsg(`${labelOf(side)}は${def.name}に進化させた。`);
    if (def.onPlay) {
      if (def.onPlay.target) {
        this.pendingCip = { side, casterUid: slot.uid, def, ability: def.onPlay };
        return { ok: true, awaitingCipTarget: true };
      }
      this._resolvingCipUid = slot.uid;
      this.resolveCardAbility(side, def, def.onPlay, []);
      this._resolvingCipUid = null;
    }
    this.checkStateBasedLoss();
    return { ok: true };
  }

  // pendingCipの対象候補を取得(自分自身を除外できるよう pendingCip.casterUid をフィルタから参照可能)
  getPendingCipCandidates() {
    if (!this.pendingCip) return null;
    return this.getTargetCandidates(this.pendingCip.side, this.pendingCip.ability.target);
  }

  resolveCip(targetUids) {
    if (!this.pendingCip) return { ok: false };
    const { side, def, ability } = this.pendingCip;
    // resolve中もpendingCip.casterUidを各カードのresolve()から参照できるよう、解決後に消す
    this.resolveCardAbility(side, def, ability, targetUids || []);
    this.pendingCip = null;
    this.checkStateBasedLoss();
    return { ok: true };
  }

  resolveCardAbility(side, def, ability, targetUids) {
    try {
      ability.resolve(this, side, targetUids || []);
    } catch (e) {
      this.logMsg(`(効果解決でエラーが発生しました: ${def.name})`);
    }
  }

  // サバイバー(第5弾): 自分の他のサバイバーの長が持つ「攻撃時」能力(対象を取らないもの限定)を、
  // このクリーチャーが攻撃するたびにも発火させる(戦空の伝道士バルスβ系とは別の、攻撃トリガー共有パターン)
  triggerSurvivorOnAttack(side, atkInst) {
    const atkDef = this.cardOf(atkInst);
    if (!(atkDef.race || '').includes('サバイバー')) return;
    for (const other of this.players[side].battle) {
      if (other === atkInst) continue;
      const otherDef = this.cardOf(other);
      if ((otherDef.race || '').includes('サバイバー') && otherDef.onAttack && !otherDef.onAttack.target
        && keywordValue(otherDef, 'survivorGrants') === 'onAttack') {
        this.resolveCardAbility(side, otherDef, otherDef.onAttack, []);
      }
    }
  }

  // 自分の場に、指定種族すべてにスレイヤーを与える常時能力持ちがいるか(第6弾: 恐慌の魔黒デス・スペクター、自分自身も対象に含む)
  hasRaceGrantedSlayer(side, inst) {
    const def = this.cardOf(inst);
    return this.players[side].battle.some((c) => keywordValue(this.cardOf(c), 'auraGrantSlayerToOwnRace') === def.race);
  }

  // サバイバー(第6弾): 自分の他のサバイバーの長が持つ「出た時」能力を、このクリーチャーが出た時にも発火させる。
  // 対象選択が必要な能力は、簡略化のため候補の先頭から必要数を自動選択する
  triggerSurvivorOnPlay(side, enteringInst) {
    const enteringDef = this.cardOf(enteringInst);
    if (!(enteringDef.race || '').includes('サバイバー')) return;
    for (const other of this.players[side].battle) {
      if (other === enteringInst) continue;
      const otherDef = this.cardOf(other);
      if (!(otherDef.race || '').includes('サバイバー') || !otherDef.onPlay || keywordValue(otherDef, 'survivorGrants') !== 'onPlay') continue;
      if (otherDef.onPlay.target) {
        const candidates = this.getTargetCandidates(side, otherDef.onPlay.target) || [];
        const max = typeof otherDef.onPlay.target.max === 'function' ? otherDef.onPlay.target.max(this, side) : (otherDef.onPlay.target.max ?? 1);
        this.resolveCardAbility(side, otherDef, otherDef.onPlay, candidates.slice(0, max));
      } else {
        this.resolveCardAbility(side, otherDef, otherDef.onPlay, []);
      }
    }
  }

  // ---- 攻撃フェーズ ----
  enterAttackPhase() {
    if (this.phase === 'main') this.phase = 'attack';
  }

  canAttackAtAll(side, inst) {
    if (this.turnFlags[side]?.ignoreAttackRestrictions) return true;
    const def = this.cardOf(inst);
    if (hasKeyword(def, 'cannotAttack')) return false;
    if (hasKeyword(def, 'cannotAttackIfOutnumbered')) {
      const opp = this.opponent(side);
      if (this.players[opp].battle.length > this.players[side].battle.length) return false;
    }
    // 相手のシールドが0枚の間は攻撃できない(第5弾: 剣舞の修羅ヴァシュナ/ギガゾウル)
    if (hasKeyword(def, 'cannotAttackIfEnemyShieldless') && this.players[this.opponent(side)].shields.length === 0) return false;
    // 自分の他のクリーチャーを1体生け贄にしなければ攻撃できない(第6弾: 憤怒の猛将ダイダロス)。他に生け贄がいなければ攻撃自体が不可
    if (hasKeyword(def, 'mustSacrificeToAttack') && this.players[side].battle.filter((c) => c !== inst).length === 0) return false;
    // 自分の他のクリーチャーにアンタップ状態のものが1体でもあれば攻撃できない(第6弾: 神秘の超人)
    if (hasKeyword(def, 'cannotAttackIfOtherUntapped') && this.players[side].battle.some((c) => c !== inst && !c.tapped)) return false;
    return true;
  }

  // このサイドの攻撃時に、相手の「求心」的な種族強制ターゲットが存在すればそのuid一覧を返す(第6弾: 戦いの化身)
  getForcedAttackTargets(side) {
    const opp = this.opponent(side);
    const races = new Set();
    for (const c of this.players[opp].battle) {
      const race = keywordValue(this.cardOf(c), 'forcesAttacksAgainstRace');
      if (race) races.add(race);
    }
    if (races.size === 0) return null;
    const eligible = this.players[opp].battle.filter((c) => races.has(this.cardOf(c).race));
    return eligible.length > 0 ? eligible.map((c) => c.uid) : null;
  }

  eligibleAttackers(side) {
    const ignore = this.turnFlags[side]?.ignoreAttackRestrictions;
    return this.players[side].battle.filter((c) => !c.tapped && (ignore || !c.sickness) && this.canAttackAtAll(side, c));
  }

  // 相手クリーチャーを攻撃対象にできるか(通常はタップ状態のみ。アンタップキラー/一時許可があれば可)
  canTargetCreature(side, attackerInst, targetInst) {
    if (targetInst.tapped) return true;
    if (targetInst.tempIgnoreTapRequirement) return true;
    if (hasKeyword(this.cardOf(attackerInst), 'untapKiller')) return true;
    // 特定文明のクリーチャーに限りアンタップ状態でも攻撃できる(第4弾: 飛翔の精霊アリエス等)
    const untapCiv = keywordValue(this.cardOf(attackerInst), 'canAttackUntappedOfCiv');
    if (untapCiv && this.cardOf(targetInst).civ === untapCiv) return true;
    if (this.turnFlags[side]?.teamIgnoreTapRequirement) return true;
    return false;
  }

  validCreatureAttackTargets(side, attackerUid) {
    const attacker = this.players[side].battle.find((c) => c.uid === attackerUid);
    if (!attacker) return [];
    const atkDef = this.cardOf(attacker);
    if (!this.turnFlags[side]?.ignoreAttackRestrictions && hasKeyword(atkDef, 'cannotAttackCreatures')) return [];
    const opp = this.opponent(side);
    const atkCiv = atkDef.civ;
    // 通常ルールを完全に置き換え、指定文明の未タップクリーチャーしか攻撃できない(第5弾: ストームジャベリン・ワイバーン)
    const onlyUntappedCivs = keywordValue(atkDef, 'canOnlyAttackUntappedOfCivs');
    if (onlyUntappedCivs) {
      return this.players[opp].battle
        .filter((c) => onlyUntappedCivs.includes(this.cardOf(c).civ) && !c.tapped)
        .map((c) => c.uid);
    }
    let pool = this.players[opp].battle
      .filter((c) => this.canTargetCreature(side, attacker, c))
      // 特定文明の攻撃を回避する(第4弾: 神速の守護者グラン・リエス/パープル・ピアス)
      .filter((c) => keywordValue(this.cardOf(c), 'evadeCiv') !== atkCiv)
      // 特定文明からは攻撃対象にされない(第5弾: スチールアーム・クラスター)
      .filter((c) => !(keywordValue(this.cardOf(c), 'cannotBeAttackedByCiv') || []).includes(atkCiv));
    // ブロッカーしか攻撃できない(第6弾: 戦男)
    if (hasKeyword(atkDef, 'canOnlyAttackBlockers')) pool = pool.filter((c) => this.isBlockerNow(opp, c));
    // 求心的な種族強制ターゲット(第6弾: 戦いの化身)があれば、それに絞り込む
    const forced = this.getForcedAttackTargets(side);
    if (forced) pool = pool.filter((c) => forced.includes(c.uid));
    return pool.map((c) => c.uid);
  }

  // 攻撃側の「ブロックされない」度合いを、ブロッカー側に要求される最低パワーとして返す(Infinityなら完全にブロック不可)
  blockThreshold(side, attackerInst) {
    const def = this.cardOf(attackerInst);
    if (attackerInst.tempUnblockable) return Infinity;
    // サバイバーの長からの「ブロックされない」付与にも対応(第5弾: 流星魚α)
    if (this.hasEffectiveKeyword(side, attackerInst, 'unblockable')) return Infinity;
    const countCond = keywordValue(def, 'unblockableIfOwnCount');
    if (countCond && this.players[side].battle.length >= countCond) return Infinity;
    const powerCond = keywordValue(def, 'unblockableByPowerAtMost');
    if (powerCond) return powerCond;
    // 自分の他のクリーチャーから「同じ文明はブロックされない」というオーラを得ていないか
    for (const c of this.players[side].battle) {
      if (c === attackerInst) continue;
      const grantCiv = keywordValue(this.cardOf(c), 'auraGrantUnblockableToOthersOfCiv');
      if (grantCiv && grantCiv === def.civ) return Infinity;
    }
    // 特定種族は場に出ている限り常にブロックされない、というオーラを持つクリーチャーがいないか(自分/相手どちらの場でも)
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        const race = keywordValue(this.cardOf(c), 'globalUnblockableRace');
        if (race && race === def.race) return Infinity;
      }
    }
    return -Infinity;
  }

  eligibleBlockers(side, attackerSide, attackerInst) {
    const threshold = this.blockThreshold(attackerSide, attackerInst);
    const attackerDef = this.cardOf(attackerInst);
    return this.players[side].battle.filter((c) => {
      if (c.tapped || !this.isBlockerNow(side, c) || this.powerBase(side, c) <= threshold) return false;
      const blockerDef = this.cardOf(c);
      // 特定文明のクリーチャーはブロックできない(第4弾: いにしえの超人=闇不可、神速の守護者グラン・リエス等=評価対象civ不可)
      if (keywordValue(attackerDef, 'cannotBeBlockedByCiv') === blockerDef.civ) return false;
      if (keywordValue(attackerDef, 'evadeCiv') === blockerDef.civ) return false;
      // このブロッカーは指定文明の攻撃しかブロックできない(第5弾: バウンサー・イール)
      const blockerCivRestrict = keywordValue(blockerDef, 'blockerVsCiv');
      if (blockerCivRestrict && !blockerCivRestrict.includes(attackerDef.civ)) return false;
      // 攻撃側は一定パワー以上のクリーチャーにブロックされない(第5弾: 乱雲の使徒カルゴ)
      const cannotBeBlockedByPowerAtLeast = keywordValue(attackerDef, 'cannotBeBlockedByPowerAtLeast');
      if (cannotBeBlockedByPowerAtLeast != null && this.powerBase(side, c) >= cannotBeBlockedByPowerAtLeast) return false;
      return true;
    });
  }

  declareAttack(side, attackerUid, target) {
    if (this.phase !== 'attack' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const atk = ps.battle.find((c) => c.uid === attackerUid);
    if (!atk || atk.tapped) return { ok: false };
    const ignoreRestrictions = this.turnFlags[side]?.ignoreAttackRestrictions;
    if (!ignoreRestrictions && atk.sickness) return { ok: false };
    if (!this.canAttackAtAll(side, atk)) return { ok: false };
    const atkDef = this.cardOf(atk);
    if (!ignoreRestrictions && target.type === 'player' && hasKeyword(atkDef, 'cannotAttackPlayer')) return { ok: false };
    if (!ignoreRestrictions && target.type === 'creature' && hasKeyword(atkDef, 'cannotAttackCreatures')) return { ok: false };
    if (target.type === 'creature' && !this.canTargetCreature(side, atk, this.players[this.opponent(side)].battle.find((c) => c.uid === target.uid) || {})) {
      return { ok: false };
    }
    // 求心的な種族強制ターゲット(第6弾: 戦いの化身)がある間は、プレイヤーへの攻撃も対象外のクリーチャーへの攻撃も不可
    const forcedTargets = this.getForcedAttackTargets(side);
    if (forcedTargets && (target.type === 'player' || !forcedTargets.includes(target.uid))) return { ok: false };
    // 自分の他のクリーチャーを1体生け贄にしなければ攻撃できない(第6弾: 憤怒の猛将ダイダロス)。自動で最も弱いものを選ぶ
    if (hasKeyword(atkDef, 'mustSacrificeToAttack')) {
      const sacUid = this.pickWeakestOwnCreatureUid(side, attackerUid);
      if (sacUid == null) return { ok: false };
      this.destroyCreature(side, sacUid);
    }
    atk.tapped = true;
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const targetName = target.type === 'player' ? '相手プレイヤー' : this.cardOf(ops.battle.find((c) => c.uid === target.uid))?.name;
    this.logMsg(`${labelOf(side)}の${atkDef.name}が${targetName}に攻撃した。`);
    // 攻撃時能力が自分自身(攻撃したクリーチャー)を対象にする場合のために、解決中はuidを参照できるようにする
    this._resolvingAttackerUid = attackerUid;
    // サバイバーの長から付与された「攻撃時」能力(対象を取らないもの)を発火させる(第5弾)
    this.triggerSurvivorOnAttack(side, atk);
    if (atkDef.onAttack) {
      if (atkDef.onAttack.target) {
        this.pendingAttackTrigger = { side, attackerUid, target, ability: atkDef.onAttack, def: atkDef };
        return { ok: true, awaitingAttackTrigger: true };
      }
      this.resolveCardAbility(side, atkDef, atkDef.onAttack, []);
      if (this.isGameOver()) return { ok: true };
    }
    return this.continueAttackAfterTrigger(side, attackerUid, target);
  }

  resolveAttackTrigger(targetUids) {
    if (!this.pendingAttackTrigger) return { ok: false };
    const { side, attackerUid, target, ability, def } = this.pendingAttackTrigger;
    this._resolvingAttackerUid = attackerUid;
    this.resolveCardAbility(side, def, ability, targetUids || []);
    this.pendingAttackTrigger = null;
    if (this.isGameOver()) return { ok: true };
    return this.continueAttackAfterTrigger(side, attackerUid, target);
  }

  continueAttackAfterTrigger(side, attackerUid, target) {
    const atk = this.players[side].battle.find((c) => c.uid === attackerUid);
    if (!atk) return { ok: true };
    const opp = this.opponent(side);
    const blockers = this.eligibleBlockers(opp, side, atk);
    if (blockers.length > 0) {
      this.pendingBlock = { attackerSide: side, attackerUid, target, defenderSide: opp, eligibleBlockers: blockers.map((b) => b.uid) };
      return { ok: true, awaitingBlock: true, defenderSide: opp };
    }
    this.resolveCombat(side, attackerUid, target, null);
    return { ok: true, awaitingBlock: false };
  }

  resolveBlock(blockerUid) {
    if (!this.pendingBlock) return { ok: false };
    const { attackerSide, attackerUid, target } = this.pendingBlock;
    this.pendingBlock = null;
    this.resolveCombat(attackerSide, attackerUid, target, blockerUid || null);
    return { ok: true };
  }

  // ---- タップ能力(第6弾で追加): 攻撃するかわりに、クリーチャーをタップして能力を使う ----
  // 自身の tapAbility を持つか、同じ文明に tapAbility を配る別のクリーチャー(tapAbilityGrantToCiv)から借用する
  resolveTapAbilityFor(side, inst) {
    const def = this.cardOf(inst);
    if (def.tapAbility) return { ability: def.tapAbility, sourceDef: def };
    for (const other of this.players[side].battle) {
      if (other === inst) continue;
      const otherDef = this.cardOf(other);
      if (keywordValue(otherDef, 'tapAbilityGrantToCiv') === def.civ && otherDef.tapAbility) {
        return { ability: otherDef.tapAbility, sourceDef: otherDef };
      }
    }
    return null;
  }

  // このクリーチャーが攻撃するかわりにタップ能力を使えるか(攻撃可能な条件と同じ: 未タップ・召喚酔いでない)
  canUseTapAbility(side, uid) {
    if (this.phase !== 'attack' || this.isGameOver()) return false;
    const inst = this.players[side].battle.find((c) => c.uid === uid);
    if (!inst || inst.tapped) return false;
    const ignore = this.turnFlags[side]?.ignoreAttackRestrictions;
    if (!ignore && inst.sickness) return false;
    return !!this.resolveTapAbilityFor(side, inst);
  }

  useTapAbility(side, uid) {
    if (!this.canUseTapAbility(side, uid)) return { ok: false };
    const inst = this.players[side].battle.find((c) => c.uid === uid);
    const found = this.resolveTapAbilityFor(side, inst);
    if (!found) return { ok: false };
    inst.tapped = true;
    const def = this.cardOf(inst);
    this.logMsg(`${labelOf(side)}は${def.name}をタップして能力を使った。`);
    if (found.ability.target) {
      this.pendingTapAbility = { side, uid, ability: found.ability, def: found.sourceDef };
      return { ok: true, awaitingTapAbilityTarget: true };
    }
    this.resolveCardAbility(side, found.sourceDef, found.ability, []);
    this.checkStateBasedLoss();
    return { ok: true };
  }

  getPendingTapAbilityCandidates() {
    if (!this.pendingTapAbility) return null;
    return this.getTargetCandidates(this.pendingTapAbility.side, this.pendingTapAbility.ability.target);
  }

  resolveTapAbility(targetUids) {
    if (!this.pendingTapAbility) return { ok: false };
    const { side, def, ability } = this.pendingTapAbility;
    this.resolveCardAbility(side, def, ability, targetUids || []);
    this.pendingTapAbility = null;
    this.checkStateBasedLoss();
    return { ok: true };
  }

  // 進化クリーチャーは進化元ごと束になって破壊される。各カードは自分自身の「かわりに手札/マナに置く」を個別に判定する。
  destroyCreature(side, uid) {
    const ps = this.players[side];
    const original = ps.battle.find((c) => c.uid === uid);
    if (!original) return;
    const originalDef = this.cardOf(original);
    // セイバー(第5弾): 同じ側に、破壊されるクリーチャーと同じ種族を守るセイバー持ちがいれば、
    // 代わりにそのセイバー持ちが破壊される(ポッポ・チャッピー等)
    const saber = ps.battle.find((c) => c.uid !== uid && keywordValue(this.cardOf(c), 'saberProtectsRace') === originalDef.race);
    if (saber) this.logMsg(`${this.cardOf(saber).name}が${originalDef.name}の代わりに破壊された。`);
    const targetUid = saber ? saber.uid : uid;
    const idx = ps.battle.findIndex((c) => c.uid === targetUid);
    if (idx === -1) return;
    const [slot] = ps.battle.splice(idx, 1);
    const topName = this.cardOf(slot).name;
    const onDestroyedAbilities = [];
    for (const layer of slot.stack) {
      const def = getCard(layer.cardId);
      let onDestroy = keywordValue(def, 'onDestroy');
      // サバイバーの長からの「破壊される代わりに～」付与にも対応(第5弾: フウセンアワダケβ)
      if (!onDestroy && (def.race || '').includes('サバイバー')) {
        const grantor = ps.battle.find((c) => keywordValue(this.cardOf(c), 'survivorGrants') === 'onDestroy');
        if (grantor) onDestroy = keywordValue(this.cardOf(grantor), 'onDestroy');
      }
      if (onDestroy === 'hand') {
        ps.hand.push({ uid: layer.uid, cardId: layer.cardId });
        this.logMsg(`${def.name}は破壊されるかわりに手札に戻った。`);
      } else if (onDestroy === 'mana') {
        ps.mana.push({ uid: layer.uid, cardId: layer.cardId, tapped: false });
        this.logMsg(`${def.name}は破壊されるかわりにマナゾーンに置かれた。`);
      } else if (onDestroy === 'handIfPay' && ps.hand.length > 0) {
        let worstIdx = 0;
        ps.hand.forEach((c, ci) => { if (getCard(c.cardId).cost < getCard(ps.hand[worstIdx].cardId).cost) worstIdx = ci; });
        const [discarded] = ps.hand.splice(worstIdx, 1);
        ps.graveyard.push(discarded);
        ps.hand.push({ uid: layer.uid, cardId: layer.cardId });
        this.logMsg(`${def.name}は手札を1枚捨てるかわりに手札に戻った。`);
      } else if (onDestroy === 'shield') {
        ps.shields.push({ uid: layer.uid, cardId: layer.cardId });
        this.logMsg(`${def.name}は破壊されるかわりに裏向きのシールドになった。`);
      } else {
        // 同じ文明の他のクリーチャーが墓地行きを手札/マナに変える効果を持っていないか確認
        const guardian = ps.battle.find((c) => {
          const dest = keywordValue(this.cardOf(c), 'redirectAllyDeathTo');
          return dest && this.cardOf(c).civ === def.civ;
        });
        if (guardian) {
          const dest = keywordValue(this.cardOf(guardian), 'redirectAllyDeathTo');
          if (dest === 'hand') {
            ps.hand.push({ uid: layer.uid, cardId: layer.cardId });
            this.logMsg(`${def.name}は${this.cardOf(guardian).name}の効果で手札に戻った。`);
          } else if (dest === 'mana') {
            ps.mana.push({ uid: layer.uid, cardId: layer.cardId, tapped: false });
            this.logMsg(`${def.name}は${this.cardOf(guardian).name}の効果でマナゾーンに置かれた。`);
          } else {
            ps.graveyard.push({ uid: layer.uid, cardId: layer.cardId });
            if (def.onDestroyed) onDestroyedAbilities.push(def);
          }
        } else {
          ps.graveyard.push({ uid: layer.uid, cardId: layer.cardId });
          if (def.onDestroyed) onDestroyedAbilities.push(def);
        }
      }
    }
    if (slot.stack.some((l) => !keywordValue(getCard(l.cardId), 'onDestroy'))) {
      this.logMsg(`${topName}が破壊された。`);
    }
    for (const def of onDestroyedAbilities) this.resolveCardAbility(side, def, def.onDestroyed, []);
    // 他のクリーチャーが破壊された時ドローしてよい系の常時能力を発火させる(第4弾: 屑男)
    for (const s of ['player', 'cpu']) {
      for (const c of this.players[s].battle) {
        if (hasKeyword(this.cardOf(c), 'drawOnAnyCreatureDestroyed')) this.drawCardsSafe(s, 1);
      }
    }
  }

  resolveCombat(side, attackerUid, target, blockerUid) {
    const ps = this.players[side];
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const atk = ps.battle.find((c) => c.uid === attackerUid);
    if (!atk) return;
    const atkDef = this.cardOf(atk);
    const atkPower = this.powerWhileAttacking(side, atk);

    let fightUid = null;
    let blocked = false;
    if (blockerUid) {
      const blocker = ops.battle.find((c) => c.uid === blockerUid);
      if (blocker) {
        blocker.tapped = true;
        fightUid = blockerUid;
        blocked = true;
        this.logMsg(`${labelOf(opp)}は${this.cardOf(blocker).name}でブロックした!`);
      }
    } else if (target.type === 'creature') {
      fightUid = target.uid;
    }

    if (fightUid) {
      const defCreature = ops.battle.find((c) => c.uid === fightUid);
      if (defCreature) {
        const defDef = this.cardOf(defCreature);
        const defPower = this.powerBase(opp, defCreature);
        // ブロックされた場合バトル自体が発生しない(第6弾: ピーカプ・リザード等の攻撃側、不屈の使徒チーキ・クーレ等のブロック側)。
        // 両者はタップされたままで、勝敗判定も破壊も一切発生しない。
        const skipBattle = blocked && (hasKeyword(atkDef, 'noBattleWhenBlocked') || hasKeyword(defDef, 'noBattleWhenBlocking'));
        if (skipBattle) {
          this.logMsg(`${atkDef.name}の攻撃は${defDef.name}に阻止されたが、バトルは行われなかった。`);
        } else {
          this.logMsg(`${atkDef.name}(${atkPower}) と ${defDef.name}(${defPower}) がバトル!`);
          // サバイバーの長からのスレイヤー付与、および文明限定スレイヤー(第5弾)にも対応
          const atkIsSlayer = this.hasEffectiveKeyword(side, atk, 'slayer') || civSlayerMatches(atkDef, defDef) || atk.tempSlayerGrant || this.hasRaceGrantedSlayer(side, atk);
          const defIsSlayer = this.hasEffectiveKeyword(opp, defCreature, 'slayer') || civSlayerMatches(defDef, atkDef) || defCreature.tempSlayerGrant || this.hasRaceGrantedSlayer(opp, defCreature);
          let atkDies = atkPower <= defPower;
          let defDies = defPower <= atkPower;
          if (defIsSlayer) atkDies = true;
          if (atkIsSlayer) defDies = true;
          if (hasKeyword(atkDef, 'selfDestructAfterBattle')) atkDies = true;
          if (hasKeyword(defDef, 'selfDestructAfterBattle')) defDies = true;
          if (blocked && this.turnFlags[side]?.blockersDieAfterBattle) defDies = true;
          if (defDies) this.destroyCreature(opp, fightUid);
          if (atkDies) this.destroyCreature(side, attackerUid);
          if (blocked && !defDies && hasKeyword(defDef, 'untapAfterBlocking')) {
            const survivor = ops.battle.find((c) => c.uid === fightUid);
            if (survivor) survivor.tapped = false;
          }
        }
      }
      // ブロックされた時、相手にシールドが1枚でもあれば1枚ブレイクする(第5弾: 神拳の超人、第6弾: ガイアクロウ・ワスプ)
      if (blocked && hasKeyword(atkDef, 'breakShieldWhenBlocked') && this.players[opp].shields.length > 0) {
        this.breakShields(opp, 1, side);
      }
    } else if (target.type === 'player' && !blocked) {
      // ポコルルの「S・トリガーを使われたらアンタップしてもよい」判定用に、直前のブレイク元を記録する
      this._lastBreakAttackerUid = attackerUid;
      this._lastBreakAttackerSide = side;
      // シールド焼却(第6弾: ボルメテウス・ホワイト・ドラゴン) — ブレイクしたシールドは手札に加わらず墓地に置かれ、S・トリガーも使えない
      this.breakShields(opp, this.breakerCountNow(side, atk), side, hasKeyword(atkDef, 'shieldBurnOnBreak'));
    }
    if (target.type === 'player' && hasKeyword(atkDef, 'selfDestructAfterAttackingPlayer')) {
      const stillThere = this.players[side].battle.find((c) => c.uid === attackerUid);
      if (stillThere) this.destroyCreature(side, attackerUid);
    }
    this.checkStateBasedLoss();
  }

  // breakerSideを渡すと、そのプレイヤー視点で「今ターン何枚シールドを割ったか」を記録し、
  // ドロー系の遅延効果(ミラクル・サーチャー等)やターン終了時の集計(ビースト・チャージ)に使う
  breakShields(side, breakerCount, breakerSide, burnMode) {
    const ps = this.players[side];
    if (ps.shields.length === 0) {
      this.result = this.opponent(side);
      this.logMsg(`${labelOf(side)}はダイレクトアタックを受けて敗北した!`);
      return;
    }
    const n = Math.min(breakerCount, ps.shields.length);
    for (let i = 0; i < n; i++) {
      const shield = ps.shields.pop();
      // シールド焼却(第6弾): 手札に加わらず、S・トリガーも使えないまま持ち主の墓地に置かれる
      if (burnMode) {
        ps.graveyard.push(shield);
        this.logMsg(`${labelOf(side)}のシールドが1枚焼却された。`);
        if (breakerSide) {
          this.turnFlags[breakerSide] = this.turnFlags[breakerSide] || {};
          this.turnFlags[breakerSide].shieldsBrokenThisTurn = (this.turnFlags[breakerSide].shieldsBrokenThisTurn || 0) + 1;
        }
        continue;
      }
      ps.hand.push(shield);
      const def = getCard(shield.cardId);
      // ブレイクされたカードの正体は、シールド・トリガーとして実際に使用されるまで非公開にする
      this.logMsg(`${labelOf(side)}のシールドが1枚ブレイクされた。`);
      if (hasShieldTrigger(def) && !this.isShieldTriggerLocked(def.civ)) {
        this.pendingShieldTriggers.push({ side, uid: shield.uid, cardId: shield.cardId });
      }
      if (breakerSide) {
        this.turnFlags[breakerSide] = this.turnFlags[breakerSide] || {};
        this.turnFlags[breakerSide].shieldsBrokenThisTurn = (this.turnFlags[breakerSide].shieldsBrokenThisTurn || 0) + 1;
        const drawAmt = this.turnFlags[breakerSide].drawOnBreak;
        if (drawAmt) this.drawCardsSafe(breakerSide, drawAmt);
      }
    }
  }

  resolveShieldTrigger(use, targetUids) {
    if (this.pendingShieldTriggers.length === 0) return { ok: false };
    const item = this.pendingShieldTriggers.shift();
    const ps = this.players[item.side];
    if (!use) {
      this.logMsg(`${labelOf(item.side)}はS・トリガーを使用しなかった。`);
      return { ok: true };
    }
    const idx = ps.hand.findIndex((c) => c.uid === item.uid);
    if (idx === -1) return { ok: false };
    const [inst] = ps.hand.splice(idx, 1);
    const def = getCard(inst.cardId);
    if (def.type === 'creature') {
      const creature = makeCreatureInstance(inst.uid, inst.cardId);
      ps.battle.push(creature);
      if (this.hasEffectiveKeyword(item.side, creature, 'speedAttacker')) creature.sickness = false;
      this.onCreatureEnteredBattle(creature.uid);
      this.triggerSurvivorOnPlay(item.side, creature);
      this.triggerBlockerOnOpponentAction(item.side);
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を出した!`);
      if (def.onPlay) {
        this._resolvingCipUid = creature.uid;
        this.resolveCardAbility(item.side, def, def.onPlay, targetUids || []);
        this._resolvingCipUid = null;
      }
    } else if (this.isSpellCastLocked(def)) {
      ps.graveyard.push(inst);
      this.logMsg(`${labelOf(item.side)}は${def.name}を唱えようとしたが、封じられていた。`);
    } else {
      this.turnFlags[item.side] = this.turnFlags[item.side] || {};
      this.turnFlags[item.side].spellCastThisTurn = true;
      this.triggerBlockerOnOpponentAction(item.side);
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を唱えた!`);
      if (def.spell) this.resolveCardAbility(item.side, def, def.spell, targetUids || []);
      if (hasKeyword(def, 'castGoesToMana')) ps.mana.push({ uid: inst.uid, cardId: inst.cardId, tapped: false });
      else ps.graveyard.push(inst);
    }
    // このシールドをブレイクしたクリーチャーが「トリガーを使われたらアンタップしてもよい」を持つ場合(第5弾: ポコルル)
    if (this._lastBreakAttackerSide && this._lastBreakAttackerUid) {
      const breaker = this.players[this._lastBreakAttackerSide].battle.find((c) => c.uid === this._lastBreakAttackerUid);
      if (breaker && hasKeyword(this.cardOf(breaker), 'untapOnTriggerUse')) breaker.tapped = false;
    }
    this.checkStateBasedLoss();
    return { ok: true };
  }

  checkStateBasedLoss() {
    // 現状は山札切れ/ダイレクトアタックのみが敗北条件(即時判定はそれぞれの箇所で行う)
  }

  // ---- ターン終了 ----
  endTurn() {
    if (this.isGameOver()) return;
    this.applyEndOfTurnUntap(this.turnSide);
    // ターン終了時に自分のクリーチャーをすべてアンタップする効果(第4弾: ライト・ディフェンス)
    if (this.turnFlags[this.turnSide]?.untapAllAtEndOfTurn) {
      for (const c of this.players[this.turnSide].battle) c.tapped = false;
    }
    // ターン終了時に、このターン相手シールドをブレイクした数だけ山札から手札に加える効果(第5弾: ビースト・チャージ)
    if (this.turnFlags[this.turnSide]?.beastChargeActive) {
      const n = this.turnFlags[this.turnSide].shieldsBrokenThisTurn || 0;
      if (n > 0) this.autoTutorMultiFromDeck(this.turnSide, n, (engine, side, c) => getCard(c.cardId).type === 'creature');
    }
    // 自分のターンの終わりに自分の手札に戻る(第6弾: バザガジール・ドラゴン等)
    for (const c of [...this.players[this.turnSide].battle]) {
      if (hasKeyword(this.cardOf(c), 'returnToHandEndOfTurn')) this.bounceCreature(this.turnSide, c.uid);
    }
    // 自分のターンの終わりに、自分の場でこのクリーチャーだけであれば自分の墓地に置かれる(第6弾: 戦慄の剛将アブリン等)
    if (this.players[this.turnSide].battle.length === 1) {
      const [only] = this.players[this.turnSide].battle;
      if (hasKeyword(this.cardOf(only), 'selfDestructIfAloneEndOfTurn')) this.destroyCreature(this.turnSide, only.uid);
    }
    this.clearTurnTempEffects();
    this.turnFlags = { player: {}, cpu: {} };
    this.turnSide = this.opponent(this.turnSide);
    if (this.turnSide === this.firstSide) this.turnNumber++;
    this.logMsg(`--- ${labelOf(this.turnSide)}のターン${this.turnNumber} ---`);
    this.startTurn();
  }
}
