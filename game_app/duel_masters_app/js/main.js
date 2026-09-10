// 画面遷移とDOM描画、ユーザー操作のワイヤリング
import {
  getCard, cardsByCivilization, CIVILIZATIONS, isBlocker, isDoubleBreaker,
  hasShieldTrigger, cardEffects, validateDeck, DECK_MIN_SIZE, MAX_COPIES,
} from './cards.js';
import { DuelEngine } from './engine.js';
import { cpuTurnSteps, chooseBlockForCPU, autoResolveShieldTriggers } from './ai.js';
import { CPU_DECKS, getCpuDeck } from './decks.js';
import { loadDecks, saveDecks, nextUid, loadMeta, saveMeta } from './state.js';

const $ = (id) => document.getElementById(id);

let decksData = loadDecks();
let meta = loadMeta();

let engine = null;
let cpuGen = null;
let manaChargeMode = false;
let selectedAttackerUid = null;
let editingDeck = null; // { id: string|null, name: string, cardIds: string[] }
let editCivFilter = 'fire';
let selectedPlayerDeckId = null;
let selectedCpuDeckId = CPU_DECKS[0].id;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ---------------- モーダル ----------------
function openModal(el) {
  $('modalPanel').innerHTML = '';
  $('modalPanel').appendChild(el);
  $('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  $('modalOverlay').classList.add('hidden');
  $('modalPanel').innerHTML = '';
}
function promptChoice(title, options, onPick) {
  const wrap = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  const list = document.createElement('div');
  list.className = 'choice-list';
  for (const opt of options) {
    const b = document.createElement('button');
    b.className = 'btn choice-btn';
    b.textContent = opt.label;
    b.onclick = () => onPick(opt.value);
    list.appendChild(b);
  }
  wrap.appendChild(list);
  openModal(wrap);
}

// ---------------- タイトル ----------------
function renderTitle() {
  const hasValidDeck = decksData.decks.some((d) => validateDeck(d.cardIds).length === 0);
  $('titleHint').textContent = hasValidDeck
    ? `保存済みデッキ: ${decksData.decks.length} / 戦績 ${meta.wins}勝${meta.losses}敗`
    : `まずは「デッキを編成する」から${DECK_MIN_SIZE}枚以上のデッキを作りましょう。`;
  $('btnPlay').disabled = !hasValidDeck;
}

$('btnPlay').onclick = () => { renderCpuSelect(); showScreen('screen-cpuselect'); };
$('btnDeckBuilder').onclick = () => { renderDeckBuilderHome(); showScreen('screen-deckbuilder'); };

// ---------------- デッキ編成 ----------------
function renderDeckBuilderHome() {
  editingDeck = null;
  $('deckEditPanel').classList.add('hidden');
  $('deckListPanel').classList.remove('hidden');
  const list = $('deckList');
  list.innerHTML = '';
  if (decksData.decks.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'まだデッキがありません。';
    list.appendChild(p);
  }
  for (const deck of decksData.decks) {
    const errors = validateDeck(deck.cardIds);
    const row = document.createElement('div');
    row.className = 'deck-row';
    const info = document.createElement('div');
    info.className = 'deck-row-info';
    info.innerHTML = `<strong>${escapeHtml(deck.name)}</strong><span class="hint">${deck.cardIds.length}枚 ${errors.length ? '・条件未達' : '・OK'}</span>`;
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-small';
    editBtn.textContent = '編集';
    editBtn.onclick = () => startEditDeck(deck);
    row.appendChild(info);
    row.appendChild(editBtn);
    list.appendChild(row);
  }
}
$('btnBackFromDeckbuilder').onclick = () => { renderTitle(); showScreen('screen-title'); };
$('btnNewDeck').onclick = () => startEditDeck({ id: null, name: `新しいデッキ${decksData.decks.length + 1}`, cardIds: [] });

function startEditDeck(deck) {
  editingDeck = { id: deck.id, name: deck.name, cardIds: [...deck.cardIds] };
  $('deckListPanel').classList.add('hidden');
  $('deckEditPanel').classList.remove('hidden');
  $('deckNameInput').value = editingDeck.name;
  $('btnDeleteDeck').classList.toggle('hidden', deck.id == null);
  renderCivTabs();
  renderDeckEditPanel();
}
$('deckNameInput').oninput = (e) => { if (editingDeck) editingDeck.name = e.target.value; };

function renderCivTabs() {
  const tabs = $('civTabs');
  tabs.innerHTML = '';
  for (const civ of Object.keys(CIVILIZATIONS)) {
    const b = document.createElement('button');
    b.className = 'btn btn-small civ-tab' + (civ === editCivFilter ? ' active' : '');
    b.style.setProperty('--civ-color', CIVILIZATIONS[civ].color);
    b.textContent = CIVILIZATIONS[civ].name;
    b.onclick = () => { editCivFilter = civ; renderCivTabs(); renderDeckEditPanel(); };
    tabs.appendChild(b);
  }
}

function countInDeck(cardId) {
  return editingDeck.cardIds.filter((id) => id === cardId).length;
}

function cardMiniCard(def, count) {
  const div = document.createElement('div');
  div.className = 'mini-card civ-' + def.civ;
  const kw = [];
  if (isBlocker(def)) kw.push('B');
  if (isDoubleBreaker(def)) kw.push('W');
  if (hasShieldTrigger(def)) kw.push('S');
  div.innerHTML = `
    <div class="mini-card-top">
      <span class="mini-cost">${def.cost}</span>
      <span class="mini-name">${escapeHtml(def.name)}</span>
      ${def.power != null ? `<span class="mini-power">P${def.power}</span>` : ''}
    </div>
    <div class="mini-card-mid">${def.type === 'creature' ? escapeHtml(def.race || '') : '呪文'} ${kw.map((k) => `<span class="badge badge-${k}">${k}</span>`).join('')}</div>
    <div class="mini-card-text">${escapeHtml(def.text || '')}</div>
    ${count != null ? `<div class="mini-count">採用: ${count}枚</div>` : ''}
  `;
  return div;
}

function renderDeckEditPanel() {
  $('deckCountDisplay').textContent = `合計: ${editingDeck.cardIds.length}枚 (${DECK_MIN_SIZE}枚以上・同名${MAX_COPIES}枚まで)`;
  const errors = validateDeck(editingDeck.cardIds);
  $('deckValidationMsg').textContent = errors.length ? errors.join(' / ') : '条件を満たしています。';
  $('deckValidationMsg').classList.toggle('hint-ok', errors.length === 0);

  const pool = $('cardPoolList');
  pool.innerHTML = '';
  for (const def of cardsByCivilization(editCivFilter)) {
    const count = countInDeck(def.id);
    const card = cardMiniCard(def, count);
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-small';
    addBtn.textContent = '+ 追加';
    addBtn.disabled = count >= MAX_COPIES;
    addBtn.onclick = () => { editingDeck.cardIds.push(def.id); renderDeckEditPanel(); };
    card.appendChild(addBtn);
    pool.appendChild(card);
  }

  const deckList = $('deckCardList');
  deckList.innerHTML = '';
  const uniqueIds = [...new Set(editingDeck.cardIds)].sort((a, b) => {
    const da = getCard(a), db = getCard(b);
    if (da.civ !== db.civ) return da.civ.localeCompare(db.civ);
    return da.cost - db.cost;
  });
  for (const id of uniqueIds) {
    const def = getCard(id);
    const count = countInDeck(id);
    const card = cardMiniCard(def, count);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-small btn-ghost';
    removeBtn.textContent = '- 削除';
    removeBtn.onclick = () => {
      const idx = editingDeck.cardIds.indexOf(id);
      if (idx !== -1) editingDeck.cardIds.splice(idx, 1);
      renderDeckEditPanel();
    };
    card.appendChild(removeBtn);
    deckList.appendChild(card);
  }
}

$('btnSaveDeck').onclick = () => {
  const errors = validateDeck(editingDeck.cardIds);
  if (errors.length) { $('deckValidationMsg').textContent = errors.join(' / '); return; }
  if (editingDeck.id == null) {
    decksData.decks.push({ id: 'deck_' + nextUid(), name: editingDeck.name || '名称未設定', cardIds: editingDeck.cardIds });
  } else {
    const d = decksData.decks.find((x) => x.id === editingDeck.id);
    d.name = editingDeck.name || '名称未設定';
    d.cardIds = editingDeck.cardIds;
  }
  saveDecks(decksData);
  renderDeckBuilderHome();
};
$('btnDeleteDeck').onclick = () => {
  decksData.decks = decksData.decks.filter((x) => x.id !== editingDeck.id);
  saveDecks(decksData);
  renderDeckBuilderHome();
};
$('btnCancelEditDeck').onclick = () => renderDeckBuilderHome();

// ---------------- CPU選択 ----------------
function renderCpuSelect() {
  const validDecks = decksData.decks.filter((d) => validateDeck(d.cardIds).length === 0);
  if (!selectedPlayerDeckId || !validDecks.some((d) => d.id === selectedPlayerDeckId)) {
    selectedPlayerDeckId = validDecks[0]?.id ?? null;
  }
  const pdWrap = $('playerDeckSelect');
  pdWrap.innerHTML = '<h3>使用するデッキ</h3>';
  for (const d of validDecks) {
    const b = document.createElement('button');
    b.className = 'btn deck-select-btn' + (d.id === selectedPlayerDeckId ? ' active' : '');
    b.textContent = `${d.name} (${d.cardIds.length}枚)`;
    b.onclick = () => { selectedPlayerDeckId = d.id; renderCpuSelect(); };
    pdWrap.appendChild(b);
  }

  const cdWrap = $('cpuDeckSelect');
  cdWrap.innerHTML = '<h3>対戦相手</h3>';
  for (const d of CPU_DECKS) {
    const b = document.createElement('button');
    b.className = 'btn deck-select-btn' + (d.id === selectedCpuDeckId ? ' active' : '');
    b.innerHTML = `<strong>${escapeHtml(d.name)}</strong><span class="hint">${escapeHtml(d.description)}</span>`;
    b.onclick = () => { selectedCpuDeckId = d.id; renderCpuSelect(); };
    cdWrap.appendChild(b);
  }
  $('btnStartDuel').disabled = !selectedPlayerDeckId;
}
$('btnBackFromCpuSelect').onclick = () => { renderTitle(); showScreen('screen-title'); };
$('btnStartDuel').onclick = () => {
  const playerDeck = decksData.decks.find((d) => d.id === selectedPlayerDeckId);
  const cpuDeck = getCpuDeck(selectedCpuDeckId);
  startDuel(playerDeck.cardIds, cpuDeck.cardIds);
};

// ---------------- 対戦 ----------------
function startDuel(playerCardIds, cpuCardIds) {
  engine = new DuelEngine(playerCardIds, cpuCardIds);
  cpuGen = null;
  manaChargeMode = false;
  selectedAttackerUid = null;
  showScreen('screen-battle');
  renderBattle();
  if (engine.turnSide === 'cpu') startCpuTurn();
}

function civBadge(civ) {
  return `<span class="civ-tag" style="--civ-color:${CIVILIZATIONS[civ].color}">${CIVILIZATIONS[civ].name}</span>`;
}

function renderZoneCard(inst, opts = {}) {
  const def = getCard(inst.cardId);
  const div = document.createElement('div');
  div.className = 'zone-card civ-' + def.civ;
  if (inst.tapped) div.classList.add('tapped');
  if (inst.sickness) div.classList.add('sick');
  if (opts.selected) div.classList.add('selected');
  const kw = [];
  if (isBlocker(def)) kw.push('B');
  if (isDoubleBreaker(def)) kw.push('W');
  if (hasShieldTrigger(def)) kw.push('S');
  div.innerHTML = `
    <div class="zc-top">${civBadge(def.civ)}<span class="zc-cost">${def.cost}</span></div>
    <div class="zc-name">${escapeHtml(def.name)}</div>
    <div class="zc-power">${def.power != null ? 'P' + def.power + (inst.turnBuff ? `+${inst.turnBuff}` : '') : ''}</div>
    <div class="zc-kw">${kw.map((k) => `<span class="badge badge-${k}">${k}</span>`).join('')}</div>
  `;
  if (opts.onClick) div.onclick = opts.onClick;
  return div;
}

function renderBattle() {
  if (!engine) return;
  const opp = engine.players.cpu;
  const me = engine.players.player;
  const myTurn = engine.turnSide === 'player';

  $('oppInfo').innerHTML = `CPU — シールド ${opp.shields.length} / 手札 ${opp.hand.length} / 山札 ${opp.deck.length} / 墓地 ${opp.graveyard.length}`;
  $('selfInfo').innerHTML = `あなた — シールド ${me.shields.length} / 山札 ${me.deck.length} / 墓地 ${me.graveyard.length} — ${myTurn ? 'あなたのターン' : 'CPUのターン'} (${engine.phase === 'main' ? 'メインフェーズ' : 'アタックフェーズ'})`;

  const oppBattle = $('oppBattleZone');
  oppBattle.innerHTML = '';
  for (const c of opp.battle) {
    const canBeAttacked = myTurn && engine.phase === 'attack' && selectedAttackerUid;
    oppBattle.appendChild(renderZoneCard(c, {
      onClick: canBeAttacked ? () => performAttack({ type: 'creature', uid: c.uid }) : null,
    }));
  }
  $('oppManaZone').innerHTML = `<span class="zone-label">CPUマナ: ${opp.mana.filter((m) => !m.tapped).length}/${opp.mana.length}</span>`;

  const selfBattle = $('selfBattleZone');
  selfBattle.innerHTML = '';
  for (const c of me.battle) {
    const eligible = !c.tapped && !c.sickness;
    selfBattle.appendChild(renderZoneCard(c, {
      selected: c.uid === selectedAttackerUid,
      onClick: (myTurn && engine.phase === 'attack' && eligible) ? () => selectAttacker(c.uid) : null,
    }));
  }
  $('selfManaZone').innerHTML = `<span class="zone-label">マナ: ${me.mana.filter((m) => !m.tapped).length}/${me.mana.length}</span>`;

  $('logPanel').innerHTML = engine.log.slice(-8).map((m) => `<div>${escapeHtml(m)}</div>`).join('');
  $('logPanel').scrollTop = $('logPanel').scrollHeight;

  const hand = $('handRow');
  hand.innerHTML = '';
  for (const inst of me.hand) {
    const def = getCard(inst.cardId);
    const div = document.createElement('div');
    div.className = 'hand-card civ-' + def.civ;
    const affordable = engine.canPayCost('player', def);
    if (!myTurn || engine.phase !== 'main') div.classList.add('disabled');
    const kw = [];
    if (isBlocker(def)) kw.push('B');
    if (isDoubleBreaker(def)) kw.push('W');
    if (hasShieldTrigger(def)) kw.push('S');
    div.innerHTML = `
      <div class="zc-top">${civBadge(def.civ)}<span class="zc-cost">${def.cost}</span></div>
      <div class="zc-name">${escapeHtml(def.name)}</div>
      <div class="zc-power">${def.power != null ? 'P' + def.power : ''}</div>
      <div class="zc-kw">${kw.map((k) => `<span class="badge badge-${k}">${k}</span>`).join('')}</div>
      <div class="zc-text">${escapeHtml(def.text || '')}</div>
    `;
    if (myTurn && engine.phase === 'main') {
      if (manaChargeMode) {
        div.onclick = () => { engine.chargeMana('player', inst.uid); manaChargeMode = false; renderBattle(); };
      } else if (affordable) {
        div.onclick = () => playHandCard(inst.uid);
      } else {
        div.classList.add('unaffordable');
      }
    }
    hand.appendChild(div);
  }

  $('btnChargeMana').disabled = !myTurn || engine.phase !== 'main' || engine.manaChargedThisTurn;
  $('btnChargeMana').classList.toggle('active', manaChargeMode);
  $('btnAttackPhase').classList.toggle('hidden', !(myTurn && engine.phase === 'main'));
  $('btnAttackFace').classList.toggle('hidden', !(myTurn && engine.phase === 'attack' && selectedAttackerUid));
  $('btnCancelSelection').classList.toggle('hidden', !selectedAttackerUid);
  $('btnEndTurn').disabled = !myTurn;
}

function buildCandidateLabels(side, def, uids) {
  const opp = side === 'player' ? 'cpu' : 'player';
  const eff = cardEffects(def).find((e) => ['destroy', 'bounce', 'returnFromGraveyard', 'buffPower'].includes(e.type));
  let zone;
  if (eff.type === 'destroy' || eff.type === 'bounce') zone = engine.players[opp].battle;
  else if (eff.type === 'returnFromGraveyard') zone = engine.players[side].graveyard;
  else zone = engine.players[side].battle;
  return uids.map((uid) => {
    const c = zone.find((x) => x.uid === uid);
    const d = getCard(c.cardId);
    return { uid, label: `${d.name}${d.power != null ? ` (P${d.power})` : ''}` };
  });
}

function playHandCard(handUid) {
  const inst = engine.players.player.hand.find((c) => c.uid === handUid);
  if (!inst) return;
  const def = getCard(inst.cardId);
  if (!engine.canPayCost('player', def)) return;
  if (def.type === 'spell') {
    const candidates = engine.getValidTargetUids('player', def);
    if (candidates && candidates.length > 1) {
      const labels = buildCandidateLabels('player', def, candidates);
      promptChoice(`${def.name} の対象を選択`, labels.map((l) => ({ label: l.label, value: l.uid })), (uid) => {
        engine.playCard('player', handUid, { targetUid: uid });
        closeModal();
        renderBattle();
        checkGameOverAfterAction();
      });
      return;
    }
    if (candidates && candidates.length === 1) {
      engine.playCard('player', handUid, { targetUid: candidates[0] });
      renderBattle();
      checkGameOverAfterAction();
      return;
    }
  }
  engine.playCard('player', handUid, {});
  renderBattle();
  checkGameOverAfterAction();
}

function selectAttacker(uid) {
  selectedAttackerUid = (selectedAttackerUid === uid) ? null : uid;
  renderBattle();
}

function performAttack(target) {
  if (!selectedAttackerUid) return;
  const attackerUid = selectedAttackerUid;
  selectedAttackerUid = null;
  const result = engine.declareAttack('player', attackerUid, target);
  if (!result.ok) { renderBattle(); return; }
  if (result.awaitingBlock) {
    const blockUid = chooseBlockForCPU(engine, attackerUid);
    engine.resolveBlock(blockUid);
  }
  autoResolveShieldTriggers(engine, 'cpu');
  renderBattle();
  checkGameOverAfterAction();
}

function checkGameOverAfterAction() {
  if (engine.isGameOver()) showResult();
}

$('btnChargeMana').onclick = () => { manaChargeMode = !manaChargeMode; renderBattle(); };
$('btnAttackPhase').onclick = () => { engine.enterAttackPhase(); renderBattle(); };
$('btnAttackFace').onclick = () => performAttack({ type: 'player' });
$('btnCancelSelection').onclick = () => { selectedAttackerUid = null; renderBattle(); };
$('btnEndTurn').onclick = () => {
  if (engine.turnSide !== 'player' || engine.isGameOver()) return;
  selectedAttackerUid = null;
  engine.endTurn();
  renderBattle();
  if (engine.isGameOver()) { showResult(); return; }
  if (engine.turnSide === 'cpu') startCpuTurn();
};

// ---------------- CPUターン進行 ----------------
function startCpuTurn() {
  cpuGen = cpuTurnSteps(engine);
  setTimeout(stepCpuTurn, 500);
}

function stepCpuTurn() {
  if (!cpuGen) return;
  const { done } = cpuGen.next();
  renderBattle();
  if (engine.isGameOver()) { cpuGen = null; showResult(); return; }
  if (engine.pendingBlock) {
    offerPlayerBlock(() => processPendingShieldTriggersThenContinue(() => setTimeout(stepCpuTurn, 500)));
    return;
  }
  if (engine.pendingShieldTriggers.length > 0 && engine.pendingShieldTriggers[0].side === 'player') {
    processPendingShieldTriggersThenContinue(() => setTimeout(stepCpuTurn, 500));
    return;
  }
  if (done) {
    cpuGen = null;
    setTimeout(() => {
      engine.endTurn();
      renderBattle();
      if (engine.isGameOver()) showResult();
    }, 400);
    return;
  }
  setTimeout(stepCpuTurn, 500);
}

function offerPlayerBlock(onDone) {
  const pb = engine.pendingBlock;
  const blockers = pb.eligibleBlockers.map((uid) => engine.players.player.battle.find((c) => c.uid === uid)).filter(Boolean);
  const options = blockers.map((b) => {
    const d = getCard(b.cardId);
    return { label: `${d.name} (P${d.power}) でブロックする`, value: b.uid };
  });
  options.push({ label: 'ブロックしない', value: null });
  promptChoice('相手が攻撃してきました。ブロックしますか?', options, (uid) => {
    closeModal();
    engine.resolveBlock(uid);
    renderBattle();
    onDone();
  });
}

function processPendingShieldTriggersThenContinue(continueFn) {
  if (engine.pendingShieldTriggers.length > 0 && engine.pendingShieldTriggers[0].side === 'player') {
    const item = engine.pendingShieldTriggers[0];
    offerShieldTrigger(item, () => processPendingShieldTriggersThenContinue(continueFn));
  } else {
    continueFn();
  }
}

function offerShieldTrigger(item, onDone) {
  const def = getCard(item.cardId);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h3>S・トリガー発動可能</h3><p>${escapeHtml(def.name)}</p><p class="hint">${escapeHtml(def.text || '')}</p>`;
  const btnYes = document.createElement('button');
  btnYes.className = 'btn btn-primary';
  btnYes.textContent = 'コスト無しで使用する';
  btnYes.onclick = () => useShieldTrigger(item, def, onDone);
  const btnNo = document.createElement('button');
  btnNo.className = 'btn btn-ghost';
  btnNo.textContent = '使用しない(手札に残す)';
  btnNo.onclick = () => { closeModal(); engine.resolveShieldTrigger(false); renderBattle(); onDone(); };
  wrap.appendChild(btnYes);
  wrap.appendChild(btnNo);
  openModal(wrap);
}

function useShieldTrigger(item, def, onDone) {
  const needsTarget = cardEffects(def).some((e) => ['destroy', 'bounce', 'returnFromGraveyard', 'buffPower'].includes(e.type));
  if (needsTarget) {
    const candidates = engine.getValidTargetUids(item.side, def);
    if (!candidates || candidates.length === 0) {
      closeModal(); engine.resolveShieldTrigger(true, null); renderBattle(); onDone(); return;
    }
    if (candidates.length === 1) {
      closeModal(); engine.resolveShieldTrigger(true, candidates[0]); renderBattle(); onDone(); return;
    }
    const labels = buildCandidateLabels(item.side, def, candidates);
    promptChoice(`${def.name} の対象を選択`, labels.map((l) => ({ label: l.label, value: l.uid })), (uid) => {
      closeModal();
      engine.resolveShieldTrigger(true, uid);
      renderBattle();
      onDone();
    });
    return;
  }
  closeModal();
  engine.resolveShieldTrigger(true, null);
  renderBattle();
  onDone();
}

// ---------------- 結果 ----------------
function showResult() {
  const win = engine.result === 'player';
  $('resultTitle').textContent = win ? 'あなたの勝ち!' : 'あなたの負け...';
  meta.gamesPlayed++;
  if (win) meta.wins++; else meta.losses++;
  saveMeta(meta);
  showScreen('screen-result');
}
$('btnResultToTitle').onclick = () => { engine = null; renderTitle(); showScreen('screen-title'); };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

renderTitle();
showScreen('screen-title');
