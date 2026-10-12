/** Mock-only catalog observer. Nominal data and getters never become verified effects. */
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const EXTRA_ARTISANS = ['crafting', 'fletching', 'runecrafting', 'herblore', 'summoning'];
const KINDS = ['woodcutting', 'smithing', 'mining', 'fishing', 'cooking', ...EXTRA_ARTISANS];
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const percent = value => number(value) && value <= 100;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function requireValue(valid) { if (!valid) throw new Error('catalog-observation-invalid'); }
function identity(object) {
  const value = { id: object?.id, namespace: object?.namespace, isModded: object?.isModded };
  requireValue(id(value.id) && typeof value.namespace === 'string' && typeof value.isModded === 'boolean' &&
    value.id.startsWith(`${value.namespace}:`) && (value.isModded || SCOPES.has(value.namespace)));
  return value;
}
function blocked(reason) {
  return { version: null, observationId: null, mode: null, origin: 'mock-only', status: 'blocked', reason,
    supported: false, planningReady: false, skills: [], plannerDrafts: [], unresolvedDrafts: [], recipeActions: [], runnable: false };
}
export function readProductionCatalog(_game, _context) {
  return { ...blocked('runtime-catalog-adapter-unverified'), origin: 'runtime-disabled' };
}
function idsFrom(items, max = 512) {
  requireValue(Array.isArray(items) && items.length <= max);
  return items.map(item => identity(item).id);
}
function costs(list, currency = false) {
  requireValue(Array.isArray(list) && list.length <= (currency ? 64 : 128));
  const seen = new Set();
  return list.map(entry => {
    const value = identity(entry?.[currency ? 'currency' : 'item']).id;
    const quantity = entry.quantity;
    requireValue(!seen.has(value) && (currency ? number(quantity) : count(quantity)));
    seen.add(value);
    return currency ? { id: value, amount: quantity } : { id: value, quantity };
  }).sort((a, b) => compare(a.id, b.id));
}
function commonOutputs(skill, kind) {
  requireValue(Array.isArray(skill.rareDrops) && skill.rareDrops.length <= 128);
  const result = [];
  for (const drop of skill.rareDrops) {
    result.push(identity(drop?.item).id);
    if (drop.altItem !== undefined) result.push(identity(drop.altItem).id);
  }
  if (kind === 'woodcutting') {
    result.push(...idsFrom(skill.defaultRandomProducts), ...idsFrom(skill.randomJewelry));
    requireValue(skill.randomProducts instanceof Map && skill.randomProducts.size <= 512);
    for (const item of skill.randomProducts.keys()) result.push(identity(item).id);
  }
  if (kind === 'mining') for (const property of ['coalItem', 'runestoneItem']) {
    if (skill[property] !== undefined) result.push(identity(skill[property]).id);
  }
  if (kind === 'fishing') result.push(...idsFrom(skill.junkItems));
  const unique = [...new Set(result)].sort(compare);
  requireValue(unique.length <= 512);
  return unique;
}

function relatedRegistry(skill, kind) {
  if (!['fishing', 'cooking', ...EXTRA_ARTISANS].includes(kind)) return null;
  const source = skill[kind === 'fishing' ? 'areas' : 'categories']?.allObjects;
  requireValue(Array.isArray(source) && source.length > 0 && source.length <= 256);
  const result = new Map();
  for (const object of source) { const value = identity(object); requireValue(!result.has(value.id)); result.set(value.id, object); }
  return result;
}
function uniqueIds(objects, maximum) {
  const values = idsFrom(objects, maximum); requireValue(new Set(values).size === values.length); return values;
}
function extraArtisanObservation(skill, action, kind, constraints, nominal, observed) {
  if (['crafting', 'fletching'].includes(kind)) constraints.subcategoryId = action.subcategory === undefined ? null : identity(action.subcategory).id;
  if (kind === 'fletching') {
    requireValue(skill.setAltRecipes instanceof Map && skill.setAltRecipes.size <= 1024);
    const alternatives = action.alternativeCosts === undefined ? [] : action.alternativeCosts;
    requireValue(Array.isArray(alternatives) && alternatives.length <= 64);
    nominal.alternativeCosts = alternatives.map((value, index) => {
      const quantityMultiplier = value?.quantityMultiplier; requireValue(number(quantityMultiplier) && quantityMultiplier > 0);
      return { indexRaw: index, itemCosts: costs(value.itemCosts), quantityMultiplier };
    });
    const index = skill.setAltRecipes.get(action);
    requireValue(index === undefined || count(index) && index <= 1024);
    observed.selectedAlternativeIndexRaw = index === undefined ? null : index;
    observed.alternativeMappingEvidence = 'unknown';
  }
  if (kind === 'runecrafting') {
    constraints.subcategoryIds = uniqueIds(action.subcategories, 64).sort(compare);
    const waterCombo = skill.doesRecipeMakeWaterComboRunes(action); requireValue(typeof waterCombo === 'boolean');
    observed.makesWaterComboRunes = waterCombo;
  }
  if (kind === 'herblore') {
    const potions = uniqueIds(action.potions, 4); requireValue(potions.length === 4);
    constraints.potionIdsInDeclaredOrder = potions;
    const potionTierRaw = skill.getPotionTier(action); requireValue(count(potionTierRaw) && potionTierRaw <= 4);
    observed.potionTierRaw = potionTierRaw; observed.potionProductMappingEvidence = 'unknown';
  }
  if (kind === 'summoning') {
    const tier = action.tier, maximumMarkLevel = action.maxMarkLevel;
    requireValue(count(tier) && tier >= 1 && tier <= 5 && count(maximumMarkLevel) && maximumMarkLevel >= 1 && maximumMarkLevel <= 1024);
    constraints.tier = tier; constraints.maximumMarkLevel = maximumMarkLevel;
    constraints.relatedSkillIds = uniqueIds(action.skills, 64).sort(compare);
    const choices = action.nonShardItemCosts, ids = uniqueIds(choices, 64);
    requireValue(skill.selectedNonShardCosts instanceof Map && skill.selectedNonShardCosts.size <= 1024);
    const selected = skill.selectedNonShardCosts.get(action), selectedId = selected === undefined ? null : identity(selected).id;
    requireValue(selected === undefined || choices.includes(selected) && ids.includes(selectedId));
    const markCount = skill.getMarkCount(action), markLevel = skill.getMarkLevel(action);
    requireValue(count(markCount) && count(markLevel) && markLevel <= maximumMarkLevel);
    nominal.nonShardItemIds = [...ids].sort(compare);
    observed.selectedNonShardItemId = selectedId; observed.markCount = markCount; observed.markLevel = markLevel;
    observed.alternativeNonShardCosts = choices.map(item => {
      const effective = skill.getAltRecipeCosts(action, item);
      return { itemId: identity(item).id, itemCosts: costs(effective.getItemQuantityArray()), currencyCosts: costs(effective.getCurrencyQuantityArray(), true) };
    }).sort((a, b) => compare(a.itemId, b.itemId));
  }
}
function relatedIdentity(object, registry, ownership) {
  const value = identity(object), scope = SCOPES.get(value.namespace);
  requireValue(!value.isModded && ownership?.[scope] === true && registry.get(value.id) === object);
  return value.id;
}
function chances(value) {
  const fish = value?.fish, junk = value?.junk, special = value?.special;
  requireValue(percent(fish) && percent(junk) && percent(special) && Math.abs(fish + junk + special - 100) <= 1e-7);
  return { fish, junk, special };
}
function passiveCooking(skill, registry, ownership) {
  try {
    requireValue(skill.passiveCookTimers instanceof Map && skill.passiveCookTimers.size <= 128 &&
      skill.stockpileItems instanceof Map && skill.stockpileItems.size <= 128);
    const timerCategoryIds = [], stockpiles = [];
    for (const category of skill.passiveCookTimers.keys()) timerCategoryIds.push(relatedIdentity(category, registry, ownership));
    for (const [category, stack] of skill.stockpileItems) {
      const categoryId = relatedIdentity(category, registry, ownership), itemId = identity(stack?.item).id;
      requireValue(count(stack.quantity)); stockpiles.push({ categoryId, itemId, quantity: stack.quantity });
    }
    requireValue(new Set(timerCategoryIds).size === timerCategoryIds.length && new Set(stockpiles.map(value => value.categoryId)).size === stockpiles.length);
    const activeCategoryId = skill.activeCookingCategory === undefined ? null : relatedIdentity(skill.activeCookingCategory, registry, ownership);
    return { supported: true, reason: null, timerCategoryIds: timerCategoryIds.sort(compare),
      stockpiles: stockpiles.sort((a, b) => compare(a.categoryId, b.categoryId)), activeCategoryId, bankInventoryIncluded: false };
  } catch { return { supported: false, reason: 'passive-cooking-observation-invalid', timerCategoryIds: [], stockpiles: [], activeCategoryId: null, bankInventoryIncluded: false }; }
}

function readSkill(game, kind, ownership) {
  try {
    const skill = game[kind], skillObject = identity(skill);
    requireValue(!skillObject.isModded && SCOPES.get(skillObject.namespace) === 'base');
    const isUnlocked = skill.isUnlocked, level = skill.level, abyssalLevel = skill.abyssalLevel;
    requireValue(typeof isUnlocked === 'boolean' && count(level) && count(abyssalLevel));
    const source = skill.actions?.allObjects;
    requireValue(Array.isArray(source) && source.length > 0 && source.length <= 1024);
    const common = commonOutputs(skill, kind), related = relatedRegistry(skill, kind), seen = new Set();
    const entries = [];
    for (const action of source) {
      let actionObject;
      try { actionObject = identity(action); }
      catch { return { kind, supported: false, status: 'blocked', reason: 'action-registry-invalid', skillId: skillObject.id, entries: [] }; }
      if (seen.has(actionObject.id)) return { kind, supported: false, status: 'blocked', reason: 'action-registry-duplicate', skillId: skillObject.id, entries: [] };
      seen.add(actionObject.id);
      const scopeId = SCOPES.get(actionObject.namespace) ?? null;
      const catalogId = JSON.stringify([skillObject.id, actionObject.id]);
      const owned = scopeId === null ? null : ownership?.[scopeId];
      if (actionObject.isModded || owned !== true) {
        const excluded = actionObject.isModded || owned === false;
        entries.push({ catalogId, actionId: actionObject.id, scopeId, supported: false,
          status: excluded ? 'excluded' : 'blocked', reason: actionObject.isModded ? 'mod-action-excluded'
            : excluded ? 'scope-not-owned' : 'scope-ownership-unknown', data: null, runnable: false });
        continue;
      }
      try {
        const productId = kind === 'herblore' ? null : identity(action.product).id;
        const requiredLevel = action.level, requiredAbyssalLevel = action.abyssalLevel;
        const baseXP = action.baseExperience, baseAbyssalXP = action.baseAbyssalExperience;
        requireValue(count(requiredLevel) && count(requiredAbyssalLevel) && number(baseXP) && number(baseAbyssalXP));
        let baseQuantity = null, nominalItems = [], nominalCurrencies = [], effectiveItems = null, effectiveCurrencies = null;
        let baseInterval = null, intervalMs = null, eligibility, preservationPercent = null, treeMultiplier = null, requirementCount = null;
        const nominalDetails = {}, observedDetails = {}, constraints = {};
        const staticOutputs = productId === null ? [...common] : [...common, productId];
        if (kind === 'woodcutting') {
          baseInterval = action.baseInterval;
          requireValue(Array.isArray(action.requirements) && action.requirements.length <= 128);
          requirementCount = action.requirements.length;
          staticOutputs.push(...idsFrom(action.randomProducts));
          eligibility = skill.isTreeUnlocked(action);
          intervalMs = skill.getTreeInterval(action);
          treeMultiplier = skill.getTreeMultiplier(action);
          requireValue(number(treeMultiplier));
        } else if (kind === 'mining') {
          baseQuantity = action.baseQuantity; baseInterval = skill.baseInterval;
          const baseRespawnIntervalMs = action.baseRespawnInterval, totalMasteryRequired = action.totalMasteryRequired,
            hasPassiveRegen = action.hasPassiveRegen, givesGems = action.giveGems, currentHP = action.currentHP,
            maximumHP = action.maxHP, isRespawning = action.isRespawning;
          requireValue(count(baseQuantity) && baseQuantity > 0 && number(baseRespawnIntervalMs) && baseRespawnIntervalMs > 0 &&
            count(totalMasteryRequired) && typeof hasPassiveRegen === 'boolean' && typeof givesGems === 'boolean' &&
            count(currentHP) && count(maximumHP) && currentHP <= maximumHP && typeof isRespawning === 'boolean');
          eligibility = skill.isMasteryActionUnlocked(action); intervalMs = skill.modifyInterval(baseInterval, action);
          const canMine = skill.canMineOre(action);
          requireValue(typeof canMine === 'boolean');
          constraints.categoryId = identity(action.category).id;
          constraints.totalMasteryRequired = totalMasteryRequired;
          constraints.shopPurchaseId = action.shopItemPurchased === undefined ? null : identity(action.shopItemPurchased).id;
          Object.assign(nominalDetails, { baseRespawnIntervalMs, hasPassiveRegen, givesGems });
          Object.assign(observedDetails, { currentHP, maximumHP, isRespawning, canMine });
          for (const [property, method] of [['gemPercent', 'getRockGemChance'], ['superiorGemPercent', 'getRockSuperiorGemChance'], ['abyssalGemPercent', 'getRockAbyssalGemChance']]) {
            const value = skill[method](action); requireValue(percent(value)); observedDetails[property] = value;
          }
        } else if (kind === 'fishing') {
          const area = action.area; constraints.areaId = relatedIdentity(area, related, ownership);
          const fishIds = idsFrom(area.fish, 1024);
          requireValue(new Set(fishIds).size === fishIds.length && area.fish.includes(action) &&
            typeof area.isSecret === 'boolean' && typeof skill.secretAreaUnlocked === 'boolean' && number(action.strengthXP));
          constraints.requiredEquipmentId = area.requiredItem === undefined ? null : identity(area.requiredItem).id;
          constraints.isSecret = area.isSecret; constraints.hasPOIRequirement = area.poiRequirement !== undefined;
          nominalDetails.baseMinIntervalMs = action.baseMinInterval; nominalDetails.baseMaxIntervalMs = action.baseMaxInterval;
          nominalDetails.strengthXP = action.strengthXP;
          nominalDetails.areaChances = chances({ fish: area.fishChance, junk: area.junkChance, special: area.specialChance });
          const minimum = skill.getMinFishInterval(action), maximum = skill.getMaxFishInterval(action);
          requireValue(number(action.baseMinInterval) && action.baseMinInterval > 0 && number(action.baseMaxInterval) && action.baseMaxInterval >= action.baseMinInterval &&
            number(minimum) && minimum > 0 && number(maximum) && maximum >= minimum);
          observedDetails.minIntervalMs = minimum; observedDetails.maxIntervalMs = maximum;
          observedDetails.areaChances = chances(skill.getAreaChances(area)); observedDetails.secretAreaUnlocked = skill.secretAreaUnlocked;
          eligibility = skill.isMasteryActionUnlocked(action);
        } else {
          baseQuantity = kind === 'herblore' ? null : action.baseQuantity;
          requireValue(kind === 'herblore' || count(baseQuantity) && baseQuantity > 0);
          nominalItems = costs(action.itemCosts); nominalCurrencies = costs(action.currencyCosts, true);
          baseInterval = kind === 'cooking' ? action.baseInterval : skill.baseInterval;
          eligibility = skill.isMasteryActionUnlocked(action);
          intervalMs = kind === 'cooking' ? skill.getRecipeCookingInterval(action) : skill.modifyInterval(baseInterval, action);
          const effective = skill.getRecipeCosts(action);
          effectiveItems = costs(effective.getItemQuantityArray()); effectiveCurrencies = costs(effective.getCurrencyQuantityArray(), true);
          preservationPercent = skill.getPreservationChance(action);
          requireValue(percent(preservationPercent));
          if (EXTRA_ARTISANS.includes(kind)) {
            constraints.categoryId = relatedIdentity(action.category, related, ownership);
            extraArtisanObservation(skill, action, kind, constraints, nominalDetails, observedDetails);
            if (kind === 'herblore') staticOutputs.push(...constraints.potionIdsInDeclaredOrder);
          }
          if (kind === 'cooking') {
            const category = action.category; constraints.categoryId = relatedIdentity(category, related, ownership);
            requireValue(typeof category.upgradeRequired === 'boolean' && typeof category.upgradeOwned === 'boolean');
            constraints.upgradeRequired = category.upgradeRequired; observedDetails.upgradeOwned = category.upgradeOwned;
            constraints.perfectProductId = identity(action.perfectItem).id;
            staticOutputs.push(constraints.perfectProductId, ...idsFrom(action.discoveredItems));
            const passiveIntervalMs = skill.getRecipePassiveCookingInterval(action), successPercent = skill.getRecipeSuccessChance(action), perfectPercent = skill.getRecipePerfectChance(action);
            requireValue(number(passiveIntervalMs) && passiveIntervalMs > 0 && percent(successPercent) && percent(perfectPercent));
            Object.assign(observedDetails, { passiveIntervalMs, successPercent, perfectPercent });
          }
        }
        const doublingPercent = skill.getDoublingChance(action);
        requireValue(typeof eligibility === 'boolean' && (kind === 'fishing' || number(baseInterval) && baseInterval > 0 &&
          number(intervalMs) && intervalMs > 0) && percent(doublingPercent));
        const observedOutputIds = [...new Set(staticOutputs)].sort(compare);
        requireValue(observedOutputIds.length <= 512);
        entries.push({ catalogId, actionId: actionObject.id, scopeId, supported: true, status: 'observed', reason: null,
          data: { productId, requiredLevel, requiredAbyssalLevel, additionalRequirementCount: requirementCount,
            nominal: { baseQuantity, baseIntervalMs: baseInterval, baseXP, baseAbyssalXP,
              itemCosts: nominalItems, currencyCosts: nominalCurrencies, ...nominalDetails },
            observed: { skillUnlocked: isUnlocked, actionEligibility: eligibility, intervalMs, treeMultiplier,
              preservationPercent, doublingPercent, itemCosts: effectiveItems, currencyCosts: effectiveCurrencies, ...observedDetails },
            ...(Object.keys(constraints).length ? { constraints } : {}),
            observedOutputIds, outputCoverage: 'partial', effectEvidence: 'unknown' }, runnable: false });
      } catch {
        entries.push({ catalogId, actionId: actionObject.id, scopeId, supported: false, status: 'blocked',
          reason: 'recipe-api-invalid', data: null, runnable: false });
      }
    }
    entries.sort((a, b) => compare(a.catalogId, b.catalogId));
    const passive = kind === 'cooking' ? passiveCooking(skill, related, ownership) : null;
    const supported = entries.some(entry => entry.status === 'observed') && entries.every(entry => entry.status !== 'blocked') && (passive === null || passive.supported);
    return { kind, skillId: skillObject.id, level, abyssalLevel, isUnlocked, supported,
      status: supported ? 'observed' : 'blocked', reason: supported ? null : 'skill-catalog-incomplete', entries,
      ...(passive === null ? {} : { passiveCooking: passive }), runnable: false };
  } catch { return { kind, skillId: null, supported: false, status: 'blocked', reason: 'skill-api-invalid', entries: [], runnable: false }; }
}

/** Context describes artificial version/ownership; no runtime enable flag exists. */
export function readProductionCatalogForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return blocked('version-unverified');
    if (!id(context.observationId) || context.observationId.length > 256 || context.ownership?.base !== true)
      return blocked('catalog-context-unverified');
    const kinds = context.skills === undefined ? KINDS : context.skills;
    if (!Array.isArray(kinds) || kinds.length < 1 || kinds.length > KINDS.length || new Set(kinds).size !== kinds.length ||
        kinds.some(kind => !KINDS.includes(kind))) return blocked('catalog-skills-invalid');
    const mode = game.currentGamemode, modeId = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid;
    requireValue(id(modeId) && typeof hardcore === 'boolean' && typeof raid === 'boolean');
    if (raid) return blocked('raid-catalog-unverified');
    const skills = [...kinds].sort(compare).map(kind => readSkill(game, kind, context.ownership));
    const plannerDrafts = [], unresolvedDrafts = [], recipeActions = [];
    for (const skill of skills) for (const entry of skill.entries) {
      if (!entry.supported) continue;
      if (entry.data.productId === null) {
        unresolvedDrafts.push({ catalogId: entry.catalogId, reason: 'product-mapping-unverified', runnable: false }); continue;
      }
      // Drafts expose missing proof; neither baseQuantity nor multiplier is a yield guarantee.
      plannerDrafts.push({ id: entry.catalogId, scopeId: entry.scopeId, evidence: 'unknown', costEvidence: 'unknown',
        bankOrder: 'unknown', kind: 'noncombat', risk: 'unknown', unlocked: entry.data.observed.skillUnlocked && entry.data.observed.actionEligibility,
        outputs: [{ id: entry.data.productId, quantity: null }],
        itemCosts: entry.data.observed.itemCosts === null ? null : entry.data.observed.itemCosts.map(item => ({ ...item })),
        currencyCosts: entry.data.observed.currencyCosts === null ? null : entry.data.observed.currencyCosts.map(currency => ({ ...currency })),
        durationMs: entry.data.observed.intervalMs, possibleOutputIds: null, runnable: false });
      recipeActions.push({ recipeId: entry.catalogId, evidence: 'unknown', action: { id: skill.skillId,
        selectionIds: skill.kind === 'fishing' ? [entry.data.constraints.areaId, entry.actionId]
          : skill.kind === 'cooking' ? [entry.data.constraints.categoryId, entry.actionId]
          : skill.kind === 'summoning' && entry.data.observed.selectedNonShardItemId !== null
            ? [entry.actionId, entry.data.observed.selectedNonShardItemId] : [entry.actionId] },
        costPerBatch: null, reliabilityPerBatch: null, runnable: false });
    }
    const supported = skills.every(skill => skill.supported);
    return { version: context.version, observationId: context.observationId, mode: { id: modeId, hardcore }, origin: 'mock-only',
      supported, status: supported ? 'observed' : 'blocked', reason: supported ? null : 'catalog-observation-incomplete',
      planningReady: false, skills, plannerDrafts, unresolvedDrafts, recipeActions, runnable: false };
  } catch { return blocked('catalog-mode-or-context-invalid'); }
}
