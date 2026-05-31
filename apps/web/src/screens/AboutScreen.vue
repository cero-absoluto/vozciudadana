<template>
  <div class="screen active" id="s-about">
    <div class="scroll">
      <div class="about-hero">
        <div class="about-h">{{ $t('about.heroTitle') }}</div>
        <div class="about-p">{{ $t('about.heroBody') }}</div>
      </div>
     <div class="manifesto">
        <strong>{{ $t('about.manifestoLabel') }}</strong> {{ $t('about.manifesto') }}
      </div>
      
      <div class="section-head">{{ $t('about.sec1Title') }}</div>
      <div class="tech-grid">
        <div class="tcard"><div class="tcard-ico">✅</div><div class="tcard-h">{{ $t('about.card1Title') }}</div><div class="tcard-p">{{ $t('about.card1Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">❌</div><div class="tcard-h">{{ $t('about.card2Title') }}</div><div class="tcard-p">{{ $t('about.card2Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🏛️</div><div class="tcard-h">{{ $t('about.card3Title') }}</div><div class="tcard-p">{{ $t('about.card3Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">📎</div><div class="tcard-h">{{ $t('about.card4Title') }}</div><div class="tcard-p">{{ $t('about.card4Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">⚡</div><div class="tcard-h">{{ $t('about.card5Title') }}</div><div class="tcard-p">{{ $t('about.card5Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🔍</div><div class="tcard-h">{{ $t('about.card6Title') }}</div><div class="tcard-p">{{ $t('about.card6Body') }}</div></div>
      </div>
      <div class="section-head">{{ $t('about.sec2Title') }}</div>
      <div class="tech-grid">
        <div class="tcard"><div class="tcard-ico">🏛️</div><div class="tcard-h">{{ $t('about.geo1Title') }}</div><div class="tcard-p">{{ $t('about.geo1Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🌐</div><div class="tcard-h">{{ $t('about.geo2Title') }}</div><div class="tcard-p">{{ $t('about.geo2Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🌍</div><div class="tcard-h">{{ $t('about.geo3Title') }}</div><div class="tcard-p">{{ $t('about.geo3Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">📱</div><div class="tcard-h">{{ $t('about.geo4Title') }}</div><div class="tcard-p">{{ $t('about.geo4Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">⏳</div><div class="tcard-h">{{ $t('about.geo5Title') }}</div><div class="tcard-p">{{ $t('about.geo5Body') }}</div></div>
      </div>
      <div class="section-head">{{ $t('about.sec3Title') }}</div>
      <div class="tech-grid">
        <div class="tcard"><div class="tcard-ico">📧</div><div class="tcard-h">{{ $t('about.censo1Title') }}</div><div class="tcard-p">{{ $t('about.censo1Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">👥</div><div class="tcard-h">{{ $t('about.censo2Title') }}</div><div class="tcard-p">{{ $t('about.censo2Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🗑️</div><div class="tcard-h">{{ $t('about.censo3Title') }}</div><div class="tcard-p">{{ $t('about.censo3Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">📊</div><div class="tcard-h">{{ $t('about.censo4Title') }}</div><div class="tcard-p">{{ $t('about.censo4Body') }}</div></div>
      </div>
      <div class="section-head">{{ $t('about.sec4Title') }}</div>
      <div class="tech-grid">
        <div class="tcard"><div class="tcard-ico">🔒</div><div class="tcard-h">{{ $t('about.seg1Title') }}</div><div class="tcard-p">{{ $t('about.seg1Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🪪</div><div class="tcard-h">{{ $t('about.seg2Title') }}</div><div class="tcard-p">{{ $t('about.seg2Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">🧅</div><div class="tcard-h">{{ $t('about.seg3Title') }}</div><div class="tcard-p">{{ $t('about.seg3Body') }}</div></div>
        <div class="tcard"><div class="tcard-ico">⛓️</div><div class="tcard-h">{{ $t('about.seg4Title') }}</div><div class="tcard-p">{{ $t('about.seg4Body') }}</div></div>
      </div>
      <!-- API pública -->
      <div class="section-head">Open Data</div>
      <div class="tech-grid">
        <div class="tcard" style="cursor:pointer" @click="$router.push('/api-docs')">
          <div class="tcard-ico">🔌</div>
          <div class="tcard-h">Public API</div>
          <div class="tcard-p">Free API for researchers and journalists. Aggregated data, no authentication required. →</div>
        </div>
        <div class="tcard">
          <div class="tcard-ico">📦</div>
          <div class="tcard-h">Open Source</div>
          <div class="tcard-p">Full source code available under AGPL 3.0 at <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" style="color:var(--accent)">GitHub</a>.</div>
        </div>
      </div>
    </div>
  </div>
</template>
