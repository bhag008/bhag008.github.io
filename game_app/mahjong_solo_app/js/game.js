import { buildShuffledWall, sortHand, nextKind, EAST } from "./tiles.js";
import { getWaits, isWinningHand } from "./agari.js";
import { evaluateWin } from "./yaku.js";
import { buildQuizChoices } from "./quiz.js";

const DEAD_WALL_SIZE = 14; // 136 - 13(配牌) - 14(王牌) = 109枚がツモ可能
const MAX_PENALTY = 3;

export function createGame() {
  const state = {
    roundNumber: 0,
    totalScore: 0,
    penaltyCount: 0,
    history: [],
    gameOver: false,
    round: null,
    phase: "before_start", // before_start | playing | round_result | game_over
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
  state.round = {
    hand,
    drawnTile: null,
    liveWall,
    wallIndex: 0,
    doraIndicatorTile: deadWall[0],
    uraDoraIndicatorTile: deadWall[1],
    discards: [],
    isRiichi: false,
    riichiDeclaredAtDrawCount: null,
    drawCount: 0,
    canTsumo: false,
    canRiichi: false,
    riichiChoiceMode: false,
    riichiValidDiscardKinds: [],
    missedWinsThisRound: 0,
    pendingWin: null, // {result, choices, guess}
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
function currentUraDoraKinds(round) {
  return [nextKind(round.uraDoraIndicatorTile.kind)];
}

function buildContext(state, isHaitei) {
  const round = state.round;
  return {
    isRiichi: round.isRiichi,
    isIppatsu: round.isRiichi && round.drawCount === round.riichiDeclaredAtDrawCount + 1,
    isHaitei,
    roundWind: EAST,
    seatWind: EAST,
    doraKinds: currentDoraKinds(round),
    uraDoraKinds: currentUraDoraKinds(round),
    akaCount: [...round.hand, round.drawnTile].filter(t => t && t.red).length,
  };
}

function drawTile(state) {
  const round = state.round;
  if (liveWallRemaining(round) <= 0) {
    endRoundExhaustive(state);
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

  round.riichiChoiceMode = false;
  if (round.isRiichi || round.canTsumo) {
    round.canRiichi = false;
    round.riichiValidDiscardKinds = [];
  } else {
    const discardOptions = [...round.hand, tile];
    const validRiichiDiscards = [];
    for (let i = 0; i < discardOptions.length; i++) {
      const remain = discardOptions.filter((_, idx) => idx !== i).map(t => t.kind);
      if (getWaits(remain).length > 0) validRiichiDiscards.push(discardOptions[i].uid);
    }
    round.canRiichi = validRiichiDiscards.length > 0 && liveWallRemaining(round) > 0;
    round.riichiValidDiscardKinds = validRiichiDiscards;
  }
}

// ツモを宣言。役無しでは呼ばれない前提（UI側でcanTsumo時のみ表示）
export function declareTsumo(state) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (!round.canTsumo || !round.pendingWinResult) return;
  const result = round.pendingWinResult;
  const choices = buildQuizChoices(result);
  round.pendingWin = { result, choices, guess: null };
  state.phase = "quiz";
}

export function answerQuiz(state, guessedScore) {
  if (state.phase !== "quiz") return;
  const round = state.round;
  const pw = round.pendingWin;
  if (!pw) return;
  const correct = guessedScore === pw.result.score.total;
  if (correct) state.totalScore += pw.result.score.total;

  const finalHand = sortHand([...round.hand, round.drawnTile]);
  state.history.push({
    roundNumber: state.roundNumber,
    won: true,
    finalHand,
    winKind: round.drawnTile.kind,
    yakuList: pw.result.yakuList,
    han: pw.result.han,
    fu: pw.result.fu,
    isYakuman: pw.result.isYakuman,
    guessScore: guessedScore,
    actualScore: pw.result.score.total,
    correct,
    isRiichi: round.isRiichi,
    missedWinsThisRound: round.missedWinsThisRound,
  });
  round.ended = true;
  state.phase = "round_result";
}

export function declareRiichi(state) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (!round.canRiichi || round.isRiichi) return;
  round.riichiChoiceMode = true;
}

export function cancelRiichiChoice(state) {
  if (state.phase !== "playing") return;
  state.round.riichiChoiceMode = false;
}

// 牌を捨てる。tileUid は手牌+ツモ牌の中から選ぶ。見逃しペナルティもここで判定。
export function discardTile(state, tileUid) {
  if (state.phase !== "playing") return;
  const round = state.round;
  if (round.riichiChoiceMode && !round.riichiValidDiscardKinds.includes(tileUid)) return;
  if (round.isRiichi && !round.riichiChoiceMode && tileUid !== round.drawnTile.uid) return;

  const wasMiss = round.canTsumo;
  if (wasMiss) {
    round.missedWinsThisRound++;
    state.penaltyCount++;
    state.lastEvent = { type: "missed_win", message: "上がりを見逃しました。ペナルティ +1" };
    if (state.penaltyCount >= MAX_PENALTY) {
      state.history.push({
        roundNumber: state.roundNumber,
        won: false,
        finalHand: sortHand([...round.hand, round.drawnTile]),
        missedWinsThisRound: round.missedWinsThisRound,
        isRiichi: round.isRiichi,
        cutShortByGameOver: true,
      });
      finalizeGameOver(state);
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

  if (round.riichiChoiceMode) {
    round.isRiichi = true;
    round.riichiDeclaredAtDrawCount = round.drawCount;
    round.riichiChoiceMode = false;
    round.canRiichi = false;
  }

  drawTile(state);
}

function endRoundExhaustive(state) {
  const round = state.round;
  state.history.push({
    roundNumber: state.roundNumber,
    won: false,
    finalHand: sortHand(round.hand),
    missedWinsThisRound: round.missedWinsThisRound,
    isRiichi: round.isRiichi,
  });
  round.ended = true;
  state.phase = "round_result";
}

function finalizeGameOver(state) {
  const round = state.round;
  round.ended = true;
  state.gameOver = true;
  state.phase = "round_result";
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
