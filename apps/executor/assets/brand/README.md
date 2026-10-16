# Executor 品牌图标

复用现有 Dr.Octopus Web 品牌资源，保持 PNG/ICO 原字节，不在线生成或转换：

- `app.ico`：来自 `apps/web/public/brand/favicon.ico`，包含 16、32、48、64、128、256 px 六档图像，用于窗口、任务栏、托盘、EXE、安装程序及卸载程序。
- `preview.png`：来自 `apps/web/public/brand/logo-256.png`，用于源码与验证文档预览，不进入运行包。

Executor 持有独立资源副本；普通 build/package/start 不读取 Web 应用目录，也不依赖 Web 构建。后续品牌资源更新时显式同步并验证，不能在产品启动时转换或下载。
