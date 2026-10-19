export const SCHEMA_VERSION = 1;
export const PHASES = ['tower', 'goose', 'tree'];
export const PHASE_NAMES = { tower: '塔', goose: '鹅', tree: '树' };
export const DEFAULT_STYLES = ['无名', '九剑', '钧钧', '玉玉', '霖霖', '翊翊', '风风', '樽樽', '尘尘', '鸢鸢', '双剑', '无名奶', '陌双']
  .map((name, i) => ({ id: `builtin-${i + 1}`, name }));
export const clone = value => JSON.parse(JSON.stringify(value));
export const nameKey = value => value.trim().normalize('NFC').toLocaleLowerCase('en');
export const allStyles = state => [...DEFAULT_STYLES, ...state.customStyles];
export const allSlots = state => state.teams.flatMap(t => t.slots);
export const assignedSlot = (state, personId) => allSlots(state).find(s => s.personId === personId || s.backupPersonId === personId);
export const newId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;

export function createPlan() {
  return {
    schemaVersion: SCHEMA_VERSION,
    showBackups: true,
    name: '未命名方案',
    customStyles: [],
    people: [],
    teams: ['attack', 'defense'].flatMap(side => Array.from({ length: 3 }, (_, i) => ({
      id: `${side}-${i + 1}`, side, note: '',
      slots: Array.from({ length: 5 }, (_, n) => ({
        id: `${side}-${i + 1}-${n + 1}`, personId: null, backupPersonId: null, note: '',
        phaseEnabled: false, styles: { tower: null, goose: null, tree: null }
      }))
    })))
  };
}

function validateCurrent(input) {
  const fail = message => { throw new Error(message); };
  const object = (v, keys, label) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${label}必须是对象。`);
    if (Object.keys(v).some(k => !keys.includes(k))) fail(`${label}包含无法识别的字段。`);
    if (keys.some(k => !Object.hasOwn(v, k))) fail(`${label}缺少必要字段。`);
  };
  const string = (v, label, max, nonempty = false) => {
    if (typeof v !== 'string' || v.length > max || (nonempty && (!v.trim() || v !== v.trim()))) fail(`${label}格式不正确${nonempty ? '，不能为空或包含首尾空格' : ''}。`);
  };
  const unique = (values, label) => { if (new Set(values).size !== values.length) fail(`${label}不能重复。`); };
  if (!input || typeof input !== 'object') fail('文件必须包含一个方案对象。');
  if (!Number.isInteger(input.schemaVersion)) fail('缺少或无效的 schemaVersion，无法识别文件格式。');
  if (input.schemaVersion !== SCHEMA_VERSION) fail(`不支持格式版本 ${input.schemaVersion}；当前支持版本 ${SCHEMA_VERSION}。请使用兼容版本的工具。`);
  object(input, ['schemaVersion', 'name', 'customStyles', 'people', 'teams', 'showBackups'], '方案');
  if (typeof input.showBackups !== 'boolean') fail('替补栏显示设置必须为布尔值。');
  string(input.name, '方案名称', 80, true);
  if (!Array.isArray(input.customStyles) || !Array.isArray(input.people) || !Array.isArray(input.teams)) fail('流派、人员和小队必须是列表。');
  for (const style of input.customStyles) {
    object(style, ['id', 'name'], '自定义流派');
    string(style.id, '流派 ID', 100, true);
    string(style.name, '流派名称', 40, true);
  }
  const styles = allStyles(input);
  unique(styles.map(s => s.id), '流派 ID');
  unique(styles.map(s => nameKey(s.name)), '流派名称');
  const styleIds = new Set(styles.map(s => s.id));
  for (const person of input.people) {
    object(person, ['id', 'name', 'styleIds', 'note', 'onLeave', 'isCommander'], '人员');
    if (typeof person.isCommander !== 'boolean') fail('指挥标记必须为布尔值。');
    string(person.id, '人员 ID', 100, true);
    string(person.name, '人员名字', 80, true);
    string(person.note, '人员备注', 2000);
    if (typeof person.onLeave !== 'boolean') fail('请假状态必须为布尔值。');
    if (!Array.isArray(person.styleIds)) fail(`${person.name}的流派必须是列表。`);
    unique(person.styleIds, `${person.name}的流派`);
    if (person.styleIds.some(id => !styleIds.has(id))) fail(`${person.name}引用了不存在的流派。`);
  }
  unique(input.people.map(p => p.id), '人员 ID');
  unique(input.people.map(p => nameKey(p.name)), '人员名字');
  const people = new Map(input.people.map(p => [p.id, p]));
  const expected = createPlan().teams;
  if (input.teams.length !== 6) fail('必须包含进攻、防守各 3 个小队。');
  const assigned = [];
  for (const team of input.teams) {
    object(team, ['id', 'side', 'slots', 'note'], '小队');
    string(team.note, '小队备注', 2000);
    const standard = expected.find(t => t.id === team.id);
    if (!standard || team.side !== standard.side) fail('小队 ID 或攻守归属不正确。');
    if (!Array.isArray(team.slots) || team.slots.length !== 5) fail('每个小队必须有 5 个位置。');
    for (const slot of team.slots) {
      object(slot, ['id', 'personId', 'note', 'phaseEnabled', 'styles', 'backupPersonId'], '位置');
      if (!standard.slots.some(s => s.id === slot.id)) fail('位置 ID 与所属小队不一致。');
      string(slot.note, '位置备注', 2000);
      if (typeof slot.phaseEnabled !== 'boolean') fail('分阶段开关必须为布尔值。');
      object(slot.styles, PHASES, '阶段流派');
      for (const id of Object.values(slot.styles)) if (id !== null && !styleIds.has(id)) fail('位置引用了不存在的流派。');
      if (!slot.phaseEnabled && new Set(Object.values(slot.styles)).size !== 1) fail('未开启分阶段的位置，三个阶段流派必须一致。');
      for (const id of [slot.personId, slot.backupPersonId]) if (id !== null) {
        const person = people.get(id);
        if (!person) fail('位置引用了不存在的人员。');
        if (person.onLeave) fail(`请假人员「${person.name}」不能同时安排在位置上。`);
        assigned.push(id);
      }
    }
    unique(team.slots.map(s => s.id), '位置 ID');
  }
  unique(input.teams.map(t => t.id), '小队 ID');
  unique(assigned, '已安排人员');
  return clone(input);
}

export function validatePlan(input) {
  // Unreleased format 1: fill newly introduced fields in existing browser drafts.
  if (input?.schemaVersion === SCHEMA_VERSION) {
    const normalized = clone(input);
    if (!Object.hasOwn(normalized, 'showBackups')) normalized.showBackups = true;
    if (Array.isArray(normalized.people)) for (const person of normalized.people) {
      if (person && typeof person === 'object' && !Object.hasOwn(person, 'isCommander')) person.isCommander = false;
    }
    if (Array.isArray(normalized.teams)) for (const team of normalized.teams) {
      if (team && typeof team === 'object' && !Object.hasOwn(team, 'note')) team.note = '';
      if (Array.isArray(team?.slots)) for (const slot of team.slots) {
        if (slot && typeof slot === 'object' && !Object.hasOwn(slot, 'backupPersonId')) slot.backupPersonId = null;
      }
    }
    return validateCurrent(normalized);
  }
  return validateCurrent(input);
}

export function assignPerson(state, personId, slotId, role = 'primary') {
  if (!['primary', 'backup'].includes(role)) throw new Error('无效的人员分配类型。');
  const person = state.people.find(p => p.id === personId);
  const target = allSlots(state).find(s => s.id === slotId);
  if (!person || !target) throw new Error('人员或位置不存在。');
  if (person.onLeave) throw new Error('请先取消该人员的请假状态。');
  unassignPerson(state, personId);
  target[role === 'backup' ? 'backupPersonId' : 'personId'] = personId;
}

export function unassignPerson(state, personId) {
  for (const slot of allSlots(state)) {
    if (slot.personId === personId) slot.personId = null;
    if (slot.backupPersonId === personId) slot.backupPersonId = null;
  }
}

export function setLeave(state, personId, onLeave) {
  const person = state.people.find(p => p.id === personId);
  if (!person) throw new Error('人员不存在。');
  if (onLeave && assignedSlot(state, personId)) throw new Error('请先从配置区撤下该人员，再标记请假。');
  person.onLeave = onLeave;
}

export function deleteStyle(state, id) {
  if (!state.customStyles.some(s => s.id === id)) throw new Error('只能删除自定义流派。');
  state.customStyles = state.customStyles.filter(s => s.id !== id);
  for (const person of state.people) person.styleIds = person.styleIds.filter(s => s !== id);
  for (const slot of allSlots(state)) for (const phase of PHASES) if (slot.styles[phase] === id) slot.styles[phase] = null;
}
