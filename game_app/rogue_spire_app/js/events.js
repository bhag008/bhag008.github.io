// イベントデータベース。各選択肢は run を直接書き換え、結果テキストを返す。
import { allRewardEligibleIds, cardDisplayName, makeCardInstance, randomCardIdByRarity } from './cards.js';
import { rollRelicReward, relicName, applyRelicPickupEffect } from './relics.js';

function pickUpgradeable(run) {
  const list = run.deck.filter(c => !c.upgraded);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function healRun(run, amount) {
  run.hp = Math.min(run.maxHp, run.hp + amount);
}

function hurtRun(run, amount) {
  run.hp = Math.max(1, run.hp - amount);
}

export const EVENT_DB = {
  ashAltar: {
    title: '灰の祭壇',
    text: '古い祭壇に灰が積もっている。触れれば何かが起こりそうだ。',
    choices: [
      {
        label: '祭壇に触れる (HPを10失い、カードを1枚強化する)',
        apply(run) {
          hurtRun(run, 10);
          const card = pickUpgradeable(run);
          if (card) {
            card.upgraded = true;
            return `HPを10失った。「${cardDisplayName(card)}」が強化された。`;
          }
          return 'HPを10失った。強化できるカードはなかった。';
        },
      },
      { label: '立ち去る', apply: () => '静かに立ち去った。' },
    ],
  },
  goldenChest: {
    title: '黄金の小箱',
    text: '小さな箱を見つけた。開けるにはリスクが伴うかもしれない。',
    choices: [
      {
        label: '開ける (HPを8失うが、50ゴールドを得る)',
        apply(run) {
          hurtRun(run, 8);
          run.gold += 50;
          return 'HPを8失ったが、50ゴールドを手に入れた。';
        },
      },
      { label: 'そのままにする', apply: () => '箱には触れず立ち去った。' },
    ],
  },
  wanderingMerchant: {
    title: 'さまよう行商人',
    text: '怪しい行商人がガラクタを売りつけようとしてくる。',
    choices: [
      {
        label: 'カードを買う (30ゴールド)',
        canApply: run => run.gold >= 30,
        apply(run) {
          run.gold -= 30;
          const pool = allRewardEligibleIds();
          const id = pool[Math.floor(Math.random() * pool.length)];
          const card = makeCardInstance(id, false);
          run.deck.push(card);
          return `30ゴールドで「${cardDisplayName(card)}」を手に入れた。`;
        },
      },
      { label: '無視する', apply: () => '行商人を無視して立ち去った。' },
    ],
  },
  forgottenShrine: {
    title: '忘れられた祠',
    text: '祠の前に賽銭箱がある。',
    choices: [
      {
        label: '祈りを捧げる (20ゴールドを失い、HPを15回復する)',
        canApply: run => run.gold >= 20,
        apply(run) {
          run.gold -= 20;
          healRun(run, 15);
          return '祈りを捧げ、HPが15回復した。';
        },
      },
      { label: '立ち去る', apply: () => '祠に背を向けた。' },
    ],
  },
  cursedBlade: {
    title: '呪われた刃',
    text: '壁に刺さった剣。抜けば力を得られそうだが、代償もありそうだ。',
    choices: [
      {
        label: '剣を抜く (強力なカードを1枚得るが、ランダムなカードを1枚失う)',
        apply(run) {
          const id = randomCardIdByRarity('rare');
          const gained = makeCardInstance(id, false);
          run.deck.push(gained);
          let lostText = '';
          const removable = run.deck.filter(c => c.uid !== gained.uid);
          if (removable.length > 0) {
            const lost = removable[Math.floor(Math.random() * removable.length)];
            run.deck = run.deck.filter(c => c.uid !== lost.uid);
            lostText = `代わりに「${cardDisplayName(lost)}」を失った。`;
          }
          return `「${cardDisplayName(gained)}」を手に入れた。${lostText}`;
        },
      },
      { label: '触れない', apply: () => '剣には触れなかった。' },
    ],
  },
  restingSpirit: {
    title: '安らぐ亡霊',
    text: '亡霊が静かに佇んでいる。安らぎを分けてくれるかもしれない。',
    choices: [
      {
        label: '話しかける (最大HPが5増える)',
        apply(run) {
          run.maxHp += 5;
          run.hp += 5;
          return '最大HPが5増えた。';
        },
      },
      { label: 'そっとしておく', apply: () => '静かにその場を離れた。' },
    ],
  },
  trapRoom: {
    title: '罠の間',
    text: '床に不審な仕掛けがある。奥に何か光るものが見える。',
    choices: [
      {
        label: '奥へ進む (HPを8失うが、遺物を1つ得る)',
        apply(run) {
          hurtRun(run, 8);
          const relicId = rollRelicReward(run.relics);
          if (relicId) {
            run.relics.push(relicId);
            applyRelicPickupEffect(run, relicId);
            return `HPを8失ったが、「${relicName(relicId)}」を手に入れた。`;
          }
          return 'HPを8失ったが、これ以上遺物は見つからなかった。';
        },
      },
      { label: '引き返す', apply: () => '罠を警戒して引き返した。' },
    ],
  },
  emberPool: {
    title: '燠火の泉',
    text: '仄かに光る泉。触れると力が漲る、あるいは焼け付くかもしれない。',
    choices: [
      {
        label: '泉に触れる (ランダムなカードを1枚強化する)',
        apply(run) {
          const card = pickUpgradeable(run);
          if (card) {
            card.upgraded = true;
            return `「${cardDisplayName(card)}」が強化された。`;
          }
          return '泉は静かなままだった。特に何も起きなかった。';
        },
      },
      { label: '見送る', apply: () => '泉には触れず見送った。' },
    ],
  },
};

export function rollEvent() {
  const ids = Object.keys(EVENT_DB);
  return ids[Math.floor(Math.random() * ids.length)];
}
