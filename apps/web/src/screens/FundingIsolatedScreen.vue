<template>
  <div class="screen"><div class="panel-body" style="padding:24px">
    <h1>{{ t('title') }}</h1><p>{{ t('simulation') }}</p>
    <p>{{ t('policy') }}</p><p>{{ t('antiCapture') }}</p>
    <form @submit.prevent="start">
      <label>{{ t('purpose') }}<select v-model="kind" :disabled="!!session">
        <option value="general">{{ t('general') }}</option><option value="event">{{ t('event') }}</option>
      </select></label>
      <label v-if="kind==='event'">{{ t('eventId') }}<input v-model="eventId" :disabled="!!session" /></label>
      <label>{{ t('phone') }}<input v-model="phone" autocomplete="off" type="tel" :disabled="busy || !!session" /></label>
      <button :disabled="busy || !!session">{{ t('start') }}</button>
    </form>
    <form v-if="challenge && !session" @submit.prevent="verify">
      <label>{{ t('code') }}<input v-model="code" autocomplete="off" inputmode="numeric" maxlength="6" /></label>
      <button :disabled="busy">{{ t('verify') }}</button>
    </form>
    <form v-if="session" @submit.prevent="reserve">
      <p>{{ t('remaining') }}: {{ limits.annualRemainingCents / 100 }} EUR
        <span v-if="limits.eventRemainingCents!==null"> / {{ limits.eventRemainingCents / 100 }} EUR</span></p>
      <label>{{ t('amount') }}<input v-model="amount" inputmode="decimal" /></label>
      <button :disabled="busy">{{ t('reserve') }}</button>
    </form>
    <p v-if="intent" role="status">{{ t('reserved') }}: {{ intent.amountCents/100 }} EUR</p>
    <p v-if="error" role="alert">{{ t('error') }}: {{ error }}</p>
    <button @click="reset" :disabled="busy">{{ t('reset') }}</button>
    <p>{{ t('grants') }}</p>
  </div></div>
</template>
<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
const { t:translate }=useI18n(); const t=key=>translate(`fundingI4.${key}`);
const phone=ref(''),code=ref(''),kind=ref('general'),eventId=ref(''),amount=ref('');
const challenge=ref(''),session=ref(''),intent=ref(null),limits=ref({}),error=ref(''),busy=ref(false);
const api=import.meta.env.VITE_I4_ISOLATED_API || '';
// No production API or provider fallback; compile-time opt-in and loopback only.
const allowed=import.meta.env.VITE_I4_ISOLATED==='true' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api);
async function request(path,body) {
  if(!allowed) throw new Error('isolated_only');
  const r=await fetch(`${api}/api/funding${path}`,{method:body?'POST':'GET',credentials:'omit',
    headers:{'Content-Type':'application/json',...(session.value?{'X-Funding-Session':session.value}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok) throw new Error(result.error || 'funding_operation_failed');return result;
}
async function run(fn){busy.value=true;error.value='';try{await fn();}catch(e){error.value=e.message;}finally{busy.value=false;}}
const start=()=>run(async()=>{
  const value=phone.value;phone.value='';
  const r=await request('/otp/start',{phone:value,eventId:kind.value==='event'?eventId.value:null});challenge.value=r.challengeId;
});
const verify=()=>run(async()=>{const value=code.value;code.value='';const r=await request('/otp/verify',{challengeId:challenge.value,code:value});session.value=r.session;limits.value=await request('/limits');});
const reserve=()=>run(async()=>{
  if(!/^\d{1,4}(\.\d{1,2})?$/.test(amount.value)) throw new Error('invalid_amount');
  const [euros,cents='']=amount.value.split('.');const amountCents=Number(euros)*100+Number(cents.padEnd(2,'0'));
  intent.value=await request('/intents',{kind:kind.value,amountCents,currency:'EUR'});limits.value=await request('/limits');
});
function reset(){phone.value='';code.value='';challenge.value='';session.value='';intent.value=null;limits.value={};error.value='';}
</script>
