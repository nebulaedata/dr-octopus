/**
 * @author Codex
 * @description Presents a native development-build conflict choice without loading Executor addons or changing running tasks.
 */
import { app, dialog } from 'electron';
app.setName('Executor 开发启动');
app.setPath('userData', process.argv[2]);
await app.whenReady();
const choice = await dialog.showMessageBox({
  type: 'info',
  title: 'Executor 正在运行',
  message: '已有程序正在使用 Executor 的构建文件',
  detail:
    '可以继续使用已运行的执行器；本次代码不会重新构建。\n\n如需加载最新代码，请先从系统托盘完整退出执行器，并停止使用此构建目录的适配器，再点击“重新检查并构建”。仅关闭窗口可能仍在后台运行。\n\n不会自动终止任务或其他进程。若程序已退出仍提示占用，请检查目录写入权限。',
  buttons: ['继续使用已有执行器', '重新检查并构建', '取消'],
  defaultId: 0,
  cancelId: 2,
  noLink: true,
});
app.exit(choice.response === 0 ? 10 : choice.response === 1 ? 11 : 12);
