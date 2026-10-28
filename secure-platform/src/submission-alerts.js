const REQUIRED_ALERT_RECIPIENT = 'buyers@hbexperts.com';
const DELIVERY_LIMIT = 20;
const LEASE_MS = 2 * 60 * 1000;
const OVERDUE_MS = 10 * 60 * 1000;

export function alertRecipients(env) {
  const configured = [env.HBE_ALERT_PRIMARY || REQUIRED_ALERT_RECIPIENT, env.HBE_ALERT_TO, env.HBE_ADMIN_EMAIL]
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([REQUIRED_ALERT_RECIPIENT, ...configured])];
}

export async function deliverSubmissionAlert(env, notificationId) {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const claim = await env.BUYER_DB.prepare(`UPDATE notification_deliveries
    SET status='sending', attempts=attempts+1, last_attempt_at=?, lease_until=?, error_code=NULL
    WHERE notification_id=? AND (status IN ('pending','failed') OR (status='sending' AND lease_until<?))`)
    .bind(nowIso, leaseUntil, notificationId, nowIso).run();
  if (!claim?.meta?.changes) return { status: 'skipped' };

  const row = await env.BUYER_DB.prepare(`SELECT n.id,n.created_at,b.first_name,b.last_name,b.email,b.phone
    FROM notifications n JOIN buyers b ON b.id=n.buyer_id WHERE n.id=? AND n.type='buyer_experience_submitted' LIMIT 1`)
    .bind(notificationId).first();
  if (!row) return failDelivery(env, notificationId, 'NOTIFICATION_NOT_FOUND');
  if (!env.HBE_ALERT) return failDelivery(env, notificationId, 'EMAIL_BINDING_MISSING');

  try {
    const result = await env.HBE_ALERT.send({
      to: alertRecipients(env),
      from: env.HBE_ALERT_FROM || 'buyer-alerts@hbexperts.com',
      subject: 'New HBE Buyer Experience submitted',
      text: `A new Buyer Experience was submitted to HomeBuyer Experts.\n\nBuyer: ${row.first_name} ${row.last_name}\nEmail: ${row.email}\nPhone: ${row.phone || 'Not provided'}\nSubmitted: ${row.created_at}\n\nOpen the protected HBEUI to review the submission. Questionnaire answers are intentionally not copied into this email.`,
      headers: { 'X-HBE-Notification-ID': String(row.id) }
    });
    await env.BUYER_DB.prepare(`UPDATE notification_deliveries
      SET status='sent', sent_at=?, lease_until=NULL, error_code=NULL, provider_message_id=? WHERE notification_id=?`)
      .bind(new Date().toISOString(), String(result?.messageId || '').slice(0, 200), notificationId).run();
    console.log(JSON.stringify({ event: 'buyer_alert_sent', notification_id: notificationId }));
    return { status: 'sent' };
  } catch (error) {
    return failDelivery(env, notificationId, safeErrorCode(error));
  }
}

export async function processSubmissionAlertBacklog(env) {
  const nowIso = new Date().toISOString();
  const rows = await env.BUYER_DB.prepare(`SELECT notification_id FROM notification_deliveries
    WHERE status IN ('pending','failed') OR (status='sending' AND lease_until<?)
    ORDER BY created_at ASC LIMIT ?`).bind(nowIso, DELIVERY_LIMIT).all();
  let sent = 0;
  for (const row of rows.results || []) {
    const result = await deliverSubmissionAlert(env, row.notification_id);
    if (result.status === 'sent') sent++;
  }
  const health = await submissionAlertHealth(env);
  if (!health.healthy) console.error(JSON.stringify({ event: 'buyer_alert_backlog_overdue', overdue_count: health.overdueCount }));
  return { attempted: (rows.results || []).length, sent, ...health };
}

export async function submissionAlertHealth(env) {
  const cutoff = new Date(Date.now() - OVERDUE_MS).toISOString();
  const row = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS count FROM notification_deliveries
    WHERE status!='sent' AND created_at<?`).bind(cutoff).first();
  const overdueCount = Number(row?.count || 0);
  return { healthy: !!env.HBE_ALERT && overdueCount === 0, bindingReady: !!env.HBE_ALERT, overdueCount };
}

async function failDelivery(env, notificationId, code) {
  await env.BUYER_DB.prepare(`UPDATE notification_deliveries
    SET status='failed', lease_until=NULL, error_code=?, last_error=?, last_error_at=? WHERE notification_id=?`).bind(code, code, new Date().toISOString(), notificationId).run();
  console.error(JSON.stringify({ event: 'buyer_alert_failed', notification_id: notificationId, error_code: code }));
  return { status: 'failed', code };
}

function safeErrorCode(error) {
  const code = String(error?.code || '').toUpperCase();
  return /^E_[A-Z0-9_]{1,60}$/.test(code) ? code : 'EMAIL_SEND_FAILED';
}
