import { EXPANSIONS } from "../cards.js";
import { getGold, spendGold, addCardsToCollection } from "../state.js";
import { openPack } from "../shop.js";
import { createCardEl, cardRarityLabel } from "./cardView.js";

export function render(container, ctx) {
  renderShopView(container, ctx);
}

function renderShopView(container, ctx) {
  const exp = EXPANSIONS.flame;
  container.innerHTML = `
    <section class="deck-header">
      <h2>パックショップ</h2>
      <div class="gold-chip">💰 ${getGold()}</div>
    </section>

    <div class="pack-card">
      <div class="pack-emoji">🔥📦</div>
      <div class="pack-name">${exp.name}</div>
      <p class="pack-desc">${exp.description}</p>
      <p class="pack-odds">1パック${exp.cardsPerPack}枚 / コモン70% レア22% エピック6% レジェンダリー2%（レア以上1枚確定）</p>
      <button id="buyPackBtn" class="primary-btn">パックを購入（${exp.packCost}G）</button>
    </div>
  `;

  container.querySelector("#buyPackBtn").addEventListener("click", () => {
    if (!spendGold(exp.packCost)) {
      ctx.toast("ゴールドが足りません");
      return;
    }
    ctx.refreshGold();
    const cards = openPack("flame");
    addCardsToCollection(cards.map((c) => c.id));
    renderReveal(container, ctx, cards);
  });
}

function renderReveal(container, ctx, cards) {
  container.innerHTML = `
    <section class="deck-header">
      <h2>パック開封！</h2>
    </section>
    <div class="reveal-grid" id="revealGrid"></div>
    <button id="revealCloseBtn" class="primary-btn">閉じる</button>
  `;
  const grid = container.querySelector("#revealGrid");
  cards.forEach((card, i) => {
    const el = createCardEl(card);
    el.classList.add("reveal-card");
    el.style.animationDelay = `${i * 120}ms`;
    const rarityTag = document.createElement("div");
    rarityTag.className = `rarity-tag rarity-${card.rarity}`;
    rarityTag.textContent = cardRarityLabel(card.rarity);
    el.appendChild(rarityTag);
    grid.appendChild(el);
  });

  container.querySelector("#revealCloseBtn").addEventListener("click", () => {
    renderShopView(container, ctx);
  });
}
