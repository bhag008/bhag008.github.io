(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 分数演算（BigInt）: 誤差のない厳密な10判定のために浮動小数点を使わない
  // ---------------------------------------------------------------------
  function gcdBig(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  }

  function frac(n, d = 1n) {
    if (d === 0n) throw new Error("DIV0");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d);
    if (g > 1n) {
      n /= g;
      d /= g;
    }
    return { n, d };
  }

  function addFrac(a, b) {
    return frac(a.n * b.d + b.n * a.d, a.d * b.d);
  }
  function subFrac(a, b) {
    return frac(a.n * b.d - b.n * a.d, a.d * b.d);
  }
  function mulFrac(a, b) {
    return frac(a.n * b.n, a.d * b.d);
  }
  function divFrac(a, b) {
    if (b.n === 0n) return null;
    return frac(a.n * b.d, a.d * b.n);
  }
  function equalsTen(f) {
    return f.n === 10n * f.d;
  }

  // ---------------------------------------------------------------------
  // ソルバー: 4つ(任意個)の数から10を作れる組み合わせを1つ探す
  // ---------------------------------------------------------------------
  function solveItems(items) {
    if (items.length === 1) {
      return equalsTen(items[0].value) ? items[0].expr : null;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const rest = items.filter((_, idx) => idx !== i && idx !== j);
        const a = items[i];
        const b = items[j];
        const candidates = [
          { value: addFrac(a.value, b.value), expr: `(${a.expr}+${b.expr})` },
          { value: mulFrac(a.value, b.value), expr: `(${a.expr}×${b.expr})` },
          { value: subFrac(a.value, b.value), expr: `(${a.expr}-${b.expr})` },
          { value: subFrac(b.value, a.value), expr: `(${b.expr}-${a.expr})` },
        ];
        if (a.value.n !== 0n) {
          const v = divFrac(b.value, a.value);
          if (v) candidates.push({ value: v, expr: `(${b.expr}÷${a.expr})` });
        }
        if (b.value.n !== 0n) {
          const v = divFrac(a.value, b.value);
          if (v) candidates.push({ value: v, expr: `(${a.expr}÷${b.expr})` });
        }
        for (const c of candidates) {
          const result = solveItems(rest.concat([c]));
          if (result) return result;
        }
      }
    }
    return null;
  }

  function solveDigits(digits) {
    const items = digits.map((d) => ({ value: frac(BigInt(d)), expr: String(d) }));
    return solveItems(items);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function generateDigits() {
    return [randomInt(0, 9), randomInt(0, 9), randomInt(0, 9), randomInt(0, 9)];
  }

  function generateSolvablePuzzle() {
    for (let tries = 0; tries < 20000; tries++) {
      const digits = generateDigits();
      const solution = solveDigits(digits);
      if (solution) return { digits, solution };
    }
    // 理論上ここには到達しない（0-9の4つの組み合わせはほぼ必ず解を持つ）
    return { digits: [1, 2, 3, 4], solution: solveDigits([1, 2, 3, 4]) };
  }

  // ---------------------------------------------------------------------
  // 入力トークン列 -> 評価 / 表示文字列 / 入力状態(次に何を押せるか)
  // ---------------------------------------------------------------------
  const OP_SYMBOL = { "+": "＋", "-": "－", "*": "×", "/": "÷" };

  function evaluateTokens(tokens) {
    let pos = 0;

    function parseExpr() {
      let val = parseTerm();
      while (pos < tokens.length && tokens[pos].type === "op" && (tokens[pos].op === "+" || tokens[pos].op === "-")) {
        const op = tokens[pos].op;
        pos++;
        const rhs = parseTerm();
        val = op === "+" ? addFrac(val, rhs) : subFrac(val, rhs);
      }
      return val;
    }

    function parseTerm() {
      let val = parseFactor();
      while (pos < tokens.length && tokens[pos].type === "op" && (tokens[pos].op === "*" || tokens[pos].op === "/")) {
        const op = tokens[pos].op;
        pos++;
        const rhs = parseFactor();
        if (op === "*") {
          val = mulFrac(val, rhs);
        } else {
          const r = divFrac(val, rhs);
          if (r === null) throw new Error("DIV0");
          val = r;
        }
      }
      return val;
    }

    function parseFactor() {
      const t = tokens[pos];
      if (!t) throw new Error("EOF");
      if (t.type === "num") {
        pos++;
        return frac(BigInt(t.value));
      }
      if (t.type === "lparen") {
        pos++;
        const v = parseExpr();
        if (!(tokens[pos] && tokens[pos].type === "rparen")) throw new Error("PAREN");
        pos++;
        return v;
      }
      throw new Error("UNEXPECTED");
    }

    const result = parseExpr();
    if (pos !== tokens.length) throw new Error("TRAILING");
    return result;
  }

  function tokensToExpressionString(tokens) {
    return tokens
      .map((t) => {
        if (t.type === "num") return String(t.value);
        if (t.type === "op") return OP_SYMBOL[t.op];
        if (t.type === "lparen") return "（";
        if (t.type === "rparen") return "）";
        return "";
      })
      .join(" ");
  }

  function currentState(tokens) {
    let depth = 0;
    let expect = "value";
    for (const t of tokens) {
      if (t.type === "num") expect = "operator";
      else if (t.type === "op") expect = "value";
      else if (t.type === "lparen") {
        depth++;
        expect = "value";
      } else if (t.type === "rparen") {
        depth--;
        expect = "operator";
      }
    }
    return { expect, depth };
  }

  function usedSlots(tokens) {
    const s = new Set();
    for (const t of tokens) if (t.type === "num") s.add(t.slot);
    return s;
  }

  const Core = {
    frac,
    addFrac,
    subFrac,
    mulFrac,
    divFrac,
    equalsTen,
    solveDigits,
    generateDigits,
    generateSolvablePuzzle,
    evaluateTokens,
    tokensToExpressionString,
    currentState,
    usedSlots,
  };
  window.Make10Core = Core;

  // ---------------------------------------------------------------------
  // 一人用モード / 画面制御
  // ---------------------------------------------------------------------
  const STORAGE_KEY = "make10.settings.v1";
  const BEST_KEY_PREFIX = "make10.best.";

  const DEFAULT_SETTINGS = {
    mode: "solo",
    puzzleCount: 10,
  };

  const els = {
    modeLabel: document.getElementById("modeLabel"),
    progressLabel: document.getElementById("progressLabel"),
    bestLabel: document.getElementById("bestLabel"),

    timerDisplay: document.getElementById("timerDisplay"),
    timerText: document.getElementById("timerText"),

    puzzleTiles: document.getElementById("puzzleTiles"),
    expressionDisplay: document.getElementById("expressionDisplay"),
    errorMsg: document.getElementById("errorMsg"),
    hintText: document.getElementById("hintText"),

    lparenBtn: document.getElementById("lparenBtn"),
    rparenBtn: document.getElementById("rparenBtn"),
    backspaceBtn: document.getElementById("backspaceBtn"),
    clearBtn: document.getElementById("clearBtn"),
    submitBtn: document.getElementById("submitBtn"),
    hintBtn: document.getElementById("hintBtn"),
    giveUpBtn: document.getElementById("giveUpBtn"),
    newGameBtn: document.getElementById("newGameBtn"),

    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    modeSelect: document.getElementById("modeSelect"),
    puzzleCountSelect: document.getElementById("puzzleCountSelect"),
    settingsCancelBtn: document.getElementById("settingsCancelBtn"),
    settingsSaveBtn: document.getElementById("settingsSaveBtn"),

    startModal: document.getElementById("startModal"),
    startBtn: document.getElementById("startBtn"),

    resultModal: document.getElementById("resultModal"),
    resultTitle: document.getElementById("resultTitle"),
    resultBody: document.getElementById("resultBody"),
    resultCloseBtn: document.getElementById("resultCloseBtn"),
  };

  let settings = loadSettings();
  let round = null; // { puzzles, index, tokens, splits, startedAt, finished, hintUsedAny, hintUsedThis }
  let timerHandle = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function bestKey(puzzleCount) {
    return `${BEST_KEY_PREFIX}${puzzleCount}`;
  }

  function getBest(puzzleCount) {
    const v = localStorage.getItem(bestKey(puzzleCount));
    return v ? parseFloat(v) : null;
  }

  function setBestIfNeeded(puzzleCount, totalMs) {
    const cur = getBest(puzzleCount);
    if (cur === null || totalMs < cur) {
      localStorage.setItem(bestKey(puzzleCount), String(totalMs));
      return true;
    }
    return false;
  }

  function formatTime(ms) {
    const total = Math.max(0, ms);
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const c = Math.floor((total % 1000) / 100);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${c}`;
  }

  function renderStatus() {
    els.modeLabel.textContent = settings.mode === "online" ? "オンライン" : "一人用";
    els.progressLabel.textContent = round ? `${Math.min(round.index + 1, round.puzzles.length)}/${round.puzzles.length}` : `-/${settings.puzzleCount}`;
    const best = getBest(settings.puzzleCount);
    els.bestLabel.textContent = best !== null ? formatTime(best) : "--:--.-";
  }

  function renderTimer(elapsedMs) {
    els.timerDisplay.classList.remove("hidden");
    els.timerText.textContent = formatTime(elapsedMs);
  }

  function startTimerLoop() {
    stopTimerLoop();
    const tick = () => {
      if (!round || round.finished) return;
      renderTimer(performance.now() - round.startedAt);
    };
    tick();
    timerHandle = setInterval(tick, 100);
  }

  function stopTimerLoop() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function renderPuzzle() {
    if (!round) return;
    const puzzle = round.puzzles[round.index];
    const used = Core.usedSlots(round.tokens);
    els.puzzleTiles.innerHTML = "";
    puzzle.digits.forEach((d, slot) => {
      const btn = document.createElement("button");
      btn.className = "tile-btn";
      btn.textContent = String(d);
      btn.disabled = used.has(slot) || Core.currentState(round.tokens).expect !== "value";
      btn.addEventListener("click", () => pushToken({ type: "num", slot, value: d }));
      els.puzzleTiles.appendChild(btn);
    });
    els.hintText.textContent = "";
    renderTokens();
  }

  function renderTokens() {
    const state = Core.currentState(round.tokens);
    els.expressionDisplay.textContent = round.tokens.length ? Core.tokensToExpressionString(round.tokens) : "数字をタップして式を作ろう";
    els.expressionDisplay.classList.toggle("empty", round.tokens.length === 0);

    const used = Core.usedSlots(round.tokens);
    Array.from(els.puzzleTiles.children).forEach((btn, slot) => {
      btn.classList.toggle("used", used.has(slot));
      btn.disabled = used.has(slot) || state.expect !== "value";
    });

    els.lparenBtn.disabled = state.expect !== "value";
    els.rparenBtn.disabled = !(state.expect === "operator" && state.depth > 0);
    document.querySelectorAll(".op-btn").forEach((b) => {
      b.disabled = state.expect !== "operator";
    });
    els.backspaceBtn.disabled = round.tokens.length === 0;
    els.clearBtn.disabled = round.tokens.length === 0;
    els.submitBtn.disabled = !(state.expect === "operator" && state.depth === 0 && used.size === 4);
    els.errorMsg.textContent = "";
  }

  function pushToken(token) {
    if (!round || round.finished) return;
    round.tokens.push(token);
    renderTokens();
  }

  function handleOpClick(op) {
    pushToken({ type: "op", op });
  }

  els.lparenBtn.addEventListener("click", () => pushToken({ type: "lparen" }));
  els.rparenBtn.addEventListener("click", () => pushToken({ type: "rparen" }));
  document.querySelectorAll(".op-btn").forEach((b) => {
    b.addEventListener("click", () => handleOpClick(b.dataset.op));
  });
  els.backspaceBtn.addEventListener("click", () => {
    if (!round || round.finished) return;
    round.tokens.pop();
    renderTokens();
  });
  els.clearBtn.addEventListener("click", () => {
    if (!round || round.finished) return;
    round.tokens = [];
    renderTokens();
  });

  els.submitBtn.addEventListener("click", handleSubmit);

  function handleSubmit() {
    if (!round || round.finished) return;
    if (settings.mode === "online") return; // オンラインは online.js が処理
    let value;
    try {
      value = Core.evaluateTokens(round.tokens);
    } catch {
      els.errorMsg.textContent = "式が正しくありません。";
      return;
    }
    if (!Core.equalsTen(value)) {
      const asNum = Number(value.n) / Number(value.d);
      els.errorMsg.textContent = `10になりません（計算結果: ${Number.isInteger(asNum) ? asNum : asNum.toFixed(3)}）`;
      return;
    }

    round.splits.push(performance.now() - round.startedAt);
    round.tokens = [];

    if (round.index + 1 >= round.puzzles.length) {
      finishRound();
    } else {
      round.index++;
      renderStatus();
      renderPuzzle();
    }
  }

  function finishRound(gaveUp = false) {
    round.finished = true;
    stopTimerLoop();
    const totalMs = performance.now() - round.startedAt;
    renderTimer(totalMs);

    if (gaveUp) {
      showResult("リタイア", `${round.index}/${round.puzzles.length} 問クリアしました。`);
      return;
    }

    const isBest = !round.hintUsedAny && setBestIfNeeded(settings.puzzleCount, totalMs);
    renderStatus();
    const splitLines = round.splits
      .map((t, i) => `第${i + 1}問: ${formatTime(i === 0 ? t : t - round.splits[i - 1])}`)
      .join("\n");
    showResult(
      "クリア！ 🎉",
      `合計タイム: ${formatTime(totalMs)}${isBest ? "\n自己ベスト更新！" : ""}${round.hintUsedAny ? "\n（ヒント使用のためベスト記録対象外）" : ""}\n\n${splitLines}`
    );
  }

  function showResult(title, body) {
    els.resultTitle.textContent = title;
    els.resultBody.textContent = body;
    els.resultModal.classList.remove("hidden");
  }

  els.hintBtn.addEventListener("click", () => {
    if (!round || round.finished) return;
    round.hintUsedAny = true;
    const puzzle = round.puzzles[round.index];
    els.hintText.textContent = `ヒント: ${puzzle.solution}`;
  });

  els.giveUpBtn.addEventListener("click", () => {
    if (settings.mode === "online") return;
    if (!round || round.finished) return;
    finishRound(true);
  });

  els.newGameBtn.addEventListener("click", () => {
    if (settings.mode === "online") return;
    startNewGame();
  });

  els.resultCloseBtn.addEventListener("click", () => {
    els.resultModal.classList.add("hidden");
    if (settings.mode === "online") {
      if (window.Make10Online) window.Make10Online.backToLobbyAfterResult();
      return;
    }
    startNewGame();
  });

  function startNewGame() {
    stopTimerLoop();
    if (settings.mode === "online") {
      round = null;
      renderStatus();
      if (window.Make10Online) window.Make10Online.enter(settings);
      return;
    }
    if (window.Make10Online) window.Make10Online.leaveIfActive();

    const puzzles = [];
    for (let i = 0; i < settings.puzzleCount; i++) puzzles.push(Core.generateSolvablePuzzle());
    round = {
      puzzles,
      index: 0,
      tokens: [],
      splits: [],
      startedAt: 0,
      finished: false,
      hintUsedAny: false,
    };
    els.timerDisplay.classList.add("hidden");
    renderStatus();
    renderPuzzle();
    els.startModal.classList.remove("hidden");
  }

  els.startBtn.addEventListener("click", () => {
    if (!round) return;
    els.startModal.classList.add("hidden");
    round.startedAt = performance.now();
    startTimerLoop();
  });

  // ---------------------------------------------------------------------
  // 設定モーダル
  // ---------------------------------------------------------------------
  function openSettings() {
    stopTimerLoop();
    els.modeSelect.value = settings.mode;
    els.puzzleCountSelect.value = String(settings.puzzleCount);
    els.settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    els.settingsModal.classList.add("hidden");
  }

  els.settingsBtn.addEventListener("click", openSettings);
  els.settingsCancelBtn.addEventListener("click", () => {
    closeSettings();
    if (round && !round.finished) {
      startTimerLoop();
    } else {
      startNewGame();
    }
  });
  els.settingsSaveBtn.addEventListener("click", () => {
    settings = {
      mode: els.modeSelect.value,
      puzzleCount: parseInt(els.puzzleCountSelect.value, 10),
    };
    saveSettings();
    closeSettings();
    startNewGame();
  });

  window.Make10App = { formatTime, renderStatus, startNewGame, showResult };
  window.Make10Settings = { open: openSettings };

  openSettings();
})();
