/**
 * @author Codex
 * @description Reports versions from the fixed build-time Electron distribution without opening windows or loading the Executor; this script is never shipped in the product.
 */
const { app } = require('electron');
app.setPath('userData', process.argv[2]);
console.log(
  'EXECUTOR_BUILD_VERSIONS=' +
    JSON.stringify({
      version: process.versions.electron,
      node: process.versions.node,
      moduleAbi: process.versions.modules,
    })
);
app.quit();
