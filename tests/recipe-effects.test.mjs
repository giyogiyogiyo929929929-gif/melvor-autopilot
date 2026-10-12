import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipeEffects, normalizeConsumptionBounds } from '../src/recipe-effects.mjs';
import { planResourceDemand } from '../src/quantities.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
import { monitorTask } from '../src/monitor.mjs';

const context = { ownership: { base: true } };
const recipe = (extra = {}) => ({ id: 'smelt', evidence: 'confirmed', scopeId: 'base', unlocked: true,
  kind: 'noncombat', risk: 'safe', bankOrder: 'consume-then-produce', costEvidence: 'fixed',
  outputs: [{ id: 'Bar', quantity: 1 }], itemCosts: [{ id: 'Ore', quantity: 1 }], currencyCosts: [],
  possibleOutputIds: ['Bar'], durationMs: 1000, ...extra });
const bounded = (extra = {}) => recipe({ costEvidence: 'bounded', rangeEvidence: 'confirmed',
  minimumItemCosts: [{ id: 'Ore', quantity: 0 }], minimumCurrencyCosts: [],
  maximumOutputs: [{ id: 'Bar', quantity: 2 }], minimumDurationMs: 500, ...extra });
function resources(stock = [['Ore', 10]], slots = 10, amount = 100) {
  const items = new Map(stock.map(([id, quantity]) => { const item = { id }; return [item, { item, quantity }]; }));
  return readResourcesForTesting({ currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    bank: { items, lockedItems: new Set(), occupiedSlots: items.size, maximumSlots: slots },
    currencies: { allObjects: [{ id: 'GP', amount }] }, combat: { player: { selectedEquipmentSet: 0,
      equipmentSets: [{ equipment: { equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } },
    isPaused: false, activeAction: { id: 'Smithing', isActive: true, activeSkills: [] }, pausedAction: undefined }, { version: 'v1.3.1' });
}
const solve = (r, stock = resources(), quantity = 1, extraContext = {}) =>
  planResourceDemand(stock, [{ id: 'Bar', quantity }], Array.isArray(r) ? r : [r], { ...context, ...extraContext });
const reasons = plan => plan.rejected.map(entry => entry.reason);

test('fixed effects become equal, detached minimum/maximum ranges', () => {
  const r = recipe(); const result = normalizeRecipeEffects(r);
  assert.equal(result.supported, true); assert.deepEqual(result.data.minimumItemCosts, r.itemCosts);
  assert.deepEqual(result.data.maximumOutputs, r.outputs); assert.equal(result.data.minimumDurationMs, 1000);
  result.data.minimumItemCosts[0].quantity = 999; assert.equal(r.itemCosts[0].quantity, 1);
});

test('bounded ranges keep explicit zero minimum consumption without assuming free costs', () => {
  const result = normalizeRecipeEffects(bounded()); assert.equal(result.supported, true);
  assert.equal(result.data.itemCosts[0].quantity, 1); assert.equal(result.data.minimumItemCosts[0].quantity, 0);
  assert.equal(result.data.outputs[0].quantity, 1); assert.equal(result.data.maximumOutputs[0].quantity, 2);
});

test('unknown range proof, missing bounds and ID mismatches are rejected', () => {
  for (const extra of [{ rangeEvidence: 'unknown' }, { minimumItemCosts: undefined }, { minimumCurrencyCosts: null },
    { maximumOutputs: undefined }, { minimumDurationMs: null }, { minimumItemCosts: [{ id: 'Other', quantity: 0 }] },
    { maximumOutputs: [{ id: 'Other', quantity: 2 }] }]) {
    assert.equal(normalizeRecipeEffects(bounded(extra)).supported, false);
    assert.equal(solve(bounded(extra)).status, 'blocked');
  }
});

test('fixed labels cannot hide contradictory variable fields', () => {
  for (const extra of [{ minimumItemCosts: [{ id: 'Ore', quantity: 0 }] },
    { maximumOutputs: [{ id: 'Bar', quantity: 2 }] }, { minimumDurationMs: 500 }])
    assert.equal(normalizeRecipeEffects(recipe(extra)).reason, 'fixed-effects-conflict');
});

test('invalid, nonfinite, reversed and duplicate ranges are never coerced', () => {
  for (const quantity of [null, NaN, Infinity, -1, '0', 0.5, 2])
    assert.equal(normalizeRecipeEffects(bounded({ minimumItemCosts: [{ id: 'Ore', quantity }] })).supported, false);
  assert.equal(normalizeRecipeEffects(bounded({ maximumOutputs: [{ id: 'Bar', quantity: 0 }] })).supported, false);
  assert.equal(normalizeRecipeEffects(bounded({ minimumDurationMs: 1001 })).supported, false);
  assert.equal(normalizeRecipeEffects(bounded({ minimumItemCosts: [{ id: 'Ore', quantity: 0 }, { id: 'Ore', quantity: 0 }] })).supported, false);
});

test('maximum consumption/minimum yield reserve supply while preserving upper outcomes', () => {
  const plan = solve(bounded({ itemCosts: [{ id: 'Ore', quantity: 2 }], currencyCosts: [{ id: 'GP', amount: 5 }],
    minimumCurrencyCosts: [{ id: 'GP', amount: 0 }] }), resources(), 3);
  assert.equal(plan.status, 'planned'); assert.equal(plan.steps[0].batches, 3);
  assert.deepEqual(plan.projection.items, [{ id: 'Bar', quantity: 3 }, { id: 'Ore', quantity: 4 }]);
  assert.deepEqual(plan.projection.upperItems, [{ id: 'Bar', quantity: 6 }, { id: 'Ore', quantity: 10 }]);
  assert.deepEqual(plan.projection.currencies, [{ id: 'GP', amount: 85 }]);
  assert.deepEqual(plan.projection.upperCurrencies, [{ id: 'GP', amount: 100 }]);
  assert.equal(plan.steps[0].minimumDurationMs, 1500); assert.equal(plan.steps[0].durationMs, 3000);
});

test('chance to preserve costs never substitutes for having the maximum required materials', () => {
  const plan = solve(bounded({ itemCosts: [{ id: 'Ore', quantity: 2 }] }), resources([['Ore', 1]]));
  assert.equal(plan.status, 'blocked'); assert.ok(reasons(plan).includes('no-confirmed-quantity-route'));
});

test('saved materials retain their possible bank slot even when projected minimum stock is zero', () => {
  const plan = solve(bounded(), resources([['Ore', 1]], 1));
  assert.equal(plan.status, 'blocked'); assert.ok(reasons(plan).includes('bank-capacity-insufficient'));
  const accepted = solve(bounded(), resources([['Ore', 1]], 2));
  assert.equal(accepted.projection.occupiedSlots, 1); assert.equal(accepted.projection.possibleOccupiedSlots, 2);
});

test('fixed batch capacity is checked on the first operation, not only the final state', () => {
  const plan = solve(recipe(), resources([['Ore', 2]], 1), 2);
  assert.equal(plan.status, 'blocked'); assert.ok(reasons(plan).includes('bank-capacity-insufficient'));
  const oneBatch = solve(recipe({ itemCosts: [{ id: 'Ore', quantity: 2 }], outputs: [{ id: 'Bar', quantity: 2 }] }), resources([['Ore', 2]], 1), 2);
  assert.equal(oneBatch.status, 'planned'); assert.equal(oneBatch.steps[0].batches, 1);
});

test('unknown surplus from doubling is not credited as guaranteed prerequisite supply', () => {
  const gather = bounded({ id: 'mine', outputs: [{ id: 'Ore', quantity: 1 }], maximumOutputs: [{ id: 'Ore', quantity: 2 }],
    itemCosts: [], minimumItemCosts: [], possibleOutputIds: ['Ore'] });
  const plan = solve([gather, recipe({ itemCosts: [{ id: 'Ore', quantity: 2 }] })], resources([]));
  assert.equal(plan.status, 'planned'); assert.equal(plan.steps[0].batches, 2);
  assert.deepEqual(plan.projection.upperItems, [{ id: 'Bar', quantity: 1 }, { id: 'Ore', quantity: 2 }]);
});

test('upper inventory propagates through dependency recipes and OR alternatives can avoid capacity uncertainty', () => {
  const gather = bounded({ id: 'mine', outputs: [{ id: 'Ore', quantity: 1 }], maximumOutputs: [{ id: 'Ore', quantity: 2 }],
    itemCosts: [], minimumItemCosts: [], possibleOutputIds: ['Ore'] });
  const blocked = solve([gather, recipe()], resources([], 1));
  assert.equal(blocked.status, 'blocked'); assert.ok(reasons(blocked).includes('bank-capacity-insufficient'));
  const direct = recipe({ id: 'buy', itemCosts: [], currencyCosts: [{ id: 'GP', amount: 1 }] });
  const alternative = solve([gather, recipe(), direct], resources([], 1));
  assert.equal(alternative.status, 'planned'); assert.equal(alternative.steps[0].recipeId, 'buy');
});

test('upper bound overflow rejects partial projections', () => {
  const plan = solve(bounded({ maximumOutputs: [{ id: 'Bar', quantity: Number.MAX_SAFE_INTEGER }] }), resources(), 2);
  assert.equal(plan.status, 'blocked'); assert.equal(plan.projection, null); assert.ok(reasons(plan).includes('quantity-overflow'));
});

test('invalid externally supplied projections cannot understate the current known stock/currency', () => {
  for (const extraContext of [{ upperItems: null }, { upperItems: [{ id: 'Ore', quantity: 1 }] },
    { upperCurrencies: [{ id: 'GP', amount: 1 }] }, { upperCurrencies: [{ id: 'Unknown', amount: 100 }] }])
    assert.equal(solve(recipe(), resources(), 1, extraContext).reason, 'projection-bounds-invalid');
});

test('bounded monitor uses maximum availability and minimum slot release', () => {
  const r = bounded(); const task = { id: 'task', action: { id: 'Smithing', selectionIds: ['Bar'] },
    endConditions: [{ type: 'inventory', id: 'Bar', quantity: 1 }], requirements: { items: r.itemCosts, currencies: r.currencyCosts,
      minimumItems: r.minimumItemCosts, minimumCurrencies: r.minimumCurrencyCosts, costEvidence: 'bounded', rangeEvidence: 'confirmed',
      bankOrder: 'consume-then-produce', outputIds: ['Bar'], outputsEvidence: 'confirmed' } };
  const observe = slots => ({ resources: resources([['Ore', 1]], slots), actionSelection: { supported: true, actionId: 'Smithing', selectionIds: ['Bar'] } });
  assert.equal(monitorTask(task, observe(1), null, { nowMs: 0, sessionId: 's' }).reason, 'bank-capacity-insufficient');
  assert.equal(monitorTask(task, observe(2), null, { nowMs: 0, sessionId: 's' }).status, 'continue');
  task.requirements.minimumItems[0].quantity = 1;
  assert.equal(monitorTask(task, observe(1), null, { nowMs: 0, sessionId: 's' }).status, 'continue');
  task.requirements.items[0].quantity = 2;
  assert.equal(monitorTask(task, observe(2), null, { nowMs: 0, sessionId: 's' }).reason, 'materials-insufficient');
});

test('consumption validation rejects unknown bounds and handles decimal currency minima', () => {
  const r = bounded({ currencyCosts: [{ id: 'GP', amount: 1.5 }], minimumCurrencyCosts: [{ id: 'GP', amount: 0.25 }] });
  assert.equal(normalizeConsumptionBounds(r).data.minimumCurrencyCosts[0].amount, 0.25);
  r.minimumCurrencyCosts[0].amount = 2; assert.equal(normalizeConsumptionBounds(r).supported, false);
});

test('frozen ranges are deterministic and results contain no input references', () => {
  const r = bounded(); function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(r); const first = normalizeRecipeEffects(r); assert.deepEqual(normalizeRecipeEffects(r), first);
  const plan = solve(r); assert.deepEqual(solve(r), plan);
  first.data.maximumOutputs[0].quantity = 999; plan.projection.upperItems[0].quantity = 999;
  assert.equal(r.maximumOutputs[0].quantity, 2);
});

test('unbounded extra quantity is labeled unknown and never exported as a numeric ceiling', () => {
  const first = solve(bounded({ possibleOutputIds: ['Bar', 'Ore'] }), resources([['Ore', 2]], 3));
  assert.equal(first.status, 'planned'); assert.deepEqual(first.projection.upperItems, [{ id: 'Bar', quantity: 2 }]);
  assert.ok(first.projection.possibleOccupiedIds.includes('Ore'));
  const nextResources = resources(first.projection.items.map(item => [item.id, item.quantity]), 3);
  const second = planResourceDemand(nextResources, [{ id: 'Bar', quantity: 2 }], [recipe()], {
    ...context, upperItems: first.projection.upperItems, upperCurrencies: first.projection.upperCurrencies,
    possibleOccupiedIds: first.projection.possibleOccupiedIds });
  assert.equal(second.status, 'planned'); assert.ok(second.projection.possibleOccupiedIds.includes('Ore'));
  assert.ok(!second.projection.upperItems.some(item => item.id === 'Ore'));
});
