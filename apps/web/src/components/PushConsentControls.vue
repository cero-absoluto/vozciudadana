<template>
  <section ref="section" class="push-consent-controls" aria-labelledby="push-consent-title" :aria-busy="pending">
    <h3 id="push-consent-title">{{ $t('verify.pushControlsTitle') }}</h3>
    <p id="push-consent-scope">{{ $t('verify.pushScope') }}</p>
    <p ref="status" id="push-consent-state" tabindex="-1" :role="isError ? 'alert' : 'status'" :aria-live="isError ? 'assertive' : 'polite'">{{ $t(caption) }}</p>
    <p v-if="actions.includes('revoke')" id="push-consent-queued">{{ $t('verify.pushQueued') }}</p>
    <button v-for="action in actions" :key="action" type="button" :disabled="pending || !canManage || state === 'loading'"
      :aria-describedby="[props.informationId,'push-consent-scope','push-consent-state', action === 'revoke' ? 'push-consent-queued' : null].filter(Boolean).join(' ')" @click="act(action)">
      {{ $t('verify.push' + action.charAt(0).toUpperCase() + action.slice(1)) }}
    </button>
  </section>
</template>
<script setup>
import {computed, nextTick, ref, watch} from 'vue';
const props = defineProps({state:{type:String,default:'loading'},pending:Boolean,canManage:Boolean,informationId:{type:String,default:null}});
const emit = defineEmits(['enable','revoke','refresh']);
const section=ref(null),status=ref(null);
const keys={loading:'pushLoading',enabled:'pushEnabled',disabled:'pushDisabled',repair:'pushRepair',error:'pushError',uncertain:'pushUncertain',unavailable:'pushUnavailable'};
const caption=computed(()=>'verify.'+(props.pending?'pushLoading':keys[props.state]||'pushUnavailable'));
const isError=computed(()=>!props.pending&&['error','uncertain'].includes(props.state));
const actions=computed(()=>!props.canManage?[]:({loading:[],enabled:['revoke'],disabled:['enable'],repair:['enable','revoke'],error:['refresh','revoke'],uncertain:['refresh','revoke'],unavailable:['refresh']}[props.state]||[]));
function act(action){if(props.canManage&&!props.pending&&props.state!=='loading'&&actions.value.includes(action))emit(action);}
watch(()=>[props.state,props.pending,props.canManage],async()=>{
  if(typeof document==='undefined')return;
  const active=document.activeElement;
  if(!section.value?.contains(active))return;
  await nextTick();
  if(document.activeElement!==active&&document.activeElement!==document.body)return;
  if(!active?.isConnected||active.disabled)status.value?.focus();
});
</script>
<style scoped>
.push-consent-controls{width:100%;margin:12px 0;overflow-wrap:anywhere}
h3,p{margin:0 0 10px;line-height:1.5}h3{font-size:15px}p{font-size:13px;color:var(--text2)}
button{display:block;width:100%;min-height:44px;margin:8px 0;padding:12px;border:1px solid var(--border2);border-radius:var(--r);background:var(--bg2);color:var(--text);font:inherit;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
button:disabled{opacity:.6;cursor:default}button:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
</style>
