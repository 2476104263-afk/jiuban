<template>
    <div class="card-container">
        <div class="tool" id="tool">
            <div class="login-wrapper">
                <div class="header">修改资料</div>
                <div class="form-wrapper">
                    <input type="text" class="input-item" name="username" placeholder="修改昵称" maxlength="32" id="set-nickname" @input="handleInput">
                    <!-- <input type="password" class="input-item" name="password" placeholder="password"> -->
                    <div data-animation="ripple" class="btn" id="privacy" role="button" tabindex="0" @keydown.enter="privacy" @click="privacy">{{ hidden ? '显示榜单姓名' : '隐藏榜单姓名' }}</div>
                    <!-- <a data-animation="ripple" id="random">保存图片</a> -->
                    <button class="btn" id="captureButton" :disabled="saving" @click="download">{{ saving ? '正在保存…' : '保存图片' }}</button><p role="status">{{ error }}</p>
                </div>
                <div class="msg">
                    <a>下载</a>海报图片 
                </div>
            </div>
        </div>
        <div class="card-background" id="capture">
            <div class="card">
                <div class="avatar">
                    <img :src="wechatReportData.avatarSrc" alt="Avatar">
                </div>
                <div class="title">
                    <div class="nickname">@{{ wechatReportData.nickname }}</div>
                    <div class="reportname">{{ wechatReportData.reportName }}</div>
                </div>
                <div class="friend">
                    <div>活跃发送者</div>
                    <div v-for="friend in wechatReportData.friends" :key="friend.name">
                        <img :src="friend.avatarSrc" alt="">
                        <span class="friend-name">{{ hidden ? '已隐藏' : friend.name }}</span>
                    </div>
                </div>
                <div class="sum-up">
                    {{ wechatReportData.summaryText }}
                </div>
                <div class="tags">
                    <div class="left">
                        <div v-for="tag in wechatReportData.leftTags" :key="tag.label">
                            <div class="tag-template">{{ tag.label }}</div>
                            <div>
                                <span class="tag-content">{{ tag.value }}</span>
                                <span class="tag-template">{{ tag.unit }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="right">
                        <div v-for="tag in wechatReportData.rightTags" :key="tag.label">
                            <div class="tag-template">{{ tag.label }}</div>
                            <div v-if="tag.image">
                                <img :src="tag.image" alt="Tag Image">
                            </div>
                            <div v-else>
                                <span class="tag-content">{{ tag.value }}</span>
                            </div>
                        </div>
                        
                    </div>
                </div>
                <div class="copyright">
                    
                    <span>Memora · AnnualReport / LC044</span>
                </div>
                <!-- <div class="url">
                    <a :href="wechatReportData.websiteUrl" target="_blank">{{ wechatReportData.websiteUrlText }}</a>
                </div> -->
                <div class="bottom">
                    <div>{{ wechatReportData.bottomText }}</div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import html2canvas from 'html2canvas';
import { wechatReportData, reportData } from '../js/getdata.js';
const hidden = ref(false);
const saving = ref(false);
const error = ref('');
const privacy = () => { hidden.value = !hidden.value; };
const handleInput = (event) => { wechatReportData.nickname = event.target.value.slice(0, 32); };
async function download() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const canvas = await html2canvas(document.getElementById('capture'), { backgroundColor: '#1b2947', scale: 2, onclone: (doc) => {
      doc.querySelectorAll('*').forEach((node) => { node.style.animation = 'none'; node.style.transition = 'none'; });
    } });
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${reportData.year}-年度聊天报告.png`;
    link.click();
  } catch { error.value = '图片保存失败，请重试。'; }
  finally { saving.value = false; }
}
</script>

<style scoped>
.card-container { display: flex; align-items: flex-start; justify-content: center; gap: 24px; padding: 28px 16px; }
.tool { display: block; flex: 0 1 210px; }
.login-wrapper { padding: 20px; border-radius: 16px; background: white; color: #33415d; }
.header { margin-bottom: 16px; font-size: 18px; font-weight: 700; }
.input-item { width: 100%; padding: 10px; border: 1px solid #dbe1ed; border-radius: 8px; box-sizing: border-box; }
.btn { display: block; width: 100%; margin-top: 12px; padding: 10px; border: 0; border-radius: 8px; background: #e8efff; color: #365585; text-align: center; cursor: pointer; font-size: 13px; }
.msg { margin-top: 12px; font-size: 11px; color: #65718a; }
.card-background { width: 360px; max-width: 100%; padding: 16px; border-radius: 20px; background: #1b2947; }
.card { display: flex; flex-direction: column; align-items: flex-start; width: 100%; min-height: 560px; padding: 24px; border-radius: 16px; box-sizing: border-box; color: #fff; background: linear-gradient(155deg, #53648f, #8f658a 55%, #d992a0); }
.avatar { width: 60px; height: 60px; margin-bottom: 16px; }
.avatar img { width: 100%; height: 100%; border-radius: 50%; }
.title { min-width: 0; width: 100%; }
.nickname { font-size: 12px; opacity: .8; overflow-wrap: anywhere; }
.reportname { margin-top: 5px; font-size: 22px; font-weight: 700; }
.friend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; width: 100%; margin-top: 22px; font-size: 11px; }
.friend > div:first-child { width: 100%; opacity: .75; }
.friend img { width: 18px; height: 18px; margin-right: 4px; border-radius: 50%; vertical-align: middle; }
.friend-name { display: inline-block; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.sum-up { margin: 24px 0; font-size: 25px; font-weight: 700; line-height: 1.5; }
.tags { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; width: 100%; }
.tags .left, .tags .right { min-width: 0; }
.tags .left > div, .tags .right > div { margin-bottom: 16px; }
.tag-template { margin-bottom: 4px; font-size: 11px; opacity: .75; }
.tag-content { font-size: 19px; font-weight: 650; overflow-wrap: anywhere; }
.tag-template + div { overflow-wrap: anywhere; }
.copyright { margin-top: auto; padding-top: 18px; font-size: 10px; opacity: .85; }
.bottom { margin-top: 8px; font-size: 9px; line-height: 1.6; opacity: .7; }
@media (max-width: 600px) { .card-container { flex-direction: column; align-items: center; } .tool { flex-basis: auto; width: 100%; } .card-background { padding: 10px; } .card { padding: 18px; } .reportname { font-size: 19px; } .sum-up { font-size: 22px; } }
</style>