import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservationFrame, readObservationFrameForTesting } from '../src/observation-frame.mjs';
const object = (name, extra = {}) => ({ id: `melvorD:${name}`, namespace: 'melvorD', isModded: false, ...extra });
const registry = allObjects => ({ allObjects });
function fixture() {
  const mode = object('Standard', { isPermaDeath: false }), log = object('Logs'), ore = object('Ore'), bar = object('Bar', { ignoreCompletion: false, found: 0 }), gp = object('GP', { amount: 100 });
  const tree = object('Tree', { product: log, level: 1, abyssalLevel: 0, baseExperience: 10, baseAbyssalExperience: 0,
    baseInterval: 3000, requirements: [], randomProducts: [] });
  const wood = object('Woodcutting', { isUnlocked: true, level: 5, abyssalLevel: 0, currentLevelCap: 10, hasAbyssalLevels: false,
    levelCompletionBreakdown: [{ namespace: 'melvorBaseGame', levels: 10 }], rareDrops: [], actions: registry([tree]),
    masteryLevelCap: 10, getMasteryLevel: () => 1, isMasteryActionUnlocked: () => true,
    defaultRandomProducts: [], randomProducts: new Map(), randomJewelry: [], isTreeUnlocked: () => true,
    getTreeInterval: () => 2500, getTreeMultiplier: () => 1, getDoublingChance: () => 0 });
  const smithRecipe = object('BarRecipe', { product: bar, baseQuantity: 1, level: 1, abyssalLevel: 0, baseExperience: 5, baseAbyssalExperience: 0,
    itemCosts: [{ item: ore, quantity: 1 }], currencyCosts: [] });
  const shopCategory = object('General', { isGolbinRaid: false, allowedGamemodes: new Set([mode]) });
  const purchase = object('BuyBar', { category: shopCategory, allowedGamemodes: new Set([mode]), allowQuantityPurchase: true,
    costs: { items: [], currencies: [{ currency: gp, type: 'Fixed', cost: 5 }] }, unlockRequirements: [], purchaseRequirements: [],
    contains: { items: [{ item: bar, quantity: 1 }] }, getBuyLimit: () => 0 });
  const farmCategory = object('Allotment', { returnSeeds: true, scaleXPWithQuantity: true, giveXPOnPlant: false, harvestMultiplier: 1, masteryXPDivider: 1 });
  const crop = object('Crop', { category: farmCategory, product: object('CropProduct'), baseQuantity: 1, baseInterval: 600,
    seedCost: { item: object('Seed'), quantity: 1 }, level: 1, abyssalLevel: 0, baseExperience: 10, baseAbyssalExperience: 0 });
  const plot = object('Plot', { category: farmCategory, state: 1, selectedRecipe: crop, level: 1, abyssalLevel: 0, itemCosts: [], currencyCosts: [], compostLevel: 0, growthTime: 0 });
  const game = { currentGamemode: mode, isGolbinRaid: false, woodcutting: wood,
    smithing: object('Smithing', { isUnlocked: true, level: 5, abyssalLevel: 0, rareDrops: [], actions: registry([smithRecipe]), baseInterval: 2000,
      isMasteryActionUnlocked: () => true, modifyInterval: () => 1500, getPreservationChance: () => 0, getDoublingChance: () => 0,
      getRecipeCosts: () => ({ getItemQuantityArray: () => [{ item: ore, quantity: 1 }], getCurrencyQuantityArray: () => [] }) }),
    skills: registry([wood]), masterySkills: registry([wood]), items: registry([bar]),
    monsters: registry([object('Monster', { ignoreCompletion: false, kills: 0 })]), pets: registry([object('Pet', { ignoreCompletion: false, unlocked: false })]),
    stats: { itemFindCount: item => item.found, monsterKillCount: monster => monster.kills }, petManager: { isPetUnlocked: pet => pet.unlocked },
    completion: { totalProgressBaseGame: 12 }, bank: { items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 20 },
    currencies: registry([gp]), combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
      { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } }, isPaused: false,
    activeAction: undefined, pausedAction: undefined,
    shop: { categories: registry([shopCategory]), purchases: registry([purchase]), upgradesPurchased: new Map(), buyQuantity: 1,
      getPurchaseCount: () => 0, isUpgradePurchased: () => false, isPurchaseAtBuyLimit: () => false, capPurchaseQuantity: () => 1,
      getPurchaseCosts: () => ({ getItemQuantityArray: () => [], getCurrencyQuantityArray: () => [{ currency: gp, quantity: 5 }] }) },
    farming: object('Farming', { isUnlocked: true, level: 5, abyssalLevel: 0, categories: registry([farmCategory]), plots: registry([plot]),
      actions: registry([crop]), composts: registry([]), growthTimers: new Set(), growthTimerMap: new Map(),
      isMasteryActionUnlocked: () => true, getRecipeSeedCost: () => 1, getRecipeInterval: () => 450 }) };
  for (const [property, current, maximum] of [['skillProgress', 5, 10], ['masteryProgress', 1, 10], ['itemProgress', 0, 1], ['monsterProgress', 0, 1], ['petProgress', 0, 1]])
    game.completion[property] = { currentCount: { getCompValue: () => current }, maximumCount: { getCompValue: () => maximum }, getPercent: () => current * 100 / maximum };
  const context = { version: 'v1.3.1', observationId: 'unified-frame', nowMs: 123, ownership: { base: true, toth: false, aod: false, ita: false }, skills: ['woodcutting', 'smithing'] };
  return { game, mode, context, bar, plot };
}
const read = f => readObservationFrameForTesting(f.game, f.context);
test('five stages share one context and feed completion audit plus item acquisition analysis', () => {
  const f = fixture(), result = read(f); assert.equal(result.supported, true); assert.equal(result.status, 'observed');
  assert.ok(Object.values(result.stages).every(stage => stage.supported)); assert.equal(result.analysis.audit.missingCount, 5);
  assert.equal(result.analysis.acquisition.supported, true); assert.equal(result.analysis.shopSource, 'included');
  assert.ok(result.analysis.acquisition.graph.nodes.some(value => value.type === 'shop-operation'));
  assert.equal(result.observedAtMs, 123); assert.equal(result.atomicObservation, false); assert.equal(result.actualComplete, false); assert.equal(result.runnable, false);
});
test('normal entry and invalid contexts refuse all game getters', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('PRIVATE'); } }), f = fixture();
  assert.equal(readObservationFrame(forbidden, { ...f.context, enabled: true }).reason, 'runtime-observation-frame-unverified');
  for (const patch of [{ version: 'v2' }, { observationId: null }, { nowMs: -1 }, { maximumBytes: null }, { maximumBytes: 100 },
    { ownership: { base: false } }, { ownership: { base: true, ita: 'yes' } }, { skills: [] }, { skills: ['smithing', 'smithing'] }]) {
    const result = readObservationFrameForTesting(forbidden, { ...f.context, ...patch }); assert.equal(result.frame, null); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
test('partial resource data keeps other stages and analysis without filling unknown bank stock', () => {
  const f = fixture(); Object.defineProperty(f.game.bank, 'items', { get() { throw new Error('PRIVATE'); } });
  const result = read(f); assert.equal(result.status, 'partial'); assert.equal(result.stages.resources.supported, false);
  assert.equal(result.frame.resources.categories.bank.data, null); assert.equal(result.stages.production.supported, true);
  assert.equal(result.analysis.acquisition.supported, true); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('missing shop falls back to production analysis and explicitly records the missing source', () => {
  const f = fixture(); delete f.game.shop;
  const result = read(f); assert.equal(result.status, 'partial'); assert.equal(result.analysis.shopSource, 'unavailable-production-only');
  assert.equal(result.analysis.acquisition.supported, true); assert.equal(result.frame.shopSnapshot.supported, false);
});
test('missing production or farming does not erase unrelated observed stages', () => {
  const f = fixture(); delete f.game.smithing; delete f.game.farming;
  const result = read(f); assert.equal(result.status, 'partial'); assert.equal(result.stages.shop.supported, true);
  assert.equal(result.frame.productionCatalog.skills.find(value => value.kind === 'smithing').supported, false);
  assert.equal(result.frame.farmingSnapshot.supported, false); assert.equal(result.analysis.audit.comparable, true);
});
test('unknown DLC ownership is preserved without assuming the registry proves possession', () => {
  const f = fixture(); delete f.context.ownership.ita;
  const result = read(f); assert.equal(result.ownership.ita, null); assert.equal(result.analysis.audit.comparable, false);
  assert.equal(result.actualComplete, false);
});
test('context ownership is fixed before getters can mutate the original input', () => {
  const f = fixture(), base = f.game.currentGamemode;
  Object.defineProperty(f.game, 'currentGamemode', { get() { f.context.ownership.base = false; return base; } });
  const result = read(f); assert.equal(result.ownership.base, true); assert.equal(result.frame.completionSnapshot.completion.scopes[0].ownership, true);
});
test('Raid precondition stops before any stage observation', () => {
  const f = fixture(); f.game.isGolbinRaid = true;
  Object.defineProperty(f.game, 'completion', { get() { throw new Error('must not read'); } }); assert.equal(read(f).reason, 'observation-frame-raid-unverified');
});
test('mode or Raid changes across observation reject the entire frame', () => {
  for (const change of [f => f.game.currentGamemode = { ...f.mode, id: 'Other' }, f => f.game.isGolbinRaid = true]) {
    const f = fixture(), farming = f.game.farming; Object.defineProperty(f.game, 'farming', { get() { change(f); return farming; } });
    const result = read(f); assert.equal(result.reason, 'observation-frame-context-changed'); assert.equal(result.frame, null);
  }
});
test('an intermediate stage mode mismatch is rejected even when the final header changes back', () => {
  const f = fixture(); let calls = 0; Object.defineProperty(f.game, 'currentGamemode', { get() { calls++; return calls === 3 ? { ...f.mode, id: 'Other' } : f.mode; } });
  const result = read(f); assert.equal(result.reason, 'observation-frame-snapshot-mismatch'); assert.equal(result.frame, null);
});
test('stage success does not turn a failed graph into executable work', () => {
  const f = fixture(); f.game.shop.purchases.allObjects = [];
  const result = read(f); assert.equal(result.planningReady, false); assert.equal(result.runnable, false); assert.equal(result.actualComplete, false);
});
test('secret context/extra fields and mutation/notification/save/clock helpers are not referenced', () => {
  const f = fixture(); for (const property of ['characterName', 'generateSaveString', 'cloud', 'runTicks', 'scheduleSave'])
    Object.defineProperty(f.game, property, { get() { throw new Error('PRIVATE'); } });
  for (const property of ['password', 'save', 'authorization']) Object.defineProperty(f.context, property, { get() { throw new Error('PRIVATE'); } });
  Object.defineProperty(f.game.shop, 'buyItemOnClick', { get() { throw new Error('must not read'); } });
  Object.defineProperty(f.game.farming, 'harvestPlot', { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('whole frame UTF-8 budget rejects oversized output without truncating source snapshots', () => {
  const f = fixture(); f.context.maximumBytes = 1024;
  const result = read(f); assert.equal(result.reason, 'observation-frame-output-byte-limit'); assert.equal(result.frame, null); assert.equal(f.game.items.allObjects.length, 1);
});
test('frozen game data and returned frame mutations remain separate', () => {
  const f = fixture(), seen = new Set(); function freeze(value) { if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
    else if (value instanceof Set) for (const child of value) freeze(child); else Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.game); freeze(f.context); const first = read(f); assert.equal(first.supported, true); assert.deepEqual(read(f), first);
  first.frame.completionSnapshot.completion.scopes[0].categories.items.entries[0].current = 1; first.frame.resources.categories.bank.data.maximumSlots = 999;
  assert.equal(f.bar.found, 0); assert.equal(f.game.bank.maximumSlots, 20); assert.equal(read(f).analysis.audit.missingCount, 5);
});
test('monitoring skips production, shop, farming and analysis while observing fresh resources/Completion', () => {
  const f = fixture(); f.context.phase = 'monitoring';
  for (const property of ['woodcutting', 'smithing', 'shop', 'farming']) Object.defineProperty(f.game, property, { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.analysis, null); assert.equal(result.analysisStatus, 'deferred-monitoring');
  assert.equal(result.frame.productionCatalog, null); assert.equal(result.frame.shopSnapshot, null); assert.equal(result.frame.farmingSnapshot, null);
  assert.equal(result.stages.production.status, 'deferred'); assert.equal(result.stages.production.supported, null);
  assert.equal(result.frame.resources.categories.currencies.data.currencies[0].amount, 100);
});
test('offline planning requests defer full scans and preserve the current flag without generating progress', () => {
  const f = fixture(); f.context.offline = true;
  for (const property of ['shop', 'farming']) Object.defineProperty(f.game, property, { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.analysis, null); assert.equal(result.analysisStatus, 'deferred-offline'); assert.equal(result.frame.offline, true);
  assert.equal(result.actualComplete, false); assert.equal(f.bar.found, 0); assert.equal(f.game.bank.items.size, 0);
});
test('returning to planning reobserves each deferred stage instead of reusing old analysis', () => {
  const f = fixture(); f.context.phase = 'monitoring'; assert.equal(read(f).analysis, null);
  f.context.phase = 'planning'; f.context.nowMs++; const result = read(f);
  assert.equal(result.analysisStatus, 'evaluated'); assert.equal(result.stages.production.supported, true); assert.equal(result.analysis.acquisition.supported, true);
});
test('monitoring validates context, mode and partial resources without creating cached substitutes', () => {
  const f = fixture(); f.context.phase = 'monitoring'; f.game.bank.maximumSlots = NaN;
  const result = read(f); assert.equal(result.status, 'partial'); assert.equal(result.frame.resources.categories.bank.data, null); assert.equal(result.analysis, null);
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  for (const patch of [{ phase: 'other' }, { phase: null }, { offline: null }])
    assert.equal(readObservationFrameForTesting(forbidden, { ...fixture().context, ...patch }).reason, 'observation-frame-context-invalid');
});
test('monitoring requests read only explicit target IDs and defer whole Completion/audit', () => {
  const f = fixture(), target = { type: 'completion', scopeId: 'base', category: 'items', id: f.bar.id };
  f.game.items.getObjectByID = id => id === f.bar.id ? f.bar : undefined;
  Object.defineProperty(f.game.items, 'allObjects', { get() { throw new Error('must not scan'); } });
  Object.defineProperty(f.game.completion.itemProgress, 'currentCount', { get() { throw new Error('must not total'); } });
  f.context.phase = 'monitoring'; f.context.targets = [target];
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.frame.completionSnapshot, null); assert.equal(result.analysis, null);
  assert.equal(result.frame.completionTargets.coverage, 'targets-only'); assert.equal(result.frame.completionTargets.targets[0].current, 0);
});
test('monitoring resourceTargets skip bank/currency registries and keep global slot counts', () => {
  const f = fixture(), game = f.game, currencies = game.currencies.allObjects;
  game.items.getObjectByID = id => id === f.bar.id ? f.bar : undefined; game.currencies.getObjectByID = id => currencies.find(value => value.id === id);
  game.bank.getQty = () => 0; game.bank.occupiedSlots = 8;
  Object.defineProperty(game.bank, 'items', { get() { throw new Error('must not scan'); } });
  Object.defineProperty(game.currencies, 'allObjects', { get() { throw new Error('must not scan'); } });
  f.context.phase = 'monitoring'; f.context.resourceTargets = { itemIds: [f.bar.id], currencyIds: [currencies[0].id] };
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.frame.resources.coverage, 'targets-only');
  assert.equal(result.frame.resources.categories.bank.data.occupiedSlots, 8); assert.equal(result.frame.resources.categories.bank.data.items.length, 0);
});
test('expected woodcutting selection is observed in the same frame while output permission remains unknown', () => {
  const f = fixture(), wc = f.game.woodcutting, tree = wc.actions.allObjects[0];
  wc.isActive = true; wc.canStop = true; wc.activeTrees = new Set([tree]); wc.actions.getObjectByID = id => id === tree.id ? tree : undefined;
  f.game.activeAction = wc; wc.activeSkills = []; f.context.phase = 'monitoring'; f.context.expectedActionId = wc.id; f.context.treeIds = [tree.id];
  const result = read(f); assert.equal(result.supported, true); assert.deepEqual(result.frame.actionSelection.selectionIds, [tree.id]);
  assert.equal(result.frame.woodcutting.trees[0].outputsEvidence, 'unknown'); assert.equal(result.analysis, null);
});
test('noncombat recipe selections are linked to the frame without read-only metadata authorizing actions', () => {
  const f = fixture(), smith = f.game.smithing, recipe = smith.actions.allObjects[0];
  smith.selectedRecipe = recipe; smith.isActive = true; smith.canStop = true; smith.activeSkills = [];
  smith.actions.getObjectByID = id => id === recipe.id ? recipe : undefined; f.game.activeAction = smith; f.context.phase = 'monitoring';
  const result = read(f); assert.equal(result.supported, true); assert.deepEqual(result.frame.actionSelection.selectionIds, [recipe.id]);
  assert.equal(result.frame.currentAction.skillState.operationEvidence, 'unknown'); assert.equal(result.frame.woodcutting, null);
});
