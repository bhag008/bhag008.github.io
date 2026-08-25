// バトルエンジン: ターン制TCGバトルのゲーム状態・ルール処理
import { getCard, TOKENS } from "./cards.js";

export const MAX_BOARD = 5;
export const MAX_HAND = 8;
export const START_HP = 25;
export const MAX_MANA = 10;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makePlayerState(deckIds) {
  return {
    face: { hp: START_HP, maxHp: START_HP },
    mana: { current: 0, max: 0 },
    deck: shuffle(deckIds),
    hand: [],
    board: [],
    fatigue: 0,
    turnsTaken: 0,
  };
}

export function createGame(playerDeckIds, cpuDeckIds) {
  const game = {
    turnNumber: 1,
    active: "player",
    players: {
      player: makePlayerState(playerDeckIds),
      cpu: makePlayerState(cpuDeckIds),
    },
    log: [],
    winner: null,
    nextUid: 1,
    pendingAction: null, // {type:"attack", attackerUid} | {type:"cast", handUid, card}
  };

  for (let i = 0; i < 3; i++) drawCard(game, "player");
  for (let i = 0; i < 4; i++) drawCard(game, "cpu");

  game.players.player.mana = { current: 1, max: 1 };
  addLog(game, "対戦開始！ あなたの先攻です。");
  return game;
}

function addLog(game, text) {
  game.log.push(text);
  if (game.log.length > 200) game.log.shift();
}

function opponentOf(side) {
  return side === "player" ? "cpu" : "player";
}

export function drawCard(game, side) {
  const p = game.players[side];
  if (game.winner) return;
  if (p.deck.length === 0) {
    p.fatigue += 1;
    p.face.hp -= p.fatigue;
    addLog(game, `${side === "player" ? "あなた" : "相手"}はデッキ切れで${p.fatigue}ダメージを受けた！`);
    checkWin(game);
    return;
  }
  const cardId = p.deck.pop();
  if (p.hand.length >= MAX_HAND) {
    addLog(game, `${side === "player" ? "あなた" : "相手"}の手札が上限のためカードが失われた`);
    return;
  }
  p.hand.push({ uid: game.nextUid++, cardId });
}

function clampHp(unit) {
  if (unit.hp > unit.maxHp) unit.hp = unit.maxHp;
}

function dealDamageToFace(game, side, amount) {
  const face = game.players[side].face;
  face.hp -= amount;
  checkWin(game);
}

function healFace(game, side, amount) {
  const face = game.players[side].face;
  face.hp = Math.min(face.maxHp, face.hp + amount);
}

function findMinion(game, side, uid) {
  return game.players[side].board.find((m) => m.uid === uid);
}

function removeDeadMinions(game) {
  // デスラトルが連鎖でさらに破壊を生むことがあるためループする
  let more = true;
  while (more) {
    more = false;
    for (const side of ["player", "cpu"]) {
      const p = game.players[side];
      const dead = p.board.filter((m) => m.hp <= 0);
      if (!dead.length) continue;
      more = true;
      p.board = p.board.filter((m) => m.hp > 0);
      for (const d of dead) {
        addLog(game, `${d.name} が破壊された`);
        const card = getCard(d.cardId);
        if (card && card.deathrattle) {
          applyEffectOnly(game, side, card.deathrattle, null, d.uid);
        }
      }
    }
  }
}

export function checkWin(game) {
  if (game.winner) return;
  if (game.players.player.face.hp <= 0) {
    game.winner = "cpu";
    addLog(game, "あなたは敗北した…");
  } else if (game.players.cpu.face.hp <= 0) {
    game.winner = "player";
    addLog(game, "勝利！");
  }
}

// -------------------- 効果解決 --------------------
// target: null | {type:"face", side} | {type:"minion", side, uid}
export function resolveEffect(game, side, effect, target, sourceUid) {
  applyEffectOnly(game, side, effect, target, sourceUid);
  removeDeadMinions(game);
  checkWin(game);
}

// removeDeadMinions/checkWinを呼ばない内部版。デスラトルや攻撃時トリガーなど、
// 呼び出し元が後でまとめて後処理する場面で使う（多重呼び出しによる無限ループを避けるため）。
function applyEffectOnly(game, side, effect, target, sourceUid) {
  const enemy = opponentOf(side);
  switch (effect.type) {
    case "damage": {
      const t = resolveTargetRef(effect.target, side, target);
      applyDamage(game, t, effect.value);
      break;
    }
    case "heal": {
      const t = resolveTargetRef(effect.target, side, target);
      applyHeal(game, t, effect.value);
      break;
    }
    case "draw": {
      for (let i = 0; i < effect.value; i++) drawCard(game, side);
      break;
    }
    case "damage_all_enemy": {
      for (const m of [...game.players[enemy].board]) {
        applyDamage(game, { type: "minion", side: enemy, uid: m.uid }, effect.value);
      }
      break;
    }
    case "summon_token": {
      for (let i = 0; i < effect.count; i++) {
        summonToken(game, side, effect.token);
      }
      break;
    }
    case "self_damage_draw": {
      applyDamage(game, { type: "face", side }, effect.damage);
      for (let i = 0; i < effect.draw; i++) drawCard(game, side);
      break;
    }
    case "pact_nuke": {
      applyDamage(game, { type: "face", side }, effect.selfDamage);
      for (let i = 0; i < effect.draw; i++) drawCard(game, side);
      for (const m of [...game.players[side].board]) {
        if (m.uid === sourceUid) continue;
        applyDamage(game, { type: "minion", side, uid: m.uid }, effect.boardDamage);
      }
      for (const m of [...game.players[enemy].board]) {
        applyDamage(game, { type: "minion", side: enemy, uid: m.uid }, effect.boardDamage);
      }
      break;
    }
    case "discard_random_enemy": {
      const enemyHand = game.players[enemy].hand;
      const count = Math.min(effect.count, enemyHand.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * enemyHand.length);
        const [removed] = enemyHand.splice(idx, 1);
        const card = getCard(removed.cardId);
        addLog(game, `${enemy === "player" ? "あなた" : "相手"}は「${card?.name || "カード"}」を手札から捨てた`);
      }
      break;
    }
    case "damage_monster_and_self": {
      const t = resolveTargetRef(effect.target, side, target);
      applyDamage(game, t, effect.value);
      applyDamage(game, { type: "face", side }, effect.selfDamage);
      break;
    }
    case "damage_all_enemy_and_draw": {
      for (const m of [...game.players[enemy].board]) {
        applyDamage(game, { type: "minion", side: enemy, uid: m.uid }, effect.value);
      }
      for (let i = 0; i < effect.draw; i++) drawCard(game, side);
      break;
    }
    case "heal_and_draw": {
      const t = resolveTargetRef(effect.target, side, target);
      applyHeal(game, t, effect.value);
      for (let i = 0; i < effect.draw; i++) drawCard(game, side);
      break;
    }
    default:
      break;
  }
}

function resolveTargetRef(targetKind, side, explicitTarget) {
  const enemy = opponentOf(side);
  if (targetKind === "select" || targetKind === "select_monster") return explicitTarget;
  if (targetKind === "enemy_face") return { type: "face", side: enemy };
  if (targetKind === "self_face") return { type: "face", side };
  return null;
}

function applyDamage(game, target, value) {
  if (!target) return;
  if (target.type === "face") {
    dealDamageToFace(game, target.side, value);
    addLog(game, `${target.side === "player" ? "あなた" : "相手"}に${value}ダメージ`);
  } else {
    const m = findMinion(game, target.side, target.uid);
    if (m) {
      m.hp -= value;
      addLog(game, `${m.name} に${value}ダメージ`);
    }
  }
}

function applyHeal(game, target, value) {
  if (!target) return;
  if (target.type === "face") {
    healFace(game, target.side, value);
  } else {
    const m = findMinion(game, target.side, target.uid);
    if (m) {
      m.hp = Math.min(m.maxHp, m.hp + value);
    }
  }
}

function summonToken(game, side, tokenId) {
  const p = game.players[side];
  if (p.board.length >= MAX_BOARD) return;
  const t = TOKENS[tokenId];
  p.board.push({
    uid: game.nextUid++,
    cardId: tokenId,
    name: t.name,
    emoji: t.emoji,
    atk: t.atk,
    hp: t.hp,
    maxHp: t.hp,
    cost: 0,
    rarity: "basic",
    text: "",
    keywords: [...t.keywords],
    sick: true,
    attacked: false,
  });
}

// -------------------- カードプレイ --------------------
export function canPlayCard(game, side, handUid) {
  if (game.active !== side || game.winner) return false;
  const p = game.players[side];
  const item = p.hand.find((h) => h.uid === handUid);
  if (!item) return false;
  const card = getCard(item.cardId);
  if (!card) return false;
  if (card.cost > p.mana.current) return false;
  if (card.type === "minion" && p.board.length >= MAX_BOARD) return false;
  return true;
}

export function needsTarget(card) {
  const eff = card.type === "minion" ? card.battlecry : card.effect;
  return !!eff && (eff.target === "select" || eff.target === "select_monster");
}

export function playCard(game, side, handUid, target) {
  const p = game.players[side];
  const idx = p.hand.findIndex((h) => h.uid === handUid);
  if (idx === -1) return false;
  const item = p.hand[idx];
  const card = getCard(item.cardId);
  if (!canPlayCard(game, side, handUid)) return false;

  p.mana.current -= card.cost;
  p.hand.splice(idx, 1);

  if (card.type === "minion") {
    const minion = {
      uid: game.nextUid++,
      cardId: card.id,
      name: card.name,
      emoji: card.emoji,
      atk: card.atk,
      hp: card.hp,
      maxHp: card.hp,
      cost: card.cost,
      rarity: card.rarity,
      text: card.text,
      keywords: [...card.keywords],
      sick: !card.keywords.includes("charge"),
      attacked: false,
    };
    p.board.push(minion);
    addLog(game, `${side === "player" ? "あなた" : "相手"}が「${card.name}」を場に出した`);
    if (card.battlecry) {
      resolveEffect(game, side, card.battlecry, target, minion.uid);
    }
  } else {
    addLog(game, `${side === "player" ? "あなた" : "相手"}が「${card.name}」を使用した`);
    if (card.effect) {
      resolveEffect(game, side, card.effect, target);
    }
  }
  removeDeadMinions(game);
  checkWin(game);
  return true;
}

// -------------------- 攻撃 --------------------
export function enemyHasTaunt(game, side) {
  const enemy = opponentOf(side);
  return game.players[enemy].board.some((m) => m.keywords.includes("taunt"));
}

export function validAttackTargets(game, side, attackerUid) {
  const attacker = findMinion(game, side, attackerUid);
  if (!attacker || attacker.sick || attacker.attacked) return [];
  const enemy = opponentOf(side);
  const board = game.players[enemy].board;
  const taunts = board.filter((m) => m.keywords.includes("taunt"));
  const minionTargets = (taunts.length ? taunts : board).map((m) => ({ type: "minion", side: enemy, uid: m.uid }));
  const targets = [...minionTargets];
  if (!taunts.length) targets.push({ type: "face", side: enemy });
  return targets;
}

export function declareAttack(game, side, attackerUid, target) {
  if (game.active !== side || game.winner) return false;
  const attacker = findMinion(game, side, attackerUid);
  if (!attacker || attacker.sick || attacker.attacked) return false;
  const valid = validAttackTargets(game, side, attackerUid);
  const isValid = valid.some((t) => t.type === target.type && (t.type === "face" || t.uid === target.uid));
  if (!isValid) return false;

  attacker.attacked = true;
  const attackerLifesteal = attacker.keywords.includes("lifesteal");

  let defenderUid = null;
  if (target.type === "face") {
    dealDamageToFace(game, target.side, attacker.atk);
    if (attackerLifesteal) healFace(game, side, attacker.atk);
    addLog(game, `${attacker.name} が相手に${attacker.atk}ダメージ`);
  } else {
    const defender = findMinion(game, target.side, target.uid);
    if (!defender) return false;
    defenderUid = defender.uid;
    const defenderLifesteal = defender.keywords.includes("lifesteal");
    defender.hp -= attacker.atk;
    attacker.hp -= defender.atk;
    if (attackerLifesteal) healFace(game, side, attacker.atk);
    if (defenderLifesteal) healFace(game, target.side, defender.atk);
    addLog(game, `${attacker.name} と ${defender.name} が戦闘`);
  }

  // 攻撃時・被攻撃時トリガー（このミニオンが破壊されていても、攻撃/被弾自体は発生している）
  const attackerCard = getCard(attacker.cardId);
  if (attackerCard && attackerCard.onAttack) {
    applyEffectOnly(game, side, attackerCard.onAttack, null, attacker.uid);
  }
  if (defenderUid !== null) {
    const defender = findMinion(game, target.side, defenderUid);
    if (defender) {
      const defenderCard = getCard(defender.cardId);
      if (defenderCard && defenderCard.onDefend) {
        applyEffectOnly(game, target.side, defenderCard.onDefend, null, defenderUid);
      }
    }
  }

  removeDeadMinions(game);
  checkWin(game);
  return true;
}

// -------------------- ターン管理 --------------------
export function startTurn(game, side) {
  const p = game.players[side];
  p.turnsTaken += 1;
  p.mana.max = Math.min(MAX_MANA, p.mana.max + 1);
  p.mana.current = p.mana.max;
  for (const m of p.board) {
    m.sick = false;
    m.attacked = false;
  }
  drawCard(game, side);
  addLog(game, `--- ${side === "player" ? "あなた" : "相手"}のターン${game.turnNumber} ---`);
}

export function endTurn(game) {
  if (game.winner) return;
  const next = opponentOf(game.active);
  game.active = next;
  if (next === "player") game.turnNumber += 1;
  startTurn(game, next);
}
