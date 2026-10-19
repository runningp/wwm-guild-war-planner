import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, validatePlan, assignPerson, assignedSlot, unassignPerson, setLeave, deleteStyle, allSlots, PHASES } from '../core.mjs';
function fixture() {
  const s = createPlan();
  s.people.push({ id: 'a', name: '阿青', styleIds: ['builtin-1'], note: '主攻', onLeave: false, isCommander: false }, { id: 'b', name: '小白', styleIds: [], note: '', onLeave: false, isCommander: false });
  return s;
}
test('blank and full JSON snapshots round trip without losing data', () => {
  assert.deepEqual(validatePlan(createPlan()), createPlan());
  const s = fixture(); s.name = '周末阵容'; s.customStyles.push({ id: 'custom-a', name: '自定义' });
  s.teams[0].note = '守住中路\n听指挥集火';
  s.people[0].styleIds.push('custom-a'); s.people[1].onLeave = true;
  const slot = allSlots(s)[0]; slot.note = '打野'; slot.phaseEnabled = true;
  slot.styles = { tower: 'builtin-2', goose: 'custom-a', tree: null };
  assignPerson(s, 'a', slot.id);
  assert.deepEqual(validatePlan(JSON.parse(JSON.stringify(s))), s);
});
test('replacement releases displaced person and clears source without swapping', () => {
  const s = fixture(), [first, second] = allSlots(s);
  first.note = '保留职责'; first.styles = { tower: 'builtin-13', goose: 'builtin-13', tree: 'builtin-13' };
  assignPerson(s, 'a', first.id); assignPerson(s, 'b', second.id); assignPerson(s, 'a', second.id);
  assert.equal(first.personId, null); assert.equal(second.personId, 'a'); assert.equal(assignedSlot(s, 'b'), undefined);
  assert.equal(first.note, '保留职责'); assert.equal(first.styles.tower, 'builtin-13');
  assignPerson(s, 'a', second.id); assert.equal(second.personId, 'a');
  assert.equal(allSlots(s).filter(s => s.personId === 'a').length, 1); validatePlan(s);
});
test('leave restrictions apply to every assignment path', () => {
  const s = fixture(), slot = allSlots(s)[0];
  setLeave(s, 'a', true); assert.throws(() => assignPerson(s, 'a', slot.id), /请假/);
  setLeave(s, 'a', false); assignPerson(s, 'a', slot.id);
  assert.throws(() => setLeave(s, 'a', true), /撤下/);
  unassignPerson(s, 'a'); setLeave(s, 'a', true); validatePlan(s);
});
test('mismatched flow styles do not restrict assignment or import', () => {
  const s = fixture(), slot = allSlots(s)[0];
  slot.phaseEnabled = true; slot.styles = { tower: 'builtin-13', goose: 'builtin-2', tree: 'builtin-4' };
  assignPerson(s, 'b', slot.id); assert.doesNotThrow(() => validatePlan(s));
});
test('custom style deletion cleans every phase and person while retaining assignments', () => {
  const s = fixture(); s.customStyles.push({ id: 'custom-a', name: '新流派' });
  s.people.forEach(p => p.styleIds.push('custom-a'));
  const [a, b] = allSlots(s); a.styles = Object.fromEntries(PHASES.map(p => [p, 'custom-a']));
  b.phaseEnabled = true; b.styles = { tower: 'custom-a', goose: 'builtin-1', tree: 'custom-a' };
  assignPerson(s, 'a', a.id); deleteStyle(s, 'custom-a');
  assert.equal(a.personId, 'a'); assert.equal(s.people[1].styleIds.length, 0);
  assert.deepEqual(a.styles, { tower: null, goose: null, tree: null });
  assert.equal(b.styles.goose, 'builtin-1'); validatePlan(s);
  assert.throws(() => deleteStyle(s, 'builtin-1'));
});
test('invalid file versions are rejected without changing current data', () => {
  const current = fixture(), before = JSON.stringify(current);
  for (const version of [undefined, null, '1', 0, 2, -1, 1.5]) {
    const bad = createPlan(); bad.schemaVersion = version;
    assert.throws(() => validatePlan(bad), /版本|schemaVersion/);
  }
  assert.equal(JSON.stringify(current), before);
});
test('import rejects duplicates, dangling references, invalid structures and leave conflicts', () => {
  const cases = [
    s => s.people[1].name = '阿青', s => s.people[1].id = 'a',
    s => s.people[0].styleIds.push('unknown'), s => allSlots(s)[0].personId = 'unknown',
    s => { allSlots(s)[0].personId = 'a'; allSlots(s)[1].personId = 'a'; },
    s => { s.people[0].onLeave = true; allSlots(s)[0].personId = 'a'; },
    s => s.customStyles.push({ id: 'custom-a', name: '无名' }),
    s => s.customStyles.push({ id: 'builtin-1', name: '其他' }),
    s => s.teams[1].id = s.teams[0].id,
    s => s.teams[0].slots[1].id = s.teams[0].slots[0].id,
    s => s.teams.pop(), s => s.teams[0].slots.pop(),
    s => allSlots(s)[0].styles.tower = 'builtin-1', s => s.unknownField = 'do not discard'
  ];
  for (const modify of cases) { const s = fixture(); modify(s); assert.throws(() => validatePlan(s)); }
});
test('more than 30 roster members are valid and replacements never delete people', () => {
  const s = fixture(); for (let i = 0; i < 40; i++) s.people.push({ id: `p${i}`, name: `成员${i}`, styleIds: [], note: '', onLeave: false, isCommander: false });
  allSlots(s).forEach((slot, i) => assignPerson(s, s.people[i].id, slot.id));
  const original = s.people.length; assignPerson(s, 'p39', allSlots(s)[0].id);
  assert.equal(s.people.length, original); validatePlan(s);
});
test('backup assignment stays unique across both roles and locks leave', () => {
  const s = fixture(), [first, second] = allSlots(s);
  assignPerson(s, 'a', first.id);
  assignPerson(s, 'a', second.id, 'backup');
  assert.equal(first.personId, null); assert.equal(second.backupPersonId, 'a');
  assert.equal(assignedSlot(s, 'a'), second);
  assert.throws(() => setLeave(s, 'a', true), /撤下/);
  assignPerson(s, 'b', second.id, 'backup');
  assert.equal(assignedSlot(s, 'a'), undefined);
  assert.equal(second.backupPersonId, 'b');
  assignPerson(s, 'b', second.id);
  assert.equal(second.backupPersonId, null); assert.equal(second.personId, 'b');
  unassignPerson(s, 'b'); setLeave(s, 'b', true);
  assert.throws(() => assignPerson(s, 'b', first.id, 'backup'), /请假/);
  validatePlan(s);
});
test('backup visibility and commander flags survive JSON without changing assignments', () => {
  const s = fixture(); s.people[0].isCommander = true; s.showBackups = false;
  assignPerson(s, 'a', allSlots(s)[0].id, 'backup');
  const restored = validatePlan(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  const bad = structuredClone(s); allSlots(bad)[1].personId = 'a';
  assert.throws(() => validatePlan(bad), /重复/);
  bad.people[0].isCommander = 'yes'; assert.throws(() => validatePlan(bad), /指挥/);
});
test('existing unreleased format 1 drafts receive empty new fields without data loss', () => {
  const s = fixture(); assignPerson(s, 'a', allSlots(s)[0].id);
  delete s.showBackups; s.people.forEach(p => delete p.isCommander);
  s.teams.forEach(t => delete t.note);
  allSlots(s).forEach(slot => delete slot.backupPersonId);
  const original = JSON.stringify(s), restored = validatePlan(s);
  assert.equal(restored.schemaVersion, 1); assert.equal(restored.showBackups, true);
  assert.equal(allSlots(restored)[0].personId, 'a');
  assert.ok(restored.people.every(p => p.isCommander === false));
  assert.ok(allSlots(restored).every(slot => slot.backupPersonId === null));
  assert.ok(restored.teams.every(team => team.note === ''));
  assert.equal(JSON.stringify(s), original);
});
