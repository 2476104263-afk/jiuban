# Memora · Apple HIG 界面适配

采用日期：2026-11-17；应用版本：1.17.0。

本次在现有 HTML、CSS 与 ES Modules 中实现 Apple HIG 的布局、层级与交互原则，参照 SwiftUI 的分栏与紧凑导航模式。原生 SwiftUI 的系统组件及材质渲染仍属于原生应用环境，本项目交付的是 Web 适配。

## 官方依据

| Apple 官方资料 | 本项目的对应实现 |
| --- | --- |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 清晰分组、稳定留白、统一边距；复杂操作逐步展开；小屏预留安全区域。 |
| [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | 桌面侧栏分为陪伴、我的记忆、人物与世界；图标与文字同时出现；可收起侧栏。 |
| [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 紧凑窗口显示五个有文字标签的底部导航入口；设置与个人资料留在顶部；模块各自保留界面状态与访问路径。 |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 玻璃用于侧栏、工具栏、输入控件等交互层；阅读卡片使用标准表面，正文不参与折射。 |
| [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | 常用按钮具备清楚的主次关系、按压状态和焦点样式；主要触控命中区域至少 44 CSS px。Web 的 CSS px 与原生 pt 并非同一计量或平台认证。 |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 使用本机系统字体，统一标题、正文、注释的大小与字重；小屏输入框使用 16px 字号。 |
| [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview) | 宽窗口显示导航与内容两栏，紧凑窗口保留单一内容区；世界内部按可用宽度调整分栏。 |

## 信息结构

- **对话**：顶部保留连接与对话设置。表达状态、语言风格和人格设置放入可滚动面板；导出与清空进入“更多”操作。
- **记忆中心**：统一页面标题与分段导航，提供记忆、聊天导入、服务连接；记忆页内切换记忆管理与决策复盘。
- **记忆管理**：先呈现记忆列表和搜索。新增、备份管理、云图与存储概览按需展开；清空记忆仍需确认。
- **聊天导入**：先选择导出文件或微信数据库，两个入口独立保留输入；共享预览、选择与保存结果。导入后才出现年度报告入口。
- **人物档案**：保留档案封面网格与“新建空白”大卡片，详情和编辑维持二级路径。
- **日记与平行世界**：使用相同标题、表单、卡片和工具尺寸；窄窗口将次要面板排在主要内容之后。

## 导航与输入状态

顶层页面缓存数量有界，每个模块仅保留一份挂载节点。切换模块时隐藏节点，不重建表单；再次选择模块时恢复上次路径。对话、导入文件、筛选、报告、复盘输入等因此可以继续处理。

记忆列表在重新激活时从 IndexedDB 刷新，并保留未提交的新增输入；导入与复盘确认产生的新记忆也会显示。页面加载以模块独立挂载，较慢的加载完成后不会替换当前模块。

## 可访问性

- 主导航和二级导航具有可读标签及选中状态。
- 原生 disclosure 用于更多操作，支持键盘打开；Escape 关闭，点击外部收起。
- 弹窗保留焦点循环，关闭后恢复到触发控件；手机使用底部面板，正文单独滚动。
- 继续响应减少动效、减少透明度、提高对比度和强制颜色偏好。
- 聊天记录、人物、世界、设置和记忆继续使用既有数据键；本次没有重置或迁移用户内容。

主要文件：`assets/css/apple-layout.css`、`assets/js/navigation.js`、`assets/js/app.js`、`assets/js/memory-hub-view.js`。
