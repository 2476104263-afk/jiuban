# Memora 液态玻璃方案

采用日期：2026-11-17。

## GitHub 调研

| 项目 | 核实内容 | 在 Memora 中的取舍 |
| --- | --- | --- |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) | README 和 `src/index.tsx`：独立背景层、SVG 位移、色差、可调模糊、鼠标高光与弹性；README 说明 Safari / Firefox 的位移效果有限。MIT 授权。 | 采用背景与正文分层、细亮边缘、随指针移动的高光思路，保留原生 ES Modules。 |
| [ozcanyldzhn/liquid-glass.js](https://github.com/ozcanyldzhn/liquid-glass.js) | README：原生 Web Components、SVG / WebGL 折射、曲率与材质参数、拖动；LICENSE 为 MIT。 | 借鉴材质分级与渐进增强思路；现有卡片、表单、路由继续使用原来的 DOM。 |
| [Mael-667/Liquid-Glass-CSS](https://github.com/Mael-667/Liquid-Glass-CSS) | README：CSS / JS 版本、SVG 位移和动态色调。 | 作为补充对照，没有引入其代码或组件。 |

上述仓库提供视觉与实现方向参考。本次 CSS、指针高光和轻微装饰折射均为项目内独立实现，没有安装或复制这些库，不依赖 CDN、外部图片、屏幕截图或 WebGL 常驻渲染。

## 材质与范围

- 背景：静态淡蓝、淡紫与青色柔光，让透明面板后面有可感知的色彩。
- 导航：圆形玻璃按钮，选中态使用蓝色细边与浅色背景；对话入口为 `fill="none"` 的圆环与记忆双环线稿。
- 交互表面：侧栏、聊天工具栏、输入控件、弹窗和表情面板使用背景模糊、饱和度、半透明底色和内侧高光。数据卡片使用标准表面，具体布局遵循 [Apple HIG 界面适配](apple-interface-design.md)。
- 动态高光：仅作用于导航、工具栏与主要按钮，并只在支持精细指针、允许动效和透明效果的环境运行。事件委托覆盖后续挂载的页面，每个动画帧最多更新一个目标。
- 折射：桌面 Chromium 在聊天头部与输入框的装饰边缘增强 3px SVG 位移。正文不受 SVG 变形。其他环境使用相同的 CSS 亮边与模糊材质。
- 长列表：消息、记忆证据与成员列表使用静态亮边，不为每一行创建背景模糊层。
- 年报：保留星空设计，导航与页脚使用深色玻璃材质，说明面板保持高不透明度。

## 可访问性与回退

- 正文使用深色，重要按钮保留白字蓝底，警告保持明确色彩。
- 键盘焦点使用可见外轮廓，装饰层不接收点击。
- `prefers-reduced-motion` 停止高光追踪和位移动画；`prefers-reduced-transparency` 关闭模糊并提高表面不透明度。
- 不支持背景模糊时使用浅色实体表面。小屏减少模糊量，并关闭主要卡片的模糊。
- 无定时动画循环、无页面截图和网络请求；界面更改不涉及聊天、人物、记忆或世界数据。

主要文件：`assets/css/liquid-glass.css`、`assets/js/liquid-glass.js`、`integrations/annual-report/src/glass.css`。
