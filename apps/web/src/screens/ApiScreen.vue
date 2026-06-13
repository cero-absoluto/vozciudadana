<template>
  <div class="screen active" id="s-api">
    <div class="scroll" style="padding:16px">

      <div style="margin-bottom:20px">
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">{{ $t('api.openData') }}</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px;letter-spacing:-.4px;margin-bottom:8px">{{ $t('api.title') }}</div>
        <div style="font-size:14px;color:var(--text);line-height:1.7">{{ $t('api.desc') }}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:10px;background:rgba(76,255,164,.1);color:var(--accent2);border-radius:20px;padding:3px 10px">{{ $t('api.badgeFree') }}</span>
          <span style="font-size:10px;background:rgba(76,111,255,.1);color:#4C6FFF;border-radius:20px;padding:3px 10px">{{ $t('api.badgeNoAuth') }}</span>
          <span style="font-size:10px;background:rgba(255,179,71,.1);color:var(--accent4);border-radius:20px;padding:3px 10px">{{ $t('api.badgeAggregated') }}</span>
          <span style="font-size:10px;background:rgba(124,111,255,.1);color:#7C6FFF;border-radius:20px;padding:3px 10px">{{ $t('api.badgeAGPL') }}</span>
        </div>
      </div>

      <!-- Base URL -->
      <div class="api-block">
        <div class="api-block-title">{{ $t('api.baseUrlTitle') }}</div>
        <div class="api-code">https://api.voiceprotest.org</div>
      </div>

      <!-- Rate limit -->
      <div class="api-block">
        <div class="api-block-title">{{ $t('api.rateLimitTitle') }}</div>
        <div style="font-size:14px;color:var(--text)">{{ $t('api.rateLimitDesc') }}</div>
      </div>

      <!-- Endpoint 1 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/stats</span>
        </div>
        <div style="font-size:14px;color:var(--text);margin-bottom:10px">{{ $t('api.endpoint1Desc') }}</div>
        <div class="api-code">https://api.voiceprotest.org/api/public/stats</div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">{{ $t('api.exampleResponse') }}</div>
          <pre class="api-pre">{{ statsExample }}</pre>
        </div>
        <button class="api-try-btn" @click="tryEndpoint('stats')">{{ $t('api.tryIt') }}</button>
        <pre v-if="results.stats" class="api-result">{{ results.stats }}</pre>
      </div>

      <!-- Endpoint 2 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/protests</span>
        </div>
        <div style="font-size:14px;color:var(--text);margin-bottom:6px">{{ $t('api.endpoint2Desc') }}</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:10px">
          {{ $t('api.endpoint2Params') }} <code class="api-inline">status</code> (active|closed|all) ·
          <code class="api-inline">scope</code> (national|regional|global) ·
          <code class="api-inline">country</code> (ISO code, e.g. ES)
        </div>
        <div class="api-code">https://api.voiceprotest.org/api/public/protests?status=active</div>
        <button class="api-try-btn" @click="tryEndpoint('protests')">{{ $t('api.tryIt') }}</button>
        <pre v-if="results.protests" class="api-result">{{ results.protests }}</pre>
      </div>

      <!-- Endpoint 3 -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/protests/:id</span>
        </div>
        <div style="font-size:14px;color:var(--text);margin-bottom:10px">{{ $t('api.endpoint3Desc') }}</div>
        <div class="api-code">https://api.voiceprotest.org/api/public/protests/{protest_id}</div>
        <button class="api-try-btn" @click="tryEndpoint('protest')">{{ $t('api.tryUtrecht') }}</button>
        <pre v-if="results.protest" class="api-result">{{ results.protest }}</pre>
      </div>

      <!-- Endpoint 4 — integrity-data -->
      <div class="api-block">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="api-method">GET</span>
          <span class="api-path">/api/public/protests/:id/integrity-data</span>
        </div>
        <div style="font-size:14px;color:var(--text);margin-bottom:8px">{{ $t('api.endpoint4Desc') }}</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:10px;font-style:italic">{{ $t('api.endpoint4Note') }}</div>
        <div class="api-code">https://api.voiceprotest.org/api/public/protests/{protest_id}/integrity-data</div>
        <div style="margin-top:10px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">{{ $t('api.exampleResponse') }}</div>
          <pre class="api-pre">{{ integrityExample }}</pre>
        </div>
      </div>

      <!-- Attribution -->
      <div class="api-block" style="margin-bottom:30px">
        <div class="api-block-title">{{ $t('api.attributionTitle') }}</div>
        <div style="font-size:14px;color:var(--text);line-height:1.7">
          {{ $t('api.attributionDesc') }}<br>
          <strong style="color:var(--text)">{{ $t('api.attributionLine') }}</strong><br>
          {{ $t('api.attributionData') }}<br>
          <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" style="color:var(--accent)">{{ $t('api.attributionSource') }}</a>
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
  "platform": "Voice Protest",
  "version": "1.0",
  "license": "AGPL 3.0",
  "data": {
    "total_protests": 12,
    "active_protests": 3,
    "closed_protests": 9,
    "total_adhesions": 847,
    "active_countries": 5,
    "active_countries_list": ["ES", "NL", "FR"],
    "by_scope": { "national": 8, "regional": 3, "global": 1 }
  }
}`;

const integrityExample = `{
  "integrity_version": 2,
  "protest_id": "b15ae4a9-...",
  "scope": "national",
  "country": "ES",
  "total_adhesions": 1247,
  "closed_at": "2026-06-11T18:30:00Z",
  "integrity_hash": "e0ff21f8a3b4c5d6...",
  "integrity_calculated_at": "2026-06-11T18:30:05Z",
  "first_adhesion": "2026-06-10T10:00:00Z",
  "last_adhesion": "2026-06-11T18:00:00Z",
  "public_commitments": ["a1b2c3...", "d4e5f6...", "..."],
  "city_distribution": { "Amsterdam": 234, "Rotterdam": 187 },
  "reliability_breakdown": { "85": 456, "75": 389, "65": 402 },
  "data_source": "integrity_record",
  "verification_instructions": {
    "algorithm": "SHA256",
    "input_format": "protest_id|title|demands|scope|country|count|cities_count|reliability|cities|first_adhesion|last_adhesion|sorted_commitments_joined_with_|",
    "note": "Sort public_commitments alphabetically before joining."
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
