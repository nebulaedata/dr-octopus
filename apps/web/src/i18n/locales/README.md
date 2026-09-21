# locales 目录说明

- **`en.json` 是生成产物**：由 `pnpm i18n:extract`（i18next-cli）从源码中的 `t('key', 'Default English')` 调用自动提取，供翻译平台/译者使用。**不要手工编辑，它也不会在运行时被加载**——英文文案的唯一 Source of Truth 是源码里的 `defaultValue`。
- **`zh-CN.json` 是覆盖层**：Key 集合由提取工具同步（新增空串占位、删除失效 Key），开发者只翻译值。值为空串时运行时自动回退到源码默认英文。
- 冲突防护：同一 Key 出现不同默认英文时 `i18n:extract` 直接失败（`warnOnConflicts: 'error'`）。
- 覆盖率报告：`pnpm i18n:status` 查看各语言翻译进度和未翻译 Key 明细。
- 验证门禁：`pnpm lint` 末尾带 `i18next-cli extract --ci`，产物过期即失败（注意：`--ci` 会先把更新写入磁盘再退出非零，失败后直接提交这些更新即可）；`test/i18n-locale-sync.test.mjs` 保证 en/zh-CN Key 集合一致且 zh-CN 无未翻译空值。

详见 `docs/architecture/react-i18next-default-english-guide.md`。
