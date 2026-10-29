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

/* ------------------------------------------------------------------ *
 * Compact mobile HBEUI (phones <=720px): tappable chip panels.
 * Every buyer-detail section is a <details class="hbe-chip-panel">,
 * rendered `open` so desktop is unchanged (the chip <summary> is hidden
 * at >=721px). On phones the summaries become pills and a small script
 * keeps one panel open at a time. HBE-only markup; never used by BuyerUI.
 * ------------------------------------------------------------------ */

/** Marker inside the Stage chip where the stage map is merged on phones. */
export const HBE_STAGE_MERGE_ANCHOR = '<!--hbe-stage-merge-anchor-->';

function chipAttr(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

/**
 * Wrap one section as a chip panel. `label` and `badge` are escaped.
 * `mobileOnly` panels are hidden on desktop; `mergeInto` panels are moved
 * inside another chip's body on phones (e.g. stage map -> Stage chip).
 */
export function chipPanelHtml({ id, label, badge = '', lane = LANE.HBE, body = '', mobileOnly = false, mergeInto = '', note = '' }) {
  const cls = ['hbe-chip-panel', `hbe-chip-panel--${lane === LANE.BUYER ? 'buyer' : 'hbe'}`];
  if (mobileOnly) cls.push('hbe-mobile-only');
  const b = badge === '' || badge == null ? '' : `<span class="hbe-chip-badge">${chipAttr(badge)}</span>`;
  const n = note ? `<span class="hbe-chip-note">${chipAttr(note)}</span>` : '';
  return `<details class="${cls.join(' ')}" id="chip-${chipAttr(id)}" data-hbe-chip="${chipAttr(id)}" data-hbeui-lane="${lane}"${mergeInto ? ` data-hbe-merge-into="${chipAttr(mergeInto)}"` : ''} open><summary class="hbe-chip"><span class="hbe-chip-label">${chipAttr(label)}</span>${n}${b}<span class="hbe-chip-close" aria-hidden="true">Close ✕</span></summary><div class="hbe-chip-body">${body}</div></details>`;
}

/** Compact-mobile CSS. Desktop (>=721px): summaries and mobile-only pieces hidden. */
export const HBEUI_COMPACT_CSS = `<style id="hbeui-compact-css">
.hbe-chip-panel{display:block}
.hbe-chip-panel[hidden]{display:none!important}
.hbe-mbar,.hbe-mobile-only{display:none}
@media(min-width:721px){
  .hbe-chip-panel>summary.hbe-chip{display:none}
  .hbe-chip-panel:not([open])>.hbe-chip-body{display:block}
}
@media(max-width:720px){
  .site-header{position:static}
  .site-header .header-actions,.site-header .hbe-admin-nav{display:none}
  .header-inner{padding:.55rem 1rem}
  .shell{padding:.5rem .75rem 3rem}
  .shell.has-selected>.top{display:none}
  .hbe-mobile-only{display:block}
  .hbe-desk-only{display:none!important}
  .hbe-mbar{display:flex;position:sticky;top:0;z-index:60;align-items:center;gap:.6rem;min-height:56px;max-height:64px;margin:0 -.75rem .5rem;padding:.4rem .75rem;background:rgba(255,255,255,.97);border-bottom:1px solid #e8e5e0;backdrop-filter:blur(10px)}
  .hbe-mbar-who{flex:1;min-width:0;line-height:1.2}
  .hbe-mbar-who strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.98rem;color:#1a1a2e}
  .hbe-mbar-who small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6b6b6b;font-size:.76rem}
  .hbe-mbar-initials{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#2d5a3d;color:#fff;font-weight:800;font-size:.85rem}
  .hbe-menu{position:relative;flex:none}
  .hbe-menu>summary{list-style:none;cursor:pointer;width:40px;height:40px;display:grid;place-items:center;border:1px solid #e8e5e0;border-radius:10px;font-size:1.2rem;background:#fff}
  .hbe-menu>summary::-webkit-details-marker{display:none}
  .hbe-menu-links{position:absolute;right:0;top:46px;min-width:200px;background:#fff;border:1px solid #e8e5e0;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:.4rem;display:flex;flex-direction:column}
  .hbe-menu-links a{padding:.65rem .75rem;color:#2d5a3d;text-decoration:none;border-radius:8px;font-weight:600}
  .buyer-strip{display:flex!important;gap:.45rem;overflow-x:auto;padding:.1rem 0 .5rem;margin:0 0 .4rem;scroll-snap-type:x proximity;grid-template-columns:none!important}
  .buyer-strip>.i29-split-card{position:relative;flex:none;min-width:0;max-width:62vw;padding:.4rem .8rem!important;border-radius:999px!important;scroll-snap-align:start;min-height:0!important;margin:0!important}
  .buyer-strip>.i29-split-card header{display:flex;align-items:center;gap:.35rem;margin:0!important;padding:0!important}
  .buyer-strip>.i29-split-card header>*:not(strong):not(.card-top),.buyer-strip>.i29-split-card .card-meta,.buyer-strip>.i29-split-card a span,.buyer-strip>.i29-split-card a+a{display:none!important}
  .buyer-strip>.i29-split-card strong{font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .buyer-strip>.i29-split-card a{position:absolute;inset:0;font-size:0;color:transparent;border:0!important;background:none!important;padding:0!important;margin:0!important}
  .buyer-strip>.i29-split-card.selected{outline:2px solid #2d5a3d}
  .buyer-main>.buyer-heading,.buyer-main>#needs-me,#buyer-stage-context.hbe-desk-stage,#needs-unread{display:none}
  .shell.has-selected{display:flex;flex-wrap:wrap;gap:.45rem;align-items:flex-start;align-content:flex-start}
  .shell.has-selected>*{flex-basis:100%;min-width:0}
  .shell.has-selected>:not(details){order:-1}
  .shell.has-selected>.buyer-main,.shell.has-selected .hbe-chip-deck{display:contents}
  .shell.has-selected>details.hbe-chip-panel{flex-basis:auto}
  .shell.has-selected>details.hbe-chip-panel[open]{order:100;flex-basis:100%}
  .shell.has-selected>.value-hbe-strip{order:200}
  .hbe-chip-deck .hbeui-lane,.hbe-chip-deck .hbeui-lane-body,.hbe-chip-deck .hbeui-ops-slot,.hbe-chip-deck .workspace-grid,.hbe-chip-deck .column{display:contents}
  .hbe-chip-deck .hbeui-lane-head,.hbe-chip-deck .roadmap-legacy-hidden{display:none}
  .hbe-chip-deck>*:not(details),.hbe-chip-deck .hbeui-lane-body>*:not(details):not(.workspace-grid):not(.hbeui-ops-slot):not(script),.hbe-chip-deck .hbeui-ops-slot>*:not(details):not(script){flex-basis:100%}
  .hbe-chip-panel{flex:none;max-width:100%;margin:0!important}
  .hbe-chip-panel>summary.hbe-chip{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;min-height:40px;padding:.45rem .85rem;border-radius:999px;background:#fff;border:1px solid #d9d5cd;font-weight:700;font-size:.86rem;color:#1a1a2e;user-select:none}
  .hbe-chip-panel>summary.hbe-chip::-webkit-details-marker{display:none}
  .hbe-chip-panel--buyer>summary.hbe-chip{border-left:4px solid #2d5a3d}
  .hbe-chip-panel--hbe>summary.hbe-chip{border-style:dashed;border-left:4px dashed #c9a84c}
  .hbe-chip-badge{min-width:1.35rem;padding:0 .4rem;border-radius:999px;background:#2d5a3d;color:#fff;font-size:.72rem;line-height:1.35rem;text-align:center}
  .hbe-chip-badge.hbe-chip-badge--alert,[data-hbe-chip="needs"] .hbe-chip-badge{background:#9b3434}
  .hbe-chip-note{font-size:.7rem;font-weight:800;letter-spacing:.06em;color:#9b3434;text-transform:uppercase}
  .hbe-chip-close{display:none;margin-left:auto;font-size:.78rem;color:#6b6b6b;font-weight:600}
  .hbe-chip-panel[open]{order:100;flex-basis:100%;width:100%}
  .hbe-chip-panel[open]>summary.hbe-chip{display:flex;width:100%;background:#1a1a2e;color:#fff;border-color:#1a1a2e;border-radius:12px 12px 0 0}
  .hbe-chip-panel[open]>summary .hbe-chip-close{display:inline;color:#ddd}
  .hbe-chip-panel[open]>.hbe-chip-body{border:1px solid #e8e5e0;border-top:0;border-radius:0 0 12px 12px;background:#fff;padding:.75rem;scroll-margin-top:72px}
  .hbe-chip-body .panel{margin:0;box-shadow:none;border:0;padding:0}
  .hbe-chip-panel{scroll-margin-top:72px}
  [data-hbe-chip="needs"]{order:1}[data-hbe-chip="stage"]{order:2}[data-hbe-chip="next"]{order:3}[data-hbe-chip="tasks"]{order:4}[data-hbe-chip="notes"]{order:5}[data-hbe-chip="profile"]{order:6}[data-hbe-chip="matters"]{order:7}[data-hbe-chip="story"]{order:8}[data-hbe-chip="journey"]{order:9}[data-hbe-chip="compass"]{order:10}[data-hbe-chip="checklist"]{order:11}[data-hbe-chip="showings"]{order:12}[data-hbe-chip="compensation"]{order:13}[data-hbe-chip="consult"]{order:14}[data-hbe-chip="hire"]{order:15}[data-hbe-chip="search"]{order:16}[data-hbe-chip="pilot"]{order:17}[data-hbe-chip="contact"]{order:18}[data-hbe-chip="stage-map"]{order:19}
  .hbe-stage-panel .roadmap{display:grid!important;grid-template-columns:1fr!important;gap:.3rem!important}
  .hbe-stage-panel .roadmap form{margin:0}
  .hbe-stage-panel .roadmap .stage{width:100%;display:flex!important;align-items:center;gap:.6rem;text-align:left;min-height:40px}
  .hbe-stage-hint{font-size:.8rem;color:#6b6b6b;margin:.6rem 0 .4rem}
  .hbe-stage-panel .hbe-stage-merged{margin-top:.8rem}
}
</style>`;

/**
 * Compact-mobile behaviour (inline, same CSP pattern as the journey panel).
 * Phones: one chip open at a time, deep links open their chip, stage map merged
 * into the Stage chip, ☰ menu filled from header links, confirm before a stage
 * change saves. Desktop: everything open, nothing moved.
 */
export const HBEUI_COMPACT_JS = `<script id="hbeui-compact-js">(()=>{
const mq=matchMedia('(max-width:720px)');const KEY='hbe-open-chip';
const panels=()=>[...document.querySelectorAll('details.hbe-chip-panel')];
const chipFor=el=>el&&el.closest?el.closest('details.hbe-chip-panel'):null;
const merges=[];
function mergeStage(on){document.querySelectorAll('[data-hbe-merge-into]').forEach(src=>{const dest=document.querySelector('#chip-'+src.dataset.hbeMergeInto+' .hbe-chip-body');if(!dest)return;const body=src.querySelector(':scope>.hbe-chip-body');if(!body)return;
 if(on&&!src.dataset.merged){const ph=document.createComment('hbe-merge-home');body.before(ph);merges.push([ph,body]);body.classList.add('hbe-stage-merged');dest.appendChild(body);src.dataset.merged='1';src.hidden=true}
 else if(!on&&src.dataset.merged){const m=merges.find(x=>x[1]===body)||merges.find(x=>src.contains(x[0]));if(m){m[0].after(m[1]);m[0].remove();merges.splice(merges.indexOf(m),1)}delete src.dataset.merged;src.hidden=false}});}
function fillMenu(){const box=document.querySelector('.hbe-menu-links');if(!box||box.dataset.filled)return;const seen=new Set();document.querySelectorAll('.site-header a:not(.brand)').forEach(a=>{const k=a.getAttribute('href')+'|'+a.textContent.trim();if(seen.has(k)||!a.textContent.trim())return;seen.add(k);const c=a.cloneNode(true);c.removeAttribute('id');box.appendChild(c)});box.dataset.filled='1';}
function openOnly(d,scroll){panels().forEach(p=>{if(p!==d)p.open=false});if(d){d.open=true;try{sessionStorage.setItem(KEY,d.id)}catch{}if(scroll)requestAnimationFrame(()=>d.scrollIntoView({block:'start',behavior:'smooth'}))}}
function targetChip(){const h=decodeURIComponent(location.hash.slice(1));if(h){if(h==='needs-me'||h==='needs-unread')return document.getElementById('chip-needs');if(h.startsWith('stage-'))return document.getElementById('chip-stage');const el=document.getElementById(h);const c=chipFor(el)||(el&&el.matches&&el.matches('details.hbe-chip-panel')?el:null);if(c&&!c.hidden)return c}
 try{const s=sessionStorage.getItem(KEY);const d=s&&document.getElementById(s);if(d)return d}catch{}
 const needs=document.getElementById('chip-needs');if(needs&&needs.dataset.count>0)return needs;return document.getElementById('chip-next')||document.getElementById('chip-tasks')||panels()[0];}
function apply(){if(mq.matches){fillMenu();mergeStage(true);panels().forEach(p=>p.setAttribute('name','hbe-buyer-panels'));openOnly(targetChip(),!!location.hash)}else{mergeStage(false);panels().forEach(p=>{p.removeAttribute('name');p.open=true})}}
document.addEventListener('toggle',e=>{const d=e.target;if(!mq.matches||!(d instanceof HTMLDetailsElement)||!d.classList.contains('hbe-chip-panel')||!d.open)return;openOnly(d,false)},true);
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a||!mq.matches)return;const el=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));const c=chipFor(el)||(a.getAttribute('href').startsWith('#stage-')?document.getElementById('chip-stage'):null);if(c){openOnly(c,false);requestAnimationFrame(()=>(el||c).scrollIntoView({block:'start'}))}});
document.addEventListener('submit',e=>{const f=e.target;if(!mq.matches||!f.closest||!f.closest('.roadmap'))return;const c=f.closest('details.hbe-chip-panel');if(c)try{sessionStorage.setItem(KEY,c.id)}catch{}const label=f.dataset.stageLabel||'this stage';if(!confirm('Set current stage to '+label+'? This updates the whole household.'))e.preventDefault()},true);
document.addEventListener('submit',e=>{if(!mq.matches)return;const c=e.target.closest&&e.target.closest('details.hbe-chip-panel');if(c)try{sessionStorage.setItem(KEY,c.id)}catch{}});
const go=()=>{apply();(mq.addEventListener?mq.addEventListener('change',apply):mq.addListener(apply))};
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',go):go();
})();</script>`;
