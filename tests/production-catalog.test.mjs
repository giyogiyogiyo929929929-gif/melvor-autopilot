import test from 'node:test';
import assert from 'node:assert/strict';
import { readProductionCatalog, readProductionCatalogForTesting } from '../src/production-catalog.mjs';
import { planResourceDemand } from '../src/quantities.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
import { buildProductionPrerequisiteGraph } from '../src/production-prerequisites.mjs';

const object = (name, namespace = 'melvorD', extra = {}) => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
function fixture() {
  const log = object('Logs'), ore = object('Ore'), bar = object('Bar'), gp = object('GP');
  const tree = { ...object('NormalTree'), product: log, level: 1, abyssalLevel: 0, baseExperience: 10,
    baseAbyssalExperience: 0, baseInterval: 3000, requirements: [], randomProducts: [object('Gem')] };
  const smithRecipe = { ...object('BronzeBar'), product: bar, level: 1, abyssalLevel: 0, baseExperience: 5,
    baseAbyssalExperience: 0, baseQuantity: 1, itemCosts: [{ item: ore, quantity: 3 }], currencyCosts: [{ currency: gp, quantity: 2 }] };
  const context = { version: 'v1.3.1', observationId: 'artificial-frame-1', skills: ['woodcutting', 'smithing'], ownership: { base: true, toth: false, aod: false, ita: false } };
  const game = { currentGamemode: { id: 'melvorD:Standard', isPermaDeath: false }, isGolbinRaid: false,
    woodcutting: { ...object('Woodcutting'), isUnlocked: true, level: 5, abyssalLevel: 0, rareDrops: [], actions: { allObjects: [tree] },
      defaultRandomProducts: [object('BirdNest')], randomProducts: new Map([[object('Gem'), {}]]), randomJewelry: [object('Ring')],
      isTreeUnlocked: () => true, getTreeInterval: () => 2500, getTreeMultiplier: () => 1.25, getDoublingChance: () => 15 },
    smithing: { ...object('Smithing'), isUnlocked: true, level: 5, abyssalLevel: 0, rareDrops: [], actions: { allObjects: [smithRecipe] },
      baseInterval: 2000, isMasteryActionUnlocked: () => true, modifyInterval: () => 1500,
      getRecipeCosts: recipe => ({ getItemQuantityArray: () => [{ item: recipe.itemCosts[0].item, quantity: 2 }],
        getCurrencyQuantityArray: () => [{ currency: gp, quantity: 1.5 }] }),
      getPreservationChance: () => 20, getDoublingChance: () => 10 } };
  return { game, context, tree, smithRecipe };
}
const read = f => readProductionCatalogForTesting(f.game, f.context);
const skill = (result, kind) => result.skills.find(skill => skill.kind === kind);
const entry = (result, kind) => skill(result, kind).entries.find(entry => entry.status === 'observed');

test('detached production adapter data feeds item procurement structure without API reentry', () => {
  const f = fixture(), catalog = read(f), target = { id: 'melvorD:Bar', current: 0, maximum: 1, accessible: null };
  const completion = { version: 'v1.3.1', mode: { id: 'melvorD:Standard', hardcore: false }, completion: { scopes: [
    { id: 'base', ownership: true, categories: { items: { supported: true, status: 'observed', current: 0, maximum: 1, percent: 0, entries: [target], missing: [{ ...target }] } } },
    ...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false }))] } };
  const result = buildProductionPrerequisiteGraph(completion, catalog); assert.equal(result.supported, true);
  assert.equal(result.graph.nodes.filter(value => value.type === 'recipe-variant').length, 1);
  assert.ok(result.graph.nodes.some(value => value.type === 'item-supply' && value.itemId === 'melvorD:Ore'));
  assert.equal(result.inventoryProjection, null); assert.equal(result.runnable, false);
});

test('observes woodcutting and smithing without equating nominal data with fixed effects', () => {
  const result = read(fixture()); assert.equal(result.status, 'observed'); assert.equal(result.supported, true);
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false);
  const wood = entry(result, 'woodcutting').data;
  assert.equal(wood.nominal.baseQuantity, null); assert.equal(wood.nominal.baseIntervalMs, 3000);
  assert.equal(wood.observed.intervalMs, 2500); assert.equal(wood.observed.treeMultiplier, 1.25);
  assert.equal(wood.observed.preservationPercent, null); assert.equal(wood.outputCoverage, 'partial');
  assert.deepEqual(wood.observedOutputIds, ['melvorD:BirdNest', 'melvorD:Gem', 'melvorD:Logs', 'melvorD:Ring']);
  const smith = entry(result, 'smithing').data;
  assert.deepEqual(smith.nominal.itemCosts, [{ id: 'melvorD:Ore', quantity: 3 }]);
  assert.deepEqual(smith.observed.itemCosts, [{ id: 'melvorD:Ore', quantity: 2 }]);
  assert.deepEqual(smith.observed.currencyCosts, [{ id: 'melvorD:GP', amount: 1.5 }]);
  assert.equal(smith.observed.preservationPercent, 20);
});

test('runtime and unknown-version/context gates do not read game getters', () => {
  const game = new Proxy({}, { get() { throw new Error('must not read'); } });
  assert.equal(readProductionCatalog(game, { enabled: true }).reason, 'runtime-catalog-adapter-unverified');
  assert.equal(readProductionCatalogForTesting(game, { version: 'v1.4' }).reason, 'version-unverified');
  assert.equal(readProductionCatalogForTesting(game, { version: 'v1.3.1', observationId: 'x', ownership: { base: false } }).reason, 'catalog-context-unverified');
  assert.equal(readProductionCatalogForTesting(game, { version: 'v1.3.1', ownership: { base: true } }).reason, 'catalog-context-unverified');
});

test('unknown mode and Raid block observation before either skill is touched', () => {
  const f = fixture(); Object.defineProperty(f.game, 'woodcutting', { get() { throw new Error('must not read'); } });
  f.game.isGolbinRaid = true; assert.equal(read(f).reason, 'raid-catalog-unverified');
  f.game.isGolbinRaid = null; assert.equal(read(f).reason, 'catalog-mode-or-context-invalid');
  f.game.isGolbinRaid = false; f.game.currentGamemode.isPermaDeath = null;
  assert.equal(read(f).reason, 'catalog-mode-or-context-invalid');
});

test('unowned, modded and ownership-unknown actions never read their product or quantities', () => {
  for (const [namespace, owned, expected] of [['melvorItA', false, 'excluded'], ['melvorItA', null, 'blocked'], ['myMod', true, 'excluded']]) {
    const f = fixture(); const action = { ...object('Excluded', namespace), isModded: namespace === 'myMod' };
    Object.defineProperty(action, 'product', { get() { throw new Error('must not read'); } });
    f.game.woodcutting.actions.allObjects.push(action); f.context.ownership.ita = owned;
    const result = read(f); const excluded = skill(result, 'woodcutting').entries.find(entry => entry.actionId === action.id);
    assert.equal(excluded.status, expected); assert.equal(excluded.data, null); assert.equal(entry(result, 'woodcutting').data.productId, 'melvorD:Logs');
  }
});

test('owned DLC recipes retain their own scope and abyssal level requirements', () => {
  const f = fixture(); const dlc = { ...f.tree, ...object('AbyssalTree', 'melvorItA'), abyssalLevel: 5, baseAbyssalExperience: 15 };
  f.game.woodcutting.actions.allObjects.push(dlc); f.context.ownership.ita = true;
  const observed = skill(read(f), 'woodcutting').entries.find(entry => entry.actionId === dlc.id);
  assert.equal(observed.scopeId, 'ita'); assert.equal(observed.data.requiredAbyssalLevel, 5);
});

test('locked skills/actions and extra tree requirements remain explicit', () => {
  const f = fixture(); f.game.woodcutting.isUnlocked = false; f.game.woodcutting.isTreeUnlocked = () => false;
  f.tree.requirements = [{ unrelated: 'not copied' }]; const result = read(f);
  assert.equal(entry(result, 'woodcutting').data.additionalRequirementCount, 1);
  assert.equal(result.plannerDrafts.find(draft => draft.id.includes('NormalTree')).unlocked, false);
  assert.ok(!JSON.stringify(result).includes('not copied'));
});

test('zero preservation and doubling still cannot turn a draft into a guaranteed recipe', () => {
  const f = fixture(); f.game.smithing.getPreservationChance = () => 0; f.game.smithing.getDoublingChance = () => 0;
  const result = read(f); const draft = result.plannerDrafts.find(recipe => recipe.id.includes('BronzeBar'));
  assert.equal(draft.evidence, 'unknown'); assert.equal(draft.costEvidence, 'unknown'); assert.equal(draft.outputs[0].quantity, null);
  assert.equal(draft.possibleOutputIds, null); assert.equal(result.planningReady, false);
});

test('recipe getter exceptions are isolated and do not leak exception content', () => {
  const f = fixture(); const bad = { ...f.tree, ...object('BadTree') };
  Object.defineProperty(bad, 'baseExperience', { get() { throw new Error('private-save-token'); } });
  f.game.woodcutting.actions.allObjects.push(bad); const result = read(f);
  assert.equal(result.status, 'blocked'); assert.equal(skill(result, 'smithing').supported, true);
  assert.equal(entry(result, 'woodcutting').data.productId, 'melvorD:Logs');
  assert.equal(skill(result, 'woodcutting').entries.find(entry => entry.actionId === bad.id).reason, 'recipe-api-invalid');
  assert.ok(!JSON.stringify(result).includes('private-save-token'));
});

test('skill API failure preserves the other skill and duplicate registries discard ambiguous entries', () => {
  const f = fixture(); f.game.woodcutting.getTreeInterval = null;
  assert.equal(skill(read(f), 'smithing').supported, true);
  f.game.woodcutting.actions.allObjects.push(f.tree); const result = read(f);
  assert.equal(skill(result, 'woodcutting').reason, 'action-registry-duplicate');
  assert.deepEqual(skill(result, 'woodcutting').entries, []);
});

test('empty, missing, non-array and excessive registries remain unavailable', () => {
  for (const source of [[], null, {}, Array(1025).fill({})]) {
    const f = fixture(); f.game.woodcutting.actions.allObjects = source;
    assert.equal(skill(read(f), 'woodcutting').supported, false);
  }
  const f = fixture(); delete f.game.smithing;
  assert.equal(skill(read(f), 'smithing').reason, 'skill-api-invalid');
});

test('unknown namespaces, namespace mismatches and malformed scalar fields are rejected', () => {
  for (const alter of [f => { f.tree.id = 'different:NormalTree'; }, f => { f.tree.namespace = 'unknown'; },
    f => { f.tree.isModded = null; }, f => { f.tree.baseExperience = NaN; }, f => { f.tree.level = '1'; },
    f => { f.game.woodcutting.isTreeUnlocked = () => null; }, f => { f.game.woodcutting.getTreeInterval = () => 0; },
    f => { f.game.woodcutting.getTreeMultiplier = () => Infinity; }]) {
    const f = fixture(); alter(f); assert.equal(skill(read(f), 'woodcutting').supported, false);
  }
});

test('effective cost shape, numeric ranges and duplicate IDs are validated', () => {
  for (const quantity of [null, undefined, NaN, Infinity, -1, '1', 0.5]) {
    const f = fixture(); f.game.smithing.getRecipeCosts = () => ({ getItemQuantityArray: () => [{ item: object('Ore'), quantity }],
      getCurrencyQuantityArray: () => [] });
    assert.equal(skill(read(f), 'smithing').supported, false);
  }
  const f = fixture(); f.smithRecipe.currencyCosts.push(f.smithRecipe.currencyCosts[0]);
  assert.equal(skill(read(f), 'smithing').supported, false);
});

test('invalid preservation/doubling percentages are not clamped or assumed zero', () => {
  for (const value of [null, undefined, NaN, -1, 101, '0']) {
    const f = fixture(); f.game.smithing.getPreservationChance = () => value;
    assert.equal(skill(read(f), 'smithing').supported, false);
    const g = fixture(); g.game.woodcutting.getDoublingChance = () => value;
    assert.equal(skill(read(g), 'woodcutting').supported, false);
  }
});

test('static output and ingredient collection bounds are enforced', () => {
  for (const alter of [f => { f.game.woodcutting.defaultRandomProducts = Array(513).fill(object('A')); },
    f => { f.game.woodcutting.randomProducts = null; }, f => { f.game.woodcutting.rareDrops = Array(129).fill({}); },
    f => { f.tree.requirements = Array(129).fill({}); }]) {
    const f = fixture(); alter(f); assert.equal(skill(read(f), 'woodcutting').supported, false);
  }
  const f = fixture(); f.smithRecipe.itemCosts = Array(129).fill({});
  assert.equal(skill(read(f), 'smithing').supported, false);
});

test('unsafe reward/random/selection/create/consume helpers are never called or read', () => {
  const f = fixture(); const fail = { get() { throw new Error('unsafe helper touched'); } };
  for (const value of [f.game.woodcutting, f.game.smithing]) Object.defineProperties(value, {
    actionRewards: fail, selectedRecipe: fail, modifyPrimaryProductQuantity: fail, getRandomFlatBasePrimaryProductQuantity: fail,
    selectTree: fail, selectRecipeOnClick: fail, createButtonOnClick: fail, encode: fail, setXP: fail
  });
  Object.defineProperties(f.game, { characterName: fail, cloudManager: fail });
  assert.equal(read(f).supported, true);
});

test('catalog drafts are actually refused by the quantity planner rather than masquerading as fixed effects', () => {
  const f = fixture(); const catalog = read(f);
  const resources = readResourcesForTesting({ currentGamemode: f.game.currentGamemode, isGolbinRaid: false,
    bank: { items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 10 },
    currencies: { allObjects: [{ id: 'GP', amount: 100 }] }, combat: { player: { selectedEquipmentSet: 0,
      equipmentSets: [{ equipment: { equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } },
    isPaused: false, activeAction: undefined, pausedAction: undefined }, { version: 'v1.3.1' });
  const plan = planResourceDemand(resources, [{ id: 'melvorD:Bar', quantity: 1 }], catalog.plannerDrafts, f.context);
  assert.equal(plan.status, 'blocked'); assert.equal(plan.projection, null);
  assert.ok(plan.rejected.some(rejection => rejection.reason === 'recipe-effects-unverified'));
});

test('registry and cost/output order do not change detached catalog observations', () => {
  const f = fixture(); const first = read(f);
  f.game.woodcutting.randomJewelry.reverse(); f.tree.randomProducts.reverse();
  assert.deepEqual(read(f), first);
  const secondTree = { ...f.tree, ...object('OakTree') }; f.game.woodcutting.actions.allObjects.push(secondTree);
  const two = read(f); f.game.woodcutting.actions.allObjects.reverse(); assert.deepEqual(read(f), two);
});

test('frozen fixtures remain unchanged and catalog/drafts share no mutable references', () => {
  const f = fixture(); const before = JSON.stringify(f.game);
  function freeze(value) {
    if (value && typeof value === 'object') {
      if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
      else Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(f.game); freeze(f.context); const result = read(f); assert.equal(result.supported, true);
  assert.deepEqual(read(f), result); assert.equal(JSON.stringify(f.game), before);
  const smith = entry(result, 'smithing');
  result.plannerDrafts.find(draft => draft.id === smith.catalogId).itemCosts[0].quantity = 999;
  assert.equal(smith.data.observed.itemCosts[0].quantity, 2);
  smith.data.nominal.itemCosts[0].quantity = 999;
  assert.equal(f.smithRecipe.itemCosts[0].quantity, 3);
});
