# Shared UI Guidelines

`packages/ui` contains shadcn/ui-installed primitives shared by every application. Do not edit files under `src/components/` directly. Customize appearance or behavior through props, `className`, or feature/app-level wrappers. Install official shadcn/ui components into this package through the registry CLI rather than copying component sources manually.
