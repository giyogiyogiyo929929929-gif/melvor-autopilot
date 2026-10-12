import test from 'node:test';
import assert from 'node:assert/strict';
import { readResourceTargets, readResourceTargetsForTesting } from '../src/resource-targets.mjs';
import { monitorResourceSnapshotProblem, resourceSnapshotProblem } from '../src/snapshot-validation.mjs';
import { monitorTask } from '../src/monitor.mjs';
import { planResourceDemand } from '../src/quantities.mjs';
function fixture() {
  const log = { id: 'Logs' }, gem = { id: 'Gem' }, ore = { id: 'Ore' }, gp = { id: 'GP', amount: 10.5 }, amounts = new Map([[log, 1], [ore, 2]]), quantities = [];
  const lockedItems = new Set(); lockedItems[Symbol.iterator] = () => { throw new Error('must not scan locks'); };
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false,
    activeAction: { id: 'Woodcutting', isActive: true, activeSkills: [] }, pausedAction: undefined,
    items: { getObjectByID: id => [log, gem, ore].find(value => value.id === id), get allObjects() { throw new Error('must not scan'); } },
    currencies: { getObjectByID: id => id === 'GP' ? gp : undefined, get allObjects() { throw new Error('must not scan'); } },
    bank: { getQty: item => { quantities.push(item.id); return amounts.get(item) ?? 0; }, lockedItems, occupiedSlots: 8, maximumSlots: 10,
      get items() { throw new Error('must not scan bank'); } }, combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: {
        equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } } };
  const task = { id: 'task', action: { id: 'Woodcutting', selectionIds: ['Tree'] }, endConditions: [{ type: 'inventory', id: 'Logs', quantity: 10 }],
    requirements: { items: [], currencies: [], outputIds: ['Logs', 'Gem'], outputsEvidence: 'confirmed' } };
  const selection = { itemIds: ['Logs', 'Gem', 'Ore'], currencyIds: ['GP'] }, context = { version: 'v1.3.1', observationId: 'resources-target-frame' };
  return { game, log, gem, ore, gp, amounts, quantities, task, selection, context };
}
const read = f => readResourceTargetsForTesting(f.game, f.selection, f.context);
const frame = (f, resources = read(f)) => ({ resources, actionSelection: { supported: true, actionId: 'Woodcutting', selectionIds: ['Tree'] } });
const run = (f, resources = read(f)) => monitorTask(f.task, frame(f, resources), null, { nowMs: 0, sessionId: 'session' });
test('target lookup preserves zero/positive/locked quantities and unrelated occupied slots', () => {
  const f = fixture(); f.game.bank.lockedItems.add(f.gem); const result = read(f), bank = result.categories.bank.data;
  assert.equal(result.supported, true); assert.equal(result.coverage, 'targets-only'); assert.equal(result.fullCoverage, false);
  assert.equal(bank.quantities.find(value => value.id === 'Gem').quantity, 0); assert.equal(bank.quantities.find(value => value.id === 'Gem').locked, true);
  assert.equal(bank.items.length, 2); assert.equal(bank.occupiedSlots, 8); assert.equal(bank.unobservedOccupiedSlots, 6); assert.equal(bank.freeSlots, 2);
  assert.deepEqual(f.quantities.sort(), ['Gem', 'Logs', 'Ore']); assert.equal(result.categories.currencies.data.currencies[0].amount, 10.5);
});
test('full resource consumers reject partial DTOs while monitor validates coverage', () => {
  const f = fixture(), result = read(f); assert.equal(resourceSnapshotProblem(result), 'resources-not-full');
  assert.equal(monitorResourceSnapshotProblem(result, f.task), null); assert.equal(run(f, result).status, 'continue');
  assert.equal(planResourceDemand(result, [{ id: 'Logs', quantity: 2 }], [], { ownership: { base: true } }).status, 'blocked');
});
test('no required currency is an explicit empty subset, not a complete currency registry', () => {
  const f = fixture(); f.selection.currencyIds = [];
  const result = read(f); assert.equal(result.supported, true); assert.deepEqual(result.categories.currencies.data.currencies, []);
  assert.equal(monitorResourceSnapshotProblem(result, f.task), null); assert.equal(run(f, result).status, 'continue');
  assert.equal(resourceSnapshotProblem(result), 'resources-not-full');
});
test('missing required material/output/currency coverage cannot be treated as absence', () => {
  const f = fixture(); f.selection.itemIds = ['Logs']; assert.equal(run(f).reason, 'resource-targets-coverage-incomplete');
  f.selection.itemIds = ['Logs', 'Gem']; f.task.requirements.currencies = [{ id: 'GP', amount: 1 }]; f.selection.currencyIds = [];
  assert.equal(run(f).reason, 'resource-targets-coverage-incomplete');
});
test('capacity uses all occupied slots rather than only observed stacks', () => {
  const f = fixture(); f.game.bank.occupiedSlots = 10;
  assert.equal(run(f).reason, 'bank-capacity-insufficient');
  f.game.bank.occupiedSlots = 11; assert.equal(read(f).categories.bank.data.overCapacity, true); assert.equal(run(f).reason, 'bank-capacity-insufficient');
});
test('only known minimum consumption releases space for fixed or bounded costs', () => {
  const f = fixture(); f.game.bank.occupiedSlots = 10;
  f.task.requirements.items = [{ id: 'Ore', quantity: 2 }]; f.task.requirements.bankOrder = 'consume-then-produce'; f.task.requirements.costEvidence = 'fixed';
  assert.equal(run(f).status, 'continue');
  f.task.requirements.costEvidence = 'bounded'; f.task.requirements.rangeEvidence = 'confirmed'; f.task.requirements.minimumItems = [{ id: 'Ore', quantity: 0 }]; f.task.requirements.minimumCurrencies = [];
  assert.equal(run(f).reason, 'bank-capacity-insufficient');
});
test('protected material and fractional currency shortage still block monitoring', () => {
  const f = fixture(); f.task.requirements.items = [{ id: 'Ore', quantity: 2 }]; f.game.bank.lockedItems.add(f.ore);
  assert.equal(run(f).reason, 'material-protected'); f.game.bank.lockedItems.delete(f.ore); f.gp.amount = 0.25; f.task.requirements.currencies = [{ id: 'GP', amount: 0.5 }];
  assert.equal(run(f).reason, 'currency-insufficient');
});
test('lookup failure and exceptions discard the category without inventing zero or leaking text', () => {
  const f = fixture(); f.selection.itemIds.push('Missing'); let result = read(f); assert.equal(result.categories.bank.data, null);
  assert.equal(result.categories.currencies.supported, true); f.selection.itemIds.pop(); f.game.bank.getQty = () => { throw new Error('PRIVATE'); };
  result = read(f); assert.equal(result.categories.bank.reason, 'resource-target-bank-invalid'); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('invalid amounts, slots, current action and DTO inconsistencies are refused', () => {
  for (const change of [f => f.amounts.set(f.log, -1), f => f.gp.amount = NaN, f => f.game.bank.occupiedSlots = 1,
    f => f.game.bank.maximumSlots = null, f => f.game.activeAction.isActive = null]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
  const f = fixture(), result = read(f); result.categories.bank.data.occupiedSlots = 2; result.categories.bank.data.freeSlots = 8;
  assert.notEqual(monitorResourceSnapshotProblem(result, f.task), null);
});
test('unknown version, selection duplicates, lookup bounds and byte limits fail before observation', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } }), f = fixture();
  assert.equal(readResourceTargets(forbidden, f.selection, { enabled: true }).reason, 'runtime-resource-targets-unverified');
  assert.equal(readResourceTargetsForTesting(forbidden, f.selection, { ...f.context, version: 'v2' }).reason, 'version-unverified');
  for (const selection of [{ itemIds: ['Logs', 'Logs'], currencyIds: [] }, { itemIds: Array(513).fill('Logs'), currencyIds: [] }, { itemIds: [], currencyIds: Array(65).fill('GP') }])
    assert.equal(readResourceTargetsForTesting(forbidden, selection, f.context).reason, 'resource-target-context-invalid');
  f.context.maximumBytes = 1024; f.game.currentGamemode.id = 'M'.repeat(1024); assert.equal(read(f).reason, 'resource-target-output-byte-limit');
});
test('no bank write/sale/lock change/currency mutation/save helper is touched', () => {
  const f = fixture(); for (const property of ['addItem', 'removeItemQuantity', 'consumeItems', 'getSnapShot', 'getHistory', 'toggleItemLock', 'empty', 'sellItemOnClick', 'encode', 'decode'])
    Object.defineProperty(f.game.bank, property, { get() { throw new Error('must not read'); } });
  for (const property of ['add', 'remove', 'set']) Object.defineProperty(f.gp, property, { get() { throw new Error('must not read'); } });
  Object.defineProperty(f.game, 'characterName', { get() { throw new Error('PRIVATE'); } }); assert.equal(read(f).supported, true); assert.equal(f.amounts.get(f.log), 1);
});
test('partial bank quantity completeness and guard exceptions remain explicit', () => {
  const f = fixture(), result = read(f); result.categories.bank.data.quantities.pop(); assert.notEqual(monitorResourceSnapshotProblem(result, f.task), null);
  const opaque = { get coverage() { throw new Error('PRIVATE'); } }; assert.equal(resourceSnapshotProblem(opaque), 'resource-snapshot-unreadable');
  assert.equal(monitorResourceSnapshotProblem(opaque, f.task), 'resource-targets-unreadable');
});
test('order and frozen metadata preserve detached targeted resources', () => {
  const f = fixture(), first = read(f); f.selection.itemIds.reverse(); assert.deepEqual(read(f), first);
  Object.freeze(f.selection.itemIds); Object.freeze(f.context); Object.freeze(f.log); assert.deepEqual(read(f), first);
  first.categories.bank.data.quantities[0].quantity = 999; assert.equal(f.amounts.get(f.log), 1);
});
