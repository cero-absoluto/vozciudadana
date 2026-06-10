<template>
  <div class="screen active" id="s-funding">
    <div class="scroll" style="padding:20px 16px 40px">

      <!-- Header -->
      <div style="margin-bottom:24px">
        <div style="font-size:22px;font-weight:800;font-family:'Syne',sans-serif;margin-bottom:6px">{{ $t('funding.title') }}</div>
        <div style="font-size:12px;color:var(--text3)">{{ $t('funding.updated') }}</div>
      </div>

      <!-- Founding principle -->
      <div style="background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">{{ $t('funding.principleTitle') }}</div>
        <div style="font-size:14px;color:var(--text2);line-height:1.7">{{ $t('funding.principleBody') }}</div>
      </div>

      <!-- Current costs -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('funding.costsTitle') }}</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:10px">{{ $t('funding.costsDesc') }}</div>
        <div v-for="item in costItems" :key="item.key"
          style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:.5px solid var(--border)">
          <div>
            <div style="font-size:13px;font-weight:600">{{ item.name }}</div>
            <div style="font-size:11px;color:var(--text3)">{{ item.role }}</div>
          </div>
          <div style="font-size:12px;color:var(--text2);text-align:right">{{ item.cost }}</div>
        </div>
        <div style="margin-top:10px;padding:10px 12px;background:var(--bg2);border-radius:var(--r);font-size:12px;color:var(--text2)">
          {{ $t('funding.smsCost') }}
        </div>
      </div>

      <!-- Verification protection -->
      <div style="background:rgba(124,111,255,.06);border:.5px solid rgba(124,111,255,.15);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:6px">🛡️ {{ $t('funding.verificationProtectionTitle') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7">{{ $t('funding.verificationProtectionBody') }}</div>
      </div>

      <!-- What we accept -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('funding.acceptTitle') }}</div>
        <div v-for="item in acceptItems" :key="item"
          style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:.5px solid var(--border)">
          <div style="color:var(--accent2);font-size:14px;flex-shrink:0;margin-top:1px">✓</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.5">{{ item }}</div>
        </div>
      </div>

      <!-- What we do not accept -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('funding.rejectTitle') }}</div>
        <div v-for="item in rejectItems" :key="item"
          style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:.5px solid var(--border)">
          <div style="color:var(--accent3);font-size:14px;flex-shrink:0;margin-top:1px">✗</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.5">{{ item }}</div>
        </div>
      </div>

      <!-- No influence block -->
      <div style="background:rgba(255,179,71,.06);border:.5px solid rgba(255,179,71,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--accent4);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">{{ $t('funding.noInfluenceTitle') }}</div>
        <div v-for="item in noInfluenceItems" :key="item"
          style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:var(--text2)">
          <span style="color:var(--accent3);font-weight:700">✗</span> {{ item }}
        </div>
      </div>

      <!-- Independence guarantee -->
      <div style="background:rgba(124,111,255,.06);border:.5px solid rgba(124,111,255,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">{{ $t('funding.independenceTitle') }}</div>
        <div style="font-size:14px;color:var(--text2);line-height:1.7">{{ $t('funding.independenceBody') }}</div>
      </div>

      <!-- How to support -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:var(--text)">{{ $t('funding.supportTitle') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:14px">{{ $t('funding.supportBody') }}</div>
        <a href="https://ko-fi.com/voiceprotest" target="_blank"
          style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r2);text-decoration:none;color:var(--text)">
          ☕ Ko-fi — ko-fi.com/voiceprotest
        </a>
      </div>

      <!-- Donation split 90/10 -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:var(--text)">{{ $t('funding.splitTitle') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7">{{ $t('funding.splitBody') }}</div>
      </div>

      <!-- Surplus -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:var(--text)">{{ $t('funding.surplusTitle') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7">{{ $t('funding.surplusBody') }}</div>
      </div>

      <!-- Financial transparency -->
      <div style="margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:var(--text)">{{ $t('funding.transparencyTitle') }}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7">{{ $t('funding.transparencyBody') }}</div>
        <div style="margin-top:8px;padding:8px 10px;background:var(--bg2);border-radius:var(--r);font-size:11px;color:var(--text3);font-style:italic">
          ℹ️ {{ $t('funding.donationsNote') }}
        </div>
      </div>

      <!-- Source code note -->
      <div style="text-align:center;font-size:12px;color:var(--text3);line-height:1.8">
        {{ $t('funding.transparencyNote') }}<br>
        <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" style="color:var(--accent)">github.com/cero-absoluto/vozciudadana</a>
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const costItems = computed(() => [
  { key: 'railway',  name: 'Railway',  role: t('funding.costRailway'),  cost: '~€10/mo' },
  { key: 'supabase', name: 'Supabase', role: t('funding.costSupabase'), cost: 'Free tier' },
  { key: 'twilio',   name: 'Twilio',   role: t('funding.costTwilio'),   cost: '€0.05/SMS' },
  { key: 'resend',   name: 'Resend',   role: t('funding.costResend'),   cost: 'Free tier' },
  { key: 'domain',   name: 'Domain',   role: t('funding.costDomain'),   cost: '~€15/yr' },
]);

const acceptItems = computed(() => [
  t('funding.accept1'),
  t('funding.accept2'),
  t('funding.accept3'),
  t('funding.accept4'),
]);

const noInfluenceItems = computed(() => [
  t('funding.noInfluence1'),
  t('funding.noInfluence2'),
  t('funding.noInfluence3'),
  t('funding.noInfluence4'),
]);

const rejectItems = computed(() => [
  t('funding.reject1'),
  t('funding.reject2'),
  t('funding.reject3'),
  t('funding.reject4'),
  t('funding.reject5'),
  t('funding.reject6'),
]);
</script>

