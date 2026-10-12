import test from 'node:test';
import assert from 'node:assert/strict';
import { readResourceSnapshot, readResourcesForTesting } from '../src/resources.mjs';

const obj = id => ({ id });
const slot = (id, itemId = null, quantity = 0, extra = {}) =>
  ({ slot: obj(id), item: itemId === null ? obj('empty') : obj(itemId), quantity, isEmpty: itemId === null, ...extra });
function fixture() {
  const ore = obj('melvorF:Ore'); const logs = obj('melvorF:Logs');
  return { context: { version: 'v1.3.1' }, game: {
    currentGamemode: { id: 'melvorF:Standard', isPermaDeath: false }, isGolbinRaid: false,
    bank: { items: new Map([[ore, { item: ore, quantity: 8 }], [logs, { item: logs, quantity: 3 }]]),
      lockedItems: new Set([logs]), maximumSlots: 10, occupiedSlots: 2 },
    currencies: { allObjects: [{ id: 'melvorF:GP', amount: 2.5 }, { id: 'melvorF:SlayerCoins', amount: 0 }] },
    combat: { player: { selectedEquipmentSet: 0, equipmentSets: [
      { equipment: { equippedArray: [slot('Weapon', 'Sword', 1), slot('Helmet')] } },
      { equipment: { equippedArray: [slot('Weapon', 'Bow', 1), slot('Quiver', 'Arrows', 40)] } }
    ] } },
    activeAction: { id: 'melvorF:Woodcutting', isActive: true, activeSkills: [obj('melvorF:Woodcutting')] },
    pausedAction: undefined, isPaused: false
  } };
}
const read = f => readResourcesForTesting(f.game, f.context);
const data = (f, category) => read(f).categories[category].data;
const failed = (f, category) => {
  const result = read(f); assert.equal(result.status, 'blocked');
  assert.equal(result.categories[category].supported, false);
  assert.equal(result.categories[category].data, null);
  for (const [name, value] of Object.entries(result.categories)) if (name !== category) assert.equal(value.supported, true);
};

test('reads detached bank, decimal currencies, all equipment sets and active skills', () => {
  const f = fixture(); const result = read(f);
  assert.equal(result.supported, true); assert.equal(result.runnable, false);
  assert.deepEqual(result.categories.bank.data.items, [
    { id: 'melvorF:Logs', quantity: 3, locked: true }, { id: 'melvorF:Ore', quantity: 8, locked: false }]);
  assert.equal(result.categories.bank.data.freeSlots, 8);
  assert.equal(result.categories.currencies.data.currencies[0].amount, 2.5);
  assert.equal(result.categories.equipment.data.sets.length, 2);
  assert.deepEqual(result.categories.activity.data, { isPaused: false,
    active: { id: 'melvorF:Woodcutting', isActive: true, skillIds: ['melvorF:Woodcutting'] }, paused: null });
});

test('empty, full and over-capacity banks remain truthful observations', () => {
  const f = fixture(); f.game.bank.maximumSlots = 2;
  assert.equal(data(f, 'bank').freeSlots, 0); assert.equal(data(f, 'bank').overCapacity, false);
  f.game.bank.maximumSlots = 1;
  assert.equal(data(f, 'bank').freeSlots, 0); assert.equal(data(f, 'bank').overCapacity, true);
  f.game.bank.items.clear(); f.game.bank.occupiedSlots = 0;
  assert.deepEqual(data(f, 'bank').items, []);
  assert.equal(data(f, 'bank').freeSlots, 1);
});

test('DLC and MOD items are inventory observations and never proof of ownership', () => {
  const f = fixture(); f.game.bank.items.clear(); f.game.bank.lockedItems.clear();
  for (const id of ['melvorItA:A', 'customMod:B']) {
    const item = obj(id); f.game.bank.items.set(item, { item, quantity: 1 });
  }
  const result = read(f);
  assert.equal(result.supported, true); assert.equal(result.categories.bank.data.items.length, 2);
  assert.ok(!('ownership' in result));
});

test('locked IDs survive while absent from bank and bank has no equipment quantities', () => {
  const f = fixture(); f.game.bank.lockedItems.add(obj('Absent'));
  assert.ok(data(f, 'bank').lockedIds.includes('Absent'));
  assert.ok(!data(f, 'bank').items.some(item => item.id === 'Sword' || item.id === 'Arrows'));
});

test('occupied equipment slot references are retained without assuming extra inventory', () => {
  const f = fixture(); f.game.combat.player.equipmentSets[0].equipment.equippedArray.push(
    slot('Shield', null, 0, { occupiedBy: obj('Weapon') }));
  const shield = data(f, 'equipment').sets[0].slots.find(s => s.slotId === 'Shield');
  assert.deepEqual(shield, { slotId: 'Shield', itemId: null, quantity: 0, empty: true, occupiedBySlotId: 'Weapon' });
});

test('paused and idle action state is preserved without starting or stopping actions', () => {
  const f = fixture(); f.game.pausedAction = f.game.activeAction; f.game.activeAction = undefined;
  f.game.pausedAction.isActive = false; f.game.isPaused = true;
  assert.equal(data(f, 'activity').active, null); assert.equal(data(f, 'activity').paused.isActive, false);
  f.game.pausedAction = undefined; f.game.isPaused = false;
  assert.deepEqual(data(f, 'activity'), { isPaused: false, active: null, paused: null });
});

test('unknown versions and disabled runtime adapters never touch game getters', () => {
  let touched = false;
  const game = new Proxy({}, { get() { touched = true; throw new Error('secret'); } });
  assert.equal(readResourceSnapshot(game, { enabled: true }).reason, 'runtime-resource-adapter-unverified');
  assert.equal(readResourcesForTesting(game, { version: 'v1.4' }).reason, 'version-unverified');
  assert.equal(touched, false);
});

test('unknown mode and Raid refuse all categories before resource getters', () => {
  const f = fixture(); Object.defineProperty(f.game, 'bank', { get() { throw new Error('must not read'); } });
  f.game.isGolbinRaid = true;
  assert.equal(read(f).reason, 'raid-resource-observation-unverified');
  f.game.isGolbinRaid = null;
  assert.equal(read(f).reason, 'mode-or-resource-context-invalid');
  f.game.isGolbinRaid = false; f.game.currentGamemode.isPermaDeath = null;
  assert.equal(read(f).reason, 'mode-or-resource-context-invalid');
});

test('each category exception is isolated and exception text is not exposed', () => {
  for (const [property, category] of [['bank', 'bank'], ['currencies', 'currencies'], ['combat', 'equipment'], ['isPaused', 'activity']]) {
    const f = fixture(); Object.defineProperty(f.game, property, { get() { throw new Error('save-auth-secret'); } });
    failed(f, category); assert.ok(!JSON.stringify(read(f)).includes('save-auth-secret'));
  }
});

test('bank invalid quantities, identity, IDs and count disagreement discard partial stacks', () => {
  for (const value of [0, -1, null, undefined, NaN, Infinity, 0.5, '8', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); [...f.game.bank.items.values()][0].quantity = value; failed(f, 'bank');
  }
  for (const change of [f => { f.game.bank.occupiedSlots = 1; },
    f => { [...f.game.bank.items.values()][0].item = obj('melvorF:Ore'); },
    f => { const item = obj('melvorF:Ore'); f.game.bank.items.set(item, { item, quantity: 1 }); f.game.bank.occupiedSlots++; },
    f => { f.game.bank.lockedItems.add(obj('melvorF:Logs')); },
    f => { [...f.game.bank.items.keys()][0].id = ''; },
    f => { f.game.bank.items = []; }, f => { f.game.bank.lockedItems = []; }]) {
    const f = fixture(); change(f); failed(f, 'bank');
  }
});

test('invalid bank capacity is never converted to zero or a false free slot count', () => {
  for (const value of [null, undefined, -1, 1.5, '10', NaN, Infinity]) {
    const f = fixture(); f.game.bank.maximumSlots = value; failed(f, 'bank');
  }
});

test('currency empty, duplicate and non-finite or negative amounts are unavailable', () => {
  for (const value of [null, undefined, -1, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); f.game.currencies.allObjects[0].amount = value; failed(f, 'currencies');
  }
  const f = fixture(); f.game.currencies.allObjects[1].id = f.game.currencies.allObjects[0].id;
  failed(f, 'currencies'); f.game.currencies.allObjects = []; failed(f, 'currencies');
});

test('equipment set selection, quantities, duplicates and unknown empty flags fail closed', () => {
  for (const value of [null, undefined, -1, 0.5, 2, '0']) {
    const f = fixture(); f.game.combat.player.selectedEquipmentSet = value; failed(f, 'equipment');
  }
  for (const change of [slots => { slots[0].quantity = 0; }, slots => { slots[0].quantity = 1.5; },
    slots => { slots[0].isEmpty = null; }, slots => { slots[0].item = null; },
    slots => { slots.push(slots[0]); }, slots => { slots.length = 0; }]) {
    const f = fixture(); change(f.game.combat.player.equipmentSets[0].equipment.equippedArray); failed(f, 'equipment');
  }
});

test('dangling, circular and empty-root occupied slots are rejected', () => {
  for (const root of ['Missing', 'Shield', 'Helmet']) {
    const f = fixture(); f.game.combat.player.equipmentSets[0].equipment.equippedArray.push(
      slot('Shield', null, 0, { occupiedBy: obj(root) })); failed(f, 'equipment');
  }
  const f = fixture(); const slots = f.game.combat.player.equipmentSets[0].equipment.equippedArray;
  slots[0].occupiedBy = obj('Helmet'); slots[1].occupiedBy = obj('Weapon'); failed(f, 'equipment');
});

test('activity unknown flags, null action, duplicate IDs and wrong skill shape are unavailable', () => {
  for (const change of [f => { f.game.isPaused = null; }, f => { f.game.activeAction = null; },
    f => { f.game.activeAction.isActive = 'true'; }, f => { f.game.activeAction.id = ''; },
    f => { f.game.activeAction.activeSkills = null; }, f => { f.game.activeAction.activeSkills.push(obj('melvorF:Woodcutting')); }]) {
    const f = fixture(); change(f); failed(f, 'activity');
  }
});

test('collection bounds stop incomplete observation without allowing unbounded input', () => {
  const changes = [
    ['bank', f => { f.game.bank.items = new Map(Array.from({ length: 20_001 }, (_, i) => [obj(String(i)), {}])); }],
    ['bank', f => { f.game.bank.lockedItems = new Set(Array.from({ length: 20_001 }, (_, i) => obj(String(i)))); }],
    ['currencies', f => { f.game.currencies.allObjects = Array(257).fill({}); }],
    ['equipment', f => { f.game.combat.player.equipmentSets = Array(33).fill({}); }],
    ['equipment', f => { f.game.combat.player.equipmentSets[0].equipment.equippedArray = Array(129).fill({}); }],
    ['activity', f => { f.game.activeAction.activeSkills = Array(65).fill({}); }]
  ];
  for (const [category, change] of changes) { const f = fixture(); change(f); failed(f, category); }
});

test('registry, bank and slot order do not affect snapshot determinism', () => {
  const f = fixture(); const first = read(f);
  f.game.bank.items = new Map([...f.game.bank.items].reverse());
  f.game.currencies.allObjects.reverse();
  for (const set of f.game.combat.player.equipmentSets) set.equipment.equippedArray.reverse();
  assert.deepEqual(read(f), first);
});

test('frozen input remains unchanged, contains no foreign references and avoids unrelated getters', () => {
  const f = fixture();
  Object.defineProperties(f.game, { characterName: { get() { throw new Error('private'); } },
    encode: { get() { throw new Error('save'); } }, cloudManager: { get() { throw new Error('auth'); } } });
  const before = structuredClone(f);
  function freeze(value) {
    if (value && typeof value === 'object') {
      if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
      else if (value instanceof Set) for (const child of value) freeze(child);
      else Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(f);
  const result = read(f); assert.equal(result.supported, true);
  assert.deepEqual(read(f), result); assert.deepEqual(structuredClone(f), before);
  result.categories.bank.data.items[0].quantity = 999;
  result.categories.equipment.data.sets[0].slots[0].itemId = 'changed';
  result.categories.activity.data.active.skillIds.push('changed');
  assert.equal([...f.game.bank.items.values()][1].quantity, 3);
  assert.equal(f.game.activeAction.activeSkills.length, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
});
