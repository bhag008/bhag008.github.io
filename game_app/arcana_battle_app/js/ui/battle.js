import { getCard } from "../cards.js";
import { getDeck, validateDeck, addGold, recordBattleResult } from "../state.js";
import {
  createGame, playCard, canPlayCard, needsTarget, declareAttack, validAttackTargets, endTurn,
} from "../engine.js";
import { runCpuTurn } from "../ai.js";
import { createCardEl, createMinionEl } from "./cardView.js";

const CPU_DECK = [
  "std_squire", "std_squire", "std_shield", "std_shield", "std_spark", "std_spark",
  "std_archer", "std_archer", "std_guard", "std_guard",
  "std_knight", "std_knight", "std_bear", "std_raider", "std_raider",
  "std_veteran", "std_veteran", "std_ogre", "std_fireball_small", "std_dragonet",
];

const WIN_GOLD = 25;
const LOSE_GOLD = 5;

let game = null;
let pending = null; // {kind:"attack", attackerUid} | {kind:"play", handUid, card}
let containerRef = null;
let ctxRef = null;
let locked = false;

export function render(container, ctx) {
  containerRef = container;
  ctxRef = ctx;
  const playerDeck = getDeck();
  const errors = validateDeck(playerDeck);
  if (errors.length) {
    container.innerHTML = `<p class="empty-note">${errors[0]}<br>先にデッキ編成を行ってください。</p>
      <button id="goDeckBtn" class="primary-btn">デッキ編成へ</button>`;
    container.querySelector("#goDeckBtn").addEventListener("click", () => ctx.navigate("deck"));
    return;
  }
  game = createGame(playerDeck, CPU_DECK);
  pending = null;
  locked = false;
  draw();
}

function opponentTargets() {
  if (!pending) return [];
  if (pending.kind === "attack") return validAttackTargets(game, "player", pending.attackerUid);
  if (pending.kind === "play") {
    const effect = pending.card.type === "minion" ? pending.card.battlecry : pending.card.effect;
    const enemy = "cpu";
    if (effect.type === "damage") {
      return [...game.players.cpu.board.map((m) => ({ type: "minion", side: "cpu", uid: m.uid })), { type: "face", side: "cpu" }];
    }
    if (effect.type === "heal") {
      return [...game.players.player.board.map((m) => ({ type: "minion", side: "player", uid: m.uid })), { type: "face", side: "player" }];
    }
  }
  return [];
}

function isTargetValid(target) {
  return opponentTargets().some((t) => t.type === target.type && (t.type === "face" ? t.side === target.side : t.uid === target.uid));
}

function draw() {
  const container = containerRef;
  if (!game) return;
  const p = game.players.player;
  const c = game.players.cpu;
  const targets = pending ? opponentTargets() : [];
  const targetableUids = new Set(targets.filter((t) => t.type === "minion").map((t) => t.uid));
  const enemyFaceTargetable = targets.some((t) => t.type === "face" && t.side === "cpu");
  const selfFaceTargetable = targets.some((t) => t.type === "face" && t.side === "player");

  container.innerHTML = `
    <div class="battle-area">
      <div class="enemy-info-row">
        <div class="face-zone enemy-face ${enemyFaceTargetable ? "targetable" : ""}" id="enemyFace">
          <span class="face-emoji">🧟</span>
          <span class="face-hp">${Math.max(0, c.face.hp)}</span>
        </div>
        <div class="deck-count">🂠 ${c.deck.length}</div>
        <div class="hand-count">✋ ${c.hand.length}</div>
      </div>

      <div class="board-row enemy-board" id="enemyBoard"></div>

      <div class="mid-row">
        <div class="turn-indicator">${game.active === "player" ? "あなたのターン" : "相手のターン"} (${game.turnNumber})</div>
        <div class="mana-display">💧 ${p.mana.current}/${p.mana.max}</div>
        <button id="endTurnBtn" class="primary-btn end-turn-btn" ${game.active !== "player" || locked ? "disabled" : ""}>ターン終了</button>
      </div>

      <div class="board-row player-board" id="playerBoard"></div>

      <div class="face-zone player-face ${selfFaceTargetable ? "targetable" : ""}" id="playerFace">
        <span class="face-emoji">🧙</span>
        <span class="face-hp">${Math.max(0, p.face.hp)}</span>
        <span class="deck-count">🂠 ${p.deck.length}</span>
      </div>

      <div class="hand-row" id="handRow"></div>
      <div class="battle-log" id="battleLog"></div>
    </div>
  `;

  const enemyBoard = container.querySelector("#enemyBoard");
  for (const m of c.board) {
    const el = createMinionEl(m);
    el.classList.remove("can-attack", "no-attack");
    if (targetableUids.has(m.uid)) el.classList.add("targetable");
    el.addEventListener("click", () => handleTargetClick({ type: "minion", side: "cpu", uid: m.uid }));
    enemyBoard.appendChild(el);
  }

  const playerBoard = container.querySelector("#playerBoard");
  for (const m of p.board) {
    const el = createMinionEl(m);
    if (pending && pending.kind === "attack" && pending.attackerUid === m.uid) el.classList.add("selected");
    if (targetableUids.has(m.uid)) el.classList.add("targetable");
    el.addEventListener("click", () => handlePlayerMinionClick(m));
    playerBoard.appendChild(el);
  }

  const handRow = container.querySelector("#handRow");
  for (const item of p.hand) {
    const cardDef = getCard(item.cardId);
    const affordable = canPlayCard(game, "player", item.uid);
    const el = createCardEl(cardDef, { small: true, disabled: !affordable && game.active === "player" });
    if (pending && pending.kind === "play" && pending.handUid === item.uid) el.classList.add("selected");
    el.addEventListener("click", () => handleHandCardClick(item, cardDef));
    handRow.appendChild(el);
  }

  const logEl = container.querySelector("#battleLog");
  logEl.innerHTML = game.log.slice(-6).map((l) => `<div>${l}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;

  container.querySelector("#enemyFace").addEventListener("click", () => handleTargetClick({ type: "face", side: "cpu" }));
  container.querySelector("#playerFace").addEventListener("click", () => handleTargetClick({ type: "face", side: "player" }));

  const endTurnBtn = container.querySelector("#endTurnBtn");
  if (endTurnBtn) endTurnBtn.addEventListener("click", handleEndTurn);

  if (game.winner) showResultModal();
}

function handlePlayerMinionClick(m) {
  if (locked || game.active !== "player" || game.winner) return;
  if (pending && pending.kind === "attack" && pending.attackerUid === m.uid) {
    pending = null;
    draw();
    return;
  }
  if (m.sick || m.attacked) return;
  pending = { kind: "attack", attackerUid: m.uid };
  draw();
}

function handleHandCardClick(item, cardDef) {
  if (locked || game.active !== "player" || game.winner) return;
  if (pending && pending.kind === "play" && pending.handUid === item.uid) {
    pending = null;
    draw();
    return;
  }
  if (!canPlayCard(game, "player", item.uid)) return;
  if (needsTarget(cardDef)) {
    pending = { kind: "play", handUid: item.uid, card: cardDef };
    draw();
  } else {
    playCard(game, "player", item.uid, null);
    pending = null;
    draw();
  }
}

function handleTargetClick(target) {
  if (!pending || locked || game.winner) return;
  if (!isTargetValid(target)) return;
  if (pending.kind === "attack") {
    declareAttack(game, "player", pending.attackerUid, target);
  } else if (pending.kind === "play") {
    playCard(game, "player", pending.handUid, target);
  }
  pending = null;
  draw();
}

function handleEndTurn() {
  if (locked || game.active !== "player" || game.winner) return;
  pending = null;
  locked = true;
  draw();
  setTimeout(() => {
    endTurn(game); // -> CPUのターン開始
    if (!game.winner) runCpuTurn(game);
    if (!game.winner) endTurn(game); // -> プレイヤーのターンへ
    locked = false;
    draw();
  }, 450);
}

function showResultModal() {
  const container = containerRef;
  const won = game.winner === "player";
  const gold = won ? WIN_GOLD : LOSE_GOLD;
  recordBattleResult(won);
  addGold(gold);
  ctxRef.refreshGold();

  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2>${won ? "勝利！ 🎉" : "敗北…"}</h2>
      <p class="modal-note">${won ? "対戦に勝利しました。" : "対戦に敗北しました。"}<br>獲得ゴールド: +${gold}G</p>
      <div class="modal-actions">
        <button id="resultHomeBtn" class="primary-btn">ホームに戻る</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);
  overlay.querySelector("#resultHomeBtn").addEventListener("click", () => ctxRef.navigate("home"));
}
