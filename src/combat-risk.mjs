/** Conditional worst-case survival over fully bounded synthetic envelopes only. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const graphId = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const COVERAGE = ['normal', 'specials', 'dots', 'passives', 'reflection', 'conditionalStats', 'damageTypes',
  'areaEffects', 'resourceChanges', 'autoEatTiming', 'autoEatAlgorithm'];
const result = (reason, modelSafe = false, metrics = null) => ({ status: modelSafe ? 'bounded-model' : 'blocked', reason,
  modelSafe, modelOnly: true, actualDeathProbability: null, runtimeAllowed: false, runnable: false, metrics });
export function assessCombatRisk(_game, _evidence) { return result('runtime-combat-risk-unverified'); }
export function combatObservationSignature(frame) {
  try {
    const p = frame.parts;
    return JSON.stringify([frame.observationId, frame.observedAtMs, frame.mode.id, frame.mode.hardcore,
      ...['player', 'enemy'].map(name => [p[name].data.hp, p[name].data.maxHP, p[name].data.maxHit, p[name].data.attackIntervalMs,
        p[name].data.damageTypeId, p[name].data.activeEffectCount, p[name].data.attackSelectionCount]),
      p.encounter.data.enemyId, p.encounter.data.paused, p.autoEat.data.thresholdHP, p.autoEat.data.healLimitHP,
      p.autoEat.data.efficiencyPercent, p.food.data.selectedSlot, p.food.data.itemId, p.food.data.quantity,
      p.food.data.nominalHeal, p.resistance.data.damageTypeId, p.resistance.data.resistance]);
  } catch { return null; }
}
export function assessCombatEnvelope(frame, envelope, context) {
  try {
    if (frame?.version !== 'v1.3.1' || frame.origin !== 'mock-only' || frame.supported !== true || !id(frame.mode?.id)) return result('combat-frame-unverified');
    if (frame.mode.hardcore !== false) return result('combat-mode-refused');
    if (!count(context?.nowMs) || !count(context.maxAgeMs) || context.maxAgeMs > 60_000 || !count(frame.observedAtMs) ||
        context.nowMs < frame.observedAtMs || context.nowMs - frame.observedAtMs > context.maxAgeMs) return result('combat-frame-stale');
    const parts = frame.parts;
    if (!parts || !['player', 'enemy', 'encounter', 'autoEat', 'food', 'resistance'].every(name => parts[name]?.supported === true)) return result('combat-parts-unverified');
    const player = parts.player.data, enemy = parts.enemy.data, encounter = parts.encounter.data, autoEat = parts.autoEat.data, food = parts.food.data;
    if (envelope?.evidence !== 'confirmed-fixture' || envelope.observationId !== frame.observationId ||
        envelope.enemyId !== encounter.enemyId || envelope.damageTypeId !== enemy.damageTypeId ||
        typeof envelope.stateSignature !== 'string' || envelope.stateSignature !== combatObservationSignature(frame)) return result('combat-envelope-unverified');
    if (!COVERAGE.every(key => envelope.coverage?.[key] === true)) return result('combat-coverage-incomplete');
    if (!count(envelope.horizonMs) || envelope.horizonMs < 1 || envelope.horizonMs > 3_600_000 ||
        !count(envelope.minimumWindowIntervalMs) || envelope.minimumWindowIntervalMs < 1 ||
        !Array.isArray(envelope.packetDamageUpper) || envelope.packetDamageUpper.length < 1 || envelope.packetDamageUpper.length > 64 ||
        envelope.packetDamageUpper.some(value => !count(value))) return result('combat-envelope-invalid');
    if (![player.hp, player.maxHP, autoEat.thresholdHP, autoEat.healLimitHP, food.quantity].every(count) ||
        player.hp < 1 || player.maxHP < player.hp || autoEat.thresholdHP > player.maxHP || autoEat.healLimitHP > player.maxHP ||
        !id(food.itemId) || typeof encounter.paused !== 'boolean' || encounter.paused) return result('combat-state-invalid');
    const windows = Math.floor(envelope.horizonMs / envelope.minimumWindowIntervalMs) + 1;
    if (!count(windows) || windows > 10_000) return result('combat-window-limit');
    const burst = Math.max(...envelope.packetDamageUpper);
    const metrics = { horizonMs: envelope.horizonMs, windows, burstDamageUpper: burst, foodNeededUpper: 0 };
    if (burst === 0) return result('synthetic-envelope-only', true, metrics);
    if (typeof autoEat.efficiencyPercent !== 'number' || autoEat.efficiencyPercent <= 0 || autoEat.efficiencyPercent > 100 ||
        typeof food.nominalHeal !== 'number' || food.nominalHeal <= 0) return result('combat-healing-unverified');
    if (player.hp <= burst) return result('combat-initial-lethal-bound', false, metrics);
    if (autoEat.thresholdHP <= burst || autoEat.healLimitHP <= autoEat.thresholdHP) return result('combat-autoeat-bound-insufficient', false, metrics);
    if (!count(envelope.healingMinimumPerFood) || envelope.healingMinimumPerFood < 1) return result('combat-healing-unverified');
    const perWindow = Math.ceil((autoEat.healLimitHP - 1) / envelope.healingMinimumPerFood);
    const required = perWindow * windows;
    if (!count(required)) return result('combat-food-budget-overflow');
    metrics.foodNeededUpper = required;
    if (food.quantity < required) return result('combat-food-insufficient', false, metrics);
    return result('synthetic-envelope-only', true, metrics);
  } catch { return result('combat-risk-input-unreadable'); }
}

/** Clamp unassessed combat routes. Does not authorize any game action. */
export function guardCombatGraph(graph, frame, envelopes, context) {
  try {
    if (!Array.isArray(graph?.nodes) || graph.nodes.length > 20_000 || !Array.isArray(envelopes) || envelopes.length > 2000)
      return { supported: false, reason: 'combat-graph-invalid', graph: null, assessments: [], runnable: false };
    const byRoute = new Map();
    for (const entry of envelopes) {
      if (!graphId(entry?.nodeId) || !id(entry.routeId)) throw new Error('invalid-route-evidence');
      const key = JSON.stringify([entry.nodeId, entry.routeId]);
      if (byRoute.has(key)) throw new Error('duplicate-route-evidence');
      byRoute.set(key, entry.envelope);
    }
    const assessments = [];
    const nodes = graph.nodes.map(node => {
      if (!graphId(node?.id) || !Array.isArray(node.routes) || node.routes.length > 64 || node.routes.some(route =>
        !id(route?.id) || !Array.isArray(route.requires) || route.requires.length > 128 || route.requires.some(value => !graphId(value))))
        throw new Error('invalid-combat-graph');
      return { id: node.id, scopeId: node.scopeId, evidence: node.evidence, completed: node.completed,
      routes: node.routes.map(route => {
        const safe = { id: route.id, requires: [...route.requires], evidence: route.evidence, kind: route.kind, risk: route.risk, durationMs: route.durationMs };
        if (route.kind === 'combat') {
          const checked = assessCombatEnvelope(frame, byRoute.get(JSON.stringify([node.id, route.id])), context);
          safe.risk = checked.modelSafe ? 'safe' : 'unknown';
          assessments.push({ nodeId: node.id, routeId: route.id, ...checked });
        }
        return safe;
      }) };
    });
    return { supported: true, reason: null, graph: { nodes }, assessments, runnable: false };
  } catch { return { supported: false, reason: 'combat-graph-unreadable', graph: null, assessments: [], runnable: false }; }
}
