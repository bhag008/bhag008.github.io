// 対戦相手選択画面 → バトル画面への受け渡し用の一時状態
let selectedOpponentId = "veteran";

export function setSelectedOpponentId(id) {
  selectedOpponentId = id;
}

export function getSelectedOpponentId() {
  return selectedOpponentId;
}
