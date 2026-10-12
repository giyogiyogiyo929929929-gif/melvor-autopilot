/** Index full detached facts once, then materialize bounded candidate-specific graphs. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const time = value => Number.isSafeInteger(value) && value >= 0;
const SCOPES = new Set(['base', 'toth', 'aod', 'ita']);
const fail = reason => ({ supported: false, reason, graph: null });

export function indexPrerequisiteGraph(graph) {
  try {
    if (!Array.isArray(graph?.nodes) || graph.nodes.length > 20_000) return { supported: false, reason: 'global-graph-limit-or-invalid', nodes: null };
    const nodes = new Map();
    for (const node of graph.nodes) {
      if (!id(node?.id) || nodes.has(node.id)) return { supported: false, reason: 'global-node-invalid-or-duplicate', nodes: null };
      nodes.set(node.id, node);
    }
    return { supported: true, reason: null, nodes };
  } catch { return { supported: false, reason: 'global-graph-unreadable', nodes: null }; }
}

export function materializePrerequisites(index, targetId, context, limits) {
  try {
    if (!index?.supported || !(index.nodes instanceof Map) || !id(targetId)) return fail('local-graph-invalid');
    if (!context?.ownership || !limits || !['maxNodes', 'maxRoutes', 'maxRequirements', 'maxDepth'].every(key =>
      Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <=
        { maxNodes: 4096, maxRoutes: 64, maxRequirements: 128, maxDepth: 64 }[key])) return fail('local-limits-invalid');
    const queue = [{ id: targetId, depth: 0 }], enqueued = new Set([targetId]), nodes = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const queued = queue[cursor], source = index.nodes.get(queued.id);
      if (!source) continue; // Resolver keeps the exact node-missing blocker.
      if (nodes.length >= limits.maxNodes) return fail('local-node-limit');
      const node = { id: source.id, scopeId: typeof source.scopeId === 'string' ? source.scopeId : null,
        evidence: source.evidence === 'confirmed' ? 'confirmed' : 'unknown',
        completed: typeof source.completed === 'boolean' ? source.completed : null, routes: [] };
      nodes.push(node);
      if (!SCOPES.has(node.scopeId) || node.evidence !== 'confirmed' || node.completed !== false || context.ownership[node.scopeId] !== true) continue;
      const routes = source.routes;
      if (!Array.isArray(routes)) { node.routes = null; continue; }
      if (routes.length > limits.maxRoutes) return fail('local-route-limit');
      const routeIds = new Set();
      for (const sourceRoute of routes) {
        const routeId = sourceRoute?.id;
        if (!id(routeId) || routeId.length > 1024 || routeIds.has(routeId)) return fail('local-route-invalid-or-duplicate');
        routeIds.add(routeId);
        const requirements = sourceRoute.requires;
        if (Array.isArray(requirements) && requirements.length > limits.maxRequirements) return fail('local-requirement-limit');
        const validRequirements = Array.isArray(requirements) && requirements.every(id) && new Set(requirements).size === requirements.length;
        const route = { id: routeId, evidence: sourceRoute.evidence === 'confirmed' ? 'confirmed' : 'unknown',
          kind: typeof sourceRoute.kind === 'string' ? sourceRoute.kind : null,
          risk: typeof sourceRoute.risk === 'string' ? sourceRoute.risk : null,
          durationMs: time(sourceRoute.durationMs) ? sourceRoute.durationMs : null,
          requires: validRequirements ? [...requirements].sort() : null };
        node.routes.push(route);
        const safe = validRequirements && route.evidence === 'confirmed' && route.risk === 'safe' &&
          ['noncombat', 'combat'].includes(route.kind) && (route.kind !== 'combat' || context.hardcore === false) && time(route.durationMs);
        if (!safe || queued.depth >= limits.maxDepth) continue;
        for (const dependency of route.requires) {
          if (!index.nodes.has(dependency)) continue;
          if (enqueued.has(dependency)) continue;
          if (enqueued.size >= limits.maxNodes + 1) return fail('local-node-limit');
          enqueued.add(dependency); queue.push({ id: dependency, depth: queued.depth + 1 });
        }
      }
      node.routes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }
    nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { supported: true, reason: null, graph: { nodes } };
  } catch { return fail('local-graph-unreadable'); }
}
