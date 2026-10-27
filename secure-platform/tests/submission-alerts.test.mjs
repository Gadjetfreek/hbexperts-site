import test from 'node:test';
import assert from 'node:assert/strict';
import { alertRecipients, deliverSubmissionAlert } from '../src/submission-alerts.js';

test('alert recipients always include buyers and configured HBE admin without duplicates', () => {
  assert.deepEqual(alertRecipients({
    HBE_ALERT_PRIMARY: 'buyers@hbexperts.com',
    HBE_ALERT_TO: 'cwhitehead@hbexperts.com,buyers@hbexperts.com',
    HBE_ADMIN_EMAIL: 'cwhitehead@hbexperts.com'
  }), ['buyers@hbexperts.com', 'cwhitehead@hbexperts.com']);
});

test('missing binding records a sanitized failure without buyer data in logs', async () => {
  const updates = [];
  const env = {
    BUYER_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                updates.push({ sql, args });
                if (sql.startsWith('UPDATE notification_deliveries\n    SET status=\'sending\'')) return { meta: { changes: 1 } };
                return { meta: { changes: 1 } };
              },
              async first() {
                return { id: 'notification-1', created_at: '2026-10-25T15:25:06.649Z', first_name: 'Private', last_name: 'Buyer', email: 'private@example.test', phone: '555' };
              }
            };
          }
        };
      }
    }
  };
  const lines = [];
  const original = console.error;
  console.error = line => lines.push(String(line));
  try {
    const result = await deliverSubmissionAlert(env, 'notification-1');
    assert.deepEqual(result, { status: 'failed', code: 'EMAIL_BINDING_MISSING' });
  } finally {
    console.error = original;
  }
  assert.match(lines.join('\n'), /EMAIL_BINDING_MISSING/);
  assert.doesNotMatch(lines.join('\n'), /Private|private@example\.test|555/);
  assert.ok(updates.some(update => update.args.includes('EMAIL_BINDING_MISSING')));
});
