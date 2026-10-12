/** Narrow, bounded MOD bookkeeping. Never serializes saves or observations. */
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const number = value => Number.isSafeInteger(value) && value >= 0;
const EVENTS = new Set(['started', 'scan-blocked', 'command-attempted', 'command-verified', 'monitor-wait',
  'monitor-progress', 'task-complete', 'task-replan', 'offline', 'halt', 'user-stop']);
const REASONS = new Set(['user-start', 'no-safe-candidate', 'operation-pending', 'action-confirmed', 'awaiting-progress',
  'target-progressed', 'end-conditions-satisfied', 'fresh-observation-required', 'game-offline', 'user-stop',
  'checkpoint-unresolved', 'checkpoint-invalid', 'checkpoint-limit', 'clock-reversed', 'session-changed', 'scan-limit',
  'step-limit', 'unsupported-action', 'executor-start-failed', 'executor-result-invalid', 'operation-failed',
  'cleanup-failed', 'store-failed', 'observation-failed', 'monitor-blocked', 'game-paused', 'controller-error',
  'context-invalid', 'external-reason-rejected']);
export const safeReason = reason => REASONS.has(reason) ? reason : 'external-reason-rejected';
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function newControllerRecord(runId) {
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) return null;
  return { schema: 1, running: false, runId, planEpoch: 0, retiredThrough: 0, cursor: null, activeCommandId: null,
    requiresReview: false, ledger: [], journal: { nextSequence: 0, dropped: 0, suppressed: 0, entries: [] } };
}

export function appendControllerEvent(record, timeMs, event, reason, limits = {}) {
  const maxEntries = limits.maxEntries ?? 120, maxBytes = limits.maxBytes ?? 65_536;
  if (!number(timeMs) || !EVENTS.has(event) || !number(maxEntries) || maxEntries < 1 || maxEntries > 1000 ||
      !number(maxBytes) || maxBytes < 256 || maxBytes > 1_048_576) return false;
  const journal = record.journal, code = safeReason(reason), last = journal.entries.at(-1);
  if (last && timeMs < last.timeMs) return false;
  if (last?.event === event && last.reason === code) {
    if (!number(journal.suppressed + 1)) return false;
    journal.suppressed++; return true;
  }
  if (!number(journal.nextSequence + 1)) return false;
  journal.entries.push({ sequence: journal.nextSequence++, timeMs, event, reason: code });
  while (journal.entries.length > maxEntries || bytes(journal) > maxBytes) {
    if (!journal.entries.length || !number(journal.dropped + 1)) return false;
    journal.entries.shift(); journal.dropped++;
  }
  return true;
}

function normalize(record) {
  if (!record || record.schema !== 1 || record.running !== false || !newControllerRecord(record.runId) ||
      !number(record.planEpoch) || !number(record.retiredThrough) || record.retiredThrough > record.planEpoch || typeof record.requiresReview !== 'boolean' ||
      (record.activeCommandId !== null && !identifier(record.activeCommandId)) ||
      !Array.isArray(record.ledger) || record.ledger.length > 1000) return null;
  let cursor = null;
  if (record.cursor !== null) {
    const value = record.cursor;
    if (!value || (value.afterId !== null && !identifier(value.afterId)) || !number(value.wraps)) return null;
    cursor = { afterId: value.afterId, wraps: value.wraps };
  }
  const seen = new Set(), ledger = []; let previousEpoch = record.retiredThrough;
  for (const entry of record.ledger) {
    if (!identifier(entry?.id) || seen.has(entry.id) || !number(entry.epoch) || entry.epoch <= previousEpoch || entry.epoch > record.planEpoch ||
        !['attempted', 'verified', 'failed', 'cancelled', 'retired'].includes(entry.phase)) return null;
    previousEpoch = entry.epoch; seen.add(entry.id); ledger.push({ id: entry.id, epoch: entry.epoch, phase: entry.phase });
  }
  if (record.activeCommandId !== null && !seen.has(record.activeCommandId)) return null;
  const journal = record.journal;
  if (!journal || !number(journal.nextSequence) || !number(journal.dropped) || !number(journal.suppressed) ||
      !Array.isArray(journal.entries) || journal.entries.length > 1000) return null;
  const entries = []; let sequence = -1, timeMs = -1;
  for (const entry of journal.entries) {
    if (!entry || !number(entry.sequence) || entry.sequence <= sequence || entry.sequence >= journal.nextSequence ||
        !number(entry.timeMs) || entry.timeMs < timeMs || !EVENTS.has(entry.event) || !REASONS.has(entry.reason)) return null;
    entries.push({ sequence: entry.sequence, timeMs: entry.timeMs, event: entry.event, reason: entry.reason });
    sequence = entry.sequence; timeMs = entry.timeMs;
  }
  return { schema: 1, running: false, runId: record.runId, planEpoch: record.planEpoch, retiredThrough: record.retiredThrough, cursor,
    activeCommandId: record.activeCommandId, requiresReview: record.requiresReview, ledger,
    journal: { nextSequence: journal.nextSequence, dropped: journal.dropped, suppressed: journal.suppressed, entries } };
}
export function encodeControllerRecord(record) {
  try { const safe = normalize(record); return safe && bytes(safe) <= 1_048_576 ? JSON.stringify(safe) : null; }
  catch { return null; }
}
export function decodeControllerRecord(serialized) {
  try {
    if (typeof serialized !== 'string' || serialized.length > 1_048_576 || new TextEncoder().encode(serialized).length > 1_048_576) return null;
    return normalize(JSON.parse(serialized));
  } catch { return null; }
}

export function compactRetiredCommands(record, limit = 1000) {
  if (!number(limit) || limit < 1 || limit > 1000) return false;
  while (record.ledger.length >= limit && record.ledger[0]?.phase === 'retired') {
    const entry = record.ledger.shift(); record.retiredThrough = entry.epoch;
  }
  return record.ledger.length < limit;
}
