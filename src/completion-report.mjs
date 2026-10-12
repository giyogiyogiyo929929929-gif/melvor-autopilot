/** Bounded, detached diagnostics. No original saves or runtime success claims. */
import { auditCompletion } from './completion-audit.mjs';
import { safeReason } from './controller-record.mjs';
const count = value => Number.isSafeInteger(value) && value >= 0;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
function vector(audit) {
  const totals = [];
  for (const scope of audit.scopes) if (scope.ownership === true)
    for (const [category, value] of Object.entries(scope.categories)) totals.push({ id: `${scope.id}:${category}`, current: value.current, maximum: value.maximum });
  return totals;
}
export function buildCompletionReport(snapshot, state = {}, options = {}, previous = null) {
  try {
    const nowMs = options.nowMs, stagnationMs = options.stagnationMs ?? 3_600_000,
      maxObservationGapMs = options.maxObservationGapMs ?? 300_000,
      maxBytes = options.maxBytes ?? 65_536, maxCauses = options.maxCauses ?? 64;
    if (!count(nowMs) || !count(stagnationMs) || stagnationMs < 1 || stagnationMs > 2_592_000_000 ||
        !count(maxObservationGapMs) || maxObservationGapMs < 1 || maxObservationGapMs > 2_592_000_000 ||
        !count(maxBytes) || maxBytes < 1024 || maxBytes > 1_048_576 || !count(maxCauses) || maxCauses > 256 ||
        (options.offline !== undefined && typeof options.offline !== 'boolean')) return { supported: false, reason: 'report-options-invalid', checkpoint: null, actualComplete: false };
    const audit = auditCompletion(snapshot, { maxMissingPerCategory: options.maxMissingPerCategory ?? 100 });
    let progress = { status: 'unverified', reason: 'whole-observation-required', stagnantMs: null, changed: false }, checkpoint = null;
    if (audit.comparable) {
      const counts = vector(audit);
      const signature = JSON.stringify([snapshot.version, snapshot.mode.id, snapshot.mode.hardcore,
        audit.scopes.map(scope => [scope.id, scope.ownership]), counts.map(value => [value.id, value.maximum])]);
      const validOld = previous && previous.schema === 1 && typeof previous.signature === 'string' && previous.signature.length <= 4096 &&
        count(previous.observedAtMs) && count(previous.lastProgressAtMs) && previous.lastProgressAtMs <= previous.observedAtMs &&
        typeof previous.offline === 'boolean' && Array.isArray(previous.counts) && previous.counts.length <= 20 &&
        previous.counts.every(value => /^(base|toth|aod|ita):(skills|mastery|items|monsters|pets)$/.test(value?.id) &&
          count(value.current) && count(value.maximum) && value.current <= value.maximum) &&
        new Set(previous.counts.map(value => value.id)).size === previous.counts.length &&
        (previous.signature !== signature || previous.counts.length === counts.length && counts.every(entry =>
          previous.counts.some(old => old.id === entry.id && old.maximum === entry.maximum)));
      if (previous !== null && !validOld) progress = { ...progress, status: 're-evaluate', reason: 'report-checkpoint-invalid' };
      else if (validOld && nowMs < previous.observedAtMs) progress = { ...progress, status: 're-evaluate', reason: 'report-time-reversed' };
      else {
        const observationGap = validOld && nowMs - previous.observedAtMs > maxObservationGapMs;
        const same = validOld && previous.signature === signature && !previous.offline && !options.offline && !observationGap;
        let changed = false, regressed = false;
        if (same) for (const entry of counts) {
          const old = previous.counts.find(value => value.id === entry.id);
          if (!old) { regressed = true; break; }
          changed ||= entry.current > old.current; regressed ||= entry.current < old.current;
        }
        const lastProgressAtMs = same && !changed && !regressed ? previous.lastProgressAtMs : nowMs;
        const stagnantMs = nowMs - lastProgressAtMs;
        checkpoint = { schema: 1, signature, observedAtMs: nowMs, lastProgressAtMs, offline: options.offline === true,
          counts: counts.map(value => ({ ...value })) };
        progress = { status: options.offline ? 'offline' : !same || regressed ? 'baseline' : changed ? 'progressing' : stagnantMs >= stagnationMs ? 'stagnant' : 'waiting',
          reason: options.offline ? 'game-offline' : regressed ? 'completion-count-regressed' : observationGap ? 'observation-gap' : !same ? 'observation-baseline' : changed ? 'completion-count-increased' : 'awaiting-completion-progress',
          stagnantMs, changed };
        if (audit.observationComplete && !options.offline) progress = { status: 'observed-complete',
          reason: 'runtime-verification-required', stagnantMs: null, changed };
      }
    }
    const causes = [], seen = new Set();
    const journal = state?.journal?.entries ?? [];
    if (!Array.isArray(journal) || journal.length > 1000) return { supported: false, reason: 'report-journal-invalid', checkpoint: null, actualComplete: false };
    for (const entry of journal) {
      const reason = safeReason(entry?.reason);
      if (seen.has(reason)) continue;
      seen.add(reason); if (causes.length < maxCauses) causes.push({ reason });
    }
    const report = { supported: true, reason: null, observedAtMs: nowMs, audit, progress, causes,
      causesOmitted: Math.max(0, seen.size - causes.length), explorationCoverage: 'partial-or-unverified',
      reachability: 'not-proven', actualComplete: false, truncated: false, runnable: false, checkpoint };
    // Keep aggregate/unknown status; trim examples, never the observation being audited.
    while (bytes(report) > maxBytes) {
      let removed = false;
      for (const scope of audit.scopes) for (const category of Object.values(scope.categories)) {
        if (category.missing.length) { category.missing.pop(); category.omitted++; removed = true; }
      }
      if (!removed && causes.length) { causes.pop(); report.causesOmitted++; removed = true; }
      report.truncated = true;
      if (!removed) return { supported: false, reason: 'report-byte-limit', checkpoint: null, actualComplete: false };
    }
    return report;
  } catch { return { supported: false, reason: 'report-input-unreadable', checkpoint: null, actualComplete: false }; }
}
