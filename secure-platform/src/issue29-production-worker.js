import appWorker from './issue29-convergence-worker.js';

// Final production wrapper for Issue #29.
// Keep this layer intentionally small: the convergence worker owns behavior;
// this wrapper only removes the stale pre-invite wording that said email delivery
// was blocked after the buyer-mail-app invitation flow was implemented.
export default {
  async fetch(request, env, ctx) {
    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (!type.includes('text/html')) return response;

    let text = await response.text();
    text = text.replace(
      'Email delivery of this invitation is an architecture blocker until a verified sending domain and the HBE_ALERT Send Email binding are enabled. Until then, share the copyable link. Do not enter the other buyer’s email here.',
      'Create the private invitation first. Then you can open your own mail app with the secure invitation link already included, or copy the link and share it another way. HBE does not collect the other buyer’s email at this step.'
    );

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
