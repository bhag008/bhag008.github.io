(function () {
  "use strict";

  const STORAGE_KEY = "hitAndBlow.settings.v1";
  const BEST_KEY_PREFIX = "hitAndBlow.best.";

  const DEFAULT_SETTINGS = {
    mode: "auto",
    digits: 3,
    rangeMin: 0,
    rangeMax: 9,
    allowDup: false,
    timeLimitEnabled: true,
    timeLimitSeconds: 180,
  };

  const els = {
    modeLabel: document.getElementById("modeLabel"),
    digitsLabel: document.getElementById("digitsLabel"),
    rangeLabel: document.getElementById("rangeLabel"),
    dupLabel: document.getElementById("dupLabel"),
    attemptCount: document.getElementById("attemptCount"),
    guessInput: document.getElementById("guessInput"),
    submitBtn: document.getElementById("submitBtn"),
    errorMsg: document.getElementById("errorMsg"),
    historyList: document.getElementById("historyList"),
    emptyHint: document.getElementById("emptyHint"),
    giveUpBtn: document.getElementById("giveUpBtn"),
    newGameBtn: document.getElementById("newGameBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    modeSelect: document.getElementById("modeSelect"),
    digitsSelect: document.getElementById("digitsSelect"),
    rangeMinSelect: document.getElementById("rangeMinSelect"),
    rangeMaxSelect: document.getElementById("rangeMaxSelect"),
    dupCheckbox: document.getElementById("dupCheckbox"),
    timeLimitCheckbox: document.getElementById("timeLimitCheckbox"),
    timeLimitFieldsWrap: document.getElementById("timeLimitFieldsWrap"),
    timeLimitMinutesInput: document.getElementById("timeLimitMinutesInput"),
    timeLimitSecondsInput: document.getElementById("timeLimitSecondsInput"),
    settingsError: document.getElementById("settingsError"),
    settingsCancelBtn: document.getElementById("settingsCancelBtn"),
    settingsSaveBtn: document.getElementById("settingsSaveBtn"),
    resultModal: document.getElementById("resultModal"),
    resultTitle: document.getElementById("resultTitle"),
    resultBody: document.getElementById("resultBody"),
    resultCloseBtn: document.getElementById("resultCloseBtn"),
    secretSetupModal: document.getElementById("secretSetupModal"),
    secretInput: document.getElementById("secretInput"),
    secretError: document.getElementById("secretError"),
    secretConfirmBtn: document.getElementById("secretConfirmBtn"),
    handoffModal: document.getElementById("handoffModal"),
    handoffStartBtn: document.getElementById("handoffStartBtn"),
    startModal: document.getElementById("startModal"),
    startBtn: document.getElementById("startBtn"),
    timerDisplay: document.getElementById("timerDisplay"),
    timerText: document.getElementById("timerText"),
  };

  let settings = loadSettings();
  let state = null;
  let timerHandle = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function rangeSize(s) {
    return s.rangeMax - s.rangeMin + 1;
  }

  function bestKey(s) {
    return `${BEST_KEY_PREFIX}${s.digits}_${s.rangeMin}-${s.rangeMax}_${s.allowDup ? "dup" : "nodup"}`;
  }

  function getBest(s) {
    const v = localStorage.getItem(bestKey(s));
    return v ? parseInt(v, 10) : null;
  }

  function setBestIfNeeded(s, attempts) {
    const cur = getBest(s);
    if (cur === null || attempts < cur) {
      localStorage.setItem(bestKey(s), String(attempts));
      return true;
    }
    return false;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function generateSecret(s) {
    const pool = [];
    for (let v = s.rangeMin; v <= s.rangeMax; v++) pool.push(v);

    if (s.allowDup) {
      const out = [];
      for (let i = 0; i < s.digits; i++) {
        out.push(pool[randomInt(0, pool.length - 1)]);
      }
      return out;
    }

    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, s.digits);
  }

  function evaluate(secretArr, guessArr) {
    let hit = 0;
    const secretRemain = [];
    const guessRemain = [];
    for (let i = 0; i < secretArr.length; i++) {
      if (secretArr[i] === guessArr[i]) {
        hit++;
      } else {
        secretRemain.push(secretArr[i]);
        guessRemain.push(guessArr[i]);
      }
    }
    let blow = 0;
    const counts = {};
    for (const d of secretRemain) counts[d] = (counts[d] || 0) + 1;
    for (const d of guessRemain) {
      if (counts[d] > 0) {
        blow++;
        counts[d]--;
      }
    }
    return { hit, blow };
  }

  function parseNumberString(raw, s) {
    if (raw.length !== s.digits) {
      return { error: `${s.digits}桁の数字を入力してください。` };
    }
    const chars = raw.split("");
    const values = [];
    for (const c of chars) {
      if (!/^[0-9]$/.test(c)) {
        return { error: "0〜9の数字のみ使用できます。" };
      }
      const v = parseInt(c, 10);
      if (v < s.rangeMin || v > s.rangeMax) {
        return { error: `使用できる数字は ${s.rangeMin}〜${s.rangeMax} です。` };
      }
      values.push(v);
    }
    if (!s.allowDup) {
      const uniq = new Set(values);
      if (uniq.size !== values.length) {
        return { error: "このモードでは数字の重複は使用できません。" };
      }
    }
    return { values };
  }

  function startNewGame() {
    stopTimer();
    if (settings.mode === "online") {
      state = null;
      renderStatus();
      if (window.HitAndBlowOnline) window.HitAndBlowOnline.enter(settings);
      return;
    }
    state = {
      secret: null,
      history: [],
      finished: false,
      awaitingSecret: settings.mode === "manual",
      awaitingStart: settings.mode === "auto",
      remainingSeconds: settings.timeLimitSeconds,
    };
    els.guessInput.value = "";
    els.guessInput.maxLength = settings.digits;
    els.errorMsg.textContent = "";
    renderStatus();
    renderHistory();
    renderTimer();

    if (settings.mode === "manual") {
      openSecretSetup();
    } else {
      state.secret = generateSecret(settings);
      els.startModal.classList.remove("hidden");
    }
  }

  function renderTimer() {
    if (!settings.timeLimitEnabled || !state) {
      els.timerDisplay.classList.add("hidden");
      return;
    }
    els.timerDisplay.classList.remove("hidden");
    const total = Math.max(0, state.remainingSeconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    els.timerText.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    els.timerDisplay.classList.toggle("warning", total <= 10);
  }

  function startTimer() {
    stopTimer();
    if (!settings.timeLimitEnabled || !state || state.finished || state.awaitingSecret) {
      renderTimer();
      return;
    }
    renderTimer();
    timerHandle = setInterval(() => {
      state.remainingSeconds--;
      if (state.remainingSeconds <= 0) {
        state.remainingSeconds = 0;
        renderTimer();
        clearInterval(timerHandle);
        timerHandle = null;
        return;
      }
      renderTimer();
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function openSecretSetup() {
    els.secretInput.value = "";
    els.secretInput.maxLength = settings.digits;
    els.secretError.textContent = "";
    els.secretSetupModal.classList.remove("hidden");
    els.secretInput.focus();
  }

  function renderStatus() {
    els.modeLabel.textContent =
      settings.mode === "manual" ? "手動" : settings.mode === "online" ? "オンライン" : "自動";
    els.digitsLabel.textContent = String(settings.digits);
    els.rangeLabel.textContent = `${settings.rangeMin}-${settings.rangeMax}`;
    els.dupLabel.textContent = settings.allowDup ? "あり" : "なし";
    els.attemptCount.textContent = String(state ? state.history.length : 0);
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    if (!state || state.history.length === 0) {
      els.emptyHint.style.display = "block";
      return;
    }
    els.emptyHint.style.display = "none";
    state.history.forEach((entry, idx) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <span class="attempt-no">#${idx + 1}</span>
        <span class="guess-digits">${entry.guess}</span>
        <span class="badges">
          <span class="badge hit">${entry.hit} Hit</span>
          <span class="badge blow">${entry.blow} Blow</span>
        </span>
      `;
      els.historyList.appendChild(li);
    });
  }

  function handleSubmit() {
    if (settings.mode === "online") return;
    if (!state || state.finished || state.awaitingSecret || state.awaitingStart) return;
    const raw = els.guessInput.value.trim();
    const parsed = parseNumberString(raw, settings);
    if (parsed.error) {
      els.errorMsg.textContent = parsed.error;
      return;
    }
    els.errorMsg.textContent = "";

    const { hit, blow } = evaluate(state.secret, parsed.values);
    state.history.unshift({ guess: raw, hit, blow });
    els.guessInput.value = "";
    renderStatus();
    renderHistory();

    if (hit === settings.digits) {
      state.finished = true;
      stopTimer();
      const attempts = state.history.length;
      const isBest = setBestIfNeeded(settings, attempts);
      showResult(
        "クリア！ 🎉",
        `${attempts}回で正解しました。${isBest ? "\n自己ベスト更新！" : ""}\n正解: ${state.secret.join("")}`
      );
    } else {
      state.remainingSeconds = settings.timeLimitSeconds;
      startTimer();
    }
  }

  function showResult(title, body) {
    els.resultTitle.textContent = title;
    els.resultBody.textContent = body;
    els.resultModal.classList.remove("hidden");
  }

  function hideResult() {
    els.resultModal.classList.add("hidden");
  }

  function openSettings() {
    populateRangeSelects();
    els.modeSelect.value = settings.mode;
    els.digitsSelect.value = String(settings.digits);
    els.rangeMinSelect.value = String(settings.rangeMin);
    els.rangeMaxSelect.value = String(settings.rangeMax);
    els.dupCheckbox.checked = settings.allowDup;
    els.timeLimitCheckbox.checked = settings.timeLimitEnabled;
    els.timeLimitMinutesInput.value = Math.floor(settings.timeLimitSeconds / 60);
    els.timeLimitSecondsInput.value = settings.timeLimitSeconds % 60;
    updateTimeLimitFieldsState();
    els.settingsError.textContent = "";
    els.settingsModal.classList.remove("hidden");
    stopTimer();
  }

  function updateTimeLimitFieldsState() {
    els.timeLimitFieldsWrap.classList.toggle("disabled", !els.timeLimitCheckbox.checked);
  }

  function closeSettings() {
    els.settingsModal.classList.add("hidden");
  }

  function cancelSettings() {
    closeSettings();
    if (!state) {
      startNewGame();
      return;
    }
    if (!state.finished && !state.awaitingSecret && !state.awaitingStart) startTimer();
  }

  function populateRangeSelects() {
    for (const sel of [els.rangeMinSelect, els.rangeMaxSelect]) {
      sel.innerHTML = "";
      for (let v = 0; v <= 9; v++) {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = String(v);
        sel.appendChild(opt);
      }
    }
  }

  function handleSettingsSave() {
    const mode = els.modeSelect.value;
    const digits = parseInt(els.digitsSelect.value, 10);
    const rangeMin = parseInt(els.rangeMinSelect.value, 10);
    const rangeMax = parseInt(els.rangeMaxSelect.value, 10);
    const allowDup = els.dupCheckbox.checked;
    const timeLimitEnabled = els.timeLimitCheckbox.checked;
    const timeLimitMinutes = parseInt(els.timeLimitMinutesInput.value, 10) || 0;
    const timeLimitSecondsPart = parseInt(els.timeLimitSecondsInput.value, 10) || 0;
    const timeLimitSeconds = timeLimitMinutes * 60 + timeLimitSecondsPart;

    if (rangeMin >= rangeMax) {
      els.settingsError.textContent = "最大値は最小値より大きくしてください。";
      return;
    }
    const size = rangeMax - rangeMin + 1;
    if (!allowDup && size < digits) {
      els.settingsError.textContent = `重複なしの場合、範囲は桁数(${digits})以上必要です。`;
      return;
    }
    if (timeLimitEnabled && timeLimitSeconds <= 0) {
      els.settingsError.textContent = "制限時間は1秒以上に設定してください。";
      return;
    }

    settings = { mode, digits, rangeMin, rangeMax, allowDup, timeLimitEnabled, timeLimitSeconds };
    saveSettings();
    closeSettings();
    startNewGame();
  }

  els.submitBtn.addEventListener("click", handleSubmit);
  els.guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  els.guessInput.addEventListener("input", () => {
    els.guessInput.value = els.guessInput.value.replace(/[^0-9]/g, "");
  });

  els.secretInput.addEventListener("input", () => {
    els.secretInput.value = els.secretInput.value.replace(/[^0-9]/g, "");
  });

  els.secretConfirmBtn.addEventListener("click", () => {
    const raw = els.secretInput.value.trim();
    const parsed = parseNumberString(raw, settings);
    if (parsed.error) {
      els.secretError.textContent = parsed.error;
      return;
    }
    state.secret = parsed.values;
    state.awaitingSecret = false;
    els.secretInput.value = "";
    els.secretSetupModal.classList.add("hidden");
    els.handoffModal.classList.remove("hidden");
  });

  els.secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.secretConfirmBtn.click();
  });

  els.handoffStartBtn.addEventListener("click", () => {
    els.handoffModal.classList.add("hidden");
    els.guessInput.focus();
    startTimer();
  });

  els.timeLimitCheckbox.addEventListener("change", updateTimeLimitFieldsState);

  els.startBtn.addEventListener("click", () => {
    if (!state) return;
    state.awaitingStart = false;
    els.startModal.classList.add("hidden");
    els.guessInput.focus();
    startTimer();
  });

  els.giveUpBtn.addEventListener("click", () => {
    if (settings.mode === "online") return;
    if (!state || state.finished || state.awaitingSecret || state.awaitingStart) return;
    state.finished = true;
    stopTimer();
    showResult("正解はこちら", `正解: ${state.secret.join("")}`);
  });

  els.newGameBtn.addEventListener("click", () => {
    if (settings.mode === "online") return;
    startNewGame();
  });

  els.settingsBtn.addEventListener("click", openSettings);
  els.settingsCancelBtn.addEventListener("click", cancelSettings);
  els.settingsSaveBtn.addEventListener("click", handleSettingsSave);

  els.resultCloseBtn.addEventListener("click", () => {
    if (settings.mode === "online") return;
    hideResult();
    startNewGame();
  });

  window.HitAndBlowCore = { generateSecret, evaluate, parseNumberString };
  window.HitAndBlowSettings = { open: openSettings };

  openSettings();
})();
