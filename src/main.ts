#!/usr/bin/env bun
// Entry point for Agent Link.
//
// When invoked as `agent-link somefile.js ...args`, acts as a Bun JS runner.
// This lets the compiled binary double as the runtime for the embedded Claude CLI
// on machines where bun/node is not installed.

if (process.argv[2]?.endsWith(".js") || process.argv[2]?.endsWith(".mjs")) {
  await import(process.argv[2]);
} else {
  await import("./cli");
}
