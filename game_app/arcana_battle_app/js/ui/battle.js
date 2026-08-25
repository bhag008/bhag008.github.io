import { getCard } from "../cards.js";
import { getDeck, validateDeck, addGold, recordBattleResult } from "../state.js";
import {
  createGame, playCard, canPlayCard, needsTarget, declareAttack, validAttackTargets, endTurn,
} from "../engine.js";
import { runCpuTurnSteps } from "../ai.js";
import { getOpponent } from "../opponents.js";
import { getSelectedOpponentId } from "../selection.js";
import { createCardEl, createMinionEl } from "./cardView.js";

const SETTINGS_KEY = "arcanabattle.battleSettings";
const SPEED_MS = { slow: 1000, normal: 500, fast: 200 };
const SPEED_LABEL = { slow: "スロー", normal: "通常", fast: "倍速" };

function loadBattleSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { effectsOn: true, speed: "normal", ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { effectsOn: true, speed: "normal" };
  }
}

function saveBattleSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let battleSettings = loadBattleSettings();

let opponent = null;
let game = null;
let pending = null; // {kind:"attack", attackerUid} | {kind:"play", handUid, card}
let containerRef = null;
let ctxRef = null;
let locked = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  opponent = getOpponent(getSelectedOpponentId());
  game = createGame(playerDeck, opponent.deck);
  pending = null;
  locked = false;
  draw();
}

function opponentTargets() {
  if (!pending) return [];
  if (pending.kind === "attack") return validAttackTargets(game, "player", pending.attackerUid);
  if (pending.kind === "play") {
    const effect = pending.card.type === "minion" ? pending.card.battlecry : pending.card.effect;
    if (effect.type === "damage" || effect.type === "damage_monster_and_self") {
      const minionTargets = game.players.cpu.board.map((m) => ({ type: "minion", side: "cpu", uid: m.uid }));
      if (effect.target === "select_monster") return minionTargets;
      return [...minionTargets, { type: "face", side: "cpu" }];
    }
    if (effect.type === "heal" || effect.type === "heal_and_draw") {
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
          <span class="face-emoji">${opponent.emoji}</span>
          <span class="face-hp">${Math.max(0, c.face.hp)}</span>
        </div>
        <div class="opponent-name-tag">${opponent.name}</div>
        <div class="deck-count">🂠 ${c.deck.length}</div>
        <div class="hand-count">✋ ${c.hand.length}</div>
      </div>

      <div class="cpu-action-banner hidden" id="cpuActionBanner"></div>

      <div class="board-row enemy-board" id="enemyBoard"></div>

      <div class="mid-row">
        <button id="battleSettingsBtn" class="icon-btn small-icon-btn" aria-label="バトル設定">⚙️</button>
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

  container.querySelector("#battleSettingsBtn").addEventListener("click", openBattleSettingsModal);

  if (game.winner) showResultModal();
}

function showCpuBanner(text) {
  const banner = containerRef.querySelector("#cpuActionBanner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove("hidden");
}

function hideCpuBanner() {
  const banner = containerRef?.querySelector("#cpuActionBanner");
  if (banner) banner.classList.add("hidden");
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

async function handleEndTurn() {
  if (locked || game.active !== "player" || game.winner) return;
  pending = null;
  locked = true;
  draw();

  endTurn(game); // -> CPUのターン開始
  if (!game.winner) await processCpuTurn();
  if (!game.winner) endTurn(game); // -> プレイヤーのターンへ

  locked = false;
  hideCpuBanner();
  draw();
}

async function processCpuTurn() {
  if (!battleSettings.effectsOn) {
    for (const _ of runCpuTurnSteps(game)) {
      // 演出オフ: 即座に最後まで解決する
    }
    draw();
    return;
  }
  const stepMs = SPEED_MS[battleSettings.speed] ?? SPEED_MS.normal;
  for (const step of runCpuTurnSteps(game)) {
    draw();
    if (step.lines && step.lines.length) showCpuBanner(step.lines.join(" / "));
    await delay(stepMs);
    if (game.winner) break;
  }
}

function openBattleSettingsModal() {
  const existing = document.getElementById("battleSettingsModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.id = "battleSettingsModal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2>バトル設定</h2>
      <div class="field">
        <span>相手の行動演出</span>
        <button id="effectsToggleBtn" class="ghost-btn toggle-btn">${battleSettings.effectsOn ? "ON" : "OFF"}</button>
      </div>
      <div class="field">
        <span>演出速度</span>
        <button id="speedCycleBtn" class="ghost-btn toggle-btn">${SPEED_LABEL[battleSettings.speed]}</button>
      </div>
      <div class="modal-actions">
        <button id="battleSettingsCloseBtn" class="primary-btn">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#effectsToggleBtn").addEventListener("click", (e) => {
    battleSettings.effectsOn = !battleSettings.effectsOn;
    saveBattleSettings(battleSettings);
    e.target.textContent = battleSettings.effectsOn ? "ON" : "OFF";
  });
  overlay.querySelector("#speedCycleBtn").addEventListener("click", (e) => {
    const order = ["slow", "normal", "fast"];
    const next = order[(order.indexOf(battleSettings.speed) + 1) % order.length];
    battleSettings.speed = next;
    saveBattleSettings(battleSettings);
    e.target.textContent = SPEED_LABEL[next];
  });
  overlay.querySelector("#battleSettingsCloseBtn").addEventListener("click", () => overlay.remove());
}

function showResultModal() {
  const container = containerRef;
  const won = game.winner === "player";
  const gold = won ? opponent.winGold : opponent.loseGold;
  recordBattleResult(won);
  addGold(gold);
  ctxRef.refreshGold();

  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h2>${won ? "勝利！ 🎉" : "敗北…"}</h2>
      <p class="modal-note">${opponent.name}に${won ? "勝利しました。" : "敗北しました。"}<br>獲得ゴールド: +${gold}G</p>
      <div class="modal-actions">
        <button id="resultHomeBtn" class="primary-btn">ホームに戻る</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);
  overlay.querySelector("#resultHomeBtn").addEventListener("click", () => ctxRef.navigate("home"));
}
