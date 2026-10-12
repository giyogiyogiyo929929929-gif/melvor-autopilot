import test from 'node:test';
import assert from 'node:assert/strict';
import { readActionSelectionForTesting } from '../src/action-selection.mjs';
const object = (name, extra = {}, namespace = 'melvorF') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
const registry = values => ({ getObjectByID: id => values.find(value => value.id === id), get allObjects() { throw new Error('must not scan'); } });
function fixture(name) {
  const recipe = object('Recipe'), region = object('Region'), material = object('Material');
  const skill = object(name, { isUnlocked: true, isActive: true, canStop: true, actions: registry([recipe]) });
  if (name === 'Mining') skill.selectedRock = recipe;
  else if (name === 'Fishing') { region.fish = [recipe]; recipe.area = region; skill.areas = registry([region]); skill.activeFishingArea = region; skill.selectedAreaFish = new Map([[region, recipe]]); }
  else if (name === 'Cooking') { recipe.category = region; skill.categories = registry([region]); skill.activeCookingCategory = region; skill.selectedRecipes = new Map([[region, recipe]]); }
  else { skill.selectedRecipe = recipe; if (name === 'Fletching') skill.setAltRecipes = new Map([[recipe, 1]]);
    if (name === 'Summoning') { recipe.nonShardItemCosts = [material]; skill.selectedNonShardCosts = new Map([[recipe, material]]); } }
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false, activeAction: skill, pausedAction: undefined, [name.toLowerCase()]: skill };
  return { game, skill, recipe, region, material, context: { version: 'v1.3.1', observationId: 'selection-frame', ownership: { base: true, toth: false, aod: false, ita: false } } };
}
const read = f => readActionSelectionForTesting(f.game, f.context);
test('nine added skills observe current selection without producing operation or output evidence', () => {
  for (const name of ['Mining', 'Fishing', 'Cooking', 'Smithing', 'Crafting', 'Fletching', 'Runecrafting', 'Herblore', 'Summoning']) {
    const result = read(fixture(name)); assert.equal(result.supported, true, name); assert.equal(result.actionSelection.state, 'active');
    assert.equal(result.skillState.operationEvidence, 'unknown'); assert.equal(result.woodcutting, null); assert.equal(result.runnable, false);
  }
});
test('fishing retains area plus fish, and cooking retains station plus recipe', () => {
  for (const name of ['Fishing', 'Cooking']) {
    const f = fixture(name); assert.deepEqual(read(f).actionSelection.selectionIds, [f.recipe.id, f.region.id].sort());
    if (name === 'Fishing') f.recipe.area = { ...f.region }; else f.recipe.category = { ...f.region };
    assert.equal(read(f).supported, false);
  }
});
test('inactive selected recipe is not execution and paused is separately represented', () => {
  const f = fixture('Smithing'); f.skill.isActive = false; f.game.activeAction = undefined; f.context.expectedActionId = f.skill.id;
  assert.equal(read(f).actionSelection.state, 'selected-inactive'); f.game.pausedAction = f.skill; f.game.isPaused = true;
  assert.equal(read(f).actionSelection.state, 'paused');
});
test('unset variants stay null and raw indices/materials do not imply quantity guarantees', () => {
  const f = fixture('Fletching'); assert.deepEqual(read(f).actionSelection.variant, { kind: 'fletching', alternativeIndexRaw: 1 });
  f.skill.setAltRecipes.clear(); assert.equal(read(f).actionSelection.variant.alternativeIndexRaw, null);
  const s = fixture('Summoning'); assert.equal(read(s).actionSelection.variant.materialId, s.material.id);
  s.skill.selectedNonShardCosts.clear(); assert.equal(read(s).actionSelection.variant.materialId, null);
});
test('invalid selections, maps, canonical references and unowned bodies fail closed', () => {
  for (const name of ['Mining', 'Fishing', 'Cooking', 'Smithing', 'Summoning']) {
    const f = fixture(name); f.skill.actions.getObjectByID = () => ({ ...f.recipe }); assert.equal(read(f).supported, false);
  }
  const f = fixture('Fishing'); f.skill.selectedAreaFish = null; assert.equal(read(f).supported, false);
  const s = fixture('Summoning'); s.skill.selectedNonShardCosts.set(s.recipe, { ...s.material }); assert.equal(read(s).supported, false);
  const unowned = fixture('Mining'); Object.assign(unowned.recipe, object('Recipe', {}, 'melvorItA'));
  Object.defineProperty(unowned.recipe, 'product', { get() { throw new Error('PRIVATE'); } }); const result = read(unowned);
  assert.equal(result.supported, false); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('missing selected object while active and invalid indices/maps are not defaulted', () => {
  for (const name of ['Mining', 'Smithing']) { const f = fixture(name); delete f.skill[name === 'Mining' ? 'selectedRock' : 'selectedRecipe']; assert.equal(read(f).supported, false); }
  const f = fixture('Fletching'); f.skill.setAltRecipes.set(f.recipe, NaN); assert.equal(read(f).supported, false);
  f.skill.setAltRecipes = new Map(Array.from({ length: 1025 }, (_, index) => [{ id: `Other${index}` }, 0])); assert.equal(read(f).supported, false);
});
test('dynamic action getters, variant getters, UI callbacks, reward and saving are not referenced', () => {
  for (const name of ['Mining', 'Fishing', 'Cooking', 'Smithing', 'Fletching', 'Summoning']) {
    const f = fixture(name); for (const property of ['activeRock', 'activeFish', 'activeRecipe', 'actionItem', 'unmodifiedActionQuantity', 'selectedAltRecipe',
      'activeNonShardCost', 'selectRecipeOnClick', 'createButtonOnClick', 'onRockClick', 'onAreaStartButtonClick', 'onActiveCookButtonClick',
      'selectAltRecipeOnClick', 'selectNonShardCostOnClick', 'actionRewards', 'start', 'stop', 'encode', 'decode'])
      Object.defineProperty(f.skill, property, { get() { throw new Error('must not read'); } });
    assert.equal(read(f).supported, true, name);
  }
});
test('snapshot values are primitive and detached from frozen maps and selections', () => {
  const f = fixture('Fletching'); Object.freeze(f.recipe); Object.freeze(f.context); const result = read(f);
  result.actionSelection.variant.alternativeIndexRaw = 99; result.actionSelection.selectionIds[0] = 'Fake'; assert.equal(f.skill.setAltRecipes.get(f.recipe), 1);
  assert.deepEqual(read(f).actionSelection.variant, { kind: 'fletching', alternativeIndexRaw: 1 });
});
