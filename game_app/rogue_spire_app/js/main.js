import {
  STARTER_DECK, makeCardInstance, cardDisplayName, cardDescription, cardCost,
  cardType, cardTarget, cardRarity, cardPrice, rollCardRewards, rollRareCardRewards,
  randomCardIdByRarity, allCardIds, getCardDef,
  RARITY_ORDER, RARITY_LABELS,
} from './cards.js';
import {
  relicName, relicDesc, rollRelicReward, rollBossRelicReward, applyRelicPickupEffect,
  allRelicIds, relicRarity, RELIC_RARITY_ORDER, RELIC_RARITY_LABELS,
} from './relics.js';
import { rollNormalEncounter, rollEliteEncounter, rollBossEncounter, getEnemyDef, ACT_POOLS } from './enemies.js';
import { generateMap, getNode, availableNodeIds, FLOORS, SLOTS } from './map.js';
import { CombatEngine } from './combat.js';
import { loadMeta, saveMeta, loadRun, saveRun, clearRun, hasSavedRun } from './state.js';
import { generateShopStock } from './shop.js';
import { EVENT_DB, rollEvent } from './events.js';

const el = id => document.getElementById(id);
const screens = [
  'screen-title', 'screen-map', 'screen-combat', 'screen-reward', 'screen-relic', 'screen-rest',
  'screen-gameover', 'screen-shop', 'screen-event', 'screen-actclear', 'screen-neow',
];
const TOTAL_ACTS = 3;

let run = null;
let combatEngine = null;
let pendingNode = null;
let selectedCardUid = null;
let lastGoldGain = 0;
let currentShopStock = null;

const RELIC_ICONS = {
  ashenHeart: '💗', hardShell: '🛡️', markOfFury: '⚔️', swiftFeet: '🥾',
  vengefulThorns: '🌵', alchemicVial: '🧪', travelersCharm: '🍀',
  guardianAmulet: '🔰', nimbleBoots: '👢', merchantsRing: '💍',
  bloodPact: '🩸', luckyCoin: '🪙', whetstone: '🪨',
  openingGambit: '⚡', openingVigor: '🔥', vitalCrystal: '💎', phoenixFeather: '🪶',
};
const STATUS_LABELS = { weak: '脱力', vulnerable: '弱体', frail: '防御低下', poison: '毒' };

function showScreen(id) {
  for (const s of screens) el(s).classList.toggle('hidden', s !== id);
}

function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    gold: 99,
    act: 1,
    cardsRemoved: 0,
    deck: STARTER_DECK.map(id => makeCardInstance(id, false)),
    relics: ['ashenHeart'],
    map: generateMap(),
    currentNodeId: null,
    floorReached: 0,
  };
}

function absoluteFloor(node) {
  return (run.act - 1) * (FLOORS + 1) + node.floor;
}

function rollGoldReward(nodeType) {
  const scale = (1 + (run.act - 1) * 0.4) * 1.2 * (run.relics.includes('merchantsRing') ? 1.2 : 1);
  if (nodeType === 'boss') return Math.round((75 + Math.floor(Math.random() * 26)) * scale);
  if (nodeType === 'elite') return Math.round((25 + Math.floor(Math.random() * 16)) * scale);
  return Math.round((10 + Math.floor(Math.random() * 11)) * scale);
}

const NEOW_OPTIONS = [
  {
    label: '最大HP+10',
    desc: '最大HPが10増え、HPが全回復する。',
    apply: r => { r.maxHp += 10; r.hp = r.maxHp; },
  },
  {
    label: 'ゴールド+100',
    desc: '100ゴールドを手に入れる。',
    apply: r => { r.gold += 100; },
  },
  {
    label: 'レアカードを1枚獲得',
    desc: 'ランダムなレアカードをデッキに加える。',
    apply: r => { r.deck.push(makeCardInstance(randomCardIdByRarity('rare'), false)); },
  },
  {
    label: '初期カードを1枚強化',
    desc: 'デッキ内のランダムなカードを1枚強化する。',
    apply: r => {
      const candidates = r.deck.filter(c => !c.upgraded);
      const pool = candidates.length > 0 ? candidates : r.deck;
      pool[Math.floor(Math.random() * pool.length)].upgraded = true;
    },
  },
];

function showNeowScreen() {
  showScreen('screen-neow');
  el('neowChoices').innerHTML = NEOW_OPTIONS.map((opt, i) => `
    <div class="relic-reward-card neow-choice" data-idx="${i}">
      <div class="r-name">${opt.label}</div>
      <div class="r-desc">${opt.desc}</div>
    </div>
  `).join('');
  el('neowChoices').querySelectorAll('.neow-choice').forEach(elm => {
    elm.addEventListener('click', () => {
      NEOW_OPTIONS[Number(elm.dataset.idx)].apply(run);
      saveRun(run);
      goToMap();
    });
  });
}

el('btnNewRun').addEventListener('click', () => {
  if (hasSavedRun() && !confirm('現在のランを破棄して新しく始めますか?')) return;
  run = createNewRun();
  saveRun(run);
  showNeowScreen();
});

el('btnContinue').addEventListener('click', () => {
  run = loadRun();
  if (!run) { renderTitle(); return; }
  if (typeof run.gold !== 'number') run.gold = 99;
  if (typeof run.act !== 'number') run.act = 1;
  if (typeof run.cardsRemoved !== 'number') run.cardsRemoved = 0;
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
  el('mapGoldText').textContent = run.gold;
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

  const typeIcon = { battle: '⚔️', elite: '💀', rest: '🔥', shop: '🏪', event: '❓', boss: '👑' };
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
  run.floorReached = Math.max(run.floorReached, absoluteFloor(node));
  if (node.type === 'battle') startCombatForNode(rollNormalEncounter(run.act, node.floor === 0));
  else if (node.type === 'elite') startCombatForNode(rollEliteEncounter(run.act));
  else if (node.type === 'boss') startCombatForNode(rollBossEncounter(run.act));
  else if (node.type === 'rest') showRestScreen();
  else if (node.type === 'shop') showShopScreen();
  else if (node.type === 'event') showEventScreen();
}

function finishNode(node) {
  node.visited = true;
  run.currentNodeId = node.id;
  run.floorReached = Math.max(run.floorReached, absoluteFloor(node));
  if (node.type === 'boss') {
    if (run.act < TOTAL_ACTS) handleActClear();
    else handleVictory();
    return;
  }
  saveRun(run);
  goToMap();
}

function handleActClear() {
  const clearedAct = run.act;
  run.act += 1;
  const missing = run.maxHp - run.hp;
  run.hp = Math.min(run.maxHp, run.hp + Math.round(missing * 0.75));
  run.map = generateMap();
  run.currentNodeId = null;
  saveRun(run);
  showScreen('screen-actclear');
  el('actClearTitle').textContent = `第${clearedAct}層を制覇した!`;
  el('actClearText').textContent = `力尽きかけた体を休め、HPが一部回復した。第${run.act}層へ向かう準備をしよう。`;
  el('btnNextAct').onclick = () => goToMap();
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
    case 'thorns':
      return `🦔<span class="intent-val">+${intent.value}</span>`;
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

function typeLabel(type) {
  return { attack: '攻撃', skill: 'スキル', power: 'パワー' }[type] || type;
}

function cardHtml(inst, extraClass = '', extraContentHtml = '') {
  const type = cardType(inst);
  const rarity = cardRarity(inst);
  const upgradePreview = inst.upgraded
    ? ''
    : `<div class="card-upgrade-desc">強化+: ${cardDescription(makeCardInstance(inst.defId, true))}</div>`;
  return `<div class="card ${extraClass} type-${type}" data-uid="${inst.uid}">
    <div class="card-cost">${cardCost(inst)}</div>
    <div class="card-name">${cardDisplayName(inst)}</div>
    <div class="card-type-tag">${typeLabel(type)} <span class="card-rarity rarity-${rarity}">${RARITY_LABELS[rarity]}</span></div>
    <div class="card-desc">${cardDescription(inst)}</div>
    ${upgradePreview}
    ${extraContentHtml}
  </div>`;
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
    const affordable = cardCost(inst) <= p.energy;
    const extraClass = [!affordable ? 'unaffordable' : '', inst.uid === selectedCardUid ? 'selected' : ''].filter(Boolean).join(' ');
    return cardHtml(inst, extraClass);
  }).join('');

  el('handRow').querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', () => onHandCardClick(Number(cardEl.dataset.uid)));
  });
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

el('btnCombatDeckInfo').addEventListener('click', () => openDeckModal('残りの山札', shuffledCopy(combatEngine.drawPile)));

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
  lastGoldGain = rollGoldReward(node.type);
  run.gold += lastGoldGain;

  const wasLowHp = run.hp <= run.maxHp * 0.5;
  let postCombatHeal = 0;
  if (run.relics.includes('ashenHeart')) postCombatHeal += 5;
  if (wasLowHp && run.relics.includes('phoenixFeather')) postCombatHeal += 12;
  if (postCombatHeal > 0) run.hp = Math.min(run.maxHp, run.hp + postCombatHeal);

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
    applyRelicPickupEffect(run, relicId);
    showCardRewardScreen();
  };
}

function showCardRewardScreen() {
  showScreen('screen-reward');
  el('goldGainText').textContent = lastGoldGain > 0 ? `💰 ${lastGoldGain} ゴールドを獲得した` : '';
  lastGoldGain = 0;
  const options = pendingNode.type === 'boss' ? rollRareCardRewards(3) : rollCardRewards(3);
  el('rewardCards').innerHTML = options.map(inst => cardHtml(inst, 'reward-card')).join('');
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
    const bonus = run.relics.includes('travelersCharm') ? 1.3 : 1;
    const heal = Math.round(run.maxHp * 0.3 * bonus);
    run.hp = Math.min(run.maxHp, run.hp + heal);
    finishNode(pendingNode);
  };
  el('btnRestUpgrade').onclick = () => {
    const list = el('restUpgradeList');
    list.classList.remove('hidden');
    list.innerHTML = run.deck.filter(c => !c.upgraded).map(inst => cardHtml(inst, 'deck-card')).join('');
    list.querySelectorAll('.card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const inst = run.deck.find(c => c.uid === Number(cardEl.dataset.uid));
        inst.upgraded = true;
        finishNode(pendingNode);
      });
    });
  };
}

// ---------- Shop ----------
const RELIC_PRICE = 150;

function shopPrice(basePrice) {
  return run.relics.includes('luckyCoin') ? Math.round(basePrice * 0.85) : basePrice;
}

function showShopScreen() {
  currentShopStock = generateShopStock(run);
  renderShop();
}

function renderShop() {
  showScreen('screen-shop');
  el('shopGoldText').textContent = run.gold;

  el('shopCards').innerHTML = currentShopStock.cards.map(inst => {
    const price = shopPrice(cardPrice(inst));
    const affordable = run.gold >= price;
    return cardHtml(inst, `reward-card${affordable ? '' : ' unaffordable-price'}`, `<div class="shop-item-price">💰${price}</div>`);
  }).join('');
  el('shopCards').querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', () => {
      const uid = Number(cardEl.dataset.uid);
      const inst = currentShopStock.cards.find(c => c.uid === uid);
      if (!inst) return;
      const price = shopPrice(cardPrice(inst));
      if (run.gold < price) return;
      run.gold -= price;
      run.deck.push(inst);
      currentShopStock.cards = currentShopStock.cards.filter(c => c.uid !== uid);
      renderShop();
    });
  });

  const relicWrap = el('shopRelicWrap');
  if (currentShopStock.relicId) {
    const relicId = currentShopStock.relicId;
    const price = shopPrice(RELIC_PRICE);
    const affordable = run.gold >= price;
    relicWrap.innerHTML = `
      <div class="relic-reward-card">
        <div class="r-icon">${RELIC_ICONS[relicId] || '❔'}</div>
        <div class="r-name">${relicName(relicId)}</div>
        <div class="r-desc">${relicDesc(relicId)}</div>
        <div class="shop-item-price">💰${price}</div>
      </div>
      <button id="btnBuyRelic" class="btn ${affordable ? 'btn-primary' : 'btn-ghost'}" ${affordable ? '' : 'disabled'}>遺物を買う</button>
    `;
    el('btnBuyRelic').onclick = () => {
      if (run.gold < price) return;
      run.gold -= price;
      run.relics.push(relicId);
      applyRelicPickupEffect(run, relicId);
      currentShopStock.relicId = null;
      renderShop();
    };
  } else {
    relicWrap.innerHTML = '';
  }

  const removalPrice = shopPrice(currentShopStock.removalPrice);
  const canRemove = run.deck.length > 5 && run.gold >= removalPrice;
  el('btnShopRemove').textContent = `カードを1枚削除する (💰${removalPrice})`;
  el('btnShopRemove').disabled = !canRemove;
  el('shopRemoveList').classList.add('hidden');
  el('shopRemoveList').innerHTML = '';
  el('btnShopRemove').onclick = () => {
    const list = el('shopRemoveList');
    list.classList.remove('hidden');
    list.innerHTML = run.deck.map(inst => cardHtml(inst, 'deck-card')).join('');
    list.querySelectorAll('.card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        if (run.gold < removalPrice) return;
        const uid = Number(cardEl.dataset.uid);
        run.gold -= removalPrice;
        run.deck = run.deck.filter(c => c.uid !== uid);
        run.cardsRemoved = (run.cardsRemoved || 0) + 1;
        currentShopStock.removalPrice = 75 + 25 * run.cardsRemoved;
        renderShop();
      });
    });
  };

  el('btnLeaveShop').onclick = () => finishNode(pendingNode);
}

// ---------- Event ----------
function showEventScreen() {
  const eventId = rollEvent();
  const def = EVENT_DB[eventId];
  showScreen('screen-event');
  el('eventTitle').textContent = def.title;
  el('eventText').textContent = def.text;
  el('eventResult').classList.add('hidden');
  el('eventResult').textContent = '';
  el('btnEventContinue').classList.add('hidden');

  const choicesEl = el('eventChoices');
  choicesEl.innerHTML = '';
  choicesEl.classList.remove('hidden');
  def.choices.forEach(choice => {
    const btn = document.createElement('button');
    const enabled = choice.canApply ? choice.canApply(run) : true;
    btn.className = `btn ${enabled ? 'btn-primary' : 'btn-ghost'}`;
    btn.textContent = choice.label;
    btn.disabled = !enabled;
    btn.addEventListener('click', () => {
      const resultText = choice.apply(run);
      choicesEl.classList.add('hidden');
      el('eventResult').textContent = resultText;
      el('eventResult').classList.remove('hidden');
      el('btnEventContinue').classList.remove('hidden');
    });
    choicesEl.appendChild(btn);
  });

  el('btnEventContinue').onclick = () => finishNode(pendingNode);
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
  el('deckModalList').innerHTML = deck.map(inst => cardHtml(inst, 'deck-card')).join('');
  el('deckModal').classList.remove('hidden');
}

el('btnViewDeck').addEventListener('click', () => openDeckModal('デッキ', run.deck));
el('btnCloseDeckModal').addEventListener('click', () => el('deckModal').classList.add('hidden'));

// ---------- Card list (compendium) ----------
function renderCardListModal() {
  const ids = allCardIds();
  let html = '';
  for (const rarity of RARITY_ORDER) {
    const idsInRarity = ids.filter(id => getCardDef(id).rarity === rarity);
    if (!idsInRarity.length) continue;
    html += `<h4 class="card-list-group">${RARITY_LABELS[rarity]}</h4><div class="card-list-grid">`;
    html += idsInRarity.map(id => cardHtml(makeCardInstance(id, false), 'list-card')).join('');
    html += `</div>`;
  }
  el('cardListModalBody').innerHTML = html;
  el('cardListModal').classList.remove('hidden');
}

el('btnCardListTitle').addEventListener('click', renderCardListModal);
el('btnCardListMap').addEventListener('click', renderCardListModal);
el('btnCloseCardListModal').addEventListener('click', () => el('cardListModal').classList.add('hidden'));

// ---------- Relic list (compendium) ----------
function renderRelicListModal() {
  const ownedIds = run ? run.relics : [];
  const ids = allRelicIds();
  let html = '';
  for (const rarity of RELIC_RARITY_ORDER) {
    const idsInRarity = ids.filter(id => relicRarity(id) === rarity);
    if (!idsInRarity.length) continue;
    html += `<h4 class="card-list-group">${RELIC_RARITY_LABELS[rarity]}</h4><div class="relic-list-grid">`;
    html += idsInRarity.map(id => {
      const owned = ownedIds.includes(id);
      return `<div class="relic-reward-card${owned ? ' owned' : ''}">
        <div class="r-icon">${RELIC_ICONS[id] || '❔'}</div>
        <div class="r-name">${relicName(id)}</div>
        <div class="r-desc">${relicDesc(id)}</div>
        ${owned ? '<div class="r-owned-badge">所持中</div>' : ''}
      </div>`;
    }).join('');
    html += `</div>`;
  }
  el('relicListModalBody').innerHTML = html;
  el('relicListModal').classList.remove('hidden');
}

el('btnRelicListTitle').addEventListener('click', renderRelicListModal);
el('btnRelicListMap').addEventListener('click', renderRelicListModal);
el('btnCloseRelicListModal').addEventListener('click', () => el('relicListModal').classList.add('hidden'));

// ---------- Enemy list (bestiary) ----------
const ACT_CATEGORY_LABELS = { normal: '通常', elite: 'エリート', boss: 'ボス' };

function patternStepText(step) {
  switch (step.kind) {
    case 'attack': {
      const hits = step.hits || 1;
      return `攻撃 ${step.value}${hits > 1 ? `×${hits}` : ''}`;
    }
    case 'attackDebuff':
      return `攻撃 ${step.value} + ${STATUS_LABELS[step.debuffStat] || step.debuffStat}${step.debuffAmount}`;
    case 'defend':
      return `防御 ${step.value}`;
    case 'buff':
      return `${step.stat === 'strength' ? '力' : step.stat}+${step.value}`;
    case 'thorns':
      return `棘+${step.value}`;
    case 'poison':
      return `毒${step.value}付与`;
    default:
      return '?';
  }
}

function enemyInfoCardHtml(id, category) {
  const def = getEnemyDef(id);
  const classes = ['enemy-info-card'];
  if (category === 'elite') classes.push('is-elite');
  if (category === 'boss') classes.push('is-boss');
  const patternHtml = def.pattern.map(step => `<span class="e-pattern-step">${patternStepText(step)}</span>`).join('');
  const thornsText = def.thorns ? ` / 棘${def.thorns}` : '';
  return `<div class="${classes.join(' ')}">
    <div class="e-name">${def.name}</div>
    <div class="e-hp"><span class="hp-icon">♥</span> ${def.maxHp[0]}〜${def.maxHp[1]}${thornsText}</div>
    <div class="e-pattern">${patternHtml}</div>
  </div>`;
}

function renderEnemyListModal() {
  let html = '';
  for (const act of [1, 2, 3]) {
    const pool = ACT_POOLS[act];
    html += `<h4 class="card-list-group">第${act}層</h4>`;
    for (const category of ['normal', 'elite', 'boss']) {
      const ids = category === 'boss' ? [pool.boss] : pool[category];
      html += `<h5 class="card-list-subgroup">${ACT_CATEGORY_LABELS[category]}</h5><div class="enemy-list-grid">`;
      html += ids.map(id => enemyInfoCardHtml(id, category)).join('');
      html += `</div>`;
    }
  }
  el('enemyListModalBody').innerHTML = html;
  el('enemyListModal').classList.remove('hidden');
}

el('btnEnemyListTitle').addEventListener('click', renderEnemyListModal);
el('btnEnemyListMap').addEventListener('click', renderEnemyListModal);
el('btnCloseEnemyListModal').addEventListener('click', () => el('enemyListModal').classList.add('hidden'));

// ---------- Init ----------
renderTitle();
