#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// Load config from mdr.config.js
function loadConfig() {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "mdr.config.js");

  if (!fs.existsSync(configPath)) {
    console.error(
      `${RED}Error: mdr.config.js not found in current directory${RESET}`
    );
    console.error("\nCreate a config file with at least:");
    console.error(`
// mdr.config.js
module.exports = {
  templatesDir: "./templates",
  outputDir: "./out",
};
`);
    process.exit(1);
  }

  // Load the config
  const config = require(configPath);

  // Validate required fields
  const configName = path.basename(configPath);
  if (!config.templatesDir) {
    console.error(
      `${RED}Error: templatesDir is required in ${configName}${RESET}`
    );
    process.exit(1);
  }

  if (!config.outputDir) {
    console.error(
      `${RED}Error: outputDir is required in ${configName}${RESET}`
    );
    process.exit(1);
  }

  // Apply defaults
  return {
    templatesDir: config.templatesDir,
    outputDir: config.outputDir,
    ignore: config.ignore || [],
    debounceMs: config.debounceMs ?? 100,
  };
}

function printUsage() {
  console.log(`
Usage: mdr <command>

Commands:
  render    Render all .mdoc files (output files must already exist)
  watch     Watch for changes and render automatically
  push      Create/update all output files (creates missing .g.md files)

Configuration:
  Create mdr.config.js in your project root:

  // mdr.config.js
  module.exports = {
    templatesDir: "./templates",  // Required: where .mdoc files are
    outputDir: "./out",           // Required: where .g.md files go
    ignore: ["drafts"],           // Optional: directories to skip
    debounceMs: 100,              // Optional: watch debounce (default: 100)
  };
`);
}

// Main
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

const validCommands = ["render", "watch", "push"];
if (!validCommands.includes(command)) {
  console.error(`${RED}Error: Unknown command '${command}'${RESET}`);
  printUsage();
  process.exit(1);
}

const config = loadConfig();
const { render, watch, push } = require("../lib/render.js");

switch (command) {
  case "render":
    render(config);
    break;
  case "watch":
    watch(config);
    break;
  case "push":
    push(config);
    break;
}
