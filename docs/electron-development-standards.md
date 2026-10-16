# Electron 开发规范

> 适用范围：Electron + TypeScript 应用的进程、安全、生命周期、构建与验证约束。项目职责、工具语义与开发范围由对应 AGENTS.md 和已确认设计定义。
> 本文由 apps/executor 与 apps/desktop 的 AGENTS.md 索引，适用于各项目实际涉及的 Electron 代码。版本以项目锁文件和对应版本文档为准，不把本文当作最新版声明或升级指令。

## 规范关系

- 本文补充根 AGENTS.md 与 [代码开发规范](./code-development-standards.md)，不重复定义目录白名单或业务架构。
- 对项目实际采用的 Electron 能力应用相应条目；仅文档或目录占位变更不要求启动不存在的应用、安装依赖或运行不存在的脚本。
- 项目 AGENTS.md 定义产品边界；本规范不授权创建 Runtime、任务管理器、数据库或新业务能力。源代码尚未建立时，不能将建议目录或选型记作已实现。
- 下方官方参考用于核对行为；涉及版本升级或新增 API 时核对对应锁定版本，不沿用历史快照推断当前兼容性。

## 1. 开始任务前

- 先阅读作用域内的 `AGENTS.md`、`package.json`、锁文件、构建配置和相关模块，确认实际入口、目标平台、进程边界及可执行脚本，再修改代码。
- 沿用现有包管理器、构建工具、格式化工具、测试框架和目录约定。未经任务要求，不切换工具链、不全量格式化、不重排目录、不升级无关依赖。
- 只实现当前需求所需的最小完整方案。优先复用既有模块；不为假设中的扩展引入通用 RPC 框架、依赖注入容器、多层转发或额外微服务。
- 发现既有代码与安全规范冲突时，指出风险并修复当前变更涉及的边界；不得为兼容旧代码而静默降低安全配置。

## 2. 版本与依赖

- Electron 使用稳定发布渠道，锁定经过验证的具体版本并提交锁文件。不得在安装后、首次启动或运行期间执行 `npx ...@latest` 获取未锁定代码。
- 修改 Electron 版本前，核对官方 Releases、相关版本的 Breaking Changes、目标操作系统支持和原生模块兼容性；跨多个主版本时逐级审查迁移事项。[R1][R2]
- 区分构建机 Node.js、Electron 内置 Node.js、独立服务进程的 Node.js。某 API 在开发机可用，不代表它在目标 Electron 中可用。
- API 是否可用，以锁定版本的类型定义和对应版本文档为准。不得照搬 `/latest` 中尚未进入当前版本的 API，不新增已弃用或实验性 API，除非任务明确要求且说明风险。
- 使用 Electron 自带类型；新增依赖需说明必要性、维护状态、许可证和运行时影响。不要为少量可维护代码引入大型依赖。

## 3. 进程与依赖边界

- **Main**：应用生命周期、窗口、托盘、系统集成、安全策略、IPC 接入及后台进程监管。保持入口简短，不把业务实现堆进启动文件。
- **Preload**：通过 `contextBridge` 暴露最小、明确、可类型检查的业务接口。只做参数适配、消息转发和订阅管理，不承载数据库、任务执行或业务状态。
- **Renderer**：界面、交互和展示状态。按普通浏览器环境编写，禁止导入 `electron`、`node:*`、Main 实现、数据库驱动或其他 Node-only 依赖。
- **后台 Runtime / Utility Process**：承载已有的常驻服务、CPU 密集任务或需要故障隔离的组件。小型、非阻塞系统操作不必为分层而增加进程；已有独立 Runtime 不得搬回 Main。[R3][R4]
- 共享契约复用仓库已有的 `contracts` 或 `shared` 包，只包含 DTO、运行时 Schema、消息定义及纯函数，不依赖 Electron、文件系统、DOM 或具体业务实现。
- 用模块组合和显式参数传递表达依赖；不要用可变全局对象或通用事件总线替代正常调用。不要创建只负责转发的一串同构分层。

## 4. TypeScript 与模块系统

- 遵循仓库的 strict TypeScript 配置，不通过关闭类型检查解决错误。边界输入用 `unknown` 并校验后收窄；禁止无说明的 `any`、双重断言和 `@ts-ignore`。
- 共享协议使用单一事实来源；已有 Schema 时优先从 Schema 推导类型。类型导入使用 `import type`，Node 内置模块使用 `node:` 前缀。
- 沿用仓库命名风格；函数名表达动作，布尔值表达判断，状态使用可穷尽检查的联合类型。公共边界写明返回类型，注释解释约束、原因和例外，而不是复述代码。
- Main 源码优先使用 ESM 风格；构建产物及 `package.json` 的模块声明必须一致。不要仅为统一风格迁移已有稳定的 CJS 构建链。
- **启用 sandbox 的 Preload 不能直接使用原生 ESM 加载。** 可以在 TypeScript 源码中写 `import`，但应打包为独立的 CJS 兼容脚本，例如 `preload.cjs`；禁止残留不受支持的动态导入、依赖分块或任意运行时 `require`。[R5]
- 沙箱 Preload 中的 `require` 不是完整 Node.js 加载器。构建时内联所需纯 JavaScript 依赖，正确保留 Electron 运行时导入；不得通过 `sandbox: false` 解决依赖加载失败。[R5]
- 必须在 Electron `ready` 前执行的初始化，应在入口同步完成或显式等待；禁止用未等待的动态导入赌执行顺序。[R5]

## 5. 窗口安全基线

所有应用界面窗口显式保持以下配置；其他选项按需设置。[R2][R20]

```ts
const webPreferences = {
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
};
```

- Preload 路径必须是由应用确定的绝对路径。不得接受 Renderer、URL 参数或远端配置指定 Preload 文件。[R20]
- 禁止通过 `--no-sandbox`、忽略证书错误、关闭同源策略、开放任意导航或关闭安全警告来“修复”功能。
- 应用界面仅加载受信资源；不得在带有应用特权桥接接口的同一个 `webContents` 中导航到第三方网站。
- 嵌入第三方内容时，优先使用独立 `WebContentsView`，隔离 session/partition，并保持沙箱且不注入应用的特权 Preload。不新增已弃用的 `BrowserView`；不默认启用 `<webview>`。[R2][R6]
- 使用 `BaseWindow` 管理 `WebContentsView` 时，显式关闭不再需要的 `view.webContents`；不能假设父窗口关闭会自动释放它。[R6]

## 6. 页面、导航与权限

- 生产界面优先通过受控自定义协议加载，例如 `app://ui/`，不要把任意本地文件直接暴露给页面。使用 `protocol.handle`，不新增已弃用的 `register*Protocol` / `intercept*Protocol`。[R2][R7]
- `registerSchemesAsPrivileged` 必须在 `ready` 前调用；实际协议 handler 在 ready 后、对应 session 上注册，并先于页面加载。仅开启必要权限，不启用 `bypassCSP`。[R7]
- 协议处理器只服务已打包的界面资源。验证 scheme、host、解码后的路径和资源根目录；防止目录穿越、编码绕过及符号链接逃逸。用户文件不与可信应用脚本共用可执行资源来源。
- 生产环境设置限制性 CSP，至少限制脚本来源、连接目标、对象和 frame；禁止通过 `script-src 'unsafe-eval'` 或 `'unsafe-inline'` 放行任意脚本。开发所需的 HMR 来源单独配置，不能进入正式包。[R2]
- 用 `setWindowOpenHandler` 默认拒绝新窗口；限制页面导航和重定向，同时校验应用主动调用 `loadURL` 的目标，不只依赖导航事件。[R21]
- 外部链接由 Main 解析并依据业务允许列表决定是否交给 `shell.openExternal`。禁止直接转发不可信 URL；使用 `new URL()` 检查协议和目标，不用字符串前缀判断域名。[R2]
- 对每个实际使用的 session 设置一致的 `setPermissionRequestHandler` 和 `setPermissionCheckHandler`，默认拒绝、按来源和能力授权；处理空 `webContents`、子 frame 及未知权限。捕获屏幕、摄像头等功能还必须遵守对应系统授权。[R8]
- 开发服务器地址仅在明确的开发模式下启用，并精确限制来源；正式包不得因环境变量注入而加载任意远程页面。

## 7. Preload 与 IPC

- Renderer 只能调用具名业务能力，例如 `settings.get()`、`tasks.cancel(taskId)`；禁止暴露通用 `invoke(channel, ...args)`、原始 `ipcRenderer`、Electron event、文件系统或 Shell 对象。[R9]
- 请求响应优先使用 `ipcRenderer.invoke` / `ipcMain.handle`；事件推送使用固定 channel。禁止同步 IPC，不新增 `remote` / `@electron/remote`，禁止在组件或业务代码中散落 channel 字符串。[R10][R11]
- 所有特权 IPC 在 Main 验证：`event.sender` 属于已登记窗口；`senderFrame` 存在且符合允许的 frame 范围；frame 的真实 `origin` 在允许列表内；参数通过 Schema；调用者有权操作目标资源。默认只接受受信主 frame。[R2]
- 不能仅凭 `webContents.getURL()`、Renderer 自报的身份或参数类型判断可信。对来源使用 `senderFrame.origin`；URL 校验用于额外限制协议、页面及路径，拒绝未经明确授权的 opaque origin。[R2]
- 参数校验必须约束枚举、字符串长度、数组规模、路径、资源归属及允许的操作。Preload 中的检查不能替代 Main 中的校验；类型声明不能替代运行时检查。
- 业务消息使用明确可序列化 DTO；不依赖类原型、Electron 对象、DOM 对象或自定义 Error 属性跨 IPC 保留。不要把 `AbortSignal` 或回调函数当作普通 IPC 参数。[R9][R11]
- 预期业务失败采用仓库统一的错误协议，包含稳定错误码和安全消息；同时处理 IPC 传输失败、窗口销毁及后台退出导致的 Promise rejection。不得把内部堆栈、令牌或敏感路径直接回传 UI。
- 每个订阅接口返回取消订阅函数，仅向回调传递业务数据；移除自己注册的 listener，不使用全局 `removeAllListeners` 清理其他模块。应用级 handler 注册一次，窗口/组件重建不得重复注册。
- 需要异步跟踪的长操作返回可关联的标识并报告实际进度；若提供取消接口，必须验证资源归属，并按项目契约区分停止接单、取消请求与执行已停止。超时不等于执行已经停止，不得仅用 `Promise.race` 冒充真实取消；不因采用 Electron 就要求所有后端具备强停止能力。
- 高频消息先批量化、合并或限流；确需持续流式传输时再引入 `MessagePort`，为消息大小、队列长度和消费速度设置边界。[R4][R10]

## 8. 生命周期与资源释放

- 按 API 要求区分 ready 前初始化与 `app.whenReady()` 后初始化。创建窗口、访问 session、启动 `utilityProcess` 等不得抢跑。[R4][R7][R8][R20]
- 对单实例产品，在启动窗口和服务前获取单实例锁；重复启动只激活既有实例。后台 manager 的并发 `start()` 必须合并到同一个启动过程，不能并行创建多个 Runtime。
- 明确“关闭窗口”“隐藏到托盘”“退出应用”的不同语义，遵循目标平台和产品约定。后台任务不绑定 Renderer、路由或 React 组件生命周期。
- 所有 timer、listener、文件 watcher、连接、快捷键、MessagePort 和进程都要有明确 owner 与幂等清理路径；窗口销毁后释放引用，不继续向其发送消息。
- 退出流程应停止接单，按项目约定取消或等待受管操作，关闭连接和本应用拥有的子进程、刷新必要状态，并设置截止时间和受管资源回收后备路径。不把退出时本地资源清理等同于已经派发到外部页面的动作被撤销。
- Electron 事件不会因监听器是 `async` 就自动等待其完成。需要异步退出清理时，在可取消阶段同步阻止退出，再执行防重入关停，完成后重新发起退出；不要在 `process.on('exit')` 中安排异步清理。
- 处理 `render-process-gone`、后台 `exit` 和连接断开；失败请求必须收敛。重启采用次数限制与退避，不能无限自动重启，不能自动重放结果未知的有副作用操作。[R4][R21]

## 9. 后台进程与本地服务

- 需要独立 Node.js 进程时优先评估 `utilityProcess.fork`；Main 与 Utility 使用其消息通道。启动外部可执行程序则使用 `spawn` / `execFile`，不要混淆两种用途。[R3][R4][R12]
- Utility Process 提供进程和故障隔离，但拥有 Node.js 能力，不是执行任意不可信代码的安全沙箱。执行不可信程序需要另外设计系统级隔离与授权。[R3][R4]
- 外部程序由 Main 或受管 Runtime 启动，使用已验证的程序路径、参数数组、工作目录和最小必要环境变量。默认 `shell: false`，不得拼接用户输入为 Shell 命令；参数数组也需要防止目标程序的选项注入。[R12]
- 为启动、运行、输出缓冲、并发数和停止过程设定边界；持续消费或明确忽略 stdout/stderr，避免管道写满。未明确需要的后台进程不得使用 detached/unref 脱离监管。[R12]
- 不能把 `child.kill()` 当成“整个进程树已退出”。只回收本应用拥有的进程；不得按 `node`、`python` 等进程名全局结束进程。Windows 需要可靠进程树回收时使用 Job Object 等明确监管机制，并测试父进程异常退出。[R12][R13]
- 若暴露本地 HTTP/WebSocket 服务（包括网络传输的 MCP）：默认仅监听回环地址，校验连接身份和必要的 Host/Origin，限制消息规模；不能把“来自 localhost”当成授权。UI 与 Main 的普通交互不为此另建 HTTP 服务。

## 10. 文件、数据与敏感信息

- 应用私有配置和数据库使用统一路径服务管理，通常位于 `app.getPath('userData')`；已有 workspace/agent 数据目录约定时继续沿用。不得以 `process.cwd()` 推断安装资源目录，不向安装目录或 ASAR 写业务数据。
- 打包资源通过构建产物位置、`app.getAppPath()`、`process.resourcesPath` 等明确解析；使用 `node:path` 和正确的 URL/路径转换，不手工拼接平台分隔符。
- 文件操作必须验证授权范围。来自 IPC 的路径、拖放和文件选择结果仍需检查；访问可变目录时考虑符号链接及校验到使用之间的竞态，不把 `path.resolve()` 当成授权检查。
- 配置读取要验证 Schema，写入要防半写入和并发覆盖；数据库修改使用事务，迁移可审查且失败不静默重建或删除用户数据。同步数据库的重型操作不得阻塞 Main。
- 凭证使用系统安全存储或 `safeStorage` 封装；优先评估当前版本的异步 API，并处理不可用、解密失败和密钥变化。不得把令牌写入 Renderer 持久状态、普通配置、日志或前端环境变量。[R14]
- Linux 同步 safeStorage 后端为 `basic_text` 时不得宣称已获得安全存储；异步 API 也必须确认其后端与可用性。不可用时明确失败或仅保存在内存，禁止静默明文降级。[R14]

## 11. 性能、异步与可观测性

- 不在 Main 的交互路径执行同步文件 I/O、同步子进程、CPU 密集循环或大文件解析。`async` 函数里的同步工作依然会阻塞；CPU 工作使用合适的 Worker 或后台进程。[R10]
- 初始化按需执行，重型依赖延迟加载；先测量再优化。不为兼容 Electron 已支持的平台功能增加无必要 polyfill，不默认关闭硬件加速或后台节流。[R10]
- Renderer 中的大列表和高频更新采用分页、虚拟化或合并提交；UI 订阅随作用域清理。动画由渲染时钟驱动，后台任务状态由其实际执行进程维护。
- 所有 Promise 必须被等待、返回或显式处理失败；禁止空 catch、无限重试及无界 `Promise.all`。重试只用于已证明可重试或具备幂等保障的操作。
- 错误记录包含必要的模块、操作和 `requestId` / `taskId`；统一脱敏并限制日志体积。不可恢复错误应进入受控失败流程，不能只打印后继续运行在未知状态。
- 性能变更提供可复现的指标或剖析依据，关注启动时间、Main 事件循环延迟、内存、IPC 量及后台 CPU；不要凭感觉新增缓存或复杂调度器。

## 12. 构建、原生模块与发布

- Main、Preload、Renderer、Utility 分别按各自执行环境构建；生产产物不依赖源代码目录、开发服务器、开发机全局 Node.js/Python 或运行时临时下载依赖。
- `electron`、Node 内置模块及原生依赖按执行环境正确 externalize。沙箱 Preload 不能因此保留对任意 npm 包的运行时 `require`。
- `better-sqlite3`、`sharp` 等原生模块必须验证目标 Electron/操作系统/架构组合。使用对应预编译产物或 `@electron/rebuild` 等既有流程，不能直接发布仅在开发机普通 Node.js 下验证过的 `.node` 文件。[R15]
- 原生模块及其配套动态库按需从 ASAR 解包；外部可执行程序作为真实资源文件分发，验证权限和签名。ASAR 不是加密，也不是阻止用户提取代码的安全边界。[R16]
- 在受支持的平台和构建链上审查 Fuses：无对应需求时关闭 `RunAsNode`、`EnableNodeOptionsEnvironmentVariable`、`EnableNodeCliInspectArguments`；按适用性启用 ASAR 完整性及 `OnlyLoadAppFromAsar`。必须验证企业证书、服务启动和更新兼容性。[R17]
- 关闭 `RunAsNode` 会影响依赖 Electron 可执行文件的 `child_process.fork()`；不要一边关闭它，一边假设既有子进程方案不受影响。[R17]
- Fuses 和资源修改在代码签名之前完成；正式发布按目标平台配置签名及必要的公证，更新来源和校验策略不可被不可信页面控制，不允许签名验证失败后继续安装。[R17][R18]
- 发布包不包含开发调试入口、真实凭证或测试专用后门；source map 按错误诊断与源码暴露策略管理，不通过删日志掩盖错误。

## 13. 测试与验收

- 从仓库脚本获取真实命令，执行与变更对应的类型检查、静态检查、单元测试和构建。不要捏造不存在的脚本，不得通过关闭规则或删测试让检查通过。
- 业务逻辑优先脱离 Electron 做单元测试；IPC 边界测试非法参数、未授权 frame、权限拒绝、资源归属、路径越界、后台退出、超时和取消竞态。
- 桌面集成测试覆盖真实 Preload 加载、窗口打开/关闭/重建、订阅清理、单实例、托盘语义、后台任务和干净退出。测试使用独立数据目录，不访问真实凭证或修改用户环境。
- 沿用既有 E2E 工具；选用 Playwright 时注意其 Electron 支持仍标记为实验性，并验证版本组合。关闭 `EnableNodeCliInspectArguments` 可能使 `_electron.launch()` 超时；使用隔离的测试产物，不为测试放宽正式包安全配置。[R19]
- 涉及打包、协议、Preload、原生模块或后台进程的变更，必须验证打包后的应用，不能只测试开发模式。对最终加固/签名产物另做适用的黑盒冒烟检查。
- 对声明支持的平台验证对应能力；未覆盖的平台、未执行的检查和已知限制必须明确说明，不得宣称“全部通过”或“跨平台可用”。

## 14. 完成任务时

交付说明必须包含：修改内容与原因、影响的进程/契约/数据、实际执行的检查及结果、未验证部分与已知风险。新增 IPC、配置或数据库结构时，同步更新契约、相关测试和必要文档。

提交前确认：没有扩大 Renderer 权限；没有把业务搬入 Preload；没有阻塞 Main；没有遗漏输入授权或资源清理；没有引入未锁定依赖；打包路径和目标运行环境已经按本次变更范围验证。

## 官方参考

以下来源用于核对 API 行为；目录、命名、错误协议和交付要求属于本项目工程约定，不代表 Electron 强制采用同一套架构。后续升级应重新核实。

- [R1] Electron Releases：https://releases.electronjs.org/
- [R2] Security：https://www.electronjs.org/docs/latest/tutorial/security
- [R3] Process Model：https://www.electronjs.org/docs/latest/tutorial/process-model
- [R4] Utility Process：https://www.electronjs.org/docs/latest/api/utility-process
- [R5] ES Modules：https://www.electronjs.org/docs/latest/tutorial/esm
- [R6] WebContentsView：https://www.electronjs.org/docs/latest/api/web-contents-view ，BaseWindow：https://www.electronjs.org/docs/latest/api/base-window
- [R7] Protocol：https://www.electronjs.org/docs/latest/api/protocol
- [R8] Session：https://www.electronjs.org/docs/latest/api/session
- [R9] Context Bridge：https://www.electronjs.org/docs/latest/api/context-bridge
- [R10] Performance：https://www.electronjs.org/docs/latest/tutorial/performance
- [R11] IPC：https://www.electronjs.org/docs/latest/tutorial/ipc ，ipcRenderer：https://www.electronjs.org/docs/latest/api/ipc-renderer
- [R12] Node.js 24 Child Process：https://nodejs.org/docs/latest-v24.x/api/child_process.html
- [R13] Windows Job Objects：https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- [R14] Safe Storage：https://www.electronjs.org/docs/latest/api/safe-storage
- [R15] Native Node Modules：https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- [R16] ASAR Archives：https://www.electronjs.org/docs/latest/tutorial/asar-archives
- [R17] Electron Fuses：https://www.electronjs.org/docs/latest/tutorial/fuses
- [R18] Code Signing：https://www.electronjs.org/docs/latest/tutorial/code-signing
- [R19] Automated Testing：https://www.electronjs.org/docs/latest/tutorial/automated-testing ，Playwright Electron：https://playwright.dev/docs/api/class-electron
- [R20] BrowserWindow：https://www.electronjs.org/docs/latest/api/browser-window
- [R21] WebContents：https://www.electronjs.org/docs/latest/api/web-contents
