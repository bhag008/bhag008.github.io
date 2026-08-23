import { buildShuffledWall, sortHand, nextKind, EAST, SOUTH, WEST, NORTH } from "./tiles.js?v=4";
import { getWaits, isWinningHand } from "./agari.js?v=4";
import { evaluateWin, actualYakuQuizNames } from "./yaku.js?v=4";
import { buildQuizChoices } from "./quiz.js?v=4";

const DEAD_WALL_SIZE = 14; // 136 - 13(配牌) - 14(王牌) = 109枚がツモ可能
const MAX_PENALTY = 3;

const SEAT_LABEL = { [EAST]: "東家", [SOUTH]: "南家", [WEST]: "西家", [NORTH]: "北家" };

// 東1局〜南4局の半荘固定。5局目から場風が南に変わる。
// 自風は東家(親)からスタートし、局ごとに東→北→西→南→東…とローテーションする
// （実際の4人打ちで親が下家に流れていくのと同じ回り方）。
const KYOKU_INFO = [
  { label: "東1局", roundWind: EAST, seatWind: EAST },
  { label: "東2局", roundWind: EAST, seatWind: NORTH },
  { label: "東3局", roundWind: EAST, seatWind: WEST },
  { label: "東4局", roundWind: EAST, seatWind: SOUTH },
  { label: "南1局", roundWind: SOUTH, seatWind: EAST },
  { label: "南2局", roundWind: SOUTH, seatWind: NORTH },
  { label: "南3局", roundWind: SOUTH, seatWind: WEST },
  { label: "南4局", roundWind: SOUTH, seatWind: SOUTH },
];
export const TOTAL_KYOKU = KYOKU_INFO.length;

export function createGame() {
  const state = {
    roundNumber: 0,
    totalScore: 0,
    penaltyCount: 0,
    history: [],
    gameOver: false,
    round: null,
    phase: "before_start", // before_start | playing | yaku_quiz | score_quiz | round_result | game_over
    lastEvent: null, // 直近の見逃しペナルティ通知など、UIへの一時メッセージ
  };
  return state;
}

function dealRound(state) {
  const wall = buildShuffledWall();
  const hand = sortHand(wall.slice(0, 13));
  const rest = wall.slice(13);
  const deadWall = rest.slice(rest.length - DEAD_WALL_SIZE);
  const liveWall = rest.slice(0, rest.length - DEAD_WALL_SIZE);

  state.roundNumber++;
  const kyoku = KYOKU_INFO[state.roundNumber - 1];
  state.round = {
    kyokuLabel: kyoku.label,
    roundWind: kyoku.roundWind,
    seatWind: kyoku.seatWind,
    seatLabel: SEAT_LABEL[kyoku.seatWind],
    isDealer: kyoku.seatWind === EAST,
    hand,
    drawnTile: null,
    liveWall,
    wallIndex: 0,
    doraIndicatorTile: deadWall[0],
    discards: [],
    isRiichi: false,
    riichiPending: false,
    drawCount: 0,
    canTsumo: false, // 内部判定のみ。UIには出さない
    pendingWinResult: null,
    missedWinsThisRound: 0,
    pendingWin: null, // {result, selectedYaku, yakuGuess, yakuCorrect, choices}
    ended: false,
  };
  state.phase = "playing";
  state.lastEvent = null;
}

export function startGame(state) {
  state.roundNumber = 0;
  state.totalScore = 0;
  state.penaltyCount = 0;
  state.history = [];
  state.gameOver = false;
  dealRound(state);
  drawTile(state);
}

function liveWallRemaining(round) {
  return round.liveWall.length - round.wallIndex;
}

function currentDoraKinds(round) {
  return [nextKind(round.doraIndicatorTile.kind)];
}

function buildContext(state, isHaitei) {
  const round = state.round;
  return {
    isRiichi: round.isRiichi,
    isHaitei,
    roundWind: round.roundWind,
    seatWind: round.seatWind,
    isDealer: round.isDealer,
    doraKinds: currentDoraKinds(round),
  };
}

function drawTile(state) {
  const round = state.round;
  if (liveWallRemaining(round) <= 0) {
    endRoundNonWin(state, "exhaustive");
    return;
  }
  const tile = round.liveWall[round.wallIndex++];
  round.drawCount++;
  round.drawnTile = tile;
  const isHaitei = liveWallRemaining(round) === 0;

  const fullKinds = [...round.hand, tile].map(t => t.kind);
  const ctx = buildContext(state, isHaitei);
  const winResult = isWinningHand(fullKinds) ? evaluateWin(fullKinds, tile.kind, ctx) : null;
  round.canTsumo = !!winResult;
  round.pendingWinResult = winResult;
}

function applyPenalty(state) {
  state.penaltyCount++;
  return state.penaltyCount >= MAX_PENALTY;
}

// 局を終了する。ペナルティによるゲームオーバー、または半荘(南4局)終了ならゲーム自体も終了する。
function endRound(state, forceGameOver) {
  state.round.ended = true;
  if (forceGameOver || state.roundNumber >= TOTAL_KYOKU) state.gameOver = true;
  state.phase = "round_result";
}

// 手牌+ツモ牌が実際に和了形かどうかに関わらず呼べる。誤ったツモ宣言はペナルティで局を打ち切る。
export function declareTsumo(state) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (!round.canTsumo || !round.pendingWinResult) {
    state.lastEvent = { type: "wrong_tsumo", message: "その手牌ではツモできません。誤ったツモ宣言でペナルティ +1" };
    const gameOverNow = applyPenalty(state);
    pushNonWinHistory(state, "wrong_tsumo", gameOverNow);
    endRound(state, gameOverNow);
    return;
  }
  round.pendingWin = { result: round.pendingWinResult, selectedYaku: [], yakuGuess: null, yakuCorrect: null, choices: null };
  state.phase = "yaku_quiz";
}

export function toggleYakuSelection(state, name) {
  if (state.phase !== "yaku_quiz") return;
  const pw = state.round.pendingWin;
  if (!pw) return;
  const idx = pw.selectedYaku.indexOf(name);
  if (idx === -1) pw.selectedYaku.push(name);
  else pw.selectedYaku.splice(idx, 1);
}

// 役当てクイズの回答。選択が実際の役と完全一致していなければ0点で局終了。
export function submitYakuGuess(state) {
  if (state.phase !== "yaku_quiz") return;
  const round = state.round;
  const pw = round.pendingWin;
  if (!pw) return;
  const selectedNames = pw.selectedYaku;

  const actual = actualYakuQuizNames(pw.result.yakuList);
  const guessSet = new Set(selectedNames);
  const actualSet = new Set(actual);
  const correct = guessSet.size === actualSet.size && [...guessSet].every(n => actualSet.has(n));

  pw.yakuGuess = selectedNames;
  pw.yakuCorrect = correct;

  if (!correct) {
    finalizeWinRound(state, { guessScore: null, guessScoreNotation: null, scoreCorrect: null, addedScore: 0 });
    return;
  }
  pw.choices = buildQuizChoices(pw.result);
  state.phase = "score_quiz";
}

export function answerScoreQuiz(state, guessedScore) {
  if (state.phase !== "score_quiz") return;
  const round = state.round;
  const pw = round.pendingWin;
  if (!pw) return;
  const scoreCorrect = guessedScore === pw.result.score.total;
  const addedScore = scoreCorrect ? pw.result.score.total : 0;
  const guessedChoice = pw.choices.find(c => c.total === guessedScore);
  finalizeWinRound(state, { guessScore: guessedScore, guessScoreNotation: guessedChoice ? guessedChoice.notation : null, scoreCorrect, addedScore });
}

function finalizeWinRound(state, { guessScore, guessScoreNotation, scoreCorrect, addedScore }) {
  const round = state.round;
  const pw = round.pendingWin;
  state.totalScore += addedScore;

  const finalHand = sortHand([...round.hand, round.drawnTile]);
  state.history.push({
    endReason: "win",
    roundNumber: state.roundNumber,
    kyokuLabel: round.kyokuLabel,
    isDealer: round.isDealer,
    seatLabel: round.seatLabel,
    won: true,
    finalHand,
    winKind: round.drawnTile.kind,
    yakuList: pw.result.yakuList,
    actualYakuNames: actualYakuQuizNames(pw.result.yakuList),
    guessedYakuNames: pw.yakuGuess,
    yakuCorrect: pw.yakuCorrect,
    han: pw.result.han,
    fu: pw.result.fu,
    isYakuman: pw.result.isYakuman,
    guessScore,
    guessScoreNotation,
    actualScore: pw.result.score.total,
    actualScoreNotation: pw.result.score.notation,
    scoreCorrect,
    addedScore,
    isRiichi: round.isRiichi,
    missedWinsThisRound: round.missedWinsThisRound,
  });
  endRound(state, false);
}

// リーチ宣言を試みる。実際にテンパイを保てる打牌をした場合のみ成立する。
export function declareRiichi(state) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (round.isRiichi || round.riichiPending) return;
  round.riichiPending = true;
}

export function cancelRiichiPending(state) {
  if (state.phase !== "playing") return;
  state.round.riichiPending = false;
}

// 牌を捨てる。tileUid は手牌+ツモ牌の中から選ぶ。見逃しペナルティもここで判定。
export function discardTile(state, tileUid) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (round.isRiichi && !round.riichiPending && tileUid !== round.drawnTile.uid) return;

  const wasMiss = round.canTsumo;
  if (wasMiss) {
    round.missedWinsThisRound++;
    const gameOverNow = applyPenalty(state);
    state.lastEvent = { type: "missed_win", message: "上がりを見逃しました。ペナルティ +1" };
    if (gameOverNow) {
      pushNonWinHistory(state, "missed_win", true);
      endRound(state, true);
      return;
    }
  } else {
    state.lastEvent = null;
  }

  const pool = [...round.hand, round.drawnTile];
  const idx = pool.findIndex(t => t.uid === tileUid);
  if (idx === -1) return;
  const [discarded] = pool.splice(idx, 1);
  round.discards.push(discarded);
  round.hand = sortHand(pool);
  round.drawnTile = null;
  round.canTsumo = false;
  round.pendingWinResult = null;

  if (round.riichiPending) {
    round.riichiPending = false;
    const isActuallyTenpai = getWaits(round.hand.map(t => t.kind)).length > 0;
    if (isActuallyTenpai) {
      round.isRiichi = true;
    } else {
      state.lastEvent = { type: "wrong_riichi", message: "テンパイしていない手でリーチを宣言しました。ペナルティ +1" };
      const gameOverNow = applyPenalty(state);
      pushNonWinHistory(state, "wrong_riichi", gameOverNow);
      endRound(state, gameOverNow);
      return;
    }
  }

  drawTile(state);
}

function pushNonWinHistory(state, endReason, causedGameOver) {
  const round = state.round;
  state.history.push({
    endReason,
    roundNumber: state.roundNumber,
    kyokuLabel: round.kyokuLabel,
    won: false,
    finalHand: sortHand(round.drawnTile ? [...round.hand, round.drawnTile] : round.hand),
    missedWinsThisRound: round.missedWinsThisRound,
    isRiichi: round.isRiichi,
    causedGameOver,
  });
}

function endRoundNonWin(state, endReason) {
  pushNonWinHistory(state, endReason, false);
  endRound(state, false);
}

export function nextRound(state) {
  if (state.gameOver || state.phase !== "round_result") return;
  dealRound(state);
  drawTile(state);
}

export function endGameNow(state) {
  state.gameOver = true;
  state.phase = "game_over";
}
