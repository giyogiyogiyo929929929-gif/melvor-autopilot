import test from 'node:test';
import assert from 'node:assert/strict';
import { readProductionCatalog, readProductionCatalogForTesting } from '../src/production-catalog.mjs';
const kinds = ['crafting', 'fletching', 'runecrafting', 'herblore', 'summoning'];
const object = (name, extra = {}, namespace = 'melvorD') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
const costs = (item, quantity, gp = 0.5) => ({ getItemQuantityArray: () => [{ item, quantity }], getCurrencyQuantityArray: () => [{ currency: object('GP'), quantity: gp }] });
function fixture() {
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false }, actions = {}, categories = {};
  const material = object('Material'), alternative = object('Alternative'), shard = object('Shard');
  for (const kind of kinds) {
    const category = object(`${kind}Category`), action = object(`${kind}Recipe`, { category, product: object(`${kind}Product`), baseQuantity: 2,
      level: 10, abyssalLevel: 1, baseExperience: 15, baseAbyssalExperience: 5,
      itemCosts: [{ item: material, quantity: 3 }], currencyCosts: [{ currency: object('GP'), quantity: 1.25 }] });
    categories[kind] = category; actions[kind] = action;
    game[kind] = object(kind, { isUnlocked: true, level: 50, abyssalLevel: 10, rareDrops: [], actions: { allObjects: [action] },
      categories: { allObjects: [category] }, baseInterval: 3000, isMasteryActionUnlocked: () => true, modifyInterval: () => 2500,
      getPreservationChance: () => 20, getDoublingChance: () => 10, getRecipeCosts: () => costs(material, 2) });
  }
  actions.crafting.subcategory = object('Jewelry');
  actions.fletching.subcategory = object('Bolts');
  actions.fletching.alternativeCosts = [{ itemCosts: [{ item: alternative, quantity: 4 }], quantityMultiplier: 1.5 }];
  game.fletching.setAltRecipes = new Map([[actions.fletching, 0]]); game.fletching.getRecipeCosts = () => costs(alternative, 3);
  actions.runecrafting.subcategories = [object('ComboRunes'), object('ElementalRunes')];
  game.runecrafting.doesRecipeMakeWaterComboRunes = () => true;
  delete actions.herblore.product; delete actions.herblore.baseQuantity;
  actions.herblore.potions = Array.from({ length: 4 }, (_, i) => object(`Potion${i + 1}`)); game.herblore.getPotionTier = () => 2;
  actions.summoning.tier = 3; actions.summoning.maxMarkLevel = 6;
  actions.summoning.skills = [object('Woodcutting'), object('Mining')]; actions.summoning.nonShardItemCosts = [material, alternative];
  actions.summoning.itemCosts = [{ item: shard, quantity: 2 }]; game.summoning.selectedNonShardCosts = new Map([[actions.summoning, alternative]]);
  game.summoning.getAltRecipeCosts = (_action, item) => costs(item, item === material ? 4 : 6, item === material ? 0.5 : 0.75);
  game.summoning.getRecipeCosts = () => costs(alternative, 6, 0.75); game.summoning.getMarkCount = () => 9; game.summoning.getMarkLevel = () => 2;
  return { game, actions, categories, material, alternative, context: { version: 'v1.3.1', observationId: 'artificial-artisan', skills: [...kinds],
    ownership: { base: true, toth: false, aod: false, ita: false } } };
}
const read = f => readProductionCatalogForTesting(f.game, f.context);
const skill = (result, kind) => result.skills.find(value => value.kind === kind);
const data = (result, kind) => skill(result, kind).entries[0].data;
test('all five artisans keep nominal/effective costs and conditions detached', () => {
  const result = read(fixture()); assert.equal(result.supported, true); assert.equal(result.skills.length, 5);
  for (const kind of kinds) { const value = data(result, kind); assert.equal(value.nominal.baseIntervalMs, 3000);
    assert.equal(value.observed.intervalMs, 2500); assert.equal(value.observed.preservationPercent, 20);
    assert.equal(value.constraints.categoryId, `melvorD:${kind}Category`); assert.equal(value.effectEvidence, 'unknown'); }
  assert.equal(data(result, 'crafting').constraints.subcategoryId, 'melvorD:Jewelry');
  assert.equal(data(result, 'crafting').nominal.itemCosts[0].quantity, 3); assert.equal(data(result, 'crafting').observed.itemCosts[0].quantity, 2);
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false);
});
test('fletching separates base, alternative, current effective cost and raw selection index', () => {
  const value = data(read(fixture()), 'fletching');
  assert.equal(value.nominal.itemCosts[0].id, 'melvorD:Material');
  assert.deepEqual(value.nominal.alternativeCosts, [{ indexRaw: 0, itemCosts: [{ id: 'melvorD:Alternative', quantity: 4 }], quantityMultiplier: 1.5 }]);
  assert.deepEqual(value.observed.itemCosts, [{ id: 'melvorD:Alternative', quantity: 3 }]);
  assert.equal(value.observed.selectedAlternativeIndexRaw, 0); assert.equal(value.observed.alternativeMappingEvidence, 'unknown');
});
test('unset fletching selection and missing alternatives remain explicitly unspecified', () => {
  const f = fixture(); f.game.fletching.setAltRecipes.clear(); delete f.actions.fletching.alternativeCosts;
  const value = data(read(f), 'fletching'); assert.deepEqual(value.nominal.alternativeCosts, []); assert.equal(value.observed.selectedAlternativeIndexRaw, null);
});
test('runecrafting retains distinct subcategories and water-combo condition without extra guaranteed runes', () => {
  const result = read(fixture()), value = data(result, 'runecrafting');
  assert.deepEqual(value.constraints.subcategoryIds, ['melvorD:ComboRunes', 'melvorD:ElementalRunes']); assert.equal(value.observed.makesWaterComboRunes, true);
  assert.deepEqual(result.plannerDrafts.find(entry => entry.id.includes('runecraftingRecipe')).outputs, [{ id: 'melvorD:runecraftingProduct', quantity: null }]);
});
test('herblore records four ordered potions and raw tier while refusing an inferred product mapping', () => {
  const f = fixture(); for (const property of ['product', 'baseQuantity']) Object.defineProperty(f.actions.herblore, property, { get() { throw new Error('must not read'); } });
  const result = read(f), value = data(result, 'herblore'); assert.equal(value.productId, null); assert.equal(value.nominal.baseQuantity, null);
  assert.equal(value.observed.potionTierRaw, 2); assert.deepEqual(value.constraints.potionIdsInDeclaredOrder, ['melvorD:Potion1', 'melvorD:Potion2', 'melvorD:Potion3', 'melvorD:Potion4']);
  assert.equal(value.observedOutputIds.length, 4); assert.equal(result.plannerDrafts.length, 4);
  assert.deepEqual(result.unresolvedDrafts, [{ catalogId: JSON.stringify(['melvorD:herblore', 'melvorD:herbloreRecipe']), reason: 'product-mapping-unverified', runnable: false }]);
  assert.equal(result.recipeActions.some(entry => entry.action.id === 'melvorD:herblore'), false);
});
test('summoning retains alternatives, marks and current material without discovering or consuming marks', () => {
  const result = read(fixture()), value = data(result, 'summoning');
  assert.equal(value.constraints.tier, 3); assert.equal(value.constraints.maximumMarkLevel, 6);
  assert.deepEqual(value.constraints.relatedSkillIds, ['melvorD:Mining', 'melvorD:Woodcutting']);
  assert.equal(value.observed.markCount, 9); assert.equal(value.observed.markLevel, 2); assert.equal(value.observed.selectedNonShardItemId, 'melvorD:Alternative');
  assert.equal(value.observed.alternativeNonShardCosts.length, 2); assert.equal(value.observed.alternativeNonShardCosts[0].itemCosts[0].quantity, 6);
  assert.deepEqual(result.recipeActions.find(entry => entry.action.id === 'melvorD:summoning').action.selectionIds, ['melvorD:summoningRecipe', 'melvorD:Alternative']);
});
test('unset summoning selection stays null instead of choosing the first material', () => {
  const f = fixture(); f.game.summoning.selectedNonShardCosts.clear();
  assert.equal(data(read(f), 'summoning').observed.selectedNonShardItemId, null);
  assert.deepEqual(read(f).recipeActions.find(entry => entry.action.id === 'melvorD:summoning').action.selectionIds, ['melvorD:summoningRecipe']);
});
test('unowned, modded and ownership-unknown artisan recipes do not access contents', () => {
  for (const kind of kinds) for (const [namespace, ownership, expected] of [['melvorItA', false, 'excluded'], ['melvorItA', null, 'blocked'], ['myMod', true, 'excluded']]) {
    const f = fixture(), action = object('Other', {}, namespace); action.isModded = namespace === 'myMod'; f.context.ownership.ita = ownership;
    for (const property of ['product', 'potions', 'nonShardItemCosts', 'alternativeCosts']) Object.defineProperty(action, property, { get() { throw new Error('PRIVATE'); } });
    f.game[kind].actions.allObjects.push(action); const result = read(f), entry = skill(result, kind).entries.find(value => value.actionId === action.id);
    assert.equal(entry.status, expected); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
test('owned DLC artisans retain scope while category references must be registered and owned', () => {
  const f = fixture(); f.context.ownership.ita = true; const action = { ...f.actions.crafting, ...object('DLCrecipe', {}, 'melvorItA') };
  f.game.crafting.actions.allObjects.push(action); assert.equal(skill(read(f), 'crafting').entries.find(value => value.scopeId === 'ita').status, 'observed');
  f.actions.crafting.category = { ...f.categories.crafting }; assert.equal(skill(read(f), 'crafting').supported, false);
  f.game.runecrafting.categories.allObjects.push(f.categories.runecrafting); assert.equal(skill(read(f), 'runecrafting').supported, false);
});
test('invalid fletching alternatives, modifiers and settings are isolated', () => {
  for (const change of [f => f.game.fletching.setAltRecipes = null, f => f.game.fletching.setAltRecipes.set(f.actions.fletching, -1),
    f => f.actions.fletching.alternativeCosts[0].quantityMultiplier = 0, f => f.actions.fletching.alternativeCosts[0].quantityMultiplier = NaN,
    f => f.actions.fletching.alternativeCosts[0].itemCosts[0].quantity = 0.5, f => f.actions.fletching.alternativeCosts = {}]) {
    const f = fixture(); change(f); const result = read(f); assert.equal(skill(result, 'fletching').supported, false); assert.equal(skill(result, 'crafting').supported, true);
  }
});
test('invalid rune subcategories/conditions and potion counts/tiers fail closed', () => {
  for (const [kind, change] of [['runecrafting', f => f.actions.runecrafting.subcategories.push(f.actions.runecrafting.subcategories[0])],
    ['runecrafting', f => f.game.runecrafting.doesRecipeMakeWaterComboRunes = () => null],
    ['herblore', f => f.actions.herblore.potions.pop()], ['herblore', f => f.actions.herblore.potions[1] = f.actions.herblore.potions[0]],
    ['herblore', f => f.game.herblore.getPotionTier = () => 5], ['herblore', f => f.game.herblore.getPotionTier = () => '1']]) {
    const f = fixture(); change(f); assert.equal(skill(read(f), kind).supported, false);
  }
});
test('invalid summoning marks, tier, choices and selected references are never replaced with defaults', () => {
  for (const change of [f => f.actions.summoning.tier = 6, f => f.actions.summoning.maxMarkLevel = 0, f => f.game.summoning.getMarkCount = () => undefined,
    f => f.game.summoning.getMarkLevel = () => 7, f => f.actions.summoning.nonShardItemCosts.push(f.material),
    f => f.game.summoning.selectedNonShardCosts.set(f.actions.summoning, { ...f.material }), f => f.game.summoning.selectedNonShardCosts = null,
    f => f.game.summoning.getAltRecipeCosts = () => ({ getItemQuantityArray: () => [{ item: f.material, quantity: -1 }] })]) {
    const f = fixture(); change(f); assert.equal(skill(read(f), 'summoning').supported, false);
  }
});
test('variant, setting, skill and category collection limits remain finite', () => {
  for (const change of [f => f.actions.fletching.alternativeCosts = Array(65).fill(f.actions.fletching.alternativeCosts[0]),
    f => f.actions.summoning.nonShardItemCosts = Array(65).fill(f.material), f => f.actions.summoning.skills = Array(65).fill(object('Skill')),
    f => f.game.fletching.setAltRecipes = new Map(Array.from({ length: 1025 }, (_, i) => [object(`Recipe${i}`), 0])),
    f => f.game.crafting.categories.allObjects = Array(257).fill(f.categories.crafting)]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('runtime and invalid context scopes refuse skill getters and unrelated action helpers', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('SECRET'); } }), f = fixture();
  assert.equal(readProductionCatalog(forbidden, f.context).reason, 'runtime-catalog-adapter-unverified');
  assert.equal(readProductionCatalogForTesting(forbidden, { ...f.context, skills: [...kinds, ...kinds] }).reason, 'catalog-skills-invalid');
  for (const kind of kinds) for (const property of ['actionRewards', 'activeRecipe', 'actionItem', 'selectedRecipe', 'selectedAltRecipe', 'activeNonShardCost',
    'unmodifiedActionQuantity', 'getMarkSnapshot', 'selectNonShardCostOnClick', 'selectAltRecipeOnClick', 'createButtonOnClick', 'discoverMark', 'rollForMark',
    'rollMarksForSkill', 'addXPForTabletConsumption', 'consumeCosts', 'encode', 'decode']) Object.defineProperty(f.game[kind], property, { get() { throw new Error('FORBIDDEN'); } });
  assert.equal(read(f).supported, true);
});
test('individual getter exceptions are masked and do not remove other artisan observations', () => {
  const f = fixture(); f.game.summoning.getAltRecipeCosts = () => { throw new Error('PRIVATE-SAVE'); };
  const result = read(f); assert.equal(skill(result, 'summoning').entries[0].reason, 'recipe-api-invalid');
  assert.equal(skill(result, 'crafting').supported, true); assert.equal(JSON.stringify(result).includes('PRIVATE-SAVE'), false);
});
test('frozen inputs and reordered registries retain detached deterministic observations', () => {
  const f = fixture(), first = read(f); f.context.skills.reverse(); f.actions.summoning.nonShardItemCosts.reverse();
  assert.deepEqual(read(f), first);
  const seen = new Set(); function freeze(value) { if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); } else Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.game); freeze(f.context); assert.deepEqual(read(f), first);
  first.skills.find(value => value.kind === 'fletching').entries[0].data.nominal.alternativeCosts[0].itemCosts[0].quantity = 999;
  assert.equal(f.actions.fletching.alternativeCosts[0].itemCosts[0].quantity, 4);
  first.plannerDrafts[0].itemCosts[0].quantity = 999; assert.equal(data(read(f), 'crafting').observed.itemCosts[0].quantity, 2);
});
test('all observed artisan drafts retain unknown cost/quantity/operation evidence', () => {
  const result = read(fixture()); for (const draft of result.plannerDrafts) { assert.equal(draft.outputs[0].quantity, null);
    assert.equal(draft.costEvidence, 'unknown'); assert.equal(draft.evidence, 'unknown'); assert.equal(draft.runnable, false); }
  assert.ok(result.recipeActions.every(value => value.evidence === 'unknown' && value.reliabilityPerBatch === null));
});
test('default ten-skill observations coexist with a separately unresolved herblore product', () => {
  const f = fixture(), raw = object('Raw'), category = object('OldCategory'), tree = object('Tree', { product: raw, level: 1, abyssalLevel: 0,
    baseExperience: 5, baseAbyssalExperience: 0, baseInterval: 3000, requirements: [], randomProducts: [] });
  const base = (name, action, extra = {}) => object(name, { isUnlocked: true, level: 50, abyssalLevel: 1, rareDrops: [], actions: { allObjects: [action] },
    isMasteryActionUnlocked: () => true, getDoublingChance: () => 0, getPreservationChance: () => 0, baseInterval: 3000,
    modifyInterval: () => 2500, getRecipeCosts: () => costs(raw, 1), ...extra });
  f.game.woodcutting = base('Woodcutting', tree, { defaultRandomProducts: [], randomProducts: new Map(), randomJewelry: [],
    isTreeUnlocked: () => true, getTreeInterval: () => 2500, getTreeMultiplier: () => 1 });
  f.game.smithing = base('Smithing', { ...tree, baseQuantity: 1, itemCosts: [{ item: raw, quantity: 1 }], currencyCosts: [] });
  f.game.mining = base('Mining', { ...tree, baseQuantity: 1, category, baseRespawnInterval: 10_000, totalMasteryRequired: 0,
    hasPassiveRegen: true, giveGems: false, currentHP: 5, maxHP: 5, isRespawning: false }, { canMineOre: () => true,
    getRockGemChance: () => 0, getRockSuperiorGemChance: () => 0, getRockAbyssalGemChance: () => 0 });
  const fish = { ...tree, baseMinInterval: 2000, baseMaxInterval: 4000, strengthXP: 0 }, area = object('Lake', { fish: [fish], fishChance: 100, junkChance: 0, specialChance: 0, isSecret: false }); fish.area = area;
  f.game.fishing = base('Fishing', fish, { areas: { allObjects: [area] }, junkItems: [], secretAreaUnlocked: false,
    getMinFishInterval: () => 2000, getMaxFishInterval: () => 4000, getAreaChances: () => ({ fish: 100, junk: 0, special: 0 }) });
  const cookingCategory = object('CookingCategory', { upgradeRequired: false, upgradeOwned: false });
  f.game.cooking = base('Cooking', { ...tree, baseQuantity: 1, category: cookingCategory, perfectItem: object('Perfect'), discoveredItems: [],
    itemCosts: [{ item: raw, quantity: 1 }], currencyCosts: [] }, { categories: { allObjects: [cookingCategory] },
    passiveCookTimers: new Map(), stockpileItems: new Map(), getRecipeCookingInterval: () => 2500, getRecipePassiveCookingInterval: () => 10_000,
    getRecipeSuccessChance: () => 100, getRecipePerfectChance: () => 0 });
  delete f.context.skills; const result = read(f); assert.equal(result.supported, true); assert.equal(result.skills.length, 10);
  assert.equal(result.plannerDrafts.length, 9); assert.equal(result.unresolvedDrafts.length, 1); assert.equal(result.planningReady, false);
});
