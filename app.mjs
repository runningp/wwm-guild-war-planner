import { SCHEMA_VERSION, PHASES, PHASE_NAMES, DEFAULT_STYLES, createPlan, clone, validatePlan, allStyles, allSlots, assignedSlot, nameKey, newId, assignPerson, unassignPerson, setLeave, deleteStyle } from './core.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORAGE = 'wwm-war-planner-v1';
let state = createPlan(), selectedPerson = null, draggedPerson = null, toastTimer, editorContext = null, recoveryRaw = null;
const dialog = $('#editor');
const styleName = id => allStyles(state).find(s => s.id === id)?.name ?? '未设置';
const commanderBadge = p => p?.isCommander ? '<span class="commander-badge">指挥</span>' : '';
const styleTone = name => name === '霖霖' ? 'style-healer' : ['陌刀', '陌双'].includes(name) ? 'style-blade' : 'style-dps';
const styleBadge = id => id ? `<span class="chip style-badge ${styleTone(styleName(id))}">${esc(styleName(id))}</span>` : '<span class="stage-value unset">未设置</span>';
const personById = id => state.people.find(p => p.id === id);
const slotById = id => allSlots(state).find(s => s.id === id);
const placeName = slot => { const t = state.teams.find(t => t.slots.includes(slot)); return `${t.side === 'attack' ? '进攻' : '防守'} ${t.id.split('-')[1]} 队 · ${slot.id.split('-')[2]} 号位`; };

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 6500 : 3200);
}
function save() {
  if (recoveryRaw !== null) return;
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); $('#save-state').textContent = '已保存到此浏览器'; }
  catch { $('#save-state').textContent = '本地保存不可用，请导出备份'; }
}
function change(operation, message) {
  try {
    const next = clone(state); operation(next); state = validatePlan(next);
    save(); render(); if (message) toast(message); return true;
  } catch (error) { toast(error.message, true); return false; }
}
function render() {
  const focused = document.activeElement;
  const focusAction = focused?.dataset.action, focusId = focused?.dataset.id;
  $('#plan-name').value = state.name;
  const count = allSlots(state).filter(s => s.personId).length;
  const backups = allSlots(state).filter(s => s.backupPersonId).length;
  const leaveCount = state.people.filter(p => p.onLeave).length;
  $('#overview').innerHTML = `<div class="metric"><strong>${count}<small> / 30</small></strong><span>主力</span></div><div class="metric"><strong>${backups}</strong><span>替补</span></div><div class="metric"><strong>${state.people.length - count - backups - leaveCount}</strong><span>未安排</span></div><div class="metric"><strong>${leaveCount}</strong><span>请假</span></div>`;
  $('#show-backups').checked = state.showBackups;
  $('.board').classList.toggle('show-backups', state.showBackups);
  $('#people-count').textContent = state.people.length;
  if (selectedPerson && (!personById(selectedPerson) || personById(selectedPerson).onLeave)) selectedPerson = null;
  $('#selection-hint').hidden = !selectedPerson;
  $('#selection-hint').textContent = selectedPerson ? `已选择「${personById(selectedPerson).name}」，点击目标位置安排。` : '';
  $('#cancel-selection').hidden = !selectedPerson;
  $('.board').classList.toggle('selection-active', Boolean(selectedPerson));
  renderPeople(); renderTeams();
  if (focusAction && !dialog.open) {
    const target = document.querySelector(`[data-action="${CSS.escape(focusAction)}"]${focusId ? `[data-id="${CSS.escape(focusId)}"]` : ''}`);
    target?.focus({ preventScroll: true });
  }
}
function renderPeople() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const people = state.people.filter(p => `${p.name} ${p.note} ${p.styleIds.map(styleName).join(' ')}`.toLocaleLowerCase().includes(query));
  const scroll = $('#people-list').scrollTop;
  $('#people-list').innerHTML = people.length ? people.map(p => {
    const slot = assignedSlot(state, p.id);
    const status = p.onLeave ? '请假' : slot ? (slot.backupPersonId === p.id ? '替补' : '已安排') : '未安排';
    return `<article class="person ${p.onLeave ? 'on-leave' : slot ? 'assigned' : ''} ${selectedPerson === p.id ? 'selected' : ''}" data-person="${esc(p.id)}" draggable="${!p.onLeave}"><div class="person-top"><button class="person-select" data-action="select-person" data-id="${esc(p.id)}" ${p.onLeave ? 'disabled' : ''} aria-pressed="${selectedPerson === p.id}" aria-label="选择人员 ${esc(p.name)}">${esc(p.name)}${commanderBadge(p)}</button><span class="status">${status}</span></div>${slot ? `<p class="person-place">${placeName(slot)}${slot.backupPersonId === p.id ? ' · 替补' : ''}</p>` : ''}<div class="chips">${p.styleIds.length ? p.styleIds.map(styleBadge).join('') : '<span class="help">未设置流派</span>'}</div>${p.note ? `<p class="person-note" title="${esc(p.note)}">${esc(p.note)}</p>` : ''}<div class="person-actions"><button class="text-button" data-action="edit-person" data-id="${esc(p.id)}">编辑</button><button class="text-button" data-action="leave" data-id="${esc(p.id)}" ${slot ? 'disabled title="请先撤下该人员，再标记请假"' : ''}>${p.onLeave ? '取消请假' : '请假'}</button>${slot ? `<button class="text-button" data-action="unassign" data-id="${esc(p.id)}">撤下</button>` : ''}</div></article>`;
  }).join('') : `<div class="empty-roster">${query ? '没有匹配的人员' : '暂无人员<br><button class="text-button" data-action="add-person">＋ 添加人员</button>'}</div>`;
  $('#people-list').scrollTop = scroll;
}
function renderTeams() {
  $('#teams').innerHTML = ['attack', 'defense'].map(side => {
    const teams = state.teams.filter(t => t.side === side);
    const label = side === 'attack' ? '进攻' : '防守';
    return `<section class="side ${side}" aria-label="${label}小队"><div class="side-heading"><h3>${label}</h3><span>3 个小队 · ${teams.flatMap(t => t.slots).filter(s => s.personId).length} / 15 人</span></div><div class="team-grid">${teams.map(t => `<article class="team"><header class="team-header"><div class="team-heading"><div class="team-title"><strong>${label} ${t.id.split('-')[1]} 队</strong><button class="team-note-edit" data-action="edit-team" data-id="${esc(t.id)}" aria-label="编辑${label}${t.id.split('-')[1]}队备注">备注</button></div>${t.note ? `<p class="team-note">${esc(t.note)}</p>` : ''}</div><span>${t.slots.filter(s => s.personId).length} / 5</span></header><div class="team-columns" aria-hidden="true"><span>人员 / 职责</span>${PHASES.map(stage => `<span>${PHASE_NAMES[stage]}阶段</span>`).join('')}<span></span><span class="backup-column">替补</span></div><div class="slots">${t.slots.map(slot => {
      const p = personById(slot.personId), backup = personById(slot.backupPersonId);
      return `<div class="slot" data-slot="${esc(slot.id)}"><div class="slot-person"><button class="slot-assign ${p ? '' : 'empty'}" data-action="assign-slot" data-id="${esc(slot.id)}" ${p ? `draggable="true" data-person="${esc(p.id)}"` : ''} aria-label="${esc(placeName(slot))}：${p ? esc(p.name) : '待安排'}">${p ? esc(p.name) + commanderBadge(p) : '待安排人员'}${p ? '' : '<span aria-hidden="true">＋</span>'}</button>${slot.note ? `<p class="slot-note" title="${esc(slot.note)}">${esc(slot.note)}</p>` : ''}</div><div class="slot-stages" aria-label="三个阶段的流派">${PHASES.map(stage => `<div class="slot-style" data-stage="${stage}"><span class="stage-label sr-only">${PHASE_NAMES[stage]}</span>${styleBadge(slot.styles[stage])}</div>`).join('')}</div><button class="slot-edit" data-action="edit-slot" data-id="${esc(slot.id)}" aria-label="设置${placeName(slot)}">设置</button><div class="slot-backup backup-column" data-backup-slot="${esc(slot.id)}" data-role="backup"><button class="backup-assign ${backup ? '' : 'empty'}" data-action="assign-slot" data-id="${esc(slot.id)}" data-role="backup" ${backup ? `draggable="true" data-person="${esc(backup.id)}"` : ''} aria-label="${esc(placeName(slot))}替补：${backup ? esc(backup.name) : '待安排'}">${backup ? esc(backup.name) + commanderBadge(backup) : '＋'}</button>${backup ? `<button class="backup-remove" data-action="unassign" data-id="${esc(backup.id)}" aria-label="撤下替补 ${esc(backup.name)}">×</button>` : ''}</div></div>`;
    }).join('')}</div></article>`).join('')}</div></section>`;
  }).join('');
}
function openDialog(title, subtitle, body, context = null) {
  editorContext = context;
  $('#dialog-content').innerHTML = `<header class="dialog-heading"><div><h2 id="dialog-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="close-dialog" data-action="close-dialog" aria-label="关闭弹窗">×</button></header><div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}
function formError(message) { const el = $('#form-error'); el.textContent = message; el.hidden = false; el.tabIndex = -1; el.focus(); }
const errorMarkup = '<p id="form-error" class="form-error" role="alert" hidden></p>';
const actions = (primary, danger = '') => `<div class="dialog-actions">${danger}<button type="button" data-action="close-dialog">取消</button><button type="submit" class="primary">${primary}</button></div>`;
function personEditor(id = null) {
  const p = personById(id) ?? { name: '', styleIds: [], note: '', isCommander: false };
  openDialog(id ? '编辑人员' : '添加人员', '', `<form id="person-form"><div class="field"><label for="person-name">名字</label><input id="person-name" name="personName" maxlength="80" required autocomplete="off" value="${esc(p.name)}" autofocus></div><label class="toggle"><input id="person-commander" name="isCommander" type="checkbox" ${p.isCommander ? 'checked' : ''}>指挥</label><fieldset class="field"><legend>可用流派</legend><div class="style-picker">${allStyles(state).map(s => `<label class="style-option"><input type="checkbox" name="style" value="${esc(s.id)}" ${p.styleIds.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div></fieldset><div class="field"><label for="person-note">人员备注</label><textarea id="person-note" name="note" maxlength="2000" >${esc(p.note)}</textarea></div>${errorMarkup}${actions(id ? '保存人员' : '添加人员', id ? `<button type="button" class="danger" data-action="delete-person" data-id="${esc(id)}">删除人员</button>` : '')}</form>`, { kind: 'person', id });
}
const options = value => `<option value="">未设置</option>${allStyles(state).map(s => `<option value="${esc(s.id)}" ${value === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
function slotEditor(id) {
  const slot = slotById(id);
  openDialog(placeName(slot), '', `<form id="slot-form"><label class="toggle"><input id="phase-enabled" type="checkbox" ${slot.phaseEnabled ? 'checked' : ''}>分阶段设置流派</label><div id="shared-style-field" class="field" ${slot.phaseEnabled ? 'hidden' : ''}><label for="shared-style">整场流派</label><select id="shared-style">${options(slot.styles.tower)}</select></div><div id="phase-fields" class="phase-fields" ${slot.phaseEnabled ? '' : 'hidden'}>${PHASES.map(p => `<div class="field"><label for="style-${p}">${PHASE_NAMES[p]}阶段</label><select id="style-${p}">${options(slot.styles[p])}</select></div>`).join('')}</div><p id="collapse-help" class="help" hidden>请选择整场沿用的流派；保存后将统一三个阶段。</p><div class="field"><label for="slot-note">职责备注（整场共用）</label><textarea id="slot-note" maxlength="2000" >${esc(slot.note)}</textarea></div>${errorMarkup}${actions('保存位置', slot.personId ? `<button type="button" class="danger" data-action="unassign-slot" data-id="${esc(id)}">撤下人员</button>` : '')}</form>`, { kind: 'slot', id });
}
function teamEditor(id) {
  const team = state.teams.find(t => t.id === id);
  const label = `${team.side === 'attack' ? '进攻' : '防守'} ${team.id.split('-')[1]} 队`;
  openDialog(label, '', `<form id="team-form"><div class="field"><label for="team-note">小队备注</label><textarea id="team-note" name="teamNote" maxlength="2000" autofocus>${esc(team.note)}</textarea></div>${errorMarkup}${actions('保存备注')}</form>`, { kind: 'team', id });
}
function styleEditor() {
  openDialog('流派管理', '', `<p class="help">默认流派</p><div class="style-list">${DEFAULT_STYLES.map(s => styleBadge(s.id)).join('')}</div><div class="field"><label for="custom-style-name">添加自定义流派</label><form id="style-form" class="inline-field"><input id="custom-style-name" name="styleName" maxlength="40" placeholder="输入流派名称…" autocomplete="off" required><button type="submit" class="primary">添加</button></form></div>${errorMarkup}<div class="field"><span>自定义流派</span><div class="style-list">${state.customStyles.length ? state.customStyles.map(s => `<span class="custom-style">${esc(s.name)}<button data-action="delete-style" data-id="${esc(s.id)}" aria-label="删除流派 ${esc(s.name)}">×</button></span>`).join('') : '<p class="help">还没有自定义流派。</p>'}</div><p class="help">删除后，会从人员可用流派中移除，并清空相关位置的流派；人员排位保持不变。</p></div>`, { kind: 'styles' });
}
function confirmDialog(title, subtitle, onConfirm, button = '确认') {
  openDialog(title, subtitle, `<form id="confirm-form">${errorMarkup}${actions(button)}</form>`, { kind: 'confirm', onConfirm });
}
function download(data, filename, raw = false) {
  const url = URL.createObjectURL(new Blob([raw ? data : JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function finishRecovery() { recoveryRaw = null; $('#recovery').hidden = true; }
function performAssignment(id, slotId, role = 'primary') {
  if (change(s => assignPerson(s, id, slotId, role), '人员已安排')) { selectedPerson = null; render(); }
}

document.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || b.disabled) return;
  const { action, id } = b.dataset;
  if (action === 'close-dialog') dialog.close();
  if (action === 'add-person') personEditor();
  if (action === 'edit-person') personEditor(id);
  if (action === 'edit-slot') slotEditor(id);
  if (action === 'edit-team') teamEditor(id);
  if (action === 'select-person') { selectedPerson = selectedPerson === id ? null : id; render(); }
  if (action === 'assign-slot') {
    const role = b.dataset.role || 'primary';
    const occupant = slotById(id)[role === 'backup' ? 'backupPersonId' : 'personId'];
    if (selectedPerson) performAssignment(selectedPerson, id, role);
    else if (occupant) { selectedPerson = occupant; render(); }
    else toast('先点选左侧人员，再点击此位置；也可以直接拖入。');
  }
  if (action === 'leave') change(s => setLeave(s, id, !personById(id).onLeave), personById(id).onLeave ? '已取消请假' : '已标记请假');
  if (action === 'unassign') change(s => unassignPerson(s, id), '人员已撤下');
  if (action === 'unassign-slot') { change(s => unassignPerson(s, slotById(id).personId), '人员已撤下'); dialog.close(); }
  if (action === 'delete-person') {
    const p = personById(id), slot = assignedSlot(state, id);
    confirmDialog(`删除「${p.name}」？`, slot ? `该人员将从${placeName(slot)}撤下并删除，位置配置保留。` : '该人员的资料将被删除。', () => change(s => { unassignPerson(s, id); s.people = s.people.filter(p => p.id !== id); }, '人员已删除'), '删除人员');
  }
  if (action === 'delete-style') { if (change(s => deleteStyle(s, id), '流派已删除，相关引用已清理')) styleEditor(); }
});
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'team-form') {
    if (change(s => { s.teams.find(t => t.id === editorContext.id).note = $('#team-note').value; }, '小队备注已保存')) dialog.close();
  }
  if (form.id === 'person-form') {
    const name = $('#person-name').value.trim();
    if (!name || state.people.some(p => p.id !== editorContext.id && nameKey(p.name) === nameKey(name))) return formError('名字不能为空，也不能与其他人员重名。');
    const data = { name, isCommander: $('#person-commander').checked, styleIds: [...form.querySelectorAll('input[name=style]:checked')].map(e => e.value), note: $('#person-note').value };
    if (change(s => { const existing = s.people.find(p => p.id === editorContext.id); if (existing) Object.assign(existing, data); else s.people.push({ id: newId('person'), ...data, onLeave: false }); }, '人员已保存')) dialog.close();
  }
  if (form.id === 'slot-form') {
    const phaseEnabled = $('#phase-enabled').checked;
    if (change(s => { const slot = allSlots(s).find(s => s.id === editorContext.id); slot.phaseEnabled = phaseEnabled; slot.note = $('#slot-note').value; for (const p of PHASES) slot.styles[p] = (phaseEnabled ? $(`#style-${p}`).value : $('#shared-style').value) || null; }, '位置已保存')) dialog.close();
  }
  if (form.id === 'style-form') {
    const name = $('#custom-style-name').value.trim();
    if (!name || allStyles(state).some(s => nameKey(s.name) === nameKey(name))) return formError('流派名称不能为空，也不能与已有流派重名。');
    if (change(s => s.customStyles.push({ id: newId('custom'), name }), '自定义流派已添加')) { styleEditor(); $('#custom-style-name').focus(); }
  }
  if (form.id === 'confirm-form') { if (editorContext.onConfirm() !== false) dialog.close(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'show-backups') change(s => { s.showBackups = event.target.checked; });
  if (event.target.id === 'phase-enabled') {
    const enabled = event.target.checked;
    if (enabled) for (const p of PHASES) $(`#style-${p}`).value = $('#shared-style').value;
    else { $('#shared-style').value = $('#style-tower').value; $('#collapse-help').hidden = false; }
    $('#shared-style-field').hidden = enabled; $('#phase-fields').hidden = !enabled;
  }
});
$('#add-person').addEventListener('click', () => personEditor());
$('#manage-styles').addEventListener('click', styleEditor);
$('#search').addEventListener('input', renderPeople);
$('#cancel-selection').addEventListener('click', () => { selectedPerson = null; render(); });
$('#plan-name').addEventListener('input', event => {
  if (!event.target.value.trim()) { $('#save-state').textContent = '请输入方案名称'; return; }
  state.name = event.target.value.trim(); save();
});
$('#plan-name').addEventListener('blur', event => { event.target.value = state.name; });
$('#export-plan').addEventListener('click', () => {
  const filename = state.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  download(validatePlan(state), `${filename}.json`); toast('JSON 已导出');
});
$('#import-plan').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请选择方案 JSON 文件。');
    const imported = validatePlan(JSON.parse(await file.text()));
    openDialog('导入方案', '导入会完整替换当前方案。需要保留当前内容时，请先取消并导出。', `<div class="import-summary"><strong>${esc(imported.name)}</strong><br>${imported.people.length} 位人员 · ${allSlots(imported).filter(s => s.personId).length} 位主力 · ${allSlots(imported).filter(s => s.backupPersonId).length} 位替补<br>${imported.customStyles.length} 个自定义流派 · 格式版本 ${imported.schemaVersion}</div><form id="confirm-form">${errorMarkup}${actions('替换并导入')}</form>`, { kind: 'confirm', onConfirm: () => { state = imported; selectedPerson = null; finishRecovery(); save(); render(); toast('方案已导入'); } });
  } catch (error) { toast(error instanceof SyntaxError ? '无法解析 JSON，请检查文件内容。当前方案未改变。' : error.message, true); }
});
$('#new-plan').addEventListener('click', () => confirmDialog('新建空白方案？', '当前方案将被替换。需要保留时，请先取消并导出 JSON。', () => { state = createPlan(); selectedPerson = null; finishRecovery(); save(); render(); toast('已新建方案'); }, '新建方案'));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.open) { selectedPerson = null; render(); } });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });

document.addEventListener('dragstart', event => {
  const el = event.target.closest('[data-person]'); if (!el) return;
  const p = personById(el.dataset.person);
  if (!p || p.onLeave) { event.preventDefault(); return; }
  draggedPerson = p.id; event.dataTransfer.setData('text/plain', p.id); event.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  if (!draggedPerson) return;
  const target = event.target.closest('[data-slot],[data-backup-slot],#return-zone');
  document.querySelectorAll('.drop-over').forEach(e => { if (e !== target) e.classList.remove('drop-over'); });
  if (target) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drop-over'); }
});
document.addEventListener('drop', event => {
  const target = event.target.closest('[data-slot],[data-backup-slot],#return-zone'); if (!target || !draggedPerson) return;
  event.preventDefault();
  if (target.id === 'return-zone') { selectedPerson = null; change(s => unassignPerson(s, draggedPerson), '人员已撤下'); }
  else performAssignment(draggedPerson, target.dataset.slot || target.dataset.backupSlot, target.dataset.role || 'primary');
  clearDrag();
});
function clearDrag() { draggedPerson = null; document.querySelectorAll('.dragging,.drop-over').forEach(e => e.classList.remove('dragging', 'drop-over')); }
document.addEventListener('dragend', clearDrag);

try {
  const raw = localStorage.getItem(STORAGE);
  if (raw) {
    try { state = validatePlan(JSON.parse(raw)); }
    catch { recoveryRaw = raw; $('#recovery').hidden = false; $('#recovery').textContent = '浏览器中保存的数据无法读取，已保留原始内容，暂不自动覆盖。你可以先下载备份，再导入有效文件或新建方案。'; const b = document.createElement('button'); b.textContent = '下载原始备份'; b.addEventListener('click', () => download(recoveryRaw, '恢复备份.json', true)); $('#recovery').append(b); $('#save-state').textContent = '自动保存已暂停'; }
  }
} catch { $('#save-state').textContent = '本地保存不可用，请导出备份'; }
render();
