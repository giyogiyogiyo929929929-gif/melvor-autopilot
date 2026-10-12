/** Mock-only quantity lookups. A partial bank never describes all inventory. */
import { readResourcesForTesting } from './resources.mjs';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ids = (values, maximum) => Array.isArray(values) && values.length <= maximum && values.every(id) && new Set(values).size === values.length;
const unavailable = reason => ({ supported: false, status: 'blocked', reason, data: null });
const failed = reason => ({ version: null, mode: null, supported: false, status: 'blocked', reason, origin: 'mock-only', coverage: 'targets-only', fullCoverage: false,
  categories: Object.fromEntries(['bank', 'currencies', 'equipment', 'activity'].map(name => [name, unavailable(reason)])), requested: null, runnable: false });
const requireValue = valid => { if (!valid) throw new Error('resource-target-invalid'); };
export function readResourceTargets(_game, _requested, _context) { return { ...failed('runtime-resource-targets-unverified'), origin: 'runtime-disabled' }; }
function lookup(registry, wanted) { const object = registry.getObjectByID(wanted); requireValue(object?.id === wanted); return object; }
function bankData(game, requested) {
  const bank = game.bank, locked = bank.lockedItems, maximumSlots = bank.maximumSlots, occupiedSlots = bank.occupiedSlots;
  requireValue(locked instanceof Set && locked.size <= 20_000 && count(maximumSlots) && count(occupiedSlots) && occupiedSlots <= 20_000);
  const quantities = requested.itemIds.map(id => {
    const item = lookup(game.items, id), quantity = bank.getQty(item), protectedItem = locked.has(item);
    requireValue(count(quantity)); return { id, quantity, locked: protectedItem };
  });
  const items = quantities.filter(item => item.quantity > 0).map(item => ({ ...item })); requireValue(items.length <= occupiedSlots);
  return { items, quantities, lockedIds: quantities.filter(item => item.locked).map(item => item.id), maximumSlots, occupiedSlots,
    observedOccupiedSlots: items.length, unobservedOccupiedSlots: occupiedSlots - items.length,
    freeSlots: Math.max(0, maximumSlots - occupiedSlots), overCapacity: occupiedSlots > maximumSlots };
}
function currencyData(game, requested) {
  return { currencies: requested.currencyIds.map(id => { const value = lookup(game.currencies, id).amount; requireValue(amount(value)); return { id, amount: value }; }) };
}
export function readResourceTargetsForTesting(game, selection, context) {
  try {
    if (context?.version !== 'v1.3.1') return failed('version-unverified');
    const maximumBytes = context.maximumBytes === undefined ? 1_048_576 : context.maximumBytes;
    if (!id(context.observationId) || context.observationId.length > 256 || !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 4_194_304 ||
        !ids(selection?.itemIds, 512) || !ids(selection.currencyIds, 64)) return failed('resource-target-context-invalid');
    const requested = { itemIds: [...selection.itemIds].sort(compare), currencyIds: [...selection.currencyIds].sort(compare) };
    const auxiliary = readResourcesForTesting(game, { version: 'v1.3.1', onlyAuxiliary: true });
    if (auxiliary.version !== 'v1.3.1') return failed('resource-target-mode-unverified');
    const read = (reader, reason) => { try { return { supported: true, status: 'observed', reason: null, data: reader(game, requested) }; } catch { return unavailable(reason); } };
    const categories = { bank: read(bankData, 'resource-target-bank-invalid'), currencies: read(currencyData, 'resource-target-currency-invalid'),
      equipment: auxiliary.categories.equipment, activity: auxiliary.categories.activity };
    const supported = Object.values(categories).every(value => value.supported);
    const result = { version: 'v1.3.1', mode: auxiliary.mode, observationId: context.observationId, origin: 'mock-only', coverage: 'targets-only', fullCoverage: false,
      requested, categories, supported, status: supported ? 'observed' : 'blocked', reason: supported ? null : 'resource-targets-partial', runnable: false };
    return new TextEncoder().encode(JSON.stringify(result)).length <= maximumBytes ? result : failed('resource-target-output-byte-limit');
  } catch { return failed('resource-target-input-unreadable'); }
}
