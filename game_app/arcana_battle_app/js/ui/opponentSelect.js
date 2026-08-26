import { OPPONENTS } from "../opponents.js";
import { setSelectedOpponentId } from "../selection.js";

const STARS = { 1: "★☆☆☆☆", 2: "★★☆☆☆", 3: "★★★☆☆", 4: "★★★★☆", 5: "★★★★★", 6: "★★★★★👑" };

export function render(container, ctx) {
  container.innerHTML = `
    <section class="deck-header">
      <h2>対戦相手を選択</h2>
    </section>
    <div class="opponent-list" id="opponentList"></div>
  `;

  const list = container.querySelector("#opponentList");
  for (const opp of OPPONENTS) {
    const el = document.createElement("button");
    el.className = "opponent-card";
    el.innerHTML = `
      <div class="opponent-emoji">${opp.emoji}</div>
      <div class="opponent-info">
        <div class="opponent-name-row">
          <span class="opponent-name">${opp.name}</span>
          <span class="opponent-stars">${STARS[opp.level] || ""}</span>
        </div>
        <p class="opponent-desc">${opp.description}</p>
        <div class="opponent-reward">勝利報酬 💰${opp.winGold}G（敗北時 💰${opp.loseGold}G）</div>
      </div>
    `;
    el.addEventListener("click", () => {
      setSelectedOpponentId(opp.id);
      ctx.navigate("battle");
    });
    list.appendChild(el);
  }
}
