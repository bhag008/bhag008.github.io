import { getState, isDailyBonusAvailable, claimDailyBonusIfAvailable } from "../state.js";

export function render(container, ctx) {
  const state = getState();
  const dailyAvailable = isDailyBonusAvailable();

  container.innerHTML = `
    <section class="home-hero">
      <div class="home-hero-emoji">🐉</div>
      <p class="home-tagline">スタンダードカードと拡張パックでデッキを組み、CPUと戦おう</p>
    </section>

    <div class="stat-row">
      <div class="status-chip">勝利 <span>${state.stats.wins}</span></div>
      <div class="status-chip">敗北 <span>${state.stats.losses}</span></div>
    </div>

    ${dailyAvailable ? `<button id="dailyBtn" class="primary-btn daily-btn">🎁 デイリーボーナスを受け取る（+50G）</button>` : ""}

    <nav class="home-menu">
      <button id="navBattle" class="menu-btn">
        <span class="menu-emoji">⚔️</span>
        <span class="menu-text">対戦する</span>
      </button>
      <button id="navDeck" class="menu-btn">
        <span class="menu-emoji">📚</span>
        <span class="menu-text">デッキ編成</span>
      </button>
      <button id="navShop" class="menu-btn">
        <span class="menu-emoji">🎴</span>
        <span class="menu-text">パックショップ</span>
      </button>
    </nav>
  `;

  const dailyBtn = container.querySelector("#dailyBtn");
  if (dailyBtn) {
    dailyBtn.addEventListener("click", () => {
      const bonus = claimDailyBonusIfAvailable();
      ctx.refreshGold();
      if (bonus) ctx.toast(`デイリーボーナス +${bonus}G`);
      render(container, ctx);
    });
  }

  container.querySelector("#navBattle").addEventListener("click", () => ctx.navigate("battle"));
  container.querySelector("#navDeck").addEventListener("click", () => ctx.navigate("deck"));
  container.querySelector("#navShop").addEventListener("click", () => ctx.navigate("shop"));
}
