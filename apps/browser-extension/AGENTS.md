# Browser Extension 项目规范

根 AGENTS.md 和代码开发规范适用。[Browser](../../docs/architecture/executor-browser.md) 维护当前协议与恢复契约，[验证矩阵](../../docs/architecture/executor-validation.md) 维护覆盖与待办，用户操作见 [INSTALLATION.md](INSTALLATION.md)，商店账号、ZIP、实际 ID 适配、审核与更新见[发布 SOP](RELEASE.md)。本文件只维护规则，不追加阶段进度。

## 职责与不变量

- 独立 WXT/MV3 扩展支持 Chrome/Edge，固定 PageController 只做有限页面控制，不引入 PageAgent/Agent Loop、任意脚本或网页控制入口。
- Worker 连接固定 Native Host，协议进入 packages/shared，不导入 Executor 实现。Host 持有桥接凭据，扩展/页面/popup 不持有 Runtime Bearer。
- 只声明 nativeMessaging、storage、alarms、scripting 和截图 API 必需的 <all_urls> 权限；内容脚本、路由和操作仍只接受授权的 HTTP/HTTPS 页面，不预先申请 debugger/cookies/externally_connectable。
- 只顶层 ISOLATED world 静态注入，Controller 懒初始化；静态/补注入共用一个接收器。无副作用探测明确缺少接收器且再次确认权限后才补注入一次固定脚本，动作失败不补注入/重放。
- 协议版本 3，单 JSON 不超过 256 KiB。源端分页绑定连接、tab、documentId、controllerId、snapshotId 和页号，旧引用不重建，旧 tab ID 不映射替换目标。
- 单层同源 frame/open shadow roots 有界准入与文档身份检查；跨域/嵌套 frame 无闭环时拒绝。同文档 DOM 变化使用上游已索引的真实元素引用；不再自行把任意 DOM 变化作为整份快照失效条件。
- 页面提取、元素索引、遮罩彩屏、指针与高亮直接使用固定 PageController 公开 API 和默认行为，不另建 DOM MutationObserver 或输入拦截。仅显式启用 enableMask，页面提取范围和属性使用上游默认配置；第一次观察时 showMask，任务内复用 Controller，观察及思考间隙不 hideMask，单次动作不 dispose；任务结束、连接暂停/断开和内容脚本失效时释放原生资源。连接/任务/文档身份与 TTL、分页、限额、敏感字段投影仍由桥接层管理，不修改上游实现。
- 连接、监听、计时器归所属生命周期，旧回调不改新状态。重连只恢复连接、不重放；用户暂停持久后不能自动恢复。
- popup 命令只接受本扩展 popup.html，在线依据当前 Worker 握手而非旧 storage connected 标签；只提供连接管理，不拥有后台连接或页面执行权。
- manifest.icons/action.default_icon 的 16/32/48/128 PNG 和许可随两产物交付，不自动固定工具栏。浅深色/reduced-motion 保留，不改共享 shadcn 源组件。
- public key 只稳定侧载 ID，不证明商店或密码学身份。
- 任意脚本执行明确关闭：当前 MV3 ISOLATED 内容脚本受浏览器 CSP 限制，不为此新增 debugger/userScripts 或切换执行环境。用户明确批准通过最小 pnpm patch 移除未使用的 executeJavascript 方法及其类型声明，使发布产物不再包含该方法或 eval；不通过隐藏告警代替移除代码。

- browser_snapshot 默认激活目标标签页并附带 JPEG 视口截图；screenshot=false 只观察 DOM。截图绑定同一 document/controller/snapshot，切页、文档变化或出现未遮蔽敏感元素时拒绝；敏感标记和密码控件临时遮蔽并在 finally/reset/dispose 恢复；不返回其他标签页图片。图像不超过 128 KiB，边长不超过 1280，Native 单帧仍不超过 256 KiB。

## Browser Use 上游优先原则

- Browser Use 尽量全部使用上游 PageController 提供的公开功能与合理默认行为，包括页面快照、DOM 提取、元素索引、点击/输入/选择/滚动、遮罩彩屏、鼠标指针和高亮；上游已提供的能力不自行重复开发，不为统一接口另建一套页面控制实现。
- 新增逻辑前先核对固定版本的上游 API 和默认配置。适配层仅承担上游未提供且产品确实需要的任务/连接/文档身份、MCP 协议转换、分页限额和敏感内容投影；配置覆盖或额外封装必须有明确需求，不能以预防性设计代替依据。
- 代码以精简、清晰、优雅为目标：减少重复配置、重复校验、额外状态、定时器和无职责转发，保持流程直观、职责内聚。不通过机械拆文件或把复杂度转移到工具层制造精简；删除代码也必须保留必要的协议、安全边界和生命周期契约，并用相关回归验证行为。

## 第三方依赖修改原则

- 默认使用未经修改的上游依赖，优先公开 API、配置与合理默认行为；需求不匹配时先调整或简化自身适配层，不为视觉偏好、预防性修复或未使用的能力修改依赖。
- 只有可复现、阻塞当前核心功能、且公开 API 与自身适配均无法解决的问题，才考虑补丁；必须记录复现证据、替代方案、最小修改范围、回归验证和移除条件。不能把推测风险当作已证实的阻塞。
- 确有必要的补丁只能使用 pnpm patch/patch-commit，并由 patchedDependencies 与锁文件绑定；禁止构建时字符串替换、自制补丁引擎、运行时修改第三方实现或直接修改 node_modules。升级时重新评估，不自动沿用。

- 当前明确批准的例外仅为移除 PageController.executeJavascript：补丁不修改遮罩、高亮或其他行为。上游提供不含该实现的可用入口/版本后重新评估并移除补丁，不扩展为其他定制。

## 构建与交付规则

- scripts 根目录放 package.json 可调用的 .mjs 工程入口；单个入口不另建分类目录，多个相关文件才按职责分目录，lib 放辅助模块，使用 node 直接执行；纯 JavaScript 辅助模块归 scripts/lib，不作为独立命令入口。依赖补丁由 pnpm 安装阶段应用；scripts 不包含运行时行为补丁或自制补丁引擎。

- 从仓库根目录执行包命令，先成功构建 shared，再执行插件 build；构建步骤见[开发指南](../../README.dev.zh-CN.md#浏览器插件构建)，ZIP、商店身份与提交流程见[发布 SOP](RELEASE.md)。本文件保留约束，不复制操作教程。
- build 必须完成 Chrome/Edge 两个 WXT 目标及依赖许可证，输出为 .output/chrome-mv3 与 .output/edge-mv3。只压缩完整成功产物，不绕过许可证步骤或混入旧文件。
- 商店上传 ZIP 的 manifest 禁止包含 key，包括首次创建条目的草稿。从侧载构建制作草稿时，仅在独立归档副本去掉 manifest.key 和构建专用 browser-identity.json，其余运行资源与许可保持一致；不修改 .output 的侧载身份，不用草稿证明正式 Host 就绪。压缩后检查 ZIP 内实际 manifest。
- 独立 ZIP 默认留存在本项目 release/<version>-<UUID>/，草稿目录可标记 draft；避开 .output，避免构建清理已提交产物，不覆盖既有归档。.output/.wxt/release 及临时发布材料不提交。
- 插件兼容更新可独立构建、发布和安装，无需重建 Executor。仅在分发新的客户端内置插件副本时重新打包 Executor；不把源码或独立商店更新当作既有包内副本已更新。
- browser-identity.json 是侧载公钥/ID 与两个商店 ID 的唯一来源，所有模式均要求完整有效的官方身份。scripts/lib/browser-identity.mjs 由普通 Node 解析，不支持身份环境覆盖或缺失身份回退。只有插件 profile 按进程变量 → 根 .env → sideload 解析，并在 .env.example 说明；客户端不读取 .env。store manifest 不携带侧载 key，不向 Worker/PageController 注入运行时身份开关。
- 两个 WXT 目标输出独立的 browser-identity.json 产物记录，包含 identity、profile、protocolVersion、extensionVersion。identity 指纹只绑定稳定策略；客户端按各目标实际渠道身份和协议判断兼容，不要求插件记录与客户端完整指纹相同。变更客户端允许的身份时重建客户端；改变插件模式或兼容版本时只重建插件。配置与迁移步骤由[发布 SOP](RELEASE.md#33-配置身份并重新构建)维护。
- public key 不代替商店实际 ID；正式发行需核对 Chrome/Edge 实际安装身份、配套 Host 全部来源校验及注册迁移，不放宽到任意来源。审核与商店安装验收按实际结果记录，侧载不能冒充商店发布。

## 验证规则

- 按范围先 build，再 lint/typecheck/test；popup 集成验证使用专属环境，和真实商店安装分别报告。
- 真实往返使用隔离 Profile、唯一测试 Host 和扩展副本，不操作日常 Profile、正式注册或产品故障接口。
- 正式 Chrome/Edge 用 EXECUTOR_BROWSER_FLAVOR=installed；action/CDP、API 激活、人工工具栏点击、商店/企业策略分别报告。
- 冻结/丢弃改变和拒绝时不附着网页调试器，恢复用新观察；显式解冻/刷新不代替普通激活，不以默认回归替代在途/复杂页面专项。
- 受控模型、协议 peer 与用户真实模型分开；原失败保留，有限通过不提升 Computer/发行门禁。
- 文档更新长期职责文件和验证矩阵，原日志/JSON/图片保留身份与结果，不再新增日期阶段报告。
- 仅文档变更检查格式、索引、链接与决定一致性，无需运行无关的业务或硬件测试。
