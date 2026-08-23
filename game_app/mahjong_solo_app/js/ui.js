import { glyphOf } from "./tiles.js";
import { YAKU_QUIZ_GROUPS } from "./yaku.js";

function esc(s) { return String(s); }

function tileHtml(tile, { action, extraClass = "", disabled = false } = {}) {
  const cls = ["tile-btn", extraClass].filter(Boolean).join(" ");
  if (action) {
    return `<button class="${cls}" data-action="${action}" data-uid="${tile.uid}" ${disabled ? "disabled" : ""}>${glyphOf(tile.kind)}</button>`;
  }
  return `<span class="${cls} static">${glyphOf(tile.kind)}</span>`;
}

function handHtml(round) {
  const handTiles = round.hand.map(t => tileHtml(t, { action: "discard" })).join("");
  const drawn = round.drawnTile ? tileHtml(round.drawnTile, { action: "discard", extraClass: "drawn" }) : "";
  return `<div class="hand-row">${handTiles}${drawn}</div>`;
}

function statusRowHtml(state) {
  const round = state.round;
  const dots = [0, 1, 2].map(i => `<span class="penalty-dot ${i < state.penaltyCount ? "filled" : ""}"></span>`).join("");
  return `
    <div class="status-row">
      <div class="status-chip">${round ? round.kyokuLabel : ""}</div>
      <div class="status-chip">スコア <b>${state.totalScore}</b></div>
      <div class="status-chip">ペナルティ <span class="penalty-dots">${dots}</span></div>
      ${round && round.isRiichi ? `<div class="status-chip riichi">立直中</div>` : ""}
    </div>`;
}

function doraRowHtml(round) {
  return `<div class="dora-row">ドラ表示牌 ${tileHtml(round.doraIndicatorTile)}</div>`;
}

function discardPileHtml(round) {
  if (round.discards.length === 0) return "";
  const tiles = round.discards.map(t => `<span class="mini-tile">${glyphOf(t.kind)}</span>`).join("");
  return `<div class="discard-pile">${tiles}</div>`;
}

function playingScreen(state) {
  const round = state.round;
  const toast = state.lastEvent ? `<div class="toast">${esc(state.lastEvent.message)}</div>` : "";
  const hint = round.riichiPending
    ? "リーチ宣言中：捨てる牌を選んでください（テンパイを維持できていないとペナルティになります）"
    : "";
  return `
    ${statusRowHtml(state)}
    ${toast}
    ${doraRowHtml(round)}
    ${discardPileHtml(round)}
    <div class="hand-area">
      <p class="hint-text">${hint}</p>
      ${handHtml(round)}
      <div class="action-row">
        <button class="ghost-btn riichi-btn" data-action="riichi" ${round.isRiichi || round.riichiPending ? "disabled" : ""}>リーチ</button>
        <button class="primary-btn" data-action="tsumo">ツモ！</button>
        ${round.riichiPending ? `<button class="ghost-btn" data-action="cancel-riichi">やめる</button>` : ""}
      </div>
    </div>
  `;
}

function introScreen() {
  return `
    <div class="card intro">
      <h2>一人麻雀 スコアクイズ</h2>
      <p>13枚の配牌からスタートし、1枚引いて1枚捨てるを繰り返してツモ和了を目指します。リーチとツモが可能かどうかはヒントなし、自分で判断してください。</p>
      <ul>
        <li>東1局〜南4局の全8局で1ゲーム。南4局が終わったらゲーム終了です。</li>
        <li>テンパイだと思ったら「リーチ」、捨てる牌を選んで宣言。実際にテンパイを保てていなければペナルティ+1で局終了です。</li>
        <li>和了ったと思ったら「ツモ！」。実際には和了っていない手で宣言するとペナルティ+1で局終了です。</li>
        <li>役アリの和了を見逃して打牌し続けた場合もペナルティ+1（この場合は局は続行）。</li>
        <li>ペナルティ3回でゲームオーバーです。</li>
        <li>正しくツモできたら、該当する役を全て選ぶクイズに挑戦。正解すると自動計算された符をもとに、実際の点数を当てる4択クイズに進みます。役を外すとその局は0点です（赤牌・一発・裏ドラはなし）。</li>
        <li>全牌を使い切って和了れなければ流局。正解・不正解にかかわらず、次の局に進む前に実際の役と点数を確認できます。</li>
      </ul>
    </div>
    <button class="primary-btn" data-action="start">スタート</button>
  `;
}

function yakuListHtml(yakuList) {
  return `<ul class="yaku-list">${yakuList.map(y => `<li><span>${esc(y.name)}</span><b>${y.han}翻</b></li>`).join("")}</ul>`;
}

function yakuQuizScreen(state) {
  const round = state.round;
  const pw = round.pendingWin;
  const finalHand = [...round.hand, round.drawnTile];
  const selected = new Set(pw.selectedYaku || []);
  const groups = YAKU_QUIZ_GROUPS.map(g => `
    <div class="yaku-quiz-group">
      <div class="yaku-quiz-group-label">${g.label}</div>
      <div class="yaku-quiz-chips">
        ${g.names.map(name => `<button class="yaku-chip ${selected.has(name) ? "selected" : ""}" data-action="toggle-yaku" data-name="${esc(name)}">${esc(name)}</button>`).join("")}
      </div>
    </div>
  `).join("");
  return `
    <div class="modal-overlay"><div class="modal-card">
      <h2>ツモ和了！ 役を選ぼう</h2>
      <div class="quiz-hand">${finalHand.map(t => tileHtml(t, { extraClass: t.uid === round.drawnTile.uid ? "drawn" : "" })).join("")}</div>
      <p class="modal-note">この手に該当する役をすべて選んでください（ドラは役ではないので選ばなくてOKです）。</p>
      ${groups}
      <div class="modal-actions">
        <button class="primary-btn" data-action="submit-yaku">これで回答する（${selected.size}件選択中）</button>
      </div>
    </div></div>
  `;
}

function scoreQuizScreen(state) {
  const round = state.round;
  const pw = round.pendingWin;
  const finalHand = [...round.hand, round.drawnTile];
  const fuText = pw.result.isYakuman ? "" : `<div class="result-row"><span>符（自動計算）</span><b>${pw.result.fu}符</b></div>`;
  return `
    <div class="modal-overlay"><div class="modal-card">
      <h2>役の判定は正解！ 点数を当てよう</h2>
      <div class="quiz-hand">${finalHand.map(t => tileHtml(t, { extraClass: t.uid === round.drawnTile.uid ? "drawn" : "" })).join("")}</div>
      ${yakuListHtml(pw.result.yakuList)}
      <div class="result-row"><span>翻数</span><b>${pw.result.han}翻</b></div>
      ${fuText}
      <p class="modal-note">この和了の実際の点数はどれでしょう？</p>
      <div class="quiz-choices">
        ${pw.choices.map(c => `<button class="quiz-choice-btn" data-action="answer-score" data-value="${c}">${c}点</button>`).join("")}
      </div>
    </div></div>
  `;
}

function winResultBody(entry) {
  const yakuVerdictRow = `<div class="result-row ${entry.yakuCorrect ? "correct" : "wrong"}"><span>役の判定</span><b>${entry.yakuCorrect ? "正解！" : "不正解…"}</b></div>`;
  const guessedText = entry.guessedYakuNames && entry.guessedYakuNames.length > 0 ? entry.guessedYakuNames.join("、") : "（何も選択しなかった）";
  const scoreSection = entry.yakuCorrect
    ? `
      <div class="result-row"><span>申告点</span><b>${entry.guessScore}点</b></div>
      <div class="result-row ${entry.scoreCorrect ? "correct" : "wrong"}"><span>実際の点数</span><b>${entry.actualScore}点</b></div>
      <div class="result-row ${entry.scoreCorrect ? "correct" : "wrong"}"><span>点数の判定</span><b>${entry.scoreCorrect ? "正解！スコア加算" : "不正解…"}</b></div>
    `
    : `
      <div class="result-row"><span>実際の点数</span><b>${entry.actualScore}点</b></div>
      <p class="modal-note">役の判定が誤っていたため、点数クイズはなしで0点として次局へ進みます。</p>
    `;
  return `
    <div class="result-banner ${entry.yakuCorrect && entry.scoreCorrect ? "win" : "lose"}">和了！</div>
    <div class="quiz-hand">${entry.finalHand.map(t => tileHtml(t, { extraClass: t.kind === entry.winKind ? "drawn" : "" })).join("")}</div>
    <div class="modal-note">実際の役（正解）</div>
    ${yakuListHtml(entry.yakuList)}
    <div class="result-row"><span>翻数</span><b>${entry.han}翻</b></div>
    ${!entry.isYakuman ? `<div class="result-row"><span>符</span><b>${entry.fu}符</b></div>` : ""}
    <div class="result-row"><span>あなたが選んだ役</span><b>${esc(guessedText)}</b></div>
    ${yakuVerdictRow}
    ${scoreSection}
  `;
}

function nonWinResultBody(entry) {
  const titleMap = {
    exhaustive: "流局",
    wrong_tsumo: "誤ったツモ宣言",
    wrong_riichi: "誤ったリーチ宣言",
    missed_win: "ゲームオーバー",
  };
  const noteMap = {
    exhaustive: "牌を使い切りましたが和了れませんでした。",
    wrong_tsumo: "この手牌ではまだ和了していませんでした。ペナルティ+1です。",
    wrong_riichi: "この打牌ではテンパイになっていませんでした。ペナルティ+1です。",
    missed_win: "見逃しペナルティが3回に達しました。",
  };
  return `
    <div class="result-banner lose">${titleMap[entry.endReason] || "局終了"}</div>
    <div class="quiz-hand">${entry.finalHand.map(t => tileHtml(t)).join("")}</div>
    <p class="modal-note">${noteMap[entry.endReason] || ""}</p>
  `;
}

function roundResultScreen(state) {
  const entry = state.history[state.history.length - 1];
  const isGameOver = state.gameOver;
  const body = entry.endReason === "win" ? winResultBody(entry) : nonWinResultBody(entry);
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

function historyVerdictText(h) {
  if (h.endReason === "win") {
    if (!h.yakuCorrect) return "役 不正解";
    return h.scoreCorrect ? "役・点数とも正解" : "役は正解／点数は不正解";
  }
  return { exhaustive: "流局", wrong_tsumo: "誤ツモ宣言", wrong_riichi: "誤リーチ宣言", missed_win: "見逃し打止" }[h.endReason] || "-";
}

function gameOverScreen(state) {
  const rows = state.history.map(h => {
    const finalHandStr = h.finalHand.map(t => glyphOf(t.kind)).join("");
    const added = h.endReason === "win" ? h.addedScore : 0;
    return `<tr>
      <td>${h.kyokuLabel}</td>
      <td class="final-hand-cell">${finalHandStr}</td>
      <td class="${h.endReason === "win" && h.yakuCorrect && h.scoreCorrect ? "ok" : "ng"}">${historyVerdictText(h)}</td>
      <td>${added}</td>
      <td>${h.missedWinsThisRound}</td>
    </tr>`;
  }).join("");

  return `
    <div class="card">
      <h2>ゲーム結果</h2>
      <div class="final-score">${state.totalScore} 点</div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead><tr><th>局</th><th>最終手</th><th>判定</th><th>獲得点</th><th>見逃し</th></tr></thead>
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
  } else if (state.phase === "yaku_quiz") {
    html = playingScreen(state) + yakuQuizScreen(state);
  } else if (state.phase === "score_quiz") {
    html = playingScreen(state) + scoreQuizScreen(state);
  } else if (state.phase === "round_result") {
    html = playingScreen(state) + roundResultScreen(state);
  } else {
    html = "";
  }
  rootEl.innerHTML = html;
}
