// 戦闘エンジン: プレイヤー/敵の状態管理とカード効果解決
import { cardCost, cardEffects, cardExhaustsSelf, getCardDef } from './cards.js';
import { makeEnemyInstance, rollIntent } from './enemies.js';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class CombatEngine {
  constructor(run, enemyIds) {
    this.run = run;
    const hasSwiftFeet = run.relics.includes('swiftFeet');
    const hasVengefulThorns = run.relics.includes('vengefulThorns');
    this.hasHardShell = run.relics.includes('hardShell');
    const hasMarkOfFury = run.relics.includes('markOfFury');
    const hasAlchemicVial = run.relics.includes('alchemicVial');
    const hasGuardianAmulet = run.relics.includes('guardianAmulet');
    const hasNimbleBoots = run.relics.includes('nimbleBoots');
    const hasBloodPact = run.relics.includes('bloodPact');

    this.player = {
      hp: run.hp,
      maxHp: run.maxHp,
      block: 0,
      energy: 0,
      energyMax: run.energyMax + (hasAlchemicVial ? 1 : 0),
      strength: 0,
      dexterity: 0,
      thorns: hasVengefulThorns ? 3 : 0,
      regen: 0,
      statuses: { weak: 0, vulnerable: 0, frail: 0, poison: 0 },
      drawBonus: hasSwiftFeet ? 1 : 0,
    };
    this.enemies = enemyIds.map(makeEnemyInstance);
    this.drawPile = shuffle(run.deck);
    this.hand = [];
    this.discardPile = [];
    this.exhaustPile = [];
    this.turnNumber = 0;
    this.phase = 'player';
    this.result = null; // 'win' | 'loss' | null
    this.lastLog = [];

    if (hasMarkOfFury) this.player.strength += 1;
    if (hasNimbleBoots) this.player.dexterity += 2;
    if (hasBloodPact) {
      this.player.strength += 3;
      this.player.hp = Math.max(1, this.player.hp - 3);
    }

    for (const e of this.enemies) e.intent = rollIntent(e);
    this.startPlayerTurn(true);
    if (hasGuardianAmulet) this.player.block += 6;
  }

  log(msg) {
    this.lastLog.push(msg);
  }

  aliveEnemies() {
    return this.enemies.filter(e => e.hp > 0);
  }

  drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (this.drawPile.length === 0) {
        if (this.discardPile.length === 0) return;
        this.drawPile = shuffle(this.discardPile);
        this.discardPile = [];
      }
      this.hand.push(this.drawPile.pop());
    }
  }

  startPlayerTurn(isFirst = false) {
    this.turnNumber++;
    this.phase = 'player';
    this.player.block = 0;
    if (!isFirst) {
      if (this.player.statuses.poison > 0) {
        this.dealDamageToPlayer(this.player.statuses.poison, true);
        this.player.statuses.poison = Math.max(0, this.player.statuses.poison - 1);
      }
      if (this.player.regen > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.regen);
      }
    }
    this.player.energy = this.player.energyMax;
    this.discardPile.push(...this.hand);
    this.hand = [];
    this.drawCards(5 + this.player.drawBonus);
    this.checkResult();
  }

  computeIncomingDamage(base, attacker, defender) {
    let dmg = base + (attacker.strength || 0);
    if (attacker.statuses?.weak > 0) dmg = Math.floor(dmg * 0.75);
    if (defender.statuses?.vulnerable > 0) dmg = Math.floor(dmg * 1.5);
    if (defender === this.player && this.hasHardShell) dmg -= 1;
    return Math.max(0, dmg);
  }

  dealDamageToPlayer(amount, unblockable = false) {
    let remaining = amount;
    if (!unblockable && this.player.block > 0) {
      const absorbed = Math.min(this.player.block, remaining);
      this.player.block -= absorbed;
      remaining -= absorbed;
    }
    this.player.hp = Math.max(0, this.player.hp - remaining);
    this.checkResult();
    return remaining;
  }

  dealDamageToEnemy(enemy, amount) {
    let remaining = amount;
    if (enemy.block > 0) {
      const absorbed = Math.min(enemy.block, remaining);
      enemy.block -= absorbed;
      remaining -= absorbed;
    }
    enemy.hp = Math.max(0, enemy.hp - remaining);
    this.checkResult();
  }

  gainPlayerBlock(amount) {
    let b = amount + (this.player.dexterity || 0);
    if (this.player.statuses.frail > 0) b = Math.floor(b * 0.75);
    this.player.block += Math.max(0, b);
  }

  applyDebuff(target, stat, amount) {
    target.statuses[stat] = (target.statuses[stat] || 0) + amount;
  }

  playCard(uid, targetUid) {
    if (this.phase !== 'player' || this.result) return { ok: false, reason: 'not_your_turn' };
    const idx = this.hand.findIndex(c => c.uid === uid);
    if (idx === -1) return { ok: false, reason: 'not_in_hand' };
    const instance = this.hand[idx];
    const def = getCardDef(instance.defId);
    const cost = cardCost(instance);
    if (cost > this.player.energy) return { ok: false, reason: 'not_enough_energy' };

    let targetEnemy = null;
    if (def.target === 'enemy') {
      const alive = this.aliveEnemies();
      targetEnemy = alive.find(e => e.uid === targetUid) || (alive.length === 1 ? alive[0] : null);
      if (!targetEnemy) return { ok: false, reason: 'need_target' };
    }

    this.player.energy -= cost;
    this.hand.splice(idx, 1);

    for (const effect of cardEffects(instance)) {
      this.resolveEffect(effect, targetEnemy);
    }

    if (cardExhaustsSelf(instance)) this.exhaustPile.push(instance);
    else this.discardPile.push(instance);

    this.checkResult();
    return { ok: true };
  }

  resolveEffect(effect, targetEnemy) {
    switch (effect.type) {
      case 'damage': {
        const targets = effect.target === 'all' ? this.aliveEnemies() : [targetEnemy].filter(Boolean);
        const hits = effect.hits || 1;
        for (const enemy of targets) {
          for (let h = 0; h < hits; h++) {
            if (enemy.hp <= 0) break;
            const dmg = this.computeIncomingDamage(effect.amount, this.player, enemy);
            this.dealDamageToEnemy(enemy, dmg);
            if (enemy.thorns > 0) this.dealDamageToPlayer(enemy.thorns, true);
          }
        }
        break;
      }
      case 'executeDamage': {
        if (!targetEnemy) break;
        const useLow = targetEnemy.hp <= targetEnemy.maxHp * 0.5;
        const base = useLow ? effect.amountLow : effect.amount;
        const dmg = this.computeIncomingDamage(base, this.player, targetEnemy);
        this.dealDamageToEnemy(targetEnemy, dmg);
        if (targetEnemy.thorns > 0) this.dealDamageToPlayer(targetEnemy.thorns, true);
        break;
      }
      case 'block':
        this.gainPlayerBlock(effect.amount);
        break;
      case 'draw':
        this.drawCards(effect.amount);
        break;
      case 'energy':
        this.player.energy += effect.amount;
        break;
      case 'buff':
        this.player[effect.stat] = (this.player[effect.stat] || 0) + effect.amount;
        break;
      case 'debuff': {
        const targets = effect.target === 'all' ? this.aliveEnemies() : [targetEnemy].filter(Boolean);
        for (const enemy of targets) this.applyDebuff(enemy, effect.stat, effect.amount);
        break;
      }
      case 'heal':
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + effect.amount);
        break;
      case 'selfDamage':
        this.dealDamageToPlayer(effect.amount, true);
        break;
      case 'thornsBuff':
        this.player.thorns += effect.amount;
        break;
      case 'regenBuff':
        this.player.regen += effect.amount;
        break;
      default:
        break;
    }
  }

  endPlayerTurn() {
    if (this.phase !== 'player' || this.result) return;
    for (const stat of ['weak', 'vulnerable', 'frail']) {
      if (this.player.statuses[stat] > 0) this.player.statuses[stat]--;
    }
    this.phase = 'enemy';
    this.runEnemyTurn();
  }

  runEnemyTurn() {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      enemy.block = 0;
      if (enemy.statuses.poison > 0) {
        enemy.hp = Math.max(0, enemy.hp - enemy.statuses.poison);
        enemy.statuses.poison = Math.max(0, enemy.statuses.poison - 1);
      }
      if (enemy.hp <= 0) continue;
      this.executeIntent(enemy);
      if (this.result) return;
      for (const stat of ['weak', 'vulnerable']) {
        if (enemy.statuses[stat] > 0) enemy.statuses[stat]--;
      }
    }
    for (const enemy of this.aliveEnemies()) enemy.intent = rollIntent(enemy);
    this.checkResult();
    if (!this.result) this.startPlayerTurn(false);
  }

  executeIntent(enemy) {
    const intent = enemy.intent;
    if (!intent) return;
    switch (intent.kind) {
      case 'attack': {
        const hits = intent.hits || 1;
        for (let h = 0; h < hits; h++) {
          const dmg = this.computeIncomingDamage(intent.value, enemy, this.player);
          const taken = this.dealDamageToPlayer(dmg);
          if (this.player.thorns > 0) this.dealDamageToEnemy(enemy, this.player.thorns);
          if (this.result) return;
        }
        break;
      }
      case 'attackDebuff': {
        const dmg = this.computeIncomingDamage(intent.value, enemy, this.player);
        this.dealDamageToPlayer(dmg);
        if (this.player.thorns > 0) this.dealDamageToEnemy(enemy, this.player.thorns);
        this.applyDebuff(this.player, intent.debuffStat, intent.debuffAmount);
        break;
      }
      case 'defend':
        enemy.block += intent.value;
        break;
      case 'buff':
        enemy[intent.stat] = (enemy[intent.stat] || 0) + intent.value;
        break;
      case 'poison':
        this.applyDebuff(this.player, 'poison', intent.value);
        break;
      case 'weaken':
        this.applyDebuff(this.player, 'weak', intent.value);
        break;
      default:
        break;
    }
  }

  checkResult() {
    if (this.result) return;
    if (this.player.hp <= 0) {
      this.result = 'loss';
      return;
    }
    if (this.enemies.length > 0 && this.aliveEnemies().length === 0) {
      this.result = 'win';
    }
  }

  applyResultsToRun() {
    this.run.hp = this.player.hp;
  }
}
