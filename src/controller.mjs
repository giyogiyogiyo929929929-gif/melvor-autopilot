/** Transactional analysis/monitor lifecycle. Runtime operations remain disabled. */
import { selectWindowedQuantifiedCompletionPlan } from './quantified-planner.mjs';
import { monitorTask } from './monitor.mjs';
import { buildCompletionReport } from './completion-report.mjs';
import { newControllerRecord, appendControllerEvent, encodeControllerRecord, decodeControllerRecord,
  compactRetiredCommands, safeReason } from './controller-record.mjs';
const count = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const result = (status, reason) => ({ status, reason, runnable: false });
const CLEAN = new Set(['stopped-verified', 'already-stopped', 'no-owned-action']);
function timed(call, timeoutMs) {
  let timer;
  return Promise.race([Promise.resolve().then(call), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('port-timeout')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}
export function createAutopilotController(_ports, _options) {
  return Object.freeze({ start: async () => result('blocked', 'runtime-controller-unverified'),
    step: async () => result('blocked', 'runtime-controller-unverified'), stop: async () => result('stopped', 'runtime-controller-unverified'),
    getState: () => ({ status: 'stopped', reason: 'runtime-controller-unverified', busy: false, activeTaskId: null, runnable: false }),
    exportCheckpoint: () => null, getReport: () => null });
}

/** Only artificial observe/executor/store ports may use this entry. */
export function createAutopilotControllerForTesting(ports, options = {}) {
  try { return createTesting(ports, options); }
  catch { return createAutopilotController(); }
}
function createTesting(ports, options) {
  let record = newControllerRecord(options.runId ?? 'fixture');
  const timeoutMs = options.timeoutMs ?? 5000, maxIdleWindows = options.maxIdleWindows ?? 500,
    maxSteps = options.maxSteps ?? 100_000, ledgerLimit = options.ledgerLimit ?? 1000;
  if (!record || !count(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !count(maxIdleWindows) || maxIdleWindows < 1 || maxIdleWindows > 10_000 ||
      !count(maxSteps) || maxSteps < 1 || maxSteps > 1_000_000 || !count(ledgerLimit) || ledgerLimit < 1 || ledgerLimit > 1000 ||
      typeof ports?.observe !== 'function' || typeof ports.store?.read !== 'function' || typeof ports.store?.write !== 'function' ||
      !['start', 'execute', 'stop', 'getState', 'abandon'].every(key => typeof ports.executor?.[key] === 'function')) return createAutopilotController();
  const observe = ports.observe, executor = ports.executor, store = { read: ports.store.read, write: ports.store.write };
  let status = 'stopped', reason = 'default-stopped', initialized = false, busy = false, generation = 0,
    lastTime = 0, sessionId = null, active = null, idleWindows = 0, steps = 0, operationInFlight = false;
  let writes = Promise.resolve();
  let permittedSession = null;
  let initializeProblem = null;
  let report = null, reportCheckpoint = null;
  const log = (event, why) => {
    if (!appendControllerEvent(record, lastTime, event, why, options.journal)) throw new Error('journal-invalid');
  };
  function disable(why, review = false) {
    generation++; status = review ? 'blocked' : 'stopped'; reason = safeReason(why); record.requiresReview ||= review;
  }
  async function persist() {
    const serialized = encodeControllerRecord(record);
    if (serialized === null) throw new Error('record-invalid');
    // Serialize writes. A late old write cannot finish after the newer stop record.
    const write = writes.then(() => Promise.resolve().then(() => store.write(serialized)));
    writes = write.catch(() => {});
    await timed(() => write, timeoutMs);
  }
  function currentEntry() { return record.ledger.find(entry => entry.id === record.activeCommandId); }
  async function cleanup() {
    try {
      const outcome = await timed(() => executor.stop(), timeoutMs);
      const state = executor.getState();
      if (outcome?.status !== 'stopped' || !CLEAN.has(outcome.cleanup) || state.pendingMutation || state.requiresReview) {
        record.requiresReview = true; return false;
      }
      const entry = currentEntry();
      if (entry && !operationInFlight) entry.phase = 'retired';
      if (!operationInFlight) { record.activeCommandId = null; active = null; }
      else { record.requiresReview = true; return false; }
      return true;
    } catch { record.requiresReview = true; return false; }
  }
  function clock(context) {
    if (!count(context?.nowMs) || !id(context.sessionId) || (context.offline !== undefined && typeof context.offline !== 'boolean')) return 'context-invalid';
    if (context.nowMs < lastTime) return 'clock-reversed';
    lastTime = context.nowMs;
    if (sessionId !== null && context.sessionId !== sessionId) return 'session-changed';
    return null;
  }
  async function initialize() {
    const saved = await timed(() => store.read(), timeoutMs);
    if (saved !== null) {
      const restored = decodeControllerRecord(saved);
      if (!restored || restored.runId !== record.runId) { initializeProblem = 'checkpoint-invalid'; throw new Error('checkpoint-invalid'); }
      record = restored;
      record.requiresReview ||= record.activeCommandId !== null || record.ledger.some(entry => entry.phase !== 'retired');
      lastTime = record.journal.entries.at(-1)?.timeMs ?? 0;
    }
    initialized = true;
  }
  return Object.freeze({
    async start(session, context) {
      if (busy) return result('blocked', 'controller-busy');
      if (['planning', 'monitoring', 'offline'].includes(status)) return result('blocked', 'controller-already-started');
      if (session?.version !== 'v1.3.1' || session.saveCopy !== true || session.developmentProfile !== true ||
          session.modsCompatible !== true || session.operationsVerified !== true) return result('blocked', 'session-preconditions-unverified');
      const token = generation; busy = true;
      try {
        if (!initialized) await initialize();
        if (token !== generation) return result('cancelled', 'user-stop');
        if (record.requiresReview) { status = 'blocked'; reason = 'checkpoint-unresolved'; return result(status, reason); }
        const problem = clock(context);
        if (problem) { disable(problem, true); return result(status, reason); }
        const ready = executor.start(session);
        if (ready?.status !== 'ready') { disable('executor-start-failed', true); return result(status, reason); }
        permittedSession = { version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true };
        sessionId = context.sessionId; status = 'planning'; reason = null; idleWindows = 0; steps = 0;
        report = null; reportCheckpoint = null;
        log('started', 'user-start'); await persist();
        if (token !== generation) return result('cancelled', 'user-stop');
        return result(status, reason);
      } catch { disable(initializeProblem ?? 'store-failed', true); return result(status, reason); }
      finally { busy = false; }
    },
    async step(context) {
      if (!['planning', 'monitoring', 'offline'].includes(status)) return result('blocked', 'controller-stopped');
      if (busy) return result('blocked', 'controller-busy');
      const problem = clock(context);
      if (problem) {
        disable(problem, true);
        if (problem === 'session-changed') { executor.abandon(); report = null; reportCheckpoint = null; } else await cleanup();
        try { log('halt', problem); await persist(); } catch { record.requiresReview = true; }
        return result(status, reason);
      }
      const token = generation; busy = true;
      let reportInput = null;
      try {
        if (++steps > maxSteps) { disable('step-limit'); log('halt', reason); await cleanup(); await persist(); return result(status, reason); }
        const targets = active ? active.task.endConditions.filter(condition => condition.type === 'completion').map(condition => Object.freeze({ ...condition })) : null;
        const resourceTargets = active ? Object.freeze({ itemIds: Object.freeze([...new Set([...active.task.requirements.items.map(item => item.id),
          ...active.task.requirements.outputIds, ...active.task.endConditions.filter(condition => condition.type === 'inventory').map(condition => condition.id)])].sort()),
          currencyIds: Object.freeze([...new Set(active.task.requirements.currencies.map(currency => currency.id))].sort()) }) : null;
        const request = Object.freeze({ phase: active || status === 'offline' || context.offline === true ? 'monitoring' : 'planning',
          nowMs: lastTime, sessionId, offline: context.offline === true, ...(targets === null ? {} : { targets: Object.freeze(targets), resourceTargets,
            expectedActionId: active.task.action.id, treeIds: Object.freeze([...active.task.action.selectionIds]) }) });
        const frame = await timed(() => observe(request), timeoutMs);
        if (token !== generation) return result('cancelled', 'user-stop');
        if (frame?.offline !== undefined && typeof frame.offline !== 'boolean') throw new Error('offline-invalid');
        const offline = context.offline === true || frame?.offline === true;
        reportInput = { snapshot: frame?.completionSnapshot, nowMs: lastTime, offline };
        if (offline) {
          if (active) {
            const suspended = monitorTask(active.task, null, active.checkpoint,
              { nowMs: lastTime, sessionId, offline: true }); active.checkpoint = suspended.checkpoint;
          }
          status = 'offline'; reason = 'game-offline'; log('offline', reason); await persist(); return result(status, reason);
        }
        if (status === 'offline' && active === null) {
          status = 'planning'; reason = 'fresh-observation-required'; log('task-replan', reason); await persist(); return result(status, reason);
        }
        if (active) {
          const watched = monitorTask(active.task, frame, active.checkpoint, { nowMs: lastTime, sessionId });
          active.checkpoint = watched.checkpoint;
          if (watched.status === 'continue') {
            status = 'monitoring'; reason = null; log(watched.metrics?.progressed ? 'monitor-progress' : 'monitor-wait',
              watched.metrics?.progressed ? 'target-progressed' : 'awaiting-progress'); await persist(); return result(status, reason);
          }
          const done = watched.status === 'complete', replan = watched.status === 'replan';
          const cleaned = await cleanup();
          if (token !== generation) return result('cancelled', 'user-stop');
          if (!cleaned) { disable('cleanup-failed', true); log('halt', reason); }
          else if (done || replan) {
            status = 'planning'; reason = 'fresh-observation-required'; idleWindows = 0;
            log(done ? 'task-complete' : 'task-replan', done ? 'end-conditions-satisfied' : reason);
          } else { disable(watched.status === 'stopped' ? 'game-paused' : 'monitor-blocked'); log('halt', reason); }
          await persist(); return result(status, reason);
        }
        status = 'planning';
        if (!count(record.planEpoch + 1)) { disable('checkpoint-limit', true); log('halt', reason); await persist(); return result(status, reason); }
        const epoch = record.planEpoch + 1;
        const plan = selectWindowedQuantifiedCompletionPlan(frame?.completionSnapshot, frame?.graph, frame?.estimates,
          frame?.resources, frame?.model, { ...options.planning, nowMs: lastTime, cursor: record.cursor, planEpoch: epoch,
            capabilities: ['melvorF:Woodcutting'] });
        if (plan.window?.nextCursor) record.cursor = { ...plan.window.nextCursor };
        if (!plan.selected || !plan.nextTask) {
          reason = 'no-safe-candidate'; log('scan-blocked', reason);
          if (++idleWindows >= maxIdleWindows || !plan.window?.nextCursor) { disable('scan-limit'); log('halt', reason); }
          await persist(); return result(status, reason);
        }
        const task = plan.nextTask;
        if (task.action.id !== 'melvorF:Woodcutting' || task.action.selectionIds.length !== 1) {
          reason = 'unsupported-action'; log('scan-blocked', reason);
          if (++idleWindows >= maxIdleWindows) { disable('scan-limit'); log('halt', reason); }
          await persist(); return result(status, reason);
        }
        const commandId = JSON.stringify([record.runId, task.id]);
        const ready = executor.start(permittedSession);
        if (ready?.status !== 'ready') { disable('executor-start-failed', true); log('halt', reason); await persist(); return result(status, reason); }
        if (commandId.length > 16_384 || record.ledger.some(entry => entry.id === commandId) || !compactRetiredCommands(record, ledgerLimit)) {
          disable('checkpoint-limit', true); log('halt', reason); await persist(); return result(status, reason);
        }
        record.planEpoch = epoch; record.activeCommandId = commandId;
        record.ledger.push({ id: commandId, epoch, phase: 'attempted' }); log('command-attempted', 'operation-pending');
        await persist();
        if (token !== generation) return result('cancelled', 'user-stop');
        operationInFlight = true;
        const execution = Promise.resolve().then(() => executor.execute({ id: commandId, kind: 'woodcutting-start', treeId: task.action.selectionIds[0] }));
        execution.then(() => { operationInFlight = false; }, () => { operationInFlight = false; });
        const performed = await timed(() => execution, timeoutMs);
        if (token !== generation) {
          const entry = currentEntry(); if (entry) entry.phase = 'cancelled';
          return result('cancelled', 'user-stop');
        }
        if (performed?.status !== 'verified' || executor.getState().requiresReview) {
          const entry = currentEntry(); if (entry) entry.phase = 'failed';
          disable('operation-failed', true); await cleanup(); log('halt', reason); await persist(); return result(status, reason);
        }
        currentEntry().phase = 'verified'; active = { task, checkpoint: null, candidateId: plan.selected.candidateId };
        idleWindows = 0; status = 'monitoring'; reason = null; log('command-verified', 'action-confirmed'); await persist();
        return result(status, reason);
      } catch {
        disable(record.activeCommandId ? 'controller-error' : 'observation-failed', true);
        await cleanup();
        try { log('halt', reason); await persist(); } catch { record.requiresReview = true; }
        return result(status, reason);
      } finally {
        if (reportInput) {
          report = buildCompletionReport(reportInput.snapshot, { journal: record.journal },
            { nowMs: reportInput.nowMs, offline: reportInput.offline }, reportCheckpoint);
          reportCheckpoint = report.checkpoint;
        }
        busy = false;
      }
    },
    async stop() {
      disable('user-stop');
      if (!initialized) return result('stopped', 'user-stop');
      const cleaned = await cleanup();
      if (!cleaned) record.requiresReview = true;
      try { log('user-stop', 'user-stop'); await persist(); } catch { record.requiresReview = true; }
      return result('stopped', 'user-stop');
    },
    getState: () => ({ status, reason, busy, initialized, requiresReview: record.requiresReview,
      activeTaskId: active?.task.id ?? null, activeCandidateId: active?.candidateId ?? null,
      planEpoch: record.planEpoch, retiredThrough: record.retiredThrough, cursor: record.cursor ? { ...record.cursor } : null,
      journal: structuredClone(record.journal), runnable: false }),
    exportCheckpoint: () => encodeControllerRecord(record),
    getReport: () => report === null ? null : structuredClone(report)
  });
}
