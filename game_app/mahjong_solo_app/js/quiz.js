import { computeScoreFromHanFu } from "./yaku.js";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 実際の得点に近い4択（正解含む）を作る
export function buildQuizChoices(winResult) {
  const correctTotal = winResult.score.total;
  const { han, fu, isYakuman, yakumanPower } = winResult;
  const totals = new Set([correctTotal]);
  const results = [correctTotal];

  function tryAdd(h, f, yp) {
    if (results.length >= 4) return;
    if (h < 1) return;
    const r = computeScoreFromHanFu({ han: h, fu: Math.max(20, f), isYakuman: isYakuman && yp !== undefined, yakumanPower: yp });
    if (!totals.has(r.total)) {
      totals.add(r.total);
      results.push(r.total);
    }
  }

  if (isYakuman) {
    tryAdd(han, fu, 1);
    tryAdd(han, fu, 2);
    tryAdd(han, fu, 3);
    // 通常役満の場合、上位の倍満/三倍満あたりも混ぜて紛らわしくする
    for (const b of [6000, 4000, 12000]) {
      if (results.length >= 4) break;
      const per = Math.ceil((b * 2) / 100) * 100;
      const total = per * 3;
      if (!totals.has(total)) { totals.add(total); results.push(total); }
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
    if (!totals.has(candidate)) { totals.add(candidate); results.push(candidate); }
  }

  return shuffle(results.slice(0, 4));
}
