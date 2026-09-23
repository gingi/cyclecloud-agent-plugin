# Changelog

## [0.4.0]

- Clarifies how to install the plugin without Git checkout (#15)
- Promotes verified releases to stable (#16, #17, #18)

## [0.3.0]

- Replace MCP runtime with an agent plugin backed by the `cyclecloud` CLI (#12)

## [0.2.0]

First public release.

- Inspect clusters, capacity, and node issues through four read-only CycleCloud
  MCP tools. Lifecycle mutations remain disabled by default.
- Install into Copilot CLI and VS Code from checksum-verified release assets,
  with interactive CycleCloud configuration
  ([#1](https://github.com/gingi/cyclecloud-mcp/pull/1),
  [#4](https://github.com/gingi/cyclecloud-mcp/pull/4)).
- Use cluster context to draft and locally validate CycleCloud application
  projects with the included authoring skill
  ([#3](https://github.com/gingi/cyclecloud-mcp/pull/3)).
