import test from 'node:test';
import assert from 'node:assert/strict';
import { planResourceDemand } from '../src/quantities.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';

const context = { ownership: { base: true, toth: false, aod: false, ita: false } };
const recipe = (id, outputId, quantity = 1, itemCosts = [], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed',
  costEvidence: 'fixed', bankOrder: 'consume-then-produce', kind: 'noncombat', risk: 'safe', unlocked: true,
  outputs: [{ id: outputId, quantity }], itemCosts, currencyCosts: [], possibleOutputIds: [outputId], durationMs: 10, ...extra });
function resources(items = [], slots = 20, currencies = [{ id: 'GP', amount: 100 }], lockedIds = []) {
  const stock = new Map(items.map(([id, quantity]) => { const item = { id }; return [item, { item, quantity }]; }));
  const lockedItems = new Set([...stock.keys()].filter(item => lockedIds.includes(item.id)));
  for (const id of lockedIds) if (![...stock.keys()].some(item => item.id === id)) lockedItems.add({ id });
  return readResourcesForTesting({ currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    bank: { items: stock, occupiedSlots: stock.size, maximumSlots: slots, lockedItems }, currencies: { allObjects: currencies },
    combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
      { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }
    ] } }] } }, activeAction: undefined, pausedAction: undefined, isPaused: false }, { version: 'v1.3.1' });
}
const solve = (demands, recipes, stock = resources(), limits, ctx = context) => planResourceDemand(stock, demands, recipes, ctx, limits);
const demand = (id, quantity = 1) => ({ id, quantity });
const reasons = result => result.rejected.map(entry => entry.reason);

test('ceil batches account for current stock and retain physically held final reservations', () => {
  const stock = resources([['Logs', 1]]);
  const plan = solve([demand('Logs', 10)], [recipe('cut', 'Logs', 4)], stock);
  assert.equal(plan.status, 'planned'); assert.equal(plan.steps[0].batches, 3); assert.equal(plan.durationMs, 30);
  assert.deepEqual(plan.projection.items, [demand('Logs', 13)]);
  assert.deepEqual(plan.projection.reservations, [demand('Logs', 10)]);
  assert.equal(stock.categories.bank.data.items[0].quantity, 1); assert.equal(plan.runnable, false);
});

test('already held demand is satisfied without production or fake Completion claims', () => {
  const plan = solve([demand('Logs', 3)], [], resources([['Logs', 5]]));
  assert.equal(plan.status, 'satisfied'); assert.deepEqual(plan.steps, []); assert.equal(plan.durationMs, 0);
  assert.ok(!('achieved' in plan)); assert.deepEqual(plan.projection.items, [demand('Logs', 5)]);
});

test('duplicate demands are summed instead of sharing the same units', () => {
  const plan = solve([demand('Ore', 2), demand('Ore', 3)], [recipe('mine', 'Ore', 2)], resources([['Ore', 1]]));
  assert.equal(plan.steps[0].batches, 2); assert.deepEqual(plan.projection.reservations, [demand('Ore', 5)]);
});

test('AND ingredients reserve stock before recursively securing the next ingredient', () => {
  const recipes = [recipe('bar', 'Bar', 1, [demand('Ore')]),
    recipe('blade', 'Blade', 1, [demand('Bar'), demand('Ore')]), recipe('mine', 'Ore')];
  const plan = solve([demand('Blade')], recipes, resources([['Ore', 1]]));
  assert.equal(plan.status, 'planned'); assert.deepEqual(plan.steps.map(step => step.recipeId), ['bar', 'mine', 'blade']);
  assert.deepEqual(plan.projection.items, [demand('Blade')]);
  assert.equal(solve([demand('Blade')], recipes.slice(0, 2), resources([['Ore', 1]])).status, 'blocked');
});

test('final reserved items cannot be consumed by a later goal', () => {
  const recipes = [recipe('bar', 'Bar', 1, [demand('Ore')]), recipe('blade', 'Blade', 1, [demand('Bar')]), recipe('mine', 'Ore')];
  const plan = solve([demand('Bar'), demand('Blade')], recipes, resources([['Ore', 1]]));
  assert.equal(plan.status, 'planned'); assert.deepEqual(plan.projection.items, [demand('Bar'), demand('Blade')]);
  assert.equal(plan.steps.filter(step => step.recipeId === 'bar').length, 2);
});

test('multiple guaranteed outputs supply later goals without repeating the recipe', () => {
  const recipes = [recipe('both', 'A', 1, [], { outputs: [demand('A'), demand('B')], possibleOutputIds: ['A', 'B'] })];
  const plan = solve([demand('A'), demand('B')], recipes);
  assert.equal(plan.steps.length, 1); assert.deepEqual(plan.projection.reservations, [demand('A'), demand('B')]);
});

test('OR chooses total prerequisite time and ties deterministically by stable ID', () => {
  const recipes = [recipe('a-craft', 'A', 1, [demand('Ore')]), recipe('b-buy', 'A', 1, [], { durationMs: 50 }),
    recipe('mine', 'Ore', 1, [], { durationMs: 100 })];
  const plan = solve([demand('A')], recipes); assert.equal(plan.steps[0].recipeId, 'b-buy');
  const tied = solve([demand('A')], [recipe('z', 'A'), recipe('a', 'A')]); assert.equal(tied.steps[0].recipeId, 'a');
  assert.deepEqual(solve([demand('A')], [...recipes].reverse()), plan);
});

test('failed branches roll back prerequisite costs, stock, currency and steps', () => {
  const recipes = [recipe('a-failed', 'A', 1, [demand('Ore')], { currencyCosts: [{ id: 'GP', amount: 1000 }] }),
    recipe('b-valid', 'A', 1, [], { currencyCosts: [{ id: 'GP', amount: 2 }] }),
    recipe('mine', 'Ore', 1, [], { currencyCosts: [{ id: 'GP', amount: 3 }] })];
  const plan = solve([demand('A')], recipes);
  assert.deepEqual(plan.steps.map(step => step.recipeId), ['b-valid']);
  assert.deepEqual(plan.projection.currencies, [{ id: 'GP', amount: 98 }]);
  assert.deepEqual(plan.projection.items, [demand('A')]);
});

test('cyclic and self-consuming routes are rejected while finite alternatives remain usable', () => {
  const recipes = [recipe('a-cycle', 'A', 1, [demand('B')]), recipe('b-cycle', 'B', 1, [demand('A')]),
    recipe('c-own', 'A', 2, [demand('A')]), recipe('z-direct', 'A')];
  const plan = solve([demand('A')], recipes);
  assert.equal(plan.steps[0].recipeId, 'z-direct'); assert.ok(reasons(plan).includes('quantity-cycle'));
  assert.ok(reasons(plan).includes('self-consuming-recipe-unverified'));
});

test('unknown, unowned, locked, unsafe and non-fixed recipes never generate inventory', () => {
  for (const extra of [{ evidence: 'unknown' }, { scopeId: 'ita' }, { unlocked: false }, { kind: 'combat' },
    { risk: 'unknown' }, { costEvidence: 'preservation-unknown' }, { bankOrder: 'unknown' }]) {
    const plan = solve([demand('A')], [recipe('a-unusable', 'A', 1, [], extra), recipe('b-valid', 'A')]);
    assert.equal(plan.steps[0].recipeId, 'b-valid'); assert.ok(plan.rejected.length > 0);
  }
});

test('protected materials are not consumed but can satisfy a possession goal', () => {
  const stock = resources([['Ore', 10]], 20, undefined, ['Ore']);
  assert.equal(solve([demand('Ore', 5)], [], stock).status, 'satisfied');
  const plan = solve([demand('Bar')], [recipe('smelt', 'Bar', 1, [demand('Ore')])], stock);
  assert.equal(plan.status, 'blocked'); assert.ok(reasons(plan).includes('material-protected'));
});

test('fixed currency costs use actual decimals and never assume unobserved currency is zero', () => {
  const recipes = [recipe('buy', 'A', 1, [], { currencyCosts: [{ id: 'GP', amount: 1.25 }] })];
  const plan = solve([demand('A', 2)], recipes, resources([], 20, [{ id: 'GP', amount: 3 }]));
  assert.deepEqual(plan.projection.currencies, [{ id: 'GP', amount: 0.5 }]);
  assert.ok(reasons(solve([demand('A', 3)], recipes, resources([], 20, [{ id: 'GP', amount: 3 }]))).includes('currency-insufficient'));
  assert.ok(reasons(solve([demand('A')], recipes, resources([], 20, [{ id: 'SC', amount: 3 }]))).includes('currency-unobserved'));
});

test('bank space released by confirmed fixed consumption can receive the product', () => {
  const stock = resources([['Ore', 1]], 1);
  const plan = solve([demand('Bar')], [recipe('smelt', 'Bar', 1, [demand('Ore')])], stock);
  assert.equal(plan.status, 'planned'); assert.equal(plan.projection.occupiedSlots, 1);
  const noRelease = solve([demand('Bar')], [recipe('smelt', 'Bar', 1, [demand('Ore')])], resources([['Ore', 2]], 1));
  assert.ok(reasons(noRelease).includes('bank-capacity-insufficient'));
});

test('possible random outputs consume capacity but are never credited as supply', () => {
  const recipes = [recipe('cut', 'Logs', 1, [], { possibleOutputIds: ['Logs', 'Gem'] })];
  assert.ok(reasons(solve([demand('Logs')], recipes, resources([], 1))).includes('bank-capacity-insufficient'));
  const plan = solve([demand('Logs')], recipes, resources([], 2));
  assert.deepEqual(plan.projection.items, [demand('Logs')]);
  assert.equal(plan.projection.possibleOccupiedSlots, 2); assert.deepEqual(plan.projection.possibleOccupiedIds, ['Gem']);
  assert.equal(solve([demand('Gem')], recipes, resources([], 2)).status, 'blocked');
});

test('potential random stacks persist across steps so future bank space is not overstated', () => {
  const recipes = [recipe('first', 'A', 1, [], { possibleOutputIds: ['A', 'Gem'] }), recipe('second', 'B')];
  const blocked = solve([demand('A'), demand('B')], recipes, resources([], 2));
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.projection, null);
  const plan = solve([demand('A'), demand('B')], recipes, resources([], 3));
  assert.equal(plan.projection.possibleOccupiedSlots, 3);
});

test('demand, recipe and aggregate quantities reject invalid values and overflow', () => {
  for (const quantity of [0, -1, null, NaN, Infinity, '1', 0.5])
    assert.equal(solve([demand('A', quantity)], [recipe('work', 'A')]).reason, 'demands-invalid-or-limit');
  assert.equal(solve([demand('A', Number.MAX_SAFE_INTEGER), demand('A')], []).reason, 'demand-overflow');
  const plan = solve([demand('A', 2)], [recipe('work', 'A', 1, [], { durationMs: Number.MAX_SAFE_INTEGER })]);
  assert.ok(reasons(plan).includes('quantity-overflow'));
  const invalid = solve([demand('A')], [recipe('work', 'A', 0)]); assert.ok(reasons(invalid).includes('recipe-data-invalid'));
});

test('recipe collection shape, effects, duplicate IDs and outputs are validated', () => {
  assert.equal(solve([demand('A')], [recipe('same', 'A'), recipe('same', 'A')]).reason, 'duplicate-recipe');
  for (const extra of [{ outputs: [demand('A'), demand('A')] }, { possibleOutputIds: [] }, { itemCosts: null },
    { currencyCosts: [{ id: 'GP', amount: null }] }, { durationMs: '10' }]) {
    const plan = solve([demand('A')], [recipe('work', 'A', 1, [], extra)]);
    assert.equal(plan.status, 'blocked');
  }
});

test('global expansion exhaustion discards earlier best routes rather than returning a partial plan', () => {
  const plan = solve([demand('A')], [recipe('a-direct', 'A'), recipe('b-unsearched', 'A', 1, [demand('Ore')]), recipe('mine', 'Ore')],
    resources(), { maxExpansions: 2 });
  assert.equal(plan.reason, 'quantity-expansion-limit'); assert.deepEqual(plan.steps, []); assert.equal(plan.projection, null);
});

test('depth, step, batch, catalog and demand limits remain bounded', () => {
  const recipes = [recipe('a', 'A', 1, [demand('B')]), recipe('b', 'B', 1, [demand('C')]), recipe('c', 'C')];
  assert.ok(reasons(solve([demand('A')], recipes, resources(), { maxDepth: 1 })).includes('quantity-depth-limit'));
  assert.ok(reasons(solve([demand('A')], recipes, resources(), { maxSteps: 1 })).includes('quantity-step-limit'));
  assert.ok(reasons(solve([demand('A', 3)], [recipe('work', 'A')], resources(), { maxBatches: 2 })).includes('quantity-batch-limit'));
  assert.equal(solve([demand('A')], recipes, resources(), { maxRecipes: 1 }).reason, 'recipes-invalid-or-limit');
  assert.equal(solve([demand('A'), demand('B')], recipes, resources(), { maxDemands: 1 }).reason, 'demands-invalid-or-limit');
  for (const limits of [null, { unknown: 1 }, { maxDepth: 0 }, { maxExpansions: Infinity }, { maxRecipes: '1' }])
    assert.equal(solve([demand('A')], recipes, resources(), limits).reason, 'quantity-limits-invalid');
});

test('input order, frozen facts and detached projections preserve deterministic planning', () => {
  const stock = resources([['Ore', 1]]);
  const demands = [demand('Bar'), demand('Blade')];
  const recipes = [recipe('mine', 'Ore'), recipe('bar', 'Bar', 1, [demand('Ore')]), recipe('blade', 'Blade', 1, [demand('Bar')])];
  const first = solve(demands, recipes, stock);
  assert.deepEqual(solve([...demands].reverse(), [...recipes].reverse(), stock), first);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(stock); freeze(demands); freeze(recipes);
  const plan = solve(demands, recipes, stock); assert.deepEqual(plan, first);
  plan.steps[0].outputs[0].quantity = 999; plan.projection.items[0].quantity = 999;
  assert.equal(recipes[1].outputs[0].quantity, 1); assert.equal(stock.categories.bank.data.items[0].quantity, 1);
});

test('unknown potential bank occupancy cannot be silently replaced with an empty set', () => {
  for (const possibleOccupiedIds of [null, 'Gem', ['Gem', 'Gem']])
    assert.equal(solve([demand('A')], [recipe('produce', 'A')], resources(), undefined,
      { ...context, possibleOccupiedIds }).reason, 'possible-slots-invalid');
});
