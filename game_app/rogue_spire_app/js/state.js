// ランの状態管理と localStorage への保存/読み込み
const RUN_KEY = 'ashenspire.run.v1';
const META_KEY = 'ashenspire.meta.v1';

let uidCounter = 1;

export function nextUid() {
  return uidCounter++;
}

export function makeDefaultMeta() {
  return { runsPlayed: 0, victories: 0, bestFloor: 0 };
}

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return makeDefaultMeta();
    return { ...makeDefaultMeta(), ...JSON.parse(raw) };
  } catch {
    return makeDefaultMeta();
  }
}

export function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* storage unavailable - ignore */
  }
}

export function saveRun(run) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify({ ...run, uidCounter }));
  } catch {
    /* storage unavailable - ignore */
  }
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    if (typeof run.uidCounter === 'number') uidCounter = Math.max(uidCounter, run.uidCounter);
    return run;
  } catch {
    return null;
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function hasSavedRun() {
  try {
    return !!localStorage.getItem(RUN_KEY);
  } catch {
    return false;
  }
}
