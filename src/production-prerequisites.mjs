/** Structural procurement analysis. Nominal observations never become guaranteed effects. */
import { auditCompletionCategory } from './completion-audit.mjs';
import { findCyclicComponents } from './graph-components.mjs';
import { buildShopPrerequisiteGraph } from './shop-prerequisites.mjs';
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const KINDS = ['woodcutting', 'smithing', 'mining', 'fishing', 'cooking', 'crafting', 'fletching', 'runecrafting', 'herblore', 'summoning'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const scopeOf = value => id(value) && value.indexOf(':') > 0 && !value.endsWith(':') ? SCOPES.get(value.split(':')[0]) ?? null : null;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
class BuildFailure extends Error { constructor(reason) { super(); this.reason = reason; } }
const requireValue = (valid, reason) => { if (!valid) throw new BuildFailure(reason); };
const failed = reason => ({ supported: false, status: 'blocked', reason, graph: null, roots: [], cycles: [], issues: [], issuesOmitted: 0,
  planningReady: false, modelOnly: true, runnable: false });
export const productionItemNodeId = itemId => scopeOf(itemId) ? JSON.stringify(['catalog-item', itemId]) : null;
function costs(source, currency = false) {
  requireValue(Array.isArray(source), 'catalog-cost-collection-invalid');
  requireValue(source.length <= (currency ? 64 : 128), 'catalog-cost-collection-limit');
  const seen = new Set();
  return source.map(entry => {
    requireValue(scopeOf(entry?.id) !== null && !seen.has(entry.id) && (currency ? amount(entry.amount) : count(entry.quantity)), 'catalog-cost-invalid');
    seen.add(entry.id); return currency ? { id: entry.id, amount: entry.amount } : { id: entry.id, quantity: entry.quantity };
  }).sort((a, b) => compare(a.id, b.id));
}
function variants(info) {
  const data = info.data, nominal = data.nominal, observed = data.observed;
  const base = { key: 'base', nominalItems: costs(nominal.itemCosts), nominalCurrencies: costs(nominal.currencyCosts, true),
    observedItems: observed.itemCosts === null ? null : costs(observed.itemCosts),
    observedCurrencies: observed.currencyCosts === null ? null : costs(observed.currencyCosts, true) };
  const result = [base];
  if (info.kind === 'fletching') {
    requireValue(Array.isArray(nominal.alternativeCosts), 'catalog-variant-collection-invalid');
    requireValue(nominal.alternativeCosts.length <= 64, 'catalog-variant-collection-limit');
    const seen = new Set();
    for (const alternative of nominal.alternativeCosts) {
      requireValue(count(alternative?.indexRaw) && !seen.has(alternative.indexRaw) && amount(alternative.quantityMultiplier) && alternative.quantityMultiplier > 0, 'catalog-variant-invalid');
      seen.add(alternative.indexRaw); result.push({ key: `fletching:${alternative.indexRaw}`, nominalItems: costs(alternative.itemCosts),
        nominalCurrencies: base.nominalCurrencies.map(value => ({ ...value })), observedItems: null, observedCurrencies: null,
        quantityMultiplierRaw: alternative.quantityMultiplier, selectionMappingEvidence: 'unknown' });
    }
  }
  if (info.kind === 'summoning') {
    requireValue(Array.isArray(observed.alternativeNonShardCosts), 'catalog-variant-collection-invalid');
    requireValue(observed.alternativeNonShardCosts.length <= 64, 'catalog-variant-collection-limit');
    const seen = new Set();
    for (const alternative of observed.alternativeNonShardCosts) {
      requireValue(scopeOf(alternative?.itemId) !== null && !seen.has(alternative.itemId), 'catalog-variant-invalid'); seen.add(alternative.itemId);
      result.push({ key: `summoning:${alternative.itemId}`, nominalItems: base.nominalItems.map(value => ({ ...value })), nominalCurrencies: base.nominalCurrencies.map(value => ({ ...value })),
        observedItems: costs(alternative.itemCosts), observedCurrencies: costs(alternative.currencyCosts, true), selectedMaterialId: alternative.itemId,
        selectionMappingEvidence: 'unknown' });
    }
  }
  return result.sort((a, b) => compare(a.key, b.key));
}
function routeDigest(value) {
  let result = 0xcbf29ce484222325n;
  for (const character of value) result = BigInt.asUintN(64, (result ^ BigInt(character.codePointAt(0))) * 0x100000001b3n);
  return `producer-${result.toString(16).padStart(16, '0')}`;
}
export function buildProductionPrerequisiteGraph(completion, catalog, options = {}) {
  try {
    requireValue(options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).every(key =>
      ['maxNodes', 'maxEdges', 'maxIssues', 'maximumBytes', 'shopSnapshot'].includes(key)), 'catalog-graph-options-invalid');
    const limits = { maxNodes: 20_000, maxEdges: 100_000, maxIssues: 256, maximumBytes: 4_194_304, ...options };
    requireValue(count(limits.maxNodes) && limits.maxNodes >= 1 && limits.maxNodes <= 20_000 && count(limits.maxEdges) && limits.maxEdges >= 1 && limits.maxEdges <= 100_000 &&
      count(limits.maxIssues) && limits.maxIssues <= 256 && count(limits.maximumBytes) && limits.maximumBytes >= 1024 && limits.maximumBytes <= 8_388_608, 'catalog-graph-options-invalid');
    requireValue(completion?.version === 'v1.3.1' && catalog?.version === completion.version && catalog.origin === 'mock-only' && id(catalog.observationId) && catalog.observationId.length <= 256 &&
      id(completion.mode?.id) && typeof completion.mode.hardcore === 'boolean' && catalog.mode?.id === completion.mode.id && catalog.mode.hardcore === completion.mode.hardcore &&
      Array.isArray(completion.completion?.scopes) && completion.completion.scopes.length <= 4 && Array.isArray(catalog.skills) && catalog.skills.length <= 10, 'catalog-graph-snapshot-unverified');
    const nodes = new Map(), ownership = new Map(), producers = new Map(), infos = new Map(), issues = new Map(), roots = [], queued = new Set(), queue = [], digests = new Map();
    let issueOmitted = 0, edges = 0, sourceEntries = 0;
    function issue(key, reason) {
      const signature = JSON.stringify([key, reason]); if (issues.has(signature)) return;
      if (issues.size < limits.maxIssues) issues.set(signature, { nodeId: key, reason }); else issueOmitted++;
    }
    function node(key, scopeId, type, details = {}) {
      if (nodes.has(key)) return nodes.get(key); requireValue(nodes.size < limits.maxNodes, 'catalog-graph-node-limit');
      const result = { id: key, scopeId, type, evidence: 'unknown', completed: false, routes: [], ...details }; nodes.set(key, result); return result;
    }
    function addRoute(value, routeId, dependencies, extra = {}) {
      const requires = [...new Set(dependencies)].sort(compare);
      requireValue(value.routes.length < 64 && requires.length <= 128, 'catalog-graph-route-or-requirement-limit');
      requireValue(edges + requires.length <= limits.maxEdges, 'catalog-graph-edge-limit'); edges += requires.length;
      value.routes.push({ id: routeId, requires, evidence: 'unknown', kind: 'noncombat', risk: 'unknown', durationMs: null, runnable: false, ...extra });
    }
    function itemNode(itemId) {
      const key = productionItemNodeId(itemId); requireValue(key !== null, 'catalog-item-id-invalid'); const scopeId = scopeOf(itemId);
      const value = node(key, scopeId, 'item-supply', { itemId, inventoryEvidence: 'unknown' });
      if (!queued.has(key)) { queued.add(key); queue.push(key); }
      return value;
    }
    for (const scope of completion.completion.scopes) {
      requireValue(['base', 'toth', 'aod', 'ita'].includes(scope?.id) && !ownership.has(scope.id) && [true, false, null].includes(scope.ownership), 'catalog-graph-scope-invalid');
      ownership.set(scope.id, scope.ownership); if (scope.ownership !== true) continue;
      const category = scope.categories?.items, audit = auditCompletionCategory(category, 0);
      if (audit.status === 'unverified') { issue(JSON.stringify(['completion-items', scope.id]), 'completion-items-unverified'); continue; }
      for (const entry of [...category.missing].sort((a, b) => compare(a.id, b.id))) {
        requireValue(scopeOf(entry.id) === scope.id && entry.skillId === undefined && entry.track === undefined && entry.maximum === 1, 'completion-item-scope-or-shape-invalid');
        const key = JSON.stringify([scope.id, 'items', '', entry.id, '']), value = node(key, scope.id, 'completion-item', { itemId: entry.id });
        addRoute(value, 'acquire-unverified', [itemNode(entry.id).id]); roots.push(key);
      }
    }
    const seenSkills = new Set();
    for (const skill of catalog.skills) {
      if (KINDS.includes(skill?.kind) && skill.skillId === null && skill.supported === false && skill.status === 'blocked' && Array.isArray(skill.entries) && skill.entries.length === 0) {
        issue(JSON.stringify(['catalog-skill', skill.kind]), 'catalog-skill-unobserved'); continue;
      }
      requireValue(KINDS.includes(skill?.kind) && scopeOf(skill.skillId) === 'base' && !seenSkills.has(skill.skillId) && Array.isArray(skill.entries), 'catalog-skill-index-invalid');
      seenSkills.add(skill.skillId); requireValue(sourceEntries + skill.entries.length <= 20_000, 'catalog-entry-limit'); sourceEntries += skill.entries.length;
      for (const entry of skill.entries) {
        requireValue(id(entry?.actionId) && typeof entry.catalogId === 'string' && entry.catalogId === JSON.stringify([skill.skillId, entry.actionId]) && !infos.has(entry.catalogId), 'catalog-entry-index-invalid');
        const info = { catalogId: entry.catalogId, actionId: entry.actionId, scopeId: entry.scopeId, kind: skill.kind, skill, status: entry.status, data: null };
        infos.set(info.catalogId, info);
        if (entry.status !== 'observed' || entry.supported !== true || ownership.get(entry.scopeId) !== true) continue;
        requireValue(scopeOf(entry.actionId) === entry.scopeId, 'catalog-action-scope-invalid');
        try {
          const productId = entry.data.productId;
          if (productId === null) { issue(entry.catalogId, 'catalog-product-mapping-unverified'); continue; }
          if (scopeOf(productId) === null || ownership.get(scopeOf(productId)) !== true) { issue(entry.catalogId, 'catalog-product-scope-unverified'); continue; }
          info.data = entry.data; info.productId = productId;
          if (!producers.has(productId)) producers.set(productId, []); producers.get(productId).push(info);
        } catch { issue(entry.catalogId, 'catalog-product-observation-invalid'); }
      }
    }
    for (const list of producers.values()) list.sort((a, b) => compare(a.catalogId, b.catalogId));
    const sellers = new Map(), shopRecords = new Map(), importedShopNodes = new Set(), expandedShopOperations = new Set();
    let shopGraph = null, shopNodes = null, shopSourceEntries = 0;
    if (options.shopSnapshot !== undefined) {
      const shop = options.shopSnapshot;
      requireValue(shop?.version === completion.version && shop.origin === 'mock-only' && shop.mode?.id === completion.mode.id &&
        shop.mode.hardcore === completion.mode.hardcore && Array.isArray(shop.purchases?.records) && shop.purchases.records.length <= 2048, 'acquisition-shop-snapshot-unverified');
      const graphOptions = { maxNodes: limits.maxNodes, maxEdges: limits.maxEdges, maxIssues: limits.maxIssues, maximumBytes: limits.maximumBytes, includeOperations: true };
      shopGraph = buildShopPrerequisiteGraph(shop, graphOptions);
      requireValue(shopGraph.supported, 'acquisition-shop-graph-unavailable');
      shopNodes = new Map(shopGraph.graph.nodes.map(value => [value.id, value]));
      const operations = new Map(shopGraph.operationNodes.map(value => [value.purchaseId, value.nodeId]));
      shopSourceEntries = shop.purchases.records.length;
      for (const record of shop.purchases.records) {
        shopRecords.set(record.id, record);
        if (record.status !== 'observed' || record.supported !== true || ownership.get(record.scopeId) !== true || !operations.has(record.id)) continue;
        try {
          const contains = record.data.contains;
          if (contains.lootBox !== false) { issue(record.id, 'acquisition-loot-or-contents-unverified'); continue; }
          const items = costs(contains.nominalItems);
          for (const item of items) if (item.quantity > 0 && ownership.get(scopeOf(item.id)) === true) {
            if (!sellers.has(item.id)) sellers.set(item.id, []);
            sellers.get(item.id).push({ purchaseId: record.id, nodeId: operations.get(record.id) });
          }
        } catch (error) {
          if (error instanceof BuildFailure && /limit/.test(error.reason)) throw error;
          issue(record.id, 'acquisition-shop-contents-invalid');
        }
      }
      for (const list of sellers.values()) list.sort((a, b) => compare(a.purchaseId, b.purchaseId));
    }
    function importShopClosure(rootId) {
      const work = [rootId];
      for (let index = 0; index < work.length; index++) {
        const key = work[index]; if (importedShopNodes.has(key)) continue;
        const original = shopNodes.get(key); requireValue(original !== undefined && !nodes.has(key), 'acquisition-shop-node-conflict-or-missing');
        requireValue(nodes.size < limits.maxNodes, 'catalog-graph-node-limit');
        const copy = structuredClone(original), newEdges = copy.routes.reduce((sum, route) => sum + route.requires.length, 0);
        requireValue(edges + newEdges <= limits.maxEdges, 'catalog-graph-edge-limit'); edges += newEdges;
        nodes.set(key, copy); importedShopNodes.add(key);
        for (const route of copy.routes) work.push(...route.requires);
      }
    }
    function shopOperation(seller) {
      if (expandedShopOperations.has(seller.nodeId)) return seller.nodeId;
      expandedShopOperations.add(seller.nodeId); importShopClosure(seller.nodeId);
      const operation = nodes.get(seller.nodeId), source = shopRecords.get(seller.purchaseId).data;
      const dependencies = [];
      try {
        const nominal = source.nominal, quote = source.quote;
        requireValue(typeof quote?.supported === 'boolean' && count(quote.quantity) && quote.quantity <= 1, 'acquisition-quote-shape-invalid');
        const nominalItems = costs(nominal.itemCosts), quotedItems = quote.supported === true ? costs(quote.itemCosts) : null;
        for (const item of [...nominalItems, ...(quotedItems ?? [])]) if (item.quantity > 0) dependencies.push(itemNode(item.id).id);
        requireValue(Array.isArray(nominal.currencyModels), 'acquisition-price-model-collection-invalid');
        requireValue(nominal.currencyModels.length <= 64, 'acquisition-price-model-collection-limit');
        const currencyIds = new Set();
        for (const model of nominal.currencyModels) { requireValue(scopeOf(model?.currencyId) !== null, 'acquisition-currency-id-invalid'); currencyIds.add(model.currencyId); }
        const quotedCurrencies = quote.supported === true ? costs(quote.currencyCosts, true) : null;
        for (const currency of quotedCurrencies ?? []) if (currency.amount > 0) currencyIds.add(currency.id);
        for (const currencyId of [...currencyIds].sort(compare)) dependencies.push(node(JSON.stringify(['catalog-currency', currencyId]), scopeOf(currencyId), 'currency-supply',
          { currencyId, inventoryEvidence: 'unknown' }).id);
        operation.costObservations = { nominalItems, quotedItems, quotedCurrencies, quoteQuantity: quote.quantity, guaranteeEvidence: 'unknown' };
        if (quote.supported !== true || quote.quantity !== 1) dependencies.push(node(JSON.stringify(['shop-price-unverified', seller.purchaseId]), operation.scopeId,
          'price-unverified', { observedMet: null }).id);
      } catch (error) {
        if (error instanceof BuildFailure && /limit/.test(error.reason)) throw error;
        dependencies.push(node(JSON.stringify(['shop-cost-unverified', seller.purchaseId]), operation.scopeId, 'cost-unverified', { observedMet: null }).id);
        issue(seller.nodeId, 'acquisition-shop-cost-observation-invalid');
      }
      operation.completed = false; operation.observedMet = false;
      const requires = [...new Set([...operation.routes[0].requires, ...dependencies])].sort(compare);
      requireValue(requires.length <= 128 && edges + requires.length - operation.routes[0].requires.length <= limits.maxEdges, 'acquisition-operation-requirement-or-edge-limit');
      edges += requires.length - operation.routes[0].requires.length; operation.routes[0].requires = requires;
      return seller.nodeId;
    }
    const expandedRecipes = new Map();
    function recipeNodes(info) {
      if (expandedRecipes.has(info.catalogId)) return expandedRecipes.get(info.catalogId);
      const result = []; expandedRecipes.set(info.catalogId, result);
      try {
        const data = info.data, level = data.requiredLevel, abyssal = data.requiredAbyssalLevel;
        const currentLevel = info.skill.level, currentAbyssalLevel = info.skill.abyssalLevel, skillUnlocked = info.skill.isUnlocked, masteryEligibility = data.observed.actionEligibility;
        requireValue(count(level) && count(abyssal) && count(currentLevel) && count(currentAbyssalLevel) && typeof skillUnlocked === 'boolean' &&
          typeof masteryEligibility === 'boolean', 'catalog-recipe-observation-invalid');
        const choices = variants(info);
        for (const choice of choices) {
          const key = JSON.stringify(['catalog-recipe', info.catalogId, choice.key]), dependencies = [];
          const value = node(key, info.scopeId, 'recipe-variant', { catalogId: info.catalogId, skillId: info.skill.skillId, actionId: info.actionId,
            variant: choice.key, productId: info.productId, costs: choice, effectEvidence: 'unknown' });
          for (const material of [...choice.nominalItems, ...(choice.observedItems ?? [])]) if (material.quantity > 0) dependencies.push(itemNode(material.id).id);
          for (const currency of [...choice.nominalCurrencies, ...(choice.observedCurrencies ?? [])]) if (currency.amount > 0)
            dependencies.push(node(JSON.stringify(['catalog-currency', currency.id]), scopeOf(currency.id), 'currency-supply', { currencyId: currency.id, inventoryEvidence: 'unknown' }).id);
          for (const [track, required, current] of [['standard', level, currentLevel], ['abyssal', abyssal, currentAbyssalLevel]]) {
            const condition = node(JSON.stringify(['catalog-skill', info.skill.skillId, track, required]), 'base', 'skill-condition', {
              skillId: info.skill.skillId, track, requiredLevel: required, observedMet: skillUnlocked && current >= required });
            dependencies.push(condition.id);
          }
          const access = node(JSON.stringify(['catalog-access', info.catalogId]), info.scopeId, 'access-unverified', {
            observedMasteryEligibility: masteryEligibility, observedSkillUnlocked: skillUnlocked, observedMet: null });
          dependencies.push(access.id); addRoute(value, 'produce-unverified', dependencies);
          const digest = routeDigest(key); requireValue(!digests.has(digest) || digests.get(digest) === key, 'catalog-route-id-collision'); digests.set(digest, key);
          result.push({ nodeId: key, routeId: digest });
        }
      } catch (error) {
        if (error instanceof BuildFailure && /limit|collision/.test(error.reason)) throw error;
        issue(info.catalogId, 'catalog-recipe-observation-invalid');
      }
      return result;
    }
    for (let index = 0; index < queue.length; index++) {
      const value = nodes.get(queue[index]);
      if (ownership.get(value.scopeId) !== true) { issue(value.id, 'catalog-material-scope-unverified'); continue; }
      const list = producers.get(value.itemId) ?? [];
      for (const info of list) for (const producer of recipeNodes(info)) addRoute(value, producer.routeId, [producer.nodeId]);
      for (const seller of sellers.get(value.itemId) ?? []) {
        const digest = routeDigest(seller.nodeId); requireValue(!digests.has(digest) || digests.get(digest) === seller.nodeId, 'catalog-route-id-collision'); digests.set(digest, seller.nodeId);
        addRoute(value, digest, [shopOperation(seller)], { sourceKind: 'shop', purchaseId: seller.purchaseId });
      }
      if (!value.routes.length) issue(value.id, 'catalog-producer-unverified-or-missing');
      value.routes.sort((a, b) => compare(a.id, b.id));
    }
    const adjacency = new Map([...nodes].map(([key, value]) => [key, value.routes.flatMap(route => route.requires)])), cycles = findCyclicComponents(adjacency);
    for (const cycle of cycles) for (const key of cycle) issue(key, 'catalog-prerequisite-cycle');
    for (const entry of shopGraph?.issues ?? []) if (importedShopNodes.has(entry.nodeId)) issue(entry.nodeId, entry.reason);
    const result = { supported: true, status: 'analysis', reason: 'catalog-effects-and-operations-unverified', graph: { nodes: [...nodes.values()].sort((a, b) => compare(a.id, b.id)) },
      roots: roots.sort(compare), cycles, issues: [...issues.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), issuesOmitted: issueOmitted,
      sourceEntries, shopSourceEntries, edges, observationId: catalog.observationId, crossSnapshotTimeEvidence: 'unknown', inventoryProjection: null,
      planningReady: false, modelOnly: true, runnable: false };
    return new TextEncoder().encode(JSON.stringify(result)).length <= limits.maximumBytes ? result : failed('catalog-graph-output-byte-limit');
  } catch (error) { return failed(error instanceof BuildFailure ? error.reason : 'catalog-graph-input-unreadable'); }
}

/** Autonomous combined analysis. shopSnapshot is a detached observation, never an execution port. */
export function buildItemAcquisitionGraph(completion, catalog, shopSnapshot, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).includes('shopSnapshot')) return failed('acquisition-options-invalid');
  return buildProductionPrerequisiteGraph(completion, catalog, { ...options, shopSnapshot });
}
