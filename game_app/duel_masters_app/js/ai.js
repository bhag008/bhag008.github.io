// CPU(相手)の簡易AIロジック: マナチャージ・プレイ・攻撃・ブロック・S・トリガー使用の判断
import { getCard, cardEffects, isBlocker } from './cards.js';

function effectNeedsTarget(def) {
  return cardEffects(def).some(e =>
    e.type === 'destroy' || e.type === 'bounce' || e.type === 'returnFromGraveyard' || e.type === 'buffPower');
}

// カードの効果に応じて最も価値の高いターゲットを選ぶ
function chooseTargetForCard(engine, side, def) {
  const candidates = engine.getValidTargetUids(side, def);
  if (!candidates || candidates.length === 0) return null;
  const effs = cardEffects(def);
  const eff = effs.find(e => e.type === 'destroy' || e.type === 'bounce' || e.type === 'returnFromGraveyard' || e.type === 'buffPower');
  if (!eff) return null;
  const opp = engine.opponent(side);

  if (eff.type === 'destroy' || eff.type === 'bounce') {
    const pool = engine.players[opp].battle.filter(c => candidates.includes(c.uid));
    pool.sort((a, b) => getCard(b.cardId).power - getCard(a.cardId).power);
    return pool[0]?.uid ?? null;
  }
  if (eff.type === 'returnFromGraveyard') {
    const pool = engine.players[side].graveyard.filter(c => candidates.includes(c.uid));
    pool.sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
    return pool[0]?.uid ?? null;
  }
  if (eff.type === 'buffPower') {
    const pool = engine.players[side].battle.filter(c => candidates.includes(c.uid) && !c.tapped && !c.sickness);
    const finalPool = pool.length ? pool : engine.players[side].battle.filter(c => candidates.includes(c.uid));
    finalPool.sort((a, b) => getCard(b.cardId).power - getCard(a.cardId).power);
    return finalPool[0]?.uid ?? null;
  }
  return null;
}

function decideHoldBack(engine, side, attackers) {
  const blockerCandidates = attackers.filter(a => isBlocker(getCard(a.cardId)));
  if (blockerCandidates.length === 0) return [];
  const opp = engine.opponent(side);
  const oppBoard = engine.players[opp].battle;
  const oppShields = engine.players[opp].shields.length;
  const canLikelyLethal = oppShields === 0 || attackers.length > oppShields;
  if (oppBoard.length > 0 && !canLikelyLethal) {
    const weakest = [...blockerCandidates].sort((a, b) => getCard(a.cardId).power - getCard(b.cardId).power)[0];
    return [weakest.uid];
  }
  return [];
}

// CPUの1ターン分の行動を1ステップずつ進めるジェネレータ。
// 呼び出し側(main.js)は next() のたびに再描画し、pendingBlock / pendingShieldTriggers があれば
// プレイヤーの判断を待ってから次の next() を呼ぶ。
export function* cpuTurnSteps(engine) {
  const side = 'cpu';

  if (!engine.manaChargedThisTurn) {
    const ps = engine.players[side];
    if (ps.hand.length > 0) {
      const civCounts = {};
      for (const m of ps.mana) {
        const c = getCard(m.cardId).civ;
        civCounts[c] = (civCounts[c] || 0) + 1;
      }
      const sorted = [...ps.hand].sort((a, b) => {
        const da = getCard(a.cardId), db = getCard(b.cardId);
        if (da.cost !== db.cost) return da.cost - db.cost;
        return (civCounts[da.civ] || 0) - (civCounts[db.civ] || 0);
      });
      engine.chargeMana(side, sorted[0].uid);
      yield { type: 'mana' };
    }
  }

  let played = true;
  while (played) {
    played = false;
    const ps = engine.players[side];
    const playable = ps.hand.filter(c => engine.canPayCost(side, getCard(c.cardId)));
    if (playable.length === 0) break;
    playable.sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
    const chosen = playable[0];
    const def = getCard(chosen.cardId);
    const targetUid = effectNeedsTarget(def) ? chooseTargetForCard(engine, side, def) : null;
    engine.playCard(side, chosen.uid, targetUid != null ? { targetUid } : {});
    played = true;
    yield { type: 'play', cardId: chosen.cardId };
    if (engine.isGameOver()) return;
  }

  engine.enterAttackPhase();
  yield { type: 'attackPhase' };

  let attackers = engine.eligibleAttackers(side);
  const holdBack = decideHoldBack(engine, side, attackers);
  attackers = attackers.filter(a => !holdBack.includes(a.uid));
  attackers.sort((a, b) => getCard(b.cardId).power - getCard(a.cardId).power);

  for (const atk of attackers) {
    if (engine.isGameOver()) return;
    const stillThere = engine.players[side].battle.find(c => c.uid === atk.uid && !c.tapped && !c.sickness);
    if (!stillThere) continue;
    const result = engine.declareAttack(side, atk.uid, { type: 'player' });
    yield { type: 'attack', attackerUid: atk.uid, result };
    if (engine.isGameOver()) return;
  }

  yield { type: 'attacksDone' };
}

// プレイヤーがCPUに攻撃してきた際、CPU側のブロック判断を即座に返す
export function chooseBlockForCPU(engine, attackerUid) {
  const attacker = engine.players.player.battle.find(c => c.uid === attackerUid);
  if (!attacker) return null;
  const atkPower = getCard(attacker.cardId).power + (attacker.turnBuff || 0);
  const blockers = engine.players.cpu.battle.filter(c => !c.tapped && isBlocker(getCard(c.cardId)));
  if (blockers.length === 0) return null;
  const shieldsLeft = engine.players.cpu.shields.length;
  const winning = blockers.filter(b => getCard(b.cardId).power >= atkPower);
  if (winning.length > 0) {
    winning.sort((a, b) => getCard(a.cardId).power - getCard(b.cardId).power);
    return winning[0].uid;
  }
  if (shieldsLeft <= 2) {
    const sorted = [...blockers].sort((a, b) => getCard(a.cardId).power - getCard(b.cardId).power);
    return sorted[0].uid;
  }
  return null;
}

// CPUのシールドがブレイクされた際、S・トリガーを使うかどうかを自動で決めて解決する
export function autoResolveShieldTriggers(engine, forSide) {
  while (engine.pendingShieldTriggers.length > 0 && engine.pendingShieldTriggers[0].side === forSide) {
    const item = engine.pendingShieldTriggers[0];
    const def = getCard(item.cardId);
    const needsTarget = effectNeedsTarget(def);
    const targetUid = needsTarget ? chooseTargetForCard(engine, forSide, def) : null;
    const use = def.type === 'creature' || !needsTarget || targetUid != null;
    engine.resolveShieldTrigger(use, targetUid);
  }
}
