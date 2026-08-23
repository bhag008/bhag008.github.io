// カードのDOM描画ヘルパー
const RARITY_LABEL = { basic: "スタンダード", common: "コモン", rare: "レア", epic: "エピック", legendary: "レジェンダリー" };
const KEYWORD_LABEL = { taunt: "🛡挑発", charge: "⚡速攻", lifesteal: "🩸吸血" };

export function createCardEl(card, opts = {}) {
  const el = document.createElement("div");
  el.className = `card-tile rarity-${card.rarity}${opts.small ? " small" : ""}${opts.disabled ? " disabled" : ""}`;
  el.dataset.cardId = card.id;
  if (card.text) el.title = card.text;

  const statLine =
    card.type === "minion"
      ? `<div class="card-stats"><span class="atk">${card.atk}</span><span class="hp">${card.hp}</span></div>`
      : `<div class="card-stats spell-tag">スペル</div>`;

  const keywordsLine = card.keywords && card.keywords.length
    ? `<div class="card-keywords">${card.keywords.map((k) => KEYWORD_LABEL[k] || k).join(" ")}</div>`
    : "";

  el.innerHTML = `
    <div class="card-cost">${card.cost}</div>
    <div class="card-emoji">${card.emoji || "🃏"}</div>
    <div class="card-name">${card.name}</div>
    ${keywordsLine}
    ${statLine}
    ${opts.showCount ? `<div class="card-count">×${opts.count ?? 0}</div>` : ""}
  `;
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
  el.innerHTML = `
    <div class="minion-emoji">${minion.emoji || "🃏"}</div>
    <div class="minion-name">${minion.name}</div>
    ${keywordsLine}
    <div class="minion-stats"><span class="atk">${minion.atk}</span><span class="hp">${minion.hp}</span></div>
  `;
  return el;
}
