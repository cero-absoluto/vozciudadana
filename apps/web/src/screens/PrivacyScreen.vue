<template>
  <div class="screen active" id="s-privacy">
    <div class="scroll" style="padding:20px 16px 40px">

      <!-- Header -->
      <div style="margin-bottom:24px">
        <div style="font-size:26px;font-weight:800;font-family:'Syne',sans-serif;margin-bottom:6px;color:var(--text)">{{ $t('privacy.title') }}</div>
        <div style="font-size:14px;color:var(--text2)">{{ $t('privacy.updated') }}</div>
      </div>

      <!-- Principle -->
      <div style="background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">{{ $t('privacy.principleTitle') }}</div>
        <div style="font-size:15px;color:var(--text2);line-height:1.7">{{ $t('privacy.principleBody') }}</div>
      </div>

      <!-- Section: What we collect -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.collectTitle') }}</div>
        <div v-for="item in collectItems" :key="item.key"
          style="display:flex;gap:12px;padding:10px 0;border-bottom:.5px solid var(--border)">
          <div style="font-size:22px;flex-shrink:0">{{ item.icon }}</div>
          <div>
            <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:var(--text)">{{ item.title }}</div>
            <div style="font-size:15px;color:var(--text);line-height:1.65">{{ item.body }}</div>
          </div>
        </div>
      </div>

      <!-- Section: What we never do -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.neverTitle') }}</div>
        <div v-for="item in neverItems" :key="item.key"
          style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:.5px solid var(--border)">
          <div style="color:var(--accent3);font-size:17px;flex-shrink:0;margin-top:1px">✗</div>
          <div style="font-size:15px;color:var(--text);line-height:1.6">{{ item }}</div>
        </div>
      </div>

      <!-- Section: Service providers -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.providersTitle') }}</div>
        <div style="font-size:15px;color:var(--text2);margin-bottom:10px">{{ $t('privacy.providersDesc') }}</div>
        <div v-for="p in providers" :key="p.name"
          style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:.5px solid var(--border)">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--text)">{{ p.name }}</div>
            <div style="font-size:13px;color:var(--text2)">{{ p.role }}</div>
          </div>
          <div style="font-size:13px;color:var(--text2);font-weight:600;text-align:right">{{ p.country }}</div>
        </div>
      </div>

      <!-- Section: Cookies -->
      <div style="background:rgba(124,111,255,.06);border:.5px solid rgba(124,111,255,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">{{ $t('privacy.cookiesTitle') }}</div>
        <div style="font-size:16px;color:var(--text);line-height:1.7">{{ $t('privacy.cookiesBody') }}</div>
      </div>

      <!-- Section: Push notifications -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.pushTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.pushBody') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-top:8px">{{ $t('privacy.pushTimezone') }}</div>
      </div>

      <!-- Section: Abuse protection -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.abuseTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.abuseBody') }}</div>
      </div>

      <!-- Section: Nullifiers and public commitments -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.nullifiersTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.nullifiersBody') }}</div>
      </div>

      <!-- Section: Integrity records -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.integrityRecordsTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.integrityRecordsBody') }}</div>
      </div>

      <!-- Section: Institutional email -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.institutionalEmailTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.institutionalEmailBody') }}</div>
      </div>

      <!-- Section: Donations -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.donationsTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.donationsBody') }}</div>
      </div>

      <!-- Section: Data retention -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.retentionTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.retentionBody') }}</div>
      </div>

      <!-- Section: Controller -->
      <div style="background:var(--bg2);border:.5px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;color:var(--text2)">{{ $t('privacy.controllerTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.8">
          Stichting Voice Protest<br>
          Utrecht, Netherlands<br>
          <a href="mailto:voice@voiceprotest.org" style="color:var(--accent)">voice@voiceprotest.org</a>
        </div>
      </div>

      <!-- Public report note -->
      <div style="background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;color:var(--accent2);margin-bottom:6px">📊 {{ $t('privacy.reportNote') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.reportNoteBody') }}</div>
      </div>

      <!-- Technical metadata section -->
      <div style="margin-bottom:20px">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('privacy.metadataTitle') }}</div>
        <div style="font-size:15px;color:var(--text);line-height:1.7">{{ $t('privacy.metadataBody') }}</div>
      </div>

      <!-- Source code -->
      <div style="text-align:center;font-size:14px;color:var(--text2);line-height:1.8">
        {{ $t('privacy.sourceNote') }}<br>
        <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" style="color:var(--accent)">github.com/cero-absoluto/vozciudadana</a>
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const collectItems = computed(() => [
  { key:'hash',    icon:'#️⃣', title: t('privacy.collect1Title'), body: t('privacy.collect1Body') },
  { key:'city',    icon:'📍', title: t('privacy.collect2Title'), body: t('privacy.collect2Body') },
  { key:'device',  icon:'📱', title: t('privacy.collect3Title'), body: t('privacy.collect3Body') },
  { key:'lang',    icon:'🌐', title: t('privacy.collect4Title'), body: t('privacy.collect4Body') },

]);

const neverItems = computed(() => [
  t('privacy.never1'),
  t('privacy.never2'),
  t('privacy.never3'),
  t('privacy.never4'),
  t('privacy.never5'),
]);

const providers = computed(() => [
  { name: 'Supabase',  role: t('privacy.providerSupabase'),  country: 'EU (AWS Frankfurt)' },
  { name: 'Railway',   role: t('privacy.providerRailway'),   country: 'US' },
  { name: 'Twilio',    role: t('privacy.providerTwilio'),    country: 'US' },
  { name: 'Resend',    role: t('privacy.providerResend'),    country: 'US' },
  { name: 'Google reCAPTCHA', role: t('privacy.providerRecaptcha'), country: 'US' },
  { name: 'Nominatim (OpenStreetMap)', role: t('privacy.providerNominatim'), country: t('privacy.providerNominatimRegion') },
  { name: 'GitHub Pages', role: t('privacy.providerGithub'), country: t('privacy.providerGithubRegion') },
]);
</script>

