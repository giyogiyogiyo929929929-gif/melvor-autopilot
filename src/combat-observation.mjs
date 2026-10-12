/** Mock-only current encounter telemetry. Never spawns enemies or recomputes stats. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const scalar = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
function need(valid) { if (!valid) throw new Error('combat-observation-invalid'); }
const unavailable = reason => ({ supported: false, reason, data: null });
function blocked(reason) { return { version: null, mode: null, origin: 'mock-only', observationId: null, observedAtMs: null,
  supported: false, status: 'blocked', reason, parts: {}, planningReady: false, runnable: false }; }
export function readCombatSnapshot(_game, _context) { return { ...blocked('runtime-combat-adapter-unverified'), origin: 'runtime-disabled' }; }
function readCharacter(character) {
  const stats = character.stats;
  if (stats?.dirty !== false) return unavailable('combat-stats-dirty-or-unknown');
  const hp = character.hitpoints, maxHP = stats.maxHitpoints, maxHit = stats.maxHit, attackIntervalMs = stats.attackInterval;
  const damageTypeId = character.damageType?.id;
  need(scalar(hp) && scalar(maxHP) && maxHP > 0 && hp <= maxHP && scalar(maxHit) && scalar(attackIntervalMs) && attackIntervalMs > 0 && id(damageTypeId));
  const effects = character.activeEffects, attacks = character.availableAttacks;
  need(effects instanceof Map && effects.size <= 128 && Array.isArray(attacks) && attacks.length <= 64);
  return { supported: true, reason: null, data: { hp, maxHP, maxHit, attackIntervalMs, damageTypeId,
    activeEffectCount: effects.size, attackSelectionCount: attacks.length, effectCoverage: 'unknown' } };
}
export function readCombatSnapshotForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return blocked('version-unverified');
    if (!id(context.observationId) || !count(context.observedAtMs)) return blocked('combat-context-unverified');
    const mode = game.currentGamemode, raid = game.isGolbinRaid;
    need(id(mode?.id) && typeof mode.isPermaDeath === 'boolean' && typeof raid === 'boolean');
    if (raid) return blocked('raid-combat-unverified');
    const combat = game.combat;
    const isActive = combat.isActive, fightInProgress = combat.fightInProgress, paused = combat.paused;
    need([isActive, fightInProgress, paused].every(value => typeof value === 'boolean'));
    const parts = {};
    for (const name of ['player', 'enemy']) {
      try { parts[name] = readCharacter(combat[name]); } catch { parts[name] = unavailable(`${name}-combat-api-invalid`); }
    }
    try {
      const selected = combat.selectedMonster, spawned = combat.enemy.monster;
      need(id(selected?.id) && id(spawned?.id) && selected.id === spawned.id);
      parts.encounter = { supported: true, reason: null, data: { enemyId: selected.id, isActive, fightInProgress, paused } };
    } catch { parts.encounter = unavailable('encounter-identity-unverified'); }
    try {
      const player = combat.player, thresholdHP = player.autoEatThreshold, healLimitHP = player.autoEatHPLimit, efficiencyPercent = player.autoEatEfficiency;
      need(scalar(thresholdHP) && scalar(healLimitHP) && scalar(efficiencyPercent) && efficiencyPercent <= 100);
      parts.autoEat = { supported: true, reason: null, data: { thresholdHP, healLimitHP, efficiencyPercent, timingEvidence: 'unknown' } };
    } catch { parts.autoEat = unavailable('autoeat-api-invalid'); }
    try {
      const food = combat.player.food, selectedSlot = food.selectedSlot, slots = food.slots;
      need(Array.isArray(slots) && slots.length > 0 && slots.length <= 32 && count(selectedSlot) && selectedSlot < slots.length);
      const slot = slots[selectedSlot], itemId = slot.item?.id, quantity = slot.quantity, nominalHeal = slot.item?.healsFor;
      need(id(itemId) && count(quantity) && scalar(nominalHeal));
      parts.food = { supported: true, reason: null, data: { selectedSlot, itemId, quantity, nominalHeal, healingEvidence: 'unknown' } };
    } catch { parts.food = unavailable('food-api-invalid'); }
    try {
      const damageTypeId = parts.enemy.data?.damageTypeId;
      need(parts.player.supported && id(damageTypeId));
      const resistance = combat.player.stats.getResistanceByID(damageTypeId);
      need(typeof resistance === 'number' && Number.isFinite(resistance) && Math.abs(resistance) <= 1_000_000);
      parts.resistance = { supported: true, reason: null, data: { damageTypeId, resistance, mitigationEvidence: 'unknown' } };
    } catch { parts.resistance = unavailable('resistance-api-invalid'); }
    const supported = Object.values(parts).every(part => part.supported);
    return { version: context.version, origin: 'mock-only', mode: { id: mode.id, hardcore: mode.isPermaDeath },
      observationId: context.observationId, observedAtMs: context.observedAtMs, supported,
      status: supported ? 'observed' : 'blocked', reason: supported ? null : 'combat-observation-incomplete',
      parts, planningReady: false, runnable: false };
  } catch { return blocked('combat-mode-or-api-invalid'); }
}
