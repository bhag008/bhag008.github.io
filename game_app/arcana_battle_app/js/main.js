import { getGold } from "./state.js";
import * as HomeScreen from "./ui/home.js";
import * as DeckScreen from "./ui/deck.js";
import * as ShopScreen from "./ui/shop.js";
import * as BattleScreen from "./ui/battle.js";

const screenEl = document.getElementById("screen");
const goldLabel = document.getElementById("goldLabel");
const homeBtn = document.getElementById("homeBtn");

const SCREENS = {
  home: HomeScreen,
  deck: DeckScreen,
  shop: ShopScreen,
  battle: BattleScreen,
};

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

const ctx = {
  navigate,
  refreshGold,
  toast,
};

function navigate(screenName) {
  const screen = SCREENS[screenName];
  if (!screen) return;
  refreshGold();
  screen.render(screenEl, ctx);
}

homeBtn.addEventListener("click", () => navigate("home"));

refreshGold();
navigate("home");
