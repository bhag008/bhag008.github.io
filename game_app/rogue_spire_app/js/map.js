// マップ生成: フロア x スロットのグリッドをランダムな枝分かれで接続する
export const FLOORS = 7; // 通常フロア数 (0..FLOORS-1)。 FLOORS はボスフロアの index になる。
export const SLOTS = 4;

export function generateMap() {
  const nodes = [];
  const byFloorSlot = {};

  for (let f = 0; f < FLOORS; f++) {
    for (let s = 0; s < SLOTS; s++) {
      const node = { id: `${f}-${s}`, floor: f, slot: s, type: 'battle', visited: false, next: [] };
      nodes.push(node);
      byFloorSlot[node.id] = node;
    }
  }
  const bossNode = { id: `${FLOORS}-0`, floor: FLOORS, slot: 0, type: 'boss', visited: false, next: [] };
  nodes.push(bossNode);
  byFloorSlot[bossNode.id] = bossNode;

  // フロア間の接続 (各ノードから次フロアの隣接スロットへ1〜2本)
  for (let f = 0; f < FLOORS - 1; f++) {
    for (let s = 0; s < SLOTS; s++) {
      const node = byFloorSlot[`${f}-${s}`];
      const candidates = [s - 1, s, s + 1].filter(x => x >= 0 && x < SLOTS);
      const count = candidates.length > 1 ? 1 + (Math.random() < 0.45 ? 1 : 0) : 1;
      const chosen = shuffle(candidates).slice(0, count);
      for (const c of chosen) node.next.push(`${f + 1}-${c}`);
    }
    // 次フロアの孤立ノード(入辺なし)を修正
    for (let s = 0; s < SLOTS; s++) {
      const targetId = `${f + 1}-${s}`;
      const hasIncoming = nodes.some(n => n.floor === f && n.next.includes(targetId));
      if (!hasIncoming) {
        const nearest = byFloorSlot[`${f}-${s}`] || byFloorSlot[`${f}-${Math.max(0, s - 1)}`] || byFloorSlot[`${f}-0`];
        if (!nearest.next.includes(targetId)) nearest.next.push(targetId);
      }
    }
  }
  // 最終通常フロア -> ボス
  for (let s = 0; s < SLOTS; s++) {
    byFloorSlot[`${FLOORS - 1}-${s}`].next.push(bossNode.id);
  }

  // ノードタイプ割り当て
  for (let s = 0; s < SLOTS; s++) byFloorSlot[`0-${s}`].type = 'battle';
  for (let s = 0; s < SLOTS; s++) byFloorSlot[`${FLOORS - 1}-${s}`].type = 'rest';

  let eliteCount = 0;
  let shopCount = 0;
  for (let f = 1; f < FLOORS - 1; f++) {
    for (let s = 0; s < SLOTS; s++) {
      const node = byFloorSlot[`${f}-${s}`];
      const roll = Math.random();
      if (roll < 0.15) {
        node.type = 'elite';
        eliteCount++;
      } else if (roll < 0.27) {
        node.type = 'rest';
      } else if (roll < 0.37) {
        node.type = 'shop';
        shopCount++;
      } else if (roll < 0.55) {
        node.type = 'event';
      } else {
        node.type = 'battle';
      }
    }
  }
  if (eliteCount === 0) {
    const midFloor = Math.floor(FLOORS / 2);
    byFloorSlot[`${midFloor}-${Math.floor(SLOTS / 2)}`].type = 'elite';
  }
  if (shopCount === 0) {
    const shopFloor = Math.max(1, Math.floor(FLOORS / 3));
    const target = byFloorSlot[`${shopFloor}-${Math.min(SLOTS - 1, 2)}`];
    if (target.type !== 'elite') target.type = 'shop';
  }

  return { nodes, floors: FLOORS };
}

export function getNode(map, id) {
  return map.nodes.find(n => n.id === id);
}

export function availableNodeIds(map, currentNodeId) {
  if (!currentNodeId) {
    return map.nodes.filter(n => n.floor === 0).map(n => n.id);
  }
  const cur = getNode(map, currentNodeId);
  return cur ? cur.next : [];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
