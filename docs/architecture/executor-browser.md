# Executor Browser 与扩展

Browser 由唯一 Runtime、固定 Native Host、自有 MV3 扩展和 PageController 组成。任务、授权见 [Executor](executor.md)，安装操作见 [扩展安装说明](../../apps/browser-extension/INSTALLATION.md)，实际覆盖见 [验证矩阵](executor-validation.md)。

## 正式连接链

MCP → TaskAuthority → BrowserBridge → 专用回环 /browser-bridge → 原生启动器/私有 Node → Worker → 顶层 ISOLATED 内容脚本 → PageController。

浏览器主动 connectNative 固定 Host；Host 读取当前数据目录的私有 bootstrap，连接同一 Runtime。Runtime 离线不另起服务，不保存待执行动作。外部 MCP stdio 使用另一角色和 /mcp，网络监听不开放桥接路由。

固定 Host 为 com.octopus.executor.browser；扩展公开身份仅由 apps/browser-extension/browser-identity.json 维护，构建期不接受身份环境变量覆盖，将同一精确来源列表编入原生启动器、Native Host、Runtime 和注册脚本。固定公钥稳定官方侧载身份，不证明商店发行或密码学来源。sideload/store 只决定插件是否携带 manifest.key；客户端始终使用完整的侧载及两个商店身份；所有模式都要求两个商店 ID 有效。只有插件模式从环境配置读取，客户端不读取 .env。身份策略不含插件 profile 或产品版本；客户端自身构建与插件产物记录分别校验，打包按插件实际渠道身份和协议判定兼容。兼容升级无需另一端同步升版或重建，升级重连产生新 connectionId，旧请求不重放。运行时不读取 .env，实际 origin 原样传递并逐层校验；配置步骤见[发布 SOP](../../apps/browser-extension/RELEASE.md#33-配置身份并重新构建)。Host 仍校验私有配置 ACL、实际登录会话与固定私有资源；扩展不持有 Runtime Bearer。

Native Messaging 使用四字节小端长度和 UTF-8 JSON。共享协议版本为 3，包含握手、心跳、携带 taskId 的有限请求、任务反馈释放通知和关联结果；不兼容版本不执行命令。每个新握手生成新 connectionId，旧连接、轮询或回复不能更新新连接状态。

每个安装实例独立；最多 16 个安装实例。单包络 256 KiB，桥接入口最多 24 个请求和 1 MiB 输入缓冲，每连接一个十秒长轮询，25 秒无活动标记断开。工具关联最多 16 个待回复请求，Worker 最多 8 个执行请求，工具请求/导航预算分别 15/10 秒。关闭释放定时器、监听和轮询，不自动重放。

## 注册与更新

安装和非测试客户端 Runtime 就绪后，使用随包脚本维护实际资源/数据目录。仅当前完整身份集合匹配的本产品注册可以迁移安装路径，不兼容旧身份集合，未知、丢失 manifest 或不可写目录拒绝；旧版卸载只删除仍指向自身的注册。

Windows MSIX/AppData 视图通过目录句柄解析实际 DOS 路径，不删除身份、来源或 ACL 检查。注册成功不表示 Worker 已握手或工具已就绪。

扩展加载目录需保持完整；更新包不会更新已加载的旧目录，需重新加载对应新产物。商店尚未发布，不自动固定工具栏、不自动启用桥接、不迁移客户端授权。

## 扩展职责与权限

当前扩展 0.1.5，Chrome/Edge 独立产物，PageController 固定为 1.12.4。扩展只声明 nativeMessaging、storage、alarms、scripting 与截图 API 必需的 <all_urls> 网站权限（内容脚本与运行时路由仍限制为授权 HTTP/HTTPS）；不预先申请 debugger/cookies/externally_connectable。

内容脚本只静态注入顶层 ISOLATED world，Controller 懒初始化；固定脚本补注入与静态入口共用一个接收器。PageController 使用固定版本，仅通过标准 pnpm patch 删除未使用的 executeJavascript 方法及类型声明；适配层只调用协议白名单对应的公开方法，不提供任意 JavaScript、Agent Loop 或网页控制入口。依赖修改条件见[插件规范](../../apps/browser-extension/AGENTS.md#第三方依赖修改原则)。

无副作用探测明确发现接收器缺失后，最多补注入一次固定脚本，且派发前再次检查网站权限。动作发送失败不触发补注入或重放。冻结、丢弃、受保护/隐身页面、目标不存在或权限不足先拒绝，不靠刷新恢复。

## 十一个工具

| 工具                  | 任务与目标                           |
| --------------------- | ------------------------------------ |
| browser_list          | 当前安装实例及连接状态               |
| browser_tabs          | 明确连接中的标签列表                 |
| browser_open_tab      | 任务创建，默认后台打开               |
| browser_navigate      | 明确 tabId，等待新文档完成并重新握手 |
| browser_close_tab     | 仅关闭本任务创建的标签               |
| browser_snapshot      | 建立当前文档快照                     |
| browser_read_snapshot | 读取同一快照的有界后续页             |
| browser_click         | 当前快照中的元素引用                 |
| browser_fill          | 当前元素的文字填入                   |
| browser_select        | 当前原生选择控件的 optionText        |
| browser_scroll        | 当前快照身份与有限方向/像素          |

browser 授权与当前任务能力都必须满足。任务固定 connectionId，多实例不隐式选择；导航、快照和动作不依赖全局当前页，不自动前台激活。输入与输出必须经共享协议和源端 Schema 验证。

## 文档、引用与分页

引用绑定 owner、taskId、connectionId、tabId、sender.documentId、controllerId、snapshotId。动作使用已发布索引，不在派发时重新提取或重排。

新快照、动作、导航、SPA URL 往返、连接或任务替换、页面回收/BFCache 恢复使旧引用失效。依用户要求，页面提取和索引直接使用 PageController，不另建 DOM 变化监听；同文档的属性、文本与输入变化遵循上游真实元素引用的行为，不再承诺任意 DOM 变化都拒绝整份快照。URL 返回原值不恢复旧 Controller。tab 替换不把旧 ID 映射到新 ID。

单层同源 iframe 与 open shadow roots 执行有界准入检查，最多 128 个根和 100,000 个元素；frame 文档身份变化也需检查。跨域/嵌套 frame 缺少完整文档访问时明确拒绝，不承诺任意网页可执行。

快照在源端一次提取并缓存，最大 2 MiB、60 秒 TTL，按 UTF-8 24 KiB 分段并检查完整 JSON 包络。Runtime 不先接收完整 DOM，最多 32 个活动快照和 128 个游标。游标绑定任务、连接、文档、Controller、快照和页号；摘要、总字节和页序逐页校验，重复读取不重新建立快照。

密码值和标记的敏感内容在源端移除，但不是通用隐私过滤。导航、过期、新快照、连接切换和 Runtime 重启使旧游标失效，不能由旧游标触发重建。

## 结果、停止与恢复

停止只关闭新派发，已经派发的动作允许完成。超时、取消、断线或回包丢失不保证动作撤回，结果不明时返回 OUTCOME_UNKNOWN 并保留幂等摘要；task_status 的 browserActionsMayContinue 描述这一边界。

不建立浏览器任务许可世代、强停止确认、reconcile 或为在途网页动作增加的恢复隔离。重连只恢复连接，旧任务和引用仍失效；新动作由智能体明确创建或继续，不自动重放。

冻结/丢弃拒绝必须在网页未附着调试器时核对真实浏览器状态，并证明没有额外加载或效果。普通窗口/标签激活、显式 CDP 解冻、显式刷新分别记录；显式恢复通过不能冒充普通激活或物理鼠标人工验收。

## 反馈与连接弹窗

Browser 直接使用 PageController 1.12.4 的原生遮罩、彩屏、箭头、点击动画和默认高亮。构造时仅传 enableMask: true，DOM 提取范围（默认完整页面）、属性与高亮使用上游默认值。第一次 browser_snapshot 调用 showMask 与 getBrowserState，后续观察和动作复用同一个任务拥有的 Controller；模型思考间隙保留彩屏，动作后不销毁，不再自建键盘/鼠标输入拦截或绘制实现。上游 updateTree 自行暂时穿透遮罩完成 DOM 提取，适配层不在快照前 hideMask。

任务完成或停止后，由 Runtime 通过内部 release 消息通知扩展释放该 taskId、connectionId 对应页面的原生资源；该消息不作为 MCP 工具开放，不关闭用户标签页。暂停/断线也释放本连接记录过的页面；已进入的动作先完成再清理。旧任务或旧连接的释放消息不能清理新任务，初始化期间失效的 Controller 也在初始化完成时再次 dispose，不能复活遮罩。协议升级拒绝旧扩展，需同时重新构建并重启 Executor、重新加载扩展。

browser_snapshot 默认激活指定目标页并返回 DOM 与 JPEG 视口截图；screenshot=false 保留后台 DOM 观察。图像边长不超过 1280、编码不超过 128 KiB，Native 帧仍限制 256 KiB。临时遮蔽密码控件和 data-executor-sensitive 内容，仅恢复仍由本次遮蔽拥有的样式；捕获期间新增的未遮蔽敏感元素、切换标签后再切回或导航拒绝发布。彩屏和默认高亮保持上游展示行为，截图会包含当前页面的原生视觉反馈。图片通过标准 MCP image content 展示，结构化 data 只附尺寸/MIME 信息，不重复 base64。

当前 MV3 ISOLATED 内容脚本的 eval 受浏览器 CSP 拒绝，产品决定关闭任意脚本执行，不增加 Debugger 或其他执行通道。用户明确批准最小 pnpm patch 从发布产物移除 executeJavascript/eval，协议白名单与扩展权限配置注释指明该处理；有限操作继续使用扩展随包交付的代码。

popup.html 只显示当前 Worker 握手、连接与工具就绪，并提供暂停、恢复、重连/刷新。命令只接受本扩展 popup 来源；旧 storage 的 connected 标签不作为在线依据。暂停持久化并关闭自动重连，Worker 重启或再次打开弹窗不会自行恢复。关闭弹窗只释放自身资源，后台连接继续。

弹窗不能启动 Runtime、读取凭据或调用页面工具。图标的 16/32/48/128 资源与实际许可随两目标产物交付；支持浅深色和 reduced-motion。

## 持续验证入口

协议和路由使用扩展 test/*.test.mjs；真实反馈、连接、冻结/丢弃和原生 popup 使用 Executor test/integration 的对应用例；扩展 test:popup 单独检查实际 action 目标与生产弹窗文档。

浏览器夹具使用唯一测试 Host、扩展副本和隔离 Profile；不替换正式注册，不改日常配置。仅在测试副本注入故障，不向产品加入故障、脚本、强停或额外控制接口。自动 action/CDP 交互与人工点击工具栏、商店分发、企业策略及跨环境稳定性分别验收。

Native Host 的 host-location.json 仅接受 projectRoot，读取其 browser 子目录。安装脚本参数为 ProjectRoot，与 Main/Runtime 的业务根一致；不再从 Electron userData 读取桥接凭据。
