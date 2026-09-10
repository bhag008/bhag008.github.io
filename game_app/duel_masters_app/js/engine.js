// デュエルマスターズ・エンジン: フェーズ管理、マナ支払い、攻撃/ブロック、シールドブレイクとS・トリガーを解決する
import { nextUid } from './state.js';
import { getCard, cardEffects, isBlocker, isDoubleBreaker, hasShieldTrigger, START_SHIELDS, START_HAND } from './cards.js';

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
    this.pendingDiscard = null;

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
    if (this.turnSide === this.firstSide) {
      // 先攻1ターン目はドローしない
      this.manaChargedThisTurn = false;
    }
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

  // ---- ターン進行 ----
  untapAll(side) {
    const ps = this.players[side];
    for (const m of ps.mana) m.tapped = false;
    for (const c of ps.battle) { c.tapped = false; c.sickness = false; c.turnBuff = 0; }
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

  startTurn() {
    const side = this.turnSide;
    this.untapAll(side);
    const skipDraw = this.turnNumber === 1 && side === this.firstSide;
    if (!skipDraw) this.drawCards(side, 1);
    if (this.isGameOver()) return;
    this.manaChargedThisTurn = false;
    this.phase = 'main';
  }

  // ---- マナ ----
  untappedMana(side) { return this.players[side].mana.filter(m => !m.tapped); }

  chargeMana(side, handUid) {
    if (this.manaChargedThisTurn || this.phase !== 'main' || this.isGameOver()) return false;
    const ps = this.players[side];
    const idx = ps.hand.findIndex(c => c.uid === handUid);
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
    return untapped.some(m => getCard(m.cardId).civ === def.civ);
  }

  payCost(side, def) {
    const ps = this.players[side];
    const untapped = ps.mana.filter(m => !m.tapped);
    const civIdx = untapped.findIndex(m => getCard(m.cardId).civ === def.civ);
    const toTap = [];
    if (civIdx !== -1) toTap.push(untapped[civIdx]);
    for (const m of untapped) {
      if (toTap.length >= def.cost) break;
      if (!toTap.includes(m)) toTap.push(m);
    }
    for (const m of toTap) m.tapped = true;
  }

  // ---- カードプレイ ----
  getValidTargetUids(side, def) {
    const opp = this.opponent(side);
    for (const eff of cardEffects(def)) {
      if (eff.type === 'destroy') {
        return this.players[opp].battle
          .filter(c => !eff.maxPower || getCard(c.cardId).power <= eff.maxPower)
          .map(c => c.uid);
      }
      if (eff.type === 'bounce') return this.players[opp].battle.map(c => c.uid);
      if (eff.type === 'returnFromGraveyard') {
        return this.players[side].graveyard.filter(c => getCard(c.cardId).type === 'creature').map(c => c.uid);
      }
      if (eff.type === 'buffPower') return this.players[side].battle.map(c => c.uid);
    }
    return null;
  }

  playCard(side, handUid, opts = {}) {
    if (this.phase !== 'main' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const idx = ps.hand.findIndex(c => c.uid === handUid);
    if (idx === -1) return { ok: false };
    const inst = ps.hand[idx];
    const def = getCard(inst.cardId);
    if (!this.canPayCost(side, def)) return { ok: false };
    ps.hand.splice(idx, 1);
    this.payCost(side, def);
    if (def.type === 'creature') {
      ps.battle.push({ uid: inst.uid, cardId: inst.cardId, tapped: false, sickness: true, turnBuff: 0 });
      this.logMsg(`${labelOf(side)}は${def.name}を召喚した。`);
    } else {
      this.logMsg(`${labelOf(side)}は${def.name}を唱えた。`);
      this.resolveEffects(side, cardEffects(def), opts);
      ps.graveyard.push(inst);
    }
    return { ok: true };
  }

  resolveEffects(side, effects, opts) {
    for (const eff of effects) this.applyEffect(side, eff, opts);
  }

  applyEffect(side, eff, opts) {
    const opp = this.opponent(side);
    switch (eff.type) {
      case 'destroy': {
        const ops = this.players[opp];
        const tIdx = ops.battle.findIndex(c => c.uid === opts.targetUid &&
          (!eff.maxPower || getCard(c.cardId).power <= eff.maxPower));
        if (tIdx !== -1) {
          const [c] = ops.battle.splice(tIdx, 1);
          ops.graveyard.push(c);
          this.logMsg(`${getCard(c.cardId).name}が破壊された。`);
        }
        break;
      }
      case 'destroyAllTapped': {
        const ops = this.players[opp];
        const remain = [];
        for (const c of ops.battle) {
          if (c.tapped) { ops.graveyard.push(c); this.logMsg(`${getCard(c.cardId).name}が破壊された。`); }
          else remain.push(c);
        }
        ops.battle = remain;
        break;
      }
      case 'bounce': {
        const ops = this.players[opp];
        const tIdx = ops.battle.findIndex(c => c.uid === opts.targetUid);
        if (tIdx !== -1) {
          const [c] = ops.battle.splice(tIdx, 1);
          ops.hand.push({ uid: c.uid, cardId: c.cardId });
          this.logMsg(`${getCard(c.cardId).name}が手札に戻された。`);
        }
        break;
      }
      case 'draw': {
        this.drawCards(side, eff.amount);
        break;
      }
      case 'manaCharge': {
        const ps = this.players[side];
        if (ps.deck.length > 0) {
          const c = ps.deck.pop();
          ps.mana.push({ uid: c.uid, cardId: c.cardId, tapped: false });
          this.logMsg(`${labelOf(side)}は山札の一番上をマナゾーンに置いた。`);
        }
        break;
      }
      case 'addShield': {
        const ps = this.players[side];
        if (ps.deck.length > 0) {
          const c = ps.deck.pop();
          ps.shields.push(c);
          this.logMsg(`${labelOf(side)}はシールドを1枚追加した。`);
        }
        break;
      }
      case 'discardHand': {
        this.requestDiscard(opp, eff.amount);
        break;
      }
      case 'returnFromGraveyard': {
        const ps = this.players[side];
        const gIdx = ps.graveyard.findIndex(c => c.uid === opts.targetUid && getCard(c.cardId).type === 'creature');
        if (gIdx !== -1) {
          const [c] = ps.graveyard.splice(gIdx, 1);
          ps.hand.push(c);
          this.logMsg(`${labelOf(side)}は${getCard(c.cardId).name}を墓地から手札に戻した。`);
        }
        break;
      }
      case 'buffPower': {
        const ps = this.players[side];
        const c = ps.battle.find(x => x.uid === opts.targetUid);
        if (c) {
          c.turnBuff = (c.turnBuff || 0) + eff.amount;
          this.logMsg(`${getCard(c.cardId).name}のパワーが上昇した。`);
        }
        break;
      }
      default: break;
    }
  }

  requestDiscard(side, amount) {
    if (side === 'cpu') {
      const ps = this.players.cpu;
      for (let i = 0; i < amount && ps.hand.length > 0; i++) {
        let idx = 0;
        ps.hand.forEach((c, ci) => {
          if (getCard(c.cardId).cost < getCard(ps.hand[idx].cardId).cost) idx = ci;
        });
        const [c] = ps.hand.splice(idx, 1);
        ps.graveyard.push(c);
      }
      this.logMsg('CPUは手札を捨てた。');
    } else {
      this.pendingDiscard = { side, amount };
    }
  }

  resolveDiscard(handUid) {
    if (!this.pendingDiscard) return { ok: false };
    const ps = this.players[this.pendingDiscard.side];
    const idx = ps.hand.findIndex(c => c.uid === handUid);
    if (idx === -1) return { ok: false };
    const [c] = ps.hand.splice(idx, 1);
    ps.graveyard.push(c);
    this.logMsg(`${labelOf(this.pendingDiscard.side)}は手札を1枚捨てた。`);
    this.pendingDiscard.amount--;
    if (this.pendingDiscard.amount <= 0) this.pendingDiscard = null;
    return { ok: true };
  }

  // ---- 攻撃フェーズ ----
  enterAttackPhase() {
    if (this.phase === 'main') this.phase = 'attack';
  }

  eligibleAttackers(side) {
    return this.players[side].battle.filter(c => !c.tapped && !c.sickness);
  }

  declareAttack(side, attackerUid, target) {
    if (this.phase !== 'attack' || this.isGameOver()) return { ok: false };
    const ps = this.players[side];
    const atk = ps.battle.find(c => c.uid === attackerUid);
    if (!atk || atk.tapped || atk.sickness) return { ok: false };
    atk.tapped = true;
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const blockers = ops.battle.filter(c => !c.tapped && isBlocker(getCard(c.cardId)));
    const targetDef = target.type === 'player' ? '相手' : getCard(ops.battle.find(c => c.uid === target.uid)?.cardId)?.name;
    this.logMsg(`${labelOf(side)}の${getCard(atk.cardId).name}が${target.type === 'player' ? '相手プレイヤー' : targetDef}に攻撃した。`);
    if (blockers.length > 0) {
      this.pendingBlock = { attackerSide: side, attackerUid, target, defenderSide: opp, eligibleBlockers: blockers.map(b => b.uid) };
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
    const idx = ps.battle.findIndex(c => c.uid === uid);
    if (idx === -1) return;
    const [c] = ps.battle.splice(idx, 1);
    ps.graveyard.push(c);
    this.logMsg(`${getCard(c.cardId).name}が破壊された。`);
  }

  resolveCombat(side, attackerUid, target, blockerUid) {
    const ps = this.players[side];
    const opp = this.opponent(side);
    const ops = this.players[opp];
    const atk = ps.battle.find(c => c.uid === attackerUid);
    if (!atk) return;
    const atkDef = getCard(atk.cardId);
    const atkPower = atkDef.power + (atk.turnBuff || 0);

    let fightUid = null;
    if (blockerUid) {
      const blocker = ops.battle.find(c => c.uid === blockerUid);
      if (blocker) {
        blocker.tapped = true;
        fightUid = blockerUid;
        this.logMsg(`${labelOf(opp)}は${getCard(blocker.cardId).name}でブロックした!`);
      }
    } else if (target.type === 'creature') {
      fightUid = target.uid;
    }

    if (fightUid) {
      const defCreature = ops.battle.find(c => c.uid === fightUid);
      if (defCreature) {
        const defDef = getCard(defCreature.cardId);
        const defPower = defDef.power + (defCreature.turnBuff || 0);
        this.logMsg(`${atkDef.name}(${atkPower}) と ${defDef.name}(${defPower}) がバトル!`);
        if (atkPower > defPower) this.destroyCreature(opp, fightUid);
        else if (defPower > atkPower) this.destroyCreature(side, attackerUid);
        else { this.destroyCreature(opp, fightUid); this.destroyCreature(side, attackerUid); }
      }
    } else if (target.type === 'player') {
      this.breakShields(opp, isDoubleBreaker(atkDef) ? 2 : 1);
    }
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

  resolveShieldTrigger(use, targetUid) {
    if (this.pendingShieldTriggers.length === 0) return { ok: false };
    const item = this.pendingShieldTriggers.shift();
    const ps = this.players[item.side];
    if (!use) {
      this.logMsg(`${labelOf(item.side)}はS・トリガーを使用しなかった。`);
      return { ok: true };
    }
    const idx = ps.hand.findIndex(c => c.uid === item.uid);
    if (idx === -1) return { ok: false };
    const [inst] = ps.hand.splice(idx, 1);
    const def = getCard(inst.cardId);
    if (def.type === 'creature') {
      ps.battle.push({ uid: inst.uid, cardId: inst.cardId, tapped: false, sickness: true, turnBuff: 0 });
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を出した!`);
    } else {
      this.logMsg(`${labelOf(item.side)}はS・トリガーで${def.name}を唱えた!`);
      this.resolveEffects(item.side, cardEffects(def), { targetUid });
      ps.graveyard.push(inst);
    }
    return { ok: true };
  }

  // ---- ターン終了 ----
  endTurn() {
    if (this.isGameOver()) return;
    this.turnSide = this.opponent(this.turnSide);
    if (this.turnSide === this.firstSide) this.turnNumber++;
    this.logMsg(`--- ${labelOf(this.turnSide)}のターン${this.turnNumber} ---`);
    this.startTurn();
  }
}
