import { suitOf, isHonor, isTerminal, isTerminalOrHonor, countsOfKinds, HAKU, HATSU, CHUN } from "./tiles.js?v=4";
import { decomposeStandard, isChiitoitsu, checkKokushi, waitType } from "./decompose.js?v=4";

const DRAGONS = [HAKU, HATSU, CHUN];
const WINDS = [27, 28, 29, 30];
const GREEN_KINDS = new Set([19, 20, 21, 23, 25, HATSU]); // 2s,3s,4s,6s,8s,發 (sou0=18 -> 2s=19)
const CHUUREN_BASE = [3, 1, 1, 1, 1, 1, 1, 1, 3];

function isYakuhaiKind(kind, ctx) {
  return DRAGONS.includes(kind) || kind === ctx.roundWind || kind === ctx.seatWind;
}

function fuForMeld(meld) {
  if (meld.type !== "triplet") return 0;
  return isTerminalOrHonor(meld.kind) ? 8 : 4; // 常にツモ=暗刻扱い
}

function waitFu(role) {
  if (role.role === "pair") return 2; // 単騎
  if (role.role === "triplet") return 0; // シャンポン(暗刻分は別途加算済み)
  if (role.role === "sequence") {
    const startNum = (role.meld.kind % 9); // 0-indexed (0=1,...,6=7)
    if (startNum === 0 && role.pos === 2) return 2; // 123待ちの3 = ペンチャン
    if (startNum === 6 && role.pos === 0) return 2; // 789待ちの7 = ペンチャン
    if (role.pos === 1) return 2; // カンチャン
    return 0; // リャンメン
  }
  return 0;
}

function checkSanshokuDoujun(melds) {
  const seqStarts = { m: new Set(), p: new Set(), s: new Set() };
  for (const m of melds) {
    if (m.type === "sequence") seqStarts[suitOf(m.kind)].add(m.kind % 9);
  }
  for (const start of seqStarts.m) {
    if (seqStarts.p.has(start) && seqStarts.s.has(start)) return true;
  }
  return false;
}

function checkSanshokuDoukou(melds) {
  const triNums = { m: new Set(), p: new Set(), s: new Set() };
  for (const m of melds) {
    if (m.type === "triplet" && !isHonor(m.kind)) triNums[suitOf(m.kind)].add(m.kind % 9);
  }
  for (const n of triNums.m) {
    if (triNums.p.has(n) && triNums.s.has(n)) return true;
  }
  return false;
}

function checkIttsu(melds) {
  const seqStarts = { m: new Set(), p: new Set(), s: new Set() };
  for (const m of melds) {
    if (m.type === "sequence") seqStarts[suitOf(m.kind)].add(m.kind % 9);
  }
  for (const suit of ["m", "p", "s"]) {
    if (seqStarts[suit].has(0) && seqStarts[suit].has(3) && seqStarts[suit].has(6)) return true;
  }
  return false;
}

function groupHasTerminalOrHonor(group) {
  if (group.type === "sequence") {
    return group.kind % 9 === 0 || group.kind % 9 === 6;
  }
  return isTerminalOrHonor(group.kind);
}
function evaluateStandardDecomposition(decomposition, winKind, hand14, ctx) {
  const { pair, melds } = decomposition;
  const candidates = waitType(decomposition, winKind);
  const results = [];
  for (const role of candidates) {
    const yakuList = [];
    let fu = 20;
    for (const m of melds) fu += fuForMeld(m);
    if (isYakuhaiKind(pair, ctx)) fu += 2;

    const allSequences = melds.every(m => m.type === "sequence");
    const isRyanmen = role.role === "sequence" && !((role.meld.kind % 9 === 0 && role.pos === 2) || (role.meld.kind % 9 === 6 && role.pos === 0)) && role.pos !== 1;
    const isPinfu = allSequences && !isYakuhaiKind(pair, ctx) && isRyanmen;

    if (isPinfu) {
      fu = 20;
    } else {
      fu += waitFu(role);
      fu += 2; // ツモ符
      fu = Math.ceil(fu / 10) * 10;
    }

    // 役判定
    yakuList.push({ name: "門前清自摸和", han: 1 });
    if (ctx.isRiichi) yakuList.push({ name: "立直", han: 1 });
    if (ctx.isHaitei) yakuList.push({ name: "海底摸月", han: 1 });
    if (isPinfu) yakuList.push({ name: "平和", han: 1 });

    const allSimple = hand14.every(k => !isTerminalOrHonor(k));
    if (allSimple) yakuList.push({ name: "断幺九", han: 1 });

    // 一盃口 / 二盃口
    const seqKey = melds.filter(m => m.type === "sequence").map(m => m.kind);
    const seqCounts = {};
    for (const k of seqKey) seqCounts[k] = (seqCounts[k] || 0) + 1;
    const identicalPairs = Object.values(seqCounts).filter(c => c >= 2).length;
    if (identicalPairs >= 2) yakuList.push({ name: "二盃口", han: 3 });
    else if (identicalPairs === 1) yakuList.push({ name: "一盃口", han: 1 });

    // 役牌
    for (const d of DRAGONS) {
      if (melds.some(m => m.type === "triplet" && m.kind === d)) {
        yakuList.push({ name: "役牌(" + ({ [HAKU]: "白", [HATSU]: "發", [CHUN]: "中" })[d] + ")", han: 1 });
      }
    }
    for (const m of melds) {
      if (m.type === "triplet" && WINDS.includes(m.kind)) {
        let windHan = 0;
        const windNames = { 27: "東", 28: "南", 29: "西", 30: "北" };
        if (m.kind === ctx.roundWind) { windHan++; }
        if (m.kind === ctx.seatWind) { windHan++; }
        if (windHan > 0) yakuList.push({ name: (windHan === 2 ? "ダブル" : "") + windNames[m.kind], han: windHan });
      }
    }

    if (checkSanshokuDoujun(melds)) yakuList.push({ name: "三色同順", han: 2 });
    if (checkSanshokuDoukou(melds)) yakuList.push({ name: "三色同刻", han: 2 });
    if (checkIttsu(melds)) yakuList.push({ name: "一気通貫", han: 2 });

    const allGroups = [...melds, { type: "pair", kind: pair }];
    if (allGroups.every(groupHasTerminalOrHonor)) {
      const anyHonorTile = hand14.some(k => isHonor(k));
      if (!anyHonorTile) yakuList.push({ name: "純全帯幺九", han: 3 });
      else yakuList.push({ name: "混全帯幺九", han: 2 });
    }

    if (melds.every(m => m.type === "triplet")) yakuList.push({ name: "対々和", han: 2 });
    const ankouCount = melds.filter(m => m.type === "triplet").length;
    if (ankouCount === 3) yakuList.push({ name: "三暗刻", han: 2 });

    const honroutou = hand14.every(k => isTerminalOrHonor(k));
    if (honroutou) yakuList.push({ name: "混老頭", han: 2 });

    const dragonTriplets = DRAGONS.filter(d => melds.some(m => m.type === "triplet" && m.kind === d));
    if (dragonTriplets.length === 2 && DRAGONS.includes(pair)) {
      yakuList.push({ name: "小三元", han: 2 });
    }

    const suitsUsed = new Set(hand14.filter(k => !isHonor(k)).map(k => suitOf(k)));
    const hasHonorTile = hand14.some(k => isHonor(k));
    if (suitsUsed.size === 1) {
      if (hasHonorTile) yakuList.push({ name: "混一色", han: 3 });
      else yakuList.push({ name: "清一色", han: 6 });
    }

    results.push(buildResult(yakuList, fu, ctx, hand14));
  }
  return results;
}

function buildResult(yakuList, fu, ctx, hand14) {
  let han = yakuList.reduce((s, y) => s + y.han, 0);
  const doraHan = ctx.doraKinds.reduce((s, dk) => s + hand14.filter(k => k === dk).length, 0);
  if (doraHan > 0) yakuList.push({ name: "ドラ", han: doraHan });
  han += doraHan;
  return { yakuList, han, fu, isYakuman: false, yakumanPower: 0 };
}

function checkYakuman(hand14, counts, decompositions, winKind, ctx) {
  const results = [];

  const kokushi = checkKokushi(counts, winKind);
  if (kokushi) {
    results.push({
      yakuList: [{ name: kokushi.thirteenWait ? "国士無双十三面待ち" : "国士無双", han: kokushi.thirteenWait ? 26 : 13 }],
      han: kokushi.thirteenWait ? 26 : 13, fu: 0, isYakuman: true, yakumanPower: kokushi.thirteenWait ? 2 : 1,
    });
  }

  for (const decomposition of decompositions) {
    const { pair, melds } = decomposition;
    if (melds.every(m => m.type === "triplet")) {
      const roles = waitType(decomposition, winKind);
      for (const role of roles) {
        const isTanki = role.role === "pair";
        results.push({
          yakuList: [{ name: isTanki ? "四暗刻単騎" : "四暗刻", han: isTanki ? 26 : 13 }],
          han: isTanki ? 26 : 13, fu: 0, isYakuman: true, yakumanPower: isTanki ? 2 : 1,
        });
      }
      const dragonTri = melds.filter(m => DRAGONS.includes(m.kind)).length;
      if (dragonTri === 3) {
        results.push({ yakuList: [{ name: "大三元", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 1 });
      }
      const windTri = melds.filter(m => WINDS.includes(m.kind)).length;
      if (windTri === 4) {
        results.push({ yakuList: [{ name: "大四喜", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 2 });
      } else if (windTri === 3 && WINDS.includes(pair)) {
        results.push({ yakuList: [{ name: "小四喜", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 1 });
      }
    }
  }

  if (hand14.every(k => isHonor(k))) {
    results.push({ yakuList: [{ name: "字一色", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 1 });
  }
  if (hand14.every(k => isTerminal(k))) {
    results.push({ yakuList: [{ name: "清老頭", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 1 });
  }
  if (hand14.every(k => GREEN_KINDS.has(k))) {
    results.push({ yakuList: [{ name: "緑一色", han: 13 }], han: 13, fu: 0, isYakuman: true, yakumanPower: 1 });
  }

  const suitsUsed = new Set(hand14.filter(k => !isHonor(k)).map(k => suitOf(k)));
  if (suitsUsed.size === 1 && !hand14.some(k => isHonor(k))) {
    const suit = [...suitsUsed][0];
    const base0 = suit === "m" ? 0 : suit === "p" ? 9 : 18;
    const nineCounts = [];
    for (let i = 0; i < 9; i++) nineCounts.push(counts[base0 + i]);
    const diff = nineCounts.map((c, i) => c - CHUUREN_BASE[i]);
    const total = nineCounts.reduce((a, b) => a + b, 0);
    if (total === 14 && diff.every(d => d >= 0) && diff.reduce((a, b) => a + b, 0) === 1) {
      const before = nineCounts.slice();
      before[winKind - base0]--;
      const isPure = CHUUREN_BASE.every((v, i) => before[i] === v);
      results.push({
        yakuList: [{ name: isPure ? "純正九蓮宝燈" : "九蓮宝燈", han: isPure ? 26 : 13 }],
        han: isPure ? 26 : 13, fu: 0, isYakuman: true, yakumanPower: isPure ? 2 : 1,
      });
    }
  }

  return results;
}

function evaluateChiitoitsu(hand14, ctx) {
  const yakuList = [{ name: "門前清自摸和", han: 1 }, { name: "七対子", han: 2 }];
  if (ctx.isRiichi) yakuList.push({ name: "立直", han: 1 });
  if (ctx.isHaitei) yakuList.push({ name: "海底摸月", han: 1 });
  const allSimple = hand14.every(k => !isTerminalOrHonor(k));
  if (allSimple) yakuList.push({ name: "断幺九", han: 1 });
  const honroutou = hand14.every(k => isTerminalOrHonor(k));
  if (honroutou) yakuList.push({ name: "混老頭", han: 2 });
  const suitsUsed = new Set(hand14.filter(k => !isHonor(k)).map(k => suitOf(k)));
  const hasHonorTile = hand14.some(k => isHonor(k));
  if (suitsUsed.size === 1) {
    if (hasHonorTile) yakuList.push({ name: "混一色", han: 3 });
    else yakuList.push({ name: "清一色", han: 6 });
  }
  return buildResult(yakuList, 25, ctx, hand14);
}

// メイン: 14枚の手牌(kind配列) + 和了牌kind + コンテキストから最高得点の役構成を返す
// ctx = { isRiichi, isHaitei, roundWind, seatWind, doraKinds:[kind] }
export function evaluateWin(hand14Kinds, winKind, ctx) {
  const counts = countsOfKinds(hand14Kinds);
  const candidates = [];

  const decompositions = decomposeStandard(counts);
  for (const d of decompositions) {
    candidates.push(...evaluateStandardDecomposition(d, winKind, hand14Kinds, ctx));
  }
  if (isChiitoitsu(counts)) {
    candidates.push(evaluateChiitoitsu(hand14Kinds, ctx));
  }
  candidates.push(...checkYakuman(hand14Kinds, counts, decompositions, winKind, ctx));

  if (candidates.length === 0) return null;

  const yakumanCandidates = candidates.filter(c => c.isYakuman);
  const pool = yakumanCandidates.length > 0 ? yakumanCandidates : candidates.filter(c => c.yakuList.some(y => y.name !== "ドラ"));
  if (pool.length === 0) return null;

  let best = null;
  for (const c of pool) {
    const scored = { ...c, score: computeScoreFromHanFu(c, ctx.isDealer) };
    if (!best || scored.score.total > best.score.total) best = scored;
  }
  return best;
}

// 役当てクイズ用の全候補（翻数ごとにまとめた表示順）
// 風牌はこの半荘構成（東1局〜南4局、自風はローテーションで東→北→西→南→東…）で
// 実際に成立しうる組み合わせのみを掲載: ダブルは東1局(東場+東家)と南4局(南場+南家)のみ発生する。
export const YAKU_QUIZ_GROUPS = [
  { label: "1翻", names: ["門前清自摸和", "立直", "海底摸月", "平和", "断幺九", "一盃口", "役牌(白)", "役牌(發)", "役牌(中)", "東", "南", "西", "北"] },
  { label: "2翻", names: ["二盃口", "三色同順", "三色同刻", "一気通貫", "混全帯幺九", "対々和", "三暗刻", "混老頭", "小三元", "七対子", "ダブル東", "ダブル南"] },
  { label: "3翻", names: ["純全帯幺九", "混一色"] },
  { label: "6翻", names: ["清一色"] },
  { label: "役満", names: ["国士無双", "四暗刻", "大三元", "小四喜", "大四喜", "字一色", "清老頭", "緑一色", "九蓮宝燈"] },
];

const YAKU_NAME_NORMALIZE = {
  "国士無双十三面待ち": "国士無双",
  "四暗刻単騎": "四暗刻",
  "純正九蓮宝燈": "九蓮宝燈",
};
const NON_YAKU_NAMES = new Set(["ドラ"]);

// 実際の役一覧から、クイズで正誤判定に使う「役名の集合」を取り出す（ドラ類は除外し、異名同役はまとめる）
export function actualYakuQuizNames(yakuList) {
  const set = new Set();
  for (const y of yakuList) {
    if (NON_YAKU_NAMES.has(y.name)) continue;
    set.add(YAKU_NAME_NORMALIZE[y.name] || y.name);
  }
  return [...set];
}

// ツモ和了の点数を計算する。親(isDealer)なら全員同額（○○オール）、
// 子なら子/親で払う額が異なる（例: 2000/4000）。
export function computeScoreFromHanFu({ han, fu, isYakuman, yakumanPower }, isDealer) {
  let base;
  if (isYakuman) {
    base = 8000 * (yakumanPower || 1);
  } else if (han >= 13) {
    base = 8000;
  } else if (han >= 11) {
    base = 6000;
  } else if (han >= 8) {
    base = 4000;
  } else if (han >= 6) {
    base = 3000;
  } else if (han >= 5) {
    base = 2000;
  } else {
    base = fu * Math.pow(2, 2 + han);
    if (base > 2000) base = 2000;
  }

  if (isDealer) {
    const each = Math.ceil((base * 2) / 100) * 100;
    const total = each * 3;
    return { base, total, isDealer: true, childPay: each, dealerPay: each, notation: `${total}（${each}オール）` };
  }
  const childPay = Math.ceil((base * 1) / 100) * 100;
  const dealerPay = Math.ceil((base * 2) / 100) * 100;
  const total = childPay * 2 + dealerPay;
  return { base, total, isDealer: false, childPay, dealerPay, notation: `${total}（${childPay}/${dealerPay}）` };
}
