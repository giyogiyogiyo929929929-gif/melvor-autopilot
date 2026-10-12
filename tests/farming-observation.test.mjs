import test from 'node:test';
import assert from 'node:assert/strict';
import { readFarmingSnapshot, readFarmingForTesting } from '../src/farming-observation.mjs';
const object = (name, extra = {}, namespace = 'melvorD') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
function fixture() {
  const category = object('Allotment', { returnSeeds: true, scaleXPWithQuantity: true, harvestMultiplier: 1.5, masteryXPDivider: 2, giveXPOnPlant: false });
  const seed = object('Seed'), product = object('Crop'), gp = object('GP');
  const recipe = object('CropRecipe', { category, product, seedCost: { item: seed, quantity: 3 }, baseInterval: 600,
    baseQuantity: 5, level: 1, abyssalLevel: 0, baseExperience: 10, baseAbyssalExperience: 0 });
  const compost = object('Compost', { compostValue: 20, harvestBonus: 15, disableSeedRefund: false, compostAllCost: { currency: gp, quantity: 0.5 } });
  const plots = Array.from({ length: 5 }, (_, state) => object(`Plot${state}`, { category, state, level: state + 1, abyssalLevel: 0,
    itemCosts: [{ item: object('UnlockItem'), quantity: 2 }], currencyCosts: [{ currency: gp, quantity: 10 }],
    selectedRecipe: recipe, plantedRecipe: state >= 2 ? recipe : undefined, compostItem: state === 2 ? compost : undefined,
    compostLevel: state === 2 ? 50 : 0, growthTime: state >= 2 ? 450 : 0 }));
  const timer = { plots: [plots[2]] }, farming = object('Farming', { isUnlocked: true, level: 50, abyssalLevel: 2,
    categories: { allObjects: [category] }, actions: { allObjects: [recipe] }, plots: { allObjects: plots }, composts: { allObjects: [compost] },
    growthTimers: new Set([timer]), growthTimerMap: new Map([[plots[2], timer]]),
    isMasteryActionUnlocked: () => true, getRecipeSeedCost: () => 2, getRecipeInterval: () => 450,
    getPlotGrowthChance: () => 95, getPlotGrowthTime: () => 425,
    canUnlockPlot: () => false, getPlotUnlockCosts: () => ({ getItemQuantityArray: () => [{ item: object('UnlockItem'), quantity: 1 }],
      getCurrencyQuantityArray: () => [{ currency: gp, quantity: 7.5 }] }) });
  return { game: { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, farming }, category, recipe, compost, plots, timer, farming,
    context: { version: 'v1.3.1', observationId: 'synthetic-farming', ownership: { base: true, toth: false, aod: false, ita: false } } };
}
const read = f => readFarmingForTesting(f.game, f.context);
const records = (result, section) => result.sections[section].records;
const data = (result, section, index = 0) => records(result, section)[index].data;
test('all plot states, categories, recipes, costs and compost are detached observations', () => {
  const result = read(fixture()); assert.equal(result.supported, true); assert.equal(result.origin, 'mock-only');
  assert.deepEqual(records(result, 'plots').map(record => record.data.state), ['locked', 'empty', 'growing', 'grown', 'dead']);
  assert.equal(data(result, 'categories').harvestMultiplier, 1.5); assert.equal(data(result, 'categories').returnSeeds, true);
  const recipe = data(result, 'recipes'); assert.equal(recipe.nominal.seed.quantity, 3); assert.equal(recipe.observed.seedCost, 2);
  assert.equal(recipe.nominal.baseIntervalRaw, 600); assert.equal(recipe.observed.intervalRaw, 450); assert.equal(recipe.intervalUnitEvidence, 'unknown');
  assert.equal(data(result, 'composts').nominalApplyAllCost.amount, 0.5); assert.equal(data(result, 'plots', 2).compostLevel, 50);
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false);
});
test('selected recipe on an empty plot is not a planted or harvestable crop', () => {
  const value = data(read(fixture()), 'plots', 1); assert.equal(value.selectedRecipeId, 'melvorD:CropRecipe'); assert.equal(value.plantedRecipeId, null);
  assert.equal(value.state, 'empty'); assert.equal(value.guaranteedHarvest, null);
});
test('declared seconds, raw helper time and remaining duration are not silently converted', () => {
  const result = read(fixture()), plot = data(result, 'plots', 2); assert.equal(plot.growthTimeSeconds, 450);
  assert.equal(plot.observed.growthTimeRaw, 425); assert.equal(plot.remainingTimeMs, null); assert.equal(plot.helperTimeUnitEvidence, 'unknown');
  assert.equal(result.sections.timers.timeProjection, null); assert.equal(result.harvestProjection, null);
});
test('unlock helpers run only for locked plots and growth helpers only for growing plots', () => {
  const f = fixture(), calls = [];
  f.farming.canUnlockPlot = plot => { calls.push(`unlock:${plot.state}`); return false; };
  f.farming.getPlotGrowthChance = plot => { calls.push(`chance:${plot.state}`); return 95; };
  f.farming.getPlotGrowthTime = plot => { calls.push(`time:${plot.state}`); return 425; };
  const result = read(f); assert.deepEqual(calls, ['unlock:0', 'chance:2', 'time:2']);
  const locked = data(result, 'plots'); assert.equal(locked.nominalUnlockItems[0].quantity, 2); assert.equal(locked.observed.effectiveUnlockItems[0].quantity, 1);
  assert.equal(locked.nominalUnlockCurrencies[0].amount, 10); assert.equal(locked.observed.effectiveUnlockCurrencies[0].amount, 7.5);
  assert.equal(locked.observed.canUnlock, false); assert.equal(data(result, 'plots', 1).observed.canUnlock, null);
});
test('multiple parallel plots and timers retain membership without inspecting timer clocks', () => {
  const f = fixture(), extra = { ...f.plots[2], ...object('OtherGrowing') }, second = { plots: [extra] };
  f.farming.plots.allObjects.push(extra); f.farming.growthTimers.add(second); f.farming.growthTimerMap.set(extra, second);
  for (const timer of [f.timer, second]) for (const property of ['ticksLeft', 'isActive', 'interval', 'maxTicks']) Object.defineProperty(timer, property, { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.sections.timers.records.length, 2); assert.equal(result.sections.timers.membershipEdges, 2);
});
test('unknown version, context, mode and Raid never access farming', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('SECRET'); } }), f = fixture();
  assert.equal(readFarmingSnapshot(forbidden, { enabled: true }).reason, 'runtime-farming-adapter-unverified');
  assert.equal(readFarmingForTesting(forbidden, { ...f.context, version: 'v2' }).reason, 'version-unverified');
  for (const patch of [{ observationId: null }, { ownership: { base: false } }, { maximumBytes: 100 }, { maximumBytes: NaN }, { maximumBytes: null }])
    assert.equal(readFarmingForTesting(forbidden, { ...f.context, ...patch }).reason, 'farming-context-unverified');
  Object.defineProperty(f.game, 'farming', { get() { throw new Error('must not read'); } }); f.game.isGolbinRaid = true;
  assert.equal(read(f).reason, 'raid-farming-unverified'); f.game.isGolbinRaid = null;
  assert.equal(read(f).reason, 'farming-mode-or-skill-invalid');
});
test('unowned and modded registry members are excluded before content getters', () => {
  for (const [section, property] of [['categories', 'harvestMultiplier'], ['actions', 'product'], ['plots', 'state'], ['composts', 'compostValue']]) {
    const f = fixture(), excluded = object('Excluded', {}, 'melvorItA'), modded = object('Modded', {}, 'myMod'); modded.isModded = true;
    for (const value of [excluded, modded]) Object.defineProperty(value, property, { get() { throw new Error('PRIVATE'); } });
    f.farming[section].allObjects.push(excluded, modded); const result = read(f), sectionName = section === 'actions' ? 'recipes' : section;
    assert.equal(records(result, sectionName).filter(value => value.status === 'excluded').length, 2); assert.equal(result.supported, true);
  }
});
test('unknown DLC ownership blocks only its records, while owned DLC plots are observed', () => {
  const f = fixture(), plot = { ...f.plots[1], ...object('DLCplot', {}, 'melvorItA') }; f.farming.plots.allObjects.push(plot);
  f.context.ownership.ita = null; assert.equal(records(read(f), 'plots').find(value => value.id === plot.id).reason, 'scope-ownership-unverified');
  f.context.ownership.ita = true; const entry = records(read(f), 'plots').find(value => value.id === plot.id); assert.equal(entry.scopeId, 'ita'); assert.equal(entry.status, 'observed');
});
test('excluded timer plots retain membership checks without reading unowned plot state', () => {
  const f = fixture(), excluded = object('DLCplot', {}, 'melvorItA'), timer = { plots: [excluded] };
  Object.defineProperty(excluded, 'state', { get() { throw new Error('must not read'); } });
  f.farming.plots.allObjects.push(excluded); f.farming.growthTimers.add(timer); f.farming.growthTimerMap.set(excluded, timer);
  const result = read(f); assert.equal(result.supported, true); assert.ok(result.sections.timers.records.some(value => value.status === 'excluded'));
  f.farming.growthTimerMap.set(excluded, f.timer); assert.equal(read(f).sections.timers.supported, false);
});
test('unverified plot data cannot imply that an empty timer registry is a complete observation', () => {
  const f = fixture(); f.farming.growthTimers.clear(); f.farming.growthTimerMap.clear(); f.plots[2].state = 999;
  const result = read(f); assert.equal(result.sections.plots.supported, false); assert.equal(result.sections.timers.supported, false);
});
test('unknown enum, incompatible planted state and invalid recipe references are not repaired', () => {
  for (const change of [f => f.plots[1].state = 5, f => f.plots[1].plantedRecipe = f.recipe,
    f => delete f.plots[2].plantedRecipe, f => f.plots[1].selectedRecipe = { ...f.recipe },
    f => f.plots[1].selectedRecipe = null]) {
    const f = fixture(); change(f); assert.equal(read(f).sections.plots.supported, false);
  }
  const f = fixture(), otherCategory = { ...f.category, ...object('OtherCategory') }, otherRecipe = { ...f.recipe, ...object('OtherRecipe'), category: otherCategory };
  f.farming.categories.allObjects.push(otherCategory); f.farming.actions.allObjects.push(otherRecipe); f.plots[1].selectedRecipe = otherRecipe;
  assert.equal(read(f).sections.plots.supported, false);
});
test('timer maps, sets, references and growth states must all agree', () => {
  for (const change of [f => f.farming.growthTimers = [], f => f.farming.growthTimerMap = {}, f => f.timer.plots = [],
    f => f.timer.plots.push(f.plots[2]), f => f.timer.plots = [f.plots[1]], f => f.farming.growthTimerMap.clear(),
    f => f.farming.growthTimers.clear(), f => f.farming.growthTimerMap.set(f.plots[2], { plots: [f.plots[2]] }),
    f => f.farming.growthTimers.add({ plots: [f.plots[2]] })]) {
    const f = fixture(); change(f); const result = read(f); assert.equal(result.sections.timers.reason, 'farming-timer-membership-invalid');
    assert.equal(result.sections.recipes.supported, true);
  }
});
test('related category and compost references are required, not matched by guessed IDs', () => {
  for (const change of [f => f.recipe.category = { ...f.category }, f => f.plots[2].compostItem = { ...f.compost },
    f => delete f.plots[2].compostItem, f => f.plots[1].category = object('UnknownCategory')]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('category, recipe, cost and compost scalar validation rejects unsupported values', () => {
  for (const change of [f => f.category.returnSeeds = null, f => f.category.harvestMultiplier = NaN,
    f => f.recipe.seedCost.quantity = 0, f => f.recipe.baseQuantity = -1, f => f.farming.getRecipeSeedCost = () => 0.5,
    f => f.farming.getRecipeInterval = () => Infinity, f => f.compost.disableSeedRefund = null,
    f => f.compost.compostAllCost.quantity = -1, f => f.plots[1].compostLevel = 101,
    f => f.plots[1].growthTime = -1, f => f.farming.getPlotGrowthChance = () => 101,
    f => f.farming.getPlotUnlockCosts = () => null]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('recipe failure is isolated, and partial results never echo exception details', () => {
  const f = fixture(), bad = { ...f.recipe, ...object('BadRecipe') }; f.farming.actions.allObjects.push(bad);
  const original = f.farming.getRecipeSeedCost; f.farming.getRecipeSeedCost = recipe => { if (recipe === bad) throw new Error('PRIVATE-SAVE'); return original(recipe); };
  const result = read(f); assert.equal(result.sections.recipes.supported, false); assert.equal(result.sections.plots.supported, true);
  assert.equal(records(result, 'recipes').find(value => value.id === bad.id).reason, 'farming-record-invalid'); assert.equal(JSON.stringify(result).includes('PRIVATE-SAVE'), false);
});
test('duplicate registries are discarded and do not invent empty valid data', () => {
  for (const section of ['categories', 'actions', 'plots', 'composts']) {
    const f = fixture(); f.farming[section].allObjects.push(f.farming[section].allObjects[0]);
    const result = read(f), key = section === 'actions' ? 'recipes' : section; assert.equal(result.sections[key].reason, 'farming-registry-invalid');
    assert.deepEqual(result.sections[key].records, []); assert.equal(result.supported, false);
  }
});
test('registry, timer and output-byte bounds prevent unbounded snapshots', () => {
  for (const [property, length] of [['categories', 257], ['actions', 2049], ['plots', 1025], ['composts', 257]]) {
    const f = fixture(); f.farming[property].allObjects = Array(length).fill(f.farming[property].allObjects[0]); assert.equal(read(f).supported, false);
  }
  const f = fixture(); f.farming.growthTimers = new Set(Array.from({ length: 1025 }, () => ({ plots: [] })));
  assert.equal(read(f).sections.timers.supported, false);
  const bounded = fixture(); bounded.context.maximumBytes = 1024; assert.equal(read(bounded).reason, 'farming-output-byte-limit');
});
test('harvest, grow, reset, seed choice, fertilizer, tick, XP, saving and bank APIs are not referenced', () => {
  const f = fixture(); for (const property of ['harvestPlot', 'plantPlot', 'growPlots', 'resetPlot', 'clearDeadPlot', 'compostPlot', 'compostAllOnClick',
    'unlockPlotOnClick', 'createGrowthTimer', 'passiveTick', 'setPlantAllSelected', 'getBasePrimaryProductQuantityModifier',
    'applyPrimaryProductMultipliers', 'tempCompostQuantityModifier', 'getOwnedRecipeSeeds', 'getHarvestAllCost', 'encode', 'decode'])
    Object.defineProperty(f.farming, property, { get() { throw new Error('FORBIDDEN'); } });
  for (const property of ['bank', 'characterName', 'save', 'cloud']) Object.defineProperty(f.game, property, { get() { throw new Error('PRIVATE'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.harvestProjection, null);
  for (const value of records(result, 'plots')) assert.equal(value.data.guaranteedHarvest, null);
});
test('mature, dead and empty states generate neither product nor bank/Completion projections', () => {
  const result = read(fixture()); assert.equal(result.harvestProjection, null); assert.equal(result.sections.timers.timeProjection, null);
  assert.equal(result.bank, undefined); assert.equal(result.completion, undefined); assert.equal(result.plannerDrafts, undefined);
  assert.ok(records(result, 'plots').every(value => value.data.guaranteedHarvest === null));
});
test('registry/timer ordering and frozen inputs produce deterministic detached observations', () => {
  const f = fixture(), first = read(f); f.farming.plots.allObjects.reverse(); assert.deepEqual(read(f), first);
  const seen = new Set(); function freeze(value) { if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
    else if (value instanceof Set) for (const child of value) freeze(child); else Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.game); freeze(f.context); assert.deepEqual(read(f), first);
  first.sections.recipes.records[0].data.nominal.seed.quantity = 99; assert.equal(f.recipe.seedCost.quantity, 3);
  first.sections.timers.records[0].plotIds[0] = 'changed'; assert.equal(f.timer.plots[0].id, 'melvorD:Plot2');
});
