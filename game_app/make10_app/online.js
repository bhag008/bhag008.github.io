import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  off,
  update,
  get,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const CLIENT_ID_KEY = "make10.clientId";
const NAME_KEY = "make10.displayName";
const LAST_ROOM_KEY = "make10.lastRoom";
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let db = null;
let configured = false;

try {
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "PASTE_ME") {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    configured = true;
  }
} catch {
  configured = false;
}

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

const clientId = getClientId();
let serverOffset = 0;

const els = {
  modeLabel: document.getElementById("modeLabel"),
  progressLabel: document.getElementById("progressLabel"),
  bestLabel: document.getElementById("bestLabel"),

  lobbyModal: document.getElementById("onlineLobbyModal"),
  nameInput: document.getElementById("onlineNameInput"),
  lobbyError: document.getElementById("onlineLobbyError"),
  createBtn: document.getElementById("onlineCreateBtn"),
  joinCodeInput: document.getElementById("onlineJoinCodeInput"),
  joinBtn: document.getElementById("onlineJoinBtn"),
  backToSettingsBtn: document.getElementById("onlineBackToSettingsBtn"),

  waitingModal: document.getElementById("onlineWaitingModal"),
  roomCodeText: document.getElementById("onlineRoomCodeText"),
  waitingPuzzleCount: document.getElementById("onlineWaitingPuzzleCount"),
  playerList: document.getElementById("onlinePlayerList"),
  waitingError: document.getElementById("onlineWaitingError"),
  leaveBtn: document.getElementById("onlineLeaveBtn"),
  startBtn: document.getElementById("onlineStartBtn"),

  raceBar: document.getElementById("onlineRaceBar"),
  raceLeaveWrap: document.getElementById("onlineRaceLeaveWrap"),
  raceLeaveBtn: document.getElementById("onlineRaceLeaveBtn"),

  giveUpBtn: document.getElementById("giveUpBtn"),
  newGameBtn: document.getElementById("newGameBtn"),

  puzzleTiles: document.getElementById("puzzleTiles"),
  expressionDisplay: document.getElementById("expressionDisplay"),
  errorMsg: document.getElementById("errorMsg"),
  hintText: document.getElementById("hintText"),

  lparenBtn: document.getElementById("lparenBtn"),
  rparenBtn: document.getElementById("rparenBtn"),
  backspaceBtn: document.getElementById("backspaceBtn"),
  clearBtn: document.getElementById("clearBtn"),
  submitBtn: document.getElementById("submitBtn"),
  hintBtn: document.getElementById("hintBtn"),

  timerDisplay: document.getElementById("timerDisplay"),
  timerText: document.getElementById("timerText"),

  resultModal: document.getElementById("resultModal"),
  resultTitle: document.getElementById("resultTitle"),
  resultBody: document.getElementById("resultBody"),
};

let currentSettings = null;
let roomCode = null;
let roomRef = null;
let latestRoom = null;
let raceTickHandle = null;

let tokens = [];
let localPuzzleIndex = null; // 自分がいま解いている問題のインデックス（ローカル管理）
let myFinished = false;

function core() {
  return window.Make10Core;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function randomRoomCode() {
  let out = "";
  for (let i = 0; i < 4; i++) out += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return out;
}

function isOnlineMode() {
  return currentSettings && currentSettings.mode === "online";
}

function setSoloFooterVisible(visible) {
  els.giveUpBtn.classList.toggle("hidden", !visible);
  els.newGameBtn.classList.toggle("hidden", !visible);
}

function enter(settings) {
  currentSettings = settings;
  els.modeLabel.textContent = "オンライン";
  els.bestLabel.textContent = "-";
  setSoloFooterVisible(false);
  if (!configured) {
    hideAllOnlineScreens();
    setSoloFooterVisible(false);
    els.lobbyError.textContent = "Firebaseが未設定です。firebase-config.js に設定値を入力してください。";
    els.lobbyModal.classList.remove("hidden");
    return;
  }
  els.nameInput.value = localStorage.getItem(NAME_KEY) || "";
  els.joinCodeInput.value = "";
  els.lobbyError.textContent = "";

  const lastRoom = localStorage.getItem(LAST_ROOM_KEY);
  if (lastRoom) {
    rejoin(lastRoom);
  } else {
    showLobby();
  }
}

function leaveIfActive() {
  if (roomCode) {
    leaveRoom();
  } else {
    hideAllOnlineScreens();
  }
  currentSettings = null;
}

function hideAllOnlineScreens() {
  els.lobbyModal.classList.add("hidden");
  els.waitingModal.classList.add("hidden");
  els.raceBar.classList.add("hidden");
  els.raceLeaveWrap.classList.add("hidden");
  els.raceBar.innerHTML = "";
  els.timerDisplay.classList.add("hidden");
  setSoloFooterVisible(true);
  stopRaceTick();
}

function showLobby() {
  cleanupSubscription();
  roomCode = null;
  roomRef = null;
  latestRoom = null;
  localPuzzleIndex = null;
  hideAllOnlineScreens();
  setSoloFooterVisible(false);
  els.timerDisplay.classList.add("hidden");
  els.lobbyModal.classList.remove("hidden");
}

async function rejoin(code) {
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    const room = snap.val();
    if (!room || !room.players || !room.players[clientId]) {
      localStorage.removeItem(LAST_ROOM_KEY);
      showLobby();
      return;
    }
    subscribeRoom(code);
  } catch {
    showLobby();
  }
}

function subscribeRoom(code) {
  cleanupSubscription();
  roomCode = code;
  roomRef = ref(db, `rooms/${code}`);
  onValue(roomRef, (snap) => {
    const room = snap.val();
    if (!room) {
      localStorage.removeItem(LAST_ROOM_KEY);
      showLobby();
      return;
    }
    latestRoom = room;
    renderRoom(room);
  });
}

function cleanupSubscription() {
  if (roomRef) off(roomRef);
  stopRaceTick();
}

els.createBtn.addEventListener("click", async () => {
  const name = els.nameInput.value.trim().slice(0, 10);
  if (!name) {
    els.lobbyError.textContent = "名前を入力してください。";
    return;
  }
  localStorage.setItem(NAME_KEY, name);
  els.lobbyError.textContent = "";
  els.createBtn.disabled = true;
  try {
    let code = randomRoomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) break;
      code = randomRoomCode();
    }
    await update(ref(db, `rooms/${code}`), {
      status: "lobby",
      hostId: clientId,
      createdAt: Date.now(),
      settings: {
        puzzleCount: currentSettings.puzzleCount,
      },
      players: { [clientId]: { name, order: 0 } },
    });
    localStorage.setItem(LAST_ROOM_KEY, code);
    subscribeRoom(code);
  } catch {
    els.lobbyError.textContent = "ルームの作成に失敗しました。通信環境をご確認ください。";
  } finally {
    els.createBtn.disabled = false;
  }
});

els.joinBtn.addEventListener("click", async () => {
  const name = els.nameInput.value.trim().slice(0, 10);
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (!name) {
    els.lobbyError.textContent = "名前を入力してください。";
    return;
  }
  if (code.length !== 4) {
    els.lobbyError.textContent = "4文字のルームコードを入力してください。";
    return;
  }
  localStorage.setItem(NAME_KEY, name);
  els.lobbyError.textContent = "";
  els.joinBtn.disabled = true;
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    const room = snap.val();
    if (!room) {
      els.lobbyError.textContent = "そのルームコードは見つかりません。";
      return;
    }
    if (room.status !== "lobby") {
      els.lobbyError.textContent = "このルームはすでにゲームが始まっています。";
      return;
    }
    const order = Object.keys(room.players || {}).length;
    await update(ref(db, `rooms/${code}/players/${clientId}`), { name, order });
    localStorage.setItem(LAST_ROOM_KEY, code);
    subscribeRoom(code);
  } catch {
    els.lobbyError.textContent = "参加に失敗しました。通信環境をご確認ください。";
  } finally {
    els.joinBtn.disabled = false;
  }
});

els.backToSettingsBtn.addEventListener("click", () => {
  hideAllOnlineScreens();
  currentSettings = null;
  if (window.Make10Settings) window.Make10Settings.open();
});

function sortedPlayerIds(room) {
  const players = room.players || {};
  return Object.keys(players).sort((a, b) => (players[a].order ?? 0) - (players[b].order ?? 0));
}

function renderRoom(room) {
  if (!isOnlineMode()) return;

  if (room.status === "lobby") {
    localPuzzleIndex = null;
    myFinished = false;
    stopRaceTick();
    els.raceBar.classList.add("hidden");
    els.raceLeaveWrap.classList.add("hidden");
    els.timerDisplay.classList.add("hidden");
    els.lobbyModal.classList.add("hidden");
    els.resultModal.classList.add("hidden");
    delete els.resultModal.dataset.shownFor;

    const players = room.players || {};
    const playerIds = sortedPlayerIds(room);
    const isHost = room.hostId === clientId;

    els.progressLabel.textContent = `-/${room.settings.puzzleCount}`;
    els.roomCodeText.textContent = roomCode;
    els.waitingPuzzleCount.textContent = String(room.settings.puzzleCount);
    els.playerList.innerHTML = playerIds
      .map((id) => `<li>${escapeHtml(players[id].name)}${id === room.hostId ? "（ホスト）" : ""}</li>`)
      .join("");
    els.startBtn.classList.toggle("hidden", !isHost);
    els.waitingError.textContent = isHost ? "" : "ホストの開始を待っています…";
    els.waitingModal.classList.remove("hidden");
    return;
  }

  els.waitingModal.classList.add("hidden");
  els.lobbyModal.classList.add("hidden");
  renderRace(room);
}

function renderRace(room) {
  const players = room.players || {};
  const playerIds = sortedPlayerIds(room);
  const progress = room.progress || {};
  const total = room.settings.puzzleCount;

  if (localPuzzleIndex === null) {
    localPuzzleIndex = (progress[clientId] && progress[clientId].index) || 0;
    tokens = [];
  }
  myFinished = room.status === "finished" || !!(progress[clientId] && progress[clientId].finishedAt);

  els.progressLabel.textContent = `${Math.min(localPuzzleIndex, total)}/${total}`;
  els.raceBar.classList.remove("hidden");
  els.raceLeaveWrap.classList.remove("hidden");

  els.raceBar.innerHTML = playerIds
    .map((id) => {
      const p = progress[id] || { index: 0 };
      const isWinner = room.winnerId === id;
      const isMe = id === clientId;
      const cls = ["race-chip"];
      if (isWinner) cls.push("winner");
      else if (p.finishedAt) cls.push("finished");
      if (isMe) cls.push("me");
      return `<span class="${cls.join(" ")}">${isWinner ? "🏆 " : ""}${escapeHtml(players[id].name)}${isMe ? "（自分）" : ""}: ${p.index || 0}/${total}</span>`;
    })
    .join("");

  if (room.status === "finished" || myFinished) {
    const myFinishedAllPuzzles = !!(progress[clientId] && progress[clientId].finishedAt);
    renderInputDisabled(myFinishedAllPuzzles);
  } else if (localPuzzleIndex < (room.puzzles || []).length) {
    renderTilesForOnline(room.puzzles[localPuzzleIndex].digits);
  }

  startRaceTick(room);

  if (room.status === "finished") {
    const shownKey = `${roomCode}:${room.winnerId || "none"}`;
    if (els.resultModal.dataset.shownFor !== shownKey) {
      els.resultModal.dataset.shownFor = shownKey;
      const winnerName = room.winnerId ? players[room.winnerId]?.name || "?" : null;
      const fmt = window.Make10App.formatTime;
      const lines = playerIds
        .map((id) => {
          const p = progress[id] || { index: 0 };
          const timeText = p.finishedAt ? fmt(p.finishedAt - room.startedAt) : "-";
          return `${escapeHtml(players[id].name)}: ${p.index || 0}/${total}問  ${timeText}`;
        })
        .join("\n");
      els.resultTitle.textContent = winnerName ? `${winnerName} さんの勝ち！ 🎉` : "終了";
      els.resultBody.textContent = lines;
      els.resultModal.classList.remove("hidden");
    }
  }
}

function renderInputDisabled(myFinishedAllPuzzles) {
  els.expressionDisplay.textContent = myFinishedAllPuzzles ? "全問クリア！他のプレイヤーを待っています…" : "終了しました（他のプレイヤーが先に全問クリアしました）";
  els.expressionDisplay.classList.add("empty");
  els.puzzleTiles.innerHTML = "";
  els.lparenBtn.disabled = true;
  els.rparenBtn.disabled = true;
  els.backspaceBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.submitBtn.disabled = true;
  document.querySelectorAll(".op-btn").forEach((b) => (b.disabled = true));
}

function renderTilesForOnline(digits) {
  els.puzzleTiles.innerHTML = "";
  digits.forEach((d, slot) => {
    const btn = document.createElement("button");
    btn.className = "tile-btn";
    btn.textContent = String(d);
    btn.addEventListener("click", () => pushOnlineToken({ type: "num", slot, value: d }));
    els.puzzleTiles.appendChild(btn);
  });
  els.hintText.textContent = "";
  renderOnlineTokens();
}

function renderOnlineTokens() {
  const c = core();
  const state = c.currentState(tokens);
  els.expressionDisplay.textContent = tokens.length ? c.tokensToExpressionString(tokens) : "数字をタップして式を作ろう";
  els.expressionDisplay.classList.toggle("empty", tokens.length === 0);

  const used = c.usedSlots(tokens);
  Array.from(els.puzzleTiles.children).forEach((btn, slot) => {
    btn.classList.toggle("used", used.has(slot));
    btn.disabled = used.has(slot) || state.expect !== "value";
  });

  els.lparenBtn.disabled = state.expect !== "value";
  els.rparenBtn.disabled = !(state.expect === "operator" && state.depth > 0);
  document.querySelectorAll(".op-btn").forEach((b) => {
    b.disabled = state.expect !== "operator";
  });
  els.backspaceBtn.disabled = tokens.length === 0;
  els.clearBtn.disabled = tokens.length === 0;
  els.submitBtn.disabled = !(state.expect === "operator" && state.depth === 0 && used.size === 4);
  els.errorMsg.textContent = "";
}

function pushOnlineToken(token) {
  if (!isOnlineMode() || !latestRoom || latestRoom.status !== "playing" || myFinished) return;
  tokens.push(token);
  renderOnlineTokens();
}

els.lparenBtn.addEventListener("click", () => {
  if (isOnlineMode()) pushOnlineToken({ type: "lparen" });
});
els.rparenBtn.addEventListener("click", () => {
  if (isOnlineMode()) pushOnlineToken({ type: "rparen" });
});
document.querySelectorAll(".op-btn").forEach((b) => {
  b.addEventListener("click", () => {
    if (isOnlineMode()) pushOnlineToken({ type: "op", op: b.dataset.op });
  });
});
els.backspaceBtn.addEventListener("click", () => {
  if (!isOnlineMode() || !latestRoom || latestRoom.status !== "playing" || myFinished) return;
  tokens.pop();
  renderOnlineTokens();
});
els.clearBtn.addEventListener("click", () => {
  if (!isOnlineMode() || !latestRoom || latestRoom.status !== "playing" || myFinished) return;
  tokens = [];
  renderOnlineTokens();
});
els.hintBtn.addEventListener("click", () => {
  if (!isOnlineMode() || !latestRoom || latestRoom.status !== "playing" || myFinished) return;
  const puzzle = latestRoom.puzzles && latestRoom.puzzles[localPuzzleIndex];
  if (puzzle) els.hintText.textContent = `ヒント: ${puzzle.solution}`;
});

async function submitOnlineAnswer() {
  if (!isOnlineMode() || !latestRoom || !roomRef || latestRoom.status !== "playing" || myFinished) return;
  const c = core();
  let value;
  try {
    value = c.evaluateTokens(tokens);
  } catch {
    els.errorMsg.textContent = "式が正しくありません。";
    return;
  }
  if (!c.equalsTen(value)) {
    const asNum = Number(value.n) / Number(value.d);
    els.errorMsg.textContent = `10になりません（計算結果: ${Number.isInteger(asNum) ? asNum : asNum.toFixed(3)}）`;
    return;
  }

  const total = latestRoom.settings.puzzleCount;
  const newIndex = localPuzzleIndex + 1;
  const now = Date.now() + serverOffset;
  const finished = newIndex >= total;

  localPuzzleIndex = newIndex;
  tokens = [];
  myFinished = finished;
  els.errorMsg.textContent = "";

  try {
    await update(ref(db, `rooms/${roomCode}/progress/${clientId}`), {
      index: newIndex,
      updatedAt: now,
      finishedAt: finished ? now : null,
    });
    if (finished) {
      await runTransaction(roomRef, (room) => {
        if (!room || room.status !== "playing") return undefined;
        if (!room.winnerId) {
          room.winnerId = clientId;
          room.status = "finished";
          room.finishedAt = now;
        }
        return room;
      });
    }
  } catch {
    els.errorMsg.textContent = "通信に失敗しました。もう一度お試しください。";
  }
}

els.submitBtn.addEventListener("click", () => {
  if (isOnlineMode()) submitOnlineAnswer();
});

els.startBtn.addEventListener("click", async () => {
  if (!latestRoom || !roomRef) return;
  const playerIds = sortedPlayerIds(latestRoom);
  const c = core();
  const puzzles = [];
  for (let i = 0; i < latestRoom.settings.puzzleCount; i++) puzzles.push(c.generateSolvablePuzzle());
  const now = Date.now();
  const progress = {};
  playerIds.forEach((id) => {
    progress[id] = { index: 0, updatedAt: now, finishedAt: null };
  });
  await update(roomRef, {
    puzzles,
    progress,
    startedAt: now,
    status: "playing",
    winnerId: null,
    finishedAt: null,
  });
});

els.leaveBtn.addEventListener("click", () => {
  leaveRoom();
});
els.raceLeaveBtn.addEventListener("click", () => {
  leaveRoom();
});

async function leaveRoom() {
  if (roomCode) {
    try {
      await update(ref(db, `rooms/${roomCode}/players`), { [clientId]: null });
    } catch {
      // 通信エラーでも離脱操作自体は継続する
    }
  }
  localStorage.removeItem(LAST_ROOM_KEY);
  cleanupSubscription();
  roomCode = null;
  roomRef = null;
  latestRoom = null;
  localPuzzleIndex = null;
  if (isOnlineMode()) showLobby();
  else hideAllOnlineScreens();
}

function startRaceTick(room) {
  stopRaceTick();
  const fmt = window.Make10App.formatTime;
  const tick = () => {
    els.timerDisplay.classList.remove("hidden");
    let elapsed;
    if (room.status === "finished") {
      const my = (room.progress && room.progress[clientId]) || {};
      elapsed = (my.finishedAt || room.finishedAt || Date.now() + serverOffset) - room.startedAt;
    } else {
      elapsed = Date.now() + serverOffset - room.startedAt;
    }
    els.timerText.textContent = fmt(Math.max(0, elapsed));
  };
  tick();
  if (room.status !== "finished") {
    raceTickHandle = setInterval(tick, 100);
  }
}

function stopRaceTick() {
  if (raceTickHandle) {
    clearInterval(raceTickHandle);
    raceTickHandle = null;
  }
}

function backToLobbyAfterResult() {
  if (!isOnlineMode()) return;
  if (latestRoom && latestRoom.hostId === clientId && roomRef) {
    update(roomRef, {
      status: "lobby",
      puzzles: null,
      progress: null,
      startedAt: null,
      winnerId: null,
      finishedAt: null,
    });
  }
}

if (configured) {
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    serverOffset = snap.val() || 0;
  });
}

window.Make10Online = { enter, leaveIfActive, backToLobbyAfterResult };
