import { allCollectibleCards, getCard, EXPANSIONS } from "../cards.js";
import {
  getDecks, saveDeckSlot, addDeckSlot, deleteDeckSlot, setActiveDeckIndex, getActiveDeckIndex,
  ownedCount, validateDeck, DECK_SIZE, MAX_COPIES, MAX_DECK_SLOTS,
} from "../state.js";
import { createCardEl } from "./cardView.js";

let workingDeck = [];
let editingIndex = 0;
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

function loadSlot(index) {
  editingIndex = index;
  workingDeck = getDecks()[index]?.cards || [];
  filterSet = "all";
}

export function render(container, ctx) {
  loadSlot(getActiveDeckIndex());
  renderAll(container, ctx);
}

function renderAll(container, ctx) {
  const decks = getDecks();
  const activeIndex = getActiveDeckIndex();
  const counts = deckCounts();
  const deckEntries = Object.entries(counts).sort((a, b) => getCard(a[0]).cost - getCard(b[0]).cost);
  const isEditingActive = editingIndex === activeIndex;

  const slotsHtml = decks
    .map((d, i) => `
      <button class="deck-slot-chip${i === editingIndex ? " editing" : ""}" data-index="${i}">
        ${i === activeIndex ? "⭐ " : ""}${d.name}
        <span class="deck-slot-count">${d.cards.length}/${DECK_SIZE}</span>
      </button>
    `)
    .join("");
  const addSlotHtml = decks.length < MAX_DECK_SLOTS
    ? `<button class="deck-slot-chip add-slot" id="addDeckSlotBtn">＋ 新規</button>`
    : "";

  container.innerHTML = `
    <section class="deck-header">
      <h2>デッキ編成</h2>
      <div class="deck-size ${workingDeck.length === DECK_SIZE ? "ok" : ""}">${workingDeck.length} / ${DECK_SIZE}</div>
    </section>

    <div class="deck-slot-row">${slotsHtml}${addSlotHtml}</div>

    <div class="deck-slot-actions">
      ${isEditingActive
        ? `<div class="deck-slot-active-badge">⭐ 使用中のデッキ</div>`
        : `<button id="setActiveBtn" class="ghost-btn">このデッキを使用する</button>`}
      ${decks.length > 1 ? `<button id="deleteDeckBtn" class="ghost-btn">このデッキを削除</button>` : ""}
    </div>

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

  container.querySelectorAll(".deck-slot-chip[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadSlot(Number(btn.dataset.index));
      renderAll(container, ctx);
    });
  });

  const addBtn = container.querySelector("#addDeckSlotBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const newIndex = addDeckSlot();
      if (newIndex === -1) return;
      loadSlot(newIndex);
      renderAll(container, ctx);
    });
  }

  const setActiveBtn = container.querySelector("#setActiveBtn");
  if (setActiveBtn) {
    setActiveBtn.addEventListener("click", () => {
      const savedCards = getDecks()[editingIndex]?.cards || [];
      const errors = validateDeck(savedCards);
      if (errors.length) {
        container.querySelector("#deckError").textContent = `先に保存してから使用するデッキに設定してください（${errors[0]}）`;
        return;
      }
      setActiveDeckIndex(editingIndex);
      ctx.toast(`「${decks[editingIndex].name}」を使用デッキに設定しました`);
      renderAll(container, ctx);
    });
  }

  const deleteBtn = container.querySelector("#deleteDeckBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteDeckSlot(editingIndex);
      loadSlot(getActiveDeckIndex());
      ctx.toast("デッキを削除しました");
      renderAll(container, ctx);
    });
  }

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
    saveDeckSlot(editingIndex, workingDeck);
    ctx.toast("デッキを保存しました");
    renderAll(container, ctx);
  });
}
