export const GOOGLE_ADS_ID = 'AW-18500305800';

const LABEL_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function normalizeConversionLabel(value) {
  const label = String(value || '').trim();
  return LABEL_RE.test(label) ? label : '';
}

/**
 * Add Google Ads only to the HTML returned after a successful Buyer Experience
 * submission. The conversion label is intentionally deployment-configured; an
 * absent or invalid label loads the base tag but never sends a conversion.
 */
export function addGoogleAdsSubmissionConversion(html, conversionLabel = '') {
  if (!html || typeof html !== 'string' || !html.includes('</head>') || !html.includes('</body>')) return html;
  if (html.includes('id="hbe-google-ads-submission"')) return html;

  const label = normalizeConversionLabel(conversionLabel);
  const send = label
    ? `gtag('event','conversion',{send_to:'${GOOGLE_ADS_ID}/${label}'});`
    : '';
  const base = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}" id="hbe-google-ads-submission"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GOOGLE_ADS_ID}');${send}document.dispatchEvent(new CustomEvent('hbe:buyer-experience-submitted'));</script>`;

  return html.replace('</head>', `${base}</head>`);
}

export function allowGoogleAdsForSubmission(headers) {
  const out = new Headers(headers);
  const current = out.get('content-security-policy') || '';
  if (!current) return out;

  const directives = current.split(';').map(part => part.trim()).filter(Boolean);
  const add = (name, values) => {
    const index = directives.findIndex(part => part === name || part.startsWith(`${name} `));
    if (index < 0) {
      directives.push(`${name} ${values.join(' ')}`);
      return;
    }
    const tokens = new Set(directives[index].split(/\s+/));
    values.forEach(value => tokens.add(value));
    directives[index] = [...tokens].join(' ');
  };

  add('script-src', ['https://www.googletagmanager.com']);
  add('connect-src', ["'self'", 'https://www.google.com', 'https://www.googleadservices.com']);
  add('img-src', ['https://www.google.com', 'https://www.googleadservices.com']);
  out.set('content-security-policy', `${directives.join('; ')};`);
  return out;
}
