(function () {
  // --- Config ---
  const API = 'https://vozciudadanaapi-production.up.railway.app';
  const APP = 'https://cero-absoluto.github.io/vozciudadana';
  const REFRESH = 30000; // refresh every 30 seconds

  // --- Get protest ID from script tag ---
  const scripts = document.querySelectorAll('script[src*="widget.js"]');
  const src = scripts[scripts.length - 1].src;
  const id = new URL(src).searchParams.get('id');
  if (!id) return console.warn('[VozCiudadana widget] Missing ?id= parameter');

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    .vc-widget {
      display: inline-flex;
      flex-direction: column;
      gap: 10px;
      background: #0C0B14;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 16px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 260px;
      max-width: 360px;
      box-sizing: border-box;
    }
    .vc-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vc-logo {
      font-size: 11px;
      font-weight: 700;
      color: #4CFFA4;
      text-decoration: none;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .vc-live {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      color: #4CFFA4;
      background: rgba(76,255,164,0.1);
      border-radius: 20px;
      padding: 2px 7px;
    }
    .vc-live-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #4CFFA4;
      animation: vc-pulse 1.5s ease-in-out infinite;
    }
    @keyframes vc-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .vc-title {
      font-size: 13px;
      font-weight: 600;
      color: #FFFFFF;
      line-height: 1.4;
    }
    .vc-scope {
      font-size: 10px;
      color: #8884AA;
    }
    .vc-counter {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .vc-number {
      font-size: 32px;
      font-weight: 800;
      color: #4CFFA4;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .vc-label {
      font-size: 11px;
      color: #8884AA;
    }
    .vc-meta {
      display: flex;
      gap: 12px;
      font-size: 10px;
      color: #8884AA;
    }
    .vc-btn {
      display: block;
      width: 100%;
      padding: 10px;
      background: #4C6FFF;
      border: none;
      border-radius: 8px;
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    .vc-btn:hover { opacity: 0.85; }
    .vc-footer {
      font-size: 9px;
      color: rgba(136,132,170,0.5);
      text-align: center;
    }
    .vc-footer a {
      color: rgba(76,255,164,0.5);
      text-decoration: none;
    }
  `;
  document.head.appendChild(style);

  // --- Create container where script tag is ---
  const container = document.createElement('div');
  container.className = 'vc-widget';
  container.innerHTML = `
    <div class="vc-header">
      <a class="vc-logo" href="${APP}" target="_blank" rel="noopener">🗳 Voz Ciudadana</a>
      <span class="vc-live"><span class="vc-live-dot"></span>LIVE</span>
    </div>
    <div class="vc-title" id="vc-title-${id}">Loading...</div>
    <div class="vc-scope" id="vc-scope-${id}"></div>
    <div class="vc-counter">
      <span class="vc-number" id="vc-count-${id}">—</span>
      <span class="vc-label">verified citizens</span>
    </div>
    <div class="vc-meta" id="vc-meta-${id}"></div>
    <a class="vc-btn" href="${APP}/#/protest/${id}" target="_blank" rel="noopener">
      🗳️ Join anonymously
    </a>
    <div class="vc-footer">
      Anonymous · Verified · Uncensored ·
      <a href="${APP}" target="_blank" rel="noopener">vozciudadana.org</a>
    </div>
  `;

  // Insert after the script tag
  scripts[scripts.length - 1].insertAdjacentElement('afterend', container);

  // --- Fetch and update ---
  function update() {
    fetch(`${API}/api/protests/${id}/informe`)
      .then(r => r.json())
      .then(d => {
        const p = d.protest;
        const el = id => document.getElementById(id);

        el(`vc-title-${id}`).textContent = p.title || '—';

        const scopeMap = { national: '🏛️ National', regional: '📍 Regional', global: '🌍 Global' };
        el(`vc-scope-${id}`).textContent =
          (scopeMap[p.scope] || p.scope || '') + (p.country_name ? ' · ' + p.country_name : '');

        // Animate counter
        const target = d.total_adhesiones || 0;
        const current = parseInt(el(`vc-count-${id}`).textContent.replace(/,/g, '')) || 0;
        animateCount(el(`vc-count-${id}`), current, target);

        el(`vc-meta-${id}`).innerHTML =
          `<span>📍 ${d.ciudades_distintas || 0} cities</span>` +
          `<span>🌐 ${d.paises_distintos || 0} countries</span>` +
          `<span>✅ 100% verified</span>`;
      })
      .catch(() => {
        const el = document.getElementById(`vc-title-${id}`);
        if (el) el.textContent = 'Could not load data';
      });
  }

  function animateCount(el, from, to) {
    if (from === to) { el.textContent = to.toLocaleString('en'); return; }
    const duration = 800;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (to - from) * ease).toLocaleString('en');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Initial load + refresh
  update();
  setInterval(update, REFRESH);
})();
