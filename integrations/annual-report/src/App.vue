<template>
  <StarrySky :total-stars="120" />
  <div v-if="!ready" class="waiting" role="status">正在等待导入的聊天数据…</div>
  <template v-else>
    <nav class="report-nav" aria-label="年度报告章节">
      <button v-for="(page, index) in pages" :key="page.label" :class="{ active: current === index }" :aria-current="current === index ? 'page' : undefined" @click="current = index">{{ page.label }}</button>
    </nav>
    <main id="report-stage" :key="revision">
      <component :is="pages[current].component" :key="current" />
    </main>
    <footer class="report-footer">
      <button :disabled="current === 0" @click="current--">上一页</button>
      <span>{{ current + 1 }} / {{ pages.length }}</span>
      <button :disabled="current === pages.length - 1" @click="current++">下一页</button>
    </footer>
  </template>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Welcome from './compoents/Welcome.vue';
import ChatData from './compoents/ChatData.vue';
import TimePeriod from './compoents/TimePeriod.vue';
import Keyword from './compoents/Keyword.vue';
import Friends from './compoents/Friends.vue';
import Card from './compoents/Card.vue';
import StarrySky from './compoents/Starry-sky.vue';
import { applyReport } from './js/getdata.js';

const pages = [ { label: '序言', component: Welcome }, { label: '消息统计', component: ChatData }, { label: '聊天时段', component: TimePeriod }, { label: '高频词', component: Keyword }, { label: '发送者', component: Friends }, { label: '纪念卡片', component: Card } ];
const ready = ref(false);
const current = ref(0);
const revision = ref(0);
function receive(event) {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'jiuban-annual-report:data') return;
  const data = event.data.report;
  if (data?.format !== 'jiuban-annual-report' || data.version !== 1 || !Array.isArray(data.hourly) || !Array.isArray(data.words)) return;
  applyReport(data);
  current.value = 0;
  revision.value += 1;
  ready.value = true;
}
onMounted(() => {
  window.addEventListener('message', receive);
  window.parent.postMessage({ type: 'jiuban-annual-report:ready' }, location.origin);
});
onBeforeUnmount(() => window.removeEventListener('message', receive));
</script>

<style>
* { box-sizing: border-box; }
html, body { margin: 0; min-width: 0; color: white; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
button { font: inherit; cursor: pointer; }
.report-nav { position: sticky; top: 0; z-index: 10; display: flex; justify-content: center; gap: 4px; padding: 14px 10px; background: #1b2947e8; overflow-x: auto; }
.report-nav button, .report-footer button { flex: none; padding: 8px 12px; border: 1px solid #ffffff30; border-radius: 8px; background: transparent; color: #dce8ff; font-size: 12px; }
.report-nav .active { background: #ffffff20; color: white; border-color: #b6faff; }
.report-footer { position: sticky; bottom: 0; z-index: 10; display: flex; justify-content: center; align-items: center; gap: 20px; padding: 12px; background: #1b2947e8; font-size: 12px; }
.report-footer button:disabled { opacity: .35; cursor: default; }
#report-stage { min-height: calc(100dvh - 122px); }
#report-stage > * { min-height: calc(100dvh - 122px); height: auto; padding-top: 32px; padding-bottom: 32px; }
#report-stage .message { max-width: 740px; width: 84%; }
#report-stage .message-container { align-items: center; }
#report-stage .description { width: 100%; height: auto; min-height: 220px; }
#report-stage .description .content { position: static; transform: none; padding: 24px; }
#report-stage .description .text { width: 100%; }
#report-stage .description p { line-height: 1.8; }
#report-stage .logo { width: auto; }
#report-stage .stat-container { position: relative; overflow: hidden; }
#report-stage .box { width: min(88%, 600px); height: auto; }
#report-stage .stat-container .tag-title { font-size: 17px; margin: 0; }
#report-stage .stat-container .tag-content { font-size: 30px; }
#report-stage .stat-container .tag-unit { font-size: 15px; }
#report-stage .chart-container .chart { width: 88%; height: 240px; margin: 8px 0 28px; }
#report-stage .chart-container .desc { width: min(84%, 650px); }
#report-stage .sum-up { overflow-wrap: anywhere; }
#report-stage .chart-container .sum-up { font-size: clamp(26px, 4vw, 42px); }
#report-stage .ripple-container { display: flex; flex-direction: column; align-items: center; }
#report-stage .ripple-container .title { position: static; margin: 0; text-align: center; }
#report-stage .ripple-container .chart { width: 94%; height: 350px; }
#report-stage .ripple-container .keyword { font-size: 40px; }
#report-stage .box-container .box1, #report-stage .box-container .box2 { width: min(86%, 700px); height: auto; }
#report-stage .box-container h1 { font-size: 22px; }
#report-stage .box-container .name { max-width: 240px; overflow-wrap: anywhere; }
#report-stage .card-container { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 22px; }
#report-stage .tool { height: auto; margin: 0; animation: none; }
#report-stage .login-wrapper { position: static; transform: none; width: 210px; height: auto; padding: 20px; }
#report-stage .login-wrapper .header { line-height: 2; font-size: 19px; }
#report-stage .login-wrapper .form-wrapper .btn { margin-top: 16px; border: 0; border-radius: 6px; padding: 10px; }
#report-stage .login-wrapper .msg { line-height: 3; font-size: 12px; }
#report-stage .card-background { height: auto; margin: 0; }
#report-stage .copyright { overflow-wrap: anywhere; }
#report-stage .friend-name { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.waiting { display: grid; min-height: 100dvh; place-items: center; }
@media (max-width: 600px) {
  .report-nav { justify-content: flex-start; }
  .report-nav button { padding: 8px; font-size: 11px; }
  #report-stage .description .content { padding: 16px; }
  #report-stage .message { width: 90%; }
  #report-stage .name { max-width: 220px; overflow-wrap: anywhere; }
  #report-stage .ripple-container .chart { height: 300px; }
  #report-stage .card-container { gap: 20px; }
  #report-stage .tool { width: 90%; }
  #report-stage .login-wrapper { width: 100%; }
  #report-stage .card-background { max-width: 96%; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
