# Core Launcher - Specifications & Test Requirements

## Goal
Shared foundation for launcher architectures.

## Requirements
- [ ] **Shared Libraries**: Must contain all shared libraries, UI components, and generic logic consumed by both claude-loader and opencode-loader.

## Architectural Notes
- **Dynamic UI**: Relies heavily on 	ui.js, which dynamically switches context between OpenCode and Claude Code by reading environment variables like process.env.HUB_APP_NAME.
