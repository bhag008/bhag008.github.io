// 牌の種類 (kind 0-33)
// 0-8: 萬子1-9 / 9-17: 筒子1-9 / 18-26: 索子1-9 / 27-30: 東南西北 / 31-33: 白發中
export const MAN0 = 0, PIN0 = 9, SOU0 = 18, HONOR0 = 27;
export const EAST = 27, SOUTH = 28, WEST = 29, NORTH = 30;
export const HAKU = 31, HATSU = 32, CHUN = 33;

export function suitOf(kind) {
  if (kind < 9) return "m";
  if (kind < 18) return "p";
  if (kind < 27) return "s";
  return "z";
}

export function numberOf(kind) {
  if (kind < 27) return (kind % 9) + 1;
  return kind - 26; // 1:東 2:南 3:西 4:北 5:白 6:發 7:中
}

export function isHonor(kind) { return kind >= 27; }
export function isTerminal(kind) { return kind < 27 && (numberOf(kind) === 1 || numberOf(kind) === 9); }
export function isTerminalOrHonor(kind) { return isHonor(kind) || isTerminal(kind); }
export function isSimple(kind) { return !isTerminalOrHonor(kind); }

const KIND_GLYPH = (() => {
  const g = new Array(34);
  // man 1-9 -> U+1F007..U+1F00F
  for (let i = 0; i < 9; i++) g[MAN0 + i] = String.fromCodePoint(0x1F007 + i);
  // pin 1-9 -> U+1F019..U+1F021
  for (let i = 0; i < 9; i++) g[PIN0 + i] = String.fromCodePoint(0x1F019 + i);
  // sou 1-9 -> U+1F010..U+1F018
  for (let i = 0; i < 9; i++) g[SOU0 + i] = String.fromCodePoint(0x1F010 + i);
  g[EAST] = "\u{1F000}";
  g[SOUTH] = "\u{1F001}";
  g[WEST] = "\u{1F002}";
  g[NORTH] = "\u{1F003}";
  g[HAKU] = "\u{1F006}";
  g[HATSU] = "\u{1F005}";
  g[CHUN] = "\u{1F004}";
  return g;
})();

const KIND_NAME = (() => {
  const n = new Array(34);
  const manName = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  for (let i = 0; i < 9; i++) n[MAN0 + i] = manName[i] + "萬";
  for (let i = 0; i < 9; i++) n[PIN0 + i] = manName[i] + "筒";
  for (let i = 0; i < 9; i++) n[SOU0 + i] = manName[i] + "索";
  n[EAST] = "東"; n[SOUTH] = "南"; n[WEST] = "西"; n[NORTH] = "北";
  n[HAKU] = "白"; n[HATSU] = "發"; n[CHUN] = "中";
  return n;
})();

export function glyphOf(kind) { return KIND_GLYPH[kind]; }
export function nameOf(kind) { return KIND_NAME[kind]; }

// 次の牌 (ドラ表示牌からドラを求める用)
export function nextKind(kind) {
  if (kind < 27) {
    const s = kind - (kind % 9);
    return s + ((kind - s + 1) % 9);
  }
  if (kind < 31) return 27 + ((kind - 27 + 1) % 4); // 東南西北
  return 31 + ((kind - 31 + 1) % 3); // 白發中
}

let uid = 0;
function makeTile(kind) {
  return { kind, uid: uid++ };
}

// 136枚の牌山を作りシャッフルする（赤牌なし）
export function buildShuffledWall() {
  const tiles = [];
  for (let kind = 0; kind < 34; kind++) {
    for (let i = 0; i < 4; i++) {
      tiles.push(makeTile(kind));
    }
  }
  // Fisher-Yates
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export function sortHand(tiles) {
  return [...tiles].sort((a, b) => a.kind - b.kind);
}

export function countsOf(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) counts[t.kind]++;
  return counts;
}

export function countsOfKinds(kinds) {
  const counts = new Array(34).fill(0);
  for (const k of kinds) counts[k]++;
  return counts;
}
