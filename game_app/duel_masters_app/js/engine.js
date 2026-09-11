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

// バトルゾーンのクリーチャーは「スタック」として表現する: stack[stack.length-1]が現在の姿(進化クリーチャー)。
// 進化元は束になっていて、バトルゾーンを離れる際は全員まとめて移動し、移動先で個別のカードに戻る。
function makeCreatureInstance(uid, cardId) {
  return {
    uid, tapped: false, sickness: true,
    tempPowerAttackerBonus: 0, tempDoubleBreaker: false,
    tempUnblockable: false, tempIgnoreTapRequirement: false,
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
    return bonus;
  }

  powerBase(side, inst) {
    const def = this.cardOf(inst);
    return (def.power || 0) + this.staticPowerBonus(side, inst);
  }

  powerWhileAttacking(side, inst) {
    const def = this.cardOf(inst);
    let p = this.powerBase(side, inst);
    if (hasKeyword(def, 'powerAttacker')) p += keywordValue(def, 'powerAttacker');
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
    p += inst.tempPowerAttackerBonus || 0;
    return p;
  }

  isDoubleBreakerNow(side, inst) {
    const def = this.cardOf(inst);
    if (isDoubleBreaker(def) || inst.tempDoubleBreaker) return true;
    if (hasKeyword(def, 'soloDoubleBreaker') && this.players[side].battle.length === 1) return true;
    if (hasKeyword(def, 'doubleBreakerIfManaMonoColor') && this.isManaMonoColor(side, def.civ)) return true;
    return false;
  }

  // ブロッカーかどうか(常時に加え、他クリーチャーからのオーラ付与・マナ単色条件も考慮)
  isBlockerNow(side, inst) {
    const def = this.cardOf(inst);
    if (isBlocker(def)) return true;
    if (hasKeyword(def, 'blockerIfManaMonoColor') && this.isManaMonoColor(side, def.civ)) return true;
    for (const other of this.players[side].battle) {
      if (other === inst) continue;
      const grantCiv = keywordValue(this.cardOf(other), 'auraGrantBlockerToOthersOfCiv');
      if (grantCiv && grantCiv === def.civ) return true;
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
      const def = this.cardOf(c);
      const mode = keywordValue(def, 'endOfTurnUntap');
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
    const forced = ps.battle.filter((c) => !c.tapped && !c.sickness && hasKeyword(this.cardOf(c), 'forcedAttacker'));
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

  discardRandomFromHand(side) {
    const ps = this.players[side];
    if (ps.hand.length === 0) return;
    const idx = Math.floor(Math.random() * ps.hand.length);
    const [c] = ps.hand.splice(idx, 1);
    ps.graveyard.push(c);
    this.logMsg(`${labelOf(side)}は手札を1枚(ランダムに選ばれて)捨てた。`);
  }

  discardAllHand(side) {
    const ps = this.players[side];
    const n = ps.hand.length;
    ps.graveyard.push(...ps.hand);
    ps.hand = [];
    if (n > 0) this.logMsg(`${labelOf(side)}は手札をすべて(${n}枚)捨てた。`);
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
    else if (spec.kind === 'enemyManaCard') pool = this.players[opp].mana;
    else if (spec.kind === 'ownManaCard') pool = this.players[side].mana;
    return pool.filter((c) => filter(this, side, c)).map((c) => c.uid);
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
    ps.hand.splice(idx, 1);
    this.payCost(side, def);
    if (def.type === 'creature') {
      const creature = makeCreatureInstance(inst.uid, inst.cardId);
      ps.battle.push(creature);
      this.logMsg(`${labelOf(side)}は${def.name}を召喚した。`);
      if (def.onPlay) {
        // CIP(出た時)能力は「先にバトルゾーンへ出てから対象を選ぶ」実タイミングを再現するため、
        // 対象が必要な場合はここでは解決せず pendingCip に積んで呼び出し側に対象選択を委ねる。
        if (def.onPlay.target) {
          this.pendingCip = { side, casterUid: creature.uid, def, ability: def.onPlay };
          return { ok: true, awaitingCipTarget: true };
        }
        this.resolveCardAbility(side, def, def.onPlay, []);
      }
    } else {
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
    this.logMsg(`${labelOf(side)}は${def.name}に進化させた。`);
    if (def.onPlay) {
      if (def.onPlay.target) {
        this.pendingCip = { side, casterUid: slot.uid, def, ability: def.onPlay };
        return { ok: true, awaitingCipTarget: true };
      }
      this.resolveCardAbility(side, def, def.onPlay, []);
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
    return true;
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
    if (this.turnFlags[side]?.teamIgnoreTapRequirement) return true;
    return false;
  }

  validCreatureAttackTargets(side, attackerUid) {
    const attacker = this.players[side].battle.find((c) => c.uid === attackerUid);
    if (!attacker) return [];
    if (!this.turnFlags[side]?.ignoreAttackRestrictions && hasKeyword(this.cardOf(attacker), 'cannotAttackCreatures')) return [];
    const opp = this.opponent(side);
    return this.players[opp].battle.filter((c) => this.canTargetCreature(side, attacker, c)).map((c) => c.uid);
  }

  // 攻撃側の「ブロックされない」度合いを、ブロッカー側に要求される最低パワーとして返す(Infinityなら完全にブロック不可)
  blockThreshold(side, attackerInst) {
    const def = this.cardOf(attackerInst);
    if (attackerInst.tempUnblockable) return Infinity;
    if (hasKeyword(def, 'unblockable')) return Infinity;
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
    return this.players[side].battle.filter((c) => !c.tapped && this.isBlockerNow(side, c) && this.powerBase(side, c) > threshold);
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
    atk.tapped = true;
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const targetName = target.type === 'player' ? '相手プレイヤー' : this.cardOf(ops.battle.find((c) => c.uid === target.uid))?.name;
    this.logMsg(`${labelOf(side)}の${atkDef.name}が${targetName}に攻撃した。`);
    // 攻撃時能力が自分自身(攻撃したクリーチャー)を対象にする場合のために、解決中はuidを参照できるようにする
    this._resolvingAttackerUid = attackerUid;
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

  // 進化クリーチャーは進化元ごと束になって破壊される。各カードは自分自身の「かわりに手札/マナに置く」を個別に判定する。
  destroyCreature(side, uid) {
    const ps = this.players[side];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [slot] = ps.battle.splice(idx, 1);
    const topName = this.cardOf(slot).name;
    const onDestroyedAbilities = [];
    for (const layer of slot.stack) {
      const def = getCard(layer.cardId);
      const onDestroy = keywordValue(def, 'onDestroy');
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
        this.logMsg(`${atkDef.name}(${atkPower}) と ${defDef.name}(${defPower}) がバトル!`);
        const atkIsSlayer = hasKeyword(atkDef, 'slayer');
        const defIsSlayer = hasKeyword(defDef, 'slayer');
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
    } else if (target.type === 'player' && !blocked) {
      this.breakShields(opp, this.isDoubleBreakerNow(side, atk) ? 2 : 1);
    }
    if (target.type === 'player' && hasKeyword(atkDef, 'selfDestructAfterAttackingPlayer')) {
      const stillThere = this.players[side].battle.find((c) => c.uid === attackerUid);
      if (stillThere) this.destroyCreature(side, attackerUid);
    }
    this.checkStateBasedLoss();
  }

  breakShields(side, breakerCount) {
    const ps = this.players[side];
    if (ps.shields.length === 0) {
      this.result = this.opponent(side);
      this.logMsg(`${labelOf(side)}はダイレクトアタックを受けて敗北した!`);
      return;
    }
    const n = Math.min(breakerCount, ps.shields.length);
    for (let i = 0; i < n; i++) {
      const shield = ps.shields.pop();
      ps.hand.push(shield);
      const def = getCard(shield.cardId);
      // ブレイクされたカードの正体は、シールド・トリガーとして実際に使用されるまで非公開にする
      this.logMsg(`${labelOf(side)}のシールドが1枚ブレイクされた。`);
      if (hasShieldTrigger(def)) {
        this.pendingShieldTriggers.push({ side, uid: shield.uid, cardId: shield.cardId });
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
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を出した!`);
      if (def.onPlay) this.resolveCardAbility(item.side, def, def.onPlay, targetUids || []);
    } else {
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を唱えた!`);
      if (def.spell) this.resolveCardAbility(item.side, def, def.spell, targetUids || []);
      if (hasKeyword(def, 'castGoesToMana')) ps.mana.push({ uid: inst.uid, cardId: inst.cardId, tapped: false });
      else ps.graveyard.push(inst);
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
    this.clearTurnTempEffects();
    this.turnFlags = { player: {}, cpu: {} };
    this.turnSide = this.opponent(this.turnSide);
    if (this.turnSide === this.firstSide) this.turnNumber++;
    this.logMsg(`--- ${labelOf(this.turnSide)}のターン${this.turnNumber} ---`);
    this.startTurn();
  }
}
