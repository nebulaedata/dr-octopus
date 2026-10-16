/**
 * @author Codex
 * @description Builds the finite Windows x64 Node-API v8 addon using an explicitly supplied fixed header cache.
 */
import { executorTarget } from '../lib/platform.mjs';
import { assertNativeOutputsWritable, runNativeCommand as run } from '../lib/compile/native-build.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserIdentity } from '../../../browser-extension/scripts/lib/browser-identity.mjs';
import { prepareBrowserIdentity } from '../lib/compile/browser-identity.mjs';
/**
 * Quotes only trusted build paths for a generated batch file; unsafe metacharacters reject rather than expand.
 */
function batchPath(path) {
  if (/["%\r\n&|<>^!]/.test(path)) {
    throw new Error('Build path contains unsupported batch characters.');
  }
  return `"${path}"`;
}
/**
 * Requires the fixed Node development cache and MSVC; never downloads or compiles at application startup.
 * Node-API v8 plus delay-load supports Node/Electron loading; actual Electron compatibility is tested separately.
 */
export async function buildNative(identity = loadBrowserIdentity()) {
  executorTarget();
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  await assertNativeOutputsWritable(root);
  const headers =
    process.env.EXECUTOR_NODE_HEADERS ?? join(homedir(), 'AppData', 'Local', 'node-gyp', 'Cache', '24.20.0');
  const library = join(headers, 'x64', 'node.lib');
  const libraryHash = createHash('sha256')
    .update(await readFile(library))
    .digest('hex');
  if (libraryHash !== '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9') {
    throw new Error('Fixed Node 24.20.0 x64 import library hash mismatch.');
  }
  const headerHashes = {
    'node_api.h': '2d4560831e525b47b060ec8a0864ab73993df9e20215ce9f0fe7b24cd31af32a',
    'js_native_api.h': '8808ef8899a1691411928ef5dd7dae0537aedc93d3a34e223b2d89692e79c788',
    'node_api_types.h': 'a25356630d3058f0a0c8937d9f297e9471e037fda58c2696d8a505c2bd99cb00',
    'js_native_api_types.h': '4f19cb90d240765cc0961d92a1ee20f65fdc50db7de1ab0a5cb6bc227224e1a0',
  };
  for (const [name, expected] of Object.entries(headerHashes)) {
    const actual = createHash('sha256')
      .update(await readFile(join(headers, 'include', 'node', name)))
      .digest('hex');
    if (actual !== expected) {
      throw new Error(`Fixed Node header hash mismatch: ${name}`);
    }
  }
  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? '',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  );
  const installation = (
    await run(
      vswhere,
      [
        '-utf8',
        '-products',
        '*',
        '-latest',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ],
      root
    )
  ).trim();
  if (!installation) {
    throw new Error('MSVC x64 Build Tools are required for development builds.');
  }
  const output = join(root, 'build', 'native');
  await mkdir(output, { recursive: true });
  await prepareBrowserIdentity(identity);
  const script = join(output, 'compile.cmd');
  const command = [
    '@echo off',
    'chcp 65001 >nul',
    'if errorlevel 1 exit /b 1',
    `call ${batchPath(join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))} >nul`,
    'if errorlevel 1 exit /b 1',
    'chcp 65001 >nul',
    'if errorlevel 1 exit /b 1',
    'set VSLANG=1033',
    `cl /nologo /std:c++17 /EHsc /O2 /MD /utf-8 /LD /DNAPI_VERSION=8 /DBUILDING_NODE_EXTENSION /DNODE_GYP_MODULE_NAME=stdio_exit /I${batchPath(join(headers, 'include', 'node'))} ${batchPath(join(root, 'native', 'stdio-exit.cpp'))} /Fo${batchPath(join(output, 'stdio-exit.obj'))} /link ${batchPath(library)} kernel32.lib delayimp.lib /DELAYLOAD:node.exe /OUT:${batchPath(join(output, 'stdio-exit.node'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MD /utf-8 /LD /DNAPI_VERSION=8 /DBUILDING_NODE_EXTENSION /DNODE_GYP_MODULE_NAME=computer_escape /I${batchPath(join(headers, 'include', 'node'))} ${batchPath(join(root, 'native', 'computer-escape.cpp'))} /Fo${batchPath(join(output, 'computer-escape.obj'))} /link ${batchPath(library)} kernel32.lib user32.lib delayimp.lib /DELAYLOAD:node.exe /OUT:${batchPath(join(output, 'computer-escape.node'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MD /utf-8 /LD /DNAPI_VERSION=8 /DBUILDING_NODE_EXTENSION /DNODE_GYP_MODULE_NAME=file_commit /I${batchPath(join(headers, 'include', 'node'))} ${batchPath(join(root, 'native', 'file-commit.cpp'))} /Fo${batchPath(join(output, 'file-commit.obj'))} /link ${batchPath(library)} kernel32.lib advapi32.lib bcrypt.lib delayimp.lib /DELAYLOAD:node.exe /OUT:${batchPath(join(output, 'file-commit.node'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 ${batchPath(join(root, 'native', 'process-supervisor.cpp'))} /Fo${batchPath(join(output, 'process-supervisor.obj'))} /link kernel32.lib /OUT:${batchPath(join(output, 'process-supervisor.exe'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 /I${batchPath(output)} ${batchPath(join(root, 'native', 'browser-launcher.cpp'))} /Fo${batchPath(join(output, 'browser-launcher.obj'))} /link kernel32.lib /OUT:${batchPath(join(output, 'browser-launcher.exe'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 ${batchPath(join(root, 'native', 'computer-supervisor.cpp'))} /Fo${batchPath(join(output, 'computer-supervisor.obj'))} /link kernel32.lib /OUT:${batchPath(join(output, 'computer-supervisor.exe'))}`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 ${batchPath(join(root, 'native', 'mcp-launcher.cpp'))} /Fo${batchPath(join(output, 'mcp-launcher.obj'))} /link kernel32.lib /OUT:${batchPath(join(output, 'mcp-launcher.exe'))}`,
    'exit /b %errorlevel%',
  ].join('\r\n');
  await writeFile(script, command);
  const diagnostics = await run(
    process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
    ['/d', '/c', script],
    output
  );
  process.stdout.write(diagnostics);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildNative();
}
