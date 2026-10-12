/** Pure analysis graph from detached shop observations. All operational evidence remains unknown. */
import { findCyclicComponents } from './graph-components.mjs';
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const count = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const scopeOf = value => id(value) && value.indexOf(':') > 0 && !value.endsWith(':') ? SCOPES.get(value.split(':')[0]) ?? null : null;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
class GraphFailure extends Error { constructor(reason) { super(); this.reason = reason; } }
const requireValue = (valid, reason) => { if (!valid) throw new GraphFailure(reason); };
const failed = reason => ({ supported: false, status: 'blocked', reason, graph: null, roots: [], cycles: [],
  issues: [], issuesOmitted: 0, planningReady: false, modelOnly: true, runnable: false });
export function shopCountNodeId(purchaseId, requiredCount) {
  return scopeOf(purchaseId) && count(requiredCount) && requiredCount > 0 ? JSON.stringify(['shop-count', purchaseId, requiredCount]) : null;
}
export function buildShopPrerequisiteGraph(snapshot, options = {}) {
  try {
    requireValue(options && typeof options === 'object' && !Array.isArray(options) &&
      Object.keys(options).every(key => ['maxNodes', 'maxEdges', 'maxIssues', 'maximumBytes', 'includeOperations'].includes(key)), 'shop-graph-options-invalid');
    const { maxNodes, maxEdges, maxIssues, maximumBytes, includeOperations } = { maxNodes: 20_000, maxEdges: 100_000, maxIssues: 256, maximumBytes: 4_194_304, includeOperations: false, ...options };
    requireValue(count(maxNodes) && maxNodes >= 1 && maxNodes <= 20_000 && count(maxEdges) && maxEdges >= 1 && maxEdges <= 100_000 &&
      count(maxIssues) && maxIssues <= 256 && count(maximumBytes) && maximumBytes >= 1024 && maximumBytes <= 8_388_608 && typeof includeOperations === 'boolean', 'shop-graph-options-invalid');
    requireValue(snapshot?.version === 'v1.3.1' && snapshot.origin === 'mock-only' && id(snapshot.observationId) && snapshot.observationId.length <= 256 &&
      id(snapshot.mode?.id) && typeof snapshot.mode.hardcore === 'boolean' && Array.isArray(snapshot.purchases?.records) &&
      snapshot.purchases.records.length > 0 && snapshot.purchases.records.length <= 2048, 'shop-graph-snapshot-unverified');
    const infos = new Map(), nodes = new Map(), roots = [], operationNodes = [], queue = [], queued = new Set(), expanded = new Set(), countClaims = new Map(), skillClaims = new Map(), groups = new Map();
    const issues = new Map(); let omitted = 0, edgeCount = 0;
    function issue(nodeId, reason) {
      const key = JSON.stringify([nodeId, reason]); if (issues.has(key)) return;
      if (issues.size < maxIssues) issues.set(key, { nodeId, reason }); else omitted++;
    }
    function node(key, scopeId, type, details = {}) {
      if (nodes.has(key)) return nodes.get(key);
      requireValue(nodes.size < maxNodes, 'shop-graph-node-limit');
      const value = { id: key, scopeId, type, evidence: 'unknown', completed: false, observedMet: null, routes: [], ...details };
      nodes.set(key, value); return value;
    }
    function route(value, routeId, requires) {
      const dependencies = [...new Set(requires)].sort(compare);
      requireValue(dependencies.length <= 128, 'shop-graph-requirement-limit');
      requireValue(edgeCount + dependencies.length <= maxEdges, 'shop-graph-edge-limit'); edgeCount += dependencies.length;
      value.routes = [{ id: routeId, requires: dependencies, evidence: 'unknown', kind: 'noncombat', risk: 'unknown', durationMs: null, runnable: false }];
    }
    for (const record of snapshot.purchases.records) {
      requireValue(id(record?.id) && !infos.has(record.id) && ['observed', 'blocked', 'excluded'].includes(record.status) &&
        (record.scopeId === null && record.status === 'excluded' || scopeOf(record.id) === record.scopeId && record.scopeId !== null), 'shop-graph-record-invalid');
      const info = { id: record.id, scopeId: record.scopeId, status: record.status, observedCount: null, data: null };
      if (record.status === 'observed') {
        try {
          requireValue(record.supported === true && record.data && typeof record.data === 'object', 'shop-purchase-observation-invalid');
          info.data = record.data; const value = info.data.observedPurchaseCount;
          requireValue(count(value), 'shop-purchase-count-invalid'); info.observedCount = value;
        } catch { info.observedCount = null; }
      }
      infos.set(info.id, info);
    }
    function countNode(purchaseId, requiredCount, claim = undefined) {
      const scopeId = scopeOf(purchaseId), key = shopCountNodeId(purchaseId, requiredCount);
      requireValue(key !== null, 'shop-graph-condition-invalid');
      const info = infos.get(purchaseId), value = node(key, scopeId, 'shop-count', { purchaseId, requiredCount, observedCount: info?.observedCount ?? null });
      if (!countClaims.has(key)) {
        countClaims.set(key, new Set()); value.observedMet = info?.observedCount === null || info?.observedCount === undefined ? null : info.observedCount >= requiredCount;
        if (!info) issue(key, 'shop-purchase-reference-missing');
        else if (info.status !== 'observed') issue(key, info.status === 'excluded' ? 'shop-purchase-excluded' : 'shop-purchase-unobserved');
        else if (info.observedCount === null) issue(key, 'shop-purchase-count-unobserved');
      }
      if (claim !== undefined) {
        countClaims.get(key).add(claim);
        if (countClaims.get(key).size > 1 || value.observedCount !== null && claim !== (value.observedCount >= requiredCount)) {
          value.observedMet = null; issue(key, 'shop-purchase-count-met-conflict');
        }
      }
      if (!expanded.has(key) && !queued.has(key) && value.observedMet !== true) { queue.push(key); queued.add(key); }
      return key;
    }
    function skillNode(condition) {
      const key = JSON.stringify(['shop-skill', condition.type, condition.scopeId, condition.skillId, condition.level]);
      const value = node(key, condition.scopeId, condition.type, { skillId: condition.skillId, level: condition.level });
      if (!skillClaims.has(key)) skillClaims.set(key, new Set()); skillClaims.get(key).add(condition.met);
      value.observedMet = skillClaims.get(key).size === 1 ? condition.met : null;
      if (value.observedMet === null) issue(key, 'shop-skill-met-conflict');
      if (value.observedMet === false) issue(key, 'shop-skill-progression-unverified');
      return key;
    }
    function groupNode(info, name) {
      const key = JSON.stringify(['shop-and', info.id, name]); if (groups.has(key)) return key;
      const value = node(key, info.scopeId, 'and', { purchaseId: info.id, requirementGroup: name });
      const dependencies = [], normalized = []; let unknownCount = 0, sourceMet = null;
      try {
        const source = info.data[name];
        requireValue(source && Array.isArray(source.entries), 'shop-requirement-group-invalid');
        requireValue(source.entries.length <= 128, 'shop-graph-requirement-limit');
        requireValue(
          ['observed', 'partial'].includes(source.coverage) && (source.met === null || typeof source.met === 'boolean'), 'shop-requirement-group-invalid');
        sourceMet = source.met;
        for (const entry of source.entries) {
          if (entry?.supported !== true) { unknownCount++; continue; }
          requireValue(typeof entry.met === 'boolean', 'shop-graph-condition-invalid');
          if (entry.type === 'ShopPurchase') {
            requireValue(scopeOf(entry.purchaseId) === entry.scopeId && entry.scopeId !== null && count(entry.requiredCount) && entry.requiredCount > 0, 'shop-graph-condition-invalid');
            normalized.push({ type: entry.type, purchaseId: entry.purchaseId, requiredCount: entry.requiredCount, met: entry.met });
          } else if (['SkillLevel', 'AbyssalLevel'].includes(entry.type)) {
            requireValue(scopeOf(entry.skillId) === entry.scopeId && entry.scopeId !== null && count(entry.level), 'shop-graph-condition-invalid');
            normalized.push({ type: entry.type, scopeId: entry.scopeId, skillId: entry.skillId, level: entry.level, met: entry.met });
          } else unknownCount++;
        }
        const claimedMet = unknownCount ? null : normalized.every(entry => entry.met);
        if (source.met !== claimedMet || source.coverage !== (unknownCount ? 'partial' : 'observed')) { unknownCount++; issue(key, 'shop-requirement-summary-conflict'); }
      } catch (error) {
        if (error instanceof GraphFailure && error.reason === 'shop-graph-requirement-limit') throw error;
        normalized.length = 0; unknownCount = 1; sourceMet = null; issue(key, 'shop-requirement-group-unverified');
      }
      normalized.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      for (const condition of normalized) dependencies.push(condition.type === 'ShopPurchase'
        ? countNode(condition.purchaseId, condition.requiredCount, condition.met) : skillNode(condition));
      if (unknownCount) {
        const opaque = node(JSON.stringify(['shop-opaque', info.id, name]), info.scopeId, 'unknown-condition', { unknownRequirementCount: unknownCount });
        dependencies.push(opaque.id); issue(opaque.id, 'shop-requirement-unverified');
      }
      value.sourceSummaryMet = sourceMet; value.unknownRequirementCount = unknownCount;
      route(value, 'all', dependencies); groups.set(key, value.routes[0].requires); return key;
    }
    for (const info of [...infos.values()].sort((a, b) => compare(a.id, b.id))) if (info.scopeId !== null) roots.push(countNode(info.id, 1));
    if (includeOperations) for (const info of [...infos.values()].sort((a, b) => compare(a.id, b.id))) {
      if (info.status !== 'observed' || info.data === null || info.scopeId === null) continue;
      const value = node(JSON.stringify(['shop-operation', info.id]), info.scopeId, 'shop-operation', { purchaseId: info.id, observedMet: false });
      route(value, 'new-purchase-unverified', [groupNode(info, 'unlockRequirements'), groupNode(info, 'purchaseRequirements')]);
      operationNodes.push({ purchaseId: info.id, nodeId: value.id });
    }
    for (let index = 0; index < queue.length; index++) {
      const key = queue[index], value = nodes.get(key); if (expanded.has(key) || value.observedMet === true) continue;
      expanded.add(key); const info = infos.get(value.purchaseId);
      if (!info || info.status !== 'observed' || info.data === null) continue;
      route(value, 'shop-buy-unverified', [groupNode(info, 'unlockRequirements'), groupNode(info, 'purchaseRequirements')]);
    }
    // Conditions on the same skill/track must be monotone across level thresholds.
    const tracks = new Map();
    for (const value of nodes.values()) if (['SkillLevel', 'AbyssalLevel'].includes(value.type)) {
      const key = JSON.stringify([value.type, value.scopeId, value.skillId]); if (!tracks.has(key)) tracks.set(key, []); tracks.get(key).push(value);
    }
    for (const values of tracks.values()) {
      values.sort((a, b) => a.level - b.level); let lowerFailed = false, conflict = false;
      for (const value of values) { if (value.observedMet === false) lowerFailed = true; if (value.observedMet === true && lowerFailed) conflict = true; }
      if (conflict) for (const value of values) { value.observedMet = null; issue(value.id, 'shop-skill-monotonicity-conflict'); }
    }
    for (const [key, dependencies] of groups) {
      const value = nodes.get(key), states = dependencies.map(id => nodes.get(id).observedMet);
      value.observedMet = states.some(state => state === null) ? null : states.every(Boolean);
    }
    for (const value of nodes.values()) value.completed = value.observedMet === true;
    const adjacency = new Map([...nodes].map(([key, value]) => [key, value.completed ? [] : value.routes.flatMap(route => route.requires).filter(id => !nodes.get(id).completed)]));
    const cycles = findCyclicComponents(adjacency);
    for (const cycle of cycles) for (const key of cycle) issue(key, 'shop-prerequisite-cycle');
    const result = { supported: true, status: 'analysis', reason: 'shop-operations-unverified', version: snapshot.version, observationId: snapshot.observationId,
      graph: { nodes: [...nodes.values()].sort((a, b) => compare(a.id, b.id)) }, roots: roots.sort(compare), operationNodes, cycles,
      issues: [...issues.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), issuesOmitted: omitted,
      sourcePurchases: infos.size, edges: edgeCount, planningReady: false, modelOnly: true, runnable: false };
    return bytes(result) <= maximumBytes ? result : failed('shop-graph-output-byte-limit');
  } catch (error) { return failed(error instanceof GraphFailure ? error.reason : 'shop-graph-input-unreadable'); }
}
