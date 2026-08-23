// CPU対戦相手のデータ定義（レベル別に4体）
export const OPPONENTS = [
  {
    id: "novice",
    level: 1,
    name: "見習い冒険者",
    emoji: "🧑‍🎓",
    description: "駆け出しの冒険者。低コストのカードが中心で攻撃も控えめ。",
    winGold: 15,
    loseGold: 3,
    deck: [
      "std_squire", "std_squire", "std_shield", "std_shield", "std_spark", "std_spark",
      "std_scout", "std_archer", "std_archer", "std_guard", "std_guard",
      "std_knight", "std_knight", "std_bear", "std_bear", "std_fireball_small",
      "std_raider", "std_raider", "std_healspring", "std_wolfpack",
    ],
  },
  {
    id: "veteran",
    level: 2,
    name: "熟練の戦士",
    emoji: "⚔️",
    description: "経験を積んだ戦士。バランスの取れたスタンダードデッキで戦う。",
    winGold: 25,
    loseGold: 5,
    deck: [
      "std_squire", "std_squire", "std_shield", "std_shield", "std_spark", "std_spark",
      "std_archer", "std_archer", "std_guard", "std_guard",
      "std_knight", "std_knight", "std_bear", "std_raider", "std_raider",
      "std_veteran", "std_veteran", "std_ogre", "std_fireball_small", "std_dragonet",
    ],
  },
  {
    id: "flame_mage",
    level: 3,
    name: "焔の魔導士",
    emoji: "🔮",
    description: "「焔の書」の力を操る魔導士。除去スペルと挑発ミニオンで盤面を制圧する。",
    winGold: 40,
    loseGold: 8,
    deck: [
      "std_knight", "std_bear", "std_veteran", "std_veteran", "std_cleric",
      "std_ogre", "std_ogre", "std_lightning", "std_dragonet", "std_meteor", "std_golem",
      "fl_c2", "fl_c4", "fl_c7", "fl_r1", "fl_r2", "fl_r4", "fl_r6", "fl_c5", "fl_c8",
    ],
  },
  {
    id: "flame_lord",
    level: 4,
    name: "紅蓮の竜王",
    emoji: "🐉",
    description: "焔の書の頂点に立つ竜王。エピック・レジェンダリー級の強力なカードを操る最強格。",
    winGold: 65,
    loseGold: 12,
    deck: [
      "std_veteran", "std_dragonet", "std_golem", "std_titan", "std_lastword",
      "fl_c7", "fl_r4", "fl_r1", "fl_r6", "fl_e1", "fl_e2", "fl_e3", "fl_e4",
      "fl_l1", "fl_l2", "std_knight", "std_archer", "std_ogre", "fl_c5", "fl_r2",
    ],
  },
];

export function getOpponent(id) {
  return OPPONENTS.find((o) => o.id === id) || OPPONENTS[1];
}
