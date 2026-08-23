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

const CLIENT_ID_KEY = "hitAndBlow.clientId";
const NAME_KEY = "hitAndBlow.displayName";
const LAST_ROOM_KEY = "hitAndBlow.lastRoom";
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
  digitsLabel: document.getElementById("digitsLabel"),
  rangeLabel: document.getElementById("rangeLabel"),
  dupLabel: document.getElementById("dupLabel"),
  attemptCount: document.getElementById("attemptCount"),

  lobbyModal: document.getElementById("onlineLobbyModal"),
  nameInput: document.getElementById("onlineNameInput"),
  lobbyError: document.getElementById("onlineLobbyError"),
  createBtn: document.getElementById("onlineCreateBtn"),
  joinCodeInput: document.getElementById("onlineJoinCodeInput"),
  joinBtn: document.getElementById("onlineJoinBtn"),
  backToSettingsBtn: document.getElementById("onlineBackToSettingsBtn"),

  waitingModal: document.getElementById("onlineWaitingModal"),
  roomCodeText: document.getElementById("onlineRoomCodeText"),
  playerList: document.getElementById("onlinePlayerList"),
  waitingError: document.getElementById("onlineWaitingError"),
  leaveBtn: document.getElementById("onlineLeaveBtn"),
  startBtn: document.getElementById("onlineStartBtn"),

  turnBar: document.getElementById("onlineTurnBar"),

  guessInput: document.getElementById("guessInput"),
  submitBtn: document.getElementById("submitBtn"),
  errorMsg: document.getElementById("errorMsg"),
  historyList: document.getElementById("historyList"),
  emptyHint: document.getElementById("emptyHint"),

  timerDisplay: document.getElementById("timerDisplay"),
  timerText: document.getElementById("timerText"),

  resultModal: document.getElementById("resultModal"),
  resultTitle: document.getElementById("resultTitle"),
  resultBody: document.getElementById("resultBody"),
  resultCloseBtn: document.getElementById("resultCloseBtn"),
};

let currentSettings = null;
let roomCode = null;
let roomRef = null;
let latestRoom = null;
let tickHandle = null;

function core() {
  return window.HitAndBlowCore;
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

function enter(settings) {
  currentSettings = settings;
  els.modeLabel.textContent = "オンライン";
  if (!configured) {
    hideAllOnlineScreens();
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

function hideAllOnlineScreens() {
  els.lobbyModal.classList.add("hidden");
  els.waitingModal.classList.add("hidden");
  els.turnBar.classList.add("hidden");
  els.timerDisplay.classList.add("hidden");
}

function showLobby() {
  cleanupSubscription();
  roomCode = null;
  roomRef = null;
  latestRoom = null;
  hideAllOnlineScreens();
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
  stopTick();
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
        digits: currentSettings.digits,
        rangeMin: currentSettings.rangeMin,
        rangeMax: currentSettings.rangeMax,
        allowDup: currentSettings.allowDup,
        timeLimitEnabled: currentSettings.timeLimitEnabled,
        timeLimitSeconds: currentSettings.timeLimitSeconds,
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

function sortedPlayerIds(room) {
  const players = room.players || {};
  return Object.keys(players).sort((a, b) => (players[a].order ?? 0) - (players[b].order ?? 0));
}

function renderRoom(room) {
  if (!isOnlineMode()) return;
  hideAllOnlineScreens();

  const players = room.players || {};
  const playerIds = sortedPlayerIds(room);
  const isHost = room.hostId === clientId;

  els.digitsLabel.textContent = String(room.settings.digits);
  els.rangeLabel.textContent = `${room.settings.rangeMin}-${room.settings.rangeMax}`;
  els.dupLabel.textContent = room.settings.allowDup ? "あり" : "なし";

  if (room.status === "lobby") {
    els.roomCodeText.textContent = roomCode;
    els.playerList.innerHTML = playerIds
      .map((id) => `<li>${escapeHtml(players[id].name)}${id === room.hostId ? "（ホスト）" : ""}</li>`)
      .join("");
    els.startBtn.classList.toggle("hidden", !isHost);
    els.waitingError.textContent = isHost ? "" : "ホストの開始を待っています…";
    els.waitingModal.classList.remove("hidden");
    return;
  }

  renderGame(room, playerIds, players, isHost);
}

function renderGame(room, playerIds, players) {
  const historyEntries = Object.values(room.history || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  els.attemptCount.textContent = String(historyEntries.length);

  els.historyList.innerHTML = "";
  if (historyEntries.length === 0) {
    els.emptyHint.style.display = "block";
  } else {
    els.emptyHint.style.display = "none";
    historyEntries
      .slice()
      .reverse()
      .forEach((entry, idx) => {
        const li = document.createElement("li");
        li.className = "history-item";
        li.innerHTML = `
          <span class="attempt-no">#${historyEntries.length - idx}</span>
          <span class="guess-digits">${escapeHtml(entry.guess)}</span>
          <span class="badges">
            <span class="badge hit">${entry.hit} Hit</span>
            <span class="badge blow">${entry.blow} Blow</span>
          </span>
          <span class="player-tag">${escapeHtml(entry.name)}</span>
        `;
        els.historyList.appendChild(li);
      });
  }

  const currentPlayerId = room.turnOrder ? room.turnOrder[room.currentTurnIndex] : null;
  const myTurn = room.status === "playing" && currentPlayerId === clientId;

  els.turnBar.classList.remove("hidden");
  els.turnBar.innerHTML = playerIds
    .map((id) => {
      const isCurrent = room.status === "playing" && id === currentPlayerId;
      return `<span class="online-player-chip${isCurrent ? " current" : ""}">${escapeHtml(players[id].name)}</span>`;
    })
    .join("");

  els.guessInput.maxLength = room.settings.digits;
  els.guessInput.disabled = !myTurn;
  els.submitBtn.disabled = !myTurn;
  els.errorMsg.textContent =
    room.status === "playing" && !myTurn ? `${players[currentPlayerId]?.name || "他のプレイヤー"}さんの番です` : "";

  if (room.settings.timeLimitEnabled && room.status === "playing") {
    startTick(room);
  } else {
    stopTick();
    els.timerDisplay.classList.add("hidden");
  }

  if (room.status === "finished") {
    els.guessInput.disabled = true;
    els.submitBtn.disabled = true;
    const shownKey = `${roomCode}:${historyEntries.length}:${room.winnerId || "none"}`;
    if (els.resultModal.dataset.shownFor !== shownKey) {
      els.resultModal.dataset.shownFor = shownKey;
      const winnerName = room.winnerId ? players[room.winnerId]?.name || "?" : null;
      els.resultTitle.textContent = winnerName ? `${winnerName} さんの勝ち！ 🎉` : "終了";
      els.resultBody.textContent = `${historyEntries.length}回の推測で終了しました。\n正解: ${(room.secret || []).join("")}`;
      els.resultModal.classList.remove("hidden");
    }
  }
}

function startTick(room) {
  stopTick();
  const tick = () => {
    const elapsedMs = Date.now() + serverOffset - (room.turnStartedAt || Date.now());
    const remaining = Math.max(0, room.settings.timeLimitSeconds - Math.floor(elapsedMs / 1000));
    els.timerDisplay.classList.remove("hidden");
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    els.timerText.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    els.timerDisplay.classList.toggle("warning", remaining <= 10);
  };
  tick();
  tickHandle = setInterval(tick, 1000);
}

function stopTick() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  els.timerDisplay.classList.add("hidden");
}

els.startBtn.addEventListener("click", async () => {
  if (!latestRoom || !roomRef) return;
  const playerIds = sortedPlayerIds(latestRoom);
  const secret = core().generateSecret(latestRoom.settings);
  await update(roomRef, {
    secret,
    turnOrder: playerIds,
    currentTurnIndex: 0,
    turnStartedAt: Date.now(),
    status: "playing",
    history: null,
    winnerId: null,
  });
});

els.leaveBtn.addEventListener("click", async () => {
  await leaveRoom();
});

els.backToSettingsBtn.addEventListener("click", () => {
  hideAllOnlineScreens();
  if (window.HitAndBlowSettings) window.HitAndBlowSettings.open();
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
  showLobby();
}

async function submitOnlineGuess() {
  if (!latestRoom || !roomRef || latestRoom.status !== "playing") return;
  const currentPlayerId = latestRoom.turnOrder[latestRoom.currentTurnIndex];
  if (currentPlayerId !== clientId) return;

  const raw = els.guessInput.value.trim();
  const parsed = core().parseNumberString(raw, latestRoom.settings);
  if (parsed.error) {
    els.errorMsg.textContent = parsed.error;
    return;
  }
  els.guessInput.value = "";
  els.errorMsg.textContent = "";

  await runTransaction(roomRef, (room) => {
    if (!room || room.status !== "playing") return undefined;
    if (room.turnOrder[room.currentTurnIndex] !== clientId) return undefined;

    const { hit, blow } = core().evaluate(room.secret, parsed.values);
    const historyKey = `g${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    room.history = room.history || {};
    room.history[historyKey] = {
      name: (room.players[clientId] && room.players[clientId].name) || "?",
      guess: raw,
      hit,
      blow,
      ts: Date.now(),
    };
    if (hit === room.settings.digits) {
      room.status = "finished";
      room.winnerId = clientId;
    } else {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
      room.turnStartedAt = Date.now();
    }
    return room;
  });
}

els.submitBtn.addEventListener("click", () => {
  if (isOnlineMode()) submitOnlineGuess();
});
els.guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && isOnlineMode()) submitOnlineGuess();
});

els.resultCloseBtn.addEventListener("click", async () => {
  if (!isOnlineMode()) return;
  els.resultModal.classList.add("hidden");
  if (latestRoom && latestRoom.hostId === clientId && roomRef) {
    await update(roomRef, {
      status: "lobby",
      secret: null,
      turnOrder: null,
      currentTurnIndex: 0,
      turnStartedAt: null,
      history: null,
      winnerId: null,
    });
  }
});

if (configured) {
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    serverOffset = snap.val() || 0;
  });
}

window.HitAndBlowOnline = { enter };
