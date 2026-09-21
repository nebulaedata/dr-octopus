# Pi Package Contract Reference

## Contents

- Package purpose and structure
- Manifest and convention discovery
- Extension entry contract
- Dependency rules
- Published artifact boundary
- Sources and installation
- Scope, identity, and precedence
- Resource filtering and configuration
- Security and release discipline
- Validation checklist

## Package purpose and structure

A Pi package is an npm-, git-, or local-path-distributed bundle of one or more resource types:

- extensions (`.ts` or `.js`);
- skills (`SKILL.md` directories or supported Markdown skills);
- prompt templates (`.md`);
- themes (`.json`).

Pi does not require a particular repository location or internal layering. A minimal package can be:

```text
my-pi-package/
├── package.json
└── extensions/
    └── index.ts
```

A larger package may add source modules, tests, build configuration, skills, prompts, and themes. Choose source TypeScript or built JavaScript intentionally:

- source `.ts` reduces publishing setup because Pi's loader supports TypeScript;
- built `.js` gives a conventional compilation boundary but requires build and files/publish configuration to stay aligned;
- do not publish both accidentally or point the manifest at files excluded from the tarball.

## Manifest and convention discovery

Prefer an explicit `pi` manifest for published packages:

```json
{
  "name": "@scope/example-pi-package",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Manifest paths are package-root-relative. Resource arrays accept glob patterns and `!` exclusions. Declare only resource types the package actually supplies; empty arrays are unnecessary in the package manifest.

Without a `pi` manifest, Pi discovers conventional root directories:

- `extensions/`: `.ts` and `.js` files;
- `skills/`: folders containing `SKILL.md`, recursively, plus supported top-level Markdown skills;
- `prompts/`: `.md` files;
- `themes/`: `.json` files.

Use the `pi-package` keyword for public gallery discovery. Optional `pi.image` supports PNG, JPEG, GIF, or WebP; `pi.video` supports MP4 and takes precedence when both are present. Preview metadata is optional and should use stable public URLs.

## Extension entry contract

Every declared extension path must resolve inside the installed package and default-export a supported factory:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function extension(pi: ExtensionAPI) {
  // Register events, tools, commands, renderers, shortcuts, flags, or providers.
}
```

Do not require a proprietary host bootstrap, global singleton, shared module cache, or undeclared environment mutation to import the entry. Environment variables and external services may be legitimate runtime configuration, but validate them lazily and report missing configuration clearly.

## Dependency rules

Put every ordinary package required at runtime in `dependencies`. Pi's npm/git installation flows use production-oriented installation behavior, so `devDependencies` cannot be assumed available to a distributed extension at runtime.

Pi provides these core packages to loaded resources:

- `@earendil-works/pi-ai`;
- `@earendil-works/pi-agent-core`;
- `@earendil-works/pi-coding-agent`;
- `@earendil-works/pi-tui`;
- `typebox`.

For each core package actually imported, declare a `peerDependencies` entry with range `"*"` and do not bundle it. Keep the version used for local compilation and testing in `devDependencies` when needed. Do not automatically declare unused core peers.

Example:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "<tested-version>",
    "typebox": "<tested-version>",
    "typescript": "<tested-version>"
  },
  "dependencies": {
    "some-runtime-library": "^1.2.3"
  }
}
```

Pi packages are isolated by module root. Separately installed packages do not share modules or runtime state. If one Pi package incorporates resources from another, add the other package to both `dependencies` and `bundledDependencies`, ensure it ships inside the tarball, and declare its resources explicitly through `node_modules/<package>/...` manifest paths.

Do not use this bundling pattern merely to call an ordinary library API; normal libraries belong in `dependencies`.

## Published artifact boundary

Before release, inspect what npm will actually publish:

```bash
npm pack --dry-run
```

Verify:

- every `pi` manifest target is present;
- built entry paths match the compiler output;
- skills include their `SKILL.md` and referenced resources;
- prompts and themes are included;
- runtime dependencies are declared;
- bundled Pi packages and referenced `node_modules` resources are present;
- tests, fixtures, secrets, local caches, and unnecessary source maps are excluded as intended;
- package exports, `files`, `.npmignore`, and build cleanup do not remove required resources.

If publishing built files, run the build before packing and test the tarball boundary rather than the workspace source tree alone.

## Sources and installation

Pi accepts npm, git, and local sources:

```bash
pi install npm:@scope/package@1.2.3
pi install git:github.com/org/repo@v1
pi install https://github.com/org/repo@v1
pi install /absolute/path/to/package
pi install ./relative/path/to/package
```

Use `pi -e <source>` to try a file or package for the current run without persisting an install. Local path sources remain references to disk rather than copies; relative local paths resolve from the settings file containing them.

Management commands include:

```bash
pi list
pi remove <source>
pi update <source>
pi update --extensions
pi update --all
pi config
pi config -l
```

Versioned npm specs are pinned and skipped by bulk package updates. Git tags and commits are pinned; bulk updates reconcile the clone to the configured ref but do not move it to a newer ref. Install a new ref explicitly to change the pin.

For CI using private git sources, configure non-interactive git authentication and fail-fast behavior outside the package rather than embedding credentials in source or settings.

## Scope, identity, and precedence

By default, install and remove commands write user settings at `~/.pi/agent/settings.json`. `-l` targets project settings at `.pi/settings.json`. Project settings may be committed and missing packages install on startup only after the project is trusted.

The same package can appear in both scopes. Identity is determined by:

- npm: package name;
- git: repository URL without the ref;
- local: resolved absolute path.

The project entry normally wins. A project entry with `autoload: false` acts as a delta over the global entry instead of replacing it. Account for this when diagnosing resources that unexpectedly load or remain disabled.

Do not persist validation installs into a user's normal global or project settings unless requested. Prefer `pi -e`, a temporary test directory, or isolated configuration.

## Resource filtering and configuration

Settings accept a package source string or an object with per-resource filters:

```json
{
  "packages": [
    "npm:simple-package",
    {
      "source": "npm:filtered-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

Interpret filters exactly:

- omit a resource key to load all resources of that type allowed by the manifest;
- use `[]` to load none of that type;
- use `!pattern` to exclude glob matches;
- use `+path` to force-enable one exact package-relative path;
- use `-path` to force-disable one exact package-relative path.

Filters layer on top of the package manifest and normally narrow it; they do not turn arbitrary undeclared files into resources. Use `pi config` for interactive enable/disable management. `pi config` starts in global scope, while `pi config -l` starts in project overrides with inherited global resources visible.

## Security and release discipline

Treat every Pi package as executable trust material. Extensions run arbitrary code with the user's permissions, and skills can direct the model to execute commands. Before recommending or installing a third-party package:

1. identify the exact source and pin where reproducibility matters;
2. inspect its manifest, extension entries, install scripts, dependencies, and resource files;
3. check for credential access, shell execution, network calls, dynamic code loading, and broad filesystem writes;
4. explain material permissions or side effects;
5. install only after the source is trusted under the user's policy.

Keep package initialization side-effect-free. Avoid postinstall scripts unless unavoidable and clearly documented. Never publish credentials, local settings, session data, or machine-specific paths.

## Validation checklist

Use the relevant subset, but do not skip distribution checks for a package intended to be shared:

1. Confirm the artifact type and supported Pi version.
2. Typecheck and run focused tests.
3. Build if manifest paths target generated output.
4. Inspect `npm pack --dry-run` and, when risk warrants, install the produced tarball in an isolated directory.
5. Load every declared extension entry in a clean Pi process.
6. Exercise one representative tool, command, or event behavior.
7. Verify interactive features degrade safely when `ctx.hasUI` is false.
8. Exercise `session_start`, reload or replacement when relevant, and repeated `session_shutdown`.
9. Confirm no leaked child process, socket, watcher, interval, or file handle remains.
10. Test npm/git/local installation semantics required by the release target.
11. Verify resource filters and user/project precedence when the package exposes multiple resources.
12. Review the final tarball for secrets and undeclared runtime assumptions.
