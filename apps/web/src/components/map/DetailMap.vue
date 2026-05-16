<template>
  <div class="detail-map">
    <canvas ref="canvasEl"></canvas>
    <div class="d-hud">
      <div class="hud-pill"><div class="pulse" style="background:var(--accent3)"></div>En curso</div>
      <div class="hud-pill">👥 {{ fmt(participantCount) }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { fmt } from '@/constants.js';

const props = defineProps({
  participantCount: { type: Number, default: 0 },
  joined:           { type: Boolean, default: false },
});

const canvasEl = ref(null);
let ctx, parts = [], raf, W = 0, H = 0;

function mkP(isMe) {
  const rings = [32, 54, 78, 102, 124];
  const r = rings[Math.floor(Math.random() * rings.length)];
  return {
    r: r + (isMe ? 0 : (Math.random() - 0.5) * 11),
    angle: Math.random() * Math.PI * 2,
    speed: (Math.random() * 0.0004 + 0.0001) * (Math.random() < 0.5 ? 1 : -1),
    size: isMe ? 6 : (Math.random() * 2 + 1.3),
    op: isMe ? 1 : (Math.random() * 0.55 + 0.45),
    isMe,
  };
}

function initParticles() {
 parts = [];
  if ((props.participantCount ?? 0) === 0 && !props.joined) return;
  const n = Math.min(props.participantCount ?? 0, 260);
  for (let i = 0; i < n; i++) parts.push(mkP(false));
  if (props.joined) parts.push(mkP(true));
}

function drawFrame() {
  if (!ctx) return;
  const cx = W / 2, cy = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);

  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.strokeStyle = 'rgba(124,111,255,.025)'; ctx.lineWidth = 1; ctx.stroke(); }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.strokeStyle = 'rgba(124,111,255,.025)'; ctx.lineWidth = 1; ctx.stroke(); }

  [32, 54, 78, 102, 124].forEach((r, i) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(124,111,255,${0.018 - i * 0.002})`; ctx.fill();
    ctx.strokeStyle = `rgba(124,111,255,${0.09 - i * 0.014})`; ctx.lineWidth = 0.5; ctx.stroke();
  });

  parts.forEach(p => {
    p.angle += p.speed;
    const x = cx + Math.cos(p.angle) * p.r, y = cy + Math.sin(p.angle) * p.r;
    if (p.isMe) {
      ctx.beginPath(); ctx.arc(x, y, p.size + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,107,107,.12)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fillStyle = '#FF6B6B'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fillStyle = `rgba(76,255,164,${p.op})`; ctx.fill();
    }
  });

  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fillStyle = 'rgba(124,111,255,.18)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fillStyle = '#7C6FFF'; ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚑', cx, cy);

  raf = requestAnimationFrame(drawFrame);
}

onMounted(() => {
  const c = canvasEl.value;
  ctx = c.getContext('2d');
  W = c.width  = c.parentElement.clientWidth;
  H = c.height = 268;
  initParticles();
  drawFrame();

  const handleVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      drawFrame();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  c._visibilityHandler = handleVisibility;
});

watch(() => [props.participantCount, props.joined], () => {
  initParticles();
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  if (canvasEl.value?._visibilityHandler) {
    document.removeEventListener('visibilitychange', canvasEl.value._visibilityHandler);
  }
});
</script>
