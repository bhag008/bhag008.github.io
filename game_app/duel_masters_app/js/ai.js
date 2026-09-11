// CPU(相手)の簡易AIロジック: マナチャージ・プレイ・攻撃・ブロック・S・トリガー使用の判断
import { getCard, isBlocker } from './cards.js';

function candidatePower(engine, uid) {
  const owner = engine.ownerOfCreature(uid);
  if (!owner) return 0;
  const c = engine.players[owner].battle.find((x) => x.uid === uid);
  return c ? engine.powerBase(owner, c) : 0;
}

// 対象候補を効果の意図に応じて並べ替える(強い敵を狙う/弱い自分を生贄にする、等)
function sortCandidates(engine, side, spec, candidates) {
  let pool = [...candidates];
  if (spec.kind === 'enemyCreature') {
    pool.sort((a, b) => candidatePower(engine, b) - candidatePower(engine, a));
  } else if (spec.kind === 'anyCreature') {
    // 自分のクリーチャーを巻き込むメリットは基本無いため、相手のクリーチャーのみを対象にする
    const opp = engine.opponent(side);
    pool = pool.filter((uid) => engine.ownerOfCreature(uid) === opp);
    pool.sort((a, b) => candidatePower(engine, b) - candidatePower(engine, a));
  } else if (spec.kind === 'ownCreature') {
    if (spec.intent === 'harmful') pool.sort((a, b) => candidatePower(engine, a) - candidatePower(engine, b));
    else pool.sort((a, b) => candidatePower(engine, b) - candidatePower(engine, a));
  } else if (spec.kind === 'ownGraveyardCreature') {
    pool.sort((a, b) => {
      const oa = engine.players[side].graveyard.find((x) => x.uid === a);
      const ob = engine.players[side].graveyard.find((x) => x.uid === b);
      return getCard(ob.cardId).cost - getCard(oa.cardId).cost;
    });
  } else if (spec.kind === 'ownHandCard') {
    pool.sort((a, b) => {
      const oa = engine.players[side].hand.find((x) => x.uid === a);
      const ob = engine.players[side].hand.find((x) => x.uid === b);
      return getCard(oa.cardId).cost - getCard(ob.cardId).cost;
    });
  } else if (spec.kind === 'ownGraveyardCard') {
    pool.sort((a, b) => {
      const oa = engine.players[side].graveyard.find((x) => x.uid === a);
      const ob = engine.players[side].graveyard.find((x) => x.uid === b);
      return getCard(ob.cardId).cost - getCard(oa.cardId).cost;
    });
  } else if (spec.kind === 'deckTutor') {
    pool.sort((a, b) => {
      const oa = engine.players[side].deck.find((x) => x.uid === a);
      const ob = engine.players[side].deck.find((x) => x.uid === b);
      return getCard(ob.cardId).cost - getCard(oa.cardId).cost;
    });
  } else if (spec.kind === 'enemyManaCard') {
    pool.sort((a, b) => {
      const oa = engine.players[engine.opponent(side)].mana.find((x) => x.uid === a);
      const ob = engine.players[engine.opponent(side)].mana.find((x) => x.uid === b);
      return getCard(ob.cardId).cost - getCard(oa.cardId).cost;
    });
  } else if (spec.kind === 'ownManaCard') {
    pool.sort((a, b) => {
      const oa = engine.players[side].mana.find((x) => x.uid === a);
      const ob = engine.players[side].mana.find((x) => x.uid === b);
      const diff = getCard(oa.cardId).cost - getCard(ob.cardId).cost;
      return spec.intent === 'harmful' ? diff : -diff;
    });
  } else if (spec.kind === 'shieldQuantity') {
    const maxQty = Math.max(...pool);
    const desired = Math.min(2, maxQty);
    pool.sort((a, b) => (a === desired ? -1 : b === desired ? 1 : 0));
  }
  return pool;
}

// CPUの対象選択: 常に(意図に沿った優先順で)上限枚数まで選ぶ。空きが無ければ0枚のまま。
function chooseTargetsForCpu(engine, side, spec) {
  if (!spec) return [];
  const candidates = engine.getTargetCandidates(side, spec);
  if (!candidates || candidates.length === 0) return [];
  const pool = sortCandidates(engine, side, spec, candidates);
  const max = typeof spec.max === 'function' ? spec.max(engine, side) : (spec.max ?? 1);
  return pool.slice(0, Math.min(max, pool.length));
}

function decideHoldBack(engine, side, attackers) {
  const blockerCandidates = attackers.filter((a) => isBlocker(engine.cardOf(a)));
  if (blockerCandidates.length === 0) return [];
  const opp = engine.opponent(side);
  const oppBoard = engine.players[opp].battle;
  const oppShields = engine.players[opp].shields.length;
  const canLikelyLethal = oppShields === 0 || attackers.length > oppShields;
  if (oppBoard.length > 0 && !canLikelyLethal) {
    const weakest = [...blockerCandidates].sort((a, b) => engine.powerBase(side, a) - engine.powerBase(side, b))[0];
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
    const playable = ps.hand.filter((c) => {
      const def = getCard(c.cardId);
      if (!engine.canPayCost(side, def)) return false;
      if (def.evolution) return engine.getEvolutionTargets(side, def).length > 0;
      return true;
    });
    if (playable.length === 0) break;
    playable.sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
    const chosen = playable[0];
    const def = getCard(chosen.cardId);

    if (def.evolution) {
      // 進化元は、進化させたときに最も強化幅が大きくなる(現在のパワーが低い)ものを選ぶ
      const targets = engine.getEvolutionTargets(side, def);
      targets.sort((a, b) => {
        const ca = engine.players[side].battle.find((s) => s.uid === a);
        const cb = engine.players[side].battle.find((s) => s.uid === b);
        return engine.powerBase(side, ca) - engine.powerBase(side, cb);
      });
      const result = engine.playEvolutionCard(side, chosen.uid, targets[0]);
      if (result.awaitingCipTarget) {
        const spec = engine.pendingCip.ability.target;
        engine.resolveCip(chooseTargetsForCpu(engine, side, spec));
      }
    } else if (def.type === 'spell') {
      const targetUids = def.spell?.target ? chooseTargetsForCpu(engine, side, def.spell.target) : [];
      engine.playCard(side, chosen.uid, { targetUids });
    } else {
      const result = engine.playCard(side, chosen.uid, {});
      if (result.awaitingCipTarget) {
        const spec = engine.pendingCip.ability.target;
        const targetUids = chooseTargetsForCpu(engine, side, spec);
        engine.resolveCip(targetUids);
      }
    }
    played = true;
    yield { type: 'play', cardId: chosen.cardId };
    if (engine.isGameOver()) return;
  }

  engine.enterAttackPhase();
  yield { type: 'attackPhase' };

  engine.runForcedAttackers(side);
  yield { type: 'forcedAttacks' };
  if (engine.isGameOver()) return;

  let attackers = engine.eligibleAttackers(side);
  const holdBack = decideHoldBack(engine, side, attackers);
  attackers = attackers.filter((a) => !holdBack.includes(a.uid));
  attackers.sort((a, b) => engine.powerBase(side, b) - engine.powerBase(side, a));

  for (const atk of attackers) {
    if (engine.isGameOver()) return;
    const stillThere = engine.players[side].battle.find((c) => c.uid === atk.uid && !c.tapped && !c.sickness);
    if (!stillThere) continue;
    let result = engine.declareAttack(side, atk.uid, { type: 'player' });
    if (result.awaitingAttackTrigger) {
      const spec = engine.pendingAttackTrigger.ability.target;
      result = engine.resolveAttackTrigger(chooseTargetsForCpu(engine, side, spec));
    }
    yield { type: 'attack', attackerUid: atk.uid, result };
    if (engine.isGameOver()) return;
  }

  yield { type: 'attacksDone' };
}

// プレイヤーがCPUに攻撃してきた際、CPU側のブロック判断を即座に返す
export function chooseBlockForCPU(engine, attackerUid) {
  if (!engine.pendingBlock) return null;
  const attackerInst = engine.players.player.battle.find((c) => c.uid === attackerUid);
  const atkPower = attackerInst ? engine.powerWhileAttacking('player', attackerInst) : 0;
  const blockers = engine.pendingBlock.eligibleBlockers
    .map((uid) => engine.players.cpu.battle.find((c) => c.uid === uid))
    .filter(Boolean);
  if (blockers.length === 0) return null;
  const shieldsLeft = engine.players.cpu.shields.length;
  const winning = blockers.filter((b) => engine.powerBase('cpu', b) >= atkPower);
  if (winning.length > 0) {
    winning.sort((a, b) => engine.powerBase('cpu', a) - engine.powerBase('cpu', b));
    return winning[0].uid;
  }
  if (shieldsLeft <= 2) {
    const sorted = [...blockers].sort((a, b) => engine.powerBase('cpu', a) - engine.powerBase('cpu', b));
    return sorted[0].uid;
  }
  return null;
}

// CPUのシールドがブレイクされた際、S・トリガーを使うかどうかを自動で決めて解決する
export function autoResolveShieldTriggers(engine, forSide) {
  while (engine.pendingShieldTriggers.length > 0 && engine.pendingShieldTriggers[0].side === forSide) {
    const item = engine.pendingShieldTriggers[0];
    const def = getCard(item.cardId);
    const ability = def.type === 'creature' ? def.onPlay : def.spell;
    const targetUids = ability?.target ? chooseTargetsForCpu(engine, forSide, ability.target) : [];
    const needsMandatoryTarget = ability?.target && (ability.target.min ?? 0) > 0;
    const use = !needsMandatoryTarget || targetUids.length > 0;
    engine.resolveShieldTrigger(use, targetUids);
  }
}
