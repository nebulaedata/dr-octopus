# React i18next 默认英文文案保留方案

> 目标：在使用 `react-i18next` 做国际化时，**默认英文文案直接保留在 React 源码中**，让开发者阅读组件时能够直接看到页面真实文案，不需要频繁跳转到 `en.json` 查找；同时继续保留稳定的国际化 Key、语言包覆盖和 fallback 能力。

---

## 1. 设计目标

1. React 组件源码中必须能直接看到默认英文文案。
2. 国际化 Key 必须保持稳定，不能直接使用英文文案作为 Key。
3. 非英文语言通过语言包覆盖默认英文。
4. 某个语言缺少翻译时，应自动回退到英文。
5. 即使英文语言包中也缺少对应 Key，页面仍然能够显示源码中的默认英文。
6. 尽量减少开发者维护 `en.json` 的负担。
7. 静态检查和文案提取优先使用现成工具链（ESLint 插件、i18next 官方提取器），不足时再自研。
8. API 必须简单，适合在大型 React 项目中长期使用。

---

## 2. 核心规范

项目统一采用以下调用方式：

```tsx
t('session.new', 'New session')
```

其中：

```text
session.new   = 稳定的国际化 Key
New session   = 默认英文文案
```

### 推荐

```tsx
<Button>{t('common.save', 'Save')}</Button>
```

```tsx
<Input placeholder={t('login.email.placeholder', 'Enter your email')} />
```

### 禁止：裸 Key

```tsx
// ❌
t('common.save')
```

开发者无法从组件源码中知道页面真实显示什么内容，必须额外打开语言文件。

### 禁止：英文文案直接作为 Key

```tsx
// ❌
t('Save')
```

产品文案非常容易调整。如果把英文作为 Key，修改文案相当于修改国际化标识，会导致其他语言翻译失效或需要重新迁移。

### 禁止：JSX 硬编码用户可见文案

```tsx
// ❌
<Button>Save</Button>

// ✅
<Button>{t('common.save', 'Save')}</Button>
```

---

## 3. 封装 useI18n

业务代码不允许直接依赖 `react-i18next` 的复杂参数形式：

```tsx
// ❌ 业务代码中禁止
t('common.save', { defaultValue: 'Save' })
```

项目统一封装一层自己的 `useI18n()`：

```text
src/i18n/use-i18n.ts
```

```ts
import { useTranslation } from 'react-i18next'
import type { TOptions } from 'i18next'

export function useI18n() {
  const { t: translate, i18n } = useTranslation()

  function t(
    key: string,
    defaultValue: string,
    options?: TOptions,
  ): string {
    // 在封装边界收窄 i18next 的联合返回类型：
    // 不启用 returnObjects 时运行时值一定是 string
    return translate(key, { defaultValue, ...options }) as string
  }

  return { t, i18n }
}
```

封装要点：

- **不手写 `useCallback`/`useMemo`**：本仓库由 React Compiler 统一负责 memo 化（见 `apps/web/AGENTS.md`）；若移植到无 React Compiler 的项目，再手动包裹以保持 `t` 引用稳定。
- **返回值收窄为 `string`**：`react-i18next` 的 `t` 返回类型是复杂联合类型，封装层统一收窄，业务代码不需要处理。
- **TS 签名强制两个必填参数**：`t('key')` 单参数调用会直接编译报错，这是第一道防线，ESLint 规则（见第 14 节）是第二道。

封装带来的收益：

- 固定项目国际化 API，隐藏 `react-i18next` 实现细节。
- 强制要求默认英文。
- 后续方便增加日志、缺失翻译检测、类型约束和自动提取。
- 即使未来替换国际化库，业务组件也不需要大面积修改。

业务组件：

```tsx
import { useI18n } from '@/i18n/use-i18n'

export function SettingsPage() {
  const { t } = useI18n()

  return (
    <div>
      <h1>{t('settings.title', 'Settings')}</h1>
      <p>{t('settings.description', 'Manage your application preferences.')}</p>
      <button>{t('common.save', 'Save changes')}</button>
    </div>
  )
}
```

开发者打开这个组件即可直接理解整个页面内容。

---

## 4. 目录结构

```text
src/
├── i18n/
│   ├── index.ts            # i18next 初始化
│   ├── use-i18n.ts         # 项目统一 Hook
│   └── locales/
│       ├── zh-CN.json
│       ├── ja-JP.json
│       └── ko-KR.json
│
├── components/
├── pages/
├── hooks/
└── ...
```

默认英文主要存在于源码：

```tsx
t('session.new', 'New session')
```

因此 `en.json` 可以：

- 完全不维护（默认，见第 10 节方案 A）；或
- 通过提取工具从源码自动生成（见第 15 节）。

不推荐开发者手工同时维护组件源码和 `en.json`，否则会产生双份英文文案维护成本。

---

## 5. i18next 初始化配置

安装：

```bash
pnpm add i18next react-i18next i18next-browser-languagedetector
```

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './locales/zh-CN.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // 默认语言与最终 fallback 均为英文；
    // 英文不注册任何资源，全部来自源码 defaultValue。
    lng: 'en',
    fallbackLng: 'en',

    // 支持的语言白名单；不要同时开启 nonExplicitSupportedLngs（见下文说明）
    supportedLngs: ['en', 'zh-CN'],

    resources: {
      'zh-CN': {
        translation: zhCN,
      },
    },

    interpolation: {
      escapeValue: false,
    },

    returnNull: false,
    returnEmptyString: false,

    // 开发模式下保留 missing key 日志，方便发现漏译；
    // 生产环境关闭 debug，避免控制台噪音。
    debug: import.meta.env.DEV,
  })

export default i18n
```

### 语言检测与切换

- 使用 `i18next-browser-languagedetector` 按「用户显式选择（localStorage）→ 浏览器语言（navigator）」的顺序检测，选择结果持久化到 localStorage。
- **语言标签归一化用 detector 的 `convertDetectedLanguage` 显式完成**（`zh`/`zh-Hans`/`zh-TW` 等统一映射到 `zh-CN`，未支持的语言落到 `en`）。
- 注意：i18next v26 中 `supportedLngs` 与 `nonExplicitSupportedLngs: true` 组合会导致已注册资源的 Key 查找失效（实证现象：`getResource` 能取到值但 `t()` 返回 Key 本身）。因此配置 `supportedLngs` 但**不要**开启 `nonExplicitSupportedLngs`，归一化交给 `convertDetectedLanguage`。
- 用户在设置页切换语言时调用 `i18n.changeLanguage()`；`languageChanged` 事件里同步 dayjs 等其他库的语言。

### 语言资源加载策略

- **初期（locale ≤ 3 个）**：静态 import 全部打进 bundle，简单可靠。
- **语言增多后**：切换为按需异步加载——Vite 动态 `import()` 按 locale 分包，或引入 `i18next-http-backend`。切换只发生在 `src/i18n/` 内部，业务代码无感知。

### 命名空间策略

- **初期统一使用默认 `translation` 单命名空间。**
- 当单个 locale 文件超过约 500 个 Key、或出现明显的模块级命名冲突时，按业务模块拆分命名空间（如 `common.json`、`session.json`），调用变为 `t('session:new', 'New session')`。

### missing key 行为说明

由于不注册 `en` 资源，开发模式下 i18next 会对每个仅存在于源码的 Key 输出 missing 警告。这是预期行为，说明 fallback 链路走到了 `defaultValue`。如果日志过于嘈杂，可以通过自定义 `missingKeyHandler` 收集而不是打印，或关闭 `debug`；不要通过注册空的 `en` 资源来消除警告。

---

## 6. fallback 链路

需要明确区分 `fallbackLng: 'en'` 和 `t('common.save', 'Save')` 这两个机制，它们解决的是不同层次的问题：

```text
zh-CN translation
        ↓
   未找到 Key
        ↓
en translation（fallbackLng，无资源）
        ↓
   未找到 Key
        ↓
源码 defaultValue
        ↓
      Save
```

这保证任何情况下 UI 都不会退化成显示原始 Key（`common.save`）。

---

## 7. 带变量的文案

动态文案仍然需要把完整的默认英文留在源码：

```tsx
t('session.messageCount', '{{count}} messages', { count: messages.length })
```

中文语言包：

```json
{
  "session": {
    "messageCount": "{{count}} 条消息"
  }
}
```

---

## 8. 复数处理（强制规范）

**禁止自行拼接单复数：**

```tsx
// ❌
`${count} ${count > 1 ? 'messages' : 'message'}`
```

i18next 的复数规则要求按 Key 后缀区分形式（英文为 `_one` / `_other`）。**只写一个 `defaultValue` 是错误的**：

```tsx
// ❌ count = 5 时英文显示 "5 message"
t('session.messageCount', '{{count}} message', { count })
```

原因是 `count ≠ 1` 时 i18next 查找 `session.messageCount_other`，找不到就回退到 `defaultValue`，单数形式被错误地用于复数。

**正确写法：通过 options 同时提供各复数形式的默认英文。**

```tsx
// ✅
t('session.messageCount', '{{count}} message', {
  count,
  defaultValue_other: '{{count}} messages',
})
```

封装层 `t(key, defaultValue, options)` 会把 `defaultValue` 之外的 options 透传给 i18next，因此 `defaultValue_one` / `defaultValue_other` 等可以直接使用，无需修改封装。

语言包对应写法：

```json
{
  "session": {
    "messageCount_one": "{{count}} 条消息",
    "messageCount_other": "{{count}} 条消息"
  }
}
```

注意不同语言的复数形式数量不同（中文只有 `other`，英文有 `_one`/`_other`，俄语/阿拉伯语更多）。规则：

1. 源码中必须至少提供 `defaultValue`（单数语义）和 `defaultValue_other`。
2. 各语言包按 i18next 对该语言的复数规则提供完整后缀集合。
3. 提取工具（第 15 节）会自动把 `defaultValue_one`/`_other` 展开为对应的 Key。

---

## 9. JSX 富文本

翻译内容中包含 React Element 时使用 `<Trans />`：

```tsx
<Trans
  i18nKey="auth.terms"
  defaults="By continuing, you agree to our <terms>Terms of Service</terms>."
  components={{
    terms: <a href="/terms" />,
  }}
/>
```

要求仍然一样：**默认英文必须出现在源码。**

```tsx
// ❌ 重新引入「阅读源码不知道真实文案」的问题
<Trans i18nKey="auth.terms" />
```

---

## 10. Key 规范

### 命名

```text
模块.页面/功能.语义
```

推荐：

```text
common.save
common.cancel
session.new
session.delete.confirm
session.empty.title
settings.title
permission.mode.ask
```

避免：

```text
button1
text123
save_button_text
page_title_1
```

Key 应表达**语义**，而不是元素位置或实现结构。

### 稳定性：Key 不随英文文案变化

原来：

```tsx
t('session.new', 'New session')
```

产品改文案后：

```tsx
t('session.new', 'Start a new chat')
```

Key 仍然是 `session.new`，而不是新建 `session.startNewChat`。**只要语义没有发生变化，就不应该修改 Key。**

### 同一 Key 唯一语义

> 同一个国际化 Key 在整个项目中只能对应一个默认英文语义。

```tsx
// ❌ 同一个 Key 两处默认英文不一致
t('common.save', 'Save')
t('common.save', 'Save changes')
```

提取工具检测到冲突时构建直接失败（见第 15 节）。含义不同就应创建新 Key：

```tsx
t('common.save', 'Save')
t('settings.saveChanges', 'Save changes')
```

### 动态 Key 限制

禁止：

```tsx
// ❌ AST 无法静态分析完整 Key 集合
t(`status.${status}`, defaultValue)
```

推荐显式映射：

```ts
const statusText = {
  idle: () => t('status.idle', 'Idle'),
  running: () => t('status.running', 'Running'),
  success: () => t('status.success', 'Completed'),
  error: () => t('status.error', 'Failed'),
}
```

```tsx
statusText[status]()
```

这样 Key 可以被静态提取、默认英文可见、翻译工具可识别、TypeScript 也更容易提供类型检查。

---

## 11. 语言包策略

### 方案 A：不维护 en.json（默认推荐）

英文全部来源于源码 `t('key', 'Default English')`。

优点：

- 不存在双份英文。
- 开发体验最好。
- 不需要同步源码和 `en.json`。
- 默认英文天然和 UI 同步。

### 方案 B：工具生成 en.json

如果翻译平台、运营后台或 Crowdin 等工具要求提供英文源语言文件，通过提取工具（第 15 节）从源码生成：

```text
React / TypeScript Source
          ↓
    提取工具（AST）
          ↓
        en.json
          ↓
    翻译平台 / Translator
          ↓
 zh-CN / ja-JP / ...
```

**`en.json` 必须由工具生成，而不是开发者手工维护。**

### 语言包由工具统一管理

无论是 `en.json` 还是 `zh-CN.json` 等覆盖层：

1. **禁止手工向语言包新增 Key**——Key 集合以源码为准，由提取工具同步产生。
2. **失效 Key 由工具清理**——源码中删除某个 `t()` 调用后，下次同步时提取工具从各语言包中移除残留 Key，避免语言包无限膨胀。
3. 开发者手工编辑语言包的唯一场景是**修改翻译值**，而不是增删 Key。

### 中文语言包示例

```json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除"
  },
  "session": {
    "new": "新建会话",
    "rename": "重命名",
    "delete": {
      "confirm": "确定要删除这个会话吗？"
    }
  },
  "settings": {
    "title": "设置",
    "description": "管理应用偏好设置。"
  }
}
```

业务源码仍然保留默认英文：

```tsx
// ✅
t('settings.title', 'Settings')

// ❌ 不能因为已有中文语言包就省略默认英文
t('settings.title')
```

---

## 12. Source of Truth

> 默认英文文案的唯一 Source of Truth 是 React / TypeScript 源码。

```text
源码 Default English
       │
       ├── zh-CN.json
       ├── ja-JP.json
       ├── ko-KR.json
       └── ...
```

其他语言包属于覆盖层；`en.json` 如果存在，也只是源码的派生产物。

---

## 13. 国际化范围

### 必须国际化

页面标题、按钮、菜单、Tooltip、Dialog、Toast、Placeholder、Form Label / Description、Validation Message、Empty State、Error Message、Loading Text、Status Text、Table Header、ARIA Label、Accessibility Description 等一切用户可见文本。

```tsx
<Button aria-label={t('session.delete.ariaLabel', 'Delete session')}>
  ...
</Button>
```

### 不需要国际化

API 字段名、程序内部错误码、日志 Key、数据库字段、CSS class、URL、文件路径、模型名称、技术协议名称、代码标识符，例如 `GPT-5.6`、`WebSocket`、`JSON`、`SQLite`、`React`。除非产品明确需要本地化展示，否则不要翻译。

---

## 14. 静态检查

### 第一道防线：TypeScript

`useI18n()` 的 `t(key, defaultValue, options?)` 签名使 `t('key')` 单参数调用直接编译失败。

### 第二道防线：ESLint

1. **禁止业务代码直接引入 react-i18next 的 `useTranslation`**，使用 ESLint `no-restricted-imports` 强制走 `useI18n`：

   ```text
   import { useTranslation } from 'react-i18next'  // ❌ 仅限 src/i18n/ 内部
   ```

2. **JSX 硬编码文案检查**：直接使用现成插件 `eslint-plugin-i18next` 的 `no-literal-string` 规则。该规则误报率可控（支持按属性、标记白名单配置），先以 `warn` 级别启用，稳定后升为 `error`。

3. **要求 Key 为字符串字面量**：`t(variable, ...)` 破坏静态分析，禁止。可通过 `eslint-plugin-i18next` 配置或一个简单的自定义规则实现。

仅在以上现成能力不满足时再自研规则（如自定义 `require-i18n-default-value` 兜底非 TS 场景）；不要一开始就自研全套检查。

---

## 15. 自动提取与语言包同步

### 优先使用现成工具

文案提取**优先采用 i18next 官方生态工具**（`i18next-cli`，或成熟的 `i18next-parser`），它们原生支持本方案的全部约定：

- 扫描 `t('key', 'defaultValue')` 形式并生成嵌套的 `en.json`。
- 识别 `defaultValue_one` / `defaultValue_other` 并展开为复数 Key。
- 提取 `<Trans defaults="..." />`。
- **Key 冲突检测**：同一 Key 出现不同默认英文时构建失败，例如：

  ```text
  I18n key conflict:
  common.save
  Value A: Save
  Value B: Save changes
  ```

- **语言包同步**：以源码为准向各 locale 文件补齐缺失 Key、移除失效 Key（配合相应配置）。

### 自研提取器的边界

仅当官方工具无法满足需求（例如需要与内部翻译平台深度集成）时才自研 AST 提取器。自研时必须：

- 使用 TypeScript Compiler API / `@typescript-eslint/parser` / `ts-morph` / Babel parser，**禁止正则扫描 TSX**。
- 实现与官方工具等价的冲突检测和失效 Key 清理。

### 推荐流程

```text
TS / TSX 源码
   │
   ▼
提取工具（AST）
   │
   ▼
en.json（产物，不入库或入库均可，按翻译平台要求决定）
   │
   ▼
翻译平台 / 译者
   │
   ▼
zh-CN / ja-JP / ...（覆盖层，工具同步 + 人工翻译值）
```

---

## 16. TypeScript 类型增强

第一阶段允许 `key: string`，避免为了类型系统过度设计。

项目稳定后，可以从语言资源或提取产物中生成 Key 联合类型：

```ts
type I18nKey = 'common.save' | 'common.cancel' | 'session.new' | 'settings.title'
```

但不要在项目早期为了「100% Key 类型安全」引入复杂代码生成体系。优先保证：简单、稳定、可维护、开发体验好。

---

## 17. 实施顺序

### Phase 1：基础设施

- react-i18next 初始化（含 language detector、fallback 配置）。
- `useI18n` 封装（`useCallback` + 返回类型收窄 + 两参数强制的 TS 签名）。
- 语言切换 UI 与持久化。
- zh-CN locale。

业务 API 从第一天起就是：

```tsx
t('key', 'Default English')
```

复数文案从第一天起就必须使用 `defaultValue_other` 形式（第 8 节），不留存量债。

### Phase 2：静态检查（已落地 `apps/web/eslint.config.js`）

- `no-restricted-imports` 禁止业务代码直接用 `useTranslation`（仅 `src/i18n/` 豁免，`<Trans>` 不在限制内）。
- `eslint-plugin-i18next` 的 `no-literal-string` 以 `warn` 级别启用，作为存量硬编码文案的迁移盘点；迁移收敛后升级为 `error`。
- `t('key')` 裸 Key 调用由 `useI18n` 的 TS 签名在编译期拦截，无需额外规则。

### Phase 3：提取与同步（已落地 `apps/web/i18next.config.ts`）

- 接入 `i18next-cli`：`pnpm i18n:extract` 从源码生成 `en.json` 并同步各语言包（补齐缺失 Key 为空串占位、移除失效 Key、保留已有翻译）。
- `warnOnConflicts: 'error'`：同一 Key 不同默认英文直接提取失败，满足第 15 节冲突即失败的约定。
- `pnpm i18n:extract:ci`：产物过期时非零退出，供 CI 校验。
- `en.json` 仅作为翻译平台对接产物，**不在运行时加载**；运行时英文仍来自源码 `defaultValue`。注意 `extractFromComments` 必须保持 `false`，否则 JSDoc 里的示例会被误提取。

### Phase 4：质量度量（已落地）

- **冲突检查入验证流**：`apps/web` 的 `pnpm lint` 末尾执行 `i18next-cli extract --ci`，冲突或产物过期即失败（turbo lint 管线全覆盖）。注意 `--ci` 语义是「先写入更新再非零退出」，失败后提交其写入即可。
- **未翻译 Key 报告与覆盖率统计**：`pnpm i18n:status` 输出各语言进度条与缺译明细。
- **合并门禁测试**：`test/i18n-locale-sync.test.mjs` 断言 en/zh-CN Key 集合一致、zh-CN 无空值（产品主语言要求 100% 覆盖，空值会在运行时静默回退英文）。

不实现复杂的国际化管理平台；以上四个 Phase 构成本方案的完整落地。

---

## 18. 工程约定速查

```text
1.  默认语言为 English。
2.  默认英文直接写在 React / TypeScript 源码中。
3.  国际化必须使用稳定语义 Key，禁止英文文案作为 Key。
4.  业务代码统一调用 useI18n() 的 t('key', 'Default English')，
    禁止直接使用 react-i18next 的 useTranslation。
5.  禁止 t('key') 裸 Key 调用（TS 签名 + ESLint 双重拦截）。
6.  禁止 JSX 硬编码用户可见文案。
7.  复数文案必须通过 options 提供 defaultValue_other 等形式，
    禁止手写单复数拼接。
8.  默认英文是 Source of Truth；zh-CN / ja-JP 等语言包仅作为覆盖层。
9.  en.json 不由开发者手工维护；如有需要，由提取工具从源码生成。
10. 所有语言包的 Key 集合以源码为准，由提取工具同步，禁止手工增删 Key。
11. 同一个 Key 不允许对应多个不同默认英文；冲突即构建失败。
12. 禁止动态 Key，保证 AST 可静态分析。
13. JSX 富文本使用 <Trans defaults="..." />，默认英文仍保留在源码。
```

---

## 19. 结论

本项目不采用传统的 `t('session.new')` 加 `locales/en.json` 查找文案的方式，统一采用：

```tsx
t('session.new', 'New session')
```

从而同时获得：源码可读性、稳定国际化 Key、语言 fallback、默认英文 fallback、自动提取能力、翻译平台兼容、更好的开发体验。

这是本项目 React 国际化的默认工程规范。
