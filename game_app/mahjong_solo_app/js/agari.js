import { countsOfKinds } from "./tiles.js";
import { hasStandardDecomposition, isChiitoitsu, checkKokushi } from "./decompose.js";

// 14枚(kind配列)が和了形かどうか
export function isWinningHand(kinds14) {
  const counts = countsOfKinds(kinds14);
  if (hasStandardDecomposition(counts)) return true;
  if (isChiitoitsu(counts)) return true;
  // 国士無双は和了牌がどれでも成立しうるので、揃っている13種のうち最後に足した1枚として簡易判定
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    if (checkKokushi(counts, k)) return true;
    break;
  }
  return false;
}

// 13枚(kind配列)のテンパイ判定。待ち牌kindの配列を返す（テンパイでなければ空配列）
export function getWaits(kinds13) {
  const waits = [];
  for (let k = 0; k < 34; k++) {
    const trial = kinds13.concat(k);
    if (isWinningHand(trial)) waits.push(k);
  }
  return waits;
}

export function isTenpai(kinds13) {
  return getWaits(kinds13).length > 0;
}
