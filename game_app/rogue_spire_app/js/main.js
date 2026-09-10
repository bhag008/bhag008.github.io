import {
  STARTER_DECK, makeCardInstance, cardDisplayName, cardDescription, cardCost,
  cardType, cardTarget, rollCardRewards,
} from './cards.js';
import { relicName, relicDesc, rollRelicReward, rollBossRelicReward } from './relics.js';
import { rollNormalEncounter, rollEliteEncounter, rollBossEncounter } from './enemies.js';
import { generateMap, getNode, availableNodeIds, FLOORS, SLOTS } from './map.js';
import { CombatEngine } from './combat.js';
import { loadMeta, saveMeta, loadRun, saveRun, clearRun, hasSavedRun } from './state.js';

const el = id => document.getElementById(id);
const screens = ['screen-title', 'screen-map', 'screen-combat', 'screen-reward', 'screen-relic', 'screen-rest', 'screen-gameover'];

let run = null;
let combatEngine = null;
let pendingNode = null;
let selectedCardUid = null;

const RELIC_ICONS = {
  ashenHeart: '💗', hardShell: '🛡️', markOfFury: '⚔️', swiftFeet: '🥾',
  vengefulThorns: '🌵', alchemicVial: '🧪', travelersCharm: '🍀',
};
const STATUS_LABELS = { weak: '脱力', vulnerable: '弱体', frail: '防御低下', poison: '毒' };

function showScreen(id) {
  for (const s of screens) el(s).classList.toggle('hidden', s !== id);
}

// ---------- Title ----------
function renderTitle() {
  const meta = loadMeta();
  el('metaStats').innerHTML = `
    <span>挑戦回数 ${meta.runsPlayed}</span>
    <span>踏破回数 ${meta.victories}</span>
    <span>最高到達フロア ${meta.bestFloor + 1}</span>
  `;
  el('btnContinue').classList.toggle('hidden', !hasSavedRun());
  showScreen('screen-title');
}

function createNewRun() {
  return {
    hp: 72,
    maxHp: 72,
    energyMax: 3,
    deck: STARTER_DECK.map(id => makeCardInstance(id, false)),
    relics: ['ashenHeart'],
    map: generateMap(),
    currentNodeId: null,
    floorReached: 0,
  };
}

el('btnNewRun').addEventListener('click', () => {
  if (hasSavedRun() && !confirm('現在のランを破棄して新しく始めますか?')) return;
  run = createNewRun();
  saveRun(run);
  goToMap();
});

el('btnContinue').addEventListener('click', () => {
  run = loadRun();
  if (!run) { renderTitle(); return; }
  goToMap();
});

el('btnBackToTitle').addEventListener('click', () => {
  run = null;
  renderTitle();
});

// ---------- Map ----------
function goToMap() {
  showScreen('screen-map');
  renderMap();
}

function nodePixelPos(node) {
  const margin = 14;
  const x = SLOTS > 1 ? margin + (node.slot * (100 - 2 * margin)) / (SLOTS - 1) : 50;
  const y = 50 + node.floor * 92;
  return { x, y };
}

function renderMap() {
  el('mapHpText').textContent = `${run.hp}/${run.maxHp}`;
  el('relicRow').innerHTML = run.relics.map(id =>
    `<div class="relic-icon" title="${relicName(id)}: ${relicDesc(id)}">${RELIC_ICONS[id] || '❔'}</div>`
  ).join('');

  const map = run.map;
  const available = new Set(availableNodeIds(map, run.currentNodeId));
  const totalHeight = 50 + FLOORS * 92 + 60;
  const svg = el('mapSvg');
  const nodesEl = el('mapNodes');
  el('mapScroll').style.minHeight = `${totalHeight + 40}px`;
  svg.setAttribute('viewBox', `0 0 100 ${totalHeight}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.height = `${totalHeight}px`;
  nodesEl.style.height = `${totalHeight}px`;

  let lines = '';
  for (const node of map.nodes) {
    const from = nodePixelPos(node);
    for (const nextId of node.next) {
      const target = getNode(map, nextId);
      const to = nodePixelPos(target);
      const dim = !(available.has(node.id) || node.visited) ? '#2a2536' : (node.visited ? '#4a4258' : '#5a4f70');
      lines += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${dim}" stroke-width="1.4" vector-effect="non-scaling-stroke" />`;
    }
  }
  svg.innerHTML = lines;

  const typeIcon = { battle: '⚔️', elite: '💀', rest: '🔥', boss: '👑' };
  let nodesHtml = '';
  for (const node of map.nodes) {
    const { x, y } = nodePixelPos(node);
    const isAvailable = available.has(node.id);
    const classes = ['map-node'];
    if (isAvailable) classes.push('available');
    if (node.visited) classes.push('visited');
    if (node.id === run.currentNodeId) classes.push('current');
    if (node.type === 'elite' || node.type === 'boss') classes.push(`node-${node.type}`);
    nodesHtml += `<div class="${classes.join(' ')}" style="left:${x}%; top:${y}px" data-id="${node.id}">${typeIcon[node.type]}</div>`;
  }
  nodesEl.innerHTML = nodesHtml;

  nodesEl.querySelectorAll('.map-node.available').forEach(elm => {
    elm.addEventListener('click', () => {
      const node = getNode(map, elm.dataset.id);
      enterNode(node);
    });
  });
}

function enterNode(node) {
  pendingNode = node;
  run.floorReached = Math.max(run.floorReached, node.floor);
  if (node.type === 'battle') startCombatForNode(rollNormalEncounter());
  else if (node.type === 'elite') startCombatForNode(rollEliteEncounter());
  else if (node.type === 'boss') startCombatForNode(rollBossEncounter());
  else if (node.type === 'rest') showRestScreen();
}

function finishNode(node) {
  node.visited = true;
  run.currentNodeId = node.id;
  run.floorReached = Math.max(run.floorReached, node.floor);
  if (node.type === 'boss') {
    handleVictory();
    return;
  }
  saveRun(run);
  goToMap();
}

// ---------- Combat ----------
function startCombatForNode(enemyIds) {
  combatEngine = new CombatEngine(run, enemyIds);
  selectedCardUid = null;
  showScreen('screen-combat');
  renderCombat();
  checkCombatEnd();
}

function intentDisplay(enemy) {
  const intent = enemy.intent;
  if (!intent) return '';
  switch (intent.kind) {
    case 'attack': {
      const hits = intent.hits || 1;
      const per = intent.value + (enemy.strength || 0);
      return `⚔️<span class="intent-val">${per}${hits > 1 ? `x${hits}` : ''}</span>`;
    }
    case 'attackDebuff': {
      const per = intent.value + (enemy.strength || 0);
      return `⚔️<span class="intent-val">${per}+${STATUS_LABELS[intent.debuffStat]}</span>`;
    }
    case 'defend':
      return `🛡️<span class="intent-val">${intent.value}</span>`;
    case 'buff':
      return `💪<span class="intent-val">+${intent.value}</span>`;
    case 'poison':
      return `☠️<span class="intent-val">${intent.value}</span>`;
    case 'weaken':
      return `➖<span class="intent-val">${intent.value}</span>`;
    default:
      return '?';
  }
}

function statusBadges(statuses) {
  return Object.entries(statuses)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="status-badge">${STATUS_LABELS[k] || k}${v}</span>`)
    .join('');
}

function renderCombat() {
  const p = combatEngine.player;
  el('combatHpText').textContent = `${p.hp}/${p.maxHp}${p.block > 0 ? ` 🛡${p.block}` : ''}`;
  const buffs = [];
  if (p.strength) buffs.push(`力+${p.strength}`);
  if (p.dexterity) buffs.push(`敏捷+${p.dexterity}`);
  if (p.thorns) buffs.push(`棘${p.thorns}`);
  if (p.regen) buffs.push(`再生${p.regen}`);
  el('combatBuffRow').innerHTML = buffs.map(b => `<span class="buff-chip">${b}</span>`).join('') + statusBadges(p.statuses);

  el('energyText').textContent = `${p.energy}/${p.energyMax}`;
  el('drawCount').textContent = `山 ${combatEngine.drawPile.length}`;
  el('discardCount').textContent = `捨 ${combatEngine.discardPile.length}`;
  el('exhaustCount').textContent = `消 ${combatEngine.exhaustPile.length}`;

  const alive = combatEngine.aliveEnemies();
  const needsTarget = selectedCardUid !== null;
  el('enemyRow').innerHTML = combatEngine.enemies.map(en => {
    const dead = en.hp <= 0;
    const classes = ['enemy-card'];
    if (dead) classes.push('dead');
    if (!dead && needsTarget) classes.push('targetable');
    const hpPct = Math.max(0, (en.hp / en.maxHp) * 100);
    return `<div class="${classes.join(' ')}" data-uid="${en.uid}">
      <div class="enemy-name">${en.name}</div>
      <div class="enemy-intent">${dead ? '💀' : intentDisplay(en)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${hpPct}%"></div></div>
      <div class="enemy-hp-text">${en.hp}/${en.maxHp}${en.block > 0 ? ` 🛡${en.block}` : ''}</div>
      <div class="status-icons">${statusBadges(en.statuses)}</div>
    </div>`;
  }).join('');

  el('enemyRow').querySelectorAll('.enemy-card.targetable').forEach(card => {
    card.addEventListener('click', () => {
      if (selectedCardUid === null) return;
      const res = combatEngine.playCard(selectedCardUid, Number(card.dataset.uid));
      selectedCardUid = null;
      el('targetHint').classList.add('hidden');
      if (res.ok) { renderCombat(); checkCombatEnd(); } else renderCombat();
    });
  });

  el('handRow').innerHTML = combatEngine.hand.map(inst => {
    const cost = cardCost(inst);
    const type = cardType(inst);
    const affordable = cost <= p.energy;
    const classes = ['card', `type-${type}`];
    if (!affordable) classes.push('unaffordable');
    if (inst.uid === selectedCardUid) classes.push('selected');
    return `<div class="${classes.join(' ')}" data-uid="${inst.uid}">
      <div class="card-cost">${cost}</div>
      <div class="card-name">${cardDisplayName(inst)}</div>
      <div class="card-type-tag">${typeLabel(type)}</div>
      <div class="card-desc">${cardDescription(inst)}</div>
    </div>`;
  }).join('');

  el('handRow').querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', () => onHandCardClick(Number(cardEl.dataset.uid)));
  });
}

function typeLabel(type) {
  return { attack: '攻撃', skill: 'スキル', power: 'パワー' }[type] || type;
}

function onHandCardClick(uid) {
  const inst = combatEngine.hand.find(c => c.uid === uid);
  if (!inst) return;
  const cost = cardCost(inst);
  if (cost > combatEngine.player.energy) return;

  if (selectedCardUid === uid) {
    selectedCardUid = null;
    el('targetHint').classList.add('hidden');
    renderCombat();
    return;
  }

  const target = cardTarget(inst);
  const alive = combatEngine.aliveEnemies();
  if (target === 'enemy' && alive.length > 1) {
    selectedCardUid = uid;
    el('targetHint').classList.remove('hidden');
    renderCombat();
    return;
  }
  const targetUid = target === 'enemy' && alive.length === 1 ? alive[0].uid : null;
  const res = combatEngine.playCard(uid, targetUid);
  if (res.ok) {
    selectedCardUid = null;
    el('targetHint').classList.add('hidden');
    renderCombat();
    checkCombatEnd();
  }
}

el('btnEndTurn').addEventListener('click', () => {
  selectedCardUid = null;
  el('targetHint').classList.add('hidden');
  combatEngine.endPlayerTurn();
  renderCombat();
  checkCombatEnd();
});

el('btnCombatDeckInfo').addEventListener('click', () => openDeckModal('山札一覧', run.deck));

function checkCombatEnd() {
  if (!combatEngine.result) return;
  combatEngine.applyResultsToRun();
  if (combatEngine.result === 'loss') {
    handleGameOver(false);
  } else {
    handleCombatWin();
  }
}

// ---------- Rewards ----------
function handleCombatWin() {
  const node = pendingNode;
  if (node.type === 'elite' || node.type === 'boss') {
    const relicId = node.type === 'boss' ? rollBossRelicReward(run.relics) : rollRelicReward(run.relics);
    if (relicId) {
      showRelicScreen(relicId);
      return;
    }
  }
  showCardRewardScreen();
}

function showRelicScreen(relicId) {
  showScreen('screen-relic');
  el('relicRewardCard').innerHTML = `
    <div class="r-icon">${RELIC_ICONS[relicId] || '❔'}</div>
    <div class="r-name">${relicName(relicId)}</div>
    <div class="r-desc">${relicDesc(relicId)}</div>
  `;
  el('btnTakeRelic').onclick = () => {
    run.relics.push(relicId);
    showCardRewardScreen();
  };
}

function showCardRewardScreen() {
  showScreen('screen-reward');
  const options = rollCardRewards(3);
  el('rewardCards').innerHTML = options.map(inst => `
    <div class="card reward-card type-${cardType(inst)}" data-uid="${inst.uid}">
      <div class="card-cost">${cardCost(inst)}</div>
      <div class="card-name">${cardDisplayName(inst)}</div>
      <div class="card-type-tag">${typeLabel(cardType(inst))}</div>
      <div class="card-desc">${cardDescription(inst)}</div>
    </div>
  `).join('');
  el('rewardCards').querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', () => {
      const inst = options.find(o => o.uid === Number(cardEl.dataset.uid));
      run.deck.push(inst);
      finishNode(pendingNode);
    });
  });
  el('btnSkipReward').onclick = () => finishNode(pendingNode);
}

// ---------- Rest ----------
function showRestScreen() {
  showScreen('screen-rest');
  el('restUpgradeList').classList.add('hidden');
  el('restUpgradeList').innerHTML = '';
  const canUpgrade = run.deck.some(c => !c.upgraded);
  el('btnRestUpgrade').disabled = !canUpgrade;

  el('btnRestHeal').onclick = () => {
    const bonus = run.relics.includes('travelersCharm') ? 1.1 : 1;
    const heal = Math.round(run.maxHp * 0.3 * bonus);
    run.hp = Math.min(run.maxHp, run.hp + heal);
    finishNode(pendingNode);
  };
  el('btnRestUpgrade').onclick = () => {
    const list = el('restUpgradeList');
    list.classList.remove('hidden');
    list.innerHTML = run.deck.filter(c => !c.upgraded).map(inst => `
      <div class="card deck-card type-${cardType(inst)}" data-uid="${inst.uid}">
        <div class="card-cost">${cardCost(inst)}</div>
        <div class="card-name">${cardDisplayName(inst)}</div>
        <div class="card-type-tag">${typeLabel(cardType(inst))}</div>
        <div class="card-desc">${cardDescription(inst)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const inst = run.deck.find(c => c.uid === Number(cardEl.dataset.uid));
        inst.upgraded = true;
        finishNode(pendingNode);
      });
    });
  };
}

// ---------- Game over / victory ----------
function handleVictory() {
  const meta = loadMeta();
  meta.runsPlayed++;
  meta.victories++;
  meta.bestFloor = Math.max(meta.bestFloor, run.floorReached);
  saveMeta(meta);
  clearRun();
  showScreen('screen-gameover');
  el('gameoverTitle').textContent = '灰塔を制覇した!';
  el('gameoverStats').textContent = `到達フロア: ${run.floorReached + 1} / 最終デッキ枚数: ${run.deck.length}`;
}

function handleGameOver() {
  const meta = loadMeta();
  meta.runsPlayed++;
  meta.bestFloor = Math.max(meta.bestFloor, run.floorReached);
  saveMeta(meta);
  clearRun();
  showScreen('screen-gameover');
  el('gameoverTitle').textContent = '力尽きた…';
  el('gameoverStats').textContent = `到達フロア: ${run.floorReached + 1} / デッキ枚数: ${run.deck.length}`;
}

// ---------- Deck modal ----------
function openDeckModal(title, deck) {
  el('deckModalTitle').textContent = `${title} (${deck.length}枚)`;
  el('deckModalList').innerHTML = deck.map(inst => `
    <div class="card deck-card type-${cardType(inst)}">
      <div class="card-cost">${cardCost(inst)}</div>
      <div class="card-name">${cardDisplayName(inst)}</div>
      <div class="card-type-tag">${typeLabel(cardType(inst))}</div>
      <div class="card-desc">${cardDescription(inst)}</div>
    </div>
  `).join('');
  el('deckModal').classList.remove('hidden');
}

el('btnViewDeck').addEventListener('click', () => openDeckModal('デッキ', run.deck));
el('btnCloseDeckModal').addEventListener('click', () => el('deckModal').classList.add('hidden'));

// ---------- Init ----------
renderTitle();
