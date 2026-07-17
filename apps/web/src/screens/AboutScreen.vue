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
        <div class="tcard"><div class="tcard-ico">🔍</div><div class="tcard-h">{{ $t('about.seg3Title') }}</div><div class="tcard-p">{{ $t('about.seg3Body') }}</div></div>
      </div>
      <!-- API pública -->
      <div class="section-head">{{ $t('about.openTitle') }}</div>
      <div class="tech-grid">
        <div class="tcard" style="cursor:pointer" @click="$router.push('/api-docs')">
          <div class="tcard-ico">🔌</div>
          <div class="tcard-h">{{ $t('about.openCard1Title') }}</div>
          <div class="tcard-p">{{ $t('about.openCard1Body') }}</div>
        </div>
        <div class="tcard">
          <div class="tcard-ico">📦</div>
          <div class="tcard-h">{{ $t('about.openCard2Title') }}</div>
          <div class="tcard-p" v-html="$t('about.openCard2Body')"></div>
        </div>
        <div class="tcard" style="cursor:pointer" @click="$router.push('/privacy')">
          <div class="tcard-ico">🔒</div>
          <div class="tcard-h">{{ $t('privacy.title') }}</div>
          <div class="tcard-p">{{ $t('about.openCard3Teaser') }}</div>
        </div>
        <div class="tcard" style="cursor:pointer" @click="$router.push('/funding')">
          <div class="tcard-ico">💰</div>
          <div class="tcard-h">{{ $t('funding.title') }}</div>
          <div class="tcard-p">{{ $t('about.openCard4Teaser') }}</div>
        </div>
        <div class="tcard" style="cursor:pointer" @click="goToQuienesSomos">
          <div class="tcard-ico">🏛️</div>
          <div class="tcard-h">{{ $t('about.openCard5Title') }}</div>
          <div class="tcard-p">{{ $t('about.openCard5Teaser') }}</div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
const { locale } = useI18n();

// quienes-somos.html exists in 4 languages (es at the root — the site's
// default/x-default — plus /en, /fr, /zh) with cross hreflang tags for
// search engines. This just sends the person to the version matching
// whatever language they already have the app in.
const QUIENES_SOMOS_PATHS = {
  es: '/quienes-somos.html',
  en: '/en/quienes-somos.html',
  fr: '/fr/quienes-somos.html',
  zh: '/zh/quienes-somos.html',
};
function goToQuienesSomos() {
  window.location.href = QUIENES_SOMOS_PATHS[locale.value] || QUIENES_SOMOS_PATHS.es;
}
</script>

