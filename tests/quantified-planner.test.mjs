import test from 'node:test';
import assert from 'node:assert/strict';
import { selectQuantifiedCompletionPlan } from '../src/quantified-planner.mjs';
import { generateCompletionCandidates, readSnapshot } from '../setup.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
import { monitorTask } from '../src/monitor.mjs';
import { createWoodcuttingExecutorForTesting } from '../src/executor.mjs';
import { selectPreparedCompletionPlans } from '../src/planner.mjs';

const stepId = (nodeId, routeId = 'acquire') => JSON.stringify([nodeId, routeId]);
const recipe = (id, outputId, quantity = 1, itemCosts = [], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed',
  costEvidence: 'fixed', bankOrder: 'consume-then-produce', kind: 'noncombat', risk: 'safe', unlocked: true,
  outputs: [{ id: outputId, quantity }], itemCosts, currencyCosts: [], possibleOutputIds: [outputId], durationMs: 1000, ...extra });
const node = (id, requires = [], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed', completed: false,
  routes: [{ id: 'acquire', requires, durationMs: 1, evidence: 'confirmed', kind: 'noncombat', risk: 'safe' }], ...extra });
const estimate = (nodeId, extra = {}) => ({ stepId: stepId(nodeId), evidence: 'confirmed',
  completionGain: 0.5, unlockValue: 0, consumptionCost: 999, reliability: 1, deathProbability: 0, ...extra });
const action = (recipeId, extra = {}) => ({ recipeId, evidence: 'confirmed', action: { id: 'melvorF:Woodcutting', selectionIds: [recipeId] },
  costPerBatch: 1, reliabilityPerBatch: 1, ...extra });
const production = (nodeId, demands, allowedRecipeIds) => ({ stepId: stepId(nodeId), type: 'production', evidence: 'confirmed', demands, allowedRecipeIds });
const demand = (id, quantity = 1) => ({ id, quantity });

function fixture() {
  const items = ['A', 'B'].map(id => ({ id, current: 0, maximum: 1, accessible: null }));
  const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category => [category,
    { supported: true, status: 'observed', current: 0, maximum: category === 'items' ? 2 : 0, percent: 0,
      entries: category === 'items' ? structuredClone(items) : [], missing: category === 'items' ? structuredClone(items) : [] }]));
  const snapshot = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: {
    supported: true, scopes: [{ id: 'base', ownership: true, supported: true, categories }] } };
  const [a, b] = generateCompletionCandidates(snapshot).candidates.map(candidate => candidate.id);
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false,
    activeAction: undefined, pausedAction: undefined,
    bank: { items: new Map(), occupiedSlots: 0, maximumSlots: 20, lockedItems: new Set() },
    currencies: { allObjects: [{ id: 'GP', amount: 100 }] }, combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: {
      equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } } };
  const f = { snapshot, game, a, b, graph: { nodes: [node(a), node(b)] }, estimates: [estimate(a), estimate(b)],
    model: { steps: [production(a, [demand('A', 3)], ['make-a']), production(b, [demand('B')], ['make-b'])],
      recipes: [recipe('make-a', 'A'), recipe('make-b', 'B')], recipeActions: [action('make-a'), action('make-b')] } };
  f.resources = () => readResourcesForTesting(game, { version: 'v1.3.1' });
  f.hold = (id, quantity) => {
    const key = [...game.bank.items.keys()].find(item => item.id === id) ?? { id };
    game.bank.items.set(key, { item: key, quantity }); game.bank.occupiedSlots = game.bank.items.size;
  };
  return f;
}
const run = (f, options = {}) => selectQuantifiedCompletionPlan(f.snapshot, f.graph, f.estimates, f.resources(), f.model,
  { nowMs: 100_000, ...options });
const blocker = (result, id) => result.blockers.find(entry => entry.id === id);

test('quantity time and per-batch costs replace original graph estimates in candidate ranking', () => {
  const f = fixture(); const result = run(f);
  assert.equal(result.selected.candidateId, f.b); assert.equal(result.selected.metrics.durationMs, 1000);
  assert.equal(result.selected.metrics.consumptionCost, 1); assert.equal(result.selected.score, 48.99);
  const a = result.evaluations.find(entry => entry.candidateId === f.a);
  assert.equal(a.metrics.durationMs, 3000); assert.equal(a.metrics.consumptionCost, 3);
  assert.equal(a.metrics.completionGain, 0.5); assert.equal(result.nextTask.action.selectionIds[0], 'make-b');
  assert.deepEqual(result.nextTask.endConditions, [
    { type: 'completion', scopeId: 'base', category: 'items', id: 'B' }, { type: 'inventory', id: 'B', quantity: 1 }]);
  assert.equal(result.nextTask.runnable, false); assert.equal(result.runnable, false);
});

test('resource shortage in the higher-utility candidate falls back to another candidate with a reason', () => {
  const f = fixture(); f.estimates[0].unlockValue = 100; f.model.recipes[0].itemCosts = [demand('Unknown')];
  const result = run(f); assert.equal(result.selected.candidateId, f.b);
  assert.equal(blocker(result, f.a).reason, 'quantity-demand-blocked');
  assert.ok(blocker(result, f.a).rejected.some(entry => entry.itemId === 'Unknown'));
});

test('recipe per-batch reliability is aggregated and cannot be hidden by favorable utility', () => {
  const f = fixture(); f.model.recipeActions[0].reliabilityPerBatch = 0.8; f.estimates[0].unlockValue = 100;
  const result = run(f); assert.equal(result.selected.candidateId, f.b);
  assert.equal(blocker(result, f.a).reason, 'reliability-below-minimum');
});

test('already held final quantity is blocked until actual Completion is reobserved', () => {
  const f = fixture(); f.hold('A', 3);
  const result = run(f); assert.equal(result.selected.candidateId, f.b);
  assert.equal(blocker(result, f.a).reason, 'quantity-terminal-awaiting-completion');
  assert.ok(!('achieved' in result));
});

test('quantity stages carry stock consumption and supplement a shared prerequisite when insufficient', () => {
  const f = fixture(); f.graph.nodes = [node(f.a, ['ore']), node('ore')];
  f.estimates = [estimate('ore', { completionGain: 0 }), estimate(f.a)];
  f.model.steps = [production('ore', [demand('Ore')], ['mine']), production(f.a, [demand('A')], ['mine', 'craft'])];
  f.model.recipes = [recipe('mine', 'Ore'), recipe('craft', 'A', 1, [demand('Ore', 2)])];
  f.model.recipeActions = [action('mine'), action('craft')];
  const result = run(f); assert.equal(result.status, 'selected');
  assert.deepEqual(result.selected.steps.map(step => step.routeId), ['mine', 'mine', 'craft']);
  assert.deepEqual(result.selected.resourceProjection.items, [demand('A')]);
  assert.equal(result.selected.metrics.completionGain, 0.5);
  assert.deepEqual(result.nextTask.endConditions, [{ type: 'inventory', id: 'Ore', quantity: 1 }]);
});

test('previous random-output slots survive across distinct graph quantity stages', () => {
  const f = fixture(); f.game.bank.maximumSlots = 2; f.graph.nodes = [node(f.a, ['ore']), node('ore')];
  f.estimates = [estimate('ore', { completionGain: 0 }), estimate(f.a)];
  f.model.steps = [production('ore', [demand('Ore')], ['mine']), production(f.a, [demand('A')], ['craft'])];
  f.model.recipes = [recipe('mine', 'Ore', 1, [], { possibleOutputIds: ['Ore', 'Gem'] }), recipe('craft', 'A')];
  f.model.recipeActions = [action('mine'), action('craft')];
  const result = run(f); assert.equal(result.status, 'blocked');
  assert.ok(blocker(result, f.a).rejected.some(entry => entry.reason === 'bank-capacity-insufficient'));
});

test('already held intermediate quantities are skipped without skipping the final Completion work', () => {
  const f = fixture(); f.hold('Ore', 2); f.graph.nodes = [node(f.a, ['ore']), node('ore')];
  f.estimates = [estimate('ore', { completionGain: 0 }), estimate(f.a)];
  f.model.steps = [production('ore', [demand('Ore')], ['mine']), production(f.a, [demand('A')], ['craft'])];
  f.model.recipes = [recipe('mine', 'Ore'), recipe('craft', 'A', 1, [demand('Ore')])];
  f.model.recipeActions = [action('mine'), action('craft')];
  const result = run(f); assert.deepEqual(result.selected.steps.map(step => step.routeId), ['craft']);
  assert.equal(result.nextTask.requirements.items[0].quantity, 1);
});

test('neutral Completion work remains ordered and unverified resource effects are refused', () => {
  const f = fixture(); const end = { type: 'completion', scopeId: 'base', category: 'items', id: 'A' };
  f.model.steps[0] = { stepId: stepId(f.a), type: 'neutral', evidence: 'confirmed', resourceNeutral: true,
    task: { action: { id: 'Analyze', selectionIds: [] }, endConditions: [end],
      requirements: { items: [], currencies: [], outputIds: [], outputsEvidence: 'confirmed' } } };
  f.estimates[0].consumptionCost = 0; const result = run(f); assert.equal(result.selected.candidateId, f.a);
  assert.equal(result.nextTask.action.id, 'Analyze'); assert.equal(result.selected.resourceProjection, null);
  f.model.steps[0].resourceNeutral = false;
  assert.equal(blocker(run(f), f.a).reason, 'neutral-effects-unverified');
});

test('missing graph/recipe/action bindings and mismatched final goals do not silently execute', () => {
  for (const change of [f => { f.model.steps.shift(); }, f => { f.model.steps[0].demands = [demand('Unrelated')]; },
    f => { f.model.steps[0].allowedRecipeIds = ['not-in-catalog']; }, f => { f.model.recipeActions[0].evidence = 'unknown'; },
    f => { f.estimates[0].completionGain = NaN; }, f => { f.model.steps[0].type = 'unknown'; }]) {
    const f = fixture(); change(f); const result = run(f);
    assert.equal(result.selected.candidateId, f.b); assert.ok(blocker(result, f.a));
  }
});

test('an unusable recipe action permits a slower confirmed alternate recipe', () => {
  const f = fixture(); f.model.recipeActions[0].evidence = 'unknown';
  f.model.recipes.push(recipe('alternate', 'A', 1, [], { durationMs: 2000 })); f.model.recipeActions.push(action('alternate'));
  f.model.steps[0].allowedRecipeIds.push('alternate'); f.estimates[0].unlockValue = 10;
  const result = run(f); assert.equal(result.selected.candidateId, f.a); assert.equal(result.nextStep.routeId, 'alternate');
});

test('quantity grand total exhaustion discards a previously compiled candidate', () => {
  const f = fixture(); const result = run(f, { maxTotalQuantityExpansions: 2 });
  assert.equal(result.reason, 'quantity-batch-expansion-limit'); assert.equal(result.selected, null);
  assert.deepEqual(result.evaluations, []); assert.equal(result.quantityExpansions, 2);
});

test('local quantity exhaustion and compiled-step limits can fall back to another candidate', () => {
  const f = fixture(); f.model.recipes[0].itemCosts = [demand('Ore')];
  f.model.recipes.push(recipe('mine', 'Ore')); f.model.recipeActions.push(action('mine'));
  f.model.steps[0].allowedRecipeIds.push('mine');
  assert.equal(run(f, { quantityLimits: { maxExpansions: 2 }, maxTotalQuantityExpansions: 10 }).selected.candidateId, f.b);
  const result = run(f, { maxCompiledSteps: 1 }); assert.equal(result.selected.candidateId, f.b);
  assert.equal(blocker(result, f.a).reason, 'compiled-step-limit');
});

test('operation identity and continuation timers are stable when remaining batches shrink', () => {
  const f = fixture(); f.estimates[0].unlockValue = 100;
  const first = run(f, { nowMs: 0 }); f.hold('A', 1);
  const next = run(f, { nowMs: 1000, current: first.nextCurrent });
  assert.equal(next.status, 'continue'); assert.equal(next.nextStep.id, first.nextStep.id);
  assert.equal(next.nextCurrent.startedAtMs, 0); assert.equal(next.selected.metrics.durationMs, 2000);
  assert.equal(next.nextTask.id, first.nextTask.id);
});

test('epochs change execution task IDs without hiding monitor criterion conflicts', () => {
  const f = fixture(); const first = run(f, { planEpoch: 1 }); const next = run(f, { planEpoch: 2 });
  assert.equal(first.nextStep.id, next.nextStep.id); assert.notEqual(first.nextTask.id, next.nextTask.id);
  f.game.activeAction = { id: 'melvorF:Woodcutting', isActive: true, activeSkills: [] };
  const observation = { resources: f.resources(), completionSnapshot: f.snapshot,
    actionSelection: { supported: true, actionId: 'melvorF:Woodcutting', selectionIds: ['make-b'] } };
  const watched = monitorTask(first.nextTask, observation, null, { nowMs: 0, sessionId: 'session' });
  assert.equal(watched.status, 'continue');
  assert.equal(monitorTask(next.nextTask, observation, watched.checkpoint, { nowMs: 1, sessionId: 'session' }).reason, 'task-checkpoint-conflict');
});

test('generated fixed-cost monitor considers the bank slot released by the next operation', () => {
  const f = fixture(); f.hold('Ore', 1); f.game.bank.maximumSlots = 1;
  f.model.steps[0].demands = [demand('A')]; f.model.recipes[0].itemCosts = [demand('Ore')]; f.estimates[0].unlockValue = 10;
  const result = run(f); assert.equal(result.selected.candidateId, f.a);
  f.game.activeAction = { id: 'melvorF:Woodcutting', isActive: true, activeSkills: [] };
  const observation = { resources: f.resources(), completionSnapshot: f.snapshot,
    actionSelection: { supported: true, actionId: 'melvorF:Woodcutting', selectionIds: ['make-a'] } };
  assert.equal(monitorTask(result.nextTask, observation, null, { nowMs: 0, sessionId: 'session' }).status, 'continue');
  const conservative = structuredClone(result.nextTask); delete conservative.requirements.bankOrder; delete conservative.requirements.costEvidence;
  assert.equal(monitorTask(conservative, observation, null, { nowMs: 0, sessionId: 'session' }).reason, 'bank-capacity-insufficient');
});

test('root monitoring requires actual Completion as well as produced inventory', () => {
  const f = fixture(); const result = run(f);
  f.hold('B', 1); f.game.activeAction = { id: 'melvorF:Woodcutting', isActive: true, activeSkills: [] };
  const observation = () => ({ resources: f.resources(), completionSnapshot: f.snapshot,
    actionSelection: { supported: true, actionId: 'melvorF:Woodcutting', selectionIds: ['make-b'] } });
  assert.equal(monitorTask(result.nextTask, observation(), null, { nowMs: 0, sessionId: 'session' }).status, 'continue');
  const category = f.snapshot.completion.scopes[0].categories.items;
  category.entries.find(entry => entry.id === 'B').current = 1;
  category.missing = category.entries.filter(entry => entry.current < entry.maximum).map(entry => ({ ...entry }));
  category.current = 1; category.percent = 50;
  assert.equal(monitorTask(result.nextTask, observation(), null, { nowMs: 1, sessionId: 'session' }).status, 'complete');
});

test('Completion to quantified recipe to monitor to owned woodcutting stop is integrated without game APIs', async () => {
  const f = fixture(); const plan = run(f); const task = plan.nextTask;
  const wc = { supported: true, skillId: task.action.id, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
    trees: [{ id: 'make-b', unlocked: true, outputIds: ['B'], outputsEvidence: 'confirmed' }] };
  let stops = 0;
  const executor = createWoodcuttingExecutorForTesting({ observe: () => ({ resources: f.resources(), woodcutting: wc }),
    selectTree: id => { wc.activeTreeIds = [id]; wc.isActive = true;
      f.game.activeAction = { id: task.action.id, isActive: true, activeSkills: [] }; },
    stop: () => { stops++; wc.isActive = false; wc.activeTreeIds = []; f.game.activeAction = undefined; return true; } });
  executor.start({ version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true });
  assert.equal((await executor.execute({ id: task.id, kind: 'woodcutting-start', treeId: task.action.selectionIds[0] })).status, 'verified');
  const observation = () => ({ resources: f.resources(), completionSnapshot: f.snapshot,
    actionSelection: { supported: true, actionId: task.action.id, selectionIds: [...wc.activeTreeIds] } });
  const first = monitorTask(task, observation(), null, { nowMs: 0, sessionId: 'session' });
  f.hold('B', 1); const category = f.snapshot.completion.scopes[0].categories.items;
  category.entries[1].current = 1; category.current = 1; category.percent = 50; category.missing = [structuredClone(category.entries[0])];
  const finished = monitorTask(task, observation(), first.checkpoint, { nowMs: 1000, sessionId: 'session' });
  assert.equal(finished.status, 'complete'); assert.equal((await executor.stop()).cleanup, 'stopped-verified');
  assert.equal(stops, 1);
});

test('invalid settings, duplicates, mode conflicts and malformed prepared data fail closed', () => {
  const f = fixture();
  for (const options of [{ monitorBounds: null }, { monitorBounds: { unknown: 1 } }, { monitorBounds: { stagnationMs: 0 } },
    { planEpoch: -1 }, { maxTotalQuantityExpansions: Infinity }, { quantityLimits: null }, { unknown: 1 }])
    assert.equal(run(f, options).status, 'blocked');
  for (const key of ['steps', 'recipes', 'recipeActions']) {
    const g = fixture(); g.model[key].push(g.model[key][0]); assert.equal(run(g).reason, 'quantified-model-invalid-or-duplicate');
  }
  f.snapshot.mode.id = 'Other'; assert.equal(run(f).reason, 'snapshot-mode-conflict');
  assert.equal(selectPreparedCompletionPlans([{ plan: {} }], [], 0, { nowMs: 0 }).reason, 'prepared-plans-invalid');
});

test('input ordering, frozen facts and detached selection/monitor/projections remain deterministic', () => {
  const f = fixture(); const first = run(f);
  f.graph.nodes.reverse(); f.model.steps.reverse(); f.model.recipes.reverse(); f.model.recipeActions.reverse(); f.estimates.reverse();
  assert.deepEqual(run(f), first);
  const resources = f.resources(); function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(f.snapshot); freeze(f.graph); freeze(f.estimates); freeze(f.model); freeze(resources);
  const result = selectQuantifiedCompletionPlan(f.snapshot, f.graph, f.estimates, resources, f.model, { nowMs: 100_000 });
  assert.deepEqual(result, first); result.nextTask.endConditions[0].id = 'Changed';
  result.selected.resourceProjection.items[0].quantity = 999;
  assert.equal(result.evaluations[0].resourceProjection.items[0].quantity, 1);
  assert.equal(f.model.steps.find(binding => binding.stepId === stepId(f.b)).demands[0].id, 'B');
});

test('runtime snapshots and unreadable binding exceptions cannot activate real adapters or expose secrets', () => {
  const f = fixture(); const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  assert.equal(selectQuantifiedCompletionPlan(readSnapshot(forbidden), f.graph, f.estimates, f.resources(), f.model, { nowMs: 0 }).status, 'blocked');
  Object.defineProperty(f.model, 'steps', { get() { throw new Error('private-save-secret'); } });
  const result = run(f); assert.equal(result.reason, 'quantified-input-unreadable');
  assert.ok(!JSON.stringify(result).includes('private-save-secret'));
});

test('long generated task IDs remain valid across compiler, monitor and mock executor', async () => {
  const f = fixture(); const itemId = 'A'.repeat(1000); const category = f.snapshot.completion.scopes[0].categories.items;
  category.entries[0].id = itemId; category.missing[0].id = itemId;
  const candidateId = generateCompletionCandidates(f.snapshot).candidates.find(candidate => candidate.targetId === itemId).id;
  f.graph.nodes[0].id = candidateId; f.estimates[0] = estimate(candidateId, { unlockValue: 10 });
  f.model.steps[0].stepId = stepId(candidateId); f.model.steps[0].demands[0].id = itemId;
  f.model.recipes[0].outputs[0].id = itemId; f.model.recipes[0].possibleOutputIds = [itemId];
  const result = run(f); assert.equal(result.selected.candidateId, candidateId); assert.ok(result.nextTask.id.length > 1024);
  const wc = { supported: true, skillId: result.nextTask.action.id, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
    trees: [{ id: 'make-a', unlocked: true, outputIds: [itemId], outputsEvidence: 'confirmed' }] };
  const executor = createWoodcuttingExecutorForTesting({ observe: () => ({ resources: f.resources(), woodcutting: wc }),
    selectTree: id => { wc.isActive = true; wc.activeTreeIds = [id]; f.game.activeAction = { id: wc.skillId, isActive: true, activeSkills: [] }; },
    stop: () => { wc.isActive = false; wc.activeTreeIds = []; f.game.activeAction = undefined; return true; } });
  executor.start({ version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true });
  assert.equal((await executor.execute({ id: result.nextTask.id, kind: 'woodcutting-start', treeId: 'make-a' })).status, 'verified');
  const observed = monitorTask(result.nextTask, { resources: f.resources(), completionSnapshot: f.snapshot,
    actionSelection: { supported: true, actionId: wc.skillId, selectionIds: ['make-a'] } }, null, { nowMs: 0, sessionId: 'session' });
  assert.equal(observed.status, 'continue'); assert.equal((await executor.stop()).cleanup, 'stopped-verified');
});

test('bounded stages propagate upper bank occupancy and generate a bounded monitor task', () => {
  const f = fixture(); f.graph.nodes = [node(f.a, ['ore']), node('ore')]; f.game.bank.maximumSlots = 1;
  f.estimates = [estimate('ore', { completionGain: 0 }), estimate(f.a)];
  f.model.steps = [production('ore', [demand('Ore')], ['mine']), production(f.a, [demand('A')], ['craft'])];
  f.model.recipes = [recipe('mine', 'Ore', 1, [], { costEvidence: 'bounded', rangeEvidence: 'confirmed',
    minimumItemCosts: [], minimumCurrencyCosts: [], maximumOutputs: [demand('Ore', 2)], minimumDurationMs: 500 }),
    recipe('craft', 'A', 1, [demand('Ore')])];
  f.model.recipeActions = [action('mine'), action('craft')];
  const tooSmall = run(f); assert.equal(tooSmall.status, 'blocked');
  assert.ok(blocker(tooSmall, f.a).rejected.some(entry => entry.reason === 'bank-capacity-insufficient'));
  f.game.bank.maximumSlots = 2; const accepted = run(f); assert.equal(accepted.selected.candidateId, f.a);
  assert.equal(accepted.nextTask.requirements.costEvidence, 'bounded');
  assert.deepEqual(accepted.selected.resourceProjection.upperItems, [demand('A'), demand('Ore')]);
});
