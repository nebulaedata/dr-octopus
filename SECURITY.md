# Security Policy

Dr.Octopus is a local-first Agent application. Its tools can access files, run commands, call model services, and load extensions and MCP services. Understand these capabilities before using or deploying it.

## Reporting a Vulnerability

Do not disclose exploit details for unpatched vulnerabilities, real credentials, or user data in public issues, pull requests, discussions, or log attachments.

Submit a private report through **Security → Advisories → Report a vulnerability** in the official GitHub repository. Maintainers must enable private vulnerability reporting for this option to appear. If it is unavailable, open an issue requesting only a private contact channel, without vulnerability details, and wait for a maintainer to provide one before sending the report.

Please include:

- The affected version or commit, operating system, Node.js version, and runtime mode, such as TUI, Web, or Gateway.
- The listening address, access method, permission settings, and extensions needed to reproduce the issue, with all credentials redacted.
- Minimal reproduction steps using synthetic data, along with expected and actual behavior.
- Attack prerequisites, potential impact, and redacted logs or a proof of concept.
- Suggested fixes, if available. You do not need to open a public pull request first.

Test only environments you own or are authorized to assess. Avoid accessing other people's data, damaging files, or testing public instances without permission. Coordinate disclosure timing with the maintainers. The project currently offers no guaranteed response time or bug bounty.

## Versions and Fixes

Security fixes prioritize the latest release and the current development branch. Backports to older versions are not guaranteed, and there is no long-term support release. Include the affected version in your report. Where practical, verify the latest version in an isolated environment; do not perform dangerous operations on production data to reproduce an issue.

## Deployment and Trust Boundaries

- **The default is local, single-user operation.** Keep `SERVER_HOST=127.0.0.1`. Do not expose the Gateway, Server, or Vite development server directly to the internet or an untrusted local network.
- **Origin validation is not authentication.** CORS, Host/Origin checks, rate limiting, and the CLI's local process identity checks do not replace user authentication and authorization for Web APIs.
- **Remote access requires additional protection.** If needed, the operator must provide authentication, encrypted transport, and network access restrictions covering HTTP, WebSocket, SSE, and related service endpoints. Prevent direct backend access that bypasses the proxy.
- **A Workspace is not an operating system sandbox.** Tools, subprocesses, and extensions may have the permissions of the OS user running the application. Do not run untrusted tasks as an administrator or root. For stronger isolation, use a separate account, container, or virtual machine and restrict access to files, networks, and credentials.
- **Extensions and content have different trust levels.** Extensions, installation scripts, and MCP services can execute code. Model output, web pages, attachments, and repository content may contain malicious instructions. Verify extension sources before installation and review tool arguments and permissions before high-impact operations.
- **Local-first does not mean data never leaves your machine.** Configured model providers, MCP services, and tools may receive prompts, files, or retrieved content. Review how they handle data before use. Offline startup options do not provide OS-level network isolation.

## Credentials and Diagnostic Data

Keep API keys, OAuth tokens, npm tokens, and similar secrets in local configuration or protected environments. Do not commit them to the repository. `.gitignore` cannot remove secrets already present in Git history.

Runtime data defaults to `~/.dr-octopus/` under the user's home directory. Treat sessions, model configuration, attachments, knowledge bases, memory, logs, and backups as sensitive data. The same applies to custom data directories.

Before sharing diagnostics, inspect and remove credentials, personal paths, model service addresses, prompts, and file contents. Do not upload an entire data directory or a real database.

If credentials are exposed, revoke or rotate them with the provider first, then address logs, repository history, and other copies. If you suspect unauthorized access, restrict access to the service and preserve appropriately protected diagnostic information for investigation.
