import { createGame, startGame, declareTsumo, answerQuiz, declareRiichi, cancelRiichiChoice, discardTile, nextRound, endGameNow } from "./game.js";
import { render } from "./ui.js";

const root = document.getElementById("screen");
let state = createGame();

function rerender() { render(state, root); }

root.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case "start":
      startGame(state);
      break;
    case "discard":
      discardTile(state, Number(btn.dataset.uid));
      break;
    case "riichi":
      declareRiichi(state);
      break;
    case "cancel-riichi":
      cancelRiichiChoice(state);
      break;
    case "tsumo":
      declareTsumo(state);
      break;
    case "answer":
      answerQuiz(state, Number(btn.dataset.value));
      break;
    case "next":
      nextRound(state);
      break;
    case "end":
      endGameNow(state);
      break;
    case "show-summary":
      state.phase = "game_over";
      break;
    case "restart":
      state = createGame();
      break;
    default:
      return;
  }
  rerender();
});

rerender();
