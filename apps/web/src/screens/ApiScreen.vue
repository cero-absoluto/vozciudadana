<template>
  <div class="screen active" id="s-api">
    <div class="scroll" style="padding:16px">

      <div style="margin-bottom:20px">
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Open Data</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px;letter-spacing:-.4px;margin-bottom:8px">Public API</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.7">
          Voz Ciudadana provides a free, open API for researchers, journalists and developers.
          All data is aggregated and anonymised — no personal data is ever exposed.
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:10px;background:rgba(76,255,164,.1);color:var(--accent2);border-radius:20px;padding:3px 10px">✅ Free</span>
          <span style="font-size:10px;background:rgba(76,111,255,.1);color:#4C6FFF;border-radius:20px;padding:3px 10px">🔓 No auth required</span>
          <span style="font-size:10px;background:rgba(255,179,71,.1);color:var(--accent4);border-radius:20px;padding:3px 10px">📊 Aggregated only</span>
          <span style="font-size:10px;background:rgba(124,111,255,.1);color:#7C6FFF;border-radius:20px;padding:3px 10px">AGPL 3.0</span>
        </div>
      </div>

      <!-- Base URL -->
      <div class="api-block">
        <div class="api-block-title">Base URL</div>
        <div class="api-code">{{ BASE_URL }}</div>
      </div>

      <!-- Rate limit -->
      <div class="api-block">
        <div class="api-block-title">Rate limit</div>
        <div style="font-size:12px;color:var(--text2)">120 requests per minute per IP. No authentication required.</div>
      </div>

      <!-- Endpoint 1 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/stats</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Global platform statistics — total protests, adhesions, countries.</div>
        <div class="api-code">{{ BASE_URL }}/api/public/stats</div>
        <div style="margin-top:10px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Example response</div>
          <pre class="api-pre">{{ statsExample }}</pre>
        </div>
        <button class="api-try-btn" @click="tryEndpoint('stats')">▶ Try it</button>
        <pre v-if="results.stats" class="api-result">{{ results.stats }}</pre>
      </div>

      <!-- Endpoint 2 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/protests</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">List all protests with aggregated data.</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px">
          Query params: <code class="api-inline">status</code> (active|closed|all) ·
          <code class="api-inline">scope</code> (national|regional|global) ·
          <code class="api-inline">country</code> (ISO code, e.g. ES)
        </div>
        <div class="api-code">{{ BASE_URL }}/api/public/protests?status=active</div>
        <button class="api-try-btn" @click="tryEndpoint('protests')">▶ Try it</button>
        <pre v-if="results.protests" class="api-result">{{ results.protests }}</pre>
      </div>

      <!-- Endpoint 3 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/protests/:id</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px">Full data for a single protest including reliability breakdown, geographic distribution and growth stats.</div>
        <div class="api-code">{{ BASE_URL }}/api/public/protests/{protest_id}</div>
        <button class="api-try-btn" @click="tryEndpoint('protest')">▶ Try with Utrecht</button>
        <pre v-if="results.protest" class="api-result">{{ results.protest }}</pre>
      </div>

      <!-- Attribution -->
      <div class="api-block" style="margin-bottom:30px">
        <div class="api-block-title">Attribution</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.7">
          When using this data, please credit:<br>
          <strong style="color:var(--text)">Voz Ciudadana — cero-absoluto.github.io/vozciudadana</strong><br>
          Source code: <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" style="color:var(--accent)">github.com/cero-absoluto/vozciudadana</a><br>
          License: AGPL 3.0
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const BASE_URL = import.meta.env.VITE_API_URL;
const UTRECHT_ID = '64ebc961-fc88-46a1-81a6-200e85d6265f';
const results = ref({});

const statsExample = `{
  "generated_at": "2026-05-31T10:00:00.000Z",
  "platform": "Voz Ciudadana",
  "data": {
    "total_protests": 12,
    "active_protests": 3,
    "total_adhesions": 847,
    "active_countries": 5
  }
}`;

async function tryEndpoint(key) {
  results.value[key] = 'Loading...';
  try {
    const urls = {
      stats:    `${BASE_URL}/api/public/stats`,
      protests: `${BASE_URL}/api/public/protests?status=active`,
      protest:  `${BASE_URL}/api/public/protests/${UTRECHT_ID}`,
    };
    const res = await fetch(urls[key]);
    const data = await res.json();
    results.value[key] = JSON.stringify(data, null, 2);
  } catch {
    results.value[key] = 'Error connecting to API';
  }
}
</script>
