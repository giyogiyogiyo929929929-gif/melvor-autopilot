import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionPrerequisiteGraph, productionItemNodeId } from '../src/production-prerequisites.mjs';
import { resolvePrerequisites } from '../src/prerequisites.mjs';
const item = name => `melvorD:${name}`;
function completion(names = ['Bar'], found = []) {
  const entries = [...names, ...found].map(name => ({ id: item(name), current: found.includes(name) ? 1 : 0, maximum: 1, accessible: null }));
  return { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: { scopes: [{ id: 'base', ownership: true, categories: {
    items: { supported: true, status: 'observed', current: found.length, maximum: entries.length, percent: entries.length ? found.length * 100 / entries.length : 0,
      entries, missing: entries.filter(value => value.current === 0).map(value => ({ ...value })) } } },
    ...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false }))] } };
}
function entry(skillId, action, product, costs = [], extra = {}) {
  const actionId = item(action), productId = product === null ? null : item(product);
  return { catalogId: JSON.stringify([skillId, actionId]), actionId, scopeId: 'base', supported: true, status: 'observed', data: {
    productId, requiredLevel: 10, requiredAbyssalLevel: 0,
    nominal: { itemCosts: costs.map(([name, quantity]) => ({ id: item(name), quantity })), currencyCosts: [], baseQuantity: 1 },
    observed: { itemCosts: null, currencyCosts: null, actionEligibility: true }, ...extra } };
}
function catalog(recipes, kind = 'smithing') {
  const skillId = item('Smithing');
  return { version: 'v1.3.1', origin: 'mock-only', observationId: 'catalog-fixture', mode: { id: 'Standard', hardcore: false }, skills: [
    { kind, skillId, level: 50, abyssalLevel: 1, isUnlocked: true, entries: recipes.map(([action, product, costs, extra]) => entry(skillId, action, product, costs, extra)) }] };
}
const build = (recipes, names = ['Bar']) => buildProductionPrerequisiteGraph(completion(names), catalog(recipes));
const itemNode = (result, name) => result.graph.nodes.find(value => value.id === productionItemNodeId(item(name)));
test('Completion missing items automatically become roots with OR producers and AND materials', () => {
  const result = build([['Smelt', 'Bar', [['Ore', 2], ['Coal', 1]]], ['Find', 'Bar', []], ['Mine', 'Ore', []], ['Burn', 'Coal', []]]);
  assert.equal(result.supported, true); assert.deepEqual(result.roots, [JSON.stringify(['base', 'items', '', item('Bar'), ''])]);
  assert.equal(itemNode(result, 'Bar').routes.length, 2);
  const smelt = result.graph.nodes.find(value => value.type === 'recipe-variant' && value.actionId === item('Smelt'));
  assert.ok(smelt.routes[0].requires.includes(productionItemNodeId(item('Ore')))); assert.ok(smelt.routes[0].requires.includes(productionItemNodeId(item('Coal'))));
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false);
});
test('shared materials and repeated roots reuse supply and producer nodes', () => {
  const result = build([['SmeltA', 'Bar', [['Ore', 2]]], ['SmeltB', 'Ring', [['Ore', 3]]], ['Mine', 'Ore', []]], ['Bar', 'Ring']);
  assert.equal(result.graph.nodes.filter(value => value.id === productionItemNodeId(item('Ore'))).length, 1);
  assert.equal(result.graph.nodes.filter(value => value.type === 'recipe-variant' && value.actionId === item('Mine')).length, 1); assert.equal(result.roots.length, 2);
});
test('nominal and observed costs remain separate and zero rows do not invent material needs', () => {
  const values = catalog([['Smelt', 'Bar', [['Ore', 2], ['Zero', 0]]]]);
  values.skills[0].entries[0].data.observed.itemCosts = [{ id: item('Coal'), quantity: 1 }];
  values.skills[0].entries[0].data.observed.currencyCosts = [{ id: item('GP'), amount: 0.5 }];
  const result = buildProductionPrerequisiteGraph(completion(), values), recipe = result.graph.nodes.find(value => value.type === 'recipe-variant');
  assert.equal(recipe.costs.nominalItems.find(value => value.id === item('Ore')).quantity, 2); assert.equal(recipe.costs.observedItems[0].quantity, 1);
  assert.ok(itemNode(result, 'Ore')); assert.ok(itemNode(result, 'Coal')); assert.equal(itemNode(result, 'Zero'), undefined);
  assert.ok(result.graph.nodes.some(value => value.type === 'currency-supply')); assert.equal(result.inventoryProjection, null);
});
test('standard/abyssal and access conditions are separate and never confirmed', () => {
  const result = build([['Smelt', 'Bar', []]]), conditions = result.graph.nodes.filter(value => value.type === 'skill-condition');
  assert.equal(conditions.length, 2); assert.deepEqual(conditions.map(value => value.track).sort(), ['abyssal', 'standard']);
  assert.ok(result.graph.nodes.some(value => value.type === 'access-unverified' && value.observedMet === null));
  assert.ok(result.graph.nodes.every(value => value.evidence === 'unknown' && value.completed === false));
});
test('already found Completion items are not credited as bank inventory or omitted material dependencies', () => {
  const result = buildProductionPrerequisiteGraph(completion(['Bar'], ['Ore']), catalog([['Smelt', 'Bar', [['Ore', 2]]], ['Mine', 'Ore', []]]));
  assert.equal(result.roots.length, 1); assert.equal(itemNode(result, 'Ore').completed, false); assert.equal(itemNode(result, 'Ore').inventoryEvidence, 'unknown');
});
test('unconfirmed byproducts and unresolved potion products are not indexed as supply', () => {
  const values = catalog([['Smelt', 'Bar', []], ['Potion', null, []]]);
  values.skills[0].entries[0].data.observedOutputIds = [item('Bar'), item('Gem')];
  values.skills[0].entries[1].data.constraints = { potionIdsInDeclaredOrder: [item('Gem')] };
  const result = buildProductionPrerequisiteGraph(completion(['Gem']), values);
  assert.equal(itemNode(result, 'Gem').routes.length, 0); assert.ok(result.issues.some(value => value.reason === 'catalog-product-mapping-unverified'));
});
test('fletching alternate costs are unknown variants rather than guaranteed multiplier yields', () => {
  const values = catalog([['Fletch', 'Bar', [['Ore', 2]]]], 'fletching');
  values.skills[0].entries[0].data.nominal.alternativeCosts = [{ indexRaw: 0, itemCosts: [{ id: item('Coal'), quantity: 1 }], quantityMultiplier: 1.5 }];
  const result = buildProductionPrerequisiteGraph(completion(), values);
  assert.equal(itemNode(result, 'Bar').routes.length, 2); const alternative = result.graph.nodes.find(value => value.variant === 'fletching:0');
  assert.equal(alternative.costs.quantityMultiplierRaw, 1.5); assert.equal(alternative.effectEvidence, 'unknown'); assert.ok(alternative.routes[0].requires.includes(productionItemNodeId(item('Coal'))));
});
test('summoning material cost alternatives remain separately observed routes', () => {
  const values = catalog([['Summon', 'Bar', [['Shard', 2]]]], 'summoning');
  values.skills[0].entries[0].data.observed.alternativeNonShardCosts = [{ itemId: item('Ore'), itemCosts: [{ id: item('Ore'), quantity: 3 }], currencyCosts: [] },
    { itemId: item('Coal'), itemCosts: [{ id: item('Coal'), quantity: 5 }], currencyCosts: [] }];
  const result = buildProductionPrerequisiteGraph(completion(), values); assert.equal(itemNode(result, 'Bar').routes.length, 3);
  assert.equal(result.graph.nodes.filter(value => value.type === 'recipe-variant' && value.costs.selectionMappingEvidence === 'unknown').length, 2);
});
test('cycles retain a noncyclic alternative and do not claim every route impossible', () => {
  const result = build([['Loop', 'Bar', [['Ore', 1]]], ['LoopBack', 'Ore', [['Bar', 1]]], ['Safe', 'Bar', []]]);
  assert.equal(result.cycles.length, 1); assert.equal(itemNode(result, 'Bar').routes.length, 2);
  assert.ok(result.cycles[0].includes(productionItemNodeId(item('Bar')))); assert.equal(result.unreachable, undefined);
});
test('unowned and blocked sources never read content getters', () => {
  const values = catalog([['Smelt', 'Bar', []]]), source = values.skills[0].entries[0]; source.scopeId = 'ita';
  source.actionId = 'melvorItA:Smelt'; source.catalogId = JSON.stringify([values.skills[0].skillId, source.actionId]);
  Object.defineProperty(source, 'data', { get() { throw new Error('PRIVATE'); } });
  assert.equal(buildProductionPrerequisiteGraph(completion(), values).supported, true);
  source.scopeId = 'base'; source.actionId = item('Smelt'); source.catalogId = JSON.stringify([values.skills[0].skillId, source.actionId]); source.status = 'blocked';
  const result = buildProductionPrerequisiteGraph(completion(), values); assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(itemNode(result, 'Bar').routes.length, 0);
});
test('cross-scope ingredients are represented without expanding unowned materials', () => {
  const comp = completion(), values = catalog([['Smelt', 'Bar', []]]);
  values.skills[0].entries[0].data.nominal.itemCosts = [{ id: 'melvorItA:Ore', quantity: 2 }];
  const result = buildProductionPrerequisiteGraph(comp, values);
  assert.ok(result.graph.nodes.some(value => value.type === 'item-supply' && value.scopeId === 'ita'));
  assert.ok(result.issues.some(value => value.reason === 'catalog-material-scope-unverified'));
});
test('owned DLC missing products and producers retain their separate scope', () => {
  const comp = completion([]), values = catalog([['Smelt', 'Bar', []]]), source = values.skills[0].entries[0];
  comp.completion.scopes[3].ownership = true;
  const target = { id: 'melvorItA:Bar', current: 0, maximum: 1, accessible: null };
  comp.completion.scopes[3].categories = { items: { supported: true, status: 'observed', current: 0, maximum: 1, percent: 0, entries: [target], missing: [{ ...target }] } };
  source.actionId = 'melvorItA:Smelt'; source.catalogId = JSON.stringify([values.skills[0].skillId, source.actionId]); source.scopeId = 'ita'; source.data.productId = target.id;
  const result = buildProductionPrerequisiteGraph(comp, values); assert.equal(result.supported, true); assert.equal(result.roots.length, 1);
  assert.equal(result.graph.nodes.find(value => value.type === 'completion-item').scopeId, 'ita');
  assert.equal(result.graph.nodes.find(value => value.type === 'recipe-variant').scopeId, 'ita');
});
test('irrelevant producer cost bodies are not expanded and failed skill metadata is isolated', () => {
  const values = catalog([['Smelt', 'Bar', []], ['Irrelevant', 'Ring', []]]);
  Object.defineProperty(values.skills[0].entries[1].data, 'nominal', { get() { throw new Error('PRIVATE'); } });
  values.skills.push({ kind: 'crafting', skillId: null, status: 'blocked', supported: false, entries: [] });
  const result = buildProductionPrerequisiteGraph(completion(), values); assert.equal(result.supported, true);
  assert.equal(result.graph.nodes.some(value => value.type === 'recipe-variant' && value.actionId === item('Irrelevant')), false); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('Completion partial or inconsistent item rows do not become guessed roots', () => {
  const comp = completion(); comp.completion.scopes[0].categories.items.missing = [];
  const result = buildProductionPrerequisiteGraph(comp, catalog([['Smelt', 'Bar', []]]));
  assert.deepEqual(result.roots, []); assert.ok(result.issues.some(value => value.reason === 'completion-items-unverified')); assert.equal(result.completed, undefined);
});
test('unknown version, origin, mismatched mode, duplicate and invalid scope data fail closed', () => {
  for (const change of [(_comp, values) => values.version = 'v2', (_comp, values) => values.origin = 'runtime-disabled',
    (_comp, values) => values.mode.id = 'Other', (comp, _values) => comp.completion.scopes.push(comp.completion.scopes[0]),
    (_comp, values) => values.skills[0].entries.push(values.skills[0].entries[0])]) {
    const comp = completion(), values = catalog([['Smelt', 'Bar', []]]); change(comp, values);
    const result = buildProductionPrerequisiteGraph(comp, values); assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
});
test('bad cost shapes, quantity values and recipe observations are isolated', () => {
  for (const change of [source => source.data.nominal.itemCosts[0].quantity = 0.5, source => source.data.requiredLevel = NaN,
    source => source.data.observed.actionEligibility = null, source => source.data.nominal.currencyCosts = null]) {
    const values = catalog([['Smelt', 'Bar', [['Ore', 2]]]]); change(values.skills[0].entries[0]);
    const result = buildProductionPrerequisiteGraph(completion(), values); assert.equal(result.supported, true); assert.equal(itemNode(result, 'Bar').routes.length, 0);
  }
});
test('node, edge, variant, producer, cost collection and byte limits discard partial results', () => {
  const comp = completion(), values = catalog([['Smelt', 'Bar', [['Ore', 2]]]]);
  for (const options of [{ maxNodes: 1 }, { maxEdges: 1 }, { maximumBytes: 1024 }, { maxNodes: null }, { extra: true }]) {
    const result = buildProductionPrerequisiteGraph(comp, values, options); assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
  const many = catalog(Array.from({ length: 65 }, (_, i) => [`Recipe${i}`, 'Bar', []]));
  assert.equal(buildProductionPrerequisiteGraph(comp, many).supported, false);
  const huge = catalog([['Smelt', 'Bar', []]]); huge.skills[0].entries[0].data.nominal.itemCosts = Array(129).fill({ id: item('Ore'), quantity: 1 });
  assert.equal(buildProductionPrerequisiteGraph(comp, huge).supported, false);
});
test('long raw IDs use stable short route IDs and no routes depend on array ordering', () => {
  const values = catalog([['Smelt', 'Bar', []]]), skill = values.skills[0], source = skill.entries[0];
  skill.skillId = 'melvorD:' + 'S'.repeat(1000); source.actionId = 'melvorD:' + 'A'.repeat(1000); source.catalogId = JSON.stringify([skill.skillId, source.actionId]);
  const result = buildProductionPrerequisiteGraph(completion(), values); assert.equal(result.supported, true);
  const route = itemNode(result, 'Bar').routes[0]; assert.ok(route.id.length <= 1024); assert.ok(route.requires[0].length > 1024);
  assert.deepEqual(buildProductionPrerequisiteGraph(completion(), values), result);
});
test('2000-stage product dependencies use queue expansion and iterative cycle analysis', () => {
  const recipes = Array.from({ length: 2000 }, (_, i) => [`Recipe${i}`, i === 1999 ? 'Bar' : `Product${i}`, i === 0 ? [] : [[`Product${i - 1}`, 1]]]);
  const result = build(recipes); assert.equal(result.supported, true); assert.deepEqual(result.cycles, []); assert.equal(result.sourceEntries, 2000);
  assert.equal(result.graph.nodes.filter(value => value.type === 'recipe-variant').length, 2000);
});
test('frozen inputs and reordered sources remain detached and deterministic', () => {
  const comp = completion(), values = catalog([['Smelt', 'Bar', [['Ore', 2]]], ['Mine', 'Ore', []]]), first = buildProductionPrerequisiteGraph(comp, values);
  values.skills[0].entries.reverse(); comp.completion.scopes.reverse(); assert.deepEqual(buildProductionPrerequisiteGraph(comp, values), first);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } } freeze(comp); freeze(values);
  assert.deepEqual(buildProductionPrerequisiteGraph(comp, values), first);
  first.graph.nodes.find(value => value.type === 'recipe-variant' && value.actionId === item('Smelt')).costs.nominalItems[0].quantity = 999;
  assert.equal(values.skills[0].entries.find(value => value.actionId === item('Smelt')).data.nominal.itemCosts[0].quantity, 2);
});
test('existing Resolver refuses all graph facts and no quantity or reward projection appears', () => {
  const result = build([['Smelt', 'Bar', []]]), solved = resolvePrerequisites(result.graph, result.roots[0], { ownership: { base: true }, hardcore: false });
  assert.equal(solved.status, 'blocked'); assert.ok(solved.rejected.some(value => value.reason === 'fact-unconfirmed'));
  assert.equal(result.inventoryProjection, null); assert.equal(result.bank, undefined); assert.equal(result.completion, undefined); assert.equal(result.runnable, false);
});
