# Web development

## Executor download entry

The Workbench sidebar contains the Executor promotion. The whole card opens the download dialog; its separate close control hides the card until a full page reload. Dismissal survives sidebar remounts and route changes without writing browser storage. Dialog visibility is held in the validated `executorDownload` URL search parameter, so refreshing an open dialog preserves it.

Copy `.env.example` to `.env` in this directory, and configure the public artifact links:

| Variable                              | Meaning                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `VITE_EXECUTOR_VERSION`               | Executor artifact version, independent from the Web release; defaults to `0.0.1`. |
| `VITE_EXECUTOR_WINDOWS_INSTALLER_URL` | Exact Windows x64 installer URL.                                                  |
| `VITE_EXECUTOR_WINDOWS_ZIP_URL`       | Exact complete Windows x64 ZIP URL.                                               |

Use public HTTP(S) URLs without embedded credentials, or same-origin absolute paths such as `/downloads/executor.zip`. Relative paths and invalid URLs remain unavailable. If only a ZIP is configured, it becomes the primary download. If neither link is configured, the dialog explains that downloads have not opened and disables the download action. The Web does not host, sign, publish, or verify these artifacts and does not infer that a download has completed or that Executor is connected.

`VITE_*` values are public build-time configuration. Restart Vite after editing environment files; rebuild and redeploy production assets after changing release links. The current UI identifies the distribution as an unsigned acceptance build, matching [Executor installation status](../executor/INSTALLATION.md). Publishing a validated signed release also requires updating that status and its UI notice; changing the version or URL alone must not imply release acceptance.

The installation guide remains owned by [Executor](../executor/INSTALLATION.md). Keep client-configuration and browser-extension instructions there rather than duplicating them in Web documentation. The dialog links to the published repository guide and opens the existing route-masked MCP settings flow.
