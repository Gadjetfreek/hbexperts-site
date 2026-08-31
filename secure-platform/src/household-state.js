import { STAGES, STAGE_CHECKLISTS, stageIndex, stageLabel } from './journey-stages.js';

const enc = new TextEncoder();

export function visibilityForActor(actorKind) {
  if (actorKind === 'hbe') return ['buyer', 'shared', 'hbe'];
  return ['buyer', 'shared'];
}

export function canSeeItem(item, actor) {
  const vis = item.visibility || 'shared';
  if (vis === 'hbe') return actor.kind === 'hbe';
  if (vis === 'buyer') return actor.kind === 'hbe' || actor.kind === 'buyer';
  return true;
}

// Buyer-private items are per person. Shared and HBE-only items are household-level
// (one completion) while still recording who completed them.
export function completionScopeKey(item, actor) {
  if (!item?.id) return '';
  if (item.visibility === 'buyer') {
    return `${item.id}:${actor.kind}:${actor.id}`;
  }
  return `${item.id}:household`;
}

export function isCompletedForActor(item, completions, actor) {
  const rows = completions || [];
  if (!item) return false;
  if (item.visibility === 'buyer') {
    const scope = completionScopeKey(item, actor);
    return rows.some(c =>
      (c.scope_key && c.scope_key === scope) ||
      ((c.item_id === item.id || c.item_key === item.item_key) &&
        c.completed_by_kind === actor.kind &&
        c.completed_by_id === actor.id)
    );
  }
  return rows.some(c =>
    c.scope_key === `${item.id}:household` ||
    c.item_id === item.id ||
    c.item_key === item.item_key
  );
}

export function sameOriginRequest(request) {
  try {
    const here = new URL(request.url).origin;
    const origin = String(request.headers.get('Origin') || '').trim();
    if (origin) return new URL(origin).origin === here;
    const referer = String(request.headers.get('Referer') || '').trim();
    if (!referer) return false;
    return new URL(referer).origin === here;
  } catch {
    return false;
  }
}

export async function mutationCsrfToken(secret) {
  if (!secret) return '';
  return sha256Hex(`hbe-csrf-v1:${secret}`);
}

function timingSafeEqual(a, b) {
  const aa = enc.encode(String(a || ''));
  const bb = enc.encode(String(b || ''));
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

export async function assertMutationCsrf(request, provided, secret) {
  if (!secret) return false;
  if (!sameOriginRequest(request)) return false;
  const expected = await mutationCsrfToken(secret);
  if (!expected) return false;
  return timingSafeEqual(String(provided || ''), expected);
}

export function validStageId(value) {
  const id = String(value || '').trim();
  return STAGES.some(s => s[0] === id) ? id : '';
}

export function filterStory(record, actor, mode) {
  const shared = {
    shared_story: record.shared_story || '',
    wants: record.wants || '',
    needs: record.needs || '',
    tradeoffs: record.tradeoffs || '',
    unresolved_questions: record.unresolved_questions || '',
    evidence: record.evidence || '',
    what_changed: record.what_changed || ''
  };
  if (mode === 'shared' && actor.kind !== 'hbe') {
    return { ...shared, hbe_synthesis: '', private_context: '', risks: '', decision_style: '' };
  }
  if (actor.kind === 'hbe') {
    return {
      ...shared,
      risks: record.risks || '',
      decision_style: record.decision_style || '',
      hbe_synthesis: record.hbe_synthesis || '',
      private_context: ''
    };
  }
  return {
    ...shared,
    risks: '',
    decision_style: '',
    hbe_synthesis: '',
    private_context: actor.private_context || ''
  };
}

export function deriveWhatsNext({ stage, checklistItems, completions, tasks, actor }) {
  const allowed = visibilityForActor(actor.kind);
  const openTasks = (tasks || []).filter(t => t.status === 'open' && allowed.includes(t.visibility || 'shared'));
  const labeled = openTasks.find(t => Number(t.is_whats_next) === 1) || chooseTopTask(openTasks);
  if (labeled) {
    return {
      title: labeled.title,
      reason: labeled.source === 'checklist' ? 'From a checklist item that created this action' : 'Highest-priority open task',
      source: labeled.source || 'task',
      due_at: labeled.due_at || null,
      priority: labeled.priority || 'high',
      id: labeled.id || null
    };
  }

  const currentItems = (checklistItems || [])
    .filter(i => i.stage_id === stage && allowed.includes(i.visibility) && !isCompletedForActor(i, completions, actor));
  const nextItem = currentItems[0];
  if (nextItem) {
    return {
      title: `Continue ${stageLabel(stage)}: ${nextItem.title}`,
      reason: 'Seeded from the current-stage checklist',
      source: 'checklist',
      due_at: null,
      priority: 'high',
      id: nextItem.id || nextItem.item_key
    };
  }

  const upcoming = openTasks.filter(t => t.due_at).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0];
  if (upcoming) {
    return {
      title: upcoming.title,
      reason: 'Upcoming deadline',
      source: 'deadline',
      due_at: upcoming.due_at,
      priority: upcoming.priority || 'critical',
      id: upcoming.id
    };
  }

  const idx = stageIndex(stage);
  const nextStage = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
  if (actor.kind === 'hbe') {
    return {
      title: nextStage
        ? `Prepare evidence for ${nextStage[1]}`
        : `Review the ${stageLabel(stage)} checklist and keep the household story current`,
      reason: 'Empty-state fallback is still a useful HBE action',
      source: 'seed',
      due_at: null,
      priority: 'normal',
      id: null
    };
  }
  return {
    title: `Review the ${stageLabel(stage)} checklist and tell HBE what still feels unresolved`,
    reason: 'Empty-state fallback is still a useful buyer action',
    source: 'seed',
    due_at: null,
    priority: 'normal',
    id: null
  };
}

export function chooseTopTask(tasks) {
  const rank = { critical: 0, high: 1, normal: 2 };
  return [...(tasks || [])].sort((a, b) => {
    const pa = rank[a.priority] ?? 3;
    const pb = rank[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (!a.due_at && !b.due_at) return 0;
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return String(a.due_at).localeCompare(String(b.due_at));
  })[0] || null;
}

export function defaultCompass(stage) {
  return {
    optimizing_for: 'Name what this household is optimizing for — daily life, commute, condition, gathering, cost, or something they have not yet put into words.',
    tradeoffs: 'The tradeoff currently being tested should stay visible here so neither person has to reconstruct it from memory.',
    uncertainty: 'What is still unknown, and does that unknown actually change the next decision?',
    evidence: 'What has already been learned: consultation, search evidence, showings, documents, or lived experience after the keys.',
    next_conversation: `Next useful conversation from ${stageLabel(stage)} — not a blank box.`
  };
}

export function dueDateFromOffset(now, days) {
  if (days == null) return null;
  const d = new Date(now.getTime() + Number(days) * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function ensureHouseholdState(env, caseId, { actorId = 'system', now = new Date() } = {}) {
  if (!env?.BUYER_DB) return { seeded: false, reason: 'no-db' };
  const iso = now.toISOString();
  const existing = await env.BUYER_DB.prepare(
    'SELECT COUNT(*) AS n FROM household_checklist_items WHERE case_id=?'
  ).bind(caseId).first().catch(() => null);
  if (existing && Number(existing.n) > 0) return { seeded: false, reason: 'already' };

  const statements = [];
  let order = 0;
  for (const [stageId] of STAGES) {
    for (const spec of STAGE_CHECKLISTS[stageId] || []) {
      order += 1;
      const id = crypto.randomUUID();
      statements.push(env.BUYER_DB.prepare(
        `INSERT INTO household_checklist_items
          (id,case_id,stage_id,item_key,title,visibility,sort_order,creates_action_kind,creates_action_title,creates_due_offset_days,creates_priority)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, caseId, stageId, spec.key, spec.title, spec.visibility, order,
        spec.creates?.kind || null,
        spec.creates?.title || null,
        spec.creates?.dueDays ?? null,
        spec.creates?.priority || null
      ));
    }
  }

  const compass = defaultCompass('consultation');
  statements.push(env.BUYER_DB.prepare(
    `INSERT OR IGNORE INTO household_compass
      (case_id,optimizing_for,tradeoffs,uncertainty,evidence,next_conversation,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(caseId, compass.optimizing_for, compass.tradeoffs, compass.uncertainty, compass.evidence, compass.next_conversation, iso, actorId));

  statements.push(env.BUYER_DB.prepare(
    `INSERT OR IGNORE INTO household_stories
      (case_id,shared_story,hbe_synthesis,wants,needs,tradeoffs,risks,decision_style,unresolved_questions,evidence,what_changed,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    caseId,
    'This household story will grow as HBE and the buyers learn. It is a synthesis, not a questionnaire dump.',
    '',
    '', '', '', '', '', '', '', '',
    iso, actorId
  ));

  statements.push(env.BUYER_DB.prepare(
    `INSERT INTO household_audit_events
      (id,case_id,actor_kind,actor_id,action,entity_type,entity_id,payload_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), caseId, 'system', actorId, 'seed_household_state', 'household', caseId, JSON.stringify({ stages: STAGES.length }), iso));

  await env.BUYER_DB.batch(statements);
  return { seeded: true };
}

export async function loadHouseholdBundle(env, caseId) {
  const [items, completions, tasks, story, compass, audit, members, permissions] = await Promise.all([
    env.BUYER_DB.prepare('SELECT * FROM household_checklist_items WHERE case_id=? ORDER BY sort_order').bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT * FROM household_checklist_completions WHERE case_id=?').bind(caseId).all(),
    env.BUYER_DB.prepare("SELECT * FROM household_tasks WHERE case_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, due_at ASC, created_at DESC").bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT * FROM household_stories WHERE case_id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare('SELECT * FROM household_compass WHERE case_id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare('SELECT * FROM household_audit_events WHERE case_id=? ORDER BY created_at DESC LIMIT 40').bind(caseId).all(),
    env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,b.email,b.stage,b.phone,b.answers_json,m.role,m.created_at
      FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT * FROM household_view_permissions WHERE case_id=?').bind(caseId).all()
  ]);
  const privateRows = await env.BUYER_DB.prepare('SELECT * FROM buyer_private_context WHERE case_id=?').bind(caseId).all();
  return {
    items: items.results || [],
    completions: completions.results || [],
    tasks: tasks.results || [],
    story: story || {},
    compass: compass || defaultCompass('consultation'),
    audit: audit.results || [],
    members: members.results || [],
    permissions: permissions.results || [],
    privateContexts: privateRows.results || []
  };
}

export async function completeChecklistItem(env, { caseId, itemId, actor, reopen = false, now = new Date() }) {
  const iso = now.toISOString();
  if (!itemId) return { ok: false, error: 'missing-item' };
  const item = await env.BUYER_DB.prepare('SELECT * FROM household_checklist_items WHERE id=? AND case_id=?').bind(itemId, caseId).first();
  if (!item) return { ok: false, error: 'missing-item' };
  if (item.visibility === 'hbe' && actor.kind !== 'hbe') return { ok: false, error: 'forbidden' };

  const scopeKey = completionScopeKey(item, actor);
  const existing = await env.BUYER_DB.prepare(
    'SELECT id FROM household_checklist_completions WHERE scope_key=? AND case_id=?'
  ).bind(scopeKey, caseId).first();

  if (reopen) {
    if (!existing) return { ok: true, reopened: false, already: true };
    await env.BUYER_DB.batch([
      env.BUYER_DB.prepare('DELETE FROM household_checklist_completions WHERE scope_key=? AND case_id=?').bind(scopeKey, caseId),
      env.BUYER_DB.prepare(`INSERT INTO household_audit_events
        (id,case_id,actor_kind,actor_id,action,entity_type,entity_id,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), caseId, actor.kind, actor.id, 'checklist_reopened', 'checklist_item', itemId,
        JSON.stringify({ item_key: item.item_key, stage_id: item.stage_id, scope_key: scopeKey }), iso
      )
    ]);
    return { ok: true, reopened: true };
  }

  if (existing) return { ok: true, already: true };

  const statements = [
    env.BUYER_DB.prepare(
      `INSERT INTO household_checklist_completions
        (id,case_id,item_id,item_key,stage_id,completed_at,completed_by_kind,completed_by_id,scope_key)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(crypto.randomUUID(), caseId, itemId, item.item_key, item.stage_id, iso, actor.kind, actor.id, scopeKey),
    env.BUYER_DB.prepare(
      `INSERT INTO household_audit_events
        (id,case_id,actor_kind,actor_id,action,entity_type,entity_id,payload_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(), caseId, actor.kind, actor.id, 'checklist_completed', 'checklist_item', itemId,
      JSON.stringify({ item_key: item.item_key, stage_id: item.stage_id, title: item.title, scope_key: scopeKey }), iso
    )
  ];

  if (item.creates_action_kind && item.creates_action_title) {
    const vis = item.creates_action_kind === 'hbe_task' ? 'hbe' : (item.visibility === 'hbe' ? 'hbe' : 'shared');
    const due = dueDateFromOffset(now, item.creates_due_offset_days);
    const taskBuyerId = actor.kind === 'buyer' ? actor.id : null;
    const existingTask = await env.BUYER_DB.prepare(
      `SELECT id,status FROM household_tasks
       WHERE case_id=? AND source_item_id=? AND COALESCE(buyer_id,'')=? LIMIT 1`
    ).bind(caseId, itemId, taskBuyerId || '').first();
    if (existingTask) {
      if (existingTask.status !== 'open') {
        statements.push(env.BUYER_DB.prepare(
          "UPDATE household_tasks SET status='open', updated_at=?, is_whats_next=1 WHERE id=?"
        ).bind(iso, existingTask.id));
      }
    } else {
      statements.push(env.BUYER_DB.prepare(
        `INSERT INTO household_tasks
          (id,case_id,buyer_id,created_at,updated_at,title,due_at,priority,status,stage,visibility,source,source_item_id,is_whats_next)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        crypto.randomUUID(), caseId, taskBuyerId,
        iso, iso, item.creates_action_title, due,
        item.creates_priority || 'high', 'open', item.stage_id, vis, 'checklist', itemId, 1
      ));
      statements.push(env.BUYER_DB.prepare(
        `INSERT INTO household_audit_events
          (id,case_id,actor_kind,actor_id,action,entity_type,entity_id,payload_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        crypto.randomUUID(), caseId, actor.kind, actor.id, 'task_created_from_checklist', 'task', itemId,
        JSON.stringify({ title: item.creates_action_title, visibility: vis, due_at: due }), iso
      ));
    }
  }

  await env.BUYER_DB.batch(statements);
  return { ok: true };
}

export async function saveStory(env, { caseId, actor, fields, now = new Date() }) {
  if (actor.kind !== 'hbe') return { ok: false, error: 'forbidden' };
  const iso = now.toISOString();
  await env.BUYER_DB.prepare(
    `INSERT INTO household_stories
      (case_id,shared_story,hbe_synthesis,wants,needs,tradeoffs,risks,decision_style,unresolved_questions,evidence,what_changed,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(case_id) DO UPDATE SET
      shared_story=excluded.shared_story,
      hbe_synthesis=excluded.hbe_synthesis,
      wants=excluded.wants,
      needs=excluded.needs,
      tradeoffs=excluded.tradeoffs,
      risks=excluded.risks,
      decision_style=excluded.decision_style,
      unresolved_questions=excluded.unresolved_questions,
      evidence=excluded.evidence,
      what_changed=excluded.what_changed,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by`
  ).bind(
    caseId,
    fields.shared_story || '',
    fields.hbe_synthesis || '',
    fields.wants || '',
    fields.needs || '',
    fields.tradeoffs || '',
    fields.risks || '',
    fields.decision_style || '',
    fields.unresolved_questions || '',
    fields.evidence || '',
    fields.what_changed || '',
    iso, actor.id
  ).run();
  await env.BUYER_DB.prepare(
    `INSERT INTO household_audit_events
      (id,case_id,actor_kind,actor_id,action,entity_type,entity_id,payload_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), caseId, actor.kind, actor.id, 'story_updated', 'story', caseId, JSON.stringify({ keys: Object.keys(fields) }), iso).run();
  return { ok: true };
}

export async function savePrivateContext(env, { caseId, buyerId, actor, context, now = new Date() }) {
  if (actor.kind === 'buyer' && actor.id !== buyerId) return { ok: false, error: 'forbidden' };
  const iso = now.toISOString();
  await env.BUYER_DB.prepare(
    `INSERT INTO buyer_private_context (buyer_id,case_id,context_json,updated_at,updated_by)
     VALUES (?,?,?,?,?)
     ON CONFLICT(buyer_id) DO UPDATE SET context_json=excluded.context_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by`
  ).bind(buyerId, caseId, JSON.stringify(context || {}), iso, actor.id).run();
  return { ok: true };
}

export async function saveCompass(env, { caseId, actor, fields, now = new Date() }) {
  if (actor.kind !== 'hbe') return { ok: false, error: 'forbidden' };
  const iso = now.toISOString();
  const fallback = defaultCompass('consultation');
  await env.BUYER_DB.prepare(
    `INSERT INTO household_compass
      (case_id,optimizing_for,tradeoffs,uncertainty,evidence,next_conversation,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(case_id) DO UPDATE SET
      optimizing_for=excluded.optimizing_for,
      tradeoffs=excluded.tradeoffs,
      uncertainty=excluded.uncertainty,
      evidence=excluded.evidence,
      next_conversation=excluded.next_conversation,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by`
  ).bind(
    caseId,
    fields.optimizing_for || fallback.optimizing_for,
    fields.tradeoffs || fallback.tradeoffs,
    fields.uncertainty || fallback.uncertainty,
    fields.evidence || fallback.evidence,
    fields.next_conversation || fallback.next_conversation,
    iso, actor.id
  ).run();
  return { ok: true };
}

export async function caseIdForBuyer(env, buyerId) {
  const row = await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=? LIMIT 1').bind(buyerId).first();
  return row?.case_id || null;
}

// Header-only Access shortcuts are not used for /api/hbe/* mutations or preview.
// authenticateHbeProfessional (JWT + active professional) is the production path.
