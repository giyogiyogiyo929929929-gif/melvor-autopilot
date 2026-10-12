/** Pure validation of detached resource outputs. Flags alone are not evidence. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const unique = values => new Set(values).size === values.length;
const ids = (values, max) => Array.isArray(values) && values.length <= max && values.every(id) && unique(values);

export function resourceSnapshotProblem(resources) {
  try { if (resources?.coverage !== undefined && resources.coverage !== 'full') return 'resources-not-full'; return validateResources(resources, false); }
  catch { return 'resource-snapshot-unreadable'; }
}
export function monitorResourceSnapshotProblem(resources, task) {
  try {
    if (resources?.coverage !== 'targets-only') return resourceSnapshotProblem(resources);
    if (resources.origin !== 'mock-only' || resources.fullCoverage !== false || !ids(resources.requested?.itemIds, 512) || !ids(resources.requested.currencyIds, 64)) return 'resource-targets-unverified';
    const wantedItems = [...task.requirements.items.map(item => item.id), ...task.requirements.outputIds,
      ...task.endConditions.filter(condition => condition.type === 'inventory').map(condition => condition.id)];
    if (wantedItems.some(id => !resources.requested.itemIds.includes(id)) || task.requirements.currencies.some(currency => !resources.requested.currencyIds.includes(currency.id))) return 'resource-targets-coverage-incomplete';
    return validateResources(resources, true);
  } catch { return 'resource-targets-unreadable'; }
}
function validateResources(resources, targeted) {
  try {
    if (resources?.version !== 'v1.3.1' || resources.supported !== true || resources.status !== 'observed' ||
        !id(resources.mode?.id) || typeof resources.mode.hardcore !== 'boolean') return 'resources-unverified';
    for (const name of ['bank', 'currencies', 'equipment', 'activity']) {
      const category = resources.categories?.[name];
      if (category?.supported !== true || category.status !== 'observed' || !category.data) return 'resources-unverified';
    }
    const { bank, currencies, equipment, activity } = Object.fromEntries(
      ['bank', 'currencies', 'equipment', 'activity'].map(name => [name, resources.categories[name].data]));
    if (!Array.isArray(bank.items) || bank.items.length > 20_000 || !ids(bank.lockedIds, 20_000) ||
        !count(bank.maximumSlots) || !count(bank.occupiedSlots) || (targeted ? bank.occupiedSlots < bank.items.length || bank.occupiedSlots > 20_000 : bank.occupiedSlots !== bank.items.length) ||
        bank.freeSlots !== Math.max(0, bank.maximumSlots - bank.occupiedSlots) ||
        bank.overCapacity !== (bank.occupiedSlots > bank.maximumSlots) ||
        !unique(bank.items.map(item => item?.id))) return 'bank-invalid';
    const locked = new Set(bank.lockedIds);
    if (bank.items.some(item => !id(item?.id) || !count(item.quantity) || item.quantity === 0 ||
        typeof item.locked !== 'boolean' || item.locked !== locked.has(item.id))) return 'bank-invalid';
    if (targeted) {
      if (!Array.isArray(bank.quantities) || bank.quantities.length !== resources.requested.itemIds.length || bank.quantities.length > 512 || !unique(bank.quantities.map(item => item?.id)) ||
          bank.observedOccupiedSlots !== bank.items.length || bank.unobservedOccupiedSlots !== bank.occupiedSlots - bank.items.length ||
          bank.quantities.some(item => !resources.requested.itemIds.includes(item?.id) || !count(item.quantity) || typeof item.locked !== 'boolean' || item.locked !== locked.has(item.id)) ||
          bank.lockedIds.some(id => !resources.requested.itemIds.includes(id)) ||
          bank.items.length !== bank.quantities.filter(item => item.quantity > 0).length ||
          bank.items.some(item => !bank.quantities.some(value => value.id === item.id && value.quantity === item.quantity && value.locked === item.locked))) return 'resource-target-bank-invalid';
    }
    if (!Array.isArray(currencies.currencies) || (!targeted && currencies.currencies.length === 0) || currencies.currencies.length > 256 ||
        currencies.currencies.some(currency => !id(currency?.id) || !amount(currency.amount)) ||
        !unique(currencies.currencies.map(currency => currency.id))) return 'currencies-invalid';
    if (targeted && (currencies.currencies.length !== resources.requested.currencyIds.length || currencies.currencies.some(value => !resources.requested.currencyIds.includes(value.id)))) return 'resource-target-currencies-invalid';
    if (!Array.isArray(equipment.sets) || equipment.sets.length === 0 || equipment.sets.length > 32 ||
        !count(equipment.selectedSet) || equipment.selectedSet >= equipment.sets.length) return 'equipment-invalid';
    for (const [index, set] of equipment.sets.entries()) {
      if (set?.index !== index || !Array.isArray(set.slots) || set.slots.length === 0 || set.slots.length > 128 ||
          !unique(set.slots.map(slot => slot?.slotId))) return 'equipment-invalid';
      const byId = new Map(set.slots.map(slot => [slot?.slotId, slot]));
      for (const slot of set.slots) {
        if (!id(slot?.slotId) || !count(slot.quantity) || typeof slot.empty !== 'boolean' ||
            (slot.empty ? slot.itemId !== null : !id(slot.itemId)) ||
            (slot.occupiedBySlotId !== null && !id(slot.occupiedBySlotId)) ||
            (!slot.empty && slot.occupiedBySlotId === null && slot.quantity === 0)) return 'equipment-invalid';
        if (slot.occupiedBySlotId !== null) {
          const root = byId.get(slot.occupiedBySlotId);
          if (!root || root === slot || root.empty || root.occupiedBySlotId !== null) return 'equipment-invalid';
        }
      }
    }
    if (typeof activity.isPaused !== 'boolean') return 'activity-invalid';
    for (const action of [activity.active, activity.paused]) {
      if (action !== null && (!id(action?.id) || typeof action.isActive !== 'boolean' || !ids(action.skillIds, 64)))
        return 'activity-invalid';
    }
    return null;
  } catch { return 'resource-snapshot-unreadable'; }
}
