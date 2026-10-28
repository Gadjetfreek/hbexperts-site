// Desktop HBEUI: an installable Edge/Chrome app that opens the HBEUI dashboard (/hbe)
// in its own window, plus a wide-screen layout. Separate manifest id so the iPhone
// Home Screen app (id /hbe/app) is untouched. Everything stays inside the /hbe scope.
export const DESKTOP_MANIFEST_PATH = '/hbe/desktop.webmanifest';

export const DESKTOP_MANIFEST = {
  name: 'HBEUI', short_name: 'HBEUI', id: '/hbe/desktop', start_url: '/hbe', scope: '/hbe',
  display: 'standalone', display_override: ['standalone', 'minimal-ui'],
  background_color: '#f8f8f7', theme_color: '#2d5a3d', description: 'HBE buyer workspace (desktop)',
  icons: [
    { src: '/hbe/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/hbe/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
  ],
  shortcuts: [
    { name: 'Alerts and notifications', short_name: 'Alerts', url: '/hbe/app' },
    { name: 'Lead response', short_name: 'Leads', url: '/hbe#lead-response' }
  ]
};

export function desktopManifestResponse() {
  return new Response(JSON.stringify(DESKTOP_MANIFEST), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
}

export const DESKTOP_HEAD = `<link rel="manifest" id="hbe-desktop-manifest" href="${DESKTOP_MANIFEST_PATH}" crossorigin="use-credentials"><meta name="theme-color" content="#2d5a3d"><link rel="icon" href="/hbe/app-icon-192.png">
<style id="hbe-desktop-css">
@media(min-width:1200px){
.shell{display:grid;grid-template-columns:300px minmax(0,1fr);gap:1.25rem;align-items:start;max-width:1680px}
.shell>*{grid-column:1/-1;min-width:0}
.shell>.buyer-strip{grid-column:1;flex-direction:column;overflow:auto;max-height:calc(100vh - 110px);position:sticky;top:84px;padding:0 .25rem 0 0}
.shell>.buyer-strip .buyer-card{flex:0 0 auto}
.shell>.buyer-main,.shell>.main-empty{grid-column:2}
.header-inner{max-width:1680px}
}
@media(display-mode:standalone){.site-header{top:0}}
</style>`;

export function addDesktopApp(html) {
  if (typeof html !== 'string' || html.includes('id="hbe-desktop-manifest"')) return html;
  let out = html.includes('</head>') ? html.replace('</head>', `${DESKTOP_HEAD}</head>`) : html;
  out = out.replace('<div class="header-actions">', '<div class="header-actions"><a href="/hbe/app" id="hbe-desktop-alerts">Alerts</a>');
  return out;
}