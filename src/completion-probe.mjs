/** Development-only, synchronous read probe. Never used by the distribution. */
const TITLE = 'Melvor Idle :: v1.3.1';
const NAMESPACES = ['melvorBaseGame', 'melvorD', 'melvorF'];
const CATEGORIES = {
  skills: 'skillProgress', mastery: 'masteryProgress', items: 'itemProgress',
  monsters: 'monsterProgress', pets: 'petProgress'
};
const LIMITS = { bank: 10_000, skills: 256, currencies: 64, sets: 32, slots: 64 };
const count = n => Number.isSafeInteger(n) && n >= 0;
const amount = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const percent = n => amount(n) && n <= 100;
const requireValue = valid => { if (!valid) throw new Error('probe-invalid'); };
const id = object => {
  const value = object?.id;
  requireValue(typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_:-]+$/.test(value));
  return value;
};
const sortRows = rows => rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const baseReport = () => ({ schema: 1, kind: 'development-completion-probe', version: null,
  coverage: 'base-aggregate-probe', ownershipVerified: false,
  runtimeAllowed: false, runnable: false, actualComplete: false, categories: [] });
const blocked = reason => ({ ...baseReport(), status: 'blocked', reason, comparison: null });

function contextGate(raw) {
  if (raw?.gameTitle !== TITLE) return 'version-unverified';
  if (raw.currentCharacter !== 1) return 'clone-slot-unconfirmed';
  if (raw.characterSelected !== true || raw.isLoadingSave !== false ||
      raw.isCreatingSave !== false || raw.loadingOfflineProgress !== false) return 'loading-context-unconfirmed';
  return null;
}
function header(game) {
  const raid = game.isGolbinRaid;
  const paused = game.isPaused;
  const active = game.activeAction;
  const pausedAction = game.pausedAction;
  requireValue(typeof raid === 'boolean' && typeof paused === 'boolean');
  const mode = game.currentGamemode;
  const modeID = id(mode);
  const hardcore = mode.isPermaDeath;
  requireValue(typeof hardcore === 'boolean' && /^melvor(D|F|TotH|AoD|ItA):/.test(modeID));
  return { raid, paused, active: active === undefined ? null : id(active),
    pausedAction: pausedAction === undefined ? null : id(pausedAction), modeID, hardcore };
}
const idle = h => !h.raid && !h.paused && h.active === null && h.pausedAction === null;
function array(source, maximum, nonempty = false) {
  requireValue(Array.isArray(source) && source.length <= maximum && (!nonempty || source.length > 0));
  return source;
}
function unique(rows) {
  requireValue(new Set(rows.map(row => row[0])).size === rows.length);
  return sortRows(rows);
}
function registryRows(registry, maximum, read) {
  const source = array(registry?.allObjects, maximum, true);
  const rows = [];
  for (let i = 0; i < source.length; i++) rows.push(read(source[i]));
  return unique(rows);
}
function state(game) {
  const bank = game.bank;
  const sourceItems = bank.items;
  const sourceLocks = bank.lockedItems;
  requireValue(sourceItems instanceof Map && sourceItems.size <= LIMITS.bank &&
    sourceLocks instanceof Set && sourceLocks.size <= LIMITS.bank);
  const items = [];
  for (const [item, stack] of sourceItems) {
    requireValue(items.length < LIMITS.bank);
    const itemID = id(item);
    const quantity = stack.quantity;
    requireValue(stack.item === item && count(quantity) && quantity > 0);
    items.push([itemID, quantity]);
  }
  const locks = [];
  for (const item of sourceLocks) {
    requireValue(locks.length < LIMITS.bank);
    locks.push([id(item)]);
  }
  const occupied = bank.occupiedSlots;
  const maximum = bank.maximumSlots;
  requireValue(count(occupied) && count(maximum) && occupied === items.length);
  const currencies = registryRows(game.currencies, LIMITS.currencies, currency => {
    const currencyID = id(currency); const value = currency.amount;
    requireValue(amount(value)); return [currencyID, value];
  });
  const xp = registryRows(game.skills, LIMITS.skills, skill => {
    const skillID = id(skill); const standard = skill.xp; const abyssal = skill.abyssalXP;
    requireValue(amount(standard) && amount(abyssal)); return [skillID, standard, abyssal];
  });
  const player = game.combat.player;
  const sets = array(player.equipmentSets, LIMITS.sets, true);
  const selected = player.selectedEquipmentSet;
  requireValue(count(selected) && selected < sets.length);
  const equipment = [];
  for (let i = 0; i < sets.length; i++) {
    const slots = array(sets[i].equipment.equippedArray, LIMITS.slots, true);
    const rows = [];
    for (let j = 0; j < slots.length; j++) {
      const slot = slots[j]; const slotID = id(slot.slot);
      const empty = slot.isEmpty; const quantity = slot.quantity; const occupiedBy = slot.occupiedBy;
      requireValue(typeof empty === 'boolean' && count(quantity));
      rows.push([slotID, empty ? null : id(slot.item), quantity, empty,
        occupiedBy === undefined ? null : id(occupiedBy)]);
    }
    equipment.push(unique(rows));
  }
  const result = { bank: { items: unique(items), locks: unique(locks), occupied, maximum },
    currencies, xp, equipment: { selected, sets: equipment }, header: header(game) };
  requireValue(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 1_048_576);
  return result;
}
function category(completion, key, property) {
  try {
    const progress = completion[property];
    const currentMap = progress.currentCount; const maximumMap = progress.maximumCount;
    const getCurrent = currentMap.getCompValue; const getMaximum = maximumMap.getCompValue;
    const getPercent = progress.getPercent;
    requireValue(typeof getCurrent === 'function' && typeof getMaximum === 'function' && typeof getPercent === 'function');
    const rows = NAMESPACES.map(namespace => {
      try {
        const current = getCurrent.call(currentMap, namespace);
        const maximum = getMaximum.call(maximumMap, namespace);
        const apiPercent = getPercent.call(progress, namespace);
        requireValue(count(current) && count(maximum) && current <= maximum && percent(apiPercent));
        const ratioPercent = maximum === 0 ? null : current / maximum * 100;
        return { namespace, status: maximum === 0 ? 'empty' : 'observed', current, maximum,
          percent: apiPercent, ratioPercent,
          ratioMatches: ratioPercent === null ? null : Math.abs(ratioPercent - apiPercent) < 1e-7 };
      } catch { return { namespace, status: 'blocked', reason: 'aggregate-invalid-or-unavailable',
        current: null, maximum: null, percent: null, ratioPercent: null, ratioMatches: null }; }
    });
    return { category: key, status: rows.every(row => row.status !== 'blocked') ? 'observed' : 'partial', rows };
  } catch { return { category: key, status: 'blocked', reason: 'category-api-unavailable', rows: [] }; }
}

/** Only the isolated developer package may supply a real port after UI preparation. */
export function captureCompletionProbe(port) {
  let phase = 'context-unavailable';
  try {
    const initialContext = port.context();
    const rejection = contextGate(initialContext);
    if (rejection) return blocked(rejection);
    phase = 'game-header-unavailable';
    const game = port.game();
    const initialHeader = header(game);
    if (!idle(initialHeader)) return blocked(initialHeader.raid ? 'raid-probe-refused' : 'active-probe-refused');
    phase = 'baseline-state-unavailable';
    const before = state(game);
    if (JSON.stringify(before.header) !== JSON.stringify(initialHeader)) return blocked('baseline-header-changed');
    phase = 'completion-unavailable';
    const completion = game.completion;
    const categories = Object.entries(CATEGORIES).map(([key, property]) => category(completion, key, property));
    let total = null;
    try { const value = completion.totalProgressBaseGame; if (percent(value)) total = value; } catch { /* Fixed null. */ }
    phase = 'post-context-unavailable';
    if (contextGate(port.context()) !== null || port.game() !== game) return blocked('probe-context-changed');
    phase = 'post-state-unavailable';
    const after = state(game);
    const parts = Object.fromEntries(Object.keys(before).map(key =>
      [key, JSON.stringify(before[key]) === JSON.stringify(after[key])]));
    const unchanged = Object.values(parts).every(Boolean);
    const completeRows = categories.map(cat => cat.rows.find(row => row.namespace === 'melvorBaseGame'));
    const mean = completeRows.every(row => row?.status === 'observed')
      ? completeRows.reduce((sum, row) => sum + row.percent, 0) / completeRows.length : null;
    const observed = categories.every(cat => cat.status === 'observed') && total !== null;
    const report = { ...baseReport(), version: 'v1.3.1', slotIndex: 1,
      mode: { id: initialHeader.modeID, hardcore: initialHeader.hardcore },
      status: !unchanged ? 'blocked' : observed ? 'observed' : 'partial',
      reason: !unchanged ? 'observed-state-changed' : observed ? null : 'aggregate-observation-incomplete',
      categories, totalPercent: total, categoryMeanPercent: mean,
      categoryMeanMatches: total === null || mean === null ? null : Math.abs(total - mean) < 1e-7,
      comparison: { unchanged, parts, bankStacks: before.bank.items.length,
        bankMaximum: before.bank.maximum, skillCount: before.xp.length,
        currencyCount: before.currencies.length, equipmentSetCount: before.equipment.sets.length,
        woodcuttingXP: before.xp.find(row => /^(melvorD|melvorF):Woodcutting$/.test(row[0]))?.[1] ?? null } };
    requireValue(new TextEncoder().encode(JSON.stringify(report)).byteLength <= 65_536);
    return report;
  } catch { return blocked(phase); }
}
