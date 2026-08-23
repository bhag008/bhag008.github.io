// クラウド同期（任意機能）。読み込みに失敗してもゲーム本体には影響しない。
import { firebaseConfig } from "../firebase-config.js";
import * as state from "./state.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue, off } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const SYNC_CODE_KEY = "arcanabattle.syncCode";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const app = initializeApp(firebaseConfig, "arcana-battle-sync");
const db = getDatabase(app);

let ctxRef = null;
let listenerRef = null;

function pathFor(code) {
  return ref(db, `arcanaSaves/${code}`);
}

function getSyncCode() {
  return localStorage.getItem(SYNC_CODE_KEY);
}

function setSyncCodeLocal(code) {
  if (code) localStorage.setItem(SYNC_CODE_KEY, code);
  else localStorage.removeItem(SYNC_CODE_KEY);
}

function randomCode() {
  let c = "";
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

async function createSyncCode() {
  let code = randomCode();
  for (let i = 0; i < 5; i++) {
    const snap = await get(pathFor(code));
    if (!snap.exists()) break;
    code = randomCode();
  }
  await set(pathFor(code), { ...state.getState(), updatedAt: Date.now() });
  setSyncCodeLocal(code);
  startListening();
  return code;
}

async function linkSyncCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const snap = await get(pathFor(code));
  if (!snap.exists()) throw new Error("NOT_FOUND");
  setSyncCodeLocal(code);
  state.applyRemoteState(snap.val());
  startListening();
  return code;
}

function unlinkSync() {
  stopListening();
  setSyncCodeLocal(null);
}

function pushState(snapshot) {
  const code = getSyncCode();
  if (!code) return;
  set(pathFor(code), { ...snapshot, updatedAt: snapshot.updatedAt || Date.now() }).catch(() => {
    // オフライン等は無視。次の変更時に改めて送信される。
  });
}

function startListening() {
  const code = getSyncCode();
  if (!code) return;
  stopListening();
  listenerRef = pathFor(code);
  onValue(listenerRef, (snap) => {
    if (!snap.exists()) return;
    if (state.applyRemoteState(snap.val()) && ctxRef) {
      ctxRef.refreshCurrentIfSafe();
    }
  });
}

function stopListening() {
  if (listenerRef) {
    off(listenerRef);
    listenerRef = null;
  }
}

function renderModal() {
  const code = getSyncCode();
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.id = "syncModal";

  if (!code) {
    overlay.innerHTML = `
      <div class="modal-card">
        <h2>クラウド同期</h2>
        <p class="modal-note">この端末のプレイデータをクラウドに保存し、他の端末（スマホ⇔PCなど）で共有できます。</p>
        <button id="createCodeBtn" class="primary-btn">この端末のデータを同期する</button>
        <p class="modal-note sync-or">すでにコードをお持ちの場合</p>
        <label class="field">
          <span>同期コード</span>
          <input id="linkCodeInput" type="text" maxlength="6" placeholder="ABCDEF" class="text-input code-input" autocomplete="off" autocapitalize="characters">
        </label>
        <p id="syncError" class="error-msg"></p>
        <div class="modal-actions">
          <button id="linkCodeBtn" class="ghost-btn">連携する</button>
          <button id="syncCloseBtn" class="ghost-btn">閉じる</button>
        </div>
      </div>
    `;
  } else {
    overlay.innerHTML = `
      <div class="modal-card">
        <h2>クラウド同期（連携中）</h2>
        <p class="modal-note">他の端末でこの同期コードを入力すると、プレイデータが共有されます。</p>
        <div class="sync-code-display" id="syncCodeDisplay">${code}</div>
        <button id="copyCodeBtn" class="ghost-btn">コードをコピー</button>
        <p id="syncCopiedNote" class="modal-note sync-copied hidden">コピーしました</p>
        <div class="modal-actions">
          <button id="unlinkBtn" class="ghost-btn">同期を解除</button>
          <button id="syncCloseBtn" class="primary-btn">閉じる</button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);

  overlay.querySelector("#syncCloseBtn").addEventListener("click", () => overlay.remove());

  if (!code) {
    overlay.querySelector("#createCodeBtn").addEventListener("click", async () => {
      overlay.querySelector("#createCodeBtn").disabled = true;
      try {
        await createSyncCode();
        overlay.remove();
        ctxRef.toast("同期コードを作成しました");
        renderModal();
      } catch {
        overlay.querySelector("#syncError").textContent = "同期コードの作成に失敗しました。通信環境をご確認ください。";
        overlay.querySelector("#createCodeBtn").disabled = false;
      }
    });
    overlay.querySelector("#linkCodeBtn").addEventListener("click", async () => {
      const input = overlay.querySelector("#linkCodeInput").value;
      if (!input.trim()) return;
      try {
        await linkSyncCode(input);
        overlay.remove();
        ctxRef.toast("データを連携しました");
        ctxRef.refreshCurrentIfSafe();
      } catch {
        overlay.querySelector("#syncError").textContent = "そのコードは見つかりませんでした。";
      }
    });
  } else {
    overlay.querySelector("#copyCodeBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        overlay.querySelector("#syncCopiedNote").classList.remove("hidden");
      } catch {
        // クリップボード権限がない環境では無視（コードは画面に表示済み）
      }
    });
    overlay.querySelector("#unlinkBtn").addEventListener("click", () => {
      unlinkSync();
      overlay.remove();
      ctxRef.toast("同期を解除しました");
      renderModal();
    });
  }
}

function openModal() {
  const existing = document.getElementById("syncModal");
  if (existing) existing.remove();
  renderModal();
}

export async function initSync(ctx) {
  ctxRef = ctx;

  const syncBtn = document.getElementById("syncBtn");
  if (syncBtn) syncBtn.onclick = openModal;

  state.onStateSaved((s) => pushState(s));

  const code = getSyncCode();
  if (code) {
    try {
      const snap = await get(pathFor(code));
      if (snap.exists() && state.applyRemoteState(snap.val())) {
        ctxRef.refreshCurrentIfSafe();
      }
    } catch {
      // オフライン起動時はローカルデータのまま続行
    }
    startListening();
  }
}
