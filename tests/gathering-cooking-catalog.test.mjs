import test from 'node:test';
import assert from 'node:assert/strict';
import { readProductionCatalog, readProductionCatalogForTesting } from '../src/production-catalog.mjs';
import { planResourceDemand } from '../src/quantities.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
const object = (name, extra = {}, namespace = 'melvorD') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
const recipe = (name, extra = {}) => object(name, { product: object(`${name}Product`), level: 1, abyssalLevel: 0, baseExperience: 10, baseAbyssalExperience: 0, ...extra });
const baseSkill = (name, actions, extra = {}) => object(name, { isUnlocked: true, level: 50, abyssalLevel: 1, rareDrops: [],
  actions: { allObjects: actions }, isMasteryActionUnlocked: () => true, getDoublingChance: () => 10, ...extra });
function fixture() {
  const miningCategory = object('OreCategory');
  const rock = recipe('CopperRock', { category: miningCategory, baseQuantity: 1, baseRespawnInterval: 10_000, totalMasteryRequired: 40,
    hasPassiveRegen: true, giveGems: true, currentHP: 3, maxHP: 5, isRespawning: false, shopItemPurchased: object('PickaxeUpgrade') });
  const fish = recipe('Fish', { strengthXP: 2, baseMinInterval: 2000, baseMaxInterval: 4000 });
  const area = object('Lake', { fish: [fish], fishChance: 80, junkChance: 15, specialChance: 5, isSecret: true,
    requiredItem: object('FishingRing'), poiRequirement: {} }); fish.area = area;
  const category = object('CookingFire', { upgradeRequired: true, upgradeOwned: false });
  const cook = recipe('CookFish', { category, baseQuantity: 1, baseInterval: 3000, perfectItem: object('PerfectFish'),
    discoveredItems: [object('CookDiscovery')], itemCosts: [{ item: fish.product, quantity: 2 }], currencyCosts: [{ currency: object('GP'), quantity: 0.5 }] });
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    mining: baseSkill('Mining', [rock], { baseInterval: 3000, coalItem: object('Coal'), runestoneItem: object('Runestone'),
      modifyInterval: () => 2500, canMineOre: () => false, getRockGemChance: () => 12, getRockSuperiorGemChance: () => 2, getRockAbyssalGemChance: () => 1 }),
    fishing: baseSkill('Fishing', [fish], { areas: { allObjects: [area] }, junkItems: [object('Junk')], secretAreaUnlocked: false,
      getMinFishInterval: () => 1500, getMaxFishInterval: () => 3500, getAreaChances: () => ({ fish: 90, junk: 4, special: 6 }) }),
    cooking: baseSkill('Cooking', [cook], { categories: { allObjects: [category] }, getPreservationChance: () => 20,
      getRecipeCookingInterval: () => 2500, getRecipePassiveCookingInterval: () => 10_000,
      getRecipeSuccessChance: () => 75, getRecipePerfectChance: () => 30,
      getRecipeCosts: () => ({ getItemQuantityArray: () => [{ item: fish.product, quantity: 1 }],
        getCurrencyQuantityArray: () => [{ currency: object('GP'), quantity: 0.25 }] }),
      passiveCookTimers: new Map([[category, { secretTimer: 'DO-NOT-COPY' }]]),
      stockpileItems: new Map([[category, { item: cook.product, quantity: 7 }]]), activeCookingCategory: category }) };
  const context = { version: 'v1.3.1', observationId: 'synthetic-only', ownership: { base: true, toth: false, aod: false, ita: false }, skills: ['mining', 'fishing', 'cooking'] };
  return { game, context, rock, fish, area, category, cook };
}
const read = f => readProductionCatalogForTesting(f.game, f.context);
const skill = (result, kind) => result.skills.find(value => value.kind === kind);
const data = (result, kind) => skill(result, kind).entries[0].data;
test('mining keeps HP, unlock, shop, respawn and modifiers separate from guaranteed yield', () => {
  const result = read(fixture()), mining = data(result, 'mining'); assert.equal(result.supported, true);
  assert.equal(mining.nominal.baseQuantity, 1); assert.equal(mining.nominal.baseIntervalMs, 3000);
  assert.equal(mining.nominal.baseRespawnIntervalMs, 10_000); assert.equal(mining.observed.intervalMs, 2500);
  assert.equal(mining.observed.currentHP, 3); assert.equal(mining.observed.maximumHP, 5);
  assert.equal(mining.observed.canMine, false); assert.equal(mining.observed.actionEligibility, true);
  assert.equal(mining.constraints.totalMasteryRequired, 40); assert.equal(mining.constraints.shopPurchaseId, 'melvorD:PickaxeUpgrade');
  assert.equal(mining.observed.gemPercent, 12); assert.ok(mining.observedOutputIds.includes('melvorD:Coal'));
  assert.equal(mining.effectEvidence, 'unknown'); assert.equal(mining.outputCoverage, 'partial');
});
test('depleted and respawning rocks are observations, never HP regeneration or invented availability', () => {
  const f = fixture(); f.rock.currentHP = 0; f.rock.isRespawning = true;
  const result = data(read(f), 'mining'); assert.equal(result.observed.currentHP, 0); assert.equal(result.observed.isRespawning, true);
  assert.equal(result.observed.canMine, false); assert.equal(f.rock.currentHP, 0);
});
test('fishing preserves intervals and area chances without averaging into a duration guarantee', () => {
  const result = read(fixture()), fishing = data(result, 'fishing');
  assert.equal(fishing.nominal.baseMinIntervalMs, 2000); assert.equal(fishing.nominal.baseMaxIntervalMs, 4000);
  assert.equal(fishing.nominal.baseIntervalMs, null); assert.equal(fishing.observed.intervalMs, null);
  assert.equal(fishing.observed.minIntervalMs, 1500); assert.equal(fishing.observed.maxIntervalMs, 3500);
  assert.deepEqual(fishing.nominal.areaChances, { fish: 80, junk: 15, special: 5 });
  assert.deepEqual(fishing.observed.areaChances, { fish: 90, junk: 4, special: 6 });
  assert.equal(fishing.constraints.requiredEquipmentId, 'melvorD:FishingRing'); assert.equal(fishing.constraints.hasPOIRequirement, true);
  assert.equal(fishing.constraints.isSecret, true); assert.equal(fishing.observed.secretAreaUnlocked, false);
  const action = result.recipeActions.find(value => value.action.id === 'melvorD:Fishing');
  assert.deepEqual(action.action.selectionIds, ['melvorD:Lake', 'melvorD:Fish']); assert.equal(action.evidence, 'unknown');
});
test('cooking retains nominal/effective costs, station upgrade, perfect items and passive stockpile', () => {
  const result = read(fixture()), cooking = data(result, 'cooking'), passive = skill(result, 'cooking').passiveCooking;
  assert.equal(cooking.nominal.itemCosts[0].quantity, 2); assert.equal(cooking.observed.itemCosts[0].quantity, 1);
  assert.equal(cooking.nominal.currencyCosts[0].amount, 0.5); assert.equal(cooking.observed.currencyCosts[0].amount, 0.25);
  assert.equal(cooking.observed.successPercent, 75); assert.equal(cooking.observed.perfectPercent, 30);
  assert.equal(cooking.observed.passiveIntervalMs, 10_000); assert.equal(cooking.constraints.upgradeRequired, true); assert.equal(cooking.observed.upgradeOwned, false);
  assert.ok(cooking.observedOutputIds.includes('melvorD:PerfectFish')); assert.ok(cooking.observedOutputIds.includes('melvorD:CookDiscovery'));
  assert.deepEqual(passive.stockpiles, [{ categoryId: 'melvorD:CookingFire', itemId: 'melvorD:CookFishProduct', quantity: 7 }]);
  assert.equal(passive.bankInventoryIncluded, false); assert.equal(JSON.stringify(result).includes('DO-NOT-COPY'), false);
  assert.deepEqual(result.recipeActions.find(value => value.action.id === 'melvorD:Cooking').action.selectionIds, ['melvorD:CookingFire', 'melvorD:CookFish']);
});
test('five skill subsets coexist and mock skill subsets are fixed whitelist observations', () => {
  const f = fixture(), tree = recipe('Tree', { baseInterval: 3000, requirements: [], randomProducts: [] }), bar = recipe('Bar', { baseQuantity: 1, itemCosts: [], currencyCosts: [] });
  f.game.woodcutting = baseSkill('Woodcutting', [tree], { defaultRandomProducts: [], randomProducts: new Map(), randomJewelry: [],
    isTreeUnlocked: () => true, getTreeInterval: () => 2000, getTreeMultiplier: () => 1 });
  f.game.smithing = baseSkill('Smithing', [bar], { baseInterval: 2000, modifyInterval: () => 1500, getPreservationChance: () => 0,
    getRecipeCosts: () => ({ getItemQuantityArray: () => [], getCurrencyQuantityArray: () => [] }) });
  f.context.skills = ['woodcutting', 'smithing', 'mining', 'fishing', 'cooking'];
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.skills.length, 5);
  assert.equal(result.plannerDrafts.length, 5); assert.equal(result.planningReady, false);
});
test('runtime, version, subset, context and Raid gates do not touch skill getters', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('SECRET'); } }), f = fixture();
  assert.equal(readProductionCatalog(forbidden, f.context).reason, 'runtime-catalog-adapter-unverified');
  for (const kinds of [[], ['mining', 'mining'], ['unknown'], null, {}]) {
    const result = readProductionCatalogForTesting(forbidden, { ...f.context, skills: kinds });
    assert.equal(result.reason, 'catalog-skills-invalid'); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  f.game.isGolbinRaid = true; for (const kind of f.context.skills) Object.defineProperty(f.game, kind, { get() { throw new Error('must not read'); } });
  assert.equal(read(f).reason, 'raid-catalog-unverified');
});
test('unowned and modded actions are excluded before reading recipe contents', () => {
  for (const kind of ['mining', 'fishing', 'cooking']) for (const namespace of ['melvorItA', 'myMod']) {
    const f = fixture(), excluded = object('Excluded', {}, namespace); excluded.isModded = namespace === 'myMod';
    Object.defineProperty(excluded, 'product', { get() { throw new Error('must not read'); } });
    f.game[kind].actions.allObjects.push(excluded);
    const entry = skill(read(f), kind).entries.find(value => value.actionId === excluded.id); assert.equal(entry.status, 'excluded');
  }
});
test('unknown DLC ownership is blocked, and owned DLC observations retain their scope', () => {
  for (const ownership of [true, null]) {
    const f = fixture(), rock = { ...f.rock, ...object('DLCrock', {}, 'melvorItA') }; f.context.ownership.ita = ownership;
    f.game.mining.actions.allObjects.push(rock); const entry = skill(read(f), 'mining').entries.find(value => value.actionId === rock.id);
    assert.equal(entry.scopeId, 'ita'); assert.equal(entry.status, ownership === true ? 'observed' : 'blocked');
  }
});
test('fishing area identity, registered reference and membership are required', () => {
  for (const change of [f => delete f.fish.area, f => f.fish.area = { ...f.area }, f => f.area.fish = [],
    f => f.area.fish.push(f.fish), f => f.game.fishing.areas.allObjects.push(f.area)]) {
    const f = fixture(); change(f); assert.equal(skill(read(f), 'fishing').supported, false);
  }
});
test('unowned related areas and cooking categories never read their content flags', () => {
  for (const kind of ['fishing', 'cooking']) {
    const f = fixture(), related = kind === 'fishing' ? f.area : f.category;
    Object.assign(related, object('Related', {}, 'melvorItA'));
    Object.defineProperty(related, kind === 'fishing' ? 'isSecret' : 'upgradeOwned', { get() { throw new Error('SECRET'); } });
    const result = read(f); assert.equal(skill(result, kind).supported, false); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('invalid mining HP, respawn, quantity and gem chances are isolated from other skills', () => {
  for (const change of [f => f.rock.currentHP = 6, f => f.rock.maxHP = -1, f => f.rock.isRespawning = null,
    f => f.rock.baseQuantity = 0, f => f.rock.baseRespawnInterval = 0, f => f.rock.totalMasteryRequired = 0.5,
    f => f.game.mining.getRockGemChance = () => 101, f => f.game.mining.canMineOre = () => null]) {
    const f = fixture(); change(f); const result = read(f); assert.equal(skill(result, 'mining').supported, false);
    assert.equal(skill(result, 'fishing').supported, true); assert.equal(skill(result, 'cooking').supported, true);
  }
});
test('fishing rejects invalid or reversed intervals, chance sums and scalar flags', () => {
  for (const change of [f => f.fish.baseMaxInterval = 1, f => f.game.fishing.getMinFishInterval = () => NaN,
    f => f.game.fishing.getMaxFishInterval = () => 1, f => f.area.fishChance = 101,
    f => f.game.fishing.getAreaChances = () => ({ fish: 100, junk: 1, special: 0 }), f => f.game.fishing.secretAreaUnlocked = null]) {
    const f = fixture(); change(f); assert.equal(skill(read(f), 'fishing').supported, false);
  }
});
test('cooking rejects unknown upgrades, costs, success/perfect and passive interval values', () => {
  for (const change of [f => f.category.upgradeOwned = null, f => f.cook.baseQuantity = 0, f => f.cook.baseInterval = 0,
    f => f.game.cooking.getRecipeSuccessChance = () => Infinity, f => f.game.cooking.getRecipePerfectChance = () => -1,
    f => f.game.cooking.getRecipePassiveCookingInterval = () => 0, f => f.game.cooking.getRecipeCosts = () => null]) {
    const f = fixture(); change(f); assert.equal(skill(read(f), 'cooking').supported, false);
  }
});
test('invalid passive state discards stockpiles while retaining observed recipes', () => {
  for (const change of [f => f.game.cooking.stockpileItems = null, f => f.game.cooking.stockpileItems.get(f.category).quantity = -1,
    f => f.game.cooking.passiveCookTimers = null, f => f.game.cooking.activeCookingCategory = { ...f.category }]) {
    const f = fixture(); change(f); const result = skill(read(f), 'cooking'); assert.equal(result.supported, false);
    assert.equal(result.entries[0].status, 'observed'); assert.deepEqual(result.passiveCooking.stockpiles, []);
  }
});
test('registry, area membership, output and passive collection limits are enforced', () => {
  for (const change of [f => f.game.fishing.areas.allObjects = Array(257).fill(f.area), f => f.area.fish = Array(1025).fill(f.fish),
    f => f.game.fishing.junkItems = Array(513).fill(object('Junk')), f => f.cook.discoveredItems = Array(513).fill(object('Extra')),
    f => f.game.cooking.stockpileItems = new Map(Array.from({ length: 129 }, (_, i) => [object(`Cat${i}`), { item: object('Fish'), quantity: 1 }]))]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('reward, random, HP, selection, cooking, collection, saving and timer bodies are not accessed', () => {
  const f = fixture(); for (const kind of f.context.skills) for (const name of ['actionRewards', 'onRockClick', 'updateAllRockMaxHPs', 'respawnRock',
    'rollForRandomGemVein', 'onAreaFishSelection', 'onAreaStartButtonClick', 'rollForRewardType', 'onRecipeSelectionClick',
    'onActiveCookButtonClick', 'startPassiveCooking', 'stopPassiveCooking', 'onCollectStockpileClick', 'getStockpileSnapshot', 'encode', 'decode'])
    Object.defineProperty(f.game[kind], name, { get() { throw new Error('FORBIDDEN'); } });
  Object.defineProperty(f.game, 'characterName', { get() { throw new Error('PRIVATE'); } });
  const timer = f.game.cooking.passiveCookTimers.get(f.category); Object.defineProperty(timer, 'isActive', { get() { throw new Error('FORBIDDEN'); } });
  assert.equal(read(f).supported, true);
});
test('100 percent chances and nominal quantities never promote drafts into executable fixed yields', () => {
  const f = fixture(); f.game.cooking.getRecipeSuccessChance = () => 100; f.game.cooking.getRecipePerfectChance = () => 100;
  f.game.fishing.getAreaChances = () => ({ fish: 100, junk: 0, special: 0 }); const result = read(f);
  for (const draft of result.plannerDrafts) { assert.equal(draft.evidence, 'unknown'); assert.equal(draft.outputs[0].quantity, null); assert.equal(draft.runnable, false); }
  const resources = readResourcesForTesting({ currentGamemode: f.game.currentGamemode, isGolbinRaid: false, bank: {
    items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 20 }, currencies: { allObjects: [{ id: 'GP', amount: 100 }] },
    combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
      { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } },
    isPaused: false, activeAction: undefined, pausedAction: undefined }, { version: 'v1.3.1' });
  const planned = planResourceDemand(resources, [{ id: f.rock.product.id, quantity: 1 }], result.plannerDrafts, f.context);
  assert.equal(resources.supported, true);
  assert.equal(planned.status, 'blocked'); assert.equal(planned.projection, null);
  assert.ok(planned.rejected.some(value => value.reason === 'recipe-effects-unverified'));
});
test('order, frozen cyclic fish references and detached output preserve deterministic observations', () => {
  const f = fixture(), seen = new Set(); function freeze(value) { if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
    else Object.values(value).forEach(freeze); Object.freeze(value); } }
  const first = read(f); f.context.skills.reverse(); assert.deepEqual(read(f), first); freeze(f.game); freeze(f.context);
  assert.deepEqual(read(f), first); first.skills[0].passiveCooking.stockpiles[0].quantity = 100;
  assert.equal(f.game.cooking.stockpileItems.get(f.category).quantity, 7);
  const fresh = read(f); fresh.plannerDrafts.find(draft => draft.id.includes('CookFish')).itemCosts[0].quantity = 999;
  assert.equal(data(read(f), 'cooking').observed.itemCosts[0].quantity, 1);
});
test('HP and returned chance scalars are read once and the same values are validated and exported', () => {
  const f = fixture(); let hpReads = 0, chanceReads = 0;
  Object.defineProperty(f.rock, 'currentHP', { get() { hpReads++; return hpReads === 1 ? 3 : -999; } });
  f.game.fishing.getAreaChances = () => ({ get fish() { chanceReads++; return chanceReads === 1 ? 90 : -999; }, junk: 4, special: 6 });
  const result = read(f); assert.equal(result.supported, true); assert.equal(hpReads, 1); assert.equal(chanceReads, 1);
  assert.equal(data(result, 'mining').observed.currentHP, 3); assert.equal(data(result, 'fishing').observed.areaChances.fish, 90);
});
