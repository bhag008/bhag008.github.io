import { computeScoreFromHanFu } from "./yaku.js?v=4";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealerNotation(total, each) {
  return `${total}（${each}オール）`;
}

// 実際の得点に近い4択（正解含む）を作る。各選択肢は {total, notation}
export function buildQuizChoices(winResult) {
  const isDealer = winResult.score.isDealer;
  const correctTotal = winResult.score.total;
  const { han, fu, isYakuman, yakumanPower } = winResult;
  const totals = new Set([correctTotal]);
  const results = [{ total: correctTotal, notation: winResult.score.notation }];

  function tryAdd(h, f, yp) {
    if (results.length >= 4) return;
    if (h < 1) return;
    const r = computeScoreFromHanFu({ han: h, fu: Math.max(20, f), isYakuman: isYakuman && yp !== undefined, yakumanPower: yp }, isDealer);
    if (!totals.has(r.total)) {
      totals.add(r.total);
      results.push({ total: r.total, notation: r.notation });
    }
  }

  if (isYakuman) {
    tryAdd(han, fu, 1);
    tryAdd(han, fu, 2);
    tryAdd(han, fu, 3);
    // 通常役満の場合、上位の倍満/三倍満あたりも混ぜて紛らわしくする
    for (const b of [6000, 4000, 12000]) {
      if (results.length >= 4) break;
      if (isDealer) {
        const each = Math.ceil((b * 2) / 100) * 100;
        const total = each * 3;
        if (!totals.has(total)) { totals.add(total); results.push({ total, notation: dealerNotation(total, each) }); }
      } else {
        const childPay = Math.ceil(b / 100) * 100;
        const dealerPay = Math.ceil((b * 2) / 100) * 100;
        const total = childPay * 2 + dealerPay;
        if (!totals.has(total)) { totals.add(total); results.push({ total, notation: `${total}（${childPay}/${dealerPay}）` }); }
      }
    }
  } else {
    const fuSteps = fu === 25 ? [0] : [-10, 10, -20, 20];
    const hanSteps = [1, -1, 2, -2];
    outer:
    for (const dh of hanSteps) {
      for (const df of fuSteps) {
        if (results.length >= 4) break outer;
        tryAdd(han + dh, fu + df, undefined);
      }
    }
    // まだ足りなければ範囲を広げる
    let extra = 3;
    while (results.length < 4 && extra < 10) {
      tryAdd(han + extra, fu, undefined);
      tryAdd(Math.max(1, han - extra), fu, undefined);
      extra++;
    }
  }

  while (results.length < 4) {
    // 最終フォールバック: 適当にオフセットして必ず4択揃える
    const candidate = correctTotal + (results.length + 1) * 1000;
    if (!totals.has(candidate)) { totals.add(candidate); results.push({ total: candidate, notation: `${candidate}点` }); }
  }

  return shuffle(results.slice(0, 4));
}
