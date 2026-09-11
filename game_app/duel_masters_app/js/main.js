// 画面遷移とDOM描画、ユーザー操作のワイヤリング
import {
  getCard, allCards, cardsByCivilization, cardSet, CIVILIZATIONS, isBlocker, isDoubleBreaker,
  hasShieldTrigger, validateDeck, DECK_MIN_SIZE, MAX_COPIES,
} from './cards.js';
import { DuelEngine } from './engine.js';
import { cpuTurnSteps, chooseBlockForCPU, autoResolveShieldTriggers } from './ai.js';
import { CPU_DECKS, getCpuDeck } from './decks.js';
import { loadDecks, saveDecks, newDeckId, loadMeta, saveMeta } from './state.js';

const $ = (id) => document.getElementById(id);

let decksData = loadDecks();
let meta = loadMeta();

// 過去のバグ(セッション毎にリセットされるnextUid()でデッキIDを採番していたため、
// 別セッションで作成したデッキ同士がID重複することがあった)で保存された重複IDを修復する
{
  const seenIds = new Set();
  let repaired = false;
  for (const d of decksData.decks) {
    if (d.id == null || seenIds.has(d.id)) {
      d.id = newDeckId();
      repaired = true;
    }
    seenIds.add(d.id);
  }
  if (repaired) saveDecks(decksData);
}

let engine = null;
let cpuGen = null;
let manaChargeMode = false;
let selectedAttackerUid = null;
let editingDeck = null; // { id: string|null, name: string, cardIds: string[] }
let editCivFilter = 'all';
let editSetFilter = 'all';
let editCostMin = null;
let editCostMax = null;
let editPowerMin = null;
let editPowerMax = null;
let editSortKey = 'name';
let editSortDir = 'asc';
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

// ---------------- 対象選択の共通処理 ----------------
// spec.kind別に、候補uidが属するゾーンからカード名ラベルを組み立てる
function labelForCandidate(side, kind, uid) {
  const opp = engine.opponent(side);
  let inst = null;
  if (kind === 'enemyCreature') inst = engine.players[opp].battle.find((c) => c.uid === uid);
  else if (kind === 'ownCreature') inst = engine.players[side].battle.find((c) => c.uid === uid);
  else if (kind === 'anyCreature') inst = engine.players.player.battle.find((c) => c.uid === uid) || engine.players.cpu.battle.find((c) => c.uid === uid);
  else if (kind === 'ownGraveyardCreature' || kind === 'ownGraveyardCard') inst = engine.players[side].graveyard.find((c) => c.uid === uid);
  else if (kind === 'ownHandCard') inst = engine.players[side].hand.find((c) => c.uid === uid);
  else if (kind === 'deckTutor') inst = engine.players[side].deck.find((c) => c.uid === uid);
  else if (kind === 'enemyManaCard') inst = engine.players[opp].mana.find((c) => c.uid === uid);
  else if (kind === 'ownManaCard') inst = engine.players[side].mana.find((c) => c.uid === uid);
  else if (kind === 'shieldQuantity') return `${uid}枚`;
  if (!inst) return '(不明なカード)';
  const d = inst.stack ? engine.cardOf(inst) : getCard(inst.cardId);
  return `${d.name}${d.power != null ? ` (P${d.power})` : ''}`;
}

// spec: {kind, min, max, filter} に従い、min〜max件選ばせてから onComplete(uids) を呼ぶ
function promptTargetSelection(side, spec, onComplete) {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const chosen = [];
  function step() {
    const remaining = (engine.getTargetCandidates(side, spec) || []).filter((uid) => !chosen.includes(uid));
    if (remaining.length === 0 || chosen.length >= max) { closeModal(); onComplete(chosen); return; }
    const options = remaining.map((uid) => ({ label: labelForCandidate(side, spec.kind, uid), value: uid }));
    if (chosen.length >= min) options.push({ label: `これで決定(${chosen.length}件選択中)`, value: '__done__' });
    promptChoice(`対象を選択${max > 1 ? `(最大${max}件)` : ''}`, options, (val) => {
      if (val === '__done__') { closeModal(); onComplete(chosen); return; }
      chosen.push(val);
      step();
    });
  }
  const initial = engine.getTargetCandidates(side, spec) || [];
  if (initial.length === 0) { onComplete([]); return; }
  step();
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

function resetFilters() {
  editCivFilter = 'all';
  editSetFilter = 'all';
  editCostMin = null;
  editCostMax = null;
  editPowerMin = null;
  editPowerMax = null;
  editSortKey = 'name';
  editSortDir = 'asc';
}

function startEditDeck(deck) {
  editingDeck = { id: deck.id, name: deck.name, cardIds: [...deck.cardIds] };
  $('deckListPanel').classList.add('hidden');
  $('deckEditPanel').classList.remove('hidden');
  $('deckNameInput').value = editingDeck.name;
  $('btnDeleteDeck').classList.toggle('hidden', deck.id == null);
  resetFilters();
  $('costMinInput').value = '';
  $('costMaxInput').value = '';
  $('powerMinInput').value = '';
  $('powerMaxInput').value = '';
  $('sortKeySelect').value = editSortKey;
  $('btnSortDir').textContent = '昇順 ▲';
  renderCivTabs();
  renderSetTabs();
  renderDeckEditPanel();
}
$('deckNameInput').oninput = (e) => { if (editingDeck) editingDeck.name = e.target.value; };

function parseFilterNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}
$('costMinInput').oninput = (e) => { editCostMin = parseFilterNumber(e.target.value); renderDeckEditPanel(); };
$('costMaxInput').oninput = (e) => { editCostMax = parseFilterNumber(e.target.value); renderDeckEditPanel(); };
$('powerMinInput').oninput = (e) => { editPowerMin = parseFilterNumber(e.target.value); renderDeckEditPanel(); };
$('powerMaxInput').oninput = (e) => { editPowerMax = parseFilterNumber(e.target.value); renderDeckEditPanel(); };
$('sortKeySelect').onchange = (e) => { editSortKey = e.target.value; renderDeckEditPanel(); };
$('btnSortDir').onclick = () => {
  editSortDir = editSortDir === 'asc' ? 'desc' : 'asc';
  $('btnSortDir').textContent = editSortDir === 'asc' ? '昇順 ▲' : '降順 ▼';
  renderDeckEditPanel();
};
$('btnClearFilters').onclick = () => {
  resetFilters();
  $('costMinInput').value = '';
  $('costMaxInput').value = '';
  $('powerMinInput').value = '';
  $('powerMaxInput').value = '';
  $('sortKeySelect').value = editSortKey;
  $('btnSortDir').textContent = '昇順 ▲';
  renderCivTabs();
  renderSetTabs();
  renderDeckEditPanel();
};

function renderCivTabs() {
  const tabs = $('civTabs');
  tabs.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'btn btn-small civ-tab' + (editCivFilter === 'all' ? ' active' : '');
  allBtn.textContent = 'すべて';
  allBtn.onclick = () => { editCivFilter = 'all'; renderCivTabs(); renderDeckEditPanel(); };
  tabs.appendChild(allBtn);
  for (const civ of Object.keys(CIVILIZATIONS)) {
    const b = document.createElement('button');
    b.className = 'btn btn-small civ-tab' + (civ === editCivFilter ? ' active' : '');
    b.style.setProperty('--civ-color', CIVILIZATIONS[civ].color);
    b.textContent = CIVILIZATIONS[civ].name;
    b.onclick = () => { editCivFilter = civ; renderCivTabs(); renderDeckEditPanel(); };
    tabs.appendChild(b);
  }
}

function renderSetTabs() {
  const tabs = $('setTabs');
  tabs.innerHTML = '';
  const options = [['all', 'すべて'], ['DM-01', '第1弾'], ['DM-02', '第2弾'], ['DM-03', '第3弾']];
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.className = 'btn btn-small set-tab' + (editSetFilter === value ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { editSetFilter = value; renderSetTabs(); renderDeckEditPanel(); };
    tabs.appendChild(b);
  }
}

function countInDeck(cardId) {
  return editingDeck.cardIds.filter((id) => id === cardId).length;
}

function keywordBadges(def) {
  const kw = [];
  if (isBlocker(def)) kw.push('B');
  if (isDoubleBreaker(def)) kw.push('W');
  if (hasShieldTrigger(def)) kw.push('S');
  if (def.keywords?.slayer) kw.push('SL');
  return kw;
}

function cardMiniCard(def, count) {
  const div = document.createElement('div');
  div.className = 'mini-card civ-' + def.civ;
  const kw = keywordBadges(def);
  const setLabel = cardSet(def) === 'DM-03' ? '第3弾' : cardSet(def) === 'DM-02' ? '第2弾' : '第1弾';
  div.innerHTML = `
    <div class="mini-card-top">
      <span class="mini-cost">${def.cost}</span>
      <span class="mini-name">${escapeHtml(def.name)}</span>
      ${def.power != null ? `<span class="mini-power">P${def.power}</span>` : ''}
    </div>
    <div class="mini-card-mid">${def.type === 'creature' ? escapeHtml(def.race || '') : '呪文'} (${def.rarity}・${setLabel}) ${kw.map((k) => `<span class="badge badge-${k}">${k}</span>`).join('')}</div>
    <div class="mini-card-text">${escapeHtml(def.text || '')}</div>
    ${count != null ? `<div class="mini-count">採用: ${count}枚</div>` : ''}
  `;
  return div;
}

// フィルター・並び替え条件に従ってカードプールを絞り込む
function filteredSortedPool() {
  let list = editCivFilter === 'all' ? allCards() : cardsByCivilization(editCivFilter);
  if (editSetFilter !== 'all') list = list.filter((d) => cardSet(d) === editSetFilter);
  if (editCostMin != null) list = list.filter((d) => d.cost >= editCostMin);
  if (editCostMax != null) list = list.filter((d) => d.cost <= editCostMax);
  if (editPowerMin != null) list = list.filter((d) => d.power == null || d.power >= editPowerMin);
  if (editPowerMax != null) list = list.filter((d) => d.power == null || d.power <= editPowerMax);
  list = [...list].sort((a, b) => {
    let cmp = 0;
    if (editSortKey === 'cost') cmp = a.cost - b.cost;
    else if (editSortKey === 'power') cmp = (a.power ?? -1) - (b.power ?? -1);
    else if (editSortKey === 'civ') cmp = a.civ.localeCompare(b.civ);
    else if (editSortKey === 'set') cmp = cardSet(a).localeCompare(cardSet(b));
    if (cmp === 0) cmp = a.name.localeCompare(b.name, 'ja');
    return editSortDir === 'desc' ? -cmp : cmp;
  });
  return list;
}

function renderDeckEditPanel() {
  $('deckCountDisplay').textContent = `合計: ${editingDeck.cardIds.length}枚 (${DECK_MIN_SIZE}枚以上・同名${MAX_COPIES}枚まで)`;
  const errors = validateDeck(editingDeck.cardIds);
  $('deckValidationMsg').textContent = errors.length ? errors.join(' / ') : '条件を満たしています。';
  $('deckValidationMsg').classList.toggle('hint-ok', errors.length === 0);

  const poolCards = filteredSortedPool();
  $('cardPoolCount').textContent = String(poolCards.length);
  const pool = $('cardPoolList');
  pool.innerHTML = '';
  for (const def of poolCards) {
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
    decksData.decks.push({ id: newDeckId(), name: editingDeck.name || '名称未設定', cardIds: editingDeck.cardIds });
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
  const cpuDeckStillValid = CPU_DECKS.some((d) => d.id === selectedCpuDeckId) || validDecks.some((d) => d.id === selectedCpuDeckId);
  if (!cpuDeckStillValid) selectedCpuDeckId = CPU_DECKS[0].id;
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
  if (validDecks.length > 0) {
    const sep = document.createElement('p');
    sep.className = 'hint select-wrap-sep';
    sep.textContent = 'あなたが編成したデッキ';
    cdWrap.appendChild(sep);
    for (const d of validDecks) {
      const b = document.createElement('button');
      b.className = 'btn deck-select-btn' + (d.id === selectedCpuDeckId ? ' active' : '');
      b.innerHTML = `<strong>${escapeHtml(d.name)}</strong><span class="hint">${d.cardIds.length}枚・自分で編成したデッキ</span>`;
      b.onclick = () => { selectedCpuDeckId = d.id; renderCpuSelect(); };
      cdWrap.appendChild(b);
    }
  }
  $('btnStartDuel').disabled = !selectedPlayerDeckId;
}
$('btnBackFromCpuSelect').onclick = () => { renderTitle(); showScreen('screen-title'); };
$('btnStartDuel').onclick = () => {
  const playerDeck = decksData.decks.find((d) => d.id === selectedPlayerDeckId);
  const cpuPreset = getCpuDeck(selectedCpuDeckId);
  const cpuCardIds = cpuPreset ? cpuPreset.cardIds : decksData.decks.find((d) => d.id === selectedCpuDeckId)?.cardIds;
  if (!cpuCardIds) return;
  startDuel(playerDeck.cardIds, cpuCardIds);
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

function renderZoneCard(side, inst, opts = {}) {
  const def = engine.cardOf(inst);
  const div = document.createElement('div');
  div.className = 'zone-card civ-' + def.civ;
  if (inst.tapped) div.classList.add('tapped');
  if (inst.sickness) div.classList.add('sick');
  if (opts.selected) div.classList.add('selected');
  if (opts.attackable) div.classList.add('attackable');
  const kw = keywordBadges(def);
  const atkBonus = engine.powerWhileAttacking(side, inst) - engine.powerBase(side, inst);
  const evoChain = inst.stack && inst.stack.length > 1
    ? `<div class="zc-evo">進化元: ${inst.stack.slice(0, -1).map((l) => escapeHtml(getCard(l.cardId).name)).join(' → ')}</div>`
    : '';
  div.innerHTML = `
    <div class="zc-top">${civBadge(def.civ)}<span class="zc-cost">${def.cost}</span></div>
    <div class="zc-name">${escapeHtml(def.name)}</div>
    <div class="zc-power">${def.power != null ? 'P' + engine.powerBase(side, inst) + (atkBonus ? `(攻+${atkBonus})` : '') : ''}</div>
    <div class="zc-kw">${kw.map((k) => `<span class="badge badge-${k}">${k}</span>`).join('')}</div>
    ${evoChain}
  `;
  if (opts.onClick) div.onclick = opts.onClick;
  return div;
}

// マナゾーンの文明ごとの内訳(未タップ/合計)を、文明カラーのタグとして組み立てる
function manaCivBreakdown(ps) {
  const counts = {};
  for (const m of ps.mana) {
    const civ = getCard(m.cardId).civ;
    if (!counts[civ]) counts[civ] = { total: 0, untapped: 0 };
    counts[civ].total++;
    if (!m.tapped) counts[civ].untapped++;
  }
  return Object.keys(CIVILIZATIONS)
    .filter((civ) => counts[civ])
    .map((civ) => `<span class="civ-tag mana-civ-tag" style="--civ-color:${CIVILIZATIONS[civ].color}">${CIVILIZATIONS[civ].name} ${counts[civ].untapped}/${counts[civ].total}</span>`)
    .join('');
}

function renderBattle() {
  if (!engine) return;
  const opp = engine.players.cpu;
  const me = engine.players.player;
  const myTurn = engine.turnSide === 'player';

  $('oppInfo').innerHTML = `CPU — シールド ${opp.shields.length} / 手札 ${opp.hand.length} / 山札 ${opp.deck.length} / 墓地 ${opp.graveyard.length}`;
  $('selfInfo').innerHTML = `あなた — シールド ${me.shields.length} / 山札 ${me.deck.length} / 墓地 ${me.graveyard.length} — ${myTurn ? 'あなたのターン' : 'CPUのターン'} (${engine.phase === 'main' ? 'メインフェーズ' : 'アタックフェーズ'})`;

  const attackableEnemyUids = (myTurn && engine.phase === 'attack' && selectedAttackerUid)
    ? engine.validCreatureAttackTargets('player', selectedAttackerUid)
    : [];

  const oppBattle = $('oppBattleZone');
  oppBattle.innerHTML = '';
  for (const c of opp.battle) {
    const canBeAttacked = attackableEnemyUids.includes(c.uid);
    oppBattle.appendChild(renderZoneCard('cpu', c, {
      attackable: canBeAttacked,
      onClick: canBeAttacked ? () => performAttack({ type: 'creature', uid: c.uid }) : null,
    }));
  }
  $('oppManaZone').innerHTML = `<span class="zone-label">CPUマナ: ${opp.mana.filter((m) => !m.tapped).length}/${opp.mana.length}</span>${manaCivBreakdown(opp)}`;

  const selfBattle = $('selfBattleZone');
  selfBattle.innerHTML = '';
  const ignoreRestrictions = engine.turnFlags.player?.ignoreAttackRestrictions;
  for (const c of me.battle) {
    const eligible = !c.tapped && (ignoreRestrictions || !c.sickness) && engine.canAttackAtAll('player', c);
    selfBattle.appendChild(renderZoneCard('player', c, {
      selected: c.uid === selectedAttackerUid,
      onClick: (myTurn && engine.phase === 'attack' && eligible) ? () => selectAttacker(c.uid) : null,
    }));
  }
  $('selfManaZone').innerHTML = `<span class="zone-label">マナ: ${me.mana.filter((m) => !m.tapped).length}/${me.mana.length}</span>${manaCivBreakdown(me)}`;

  $('logPanel').innerHTML = engine.log.slice(-8).map((m) => `<div>${escapeHtml(m)}</div>`).join('');
  $('logPanel').scrollTop = $('logPanel').scrollHeight;

  const hand = $('handRow');
  hand.innerHTML = '';
  for (const inst of me.hand) {
    const def = getCard(inst.cardId);
    const div = document.createElement('div');
    div.className = 'hand-card civ-' + def.civ;
    const affordable = engine.canPayCost('player', def) && (!def.evolution || engine.getEvolutionTargets('player', def).length > 0);
    if (!myTurn || engine.phase !== 'main') div.classList.add('disabled');
    const kw = keywordBadges(def);
    if (def.evolution) kw.unshift('進化');
    div.innerHTML = `
      <div class="zc-top">${civBadge(def.civ)}<span class="zc-cost">${engine.effectiveCost('player', def)}</span></div>
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

function playHandCard(handUid) {
  const inst = engine.players.player.hand.find((c) => c.uid === handUid);
  if (!inst) return;
  const def = getCard(inst.cardId);
  if (!engine.canPayCost('player', def)) return;

  if (def.evolution) {
    const targets = engine.getEvolutionTargets('player', def);
    if (targets.length === 0) return;
    if (targets.length === 1) { doPlayEvolution(handUid, targets[0]); return; }
    const options = targets.map((uid) => {
      const slot = engine.players.player.battle.find((s) => s.uid === uid);
      return { label: `${engine.cardOf(slot).name}に進化させる`, value: uid };
    });
    promptChoice(`${def.name} の進化元を選択`, options, (uid) => { closeModal(); doPlayEvolution(handUid, uid); });
    return;
  }

  if (def.type === 'spell') {
    const spec = def.spell?.target;
    if (spec) {
      promptTargetSelection('player', spec, (uids) => {
        engine.playCard('player', handUid, { targetUids: uids });
        renderBattle();
        checkGameOverAfterAction();
      });
      return;
    }
    engine.playCard('player', handUid, {});
    renderBattle();
    checkGameOverAfterAction();
    return;
  }

  const result = engine.playCard('player', handUid, {});
  renderBattle();
  if (result.awaitingCipTarget) {
    const spec = engine.pendingCip.ability.target;
    promptTargetSelection('player', spec, (uids) => {
      engine.resolveCip(uids);
      renderBattle();
      checkGameOverAfterAction();
    });
    return;
  }
  checkGameOverAfterAction();
}

function doPlayEvolution(handUid, targetUid) {
  const result = engine.playEvolutionCard('player', handUid, targetUid);
  renderBattle();
  if (result.awaitingCipTarget) {
    const spec = engine.pendingCip.ability.target;
    promptTargetSelection('player', spec, (uids) => {
      engine.resolveCip(uids);
      renderBattle();
      checkGameOverAfterAction();
    });
    return;
  }
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
  if (result.awaitingAttackTrigger) {
    const spec = engine.pendingAttackTrigger.ability.target;
    renderBattle();
    promptTargetSelection('player', spec, (uids) => {
      const r2 = engine.resolveAttackTrigger(uids);
      finishAttackFlow(r2);
    });
    return;
  }
  finishAttackFlow(result);
}

function finishAttackFlow(result) {
  if (result.awaitingBlock && engine.pendingBlock) {
    const blockUid = chooseBlockForCPU(engine, engine.pendingBlock.attackerUid);
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
$('btnAttackPhase').onclick = () => {
  engine.enterAttackPhase();
  engine.runForcedAttackers('player');
  autoResolveShieldTriggers(engine, 'cpu');
  renderBattle();
  checkGameOverAfterAction();
};
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
    const d = engine.cardOf(b);
    return { label: `${d.name} (P${engine.powerBase('player', b)}) でブロックする`, value: b.uid };
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
  const ability = def.type === 'creature' ? def.onPlay : def.spell;
  if (!ability || !ability.target) {
    closeModal();
    engine.resolveShieldTrigger(true, []);
    renderBattle();
    onDone();
    return;
  }
  closeModal();
  promptTargetSelection(item.side, ability.target, (uids) => {
    engine.resolveShieldTrigger(true, uids);
    renderBattle();
    onDone();
  });
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
