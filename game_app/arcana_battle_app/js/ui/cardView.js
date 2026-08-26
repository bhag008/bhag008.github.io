// カードのDOM描画ヘルパー
const RARITY_LABEL = { basic: "スタンダード", common: "コモン", rare: "レア", epic: "エピック", legendary: "レジェンダリー" };
const KEYWORD_LABEL = { taunt: "🛡挑発", charge: "⚡速攻", lifesteal: "🩸吸血" };
const RACE_LABEL = { dragon: "🐉ドラゴン", demon: "😈デーモン", fairy: "🧚フェアリー" };

function infoButtonHtml() {
  return `<button type="button" class="card-info-btn" aria-label="カード詳細">ⓘ</button>`;
}

function wireInfoButton(el, cardLike) {
  const btn = el.querySelector(".card-info-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showCardDetail(cardLike);
  });
}

export function createCardEl(card, opts = {}) {
  const el = document.createElement("div");
  el.className = `card-tile rarity-${card.rarity}${opts.small ? " small" : ""}${opts.disabled ? " disabled" : ""}`;
  el.dataset.cardId = card.id;

  const statLine =
    card.type === "minion"
      ? `<div class="card-stats"><span class="atk">${card.atk}</span><span class="hp">${card.hp}</span></div>`
      : `<div class="card-stats spell-tag">スペル</div>`;

  const keywordsLine = card.keywords && card.keywords.length
    ? `<div class="card-keywords">${card.keywords.map((k) => KEYWORD_LABEL[k] || k).join(" ")}</div>`
    : "";
  const raceLine = card.race ? `<div class="card-race">${RACE_LABEL[card.race] || card.race}</div>` : "";
  const displayCost = opts.costOverride ?? card.cost;
  const costReduced = displayCost < card.cost;

  el.innerHTML = `
    ${infoButtonHtml()}
    <div class="card-cost${costReduced ? " reduced" : ""}">${displayCost}</div>
    <div class="card-emoji">${card.emoji || "🃏"}</div>
    <div class="card-name">${card.name}</div>
    ${raceLine}
    ${keywordsLine}
    ${statLine}
    ${opts.showCount ? `<div class="card-count">×${opts.count ?? 0}</div>` : ""}
  `;
  wireInfoButton(el, card);
  return el;
}

export function cardRarityLabel(rarity) {
  return RARITY_LABEL[rarity] || rarity;
}

export function createMinionEl(minion) {
  const el = document.createElement("div");
  const canAct = !minion.sick && !minion.attacked;
  el.className = `minion-tile${minion.keywords.includes("taunt") ? " has-taunt" : ""}${canAct ? " can-attack" : " no-attack"}`;
  el.dataset.uid = String(minion.uid);
  const keywordsLine = minion.keywords.length
    ? `<div class="minion-keywords">${minion.keywords.map((k) => KEYWORD_LABEL[k] || k).join(" ")}</div>`
    : "";
  const raceLine = minion.race ? `<div class="minion-race">${RACE_LABEL[minion.race] || minion.race}</div>` : "";
  el.innerHTML = `
    ${infoButtonHtml()}
    <div class="minion-emoji">${minion.emoji || "🃏"}</div>
    <div class="minion-name">${minion.name}</div>
    ${raceLine}
    ${keywordsLine}
    <div class="minion-stats"><span class="atk">${minion.atk}</span><span class="hp">${minion.hp}</span></div>
  `;
  wireInfoButton(el, {
    name: minion.name,
    emoji: minion.emoji,
    rarity: minion.rarity || "basic",
    type: "minion",
    atk: minion.atk,
    hp: minion.hp,
    cost: minion.cost,
    race: minion.race,
    keywords: minion.keywords,
    text: minion.text,
  });
  return el;
}

export function showCardDetail(card) {
  const existing = document.getElementById("cardDetailModal");
  if (existing) existing.remove();

  const statLine =
    card.type === "minion"
      ? `<div class="detail-stats"><span class="atk">攻撃 ${card.atk}</span><span class="hp">体力 ${card.hp}</span></div>`
      : `<div class="detail-stats spell-tag">スペル</div>`;
  const keywordsLine = card.keywords && card.keywords.length
    ? `<div class="detail-keywords">${card.keywords.map((k) => KEYWORD_LABEL[k] || k).join("　")}</div>`
    : "";
  const raceLine = card.race ? `<div class="detail-race">${RACE_LABEL[card.race] || card.race}</div>` : "";

  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.id = "cardDetailModal";
  overlay.innerHTML = `
    <div class="modal-card card-detail-card">
      <div class="detail-emoji">${card.emoji || "🃏"}</div>
      <h2>${card.name}</h2>
      ${card.rarity ? `<div class="rarity-tag rarity-${card.rarity}">${cardRarityLabel(card.rarity)}</div>` : ""}
      ${raceLine}
      <div class="detail-cost">コスト ${card.cost ?? "-"}</div>
      ${statLine}
      ${keywordsLine}
      ${card.text ? `<p class="detail-text">${card.text}</p>` : ""}
      <div class="modal-actions">
        <button id="cardDetailCloseBtn" class="primary-btn">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#cardDetailCloseBtn").addEventListener("click", () => overlay.remove());
}
