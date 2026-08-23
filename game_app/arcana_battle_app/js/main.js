import { getGold } from "./state.js";
import * as HomeScreen from "./ui/home.js";
import * as DeckScreen from "./ui/deck.js";
import * as ShopScreen from "./ui/shop.js";
import * as BattleScreen from "./ui/battle.js";

const screenEl = document.getElementById("screen");
const goldLabel = document.getElementById("goldLabel");
const homeBtn = document.getElementById("homeBtn");
const syncBtn = document.getElementById("syncBtn");

const SCREENS = {
  home: HomeScreen,
  deck: DeckScreen,
  shop: ShopScreen,
  battle: BattleScreen,
};

let currentScreen = "home";

let toastTimer = null;
function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function refreshGold() {
  goldLabel.textContent = String(getGold());
}

function navigate(screenName) {
  const screen = SCREENS[screenName];
  if (!screen) return;
  currentScreen = screenName;
  refreshGold();
  screen.render(screenEl, ctx);
}

// クラウド同期で外部から状態が更新された時の再描画。対戦中は進行中のバトルを
// 壊さないよう、盤面は再構築せずゴールド表示のみ更新する。
function refreshCurrentIfSafe() {
  if (currentScreen === "battle") {
    refreshGold();
  } else {
    navigate(currentScreen);
  }
}

const ctx = {
  navigate,
  refreshGold,
  toast,
  refreshCurrentIfSafe,
};

homeBtn.addEventListener("click", () => navigate("home"));
if (syncBtn) syncBtn.onclick = () => toast("同期機能を読み込み中です…");

refreshGold();
navigate("home");

import("./sync.js")
  .then((mod) => mod.initSync(ctx))
  .catch(() => {
    // オフライン等でクラウド同期が読み込めなくても、ゲーム本体は通常通り遊べる
  });
