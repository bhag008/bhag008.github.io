import { suitOf, numberOf, countsOf } from "./tiles.js";

// counts(34) -> 4面子+雀頭の分解を全て列挙する（標準形のみ）
// 戻り値: [{ melds: [{type:'triplet'|'sequence', kind, tiles:[k,k,k]}], pair: kind }]
export function decomposeStandard(counts) {
  return dedupeDecompositions(collectAll(counts));
}

// 標準形として成立しうるかどうかだけを高速に判定する（最初の1つが見つかり次第打ち切り）
export function hasStandardDecomposition(counts) {
  function findNextNonEmpty(c) {
    for (let k = 0; k < 34; k++) if (c[k] > 0) return k;
    return -1;
  }
  function canComplete(c) {
    const k = findNextNonEmpty(c);
    if (k === -1) return true;
    if (c[k] >= 3) {
      c[k] -= 3;
      if (canComplete(c)) { c[k] += 3; return true; }
      c[k] += 3;
    }
    const suit = suitOf(k);
    const num = numberOf(k);
    if (suit !== "z" && num <= 7 && c[k + 1] > 0 && c[k + 2] > 0) {
      c[k]--; c[k + 1]--; c[k + 2]--;
      if (canComplete(c)) { c[k]++; c[k + 1]++; c[k + 2]++; return true; }
      c[k]++; c[k + 1]++; c[k + 2]++;
    }
    return false;
  }
  for (let pairKind = 0; pairKind < 34; pairKind++) {
    if (counts[pairKind] < 2) continue;
    const c = counts.slice();
    c[pairKind] -= 2;
    if (canComplete(c)) return true;
  }
  return false;
}

function collectAll(counts) {
  const out = [];
  for (let pairKind = 0; pairKind < 34; pairKind++) {
    if (counts[pairKind] < 2) continue;
    const c = counts.slice();
    c[pairKind] -= 2;
    const meldStack = [];
    const localResults = [];

    function findNextNonEmpty(cc) {
      for (let k = 0; k < 34; k++) if (cc[k] > 0) return k;
      return -1;
    }

    function recur(cc) {
      const k = findNextNonEmpty(cc);
      if (k === -1) {
        localResults.push(meldStack.map(m => ({ ...m })));
        return;
      }
      if (cc[k] >= 3) {
        cc[k] -= 3;
        meldStack.push({ type: "triplet", kind: k, tiles: [k, k, k] });
        recur(cc);
        meldStack.pop();
        cc[k] += 3;
      }
      const suit = suitOf(k);
      const num = numberOf(k);
      if (suit !== "z" && num <= 7 && cc[k + 1] > 0 && cc[k + 2] > 0) {
        cc[k]--; cc[k + 1]--; cc[k + 2]--;
        meldStack.push({ type: "sequence", kind: k, tiles: [k, k + 1, k + 2] });
        recur(cc);
        meldStack.pop();
        cc[k]++; cc[k + 1]++; cc[k + 2]++;
      }
    }
    recur(c);
    for (const melds of localResults) {
      if (melds.length === 4) out.push({ pair: pairKind, melds });
    }
  }
  return out;
}

function dedupeDecompositions(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const key = d.pair + "|" + d.melds
      .map(m => m.type[0] + m.kind)
      .sort()
      .join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

// 14枚(配列)が標準形として和了かどうか、分解一覧を返す
export function winningDecompositions(tiles14) {
  const counts = countsOf(tiles14);
  return decomposeStandard(counts);
}

// 七対子判定
export function isChiitoitsu(counts) {
  let pairs = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 2) pairs++;
    else if (counts[k] > 2) return false; // 同一牌4枚は七対子不可（同種2組不可）
  }
  return pairs === 7;
}

const KOKUSHI_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
// 国士無双判定。戻り値: null | { thirteenWait: boolean }
export function checkKokushi(counts, winKind) {
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    if (!KOKUSHI_KINDS.includes(k)) return null;
  }
  let total = 0, pairKind = -1;
  for (const k of KOKUSHI_KINDS) {
    total += counts[k];
    if (counts[k] === 2) pairKind = k;
    if (counts[k] > 2) return null;
  }
  if (total !== 14) return null;
  if (pairKind === -1) return null;
  // 13面待ち: 和了牌を除いた13枚がKOKUSHI_KINDS全種を1枚ずつ持っていた場合
  const before = counts.slice();
  before[winKind]--;
  const has13 = KOKUSHI_KINDS.every(k => before[k] >= 1) &&
    KOKUSHI_KINDS.reduce((s, k) => s + before[k], 0) === 13;
  return { thirteenWait: has13 };
}

// 与えられた分解・待ち牌から待ちの形を判定
// group: {type:'pair'|'triplet'|'sequence', kind, tiles}
export function waitType(decomposition, winKind) {
  const { pair, melds } = decomposition;
  const candidates = [];
  if (pair === winKind) candidates.push({ role: "pair" });
  for (const m of melds) {
    if (m.type === "triplet" && m.kind === winKind) candidates.push({ role: "triplet", meld: m });
    if (m.type === "sequence" && m.tiles.includes(winKind)) candidates.push({ role: "sequence", meld: m, pos: m.tiles.indexOf(winKind) });
  }
  return candidates;
}
