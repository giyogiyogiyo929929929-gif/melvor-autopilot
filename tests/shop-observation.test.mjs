import test from 'node:test';
import assert from 'node:assert/strict';
import { readShopSnapshot, readShopForTesting } from '../src/shop-observation.mjs';
import { buildShopPrerequisiteGraph, shopCountNodeId } from '../src/shop-prerequisites.mjs';
import { buildItemAcquisitionGraph } from '../src/production-prerequisites.mjs';
const object = (name, extra = {}, namespace = 'melvorD') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
function fixture() {
  const mode = object('Standard', { isPermaDeath: false }), gp = object('GP'), item = object('Material'), category = object('General', {
    isGolbinRaid: false, allowedGamemodes: new Set([mode]) });
  const priceModels = [{ type: 'Fixed', cost: 10 }, { type: 'Linear', initial: 5, scaling: 2 }, { type: 'BankSlot' }, { type: 'Glove', cost: 20 }];
  const purchases = priceModels.map((price, index) => object(`Purchase${index}`, { category, allowedGamemodes: new Set([mode]), allowQuantityPurchase: true,
    costs: { items: [{ item, quantity: 2 }], currencies: [{ ...price, currency: gp }] }, unlockRequirements: [], purchaseRequirements: [],
    contains: { items: [{ item: object(`Product${index}`), quantity: 3 }] }, getBuyLimit: () => index === 2 ? Infinity : 0 }));
  const history = new Map([[purchases[0], 2]]), quotes = [];
  const shop = { categories: { allObjects: [category] }, purchases: { allObjects: purchases }, upgradesPurchased: history, buyQuantity: 25,
    getPurchaseCount: purchase => history.get(purchase) ?? 0, isUpgradePurchased: purchase => (history.get(purchase) ?? 0) > 0,
    isPurchaseAtBuyLimit: () => false, capPurchaseQuantity: (_purchase, quantity) => quantity,
    getPurchaseCosts: (purchase, quantity) => { quotes.push({ id: purchase.id, quantity }); return {
      getItemQuantityArray: () => [{ item, quantity: 1 }], getCurrencyQuantityArray: () => [{ currency: gp, quantity: 9.25 }] }; } };
  purchases[1].unlockRequirements = [{ type: 'ShopPurchase', purchase: purchases[0], count: 1, isMet: () => true }];
  purchases[1].purchaseRequirements = [{ type: 'SkillLevel', skill: object('Smithing'), level: 20, isMet: () => false },
    { type: 'AbyssalLevel', skill: object('Smithing'), level: 2, isMet: () => true }];
  return { game: { currentGamemode: mode, isGolbinRaid: false, shop }, shop, mode, gp, item, category, purchases, history, quotes,
    context: { version: 'v1.3.1', observationId: 'synthetic-shop', ownership: { base: true, toth: false, aod: false, ita: false } } };
}
const read = f => readShopForTesting(f.game, f.context);
const entry = (result, index = 0) => result.purchases.records.find(value => value.id === `melvorD:Purchase${index}`);
test('observed shop requirements feed the pure dependency builder without API reentry', () => {
  const f = fixture(), observed = read(f), count = f.quotes.length;
  const result = buildShopPrerequisiteGraph(observed); assert.equal(result.supported, true);
  assert.equal(result.graph.nodes.find(value => value.id === shopCountNodeId('melvorD:Purchase0', 1)).completed, true);
  assert.ok(result.graph.nodes.some(value => value.type === 'SkillLevel' && value.level === 20));
  assert.equal(f.quotes.length, count); assert.equal(f.shop.buyQuantity, 25); assert.equal(result.runnable, false);
});
test('observed item purchase supplies an acquisition route without buying or crediting earlier counts', () => {
  const f = fixture(), observed = read(f), target = { id: 'melvorD:Product0', current: 0, maximum: 1, accessible: null };
  const completion = { version: 'v1.3.1', mode: { id: f.mode.id, hardcore: false }, completion: { scopes: [
    { id: 'base', ownership: true, categories: { items: { supported: true, status: 'observed', current: 0, maximum: 1, percent: 0, entries: [target], missing: [{ ...target }] } } },
    ...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false }))] } };
  const catalog = { version: 'v1.3.1', origin: 'mock-only', observationId: 'empty-catalog', mode: completion.mode, skills: [] }, quoteCount = f.quotes.length;
  const result = buildItemAcquisitionGraph(completion, catalog, observed); assert.equal(result.supported, true);
  assert.ok(result.graph.nodes.some(value => value.type === 'shop-operation' && value.purchaseId === f.purchases[0].id && value.completed === false));
  assert.equal(f.quotes.length, quoteCount); assert.equal(f.history.get(f.purchases[0]), 2); assert.equal(result.inventoryProjection, null);
});
test('four price models are retained separately from one-unit modified quotes', () => {
  const f = fixture(), result = read(f); assert.equal(result.supported, true);
  assert.deepEqual(result.purchases.records.map(value => value.data.nominal.currencyModels[0].type), ['Fixed', 'Linear', 'BankSlot', 'Glove']);
  assert.equal(entry(result).data.nominal.currencyModels[0].cost, 10); assert.equal(entry(result).data.quote.currencyCosts[0].amount, 9.25);
  assert.equal(entry(result).data.nominal.itemCosts[0].quantity, 2); assert.equal(entry(result).data.quote.itemCosts[0].quantity, 1);
  assert.ok(f.quotes.every(value => value.quantity === 1)); assert.equal(f.shop.buyQuantity, 25); assert.equal(result.uiBuyQuantity, 25);
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false);
});
test('purchase counts, flags, raw limit zero and Infinity remain distinct', () => {
  const result = read(fixture()); assert.equal(entry(result).data.observedPurchaseCount, 2); assert.equal(entry(result).data.observedPurchased, true);
  assert.equal(entry(result).data.buyLimitRaw, 0); assert.equal(entry(result).data.buyLimitMeaningEvidence, 'unknown');
  assert.equal(entry(result, 2).data.buyLimitRaw, null); assert.equal(entry(result, 2).data.buyLimitSpecial, 'Infinity');
  assert.equal(JSON.stringify(result).includes('"buyLimitSpecial":"Infinity"'), true);
});
test('shop purchase and standard/abyssal requirements expose detached conditions and met flags', () => {
  const value = entry(read(fixture()), 1).data; assert.equal(value.unlockRequirements.met, true); assert.equal(value.purchaseRequirements.met, false);
  assert.deepEqual(value.unlockRequirements.entries[0], { type: 'ShopPurchase', supported: true, reason: null, purchaseId: 'melvorD:Purchase0', scopeId: 'base', requiredCount: 1, met: true });
  assert.equal(value.purchaseRequirements.entries.length, 2); assert.equal(value.canPurchase, null);
  assert.equal(value.quote.supported, true); // A price quote does not imply satisfying purchase conditions.
});
test('unknown requirements keep aggregate fulfillment unknown and never inspect callbacks or extra fields', () => {
  const f = fixture(), unknown = { type: 'FutureRequirement' };
  for (const property of ['isMet', 'check', 'notifyFailure', 'privateSave']) Object.defineProperty(unknown, property, { get() { throw new Error('PRIVATE'); } });
  f.purchases[0].purchaseRequirements.push(unknown); const result = read(f), value = entry(result).data;
  assert.equal(value.purchaseRequirements.coverage, 'partial'); assert.equal(value.purchaseRequirements.met, null);
  assert.equal(value.purchaseRequirements.entries[0].reason, 'shop-requirement-type-unverified'); assert.equal(value.canPurchase, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('unregistered or unowned requirement references are not invoked', () => {
  for (const type of ['ShopPurchase', 'SkillLevel']) {
    const f = fixture(), target = object('Unowned', {}, 'melvorItA'), requirement = { type, purchase: target, skill: target, count: 1, level: 1 };
    Object.defineProperty(requirement, 'isMet', { get() { throw new Error('must not read'); } });
    f.purchases[0].unlockRequirements = [requirement]; assert.equal(entry(read(f)).data.unlockRequirements.met, null);
  }
});
test('quantity cap zero prevents any price quote for that purchase', () => {
  const f = fixture(); f.shop.capPurchaseQuantity = purchase => purchase === f.purchases[0] ? 0 : 1;
  f.shop.isPurchaseAtBuyLimit = purchase => purchase === f.purchases[0]; const result = read(f), value = entry(result).data;
  assert.equal(value.observedAtBuyLimit, true); assert.equal(value.quote.reason, 'shop-quantity-capped-to-zero');
  assert.equal(f.quotes.some(quote => quote.id === f.purchases[0].id), false);
});
test('unknown price types skip quote calculation without touching arbitrary price body fields', () => {
  const f = fixture(), model = { currency: f.gp, type: 'FuturePrice' };
  Object.defineProperty(model, 'cost', { get() { throw new Error('PRIVATE'); } }); f.purchases[0].costs.currencies = [model];
  const result = read(f), value = entry(result).data; assert.equal(value.nominal.currencyModels[0].type, 'unknown');
  assert.equal(value.quote.reason, 'shop-price-type-unverified'); assert.equal(f.quotes.some(quote => quote.id === f.purchases[0].id), false);
});
test('contains distinguish nominal items, charges, pets, loot boxes, tabs and stat presence', () => {
  const f = fixture(); f.purchases[0].contains = { items: [], itemCharges: { item: object('Gloves'), quantity: 500 }, pet: object('Pet'),
    lootBox: true, bankTab: true, stats: { get modifiers() { throw new Error('must not read'); } } };
  const result = read(f), value = entry(result).data.contains; assert.equal(value.nominalItemCharges.quantity, 500); assert.equal(value.petId, 'melvorD:Pet');
  assert.equal(value.lootBox, true); assert.equal(value.bankTab, true); assert.equal(value.hasStats, true); assert.equal(value.effectCoverage, 'partial');
  assert.equal(result.purchaseProjection, null); assert.equal(result.bank, undefined); assert.equal(result.completion, undefined);
});
test('mode allowlists are raw observations and empty sets do not imply full purchase eligibility', () => {
  const f = fixture(); f.category.allowedGamemodes.clear(); f.purchases[0].allowedGamemodes = new Set([object('Hardcore')]);
  const result = read(f); assert.deepEqual(result.categories.records[0].data.allowedGamemodeIds, []);
  assert.equal(entry(result).data.currentModeListed, false); assert.equal(entry(result).data.modeEligibilityEvidence, 'partial'); assert.equal(entry(result).data.canPurchase, null);
});
test('Raid, unowned and modded categories and purchases exclude content before quote getters', () => {
  const f = fixture(), raid = object('Raid', { isGolbinRaid: true }), unowned = object('DLC', {}, 'melvorItA');
  Object.defineProperty(raid, 'allowedGamemodes', { get() { throw new Error('must not read'); } }); f.shop.categories.allObjects.push(raid, unowned);
  const raidPurchase = object('RaidPurchase', { category: raid }), dlcPurchase = object('DLCPurchase', {}, 'melvorItA'), mod = object('ModPurchase', {}, 'myMod'); mod.isModded = true;
  for (const purchase of [raidPurchase, dlcPurchase, mod]) Object.defineProperty(purchase, 'costs', { get() { throw new Error('PRIVATE'); } });
  f.shop.purchases.allObjects.push(raidPurchase, dlcPurchase, mod); const result = read(f);
  assert.equal(result.supported, true); assert.equal(result.purchases.records.filter(value => value.status === 'excluded').length, 3);
});
test('owned DLC purchase is observed, unknown ownership is blocked without accessing price', () => {
  const f = fixture(), purchase = { ...f.purchases[0], ...object('DLCPurchase', {}, 'melvorItA') }; f.shop.purchases.allObjects.push(purchase);
  f.context.ownership.ita = true; assert.equal(read(f).purchases.records.find(value => value.id === purchase.id).status, 'observed');
  f.context.ownership.ita = null; Object.defineProperty(purchase, 'costs', { get() { throw new Error('must not read'); } });
  assert.equal(read(f).purchases.records.find(value => value.id === purchase.id).reason, 'scope-ownership-unverified');
});
test('invalid counts, limits, caps, costs and flags are never coerced', () => {
  for (const change of [f => f.shop.getPurchaseCount = () => -1, f => f.purchases[0].getBuyLimit = () => NaN,
    f => f.purchases[0].getBuyLimit = () => -1, f => f.shop.capPurchaseQuantity = () => 2,
    f => f.purchases[0].allowQuantityPurchase = null, f => f.purchases[0].costs.currencies[0].cost = Infinity,
    f => f.purchases[0].costs.items[0].quantity = 0.5, f => f.purchases[0].contains.lootBox = null,
    f => f.shop.isUpgradePurchased = () => null]) {
    const f = fixture(); change(f); assert.equal(read(f).purchases.supported, false);
  }
});
test('history mismatch and stale category references remain unsupported', () => {
  const f = fixture(); f.shop.getPurchaseCount = () => 0; assert.equal(entry(read(f)).reason, 'shop-record-invalid');
  const g = fixture(); g.purchases[0].category = { ...g.category }; assert.equal(entry(read(g)).reason, 'shop-record-invalid');
});
test('requirement errors are masked and a failed prerequisite price does not depend on registry ordering', () => {
  const f = fixture(), requirement = f.purchases[1].unlockRequirements[0]; Object.defineProperty(f.purchases[0], 'costs', { get() { throw new Error('PRIVATE-SAVE'); } });
  const first = read(f); assert.equal(entry(first, 1).data.unlockRequirements.met, true); assert.equal(JSON.stringify(first).includes('PRIVATE-SAVE'), false);
  f.shop.purchases.allObjects.reverse(); assert.deepEqual(read(f), first);
  requirement.isMet = () => { throw new Error('PRIVATE'); };
  assert.equal(entry(read(f), 1).data.unlockRequirements.met, null);
});
test('duplicate registries and excessive requirements, modes, models and histories are bounded', () => {
  for (const change of [f => f.shop.purchases.allObjects.push(f.purchases[0]), f => f.shop.categories.allObjects.push(f.category),
    f => f.shop.purchases.allObjects = Array(2049).fill(f.purchases[0]), f => f.shop.categories.allObjects = Array(257).fill(f.category),
    f => f.purchases[0].unlockRequirements = Array(129).fill({ type: 'Unknown' }),
    f => f.purchases[0].allowedGamemodes = new Set(Array.from({ length: 129 }, (_, i) => object(`Mode${i}`))),
    f => f.purchases[0].costs.currencies = Array(65).fill(f.purchases[0].costs.currencies[0]),
    f => f.shop.upgradesPurchased = new Map(Array.from({ length: 2049 }, (_, i) => [object(`Purchase${i}`), 1]))]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('context, Raid, invalid global UI quantity and UTF-8 output budgets fail closed', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } }), f = fixture();
  assert.equal(readShopSnapshot(forbidden, { enabled: true }).reason, 'runtime-shop-adapter-unverified');
  assert.equal(readShopForTesting(forbidden, { ...f.context, version: 'v2' }).reason, 'version-unverified');
  for (const patch of [{ observationId: null }, { maximumBytes: null }, { maximumBytes: 100 }, { ownership: { base: false } }])
    assert.equal(readShopForTesting(forbidden, { ...f.context, ...patch }).reason, 'shop-context-unverified');
  f.game.isGolbinRaid = true; assert.equal(read(f).reason, 'raid-shop-unverified'); f.game.isGolbinRaid = false;
  f.shop.buyQuantity = 4_294_967_296; assert.equal(read(f).supported, false);
  const bounded = fixture(); bounded.context.maximumBytes = 1024; assert.equal(read(bounded).reason, 'shop-output-byte-limit');
});
test('buying, quantity changes, price formula, bank, stats, currency consumption, notifications and saves are not referenced', () => {
  const f = fixture(); for (const property of ['buyItemOnClick', 'quickBuyItemOnClick', 'updateBuyQuantity', 'getCurrencyCost',
    'computeProvidedStats', 'removePurchasesAboveLimit', 'encode', 'decode']) Object.defineProperty(f.shop, property, { get() { throw new Error('FORBIDDEN'); } });
  for (const property of ['bank', 'characterName', 'cloud', 'generateSaveString', 'checkRequirements']) Object.defineProperty(f.game, property, { get() { throw new Error('PRIVATE'); } });
  for (const requirement of [...f.purchases[1].unlockRequirements, ...f.purchases[1].purchaseRequirements])
    for (const property of ['check', 'notifyFailure', 'getNodes']) Object.defineProperty(requirement, property, { get() { throw new Error('FORBIDDEN'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(f.shop.buyQuantity, 25); assert.equal(f.history.get(f.purchases[0]), 2);
});
test('frozen references and reordered inputs preserve detached deterministic observations', () => {
  const f = fixture(), first = read(f), original = f.purchases[0], requirement = f.purchases[1].unlockRequirements[0];
  f.purchases[1].purchaseRequirements.reverse(); f.shop.purchases.allObjects.reverse(); assert.deepEqual(read(f), first);
  const seen = new Set(); function freeze(value) { if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freeze(key); freeze(child); }
    else if (value instanceof Set) for (const child of value) freeze(child); else Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.game); freeze(f.context); assert.deepEqual(read(f), first);
  entry(first).data.quote.itemCosts[0].quantity = 99; assert.equal(original.costs.items[0].quantity, 2);
  entry(first, 1).data.unlockRequirements.entries[0].requiredCount = 99; assert.equal(requirement.count, 1);
});
