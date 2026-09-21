# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## 环境变量

前端配置独立放在 `apps/web`，Vite 使用项目目录作为默认环境文件目录，不读取仓库根 `.env`。

在仓库根目录执行：

```powershell
Copy-Item apps/web/.env.example apps/web/.env
pnpm --filter @octopus/web dev
```

`apps/web/.env` 为所有模式共用配置；可用 `.env.development` / `.env.production` 分别覆盖开发 / 生产构建配置，或用 `.env.local` / `.env.[mode].local` 保存本机覆盖。已有进程环境的优先级最高。实际环境文件由 Git 忽略，只提交 `.env.example`。

附件大小和数量由后端校验；单文件上限通过 `SERVER_ATTACHMENT_LIMIT_BYTES` 配置。前端不配置或预先拦截附件大小、数量和总量，上传或发送失败时展示后端错误。

`VITE_*` 会在构建时写入浏览器资源，只用于公开配置。开发时修改文件后重启 Vite；发布后修改环境文件不会改变已有资源，必须重新构建并部署。它们不由 Settings 或 `environment.json` 管理。详见 [Vite 环境变量文档](https://vite.dev/guide/env-and-mode)。

Web 的 Turbo 构建输入包含本目录 `.env`、`.env.*` 和 `VITE_*` 进程变量，修改后会使前端构建缓存失效。

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x';
import reactDom from 'eslint-plugin-react-dom';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```
