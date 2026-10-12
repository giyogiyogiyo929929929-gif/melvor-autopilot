/** Mock-only passive farming observation. Never grows, plants, harvests or gives rewards. */
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const STATES = ['locked', 'empty', 'growing', 'grown', 'dead'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const percent = value => amount(value) && value <= 100;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const requireValue = valid => { if (!valid) throw new Error('farming-observation-invalid'); };
const unavailable = reason => ({ supported: false, status: 'blocked', reason, records: [] });
function blocked(reason) {
  return { version: null, observationId: null, mode: null, skill: null, supported: false, status: 'blocked', reason,
    origin: 'mock-only', sections: Object.fromEntries(['categories', 'recipes', 'plots', 'composts', 'timers'].map(key => [key, unavailable(reason)])),
    planningReady: false, harvestProjection: null, runnable: false };
}
export function readFarmingSnapshot(_game, _context) { return { ...blocked('runtime-farming-adapter-unverified'), origin: 'runtime-disabled' }; }
function identity(object) {
  const value = { id: object?.id, namespace: object?.namespace, isModded: object?.isModded };
  requireValue(id(value.id) && typeof value.isModded === 'boolean' && typeof value.namespace === 'string' &&
    value.id.startsWith(`${value.namespace}:`) && (value.isModded || SCOPES.has(value.namespace)));
  return value;
}
function quantities(source, currency = false) {
  requireValue(Array.isArray(source) && source.length <= (currency ? 64 : 128));
  const seen = new Set();
  return source.map(entry => {
    const key = identity(entry?.[currency ? 'currency' : 'item']).id, value = entry.quantity;
    requireValue(!seen.has(key) && (currency ? amount(value) : count(value))); seen.add(key);
    return currency ? { id: key, amount: value } : { id: key, quantity: value };
  }).sort((a, b) => compare(a.id, b.id));
}
function registry(get, ownership, maximum, observe, allowEmpty = false) {
  try {
    const source = get()?.allObjects;
    requireValue(Array.isArray(source) && (allowEmpty || source.length > 0) && source.length <= maximum);
    const byObject = new Map(), seen = new Set(), records = [];
    // Check identities before any content getter. Ambiguous registries have no usable records.
    const identities = source.map(object => { const value = identity(object); requireValue(!seen.has(value.id)); seen.add(value.id); return value; });
    for (let index = 0; index < source.length; index++) {
      const object = source[index], value = identities[index], scopeId = SCOPES.get(value.namespace) ?? null;
      const owned = ownership?.[scopeId], excluded = value.isModded || owned === false;
      let record = { id: value.id, scopeId, supported: false, status: excluded ? 'excluded' : 'blocked',
        reason: value.isModded ? 'mod-object-excluded' : excluded ? 'scope-not-owned' : 'scope-ownership-unverified', data: null };
      if (!value.isModded && owned === true) {
        try { record = { ...record, supported: true, status: 'observed', reason: null, data: observe(object) }; }
        catch { record.reason = 'farming-record-invalid'; }
      }
      byObject.set(object, record); records.push(record);
    }
    records.sort((a, b) => compare(a.id, b.id));
    const supported = records.every(record => record.status !== 'blocked');
    return { view: { supported, status: supported ? 'observed' : 'blocked', reason: supported ? null : 'farming-section-incomplete', records }, byObject };
  } catch { return { view: unavailable('farming-registry-invalid'), byObject: new Map() }; }
}
function related(object, registry) {
  const record = registry.byObject.get(object); requireValue(record?.status === 'observed'); return record;
}
function categoryData(category) {
  const returnSeeds = category.returnSeeds, scaleXPWithQuantity = category.scaleXPWithQuantity, giveXPOnPlant = category.giveXPOnPlant,
    harvestMultiplier = category.harvestMultiplier, masteryXPDivider = category.masteryXPDivider;
  requireValue([returnSeeds, scaleXPWithQuantity, giveXPOnPlant].every(value => typeof value === 'boolean') &&
    amount(harvestMultiplier) && harvestMultiplier > 0 && amount(masteryXPDivider) && masteryXPDivider > 0);
  return { returnSeeds, scaleXPWithQuantity, giveXPOnPlant, harvestMultiplier, masteryXPDivider, effectEvidence: 'unknown' };
}
function compostData(compost) {
  const compostValue = compost.compostValue, harvestBonus = compost.harvestBonus, disableSeedRefund = compost.disableSeedRefund;
  const cost = quantities([compost.compostAllCost], true)[0];
  requireValue(amount(compostValue) && amount(harvestBonus) && typeof disableSeedRefund === 'boolean');
  return { compostValue, harvestBonus, disableSeedRefund, nominalApplyAllCost: cost, effectEvidence: 'unknown' };
}
function recipeData(recipe, farming, categories) {
  const category = related(recipe.category, categories), productId = identity(recipe.product).id;
  const requiredLevel = recipe.level, requiredAbyssalLevel = recipe.abyssalLevel, baseXP = recipe.baseExperience,
    baseAbyssalXP = recipe.baseAbyssalExperience, baseIntervalRaw = recipe.baseInterval, baseQuantity = recipe.baseQuantity;
  const seed = quantities([recipe.seedCost])[0]; requireValue(seed.quantity > 0);
  const eligible = farming.isMasteryActionUnlocked(recipe), seedCost = farming.getRecipeSeedCost(recipe), intervalRaw = farming.getRecipeInterval(recipe);
  requireValue(count(requiredLevel) && count(requiredAbyssalLevel) && amount(baseXP) && amount(baseAbyssalXP) &&
    amount(baseIntervalRaw) && baseIntervalRaw > 0 && count(baseQuantity) && baseQuantity > 0 &&
    typeof eligible === 'boolean' && count(seedCost) && amount(intervalRaw) && intervalRaw > 0);
  return { categoryId: category.id, productId, requiredLevel, requiredAbyssalLevel,
    nominal: { baseXP, baseAbyssalXP, baseIntervalRaw, baseQuantity, seed },
    observed: { masteryEligibility: eligible, seedCost, intervalRaw }, intervalUnitEvidence: 'unknown', effectEvidence: 'unknown' };
}
function plotData(plot, farming, categories, recipes, composts) {
  const category = related(plot.category, categories), stateRaw = plot.state, level = plot.level, abyssalLevel = plot.abyssalLevel,
    compostLevel = plot.compostLevel, growthTimeSeconds = plot.growthTime;
  requireValue(count(stateRaw) && stateRaw <= 4 && count(level) && count(abyssalLevel) && percent(compostLevel) && amount(growthTimeSeconds));
  const planted = plot.plantedRecipe, selected = plot.selectedRecipe, compost = plot.compostItem;
  const recipeReference = object => {
    if (object === undefined) return null;
    const record = related(object, recipes); requireValue(record.data.categoryId === category.id); return record.id;
  };
  const plantedRecipeId = recipeReference(planted), selectedRecipeId = recipeReference(selected);
  requireValue(stateRaw >= 2 ? plantedRecipeId !== null : plantedRecipeId === null);
  const compostItemId = compost === undefined ? null : related(compost, composts).id;
  requireValue(compostLevel === 0 || compostItemId !== null);
  const nominalUnlockItems = quantities(plot.itemCosts), nominalUnlockCurrencies = quantities(plot.currencyCosts, true);
  let canUnlock = null, effectiveUnlockItems = null, effectiveUnlockCurrencies = null, growthChancePercent = null, growthTimeRaw = null;
  if (stateRaw === 0) {
    const effective = farming.getPlotUnlockCosts(plot); canUnlock = farming.canUnlockPlot(plot);
    requireValue(typeof canUnlock === 'boolean'); effectiveUnlockItems = quantities(effective.getItemQuantityArray());
    effectiveUnlockCurrencies = quantities(effective.getCurrencyQuantityArray(), true);
  }
  if (stateRaw === 2) {
    growthChancePercent = farming.getPlotGrowthChance(plot); growthTimeRaw = farming.getPlotGrowthTime(plot);
    requireValue(percent(growthChancePercent) && amount(growthTimeRaw));
  }
  return { categoryId: category.id, stateRaw, state: STATES[stateRaw], requiredLevel: level, requiredAbyssalLevel: abyssalLevel,
    plantedRecipeId, selectedRecipeId, compostItemId, compostLevel, growthTimeSeconds,
    nominalUnlockItems, nominalUnlockCurrencies, observed: { canUnlock, effectiveUnlockItems, effectiveUnlockCurrencies, growthChancePercent, growthTimeRaw },
    helperTimeUnitEvidence: 'unknown', remainingTimeMs: null, guaranteedHarvest: null, effectEvidence: 'unknown' };
}
function timerData(farming, plots) {
  try {
    const timers = farming.growthTimers, mapping = farming.growthTimerMap;
    requireValue(plots.view.supported && timers instanceof Set && timers.size <= 1024 && mapping instanceof Map && mapping.size <= 1024);
    const records = [], membership = new Map(); let edges = 0;
    for (const timer of timers) {
      const references = timer.plots;
      requireValue(Array.isArray(references) && references.length > 0 && references.length <= 1024 && edges + references.length <= 4096);
      edges += references.length; const entries = references.map(plot => plots.byObject.get(plot));
      requireValue(entries.every(entry => entry !== undefined) && new Set(references).size === references.length);
      for (const plot of references) { requireValue(mapping.get(plot) === timer && !membership.has(plot)); membership.set(plot, timer); }
      const excluded = entries.every(entry => entry.status === 'excluded');
      if (excluded) { records.push({ status: 'excluded', reason: 'timer-scopes-excluded', plotIds: entries.map(entry => entry.id).sort(compare) }); continue; }
      for (let index = 0; index < references.length; index++) {
        const plot = references[index], entry = entries[index];
        requireValue(entry.status === 'observed' && entry.data.state === 'growing');
      }
      records.push({ status: 'observed', reason: null, plotIds: entries.map(entry => entry.id).sort(compare) });
    }
    for (const [plot, timer] of mapping) {
      const record = plots.byObject.get(plot); requireValue(record !== undefined && timers.has(timer));
      requireValue(membership.get(plot) === timer);
    }
    for (const [plot, record] of plots.byObject) if (record.status === 'observed' && record.data.state === 'growing') requireValue(membership.has(plot));
    records.sort((a, b) => compare(JSON.stringify(a.plotIds), JSON.stringify(b.plotIds)));
    return { supported: true, status: 'observed', reason: null, records, membershipEdges: edges, timeProjection: null };
  } catch { return { ...unavailable('farming-timer-membership-invalid'), membershipEdges: null, timeProjection: null }; }
}
export function readFarmingForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return blocked('version-unverified');
    const maximumBytes = context.maximumBytes === undefined ? 1_048_576 : context.maximumBytes;
    if (!id(context.observationId) || context.observationId.length > 256 || context.ownership?.base !== true ||
        !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 4_194_304) return blocked('farming-context-unverified');
    const mode = game.currentGamemode, modeId = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid;
    requireValue(id(modeId) && typeof hardcore === 'boolean' && typeof raid === 'boolean');
    if (raid) return blocked('raid-farming-unverified');
    const farming = game.farming, value = identity(farming), unlocked = farming.isUnlocked, level = farming.level, abyssalLevel = farming.abyssalLevel;
    requireValue(!value.isModded && SCOPES.get(value.namespace) === 'base' && typeof unlocked === 'boolean' && count(level) && count(abyssalLevel));
    const categories = registry(() => farming.categories, context.ownership, 256, categoryData);
    const composts = registry(() => farming.composts, context.ownership, 256, compostData, true);
    const recipes = registry(() => farming.actions, context.ownership, 2048, recipe => recipeData(recipe, farming, categories));
    const plots = registry(() => farming.plots, context.ownership, 1024, plot => plotData(plot, farming, categories, recipes, composts));
    const sections = { categories: categories.view, recipes: recipes.view, plots: plots.view, composts: composts.view, timers: timerData(farming, plots) };
    const supported = Object.values(sections).every(section => section.supported) && plots.view.records.some(record => record.status === 'observed');
    const result = { version: context.version, observationId: context.observationId, mode: { id: modeId, hardcore },
      skill: { id: value.id, isUnlocked: unlocked, level, abyssalLevel }, origin: 'mock-only', supported,
      status: supported ? 'observed' : 'blocked', reason: supported ? null : 'farming-observation-incomplete', sections,
      planningReady: false, harvestProjection: null, runnable: false };
    return new TextEncoder().encode(JSON.stringify(result)).length <= maximumBytes ? result : blocked('farming-output-byte-limit');
  } catch { return blocked('farming-mode-or-skill-invalid'); }
}
