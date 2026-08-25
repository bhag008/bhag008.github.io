// カードデータ定義
// type: "minion" | "spell"
// set: "standard" | "flame"（拡張パック名）
// rarity: "basic"（スタンダード） | "common" | "rare" | "epic" | "legendary"
// keywords: "taunt"（挑発） | "charge"（速攻） | "lifesteal"（吸血）
// effect.target: "select"（敵ミニオン or 敵リーダーを選ぶ＝リーチ火力。威力は低めに設定）
//              | "select_monster"（敵ミニオンのみ選べる＝純粋な除去。威力は高め）
//              | "enemy_face" | "self_face" | "enemy_random" | "friendly_random" | "none"

export const TOKENS = {
  wolf_token: { id: "wolf_token", name: "狼", emoji: "🐺", atk: 1, hp: 1, keywords: [] },
  giant_wolf_token: { id: "giant_wolf_token", name: "巨狼", emoji: "🐺", atk: 2, hp: 2, keywords: [] },
  fire_wolf_token: { id: "fire_wolf_token", name: "業火狼", emoji: "🔥", atk: 2, hp: 2, keywords: [] },
  imp_token: { id: "imp_token", name: "小悪魔", emoji: "👹", atk: 1, hp: 1, keywords: [] },
};

export const STANDARD_CARDS = [
  { id: "std_squire", name: "見習い戦士", emoji: "🗡️", cost: 1, type: "minion", atk: 1, hp: 2, keywords: [], text: "" },
  { id: "std_shield", name: "小さな盾", emoji: "🛡️", cost: 1, type: "minion", atk: 0, hp: 3, keywords: ["taunt"], text: "挑発" },
  { id: "std_spark", name: "火花", emoji: "✨", cost: 1, type: "spell", text: "対象に2ダメージ（ミニオン・リーダーどちらも可）", effect: { type: "damage", value: 2, target: "select" } },
  { id: "std_scout", name: "偵察のネズミ", emoji: "🐭", cost: 1, type: "minion", atk: 1, hp: 1, keywords: [], text: "戦場に出た時: カードを1枚引く", battlecry: { type: "draw", value: 1, target: "none" } },

  { id: "std_archer", name: "弓兵", emoji: "🏹", cost: 2, type: "minion", atk: 2, hp: 2, keywords: [], text: "" },
  { id: "std_healspring", name: "癒しの泉", emoji: "💧", cost: 2, type: "spell", text: "対象を5回復", effect: { type: "heal", value: 5, target: "select" } },
  { id: "std_wolfpack", name: "狼の召喚", emoji: "🐺", cost: 2, type: "spell", text: "1/1の狼を2体呼び出す", effect: { type: "summon_token", token: "wolf_token", count: 2, target: "none" } },
  { id: "std_guard", name: "見張りの兵士", emoji: "💂", cost: 2, type: "minion", atk: 1, hp: 4, keywords: ["taunt"], text: "挑発" },

  { id: "std_knight", name: "若き騎士", emoji: "⚔️", cost: 3, type: "minion", atk: 3, hp: 3, keywords: [], text: "" },
  { id: "std_bear", name: "盾の熊", emoji: "🐻", cost: 3, type: "minion", atk: 2, hp: 5, keywords: ["taunt"], text: "挑発" },
  { id: "std_fireball_small", name: "火炎弾", emoji: "🔥", cost: 3, type: "spell", text: "敵ミニオンに5ダメージ", effect: { type: "damage", value: 5, target: "select_monster" } },
  { id: "std_raider", name: "速攻の狼", emoji: "🐾", cost: 3, type: "minion", atk: 2, hp: 2, keywords: ["charge"], text: "速攻" },

  { id: "std_veteran", name: "熟練の戦士", emoji: "🪓", cost: 4, type: "minion", atk: 4, hp: 4, keywords: [], text: "" },
  { id: "std_cleric", name: "聖なる僧侶", emoji: "🙏", cost: 4, type: "minion", atk: 2, hp: 3, keywords: [], text: "戦場に出た時: 自分に4回復", battlecry: { type: "heal", value: 4, target: "self_face" } },
  { id: "std_lightning", name: "稲妻", emoji: "⚡", cost: 4, type: "spell", text: "敵ミニオンに6ダメージ", effect: { type: "damage", value: 6, target: "select_monster" } },
  { id: "std_ogre", name: "岩のオーガ", emoji: "🗿", cost: 4, type: "minion", atk: 4, hp: 6, keywords: ["taunt"], text: "挑発" },

  { id: "std_dragonet", name: "若き竜", emoji: "🐉", cost: 5, type: "minion", atk: 5, hp: 5, keywords: [], text: "" },
  { id: "std_healall", name: "祝福の光", emoji: "🌟", cost: 5, type: "spell", text: "対象を8回復", effect: { type: "heal", value: 8, target: "select" } },
  { id: "std_giant_wolf", name: "巨狼の群れ", emoji: "🐺", cost: 5, type: "minion", atk: 3, hp: 3, keywords: [], text: "戦場に出た時: 2/2の巨狼を2体呼び出す", battlecry: { type: "summon_token", token: "giant_wolf_token", count: 2, target: "none" } },

  { id: "std_golem", name: "岩のゴーレム", emoji: "🪨", cost: 6, type: "minion", atk: 6, hp: 7, keywords: ["taunt"], text: "挑発" },
  { id: "std_meteor", name: "隕石落とし", emoji: "☄️", cost: 6, type: "spell", text: "敵ミニオンに8ダメージ", effect: { type: "damage", value: 8, target: "select_monster" } },

  { id: "std_titan", name: "巨神兵", emoji: "🗿", cost: 7, type: "minion", atk: 7, hp: 7, keywords: [], text: "" },
  { id: "std_phoenix", name: "不死の使者", emoji: "🕊️", cost: 7, type: "minion", atk: 5, hp: 5, keywords: [], text: "戦場に出た時: 敵に3ダメージ", battlecry: { type: "damage", value: 3, target: "enemy_face" } },
  { id: "std_lastword", name: "終焉の雷", emoji: "🌩️", cost: 7, type: "spell", text: "敵ミニオン全体に4ダメージ", effect: { type: "damage_all_enemy", value: 4, target: "none" } },
];

export const EXPANSIONS = {
  flame: {
    id: "flame",
    name: "焔の書",
    packEmoji: "🔥📦",
    description: "炎と竜の力を宿す拡張パック",
    packCost: 100,
    cardsPerPack: 5,
    rarityOdds: { common: 0.70, rare: 0.22, epic: 0.06, legendary: 0.02 },
  },
  abyss: {
    id: "abyss",
    name: "深淵の書",
    packEmoji: "😈📦",
    description: "悪魔と契約の力を宿す拡張パック第2弾",
    packCost: 100,
    cardsPerPack: 5,
    rarityOdds: { common: 0.70, rare: 0.22, epic: 0.06, legendary: 0.02 },
  },
};

export const EXPANSION_CARDS = {
  flame: [
    // common
    { id: "fl_c1", name: "火の玉使い", emoji: "🔥", cost: 1, type: "minion", atk: 1, hp: 3, keywords: [], rarity: "common", set: "flame", text: "戦場に出た時: 敵に1ダメージ", battlecry: { type: "damage", value: 1, target: "enemy_face" } },
    { id: "fl_c2", name: "炎の従者", emoji: "👹", cost: 2, type: "minion", atk: 2, hp: 3, keywords: [], rarity: "common", set: "flame", text: "" },
    { id: "fl_c3", name: "小竜", emoji: "🐲", cost: 2, type: "minion", atk: 2, hp: 1, keywords: ["charge"], rarity: "common", set: "flame", text: "速攻" },
    { id: "fl_c4", name: "焔の盾兵", emoji: "🛡️", cost: 3, type: "minion", atk: 1, hp: 6, keywords: ["taunt"], rarity: "common", set: "flame", text: "挑発" },
    { id: "fl_c5", name: "業火の矢", emoji: "🏹", cost: 2, type: "spell", rarity: "common", set: "flame", text: "敵ミニオンに4ダメージ", effect: { type: "damage", value: 4, target: "select_monster" } },
    { id: "fl_c6", name: "灰の再生", emoji: "🪶", cost: 3, type: "spell", rarity: "common", set: "flame", text: "対象を6回復", effect: { type: "heal", value: 6, target: "select" } },
    { id: "fl_c7", name: "溶岩ゴーレム", emoji: "🌋", cost: 4, type: "minion", atk: 4, hp: 5, keywords: ["taunt"], rarity: "common", set: "flame", text: "挑発" },
    { id: "fl_c8", name: "情熱の吟遊詩人", emoji: "🎵", cost: 1, type: "minion", atk: 1, hp: 1, keywords: [], rarity: "common", set: "flame", text: "戦場に出た時: カードを1枚引く", battlecry: { type: "draw", value: 1, target: "none" } },
    // rare
    { id: "fl_r1", name: "紅蓮の騎士", emoji: "🐎", cost: 4, type: "minion", atk: 3, hp: 4, keywords: ["charge"], rarity: "rare", set: "flame", text: "速攻" },
    { id: "fl_r2", name: "業炎の爆発", emoji: "💥", cost: 5, type: "spell", rarity: "rare", set: "flame", text: "敵ミニオン全体に3ダメージ", effect: { type: "damage_all_enemy", value: 3, target: "none" } },
    { id: "fl_r3", name: "不死鳥の雛", emoji: "🐣", cost: 3, type: "minion", atk: 2, hp: 2, keywords: ["taunt", "lifesteal"], rarity: "rare", set: "flame", text: "挑発・吸血" },
    { id: "fl_r4", name: "溶鉄の巨人", emoji: "🤖", cost: 6, type: "minion", atk: 6, hp: 6, keywords: ["taunt"], rarity: "rare", set: "flame", text: "挑発" },
    { id: "fl_r5", name: "焔の連撃", emoji: "🔥", cost: 4, type: "spell", rarity: "rare", set: "flame", text: "対象に3ダメージ（ミニオン・リーダーどちらも可）", effect: { type: "damage", value: 3, target: "select" } },
    { id: "fl_r6", name: "竜の咆哮", emoji: "🐉", cost: 5, type: "minion", atk: 5, hp: 4, keywords: [], rarity: "rare", set: "flame", text: "戦場に出た時: 敵に2ダメージ", battlecry: { type: "damage", value: 2, target: "enemy_face" } },
    // epic
    { id: "fl_e1", name: "灼熱の悪魔", emoji: "😈", cost: 5, type: "minion", atk: 5, hp: 5, keywords: [], rarity: "epic", set: "flame", text: "戦場に出た時: 対象に3ダメージ", battlecry: { type: "damage", value: 3, target: "select" } },
    { id: "fl_e2", name: "業火の嵐", emoji: "🌪️", cost: 6, type: "spell", rarity: "epic", set: "flame", text: "敵ミニオン全体に5ダメージ", effect: { type: "damage_all_enemy", value: 5, target: "none" } },
    { id: "fl_e3", name: "溶岩の心臓", emoji: "❤️‍🔥", cost: 7, type: "minion", atk: 6, hp: 8, keywords: ["taunt", "lifesteal"], rarity: "epic", set: "flame", text: "挑発・吸血" },
    { id: "fl_e4", name: "紅炎の召喚士", emoji: "🧙", cost: 4, type: "minion", atk: 3, hp: 3, keywords: [], rarity: "epic", set: "flame", text: "戦場に出た時: 2/2の業火狼を2体呼び出す", battlecry: { type: "summon_token", token: "fire_wolf_token", count: 2, target: "none" } },
    // legendary
    { id: "fl_l1", name: "古代の紅竜アルカディオン", emoji: "🐲", cost: 8, type: "minion", atk: 8, hp: 8, keywords: ["taunt", "charge"], rarity: "legendary", set: "flame", text: "挑発・速攻。戦場に出た時: 敵に4ダメージ", battlecry: { type: "damage", value: 4, target: "enemy_face" } },
    { id: "fl_l2", name: "不死鳥ロード", emoji: "🔥🕊️", cost: 7, type: "minion", atk: 6, hp: 6, keywords: ["lifesteal"], rarity: "legendary", set: "flame", text: "吸血。戦場に出た時: 自分に5回復", battlecry: { type: "heal", value: 5, target: "self_face" } },
  ],
  abyss: [
    // common
    { id: "ab_c1", name: "小悪魔", emoji: "👹", cost: 1, type: "minion", atk: 1, hp: 2, keywords: [], rarity: "common", set: "abyss", text: "戦場に出た時: 自分に1ダメージを与え、カードを1枚引く", battlecry: { type: "self_damage_draw", damage: 1, draw: 1, target: "none" } },
    { id: "ab_c2", name: "契約の使者", emoji: "🖤", cost: 2, type: "minion", atk: 2, hp: 3, keywords: [], rarity: "common", set: "abyss", text: "戦場に出た時: 敵に1ダメージ", battlecry: { type: "damage", value: 1, target: "enemy_face" } },
    { id: "ab_c3", name: "闇のインプ群", emoji: "👹", cost: 2, type: "spell", rarity: "common", set: "abyss", text: "1/1の小悪魔を3体呼び出す", effect: { type: "summon_token", token: "imp_token", count: 3, target: "none" } },
    { id: "ab_c4", name: "呪縛の鎖", emoji: "⛓️", cost: 2, type: "spell", rarity: "common", set: "abyss", text: "対象に2ダメージ（ミニオン・リーダーどちらも可）", effect: { type: "damage", value: 2, target: "select" } },
    { id: "ab_c5", name: "影の番兵", emoji: "🗿", cost: 3, type: "minion", atk: 1, hp: 6, keywords: ["taunt"], rarity: "common", set: "abyss", text: "挑発" },
    { id: "ab_c6", name: "魂喰らいの犬", emoji: "🐕‍🦺", cost: 3, type: "minion", atk: 3, hp: 2, keywords: ["lifesteal"], rarity: "common", set: "abyss", text: "吸血" },
    { id: "ab_c7", name: "闇の囁き", emoji: "🌑", cost: 3, type: "spell", rarity: "common", set: "abyss", text: "対象を6回復", effect: { type: "heal", value: 6, target: "select" } },
    { id: "ab_c8", name: "地獄の番犬", emoji: "🐺", cost: 4, type: "minion", atk: 4, hp: 5, keywords: ["taunt"], rarity: "common", set: "abyss", text: "挑発" },
    // rare
    { id: "ab_r1", name: "血の契約者", emoji: "🩸", cost: 4, type: "minion", atk: 3, hp: 5, keywords: ["taunt"], rarity: "rare", set: "abyss", text: "挑発。戦場に出た時: 自分に2ダメージを与え、カードを2枚引く", battlecry: { type: "self_damage_draw", damage: 2, draw: 2, target: "none" } },
    { id: "ab_r2", name: "地獄の業火", emoji: "🔥", cost: 4, type: "spell", rarity: "rare", set: "abyss", text: "敵ミニオン全体に2ダメージ", effect: { type: "damage_all_enemy", value: 2, target: "none" } },
    { id: "ab_r3", name: "彷徨う魂", emoji: "👻", cost: 3, type: "minion", atk: 2, hp: 3, keywords: ["taunt", "lifesteal"], rarity: "rare", set: "abyss", text: "挑発・吸血" },
    { id: "ab_r4", name: "堕天の巨兵", emoji: "🗿", cost: 6, type: "minion", atk: 5, hp: 7, keywords: ["taunt"], rarity: "rare", set: "abyss", text: "挑発。戦場に出た時: 自分に2ダメージを与え、カードを1枚引く", battlecry: { type: "self_damage_draw", damage: 2, draw: 1, target: "none" } },
    { id: "ab_r5", name: "闇の一撃", emoji: "🗡️", cost: 4, type: "spell", rarity: "rare", set: "abyss", text: "敵ミニオンに5ダメージ", effect: { type: "damage", value: 5, target: "select_monster" } },
    { id: "ab_r6", name: "深淵の使者", emoji: "😈", cost: 5, type: "minion", atk: 4, hp: 5, keywords: ["lifesteal"], rarity: "rare", set: "abyss", text: "吸血。戦場に出た時: 敵に2ダメージ", battlecry: { type: "damage", value: 2, target: "enemy_face" } },
    // epic
    { id: "ab_e1", name: "地獄の使い魔統率者", emoji: "👺", cost: 4, type: "minion", atk: 3, hp: 3, keywords: [], rarity: "epic", set: "abyss", text: "戦場に出た時: 1/1の小悪魔を3体呼び出す", battlecry: { type: "summon_token", token: "imp_token", count: 3, target: "none" } },
    { id: "ab_e2", name: "堕落の嵐", emoji: "🌪️", cost: 6, type: "spell", rarity: "epic", set: "abyss", text: "敵ミニオン全体に4ダメージ", effect: { type: "damage_all_enemy", value: 4, target: "none" } },
    { id: "ab_e3", name: "深淵の恐怖", emoji: "👹", cost: 7, type: "minion", atk: 7, hp: 7, keywords: ["taunt", "lifesteal"], rarity: "epic", set: "abyss", text: "挑発・吸血" },
    { id: "ab_e4", name: "魂を喰らう者", emoji: "💀", cost: 5, type: "minion", atk: 4, hp: 4, keywords: [], rarity: "epic", set: "abyss", text: "戦場に出た時: 自分に2ダメージを与え、カードを2枚引く", battlecry: { type: "self_damage_draw", damage: 2, draw: 2, target: "none" } },
    // legendary
    { id: "ab_l1", name: "深淵の魔王ザガレス", emoji: "😈", cost: 8, type: "minion", atk: 7, hp: 7, keywords: ["lifesteal"], rarity: "legendary", set: "abyss", text: "吸血。戦場に出た時: 自分に3ダメージを与えてカードを3枚引き、自身を除くすべてのモンスターに3ダメージ", battlecry: { type: "pact_nuke", selfDamage: 3, draw: 3, boardDamage: 3, target: "none" } },
    { id: "ab_l2", name: "業魔の門番モラクス", emoji: "👹", cost: 7, type: "minion", atk: 6, hp: 7, keywords: ["taunt"], rarity: "legendary", set: "abyss", text: "挑発。戦場に出た時: 相手の手札をランダムに2枚捨てさせる", battlecry: { type: "discard_random_enemy", count: 2, target: "none" } },
  ],
};

const ALL_CARD_LIST = [
  ...STANDARD_CARDS.map((c) => ({ ...c, rarity: "basic", set: "standard" })),
  ...Object.values(EXPANSION_CARDS).flat(),
];

export const CARD_INDEX = Object.fromEntries(ALL_CARD_LIST.map((c) => [c.id, c]));

export function getCard(id) {
  return CARD_INDEX[id];
}

export function allCollectibleCards() {
  return ALL_CARD_LIST;
}
