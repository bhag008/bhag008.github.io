import { allCollectibleCards, getCard, EXPANSIONS } from "../cards.js";
import { getDeck, setDeck, ownedCount, validateDeck, DECK_SIZE, MAX_COPIES } from "../state.js";
import { createCardEl } from "./cardView.js";

let workingDeck = [];
let filterSet = "all";

function deckCounts() {
  const counts = {};
  for (const id of workingDeck) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

function addCard(id) {
  const counts = deckCounts();
  if (workingDeck.length >= DECK_SIZE) return false;
  if ((counts[id] || 0) >= MAX_COPIES) return false;
  if ((counts[id] || 0) >= ownedCount(id)) return false;
  workingDeck.push(id);
  return true;
}

function removeOne(id) {
  const idx = workingDeck.indexOf(id);
  if (idx !== -1) workingDeck.splice(idx, 1);
}

export function render(container, ctx) {
  workingDeck = getDeck();
  filterSet = "all";
  renderAll(container, ctx);
}

function renderAll(container, ctx) {
  const counts = deckCounts();
  const deckEntries = Object.entries(counts).sort((a, b) => getCard(a[0]).cost - getCard(b[0]).cost);

  container.innerHTML = `
    <section class="deck-header">
      <h2>デッキ編成</h2>
      <div class="deck-size ${workingDeck.length === DECK_SIZE ? "ok" : ""}">${workingDeck.length} / ${DECK_SIZE}</div>
    </section>

    <div class="deck-list" id="deckList"></div>

    <div class="filter-tabs">
      <button class="tab-btn" data-set="all">すべて</button>
      <button class="tab-btn" data-set="standard">スタンダード</button>
      ${Object.values(EXPANSIONS).map((exp) => `<button class="tab-btn" data-set="${exp.id}">${exp.name}</button>`).join("")}
    </div>

    <div class="card-grid" id="poolGrid"></div>

    <p id="deckError" class="error-msg"></p>
    <button id="saveDeckBtn" class="primary-btn">デッキを保存</button>
  `;

  const deckListEl = container.querySelector("#deckList");
  if (!deckEntries.length) {
    deckListEl.innerHTML = `<p class="empty-note">カードをタップしてデッキに追加してください</p>`;
  } else {
    for (const [id, count] of deckEntries) {
      const card = getCard(id);
      const el = createCardEl(card, { small: true, showCount: true, count });
      el.addEventListener("click", () => {
        removeOne(id);
        renderAll(container, ctx);
      });
      deckListEl.appendChild(el);
    }
  }

  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.set === filterSet);
    btn.addEventListener("click", () => {
      filterSet = btn.dataset.set;
      renderAll(container, ctx);
    });
  });

  const poolGrid = container.querySelector("#poolGrid");
  const pool = allCollectibleCards()
    .filter((c) => filterSet === "all" || c.set === filterSet)
    .sort((a, b) => a.cost - b.cost);

  for (const card of pool) {
    const owned = ownedCount(card.id);
    const inDeck = counts[card.id] || 0;
    const el = createCardEl(card, { small: true, showCount: true, count: `${inDeck}/${owned}`, disabled: owned === 0 });
    if (owned === 0) {
      el.classList.add("disabled");
    } else {
      el.addEventListener("click", () => {
        if (addCard(card.id)) renderAll(container, ctx);
      });
    }
    poolGrid.appendChild(el);
  }

  container.querySelector("#saveDeckBtn").addEventListener("click", () => {
    const errors = validateDeck(workingDeck);
    const errEl = container.querySelector("#deckError");
    if (errors.length) {
      errEl.textContent = errors[0];
      return;
    }
    setDeck(workingDeck);
    ctx.toast("デッキを保存しました");
    ctx.navigate("home");
  });
}
