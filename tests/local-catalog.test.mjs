import test from 'node:test';
import assert from 'node:assert/strict';
import { indexRecipeCatalog, materializeRecipeCatalog } from '../src/local-catalog.mjs';
import { planResourceDemand } from '../src/quantities.mjs';
import { selectWindowedQuantifiedCompletionPlan } from '../src/quantified-planner.mjs';
import { generateCompletionCandidates } from '../setup.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
const context = { ownership: { base: true, ita: false } };
const limits = { maxRecipes: 512, maxDemands: 128, maxDepth: 24 };
const recipe = (id, output, costs = [], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed', unlocked: true,
  kind: 'noncombat', risk: 'safe', costEvidence: 'fixed', bankOrder: 'consume-then-produce', durationMs: 1000,
  outputs: [{ id: output, quantity: 1 }], itemCosts: costs.map(id => ({ id, quantity: 1 })), currencyCosts: [], possibleOutputIds: [output], ...extra });
const action = recipeId => ({ recipeId, evidence: 'confirmed', action: { id: 'Woodcutting', selectionIds: [recipeId] }, costPerBatch: 0, reliabilityPerBatch: 1 });
const demand = id => ({ id, quantity: 1 });
const local = (recipes, demands = [demand('A')], overrides = {}, allowed = recipes.map(recipe => recipe.id), ctx = context, stock = new Map(), acts) =>
  materializeRecipeCatalog(indexRecipeCatalog(recipes), demands, allowed,
    acts ?? new Map(recipes.map(recipe => [recipe.id, action(recipe.id)])), ctx, { ...limits, ...overrides }, stock);
function resources() {
  return readResourcesForTesting({ currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    bank: { items: new Map(), occupiedSlots: 0, maximumSlots: 20, lockedItems: new Set() }, currencies: { allObjects: [{ id: 'GP', amount: 100 }] },
    combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
      { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } },
    isPaused: false, activeAction: undefined, pausedAction: undefined }, { version: 'v1.3.1' });
}

test('5000 unrelated recipes are excluded while required producers remain usable', () => {
  const recipes = Array.from({ length: 5000 }, (_, i) => recipe(`unused-${i}`, `Unused-${i}`));
  recipes.push(recipe('z-needed', 'A')); const subset = local(recipes);
  assert.equal(subset.supported, true); assert.equal(subset.recipes.length, 1); assert.equal(subset.recipes[0].id, 'z-needed');
  assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context).status, 'planned');
});

test('AND material chains and OR producers are preserved, including shared materials', () => {
  const recipes = [recipe('make-A', 'A', ['B', 'C']), recipe('make-B', 'B', ['Ore']), recipe('make-C', 'C', ['Ore']),
    recipe('mine', 'Ore'), recipe('buy-B', 'B'), recipe('unused', 'Other')];
  const subset = local(recipes); assert.equal(subset.supported, true); assert.equal(subset.recipes.length, 5);
  assert.equal(subset.recipes.filter(recipe => recipe.id === 'mine').length, 1);
  const plan = planResourceDemand(resources(), [demand('A')], subset.recipes, context);
  assert.equal(plan.status, 'planned');
});

test('cycles terminate and an available direct alternative is retained', () => {
  const recipes = [recipe('from-B', 'A', ['B']), recipe('from-A', 'B', ['A']), recipe('direct', 'A')];
  const subset = local(recipes); assert.equal(subset.recipes.length, 3);
  assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context).steps[0].recipeId, 'direct');
});

test('only permitted recipes can satisfy demands or supply ingredients', () => {
  const recipes = [recipe('make', 'A', ['Ore']), recipe('mine', 'Ore')];
  const subset = local(recipes, [demand('A')], {}, ['make']); assert.equal(subset.recipes.length, 1);
  assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context).status, 'blocked');
});

test('unverified, unowned, locked and unsafe effects do not expand ingredient bodies', () => {
  for (const extra of [{ evidence: 'unknown' }, { scopeId: 'ita' }, { unlocked: false }, { risk: 'unknown' }, { kind: 'combat' }]) {
    const unsafe = recipe('unsafe', 'A', [], extra);
    Object.defineProperty(unsafe, 'itemCosts', { get() { throw new Error('private'); } });
    const subset = local([unsafe, recipe('safe', 'A')]); assert.equal(subset.supported, true);
    assert.ok(subset.rejected.some(entry => entry.recipeId === 'unsafe'));
    assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context).steps[0].recipeId, 'safe');
    assert.ok(!JSON.stringify(subset).includes('private'));
  }
});

test('missing or unsupported actions are rejected even for known effects', () => {
  const subset = local([recipe('make', 'A')], [demand('A')], {}, ['make'], context, new Map(), new Map());
  assert.equal(subset.rejected[0].reason, 'recipe-action-unverified');
  assert.equal(subset.recipes[0].evidence, 'unknown');
});

test('unrelated costs, intervals, extra metadata and action bodies are never read', () => {
  const unrelated = recipe('unused', 'Other');
  for (const field of ['itemCosts', 'durationMs', 'extra']) Object.defineProperty(unrelated, field, { get() { throw new Error('must not read'); } });
  const actions = new Map([['needed', action('needed')], ['unused', { get action() { throw new Error('must not read'); } }]]);
  const subset = local([unrelated, recipe('needed', 'A')], [demand('A')], {}, ['needed', 'unused'], context, new Map(), actions);
  assert.equal(subset.supported, true); assert.equal(subset.recipes.length, 1);
});

test('unreadable relevant effects are isolated and do not erase another recipe', () => {
  const bad = recipe('bad', 'A'); Object.defineProperty(bad, 'itemCosts', { get() { throw new Error('save-secret'); } });
  const subset = local([bad, recipe('good', 'A')]); assert.equal(subset.supported, true); assert.ok(subset.rejected.length);
  assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context).steps[0].recipeId, 'good');
  assert.ok(!JSON.stringify(subset).includes('save-secret'));
});

test('uncertain outputs cannot become guaranteed producers', () => {
  const subset = local([recipe('make-A', 'A', [], { possibleOutputIds: ['A', 'Gem'] })], [demand('Gem')]);
  assert.equal(subset.supported, true); assert.deepEqual(subset.recipes, []);
  assert.equal(planResourceDemand(resources(), [demand('Gem')], subset.recipes, context).status, 'blocked');
});

test('already sufficient stock needs no unrelated catalog traversal and duplicate demands are summed', () => {
  const r = recipe('make', 'A'); Object.defineProperty(r, 'itemCosts', { get() { throw new Error('must not read'); } });
  const subset = local([r], [demand('A'), demand('A')], {}, ['make'], context, new Map([['A', 2]]));
  assert.equal(subset.supported, true); assert.equal(subset.inspected, 0); assert.deepEqual(subset.recipes, []);
});

test('recipe limits discard partial closures rather than selecting an unsearched producer', () => {
  const subset = local([recipe('a', 'A'), recipe('b', 'A')], [demand('A')], { maxRecipes: 1 });
  assert.equal(subset.reason, 'local-recipe-limit'); assert.deepEqual(subset.recipes, []);
});

test('depth stops producer expansion without inventing prerequisite supply', () => {
  const subset = local([recipe('a', 'A', ['B']), recipe('b', 'B', ['C']), recipe('c', 'C')], [demand('A')], { maxDepth: 1 });
  assert.equal(subset.supported, true); assert.equal(subset.recipes.length, 2);
  assert.equal(planResourceDemand(resources(), [demand('A')], subset.recipes, context, { maxDepth: 1 }).status, 'blocked');
});

test('global identity/output ambiguity and hard collection limits fail closed', () => {
  assert.equal(indexRecipeCatalog([recipe('same', 'A'), recipe('same', 'B')]).reason, 'global-recipe-invalid-or-duplicate');
  assert.equal(indexRecipeCatalog([recipe('bad', 'A', [], { outputs: null })]).reason, 'global-output-index-invalid');
  assert.equal(indexRecipeCatalog(Array(20_001).fill({})).reason, 'global-catalog-limit-or-invalid');
});

test('bounded effects survive local extraction without being flattened to fixed costs', () => {
  const r = recipe('bounded', 'A', ['Ore'], { costEvidence: 'bounded', rangeEvidence: 'confirmed', minimumItemCosts: [{ id: 'Ore', quantity: 0 }],
    minimumCurrencyCosts: [], maximumOutputs: [{ id: 'A', quantity: 2 }], minimumDurationMs: 500 });
  const subset = local([r]); assert.equal(subset.recipes[0].costEvidence, 'bounded');
  assert.equal(subset.recipes[0].minimumItemCosts[0].quantity, 0);
});

test('frozen facts, order changes and detached effects preserve deterministic results', () => {
  const recipes = [recipe('make', 'A', ['Ore']), recipe('mine', 'Ore')];
  const first = local(recipes); assert.deepEqual(local([...recipes].reverse()), first);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(recipes); const subset = local(recipes); assert.deepEqual(subset, first);
  subset.recipes.find(r => r.id === 'make').itemCosts[0].quantity = 999;
  assert.equal(recipes[0].itemCosts[0].quantity, 1);
});

test('windowed Compiler accepts a 5001-recipe catalog while a local overflow candidate falls back', () => {
  const entries = ['A', 'B'].map(id => ({ id, current: 0, maximum: 1, accessible: null }));
  const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category => [category,
    { supported: true, missing: category === 'items' ? structuredClone(entries) : [], entries: category === 'items' ? structuredClone(entries) : [] }]));
  const snapshot = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: { scopes: [{ id: 'base', ownership: true, supported: true, categories }] } };
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const graph = { nodes: candidates.map(candidate => ({ id: candidate.id, scopeId: 'base', evidence: 'confirmed', completed: false,
    routes: [{ id: 'work', evidence: 'confirmed', kind: 'noncombat', risk: 'safe', durationMs: 1, requires: [] }] })) };
  const recipes = Array.from({ length: 5000 }, (_, i) => recipe(`unused-${i}`, `Unused-${i}`)); recipes.push(recipe('make-B', 'B'));
  const sid = candidate => JSON.stringify([candidate.id, 'work']);
  const model = { steps: candidates.map(candidate => ({ stepId: sid(candidate), evidence: 'confirmed', type: 'production',
    demands: [demand(candidate.targetId)], allowedRecipeIds: recipes.map(recipe => recipe.id) })), recipes, recipeActions: recipes.map(r => action(r.id)) };
  const estimates = candidates.map(candidate => ({ stepId: sid(candidate), evidence: 'confirmed', completionGain: 0.1,
    unlockValue: 0, consumptionCost: 0, reliability: 1, deathProbability: 0 }));
  let selected = selectWindowedQuantifiedCompletionPlan(snapshot, graph, estimates, resources(), model, { nowMs: 0 });
  assert.equal(selected.selected.candidateId, candidates[1].id); assert.equal(selected.nextTask.action.selectionIds[0], 'make-B');
  recipes.push(...Array.from({ length: 3 }, (_, i) => recipe(`make-A-${i}`, 'A')));
  model.recipeActions.push(...recipes.slice(-3).map(r => action(r.id)));
  for (const binding of model.steps) binding.allowedRecipeIds = recipes.map(r => r.id);
  selected = selectWindowedQuantifiedCompletionPlan(snapshot, graph, estimates, resources(), model, { nowMs: 0, quantityLimits: { maxRecipes: 2 } });
  assert.equal(selected.selected.candidateId, candidates[1].id);
  assert.equal(selected.blockers.find(blocker => blocker.id === candidates[0].id).reason, 'local-recipe-limit');
});

test('lookup work is bounded even for disallowed producer edges, and bad stock cannot bypass planning', () => {
  const recipes = Array.from({ length: 10_001 }, (_, i) => recipe(`many-${i}`, 'A'));
  const limited = local(recipes, [demand('A')], {}, []);
  assert.equal(limited.reason, 'local-producer-inspection-limit'); assert.deepEqual(limited.recipes, []);
  for (const quantity of [NaN, Infinity, '2', -1])
    assert.equal(local([recipe('make', 'A')], [demand('A')], {}, ['make'], context, new Map([['A', quantity]])).reason, 'local-stock-invalid');
});
