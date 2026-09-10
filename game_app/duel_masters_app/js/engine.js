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

function makeCreatureInstance(uid, cardId) {
  return {
    uid, cardId, tapped: false, sickness: true,
    tempPowerAttackerBonus: 0, tempDoubleBreaker: false,
    tempUnblockable: false, tempIgnoreTapRequirement: false,
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

  cardOf(inst) { return getCard(inst.cardId); }

  // ---- パワー計算 ----
  hasRace(side, race) {
    return this.players[side].battle.some((c) => this.cardOf(c).race === race);
  }

  staticPowerBonus(side, inst) {
    const def = this.cardOf(inst);
    const cond = keywordValue(def, 'staticPowerBonusCondition');
    if (cond && this.hasRace(side, cond.race)) return cond.amount;
    return 0;
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
    p += inst.tempPowerAttackerBonus || 0;
    return p;
  }

  isDoubleBreakerNow(inst) {
    const def = this.cardOf(inst);
    return isDoubleBreaker(def) || !!inst.tempDoubleBreaker;
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
      const r = this.declareAttack(side, c.uid, { type: 'player' });
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

  canPayCost(side, def) {
    const untapped = this.untappedMana(side);
    if (untapped.length < def.cost) return false;
    return untapped.some((m) => getCard(m.cardId).civ === def.civ);
  }

  payCost(side, def) {
    const ps = this.players[side];
    const untapped = ps.mana.filter((m) => !m.tapped);
    const civIdx = untapped.findIndex((m) => getCard(m.cardId).civ === def.civ);
    const toTap = [];
    if (civIdx !== -1) toTap.push(untapped[civIdx]);
    for (const m of untapped) {
      if (toTap.length >= def.cost) break;
      if (!toTap.includes(m)) toTap.push(m);
    }
    for (const m of toTap) m.tapped = true;
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
  bounceCreature(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.battle.splice(idx, 1);
    ps.hand.push({ uid: c.uid, cardId: c.cardId });
    this.logMsg(`${this.cardOf(c).name}が手札に戻された。`);
  }

  manaizeCreature(ownerSide, uid) {
    const ps = this.players[ownerSide];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.battle.splice(idx, 1);
    ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
    this.logMsg(`${this.cardOf(c).name}がマナゾーンに置かれた。`);
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

  symmetricDestroyByPower(maxPower) {
    for (const side of ['player', 'cpu']) {
      const ps = this.players[side];
      const toDestroy = ps.battle.filter((c) => this.powerBase(side, c) <= maxPower).map((c) => c.uid);
      for (const uid of toDestroy) this.destroyCreature(side, uid);
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

  // ---- ターゲット候補取得 ----
  // kind: 'enemyCreature' | 'anyCreature' | 'ownCreature' | 'ownGraveyardCreature' | 'deckTutor'
  getTargetCandidates(side, spec) {
    if (!spec) return null;
    const opp = this.opponent(side);
    const filter = spec.filter || (() => true);
    let pool = [];
    if (spec.kind === 'enemyCreature') pool = this.players[opp].battle;
    else if (spec.kind === 'ownCreature') pool = this.players[side].battle;
    else if (spec.kind === 'anyCreature') pool = [...this.players[side].battle, ...this.players[opp].battle];
    else if (spec.kind === 'ownGraveyardCreature') pool = this.players[side].graveyard.filter((c) => this.cardOf(c).type === 'creature');
    else if (spec.kind === 'deckTutor') pool = this.players[side].deck;
    else if (spec.kind === 'ownHandCard') pool = this.players[side].hand;
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
      ps.graveyard.push(inst);
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

  canAttackAtAll(inst) {
    return !hasKeyword(this.cardOf(inst), 'cannotAttack');
  }

  eligibleAttackers(side) {
    return this.players[side].battle.filter((c) => !c.tapped && !c.sickness && this.canAttackAtAll(c));
  }

  // 相手クリーチャーを攻撃対象にできるか(通常はタップ状態のみ。アンタップキラー/一時許可があれば可)
  canTargetCreature(side, attackerInst, targetInst) {
    if (targetInst.tapped) return true;
    if (targetInst.tempIgnoreTapRequirement) return true;
    if (hasKeyword(this.cardOf(attackerInst), 'untapKiller')) return true;
    return false;
  }

  validCreatureAttackTargets(side, attackerUid) {
    const attacker = this.players[side].battle.find((c) => c.uid === attackerUid);
    if (!attacker) return [];
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
    return -Infinity;
  }

  eligibleBlockers(side, attackerSide, attackerInst) {
    const threshold = this.blockThreshold(attackerSide, attackerInst);
    return this.players[side].battle.filter((c) => !c.tapped && isBlocker(this.cardOf(c)) && this.powerBase(side, c) > threshold);
  }

  declareAttack(side, attackerUid, target) {
    if (this.phase !== 'attack' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const atk = ps.battle.find((c) => c.uid === attackerUid);
    if (!atk || atk.tapped || atk.sickness || !this.canAttackAtAll(atk)) return { ok: false };
    const atkDef = this.cardOf(atk);
    if (target.type === 'player' && hasKeyword(atkDef, 'cannotAttackPlayer')) return { ok: false };
    if (target.type === 'creature' && !this.canTargetCreature(side, atk, this.players[this.opponent(side)].battle.find((c) => c.uid === target.uid) || {})) {
      return { ok: false };
    }
    atk.tapped = true;
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const blockers = this.eligibleBlockers(opp, side, atk);
    const targetName = target.type === 'player' ? '相手プレイヤー' : this.cardOf(ops.battle.find((c) => c.uid === target.uid))?.name;
    this.logMsg(`${labelOf(side)}の${atkDef.name}が${targetName}に攻撃した。`);
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

  destroyCreature(side, uid) {
    const ps = this.players[side];
    const idx = ps.battle.findIndex((c) => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.battle.splice(idx, 1);
    const def = this.cardOf(c);
    const onDestroy = keywordValue(def, 'onDestroy');
    if (onDestroy === 'hand') {
      ps.hand.push({ uid: c.uid, cardId: c.cardId });
      this.logMsg(`${def.name}は破壊されるかわりに手札に戻った。`);
    } else if (onDestroy === 'mana') {
      ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
      this.logMsg(`${def.name}は破壊されるかわりにマナゾーンに置かれた。`);
    } else {
      ps.graveyard.push(c);
      this.logMsg(`${def.name}が破壊された。`);
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
      }
    } else if (target.type === 'player' && !blocked) {
      this.breakShields(opp, this.isDoubleBreakerNow(atk) ? 2 : 1);
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
      this.logMsg(`${labelOf(side)}のシールドが1枚ブレイクされた。(${def.name})`);
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
      ps.graveyard.push(inst);
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
