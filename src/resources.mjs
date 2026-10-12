/** Mock-only read adapter. No setters, action callbacks, save or authentication access. */
const CATEGORIES = ['bank', 'currencies', 'equipment', 'activity'];
const LIMITS = Object.freeze({ items: 20_000, currencies: 256, sets: 32, slots: 128, skills: 64 });
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function requireValue(valid) { if (!valid) throw new Error('resource-observation-invalid'); }
function objectId(value) {
  const id = value?.id;
  requireValue(validId(id));
  return id;
}
const unavailable = reason => ({ supported: false, status: 'blocked', reason, data: null });
function blocked(reason) {
  return { version: null, mode: null, supported: false, status: 'blocked', reason,
    categories: Object.fromEntries(CATEGORIES.map(name => [name, unavailable(reason)])), runnable: false };
}

/** No runtime compatibility profile exists; ignore even an enable flag. */
export function readResourceSnapshot(_gameObject) {
  return blocked('runtime-resource-adapter-unverified');
}

function bankData(game) {
  const bank = game.bank;
  const source = bank.items;
  const lockedItems = bank.lockedItems;
  requireValue(source instanceof Map && lockedItems instanceof Set &&
    source.size <= LIMITS.items && lockedItems.size <= LIMITS.items);
  const maximumSlots = bank.maximumSlots;
  const occupiedSlots = bank.occupiedSlots;
  requireValue(count(maximumSlots) && count(occupiedSlots) && source.size === occupiedSlots);
  const lockedIds = new Set();
  for (const item of lockedItems) {
    const id = objectId(item);
    requireValue(!lockedIds.has(id));
    lockedIds.add(id);
  }
  const ids = new Set();
  const items = [];
  for (const [item, entry] of source) {
    const id = objectId(item);
    const quantity = entry?.quantity;
    requireValue(entry?.item === item && !ids.has(id) && count(quantity) && quantity > 0);
    ids.add(id);
    // Locked items are protection information, not spendable inventory reservations.
    items.push({ id, quantity, locked: lockedIds.has(id) });
  }
  return { items: items.sort((a, b) => compare(a.id, b.id)),
    lockedIds: [...lockedIds].sort(compare), maximumSlots, occupiedSlots,
    freeSlots: Math.max(0, maximumSlots - occupiedSlots), overCapacity: occupiedSlots > maximumSlots };
}

function currencyData(game) {
  const source = game.currencies?.allObjects;
  requireValue(Array.isArray(source) && source.length > 0 && source.length <= LIMITS.currencies);
  const ids = new Set();
  const currencies = source.map(currency => {
    const id = objectId(currency);
    const value = currency.amount;
    requireValue(!ids.has(id) && amount(value));
    ids.add(id);
    return { id, amount: value };
  });
  return { currencies: currencies.sort((a, b) => compare(a.id, b.id)) };
}

function equipmentData(game) {
  const player = game.combat?.player;
  const source = player?.equipmentSets;
  const selectedSet = player?.selectedEquipmentSet;
  requireValue(Array.isArray(source) && source.length > 0 && source.length <= LIMITS.sets &&
    count(selectedSet) && selectedSet < source.length);
  const sets = source.map((set, index) => {
    const sourceSlots = set?.equipment?.equippedArray;
    requireValue(Array.isArray(sourceSlots) && sourceSlots.length > 0 && sourceSlots.length <= LIMITS.slots);
    const ids = new Set();
    const slots = sourceSlots.map(entry => {
      const slotId = objectId(entry?.slot);
      const empty = entry.isEmpty;
      const quantity = entry.quantity;
      const occupiedBy = entry.occupiedBy;
      const occupiedBySlotId = occupiedBy === undefined ? null : objectId(occupiedBy);
      requireValue(!ids.has(slotId) && typeof empty === 'boolean' && count(quantity));
      ids.add(slotId);
      const itemId = empty ? null : objectId(entry.item);
      requireValue(empty || occupiedBySlotId !== null || quantity > 0);
      return { slotId, itemId, quantity, empty, occupiedBySlotId };
    });
    for (const slot of slots) {
      if (slot.occupiedBySlotId === null) continue;
      const root = slots.find(other => other.slotId === slot.occupiedBySlotId);
      requireValue(root && root.slotId !== slot.slotId && !root.empty && root.occupiedBySlotId === null);
    }
    return { index, slots: slots.sort((a, b) => compare(a.slotId, b.slotId)) };
  });
  return { selectedSet, sets };
}

function activityData(game) {
  const isPaused = game.isPaused;
  requireValue(typeof isPaused === 'boolean');
  function readAction(action) {
    // Undefined is declared idle state. Null/missing shape is never converted to idle.
    if (action === undefined) return null;
    const id = objectId(action);
    const isActive = action.isActive;
    const skills = action.activeSkills;
    requireValue(typeof isActive === 'boolean' && Array.isArray(skills) && skills.length <= LIMITS.skills);
    const skillIds = skills.map(objectId);
    requireValue(new Set(skillIds).size === skillIds.length);
    return { id, isActive, skillIds: skillIds.sort(compare) };
  }
  return { isPaused, active: readAction(game.activeAction), paused: readAction(game.pausedAction) };
}

/** Only artificial fixtures may call this until v1.3.1 runtime verification is recorded. */
export function readResourcesForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return blocked('version-unverified');
    if (context.onlyAuxiliary !== undefined && typeof context.onlyAuxiliary !== 'boolean') return blocked('resource-context-invalid');
    const mode = game.currentGamemode;
    const modeId = objectId(mode);
    const hardcore = mode.isPermaDeath;
    requireValue(typeof hardcore === 'boolean');
    const isRaid = game.isGolbinRaid;
    requireValue(typeof isRaid === 'boolean');
    if (isRaid) return blocked('raid-resource-observation-unverified');
    const readers = { bank: bankData, currencies: currencyData, equipment: equipmentData, activity: activityData };
    const requested = context.onlyAuxiliary === true ? ['equipment', 'activity'] : CATEGORIES;
    const categories = Object.fromEntries(CATEGORIES.map(name => {
      if (!requested.includes(name)) return [name, unavailable('resource-category-deferred')];
      try { return [name, { supported: true, status: 'observed', reason: null, data: readers[name](game) }]; }
      catch { return [name, unavailable(`${name}-api-invalid-or-inconsistent`)]; }
    }));
    const supported = requested.every(name => categories[name].supported);
    return { version: context.version, mode: { id: modeId, hardcore }, supported,
      ...(context.onlyAuxiliary === true ? { coverage: 'auxiliary-only' } : {}),
      status: supported ? 'observed' : 'blocked', reason: supported ? null : 'resource-observation-incomplete',
      categories, runnable: false };
  } catch { return blocked('mode-or-resource-context-invalid'); }
}
