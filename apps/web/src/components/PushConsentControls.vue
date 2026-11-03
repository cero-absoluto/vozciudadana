<template><section class="push-consent-controls" /></template>
<script setup>
defineProps({ state: { type: String, default: 'loading' }, pending: Boolean, canManage: Boolean });
defineEmits(['enable', 'revoke', 'refresh']);
</script>
