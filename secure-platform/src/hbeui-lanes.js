/**
 * Issue #79 — HBEUI visual lanes (Buyer / HBE / Needs Me).
 * Classification + markup helpers. HBEUI only; no BuyerUI coupling.
 */

export const LANE = Object.freeze({
  BUYER: 'buyer',
  HBE: 'hbe',
  NEEDS_ME: 'needs-me'
});

const DAY_MS = 86400000;

export function isOverdue(dueAt, now = Date.now()) {
  if (!dueAt) return false;
  const d = new Date(`${dueAt}T23:59:59`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now;
}

export function isDueSoon(dueAt, now = Date.now(), withinDays = 3) {
  if (!dueAt) return false;
  const d = new Date(`${dueAt}T23:59:59`);
  if (Number.isNaN(d.getTime())) return false;
  const delta = d.getTime() - now;
  return delta >= 0 && delta <= withinDays * DAY_MS;
}

export function isDateCritical(task, now = Date.now()) {
  if (!task || task.status === 'done') return false;
  return task.priority === 'critical' || isOverdue(task.due_at, now) || isDueSoon(task.due_at, now);
}

/**
 * Ranked attention items for the Needs Me rail.
 * Sparse by design — only Christopher-now signals.
 */
export function classifyAttentionItems({ tasks = [], notifications = [], now = Date.now() } = {}) {
  const items = [];

  for (const n of notifications) {
    if (n.read_at) continue;
    const payload = safePayload(n.payload_json);
    items.push({
      id: `notif-${n.id}`,
      kind: 'unread',
      severity: 10,
      title: payload.title || notificationLabel(n.type) || 'Unread buyer submission',
      detail: 'Unread',
      href: `#needs-unread`,
      sourceId: n.id
    });
  }

  for (const t of tasks) {
    if (!t || t.status === 'done') continue;
    const overdue = isOverdue(t.due_at, now);
    const soon = isDueSoon(t.due_at, now);
    if (t.priority === 'critical' || overdue) {
      items.push({
        id: `task-${t.id}`,
        kind: overdue ? 'overdue' : 'critical',
        severity: overdue ? 0 : 1,
        title: t.title || 'Critical task',
        detail: overdue ? 'Overdue' : (t.due_at ? `Due ${t.due_at}` : 'Critical'),
        href: `#task-${escAttr(t.id)}`,
        sourceId: t.id,
        task: t
      });
    } else if (soon) {
      items.push({
        id: `task-${t.id}`,
        kind: 'date_critical',
        severity: 2,
        title: t.title || 'Date-critical task',
        detail: t.due_at ? `Due ${t.due_at}` : 'Date-critical',
        href: `#task-${escAttr(t.id)}`,
        sourceId: t.id,
        task: t
      });
    } else if (t.priority === 'high') {
      items.push({
        id: `task-${t.id}`,
        kind: 'high_priority',
        severity: 5,
        title: t.title || 'High-priority task',
        detail: 'High priority',
        href: `#task-${escAttr(t.id)}`,
        sourceId: t.id,
        task: t
      });
    }
  }

  items.sort((a, b) => a.severity - b.severity || String(a.title).localeCompare(String(b.title)));
  // Dedupe by source task id (notifications keep unique ids)
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.kind === 'unread' ? item.id : `task:${item.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function notificationLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('submission') || t === 'buyer_submission') return 'Unread buyer submission';
  if (t.includes('review') || t === 'review_needed') return 'Review needed';
  if (t.includes('decision')) return 'Unanswered HBE decision';
  return 'Unread update';
}

function safePayload(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}

function escAttr(v = '') {
  return String(v).replace(/["&<>]/g, '');
}

/**
 * Sticky Needs Me rail. Strongest + sparse. Quiet empty state optional.
 */
export function needsMeRailHtml(items, { esc = defaultEsc, collapseWhenEmpty = false } = {}) {
  const top = (items || []).slice(0, 3);
  if (!top.length) {
    if (collapseWhenEmpty) return '';
    return `<aside class="hbeui-needs-me hbeui-needs-me--quiet" id="needs-me" aria-label="Needs me">
      <div class="hbeui-needs-me-inner">
        <span class="hbeui-lane-tag hbeui-lane-tag--needs">Needs me</span>
        <p class="hbeui-needs-me-empty">Nothing needs you right now</p>
      </div>
    </aside>`;
  }
  const links = top.map(item => `<a class="hbeui-needs-item" href="${esc(item.href)}">
      <strong>${esc(item.title)}</strong>
      <small>${esc(item.detail || item.kind)}</small>
    </a>`).join('');
  return `<aside class="hbeui-needs-me hbeui-needs-me--active" id="needs-me" aria-label="Needs me">
    <div class="hbeui-needs-me-inner">
      <div class="hbeui-needs-me-head">
        <span class="hbeui-lane-tag hbeui-lane-tag--needs">Needs me</span>
        <span class="hbeui-needs-me-count">${top.length} now</span>
      </div>
      <div class="hbeui-needs-me-list">${links}</div>
    </div>
  </aside>`;
}

export function laneBandHtml({ lane, title, subtitle, body, id }) {
  const laneClass = lane === LANE.BUYER ? 'hbeui-lane--buyer' : lane === LANE.NEEDS_ME ? 'hbeui-lane--needs' : 'hbeui-lane--hbe';
  const tag = lane === LANE.BUYER ? 'BUYER' : lane === LANE.NEEDS_ME ? 'NEEDS ME' : 'HBE';
  const tagClass = lane === LANE.BUYER ? 'hbeui-lane-tag--buyer' : lane === LANE.NEEDS_ME ? 'hbeui-lane-tag--needs' : 'hbeui-lane-tag--hbe';
  const sectionId = id || `lane-${lane}`;
  return `<section class="hbeui-lane ${laneClass}" id="${sectionId}" data-hbeui-lane="${lane}" aria-label="${title}">
    <header class="hbeui-lane-head">
      <span class="hbeui-lane-tag ${tagClass}">${tag}</span>
      <div>
        <h2 class="hbeui-lane-title">${title}</h2>
        ${subtitle ? `<p class="hbeui-lane-sub">${subtitle}</p>` : ''}
      </div>
    </header>
    <div class="hbeui-lane-body">${body}</div>
  </section>`;
}

export function hbeOpsSlotHtml() {
  return `<div id="hbeui-hbe-ops-slot" class="hbeui-ops-slot" data-hbeui-lane="hbe"><!--hbeui-ops-anchor--></div>`;
}

/** Inject HBE-only ops panels into the HBE lane slot (append-safe). */
export function injectHbeOps(text, panel) {
  if (!panel) return text;
  if (text.includes('<!--hbeui-ops-anchor-->')) {
    return text.replace('<!--hbeui-ops-anchor-->', `${panel}<!--hbeui-ops-anchor-->`);
  }
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? `${text.slice(0, i)}${panel}${text.slice(i)}` : text;
}

export function attentionClassForTask(task, now = Date.now()) {
  if (!task || task.status === 'done') return '';
  if (isOverdue(task.due_at, now) || task.priority === 'critical') return 'hbeui-attn hbeui-attn--critical';
  if (isDueSoon(task.due_at, now)) return 'hbeui-attn hbeui-attn--date';
  if (task.priority === 'high') return 'hbeui-attn hbeui-attn--high';
  return '';
}

function defaultEsc(v = '') {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

/** Lane CSS — structure/label/border/spacing/shape first; color supporting. */
export const HBEUI_LANES_CSS = `<style id="hbeui-lanes-css">
/* Issue #79 lanes — grayscale-distinct structure */
:root{
  --hbeui-header-h:64px;
  --hbeui-buyer-bg:#f3f1ec;
  --hbeui-buyer-border:#6b6560;
  --hbeui-hbe-bg:#eceff2;
  --hbeui-hbe-border:#3d4450;
  --hbeui-needs-bg:#1a1a2e;
  --hbeui-needs-fg:#faf9f6;
  --hbeui-needs-accent:#9b3434;
  --hbeui-lane-gap:2.25rem;
}
.hbeui-needs-me{
  position:sticky;top:var(--hbeui-header-h);z-index:40;
  margin:0 0 1.5rem;scroll-margin-top:calc(var(--hbeui-header-h) + .5rem);
}
.hbeui-needs-me-inner{
  border:2px solid var(--hbeui-needs-bg);
  border-left-width:6px;
  background:var(--hbeui-needs-bg);
  color:var(--hbeui-needs-fg);
  border-radius:4px;
  padding:.85rem 1rem;
  box-shadow:0 8px 28px rgba(26,26,46,.18);
}
.hbeui-needs-me--quiet .hbeui-needs-me-inner{
  background:#f4f4f2;color:#5a5a5a;border-color:#c8c8c4;border-left-width:4px;
  box-shadow:none;padding:.55rem .9rem;
}
.hbeui-needs-me-empty{margin:0;font-size:.92rem;font-weight:500}
.hbeui-needs-me-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.55rem}
.hbeui-needs-me-count{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;font-weight:800;opacity:.85}
.hbeui-needs-me-list{display:grid;gap:.45rem}
.hbeui-needs-item{
  display:flex;flex-direction:column;gap:.1rem;
  text-decoration:none;color:inherit;
  padding:.55rem .7rem;
  background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.18);
  border-left:3px solid var(--hbeui-needs-accent);
  border-radius:2px;
}
.hbeui-needs-item:hover{background:rgba(255,255,255,.14)}
.hbeui-needs-item strong{font:600 1rem Georgia,serif}
.hbeui-needs-item small{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;opacity:.8}
.hbeui-lane{
  margin:0 0 var(--hbeui-lane-gap);
  padding:1.35rem 1.25rem 1.5rem;
  border-radius:2px;
  scroll-margin-top:calc(var(--hbeui-header-h) + 4.5rem);
}
.hbeui-lane--buyer{
  background:var(--hbeui-buyer-bg);
  border:1px solid #d9d4cc;
  border-left:5px solid var(--hbeui-buyer-border);
  border-radius:14px;
}
.hbeui-lane--hbe{
  background:var(--hbeui-hbe-bg);
  border:1px solid #cfd5dc;
  border-left:5px dashed var(--hbeui-hbe-border);
  border-radius:4px;
}
.hbeui-lane-head{
  display:flex;align-items:flex-start;gap:1rem;
  margin-bottom:1.15rem;padding-bottom:.85rem;
  border-bottom:1px solid rgba(0,0,0,.08);
}
.hbeui-lane-tag{
  display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 auto;min-width:4.6rem;
  font-size:.68rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
  padding:.35rem .55rem;border:1px solid currentColor;
}
.hbeui-lane-tag--buyer{
  color:var(--hbeui-buyer-border);background:#fff;border-radius:999px;
}
.hbeui-lane-tag--hbe{
  color:#fff;background:var(--hbeui-hbe-border);border-color:var(--hbeui-hbe-border);border-radius:2px;
}
.hbeui-lane-tag--needs{
  color:#fff;background:var(--hbeui-needs-accent);border-color:var(--hbeui-needs-accent);
  border-radius:2px;letter-spacing:.12em;
}
.hbeui-needs-me--quiet .hbeui-lane-tag--needs{
  color:#5a5a5a;background:transparent;border-color:#8a8a86;
}
.hbeui-lane-title{font:600 1.35rem Georgia,serif;color:var(--navy,#1a1a2e);margin:0}
.hbeui-lane-sub{margin:.2rem 0 0;color:var(--muted,#6b6b6b);font-size:.9rem}
.hbeui-lane-body{display:grid;gap:1.15rem}
.hbeui-lane--buyer .panel{background:#fffefb;border-radius:12px;border-style:solid}
.hbeui-lane--hbe .panel{background:#fff;border-radius:4px;border-style:solid}
.hbeui-lane--buyer .stage-summary{
  background:#fffefb;border-radius:12px;border:1px solid #d9d4cc;
  width:max-content;max-width:100%;
}
.hbeui-lane--hbe .roadmap{
  background:rgba(255,255,255,.55);border-radius:4px;padding:1rem;
  border:1px solid #cfd5dc;margin:0;
}
.hbeui-ops-slot{display:grid;gap:1rem;margin-top:.25rem}
.hbeui-ops-slot .i29-story,.hbeui-ops-slot .i29-compass,.hbeui-ops-slot .i29-next,
.hbeui-ops-slot .i29-checklist,.hbeui-ops-slot .i29-comp,.hbeui-ops-slot .sc-panel,
.hbeui-ops-slot .i29-map{
  margin:0;border-radius:4px;border-left:3px solid var(--hbeui-hbe-border);
}
.hbeui-attn{position:relative}
.hbeui-attn--critical{
  border-left:4px solid var(--hbeui-needs-accent)!important;
  box-shadow:inset 0 0 0 1px rgba(155,52,52,.25);
  background:#fff5f5!important;
}
.hbeui-attn--date{
  border-left:4px solid #8a6a2f!important;
  background:#fffaf0!important;
}
.hbeui-attn--high{
  border-left:3px solid #5a5a5a!important;
}
.hbeui-unread-anchor{scroll-margin-top:calc(var(--hbeui-header-h) + 5rem)}
/* Keep sticky rail from covering content on small screens */
@media(max-width:900px){
  .hbeui-needs-me{position:static;z-index:auto}
  .hbeui-lane{padding:1.1rem 1rem 1.25rem;margin-bottom:1.75rem}
  .hbeui-lane--buyer .stage-summary{width:100%}
}
@media(max-width:620px){
  .hbeui-needs-me-list{grid-template-columns:1fr}
  .hbeui-lane-head{flex-direction:column;gap:.5rem}
  .hbeui-lane-title{font-size:1.2rem}
}
@media(min-width:901px){
  .buyer-main{padding-top:clamp(1rem,2vw,1.5rem)}
}
</style>`;
