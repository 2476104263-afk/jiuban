# AnnualReport 接入

本目录将 [LC044/AnnualReport](https://github.com/LC044/AnnualReport) 的 `report-2024/single` 模板接入Memora「记忆中心 → 导入聊天记录」。上游版本固定为 `2a70d2ed221d6ce0c1c5a2b7543982a7edad703e`，保留其 MIT 授权和版权声明。

## 使用

选择聊天记录文件后，在「年度聊天报告」选择年份及可选的发送者身份，再点击「生成年度报告」。报告包含序言、消息统计、聊天时段、高频词、活跃发送者与可保存 PNG 的纪念卡片；也可导出统计 JSON。

- 统计当前文件的全部文本记录，不跟随消息列表筛选或勾选；按本机时区归年，缺少有效日期的记录单独提示并排除。
- 不把发送者数当作微信好友数；未选择本人身份时不推断发送/接收关系。
- 高频词使用浏览器 `Intl.Segmenter`，排除部分停用词后按出现次数排序；它不是情绪分析。
- 上游演示数据、随机步数、情绪文案、外部头像与字体均未纳入；报告中不展示未由导入数据支持的事实。
- 统计在本地 Worker 中进行。报告只接收聚合统计，不接收原始消息；原项目的网络请求已移除，报告页面禁止网络 API 请求，不加载外部资源。用户主动点击的上游项目链接除外。
- 生成报告不会把聊天内容自动写入长期记忆，原有逐条选择并保存证据的流程保持可用。

## 本地构建

预构建文件已包含在 `assets/vendor/annual-report/`，网页与桌面应用不需要额外启动服务，也不改变主项目的无构建运行方式。

需要修改报告模板时，在仓库根目录执行（Node.js 20.11+）：

```sh
npm ci --prefix integrations/annual-report --ignore-scripts
npm run build --prefix integrations/annual-report
node --test integrations/annual-report/test/analytics.test.mjs
```

生产依赖只属于这个独立目录。构建前会生成上游与依赖授权声明，随报告一起发布。`src/compoents/` 保留上游目录拼写；对 Vue 组件的修改主要是移除示例数据、接入实际统计、补充生命周期清理和适配嵌入布局。主项目通过同源 iframe 与 `postMessage` 传递统计结果，并验证消息来源窗口。

`assets/js/annual-report.js` 定义统计规则，`annual-report-worker.js` 负责后台计算，`annual-report-view.js` 负责导入页控件与报告生命周期。
