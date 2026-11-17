<template>
    <div class="ripple-container">
        <div class="title">
            <div class="des">
                {{ reportData.year }}
            </div>
            <div class="des">
                这份记录中出现最多的词是
            </div>
            <br>
            <div class="keyword">{{ keywordsData.keyword }}
            </div>
            <div class="footer">
                <div class="keyword_num">
                    {{ keywordsData.keyword_num }}次
                </div>
            </div>
        </div>
        <div id="charts-content" class="chart"></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { keywordsData, reportData } from '../js/getdata.js';
import * as echarts from 'echarts';
import 'echarts-wordcloud';
let chart;
let observer;
onMounted(() => {
  const node = document.getElementById('charts-content');
  chart = echarts.init(node);
  const colors = ['#fff3bc', '#b6faff', '#d2cdff', '#cfffbd', '#ffd0d0', '#b9dfff'];
  chart.setOption({ tooltip: { renderMode: 'richText' }, series: [{ type: 'wordCloud', gridSize: 12, sizeRange: [14, 52], rotationRange: [-20, 20],
    data: keywordsData.word_counter.map(([name, value], index) => ({ name, value, textStyle: { color: colors[index % colors.length] } })) }] });
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(node);
});
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>


<style scoped>
.chart {
    width: 800px;
    height: 800px;
    margin: 0;
}
.bestsellers-container {
    height: 18.56rem;
    background: #f0f0f0;

    #charts-content {
        /* 需要设置宽高后才会显示 */
        width: 100%;
        height: 100%;
    }
}



@keyframes fadeIn {
    0% {
        opacity: 0;
        transform: scale(0.8);
    }

    100% {
        opacity: 1;
        transform: scale(1);
    }
}

.ripple-container {
    position: fixed;
    right: 0;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    animation: fadeIn 1s;
}

.title {
    color: white;
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 300px;
    /* height: 40vh; */
}

.title .des {
    font-size: 24px;
    font-weight: bold;
    font-family: sans-serif;
}

.title .keyword {
    font-size: 86px;
    font-family: 黑体;
    font-weight: bold;
    background: linear-gradient(to right, #fffdd0, #d8efff); /* 渐变背景 */
    -webkit-background-clip: text; /* 仅在文字上显示背景 */
    -webkit-text-fill-color: transparent; /* 使文字填充颜色透明 */
}

.title .footer {
    width: 300px;
}

.title .footer .keyword_num {
    font-size: 30px;
    font-weight: bold;
    font-family: sans-serif;
    display: flex;
    justify-content: flex-end;
    background: linear-gradient(to right, #d8ddff, #feb47b, #ddffc2); /* 渐变背景 */
    -webkit-background-clip: text; /* 仅在文字上显示背景 */
    -webkit-text-fill-color: transparent; /* 使文字填充颜色透明 */
}

@media screen and (max-width: 768px) {
    .title {
        width: 300px;
        /* height: 40vh; */
    }

    .title .footer {
        width: 300px;
    }

}


.message-box {
    display: flex;
    align-items: center;
    flex-direction: column;
    width: 40vw;
    height: 60vh;
}


.bubble {
    white-space: pre-wrap;
    padding: 10px 11px;
    border-radius: 5px;
    color: #1f1f1f;
    font-size: 14px;
    max-width: 400px;
    position: relative;
    word-wrap: break-word;
    word-break: normal;
}

.item-left .bubble {
    margin-left: 15px;
    background-color: rgba(255, 255, 255, 0.1);
}

.item-left .bubble:before,
.item-right .bubble:before {
    content: "";
    position: absolute;
    width: 0;
    height: 0;
    border-top: 10px solid transparent;
    border-bottom: 10px solid transparent
}

.item-left .bubble:before {
    left: -20px;
    border-left: 10px solid transparent;
    border-right: 10px solid #fff;
    opacity: 0.1;
}

.item-right .bubble {
    margin-right: 15px;
    background-color: rgba(169, 250, 115, 0.4);
}

.item-right .bubble:before {
    border-left: 10px solid #a9fa73;
    border-right: 10px solid transparent;
    right: -20px;
    opacity: 0.4;
}



.item {
    margin-top: 15px;
    display: flex;
    width: 100%;
}

.item-refer {
    margin-top: 4px;
}

.item.item-right {
    justify-content: flex-end;
}

.item.item-center {
    justify-content: center;
}

.item.item-center span {
    font-size: 12px;
    padding: 2px 4px;
    color: #fff;
    background-color: #dadada;
    border-radius: 3px;
    -moz-user-select: none;
    /*火狐*/
    -webkit-user-select: none;
    /*webkit浏览器*/
    -ms-user-select: none;
    /*IE10*/
    -khtml-user-select: none;
    /*早期浏览器*/
    user-select: none;
}

.content-wrapper {
    display: flex;
    flex-direction: column;
    max-width: 80%;
}

.content-wrapper-left {
    align-items: baseline;
}

.content-wrapper-right {
    align-items: flex-end;
}

.displayname {
    margin-left: 13px;
    margin-left: 13px;
    font-size: 13px;
    margin-bottom: 5px;
    color: darkgray;
}

.chat-image img,
.chat-file img {
    margin-right: 18px;
    margin-left: 18px;
    max-width: 300px;
    /*max-height: auto;*/
}

.avatar img {
    width: 42px;
    height: 42px;
    border-radius: 3px;
    user-select: none;
}

@media screen and (max-width: 768px) {
    .message-box {
        width: 80vw;
        height: 60vh;
    }

    .bubble {
        max-width: 280px;
    }

    .item-right .bubble {
        margin-right: 8px;
    }

    .item-left .bubble {
        margin-left: 8px;
    }
    .chart {
        width: 100%;
        height: 100%;
        margin: 0;
    }
    .item-left .bubble:before {
        content: "";
        position: absolute;
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-top: 8px solid transparent;
        border-right: 8px solid #fff;
        border-bottom: 8px solid transparent;
        left: -16px;
    }

    .item-right .bubble:before {
        content: "";
        position: absolute;
        width: 0;
        height: 0;
        border-left: 8px solid #9eea6a;
        border-top: 8px solid transparent;
        border-right: 8px solid transparent;
        border-bottom: 8px solid transparent;
        right: -16px;
    }
    .title .keyword {
        font-size: 66px;
    }
    .title .footer .keyword_num {
        font-size: 24px;
    }
    .title .des {
        font-size: 20px;
        font-weight: bold;
        font-family: sans-serif;
    }
}
</style>