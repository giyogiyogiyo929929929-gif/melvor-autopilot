/** Internal mock adapter extension. Reads selected properties only, never dynamic action getters. */
const TYPES = { Mining: 'mining', Fishing: 'fishing', Cooking: 'cooking', Smithing: 'smithing', Crafting: 'crafting', Fletching: 'fletching',
  Runecrafting: 'runecrafting', Herblore: 'herblore', Summoning: 'summoning' };
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const requireValue = valid => { if (!valid) throw new Error('noncombat-selection-invalid'); };
export function noncombatKind(actionId) {
  const [namespace, local] = typeof actionId === 'string' ? actionId.split(':') : [];
  return ['melvorD', 'melvorF'].includes(namespace) && Object.hasOwn(TYPES, local) ? TYPES[local] : null;
}
function identity(object, ownership) {
  const value = { id: object?.id, namespace: object?.namespace, isModded: object?.isModded };
  requireValue(id(value.id) && value.isModded === false && typeof value.namespace === 'string' && value.id.startsWith(`${value.namespace}:`) && ownership[SCOPES.get(value.namespace)] === true);
  return value.id;
}
function registered(registry, object, ownership) {
  const objectId = identity(object, ownership); requireValue(registry.getObjectByID(objectId) === object); return objectId;
}
export function observeNoncombatSelection(game, actionId, ownership, activity) {
  const kind = noncombatKind(actionId), skill = game[kind]; requireValue(identity(skill, ownership) === actionId);
  const unlocked = skill.isUnlocked, isActive = skill.isActive, canStop = skill.canStop;
  requireValue(typeof unlocked === 'boolean' && typeof isActive === 'boolean' && typeof canStop === 'boolean');
  requireValue(!isActive || activity.active?.id === actionId && activity.active.isActive);
  requireValue(isActive || activity.active?.id !== actionId || !activity.active.isActive || activity.isPaused);
  const selectionIds = []; let variant;
  if (kind === 'mining') {
    const selected = skill.selectedRock; if (selected !== undefined) selectionIds.push(registered(skill.actions, selected, ownership));
  } else if (kind === 'fishing') {
    const area = skill.activeFishingArea; requireValue(skill.selectedAreaFish instanceof Map && skill.selectedAreaFish.size <= 1024);
    if (area !== undefined) {
      const areaId = registered(skill.areas, area, ownership), fish = skill.selectedAreaFish.get(area), fishId = registered(skill.actions, fish, ownership);
      requireValue(fish.area === area && Array.isArray(area.fish) && area.fish.length <= 128 && area.fish.includes(fish)); selectionIds.push(areaId, fishId);
    }
  } else if (kind === 'cooking') {
    const category = skill.activeCookingCategory; requireValue(skill.selectedRecipes instanceof Map && skill.selectedRecipes.size <= 1024);
    if (category !== undefined) {
      const categoryId = registered(skill.categories, category, ownership), recipe = skill.selectedRecipes.get(category), recipeId = registered(skill.actions, recipe, ownership);
      requireValue(recipe.category === category); selectionIds.push(categoryId, recipeId);
    }
  } else {
    const recipe = skill.selectedRecipe;
    if (recipe !== undefined) {
      selectionIds.push(registered(skill.actions, recipe, ownership));
      if (kind === 'fletching') {
        requireValue(skill.setAltRecipes instanceof Map && skill.setAltRecipes.size <= 1024);
        const index = skill.setAltRecipes.get(recipe); requireValue(index === undefined || Number.isSafeInteger(index) && index >= 0 && index <= 1024);
        variant = { kind: 'fletching', alternativeIndexRaw: index === undefined ? null : index };
      }
      if (kind === 'summoning') {
        requireValue(skill.selectedNonShardCosts instanceof Map && skill.selectedNonShardCosts.size <= 1024);
        const material = skill.selectedNonShardCosts.get(recipe); let materialId = null;
        if (material !== undefined) { materialId = identity(material, ownership); requireValue(Array.isArray(recipe.nonShardItemCosts) && recipe.nonShardItemCosts.length <= 128 && recipe.nonShardItemCosts.includes(material)); }
        variant = { kind: 'summoning', materialId }; if (materialId !== null) selectionIds.push(materialId);
      }
    }
  }
  requireValue(!isActive || selectionIds.length > 0);
  const state = activity.paused?.id === actionId || activity.isPaused && activity.active?.id === actionId ? 'paused' : isActive ? 'active' : selectionIds.length ? 'selected-inactive' : 'idle';
  return { supported: true, reason: null, woodcutting: null, skillState: { kind, unlocked, isActive, canStop, operationEvidence: 'unknown' },
    actionSelection: { supported: true, actionId, selectionIds: selectionIds.sort(), state, ...(variant === undefined ? {} : { variant }) } };
}
