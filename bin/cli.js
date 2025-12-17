#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// Supported config file names in priority order
const CONFIG_FILES = ["mdr.config.ts", "mdr.config.js"];

// Load config from mdr.config.ts or mdr.config.js
function loadConfig() {
  const cwd = process.cwd();

  // Find config file
  let configPath = null;
  for (const configFile of CONFIG_FILES) {
    const candidate = path.join(cwd, configFile);
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    console.error(
      `${RED}Error: mdr.config.ts or mdr.config.js not found in current directory${RESET}`
    );
    console.error("\nCreate a config file with at least:");
    console.error(`
// mdr.config.ts
export default {
  templatesDir: "./templates",
  outputDir: "./out",
};

// or mdr.config.js
module.exports = {
  templatesDir: "./templates",
  outputDir: "./out",
};
`);
    process.exit(1);
  }

  // For TypeScript config, try to use tsx or ts-node if available
  const isTypeScript = configPath.endsWith(".ts");
  let config;

  if (isTypeScript) {
    // Try to register TypeScript support
    try {
      // Try tsx first (faster, more modern)
      require("tsx/cjs");
    } catch {
      try {
        // Fall back to ts-node
        require("ts-node/register/transpile-only");
      } catch {
        console.error(
          `${RED}Error: TypeScript config requires 'tsx' or 'ts-node' to be installed${RESET}`
        );
        console.error("\nInstall one of:");
        console.error("  npm install -D tsx");
        console.error("  npm install -D ts-node typescript");
        console.error("\nOr use mdr.config.js instead.");
        process.exit(1);
      }
    }
  }

  // Load the config
  const loaded = require(configPath);
  config = loaded.default || loaded;

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
  Create mdr.config.ts or mdr.config.js in your project root:

  // mdr.config.ts
  export default {
    templatesDir: "./templates",  // Required: where .mdoc files are
    outputDir: "./out",           // Required: where .g.md files go
    ignore: ["drafts"],           // Optional: directories to skip
    debounceMs: 100,              // Optional: watch debounce (default: 100)
  };

  Note: TypeScript config requires 'tsx' or 'ts-node' to be installed.
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
