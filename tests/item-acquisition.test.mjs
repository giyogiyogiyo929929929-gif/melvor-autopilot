import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemAcquisitionGraph, productionItemNodeId } from '../src/production-prerequisites.mjs';
import { buildShopPrerequisiteGraph, shopCountNodeId } from '../src/shop-prerequisites.mjs';
import { resolvePrerequisites } from '../src/prerequisites.mjs';
const id = name => `melvorD:${name}`;
const group = (entries = []) => ({ entries, coverage: entries.every(value => value.supported) ? 'observed' : 'partial', met: entries.every(value => value.supported) ? entries.every(value => value.met) : null });
function fixture() {
  const target = { id: id('Bar'), current: 0, maximum: 1, accessible: null }, mode = { id: 'Standard', hardcore: false };
  const completion = { version: 'v1.3.1', mode: { ...mode }, completion: { scopes: [{ id: 'base', ownership: true, categories: {
    items: { supported: true, status: 'observed', current: 0, maximum: 1, percent: 0, entries: [target], missing: [{ ...target }] } } },
    ...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false }))] } };
  const source = { actionId: id('Smelt'), catalogId: JSON.stringify([id('Smithing'), id('Smelt')]), scopeId: 'base', status: 'observed', supported: true,
    data: { productId: id('Bar'), requiredLevel: 1, requiredAbyssalLevel: 0, nominal: { itemCosts: [{ id: id('Ore'), quantity: 2 }], currencyCosts: [] },
      observed: { itemCosts: null, currencyCosts: null, actionEligibility: true } } };
  const catalog = { version: 'v1.3.1', origin: 'mock-only', observationId: 'catalog-frame', mode: { ...mode }, skills: [
    { kind: 'smithing', skillId: id('Smithing'), isUnlocked: true, level: 20, abyssalLevel: 0, entries: [source] }] };
  const purchase = { id: id('BuyOre'), scopeId: 'base', supported: true, status: 'observed', data: { observedPurchaseCount: 10,
    unlockRequirements: group(), purchaseRequirements: group(), contains: { nominalItems: [{ id: id('Ore'), quantity: 1 }], lootBox: false },
    nominal: { itemCosts: [], currencyModels: [{ currencyId: id('GP'), type: 'Fixed', cost: 5, supported: true }] },
    quote: { supported: true, quantity: 1, itemCosts: [], currencyCosts: [{ id: id('GP'), amount: 4.5 }] } } };
  const shop = { version: 'v1.3.1', origin: 'mock-only', observationId: 'shop-frame', mode: { ...mode }, purchases: { records: [purchase] } };
  return { completion, catalog, shop, source, purchase };
}
const build = f => buildItemAcquisitionGraph(f.completion, f.catalog, f.shop);
const supply = (result, name) => result.graph.nodes.find(value => value.id === productionItemNodeId(id(name)));
test('production materials automatically discover shop suppliers and payment conditions', () => {
  const f = fixture(), result = build(f); assert.equal(result.supported, true);
  assert.equal(supply(result, 'Bar').routes.length, 1); assert.equal(supply(result, 'Ore').routes.length, 1);
  const operation = result.graph.nodes.find(value => value.type === 'shop-operation'); assert.equal(operation.completed, false);
  assert.ok(operation.routes[0].requires.some(key => result.graph.nodes.find(value => value.id === key).type === 'currency-supply'));
  assert.equal(operation.costObservations.quotedCurrencies[0].amount, 4.5); assert.equal(result.shopSourceEntries, 1);
});
test('previous purchase counts never satisfy a new item supply operation', () => {
  const f = fixture(), shopGraph = buildShopPrerequisiteGraph(f.shop, { includeOperations: true });
  assert.equal(shopGraph.graph.nodes.find(value => value.id === shopCountNodeId(id('BuyOre'), 1)).completed, true);
  assert.equal(shopGraph.graph.nodes.find(value => value.type === 'shop-operation').completed, false);
  const result = build(f); assert.equal(supply(result, 'Ore').completed, false);
  assert.equal(result.graph.nodes.find(value => value.type === 'shop-operation').observedMet, false);
});
test('a missing item has OR routes for production and a direct shop purchase', () => {
  const f = fixture(), direct = structuredClone(f.purchase); direct.id = id('BuyBar'); direct.data.contains.nominalItems = [{ id: id('Bar'), quantity: 3 }];
  f.shop.purchases.records.push(direct); const result = build(f);
  assert.equal(supply(result, 'Bar').routes.length, 2); assert.equal(supply(result, 'Bar').routes.filter(value => value.sourceKind === 'shop').length, 1);
  assert.equal(result.inventoryProjection, null); assert.equal(result.planningReady, false);
});
test('shop item costs recursively find production or another shop source', () => {
  const f = fixture(); f.purchase.data.nominal.itemCosts = [{ id: id('Token'), quantity: 2 }];
  const other = structuredClone(f.purchase); other.id = id('BuyToken'); other.data.contains.nominalItems = [{ id: id('Token'), quantity: 1 }]; other.data.nominal.itemCosts = [];
  f.shop.purchases.records.push(other); const result = build(f); assert.ok(supply(result, 'Token'));
  assert.equal(supply(result, 'Token').routes.length, 1); assert.equal(result.graph.nodes.filter(value => value.type === 'shop-operation').length, 2);
});
test('nominal and quoted shop costs stay separate and unknown quotes are blockers', () => {
  const f = fixture(); f.purchase.data.nominal.itemCosts = [{ id: id('Token'), quantity: 2 }];
  f.purchase.data.quote.itemCosts = [{ id: id('Coupon'), quantity: 1 }]; let result = build(f);
  assert.ok(supply(result, 'Token')); assert.ok(supply(result, 'Coupon'));
  f.purchase.data.quote = { supported: false, quantity: 0 }; result = build(f);
  assert.ok(result.graph.nodes.some(value => value.type === 'price-unverified')); assert.equal(result.runnable, false);
});
test('malformed quotes and throwing selected cost bodies become opaque blockers without leaking values', () => {
  for (const change of [f => f.purchase.data.quote.quantity = 'PRIVATE', f => f.purchase.data.nominal.currencyModels = null,
    f => Object.defineProperty(f.purchase.data, 'quote', { get() { throw new Error('PRIVATE'); } })]) {
    const f = fixture(); change(f); const result = build(f); assert.equal(result.supported, true);
    assert.ok(result.graph.nodes.some(value => value.type === 'cost-unverified')); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
test('loot boxes, charges, pets, tabs and stat presence never become inferred item supplies', () => {
  const f = fixture(); f.purchase.data.contains = { nominalItems: [], nominalItemCharges: { id: id('Ore'), quantity: 500 }, petId: id('Ore'), bankTab: true, hasStats: true, lootBox: false };
  let result = build(f); assert.equal(supply(result, 'Ore').routes.length, 0);
  f.purchase.data.contains.nominalItems = [{ id: id('Ore'), quantity: 1 }]; f.purchase.data.contains.lootBox = true;
  result = build(f); assert.equal(supply(result, 'Ore').routes.length, 0); assert.ok(result.issues.some(value => value.reason === 'acquisition-loot-or-contents-unverified'));
});
test('unowned and excluded purchase contents are never read', () => {
  const f = fixture(), excluded = { id: 'melvorItA:BuyOre', scopeId: 'ita', supported: false, status: 'excluded' };
  Object.defineProperty(excluded, 'data', { get() { throw new Error('PRIVATE'); } }); f.shop.purchases.records.push(excluded);
  const result = build(f); assert.equal(result.supported, true); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('only related operation closures and cost bodies are imported', () => {
  const f = fixture(), unused = structuredClone(f.purchase); unused.id = id('Unrelated'); unused.data.contains.nominalItems = [{ id: id('Other'), quantity: 1 }];
  Object.defineProperty(unused.data, 'quote', { get() { throw new Error('must not read'); } }); f.shop.purchases.records.push(unused);
  const result = build(f); assert.equal(result.supported, true); assert.equal(result.graph.nodes.some(value => value.purchaseId === unused.id), false);
});
test('missing shop prerequisite state remains a shared unknown dependency', () => {
  const f = fixture(); f.purchase.data.unlockRequirements = group([{ type: 'ShopPurchase', supported: true, purchaseId: id('Upgrade'), scopeId: 'base', requiredCount: 1, met: false }]);
  const result = build(f); assert.ok(result.graph.nodes.some(value => value.type === 'shop-count' && value.purchaseId === id('Upgrade')));
  assert.ok(result.issues.some(value => value.reason === 'shop-purchase-reference-missing'));
});
test('integrated production/shop material cycles are diagnosed without dropping OR alternatives', () => {
  const f = fixture(); f.purchase.data.nominal.itemCosts = [{ id: id('Bar'), quantity: 1 }];
  const direct = structuredClone(f.purchase); direct.id = id('AlternativeOre'); direct.data.nominal.itemCosts = [];
  f.shop.purchases.records.push(direct); const result = build(f);
  assert.ok(result.cycles.length > 0); assert.equal(supply(result, 'Ore').routes.length, 2); assert.equal(result.unreachable, undefined);
});
test('version/mode and invalid operation option data refuse mixing snapshots', () => {
  for (const change of [f => f.shop.version = 'v2', f => f.shop.mode.id = 'Other', f => f.shop.mode.hardcore = true, f => f.shop.origin = 'runtime-disabled']) {
    const f = fixture(); change(f); const result = build(f); assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
  const f = fixture(); assert.equal(buildShopPrerequisiteGraph(f.shop, { includeOperations: null }).supported, false);
});
test('total node/edge/route/byte bounds include imported operations and discard partial graphs', () => {
  const f = fixture(); for (const options of [{ maxNodes: 8 }, { maxEdges: 3 }, { maximumBytes: 1024 }]) {
    const result = buildItemAcquisitionGraph(f.completion, f.catalog, f.shop, options); assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
  const many = fixture(); many.shop.purchases.records = Array.from({ length: 65 }, (_, i) => ({ ...structuredClone(many.purchase), id: id(`BuyOre${i}`) }));
  assert.equal(build(many).supported, false);
});
test('frozen data and order changes preserve detached combined graphs', () => {
  const f = fixture(), second = structuredClone(f.purchase); second.id = id('BuyOre2'); f.shop.purchases.records.push(second);
  const first = build(f); f.shop.purchases.records.reverse(); assert.deepEqual(build(f), first);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f); assert.deepEqual(build(f), first);
  first.graph.nodes.find(value => value.type === 'shop-operation').costObservations.nominalItems.push({ id: id('Fake'), quantity: 99 });
  assert.equal(f.purchase.data.nominal.itemCosts.length, 0);
});
test('the resolver still rejects all acquisition facts and no reward or action allowance exists', () => {
  const result = build(fixture()), resolved = resolvePrerequisites(result.graph, result.roots[0], { ownership: { base: true }, hardcore: false });
  assert.equal(resolved.status, 'blocked'); assert.ok(resolved.rejected.some(value => value.reason === 'fact-unconfirmed'));
  assert.equal(result.inventoryProjection, null); assert.equal(result.runnable, false); assert.equal(result.planningReady, false);
});
