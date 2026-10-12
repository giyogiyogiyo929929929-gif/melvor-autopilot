import test from 'node:test';
import assert from 'node:assert/strict';
import { newControllerRecord, appendControllerEvent, encodeControllerRecord, decodeControllerRecord, compactRetiredCommands } from '../src/controller-record.mjs';

test('checkpoint format always represents stopped startup and contains only narrow fields', () => {
  const record = newControllerRecord('run'); record.unrelated = { saveString: 'private' };
  const encoded = encodeControllerRecord(record); assert.ok(encoded); assert.ok(!encoded.includes('private'));
  assert.deepEqual(decodeControllerRecord(encoded), newControllerRecord('run')); assert.equal(JSON.parse(encoded).running, false);
});
test('unknown event/reason payloads and exceptions cannot leak into the journal', () => {
  const record = newControllerRecord('run');
  assert.equal(appendControllerEvent(record, 0, 'unsafe-upload', 'secret'), false);
  assert.equal(appendControllerEvent(record, 0, 'halt', 'private-save-token'), true);
  assert.equal(record.journal.entries[0].reason, 'external-reason-rejected');
  assert.ok(!encodeControllerRecord(record).includes('private-save-token'));
});
test('entry and byte bounds rotate journal while preserving ledger and monotonic sequence', () => {
  const record = newControllerRecord('run'); record.planEpoch = 1; record.activeCommandId = 'command';
  record.ledger.push({ id: 'command', epoch: 1, phase: 'attempted' });
  for (let i = 0; i < 20; i++) assert.equal(appendControllerEvent(record, i, i % 2 ? 'monitor-wait' : 'monitor-progress',
    i % 2 ? 'awaiting-progress' : 'target-progressed', { maxEntries: 3, maxBytes: 400 }), true);
  assert.ok(record.journal.entries.length <= 3); assert.ok(record.journal.dropped > 0);
  assert.equal(record.ledger[0].id, 'command'); assert.equal(record.journal.nextSequence, 20);
});
test('repeated wait messages are aggregated without fabricating target progress', () => {
  const record = newControllerRecord('run');
  for (let i = 0; i < 100; i++) appendControllerEvent(record, i, 'monitor-wait', 'awaiting-progress');
  assert.equal(record.journal.entries.length, 1); assert.equal(record.journal.suppressed, 99);
});
test('malformed, oversized, running and inconsistent checkpoints are rejected', () => {
  for (const encoded of ['{bad', 'x'.repeat(1_048_577), null]) assert.equal(decodeControllerRecord(encoded), null);
  for (const alter of [r => { r.running = true; }, r => { r.schema = 2; }, r => { r.activeCommandId = 'missing'; },
    r => { r.planEpoch = NaN; }, r => { r.retiredThrough = 1; }, r => { r.cursor = {}; }]) {
    const r = newControllerRecord('run'); alter(r); assert.equal(encodeControllerRecord(r), null);
  }
});
test('retired command compaction preserves a watermark and never removes unresolved commands', () => {
  const r = newControllerRecord('run'); r.planEpoch = 3;
  r.ledger = [{ id: 'a', epoch: 1, phase: 'retired' }, { id: 'b', epoch: 2, phase: 'attempted' }, { id: 'c', epoch: 3, phase: 'retired' }];
  r.activeCommandId = 'b'; assert.equal(compactRetiredCommands(r, 2), false);
  assert.equal(r.retiredThrough, 1); assert.equal(r.ledger[0].id, 'b'); assert.ok(encodeControllerRecord(r));
  r.ledger[0].phase = 'retired'; r.activeCommandId = null;
  assert.equal(compactRetiredCommands(r, 2), true); assert.equal(r.retiredThrough, 2);
  r.ledger.push({ id: 'replay', epoch: 1, phase: 'attempted' }); assert.equal(encodeControllerRecord(r), null);
});
test('duplicate IDs, nonmonotonic command epochs and journal sequences fail validation', () => {
  const r = newControllerRecord('run'); r.planEpoch = 2;
  r.ledger = [{ id: 'same', epoch: 1, phase: 'retired' }, { id: 'same', epoch: 2, phase: 'retired' }];
  assert.equal(encodeControllerRecord(r), null); r.ledger = [];
  appendControllerEvent(r, 0, 'started', 'user-start'); appendControllerEvent(r, 1, 'halt', 'scan-limit');
  r.journal.entries[1].sequence = 0; assert.equal(encodeControllerRecord(r), null);
});
test('decoded checkpoints are detached from the caller source', () => {
  const r = newControllerRecord('run'); appendControllerEvent(r, 0, 'started', 'user-start');
  const decoded = decodeControllerRecord(encodeControllerRecord(r)); decoded.journal.entries[0].reason = 'user-stop';
  assert.equal(r.journal.entries[0].reason, 'user-start');
});
