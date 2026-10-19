# Executor Windows 正式签名发布 SOP

未签名 GitHub Actions 构建与附件交付按 [Executor 交付指南](../../docs/architecture/executor-delivery.md#github-actions-未签名交付)操作；该工作流独立于本文的签名发布步骤，不将验收包标记为正式签名发行。

适用：Windows x64、NSIS 安装程序及完整 ZIP。外部流程核对日期：2026-10-12；每次发布前重新确认签名服务资格和官方配置。本文是长期操作手册，不记录阶段进度。

日常构建及首次资源装配见[交付指南](../../docs/architecture/executor-delivery.md)，安装和数据恢复见 [INSTALLATION.md](INSTALLATION.md)，浏览器商店协同见[插件发布 SOP](../browser-extension/RELEASE.md)。

## 1. 先确认当前项目能做什么

| 项目     | 当前事实                                                                                      | 正式发布前的动作                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 打包入口 | `package:acceptance` 已实现，生成未签名 EXE/ZIP                                               | 保留验收入口，另实现明确的签名发布入口                                                                                           |
| 签名配置 | scripts/package/package.mjs 设置 `signExecutable: false`、`CSC_IDENTITY_AUTO_DISCOVERY=false` | 不能只设置证书环境变量；需接入实际签名配置                                                                                       |
| 产物标记 | 目录/文件名含 unsigned，元数据固定 `signed: false`                                            | 正式入口必须按实际验证结果生成签名标记与文件名                                                                                   |
| 完整性   | 最终 PE/Fuse 字节进入 runtime-manifest                                                        | 签名完成后生成清单，再封装；不得给旧包补签后沿用旧摘要                                                                           |
| 运行资源 | 私有 Node/Python/Git/搜索有固定来源和摘要                                                     | 明确签名范围，保持上游固定资源的信任锚                                                                                           |
| 发布验收 | 当前为本机未签名验收，干净机器等仍待完成                                                      | 按[发布门禁](../../docs/architecture/executor-delivery.md#发布门禁)提供实际证据；Computer 已按用户决定启用，专项验收仍需真实证据 |

**当前没有 `package:release` 脚本。本文的正式配置是待接入方案，不表示已生成签名正式包。** 先完成第 4 节的工程接入，再进行第 5–7 节的正式构建、验证与分发。

已实现的 GitHub Release 自动化仅分发仍标记 unsigned 的验收包：现有 Release 的 published 事件触发构建与完整 CI，成功后附加 EXE/ZIP、构建来源和摘要。操作、权限、失败恢复及 Web 默认下载路径统一见[交付指南](../../docs/architecture/executor-delivery.md#github-release-assets-与-web-下载地址)。这条流程不代替本文的签名工程接入或正式 Windows 发行门禁。

## 2. 选择签名身份和服务

| 发布主体/需求                             | 路线                                                   | 先确认                                                              |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| 中国大陆组织或不符合 Azure 资格的主体     | Windows 信任链中的代码签名 CA，配合 USB token 或云 HSM | CA 能受理主体、证书 EKU 为 Code Signing、私钥托管方式、时间戳与费用 |
| 符合支持地区和身份要求的主体，希望使用 CI | Azure Artifact Signing（原 Trusted Signing）           | 身份验证通过、Public Trust profile、区域 endpoint 和签名权限        |
| 客户采购规则明确要求 EV                   | CA 的 EV 代码签名证书                                  | 额外身份验证与硬件/云密钥支持                                       |

Microsoft 当前公开资格：Artifact Signing 面向美国、加拿大、欧盟和英国组织；个人限美国和加拿大。中国大陆主体应先核对资格，不能用海外 Azure 区域代替主体身份资格。OV 证书的私钥按现行要求使用硬件 token/HSM，选择服务时不要默认可导出 PFX。费用和受理条件以服务商实际报价为准。[Microsoft 签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

**有效签名证明发布者及文件完整性，不保证新版本立即免除 SmartScreen 提示；EV 也不再保证立即建立信誉。** 使用一致的发布身份并实测用户下载后的行为，不要求用户关闭系统保护。[Microsoft SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

负责人分别为发布负责人（主体、版本、发布批准）、签名管理员（密钥与证书）、构建维护者（流水线与清单）和验证人员（干净环境与证据）。同一人兼任时仍逐项完成并记录结果。

### 2.1 CA/token 路线

1. 用实际发布主体申请代码签名证书，完成 CA 的身份验证，确认证书显示的法定发布者名称。
2. 领取并安装 CA 的 token/CSP/KSP 驱动，或安装其云签名客户端；按服务商流程解锁签名能力。
3. 在 Windows 签名账号下查看公开证书信息，确认期限及可用私钥：

   ```powershell
   Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
     Select-Object Subject, Thumbprint, NotAfter, HasPrivateKey
   ```

4. 记录证书 thumbprint、证书主体、服务商 RFC 3161 时间戳地址和操作人；如证书位于 LocalMachine，后续 SignTool 使用对应机器存储及权限。
5. PIN、私钥、PFX 密码及服务 API 密钥进入受控密钥存储，不进入 Git、截图、命令日志或发布包。thumbprint 和公钥是公开标识，不能代替私钥权限。

### 2.2 Artifact Signing 路线

1. 按[微软设置流程](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)完成资格、Azure 订阅、Artifact Signing account、身份验证和 Public Trust certificate profile。
2. 为发布构建身份分配 certificate profile 的签名角色；区分本地交互账号与 CI 工作负载身份。
3. 保存实际 account name、profile name、区域 endpoint 和 publisher name。测试本地与 CI 各自能访问，不把账号登录成功等同于获得签名权限。
4. CI 使用服务支持的受限身份认证，优先采用已验证可用的工作负载身份方案；若集成要求 secret，用 CI secret 注入、最小权限和轮换，不写入仓库。
5. 安装并显式准备已锁定的签名客户端/SDK，按[签名集成指南](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)做签名自检。生产签名步骤需要访问身份服务及时间戳服务；离线安装目标不需要签名凭据。

## 3. 先验证证书能实际签名

Windows SDK 提供 SignTool。以下是 **CA Windows 证书存储路线的单文件自检**，不执行安装，只签一个新目录中的副本；替换证书与安装程序路径，整段在同一 PowerShell 会话执行。原未签名包及其清单保持原样，这个副本不作为正式发行包。[SignTool 官方参数与退出码](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)

```powershell
$ErrorActionPreference = 'Stop'
$signTool = (Get-ChildItem -Path "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/signtool.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
  Select-Object -First 1).FullName
if (!$signTool) { throw 'Windows SDK SignTool 未找到。' }

$thumbprint = '替换为实际代码签名证书的Thumbprint'
$unsignedInstaller = 'D:/待签名验收包/Dr.Octopus-Executor-0.0.1-win-x64-setup-unsigned.exe'
$timestampUrl = 'http://timestamp.digicert.com'
$signingTestRoot = Join-Path $env:TEMP ('executor-sign-test-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $signingTestRoot | Out-Null
$signedCopy = Join-Path $signingTestRoot 'Executor-signing-test.exe'
Copy-Item -LiteralPath $unsignedInstaller -Destination $signedCopy

& $signTool sign /sha1 $thumbprint /s My /fd SHA256 /tr $timestampUrl /td SHA256 $signedCopy
if ($LASTEXITCODE -ne 0) { throw '签名失败或存在警告，停止。' }
& $signTool verify /pa /all /v /tw $signedCopy
if ($LASTEXITCODE -ne 0) { throw '签名或时间戳验证未通过。' }
$signature = Get-AuthenticodeSignature -LiteralPath $signedCopy
if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
  throw '签名信任或时间戳证据不足。'
}
if ($signature.SignerCertificate.Thumbprint -ne $thumbprint) {
  throw '实际发布证书与选定证书不一致。'
}
$signature | Select-Object Status, SignerCertificate, TimeStamperCertificate
Get-FileHash -LiteralPath $signedCopy -Algorithm SHA256
```

`/sha1` 只用来选择证书的 thumbprint；文件摘要 `/fd SHA256` 和时间戳摘要 `/td SHA256` 均使用 SHA-256。时间戳 URL 要替换为服务商确认支持的地址。SignTool 非零退出码包括警告，发布流程应停止并查明原因。该测试只证明签名通路，安装程序内部文件仍是原验收内容。

云 HSM/token 若不暴露 CurrentUser/My 证书，使用服务商的正式 SignTool 集成方法。不要通过导出硬件私钥来适配上述示例。

## 4. 首次工程接入：完成后才能正式打包

仓库固定 electron-builder **26.15.3**。使用 v26 的 `win.signtoolOptions` 或 `win.azureSignOptions`，不要直接复制 v27 的 `win.sign` 配置。v26 页面中有关 EV 立即免 SmartScreen 的旧措辞，以第 2 节微软现行说明为准。[electron-builder v26 配置](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)

### 4.1 配置签名后端

以下是证书存储路线的 **配置片段**，须合并到正式发布入口，不是覆盖当前 package.ts 的完整代码；参数在受控构建环境中提供：

```typescript
import type { Configuration } from 'electron-builder';

const signingConfig = {
  forceCodeSigning: true,
  win: {
    signExecutable: true,
    requestedExecutionLevel: 'asInvoker',
    signtoolOptions: {
      certificateSha1: process.env.WIN_SIGN_CERT_THUMBPRINT,
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    },
  },
} satisfies Configuration;
```

入口应先拒绝缺失/无效的 thumbprint 和签名身份；不能让缺少参数退化为自动选择未知证书。若确有受控可用的 PFX，v26 支持 WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD；它们不是当前禁用签名脚本的开启开关。

Artifact Signing 路线用 `azureSignOptions` 替代 `signtoolOptions`，不要同时设置。按实际账号填写以下公开参数并通过所用客户端支持的方式注入身份凭据：

```typescript
import type { Configuration } from 'electron-builder';

const cloudSigningConfig = {
  forceCodeSigning: true,
  win: {
    signExecutable: true,
    requestedExecutionLevel: 'asInvoker',
    azureSignOptions: {
      publisherName: '替换为已验证的实际发布者名称',
      endpoint: 'https://替换为实际区域.codesigning.azure.net/',
      codeSigningAccountName: '替换为实际账号名称',
      certificateProfileName: '替换为实际Public Trust profile名称',
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    },
  },
} satisfies Configuration;
```

### 4.2 明确文件范围与清单顺序

不能仅把 `signExecutable` 改为 true 就交付。本仓库锁定版本的 builder 会对 extraResources/extraFiles 中匹配的 EXE 走签名转换，可能改变固定私有 Node 等资源的字节，导致运行时摘要校验失败。以上片段只说明后端参数，**完整接入必须同时处理下列事项**：

| 工作项       | 实施要求                                                                                                                | 验证结果                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 独立正式入口 | 保留 package:acceptance 的 unsigned 行为；正式入口缺证书、时间戳或验证证据即失败                                        | 两种入口不会互相冒充                      |
| 自有 PE 签名 | 列出主 EXE、Native Host/MCP/PowerShell/Computer 启动器、自有 .node/DLL（含 computer-escape.node）及卸载器等完整责任清单 | 路径明确，每项记录签名验证                |
| 上游资源     | 不批量重签、移除或覆盖上游签名；保留固定归档对应字节                                                                    | Node/Python/搜索及原许可/摘要校验继续通过 |
| 签名策略     | 对复制过程及签名 hook 建立经过审查的精确路径策略，不依赖默认所有 EXE 自动重签                                           | 自有文件签到，上游文件保持原样            |
| 构建清单     | 签名会改变大小/摘要；构建端重建受影响的自有资源清单并核对引用方                                                         | 不从用户安装目录重建信任锚，不删原校验    |
| 最终产品清单 | 所有产品 PE/Fuse/签名变更完成后生成 runtime-manifest                                                                    | 最终 unpacked 树完整匹配                  |
| 安装程序     | 从最终产品树封装 NSIS，覆盖生成的卸载器和安装程序签名                                                                   | Installer 与内部文件均核验                |
| 最终交付记录 | EXE、ZIP 成品完成后才生成最终文件摘要、签名证据及发布元数据                                                             | signed 字段来自实测，文件名与事实一致     |
| 测试适配     | 当前 packaging 测试部分明确断言 signed=false；为正式模式增加真实签名断言                                                | 不删 unsigned 回归，不把缺签名当通过      |

关键代码：打包在 [scripts/package/package.mjs](scripts/package/package.mjs)，清单生成在 [package-runtime-manifest.mjs](scripts/lib/package/package-runtime-manifest.mjs)，清单校验在 [runtime-manifest.mjs](scripts/lib/package/runtime-manifest.mjs)，当前测试在 [acceptance.test.mjs](test/packaging/acceptance.test.mjs)。Computer 自有 supervisor 摘要也进入构建清单，需要同步核对。

Browser 来源在构建期确定，配套插件和 Executor 使用同一[身份配置](../browser-extension/RELEASE.md#33-配置身份并重新构建)。dist/browser-identity.json 记录 launcher、Host、Runtime 和注册脚本的完成构建摘要，并随产品交付。正式签名改变自有 launcher 等消费者字节时，正式入口必须在核对签名后通过 [writeBuiltBrowserIdentity](scripts/lib/compile/browser-identity.mjs) 重新生成这份记录，再核对两份插件快照并生成最终 runtime-manifest；不能先打包再修改摘要以跳过混合产物检查。

流水线顺序为：**构建 → 按精确范围签名自有组件并更新其构建清单 → 装配与主 EXE 的 PE/Fuse/签名 → 最终产品树核验及 runtime-manifest → NSIS/ZIP 封装与安装/卸载器签名 → 成品摘要及签名验证 → 发行验收 → 分发**。第三方已签名文件核对其实际发布者；第三方未签名资源在目标 Windows 策略下实测，若需要改变其签名/字节，必须先设计对应的发行信任锚，不能跳过固定摘要。

不能在旧 ZIP 或已记录清单的安装目录中补签，然后把旧清单/旧测试结果继续作为本次证据。签名后禁止再修改被签文件的资源、图标、版本、Fuse 或内容。

## 5. 正式候选构建

1. 确认第 4 节工程已完成，并记录实际正式入口名称。当前仓库尚不能执行所谓 package:release；以下命令只完成已支持的构建和基础检查。
2. 产品版本以 apps/executor/package.json 为唯一来源，[product.ts](src/contracts/product.ts) 静态引用并由构建内联。使用仓库统一发版入口选择独立的 Executor 升级幅度，提交与 Tag 之前完成更新；普通构建、打包及恢复发布不递增版本。命令与非交互参数见 [CLI 联合发布指南](../cli/README.md#非交互发布与-github-actions)。
3. 获得 Chrome/Edge 商店实际 ID，并按[插件 SOP](../browser-extension/RELEASE.md#3-先取得商店身份再完成-native-host-适配)核对 Native 来源；正式插件与候选 Executor 来自同一已审查版本。
4. 按交付指南准备原生头文件、私有资源、许可证及打包工具，在仓库根按顺序执行：

   ```powershell
   pnpm --filter @octopus/shared build
   pnpm --filter @octopus/browser-extension build
   pnpm --filter @octopus/executor build
   pnpm --filter @octopus/executor lint
   pnpm --filter @octopus/executor typecheck
   pnpm --filter @octopus/executor test
   pnpm --filter @octopus/browser-extension lint
   pnpm --filter @octopus/browser-extension typecheck
   pnpm --filter @octopus/browser-extension test
   ```

5. 每步失败即停止。通过后由受控签名构建身份执行已经实现并验证的正式入口，生成新的独立目录；不能用 package:acceptance 的输出作为签名正式包。
6. 构建记录关联源码版本、锁文件、依赖/编译器版本、发布身份、实际扩展 ID、签名日志、最终产物摘要和验证范围。

## 6. 验证及干净机器验收

在同一签名验证会话中，为最终安装程序设置实际路径，然后检查签名、时间戳和 SHA-256：

```powershell
$installer = 'D:/正式发布目录/Dr.Octopus-Executor-实际版本-win-x64-setup.exe'
& $signTool verify /pa /all /v /tw $installer
if ($LASTEXITCODE -ne 0) { throw '正式安装程序签名验证失败。' }
Get-AuthenticodeSignature -LiteralPath $installer |
  Select-Object Status, SignerCertificate, TimeStamperCertificate
Get-FileHash -LiteralPath $installer -Algorithm SHA256
```

对责任清单中每个自有 PE 重复验证，核对实际证书主体、thumbprint、时间戳及证书链；仅看到文件属性的“数字签名”页不作为通过证据。ZIP 记录文件 hash，同时验证解压后的全部产品字节；ZIP 容器不具有 EXE 的 Authenticode 签名。

发行验收清单：

- [ ] 从真实 HTTPS 下载入口获取最终文件，核对文件摘要、发布者和时间戳，记录 SmartScreen/Smart App Control 实际表现。
- [ ] 在干净 Windows x64、普通用户权限下安装，应用离线首启，不借系统 Node/Python/Git；覆盖中文/空格路径。
- [ ] 主程序、卸载器、Native Host/MCP/后台工具及数据 ACL 正常；完成当前发布范围的 MCP 与恢复测试。
- [ ] 安装真实商店来源 Chrome/Edge 插件，验证两个实际 ID 的握手、工具、暂停/恢复、网站权限拒绝与撤销。
- [ ] 停止状态下升级、卸载和重装；保留用户数据，不删除其他安装拥有的 Host 注册，不强杀用户进程。
- [ ] 全部 G1–G6 发布门禁按现有规则记录通过/失败/未执行；Computer 已按用户决定启用，但 G5 等未执行项目继续记录为未验收；证书、源码启用或本机回归不能替代发布证据。

当前未签名 packaging 测试只能作为基础回归，正式证书验证、商店身份和干净安装需要独立实际证据。验收方式及已完成范围见[验证说明](../../docs/architecture/executor-validation.md)。

## 7. 发布、回退与密钥维护

1. 发布负责人核对最终文件及证据，批准后才把签名 EXE、完整 ZIP、摘要及版本说明上传到实际受控下载入口。
2. 下载说明写明发布者法定名称、版本、Windows x64 范围、需单独安装的商店插件及升级/数据恢复步骤；不公布凭据。
3. 上传后从下载入口重新获取文件校验 hash/签名，不再修改这些文件；保留上一版本的签名包和兼容性记录。
4. 发现缺签名、清单失配、Host ID 不兼容或不可恢复升级时停止新分发。按 INSTALLATION.md 的停止态备份/恢复及兼容性评估处理回退，不直接覆盖或重置用户数据。
5. 证书到期前安排续期与流水线自检。密钥泄露时停止发布、联系 CA/服务商撤销并调查影响；用新受控身份构建新版本，不能保证撤销已发文件的执行。

发布记录最少包含：产品版本、源码标识、EXE/ZIP SHA-256、发布者与证书标识、时间戳结果、runtime-manifest/productBuildId、两商店 ID/版本、测试系统及通过范围、发布批准人与时间。只记录证据和公开身份，不记录私钥、PIN 或用户 Bearer。

## 8. 常见问题

| 现象                         | 排查与处理                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- |
| 设置证书变量后还是 unsigned  | 当前验收入口明确禁用签名；先接入第 4 节，不改 signed 字段冒充成功                |
| 证书可见但无法签名           | 检查代码签名用途、期限、私钥提供者、token/HSM 权限和签名账号；不能只复制 .cer    |
| 时间戳失败或 SignTool 返回 2 | 检查服务商 RFC 3161 地址、网络与错误日志；本次发布停止                           |
| 签名后私有 Node 校验失败     | 检查 extraResources 是否被 builder 重签；恢复固定资源并修正精确签名策略          |
| runtime-manifest 校验失败    | 检查签名/PE 编辑是否发生在清单之后；重新按完整顺序构建，不改旧清单掩盖变更       |
| Valid 但仍有 SmartScreen     | 按实际 Windows 策略与信誉情况记录；不承诺 EV 或云签名可立即免提示                |
| 商店插件连接不上             | 核对实际商店 ID、精确允许来源、launcher/Host/Runtime 与注册迁移，按插件 SOP 排查 |
