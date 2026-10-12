/** Mock-only shop observer. Quotes never authorize purchases or project rewards. */
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const UINT32_MAX = 4_294_967_295;
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const requireValue = valid => { if (!valid) throw new Error('shop-observation-invalid'); };
const unavailable = reason => ({ supported: false, status: 'blocked', reason, records: [] });
function blocked(reason) {
  return { version: null, observationId: null, mode: null, origin: 'mock-only', supported: false, status: 'blocked', reason,
    categories: unavailable(reason), purchases: unavailable(reason), uiBuyQuantity: null, planningReady: false,
    purchaseProjection: null, runnable: false };
}
export function readShopSnapshot(_game, _context) { return { ...blocked('runtime-shop-adapter-unverified'), origin: 'runtime-disabled' }; }
function identity(object) {
  const value = { id: object?.id, namespace: object?.namespace, isModded: object?.isModded };
  requireValue(id(value.id) && typeof value.namespace === 'string' && typeof value.isModded === 'boolean' &&
    value.id.startsWith(`${value.namespace}:`) && (value.isModded || SCOPES.has(value.namespace)));
  return value;
}
function quantities(source, currency = false) {
  requireValue(Array.isArray(source) && source.length <= (currency ? 64 : 128)); const seen = new Set();
  return source.map(entry => {
    const key = identity(entry?.[currency ? 'currency' : 'item']).id, value = entry.quantity;
    requireValue(!seen.has(key) && (currency ? amount(value) : count(value))); seen.add(key);
    return currency ? { id: key, amount: value } : { id: key, quantity: value };
  }).sort((a, b) => compare(a.id, b.id));
}
function modeIds(source) {
  requireValue(source instanceof Set && source.size <= 128); const ids = [...source].map(mode => mode?.id);
  requireValue(ids.every(id) && new Set(ids).size === ids.length); return ids.sort(compare);
}
function indexRegistry(get, ownership, maximum) {
  try {
    const source = get()?.allObjects; requireValue(Array.isArray(source) && source.length > 0 && source.length <= maximum);
    const byObject = new Map(), seen = new Set(), allowedObjects = new Set();
    for (const object of source) {
      const value = identity(object); requireValue(!seen.has(value.id)); seen.add(value.id);
      const scopeId = SCOPES.get(value.namespace) ?? null, owned = ownership?.[scopeId], excluded = value.isModded || owned === false;
      if (!value.isModded && owned === true) allowedObjects.add(object);
      byObject.set(object, { id: value.id, scopeId, supported: false, status: excluded ? 'excluded' : owned === true ? 'pending' : 'blocked',
        reason: value.isModded ? 'mod-object-excluded' : excluded ? 'scope-not-owned' : owned === true ? null : 'scope-ownership-unverified', data: null });
    }
    return { supported: true, byObject, allowedObjects };
  } catch { return { supported: false, byObject: new Map(), allowedObjects: new Set() }; }
}
function section(index, observe) {
  if (!index.supported) return unavailable('shop-registry-invalid');
  const records = [];
  for (const [object, record] of index.byObject) {
    if (record.status === 'pending') {
      try { Object.assign(record, observe(object)); }
      catch { Object.assign(record, { status: 'blocked', reason: 'shop-record-invalid', data: null, supported: false }); }
    }
    records.push(record);
  }
  records.sort((a, b) => compare(a.id, b.id));
  const supported = records.every(record => record.status !== 'blocked');
  return { supported, status: supported ? 'observed' : 'blocked', reason: supported ? null : 'shop-section-incomplete', records };
}
function currencyModels(source) {
  requireValue(Array.isArray(source) && source.length <= 64); const seen = new Set();
  return source.map(cost => {
    const currencyId = identity(cost?.currency).id, type = cost.type;
    requireValue(!seen.has(currencyId)); seen.add(currencyId);
    if (type === 'Fixed' || type === 'Glove') { const value = cost.cost; requireValue(amount(value)); return { currencyId, type, cost: value, supported: true }; }
    if (type === 'Linear') { const initial = cost.initial, scaling = cost.scaling; requireValue(amount(initial) && amount(scaling)); return { currencyId, type, initial, scaling, supported: true }; }
    if (type === 'BankSlot') return { currencyId, type, supported: true };
    return { currencyId, type: 'unknown', supported: false, reason: 'shop-price-type-unverified' };
  }).sort((a, b) => compare(a.currencyId, b.currencyId));
}
function requirementData(requirement, purchaseIndex, ownership) {
  try {
    const type = requirement?.type;
    if (!['ShopPurchase', 'SkillLevel', 'AbyssalLevel'].includes(type)) return { type: 'unknown', supported: false,
      reason: 'shop-requirement-type-unverified', met: null };
    let details;
    if (type === 'ShopPurchase') {
      const target = purchaseIndex.byObject.get(requirement.purchase), requiredCount = requirement.count;
      requireValue(target && purchaseIndex.allowedObjects.has(requirement.purchase) && count(requiredCount) && requiredCount > 0);
      details = { purchaseId: target.id, scopeId: target.scopeId, requiredCount };
    } else {
      const skill = identity(requirement.skill), level = requirement.level, scopeId = SCOPES.get(skill.namespace);
      requireValue(!skill.isModded && ownership?.[scopeId] === true && count(level)); details = { skillId: skill.id, scopeId, level };
    }
    const met = requirement.isMet(); requireValue(typeof met === 'boolean');
    return { type, supported: true, reason: null, ...details, met };
  } catch { return { type: 'unknown', supported: false, reason: 'shop-requirement-observation-invalid', met: null }; }
}
function requirements(source, purchases, ownership) {
  requireValue(Array.isArray(source) && source.length <= 128);
  const entries = source.map(value => requirementData(value, purchases, ownership));
  entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const supported = entries.every(entry => entry.supported);
  return { entries, coverage: supported ? 'observed' : 'partial', met: supported ? entries.every(entry => entry.met) : null };
}
function contentsData(contains) {
  requireValue(contains && typeof contains === 'object');
  const items = quantities(contains.items), charges = contains.itemCharges;
  const itemCharges = charges === undefined ? null : quantities([charges])[0];
  const pet = contains.pet, lootBox = contains.lootBox, bankTab = contains.bankTab;
  requireValue((lootBox === undefined || typeof lootBox === 'boolean') && (bankTab === undefined || typeof bankTab === 'boolean'));
  return { nominalItems: items, nominalItemCharges: itemCharges, petId: pet === undefined ? null : identity(pet).id,
    lootBox: lootBox === true, bankTab: bankTab === true, hasStats: contains.stats !== undefined, effectCoverage: 'partial' };
}
function purchaseData(purchase, shop, mode, ownership, categories, purchases) {
  const category = categories.byObject.get(purchase.category);
  requireValue(category !== undefined);
  if (category.status === 'excluded') return { supported: false, status: 'excluded', reason: 'shop-category-excluded', data: null };
  requireValue(category.status === 'observed');
  const allowQuantityPurchase = purchase.allowQuantityPurchase, allowModes = modeIds(purchase.allowedGamemodes);
  requireValue(typeof allowQuantityPurchase === 'boolean');
  const purchaseCount = shop.getPurchaseCount(purchase), purchased = shop.isUpgradePurchased(purchase), atBuyLimit = shop.isPurchaseAtBuyLimit(purchase);
  requireValue(count(purchaseCount) && typeof purchased === 'boolean' && typeof atBuyLimit === 'boolean');
  if (shop.upgradesPurchased.has(purchase)) requireValue(shop.upgradesPurchased.get(purchase) === purchaseCount);
  const limit = purchase.getBuyLimit(mode);
  requireValue(limit === Infinity || count(limit) && limit <= UINT32_MAX);
  const cost = purchase.costs, nominalItems = quantities(cost?.items), models = currencyModels(cost.currencies);
  const unlock = requirements(purchase.unlockRequirements, purchases, ownership), required = requirements(purchase.purchaseRequirements, purchases, ownership);
  const cappedQuantity = shop.capPurchaseQuantity(purchase, 1); requireValue(count(cappedQuantity) && cappedQuantity <= 1);
  let quote = { supported: false, reason: cappedQuantity === 0 ? 'shop-quantity-capped-to-zero' : 'shop-price-type-unverified', quantity: cappedQuantity,
    itemCosts: null, currencyCosts: null, evidence: 'unverified' };
  if (cappedQuantity === 1 && models.every(model => model.supported)) {
    const effective = shop.getPurchaseCosts(purchase, cappedQuantity);
    quote = { supported: true, reason: null, quantity: cappedQuantity, itemCosts: quantities(effective.getItemQuantityArray()),
      currencyCosts: quantities(effective.getCurrencyQuantityArray(), true), evidence: 'mock-only' };
  }
  return { supported: true, status: 'observed', reason: null, data: { categoryId: category.id,
    allowedGamemodeIds: allowModes, currentModeListed: allowModes.includes(mode.id), modeEligibilityEvidence: 'partial',
    allowQuantityPurchase, observedPurchaseCount: purchaseCount, observedPurchased: purchased, observedAtBuyLimit: atBuyLimit,
    buyLimitRaw: limit === Infinity ? null : limit, buyLimitSpecial: limit === Infinity ? 'Infinity' : null, buyLimitMeaningEvidence: 'unknown',
    nominal: { itemCosts: nominalItems, currencyModels: models }, unlockRequirements: unlock, purchaseRequirements: required,
    requestedQuoteQuantity: 1, quote, contains: contentsData(purchase.contains), canPurchase: null, operationEvidence: 'unknown' } };
}
export function readShopForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return blocked('version-unverified');
    const maximumBytes = context.maximumBytes === undefined ? 1_048_576 : context.maximumBytes;
    if (!id(context.observationId) || context.observationId.length > 256 || context.ownership?.base !== true ||
        !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 4_194_304) return blocked('shop-context-unverified');
    const mode = game.currentGamemode, modeId = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid;
    requireValue(id(modeId) && typeof hardcore === 'boolean' && typeof raid === 'boolean');
    if (raid) return blocked('raid-shop-unverified');
    const shop = game.shop, uiBuyQuantity = shop.buyQuantity;
    requireValue(count(uiBuyQuantity) && uiBuyQuantity >= 1 && uiBuyQuantity <= UINT32_MAX && shop.upgradesPurchased instanceof Map && shop.upgradesPurchased.size <= 2048);
    const categoryIndex = indexRegistry(() => shop.categories, context.ownership, 256), purchaseIndex = indexRegistry(() => shop.purchases, context.ownership, 2048);
    const categories = section(categoryIndex, category => {
      const isRaid = category.isGolbinRaid; requireValue(typeof isRaid === 'boolean');
      if (isRaid) return { supported: false, status: 'excluded', reason: 'raid-shop-category-excluded', data: null };
      const modes = modeIds(category.allowedGamemodes);
      return { supported: true, status: 'observed', reason: null, data: { allowedGamemodeIds: modes, currentModeListed: modes.includes(modeId), modeEligibilityEvidence: 'partial' } };
    });
    const purchases = section(purchaseIndex, purchase => purchaseData(purchase, shop, mode, context.ownership, categoryIndex, purchaseIndex));
    const supported = categories.supported && purchases.supported && purchases.records.some(record => record.status === 'observed');
    const result = { version: context.version, observationId: context.observationId, mode: { id: modeId, hardcore }, origin: 'mock-only', supported,
      status: supported ? 'observed' : 'blocked', reason: supported ? null : 'shop-observation-incomplete', categories, purchases, uiBuyQuantity,
      planningReady: false, purchaseProjection: null, runnable: false };
    return new TextEncoder().encode(JSON.stringify(result)).length <= maximumBytes ? result : blocked('shop-output-byte-limit');
  } catch { return blocked('shop-mode-or-context-invalid'); }
}
