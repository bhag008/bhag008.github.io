import { glyphOf, nameOf } from "./tiles.js";

function esc(s) { return String(s); }

function tileHtml(tile, { action, extraClass = "", disabled = false } = {}) {
  const cls = ["tile-btn", extraClass, tile.red ? "red" : ""].filter(Boolean).join(" ");
  if (action) {
    return `<button class="${cls}" data-action="${action}" data-uid="${tile.uid}" ${disabled ? "disabled" : ""}>${glyphOf(tile.kind)}</button>`;
  }
  return `<span class="${cls} static">${glyphOf(tile.kind)}</span>`;
}

function handHtml(round) {
  const riichiPickSet = new Set(round.riichiChoiceMode ? round.riichiValidDiscardKinds : []);
  const handTiles = round.hand.map(t => {
    const isPick = round.riichiChoiceMode && riichiPickSet.has(t.uid);
    const disabled = round.riichiChoiceMode && !isPick;
    return tileHtml(t, { action: "discard", extraClass: isPick ? "riichi-pick" : "", disabled });
  }).join("");
  let drawn = "";
  if (round.drawnTile) {
    const isPick = round.riichiChoiceMode && riichiPickSet.has(round.drawnTile.uid);
    const disabled = round.riichiChoiceMode && !isPick;
    drawn = tileHtml(round.drawnTile, { action: "discard", extraClass: "drawn " + (isPick ? "riichi-pick" : ""), disabled });
  }
  return `<div class="hand-row">${handTiles}${drawn}</div>`;
}

function statusRowHtml(state) {
  const round = state.round;
  const dots = [0, 1, 2].map(i => `<span class="penalty-dot ${i < state.penaltyCount ? "filled" : ""}"></span>`).join("");
  return `
    <div class="status-row">
      <div class="status-chip">局 <b>${state.roundNumber}</b></div>
      <div class="status-chip">スコア <b>${state.totalScore}</b></div>
      <div class="status-chip">ペナルティ <span class="penalty-dots">${dots}</span></div>
      ${round && round.isRiichi ? `<div class="status-chip riichi">立直中</div>` : ""}
    </div>`;
}

function doraRowHtml(round) {
  return `<div class="dora-row">ドラ表示牌 ${tileHtml(round.doraIndicatorTile)} ${round.isRiichi ? "（裏ドラは和了時に公開）" : ""}</div>`;
}

function discardPileHtml(round) {
  if (round.discards.length === 0) return "";
  const tiles = round.discards.map(t => `<span class="mini-tile ${t.red ? "red" : ""}">${glyphOf(t.kind)}</span>`).join("");
  return `<div class="discard-pile">${tiles}</div>`;
}

function playingScreen(state) {
  const round = state.round;
  const toast = state.lastEvent ? `<div class="toast">${esc(state.lastEvent.message)}</div>` : "";
  const hint = round.riichiChoiceMode
    ? "テンパイを保てる牌だけ選べます。捨てる牌をタップしてください。"
    : (round.canTsumo ? "上がり牌です！ツモを選ぶか、捨てて見逃す（ペナルティ）か選んでください。" : "");
  return `
    ${statusRowHtml(state)}
    ${toast}
    ${doraRowHtml(round)}
    ${discardPileHtml(round)}
    <div class="hand-area">
      <p class="hint-text">${hint}</p>
      ${handHtml(round)}
      <div class="action-row">
        <button class="ghost-btn riichi-btn ${round.canTsumo ? "" : "active-hint"}" data-action="riichi" ${round.canRiichi && !round.riichiChoiceMode ? "" : "disabled"}>リーチ</button>
        <button class="primary-btn" data-action="tsumo" ${round.canTsumo ? "" : "disabled"}>ツモ！</button>
        ${round.riichiChoiceMode ? `<button class="ghost-btn" data-action="cancel-riichi">やめる</button>` : ""}
      </div>
    </div>
  `;
}

function introScreen() {
  return `
    <div class="card intro">
      <h2>一人麻雀 スコアクイズ</h2>
      <p>13枚の配牌からスタートし、1枚引いて1枚捨てるを繰り返してツモ和了を目指します。</p>
      <ul>
        <li>テンパイになったらリーチも宣言できます。</li>
        <li>和了れたら、実際の点数を当てる4択クイズに挑戦。正解した局だけスコアが加算されます。</li>
        <li>役がある上がりを見逃して打牌するとペナルティ+1。3回でゲームオーバーです。</li>
        <li>全牌を使い切って和了れなければその局は流局（失敗）となり、次の局へ進みます。</li>
      </ul>
    </div>
    <button class="primary-btn" data-action="start">スタート</button>
  `;
}

function yakuListHtml(entry) {
  return `<ul class="yaku-list">${entry.yakuList.map(y => `<li><span>${esc(y.name)}</span><b>${y.han}翻</b></li>`).join("")}</ul>`;
}

function quizScreen(state) {
  const round = state.round;
  const pw = round.pendingWin;
  const finalHand = [...round.hand, round.drawnTile];
  const fuText = pw.result.isYakuman ? "" : `<div class="result-row"><span>符</span><b>${pw.result.fu}符</b></div>`;
  return `
    <div class="modal-overlay"><div class="modal-card">
      <h2>ツモ和了！ 点数を当てよう</h2>
      <div class="quiz-hand">${finalHand.map(t => tileHtml(t, { extraClass: t.uid === round.drawnTile.uid ? "drawn" : "" })).join("")}</div>
      ${yakuListHtml(pw.result)}
      <div class="result-row"><span>翻数</span><b>${pw.result.han}翻</b></div>
      ${fuText}
      <p class="modal-note">この和了の実際の点数はどれでしょう？</p>
      <div class="quiz-choices">
        ${pw.choices.map(c => `<button class="quiz-choice-btn" data-action="answer" data-value="${c}">${c}点</button>`).join("")}
      </div>
    </div></div>
  `;
}

function roundResultScreen(state) {
  const entry = state.history[state.history.length - 1];
  const isGameOver = state.gameOver;
  let body;
  if (entry.won) {
    body = `
      <div class="result-banner win">和了！</div>
      <div class="quiz-hand">${entry.finalHand.map(t => tileHtml(t, { extraClass: t.kind === entry.winKind ? "drawn" : "" })).join("")}</div>
      ${yakuListHtml(entry)}
      <div class="result-row"><span>申告点</span><b>${entry.guessScore}点</b></div>
      <div class="result-row ${entry.correct ? "correct" : "wrong"}"><span>実際の点数</span><b>${entry.actualScore}点</b></div>
      <div class="result-row"><span>判定</span><b>${entry.correct ? "正解！スコア加算" : "不正解…"}</b></div>
    `;
  } else {
    body = `
      <div class="result-banner lose">${entry.cutShortByGameOver ? "ゲームオーバー" : "流局"}</div>
      <div class="quiz-hand">${entry.finalHand.map(t => tileHtml(t)).join("")}</div>
      <p class="modal-note">${entry.cutShortByGameOver ? "見逃しペナルティが3回に達しました。" : "牌を使い切りましたが和了れませんでした。"}</p>
    `;
  }
  return `
    <div class="modal-overlay"><div class="modal-card">
      ${body}
      <div class="modal-actions">
        ${isGameOver
          ? `<button class="primary-btn" data-action="show-summary">結果を見る</button>`
          : `<button class="ghost-btn danger-btn" data-action="end">ゲーム終了</button><button class="primary-btn" data-action="next">次の局へ</button>`}
      </div>
    </div></div>
  `;
}

function gameOverScreen(state) {
  const rows = state.history.map(h => {
    const finalHandStr = h.finalHand.map(t => glyphOf(t.kind)).join("");
    if (h.won) {
      return `<tr>
        <td>${h.roundNumber}</td>
        <td class="final-hand-cell">${finalHandStr}</td>
        <td>${h.guessScore}</td>
        <td>${h.actualScore}</td>
        <td class="${h.correct ? "ok" : "ng"}">${h.correct ? "正解" : "不正解"}</td>
        <td>${h.missedWinsThisRound}</td>
      </tr>`;
    }
    return `<tr>
      <td>${h.roundNumber}</td>
      <td class="final-hand-cell">${finalHandStr}</td>
      <td>-</td>
      <td>-</td>
      <td>${h.cutShortByGameOver ? "打止" : "流局"}</td>
      <td>${h.missedWinsThisRound}</td>
    </tr>`;
  }).join("");

  return `
    <div class="card">
      <h2>ゲーム結果</h2>
      <div class="final-score">${state.totalScore} 点</div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead><tr><th>局</th><th>最終手</th><th>申告点</th><th>実際の点数</th><th>判定</th><th>見逃し</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <button class="primary-btn" data-action="restart">もう一度あそぶ</button>
  `;
}

export function render(state, rootEl) {
  let html;
  if (state.phase === "before_start") {
    html = introScreen();
  } else if (state.phase === "game_over") {
    html = gameOverScreen(state);
  } else if (state.phase === "playing") {
    html = playingScreen(state);
  } else if (state.phase === "quiz") {
    html = playingScreen(state) + quizScreen(state);
  } else if (state.phase === "round_result") {
    html = playingScreen(state) + roundResultScreen(state);
  } else {
    html = "";
  }
  rootEl.innerHTML = html;
}
