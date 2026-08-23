// CPU（相手）の簡易AIロジック
import { getCard } from "./cards.js";
import { canPlayCard, needsTarget, playCard, validAttackTargets, declareAttack, MAX_BOARD } from "./engine.js";

function chooseSpellTarget(game, side, effect) {
  const enemy = side === "player" ? "cpu" : "player";
  if (effect.target !== "select") return null;
  if (effect.type === "damage") {
    const enemyBoard = game.players[enemy].board;
    const killable = enemyBoard
      .filter((m) => m.hp <= effect.value)
      .sort((a, b) => b.atk - a.atk);
    if (killable.length) return { type: "minion", side: enemy, uid: killable[0].uid };
    return { type: "face", side: enemy };
  }
  if (effect.type === "heal") {
    const myBoard = game.players[side].board.filter((m) => m.hp < m.maxHp);
    if (myBoard.length) {
      myBoard.sort((a, b) => a.hp - b.hp);
      return { type: "minion", side, uid: myBoard[0].uid };
    }
    return { type: "face", side };
  }
  return { type: "face", side: enemy };
}

// 1回分の行動（カードプレイ・攻撃）ごとに、その間に追加されたログ行を添えてyieldする。
// battle.js側はこれを1ステップずつ受け取り、演出（再描画・待機）を挟みながら消費する。
function* playCpuCardsSteps(game, side) {
  const p = game.players[side];
  let playedSomething = true;
  while (playedSomething) {
    playedSomething = false;
    const playable = p.hand
      .map((h) => ({ h, card: getCard(h.cardId) }))
      .filter(({ h, card }) => canPlayCard(game, side, h.uid) && (card.type !== "minion" || p.board.length < MAX_BOARD))
      .sort((a, b) => b.card.cost - a.card.cost);
    if (!playable.length) break;
    const { h, card } = playable[0];
    let target = null;
    if (needsTarget(card)) {
      const effect = card.type === "minion" ? card.battlecry : card.effect;
      target = chooseSpellTarget(game, side, effect);
    }
    const before = game.log.length;
    if (playCard(game, side, h.uid, target)) {
      playedSomething = true;
      yield { lines: game.log.slice(before) };
    }
    if (game.winner) return;
  }
}

function* cpuAttackPhaseSteps(game, side) {
  const enemy = side === "player" ? "cpu" : "player";
  let acted = true;
  while (acted) {
    acted = false;
    const p = game.players[side];
    const attackers = p.board.filter((m) => !m.sick && !m.attacked);
    for (const attacker of attackers) {
      if (game.winner) return;
      const targets = validAttackTargets(game, side, attacker.uid);
      if (!targets.length) continue;

      const faceTarget = targets.find((t) => t.type === "face");
      const minionTargets = targets.filter((t) => t.type === "minion");
      let chosen = null;

      // 勝てる場合は顔を殴ってリーサルを狙う
      if (faceTarget) {
        const enemyFace = game.players[enemy].face;
        const totalAtk = attackers.filter((a) => !a.attacked).reduce((s, a) => s + a.atk, 0);
        if (totalAtk >= enemyFace.hp) chosen = faceTarget;
      }

      // 良いトレード（相手を倒せて自分は生き残る）を探す
      if (!chosen) {
        let bestTrade = null;
        for (const t of minionTargets) {
          const defender = game.players[enemy].board.find((m) => m.uid === t.uid);
          if (!defender) continue;
          const canKill = attacker.atk >= defender.hp;
          const survives = defender.atk < attacker.hp;
          if (canKill && survives) {
            if (!bestTrade || defender.atk > bestTrade.defenderAtk) {
              bestTrade = { target: t, defenderAtk: defender.atk };
            }
          }
        }
        if (bestTrade) chosen = bestTrade.target;
      }

      // 相手を倒せるなら相打ちでも脅威を除去
      if (!chosen) {
        let bestKill = null;
        for (const t of minionTargets) {
          const defender = game.players[enemy].board.find((m) => m.uid === t.uid);
          if (!defender) continue;
          if (attacker.atk >= defender.hp) {
            if (!bestKill || defender.atk > bestKill.defenderAtk) {
              bestKill = { target: t, defenderAtk: defender.atk };
            }
          }
        }
        if (bestKill) chosen = bestKill.target;
      }

      // 顔を殴れるなら殴る、挑発しかなければ最もHPが低い挑発を殴る
      if (!chosen) {
        if (faceTarget) {
          chosen = faceTarget;
        } else if (minionTargets.length) {
          chosen = [...minionTargets].sort((a, b) => {
            const da = game.players[enemy].board.find((m) => m.uid === a.uid);
            const db = game.players[enemy].board.find((m) => m.uid === b.uid);
            return (da?.hp ?? 0) - (db?.hp ?? 0);
          })[0];
        }
      }

      if (chosen) {
        const before = game.log.length;
        declareAttack(game, side, attacker.uid, chosen);
        acted = true;
        yield { lines: game.log.slice(before) };
      }
    }
  }
}

// CPUターンを1アクションずつ進めるジェネレーター。
export function* runCpuTurnSteps(game) {
  yield* playCpuCardsSteps(game, "cpu");
  if (game.winner) return;
  yield* cpuAttackPhaseSteps(game, "cpu");
}

// 演出なしで即座にCPUターンを解決する（従来互換のショートカット）。
export function runCpuTurn(game) {
  for (const _ of runCpuTurnSteps(game)) {
    // 何もしない: ジェネレーターを最後まで回すだけ
  }
}
