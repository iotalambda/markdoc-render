const Markdoc = require("@markdoc/markdoc");
const fs = require("fs");
const path = require("path");

// ANSI color codes
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// Build an index of elements by id/class and their list positions
function buildRefIndex(ast) {
  const index = {};

  function walk(node, context = { listStack: [] }) {
    if (!node || typeof node !== "object") return;

    const isTag = node.type === "tag";
    const tagName = node.tag;
    const attrs = node.attributes || {};

    // Track list context
    let newContext = context;
    if (isTag && tagName === "ol") {
      newContext = {
        listStack: [...context.listStack, { id: attrs.id, liIndex: 0 }],
      };
    }

    // Index list items
    if (isTag && tagName === "li") {
      const currentList = newContext.listStack[newContext.listStack.length - 1];
      if (currentList) {
        currentList.liIndex++;
        const marker = currentList.liIndex;

        // Index by class
        if (attrs.cl) {
          const classes = attrs.cl.split(/\s+/);
          for (const cls of classes) {
            const key = currentList.id
              ? `#${currentList.id} .${cls}`
              : `.${cls}`;
            index[key] = { marker };
          }
        }

        // Index by id
        if (attrs.id) {
          const key = currentList.id
            ? `#${currentList.id} #${attrs.id}`
            : `#${attrs.id}`;
          index[key] = { marker };
        }
      }
    }

    // Recurse into children
    const children = node.children || [];
    for (const child of children) {
      walk(child, newContext);
    }
  }

  walk(ast);
  return index;
}

// Extract partial file references from AST
function extractPartialRefs(ast, baseDir) {
  const partials = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (node.type === "tag" && node.tag === "partial") {
      const file = node.attributes?.file;
      if (file) {
        const fullPath = path.resolve(baseDir, file);
        partials.add(fullPath);
      }
    }

    const children = node.children || [];
    for (const child of children) {
      walk(child);
    }
  }

  walk(ast);
  return partials;
}

// Build a map of partial -> mdoc files that use it
function buildPartialDependencyMap(mdocFiles) {
  const map = new Map(); // partial path -> Set of mdoc paths

  for (const mdocPath of mdocFiles) {
    const source = fs.readFileSync(mdocPath, "utf-8");
    const ast = Markdoc.parse(source);
    const baseDir = path.dirname(mdocPath);
    const partials = extractPartialRefs(ast, baseDir);

    for (const partial of partials) {
      if (!map.has(partial)) {
        map.set(partial, new Set());
      }
      map.get(partial).add(mdocPath);
    }
  }

  return map;
}

// Create config with ref function that uses the index
function createMarkdocConfig(refIndex, baseDir) {
  return {
    tags: {
      ol: {
        render: "ol",
        attributes: {
          id: { type: String },
        },
      },
      li: {
        render: "li",
        attributes: {
          id: { type: String },
          cl: { type: String },
        },
      },
      partial: {
        render: "partial",
        selfClosing: true,
        attributes: {
          file: { type: String, required: true },
        },
        transform(node) {
          const file = node.attributes.file;
          const filePath = path.resolve(baseDir, file);

          if (!fs.existsSync(filePath)) {
            console.warn(`Partial not found: ${filePath}`);
            return null;
          }

          const source = fs.readFileSync(filePath, "utf-8");
          const ast = Markdoc.parse(source);

          // Build ref index for partial (merge with parent)
          const partialRefIndex = buildRefIndex(ast);
          const mergedRefIndex = { ...refIndex, ...partialRefIndex };

          // Create config for partial with its own base dir
          const partialBaseDir = path.dirname(filePath);
          const partialConfig = createMarkdocConfig(mergedRefIndex, partialBaseDir);

          return Markdoc.transform(ast, partialConfig);
        },
      },
    },
    functions: {
      liRef: {
        transform(parameters) {
          const selector = parameters[0];
          const data = refIndex[selector];
          return data?.marker ?? "?";
        },
      },
    },
  };
}

// Custom Markdown renderer
function renderToMarkdown(node, context = { indent: "", listStack: [] }) {
  if (node === null || node === undefined) {
    return "";
  }

  // Handle primitive values (strings, numbers from functions like liRef)
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (typeof node === "boolean") {
    return node ? "true" : "false";
  }

  // Handle arrays
  if (Array.isArray(node)) {
    return node.map((child) => renderToMarkdown(child, context)).join("");
  }

  // Must be an object (RenderableTreeNode)
  if (typeof node !== "object") {
    return "";
  }

  const { name, attributes = {}, children = [] } = node;

  // Render children helper
  const renderChildren = (ctx = context) =>
    children.map((child) => renderToMarkdown(child, ctx)).join("");

  switch (name) {
    // Document wrapper
    case "article":
      return renderChildren();

    // Headings
    case "h1":
      return `# ${renderChildren()}\n\n`;
    case "h2":
      return `## ${renderChildren()}\n\n`;
    case "h3":
      return `### ${renderChildren()}\n\n`;
    case "h4":
      return `#### ${renderChildren()}\n\n`;
    case "h5":
      return `##### ${renderChildren()}\n\n`;
    case "h6":
      return `###### ${renderChildren()}\n\n`;

    // Paragraphs
    case "p": {
      // Check if this p contains list items (Markdoc sometimes wraps li in p)
      const hasListItems = children.some((c) => c?.name === "li");
      if (hasListItems) {
        // Filter out whitespace-only strings and render only the li elements
        const listItems = children.filter(
          (c) => c?.name === "li" || c?.name === "ol" || c?.name === "ul"
        );
        return listItems.map((child) => renderToMarkdown(child, context)).join("") + "\n";
      }

      const content = renderChildren().trim();
      if (!content) return "";
      return `${context.indent}${content}\n\n`;
    }

    // Text formatting
    case "strong":
      return `**${renderChildren()}**`;
    case "em":
      return `*${renderChildren()}*`;
    case "s":
      return `~~${renderChildren()}~~`;
    case "code":
      return `\`${renderChildren()}\``;

    // Links and images
    case "a": {
      const href = attributes.href || "";
      const title = attributes.title ? ` "${attributes.title}"` : "";
      return `[${renderChildren()}](${href}${title})`;
    }
    case "img": {
      const src = attributes.src || "";
      const alt = attributes.alt || "";
      const title = attributes.title ? ` "${attributes.title}"` : "";
      return `![${alt}](${src}${title})`;
    }

    // Code blocks
    case "pre": {
      // Usually contains a <code> with language class
      const codeChild = children.find((c) => c?.name === "code");
      if (codeChild) {
        const lang = codeChild.attributes?.["data-language"] || "";
        const code = codeChild.children
          .map((c) =>
            typeof c === "string" ? c : renderToMarkdown(c, context)
          )
          .join("");
        return `\`\`\`${lang}\n${code}\`\`\`\n\n`;
      }
      return `\`\`\`\n${renderChildren()}\`\`\`\n\n`;
    }

    // Blockquote
    case "blockquote": {
      const content = renderChildren({ ...context, indent: "> " });
      return (
        content
          .split("\n")
          .map((line) => (line.trim() ? `> ${line}` : ">"))
          .join("\n") + "\n\n"
      );
    }

    // Horizontal rule
    case "hr":
      return "---\n\n";

    // Line breaks
    case "br":
      return "  \n";

    // Lists - ordered
    case "ol": {
      const newContext = {
        ...context,
        listStack: [...context.listStack, { type: "ol", index: 0 }],
      };
      const items = children
        .map((child) => renderToMarkdown(child, newContext))
        .join("");
      return items;
    }

    // Lists - unordered
    case "ul": {
      const newContext = {
        ...context,
        listStack: [...context.listStack, { type: "ul", index: 0 }],
      };
      const items = children
        .map((child) => renderToMarkdown(child, newContext))
        .join("");
      return items;
    }

    // List items
    case "li": {
      const currentList = context.listStack[context.listStack.length - 1];
      const depth = context.listStack.length - 1;
      const indent = "   ".repeat(depth);

      let marker;
      if (currentList?.type === "ol") {
        currentList.index++;
        marker = `${currentList.index}.`;
      } else {
        marker = "-";
      }

      // Check if this li contains nested lists
      const hasNestedList = children.some(
        (c) => c?.name === "ol" || c?.name === "ul"
      );

      if (hasNestedList) {
        // Separate inline content from nested lists
        const inlineContent = [];
        const nestedLists = [];

        for (const child of children) {
          if (child?.name === "ol" || child?.name === "ul") {
            nestedLists.push(child);
          } else {
            inlineContent.push(child);
          }
        }

        const inlineText = inlineContent
          .map((c) => renderToMarkdown(c, context))
          .join("")
          .trim();

        const nestedText = nestedLists
          .map((c) => renderToMarkdown(c, context))
          .join("");

        return `${indent}${marker} ${inlineText}\n${nestedText}`;
      }

      const content = renderChildren().trim().replace(/\n+/g, " ");
      return `${indent}${marker} ${content}\n`;
    }

    // Tables
    case "table":
      return renderChildren() + "\n";
    case "thead":
      return renderChildren();
    case "tbody":
      return renderChildren();
    case "tr": {
      const cells = children
        .map((child) => renderToMarkdown(child, context))
        .join(" | ");
      const isHeader = children.some((c) => c?.name === "th");
      if (isHeader) {
        const separator = children.map(() => "---").join(" | ");
        return `| ${cells} |\n| ${separator} |\n`;
      }
      return `| ${cells} |\n`;
    }
    case "th":
    case "td":
      return renderChildren().trim();

    // Catch-all for unknown elements - just render children
    default:
      return renderChildren();
  }
}

// Check if a path should be ignored based on ignore list
function shouldIgnore(filePath, rootDir, ignorePaths) {
  if (!ignorePaths || ignorePaths.length === 0) return false;

  const relativePath = path.relative(rootDir, filePath);

  for (const ignorePath of ignorePaths) {
    // Check if the file path starts with or equals the ignore path
    if (
      relativePath === ignorePath ||
      relativePath.startsWith(ignorePath + path.sep)
    ) {
      return true;
    }
  }

  return false;
}

// Recursively find all .mdoc files (non-partial)
function findMdocFiles(dir, config, files = []) {
  const { outputDir, ignore } = config;
  const rootDir = path.resolve(config.templatesDir);
  const outputDirName = path.basename(path.resolve(outputDir));

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip standard excluded directories
      if (
        entry.name === "node_modules" ||
        entry.name === outputDirName ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      // Skip ignored directories
      if (shouldIgnore(fullPath, rootDir, ignore)) {
        continue;
      }

      findMdocFiles(fullPath, config, files);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".mdoc") &&
      !entry.name.endsWith(".p.mdoc")
    ) {
      // Skip ignored files
      if (!shouldIgnore(fullPath, rootDir, ignore)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

// Convert mdoc path to output path
function getOutputPath(config, mdocPath) {
  const rootDir = path.resolve(config.templatesDir);
  const relativePath = path.relative(rootDir, mdocPath);
  return path.join(config.outputDir, relativePath.replace(/\.mdoc$/, ".g.md"));
}

// Render a single markdoc file to Markdown
function renderFile(filePath) {
  const source = fs.readFileSync(filePath, "utf-8");
  const ast = Markdoc.parse(source);
  const baseDir = path.dirname(filePath);

  // Build ref index from AST
  const refIndex = buildRefIndex(ast);

  // Create config with the ref function
  const markdocConfig = createMarkdocConfig(refIndex, baseDir);

  const content = Markdoc.transform(ast, markdocConfig);
  return renderToMarkdown(content).trim() + "\n";
}

// Render and write a single file (output file must already exist)
function renderAndWrite(config, mdocPath) {
  const rootDir = path.resolve(config.templatesDir);
  const relativePath = path.relative(rootDir, mdocPath);
  const outputPath = getOutputPath(config, mdocPath);

  // Check that output file exists
  if (!fs.existsSync(outputPath)) {
    const relativeOutput = path.relative(rootDir, outputPath);
    console.error(
      `${RED}Error: ${relativeOutput} does not exist. Create it first to enable rendering.${RESET}`
    );
    return false;
  }

  const md = renderFile(mdocPath);
  fs.writeFileSync(outputPath, md);
  console.log(`${relativePath} -> ${path.relative(rootDir, outputPath)}`);
  return true;
}

// Recursively find all .g.md files in output dir
function findGeneratedFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findGeneratedFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".g.md")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Convert output path to expected mdoc path
function getMdocPath(config, outputPath) {
  const outputDir = path.resolve(config.outputDir);
  const rootDir = path.resolve(config.templatesDir);
  const relativePath = path.relative(outputDir, outputPath);
  return path.join(rootDir, relativePath.replace(/\.g\.md$/, ".mdoc"));
}

// Clean up orphaned .g.md files (those without corresponding .mdoc)
function cleanupOrphans(config) {
  const rootDir = path.resolve(config.templatesDir);
  const outputDir = path.resolve(config.outputDir);
  const generatedFiles = findGeneratedFiles(outputDir);
  let deletedCount = 0;

  for (const genFile of generatedFiles) {
    const expectedMdoc = getMdocPath(config, genFile);
    if (!fs.existsSync(expectedMdoc)) {
      fs.unlinkSync(genFile);
      console.log(`Deleted orphaned: ${path.relative(rootDir, genFile)}`);
      deletedCount++;

      // Clean up empty directories (but never delete output dir or above)
      let dir = path.dirname(genFile);
      while (true) {
        // Safety check: ensure we're still inside output directory
        const resolvedDir = path.resolve(dir);
        if (
          resolvedDir === outputDir ||
          !resolvedDir.startsWith(outputDir + path.sep)
        ) {
          break;
        }

        try {
          const entries = fs.readdirSync(dir);
          if (entries.length === 0) {
            fs.rmdirSync(dir);
            dir = path.dirname(dir);
          } else {
            break;
          }
        } catch {
          break;
        }
      }
    }
  }

  return deletedCount;
}

// Render all files (output files must already exist)
function render(config) {
  const rootDir = path.resolve(config.templatesDir);
  const mdocFiles = findMdocFiles(rootDir, config);

  if (mdocFiles.length === 0) {
    console.log("No .mdoc files found");
    return;
  }

  // Clean up orphaned .g.md files first
  const deletedCount = cleanupOrphans(config);
  if (deletedCount > 0) {
    console.log();
  }

  let successCount = 0;
  let errorCount = 0;

  for (const mdocPath of mdocFiles) {
    if (renderAndWrite(config, mdocPath)) {
      successCount++;
    } else {
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.log(
      `\n${RED}Rendered ${successCount} file(s), ${errorCount} error(s)${RESET}`
    );
    process.exit(1);
  } else {
    console.log(`\n${GREEN}All ok${RESET} - Rendered ${successCount} file(s)`);
  }
}

// Watch mode using fs.watch for native file system events
function watch(config) {
  const rootDir = path.resolve(config.templatesDir);
  const outputDir = path.resolve(config.outputDir);
  const outputDirName = path.basename(outputDir);
  const debounceMs = config.debounceMs;

  console.log("Watch mode started (using native fs events)...\n");

  const watchers = new Map(); // dir -> FSWatcher
  const pendingChanges = new Set();
  const pendingErrors = new Set(); // mdoc files that failed to render (missing .g.md)
  let debounceTimer = null;

  // Process all pending changes
  function processPendingChanges() {
    if (pendingChanges.size === 0 && pendingErrors.size === 0) return;

    const mdocFiles = findMdocFiles(rootDir, config);
    const changedMdocs = new Set();
    const changedPartials = new Set();

    for (const filePath of pendingChanges) {
      if (fs.existsSync(filePath)) {
        if (filePath.endsWith(".p.mdoc")) {
          changedPartials.add(filePath);
        } else if (filePath.endsWith(".mdoc")) {
          changedMdocs.add(filePath);
        }
      }
      // Deleted files will be handled by cleanupOrphans
    }

    pendingChanges.clear();

    // Handle partial changes - find dependent mdoc files
    if (changedPartials.size > 0) {
      const dependencyMap = buildPartialDependencyMap(mdocFiles);

      for (const partial of changedPartials) {
        const dependents = dependencyMap.get(partial);
        if (dependents) {
          for (const dep of dependents) {
            changedMdocs.add(dep);
          }
          console.log(
            `Partial changed: ${path.relative(rootDir, partial)} -> ${dependents.size} dependent file(s)`
          );
        }
      }
    }

    // Also retry any pending errors
    for (const mdocPath of pendingErrors) {
      changedMdocs.add(mdocPath);
    }

    // Render changed mdoc files
    let successCount = 0;
    let errorCount = 0;

    for (const mdocPath of changedMdocs) {
      try {
        if (renderAndWrite(config, mdocPath)) {
          successCount++;
          pendingErrors.delete(mdocPath);
        } else {
          errorCount++;
          pendingErrors.add(mdocPath);
        }
      } catch (err) {
        console.error(
          `${RED}Error rendering ${mdocPath}: ${err.message}${RESET}`
        );
        errorCount++;
        pendingErrors.add(mdocPath);
      }
    }

    // Clean up orphaned .g.md files (deleted mdocs or any other orphans)
    cleanupOrphans(config);

    // Show status
    if (changedMdocs.size > 0) {
      if (pendingErrors.size === 0) {
        console.log(`${GREEN}All ok${RESET}\n`);
      } else {
        console.log(
          `${RED}${pendingErrors.size} file(s) pending (missing .g.md)${RESET}\n`
        );
      }
    }
  }

  // Schedule processing with debounce
  function scheduleProcessing() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      processPendingChanges();
      debounceTimer = null;
    }, debounceMs);
  }

  // Watch a directory recursively
  function watchDir(dir, watchGmd = false) {
    if (watchers.has(dir)) return;

    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;

        const filePath = path.join(dir, filename);

        // Handle .mdoc files
        if (filename.endsWith(".mdoc")) {
          pendingChanges.add(filePath);
          scheduleProcessing();
        }

        // Handle .g.md file creation (for pending errors)
        if (filename.endsWith(".g.md") && pendingErrors.size > 0) {
          scheduleProcessing();
        }

        // Handle new directories
        if (
          eventType === "rename" &&
          fs.existsSync(filePath) &&
          fs.statSync(filePath).isDirectory() &&
          !filename.startsWith(".") &&
          filename !== "node_modules"
        ) {
          const isOutputDir = dir === rootDir && filename === outputDirName;
          watchDir(filePath, isOutputDir || watchGmd);
        }
      });

      watchers.set(dir, watcher);

      // Watch subdirectories
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          const isOutputDir = dir === rootDir && entry.name === outputDirName;
          if (isOutputDir || watchGmd || entry.name !== outputDirName) {
            watchDir(path.join(dir, entry.name), isOutputDir || watchGmd);
          }
        }
      }
    } catch (err) {
      console.error(`${RED}Error watching ${dir}: ${err.message}${RESET}`);
    }
  }

  // Initial build (but don't exit on error in watch mode)
  const mdocFiles = findMdocFiles(rootDir, config);

  if (mdocFiles.length === 0) {
    console.log("No .mdoc files found");
  } else {
    // Clean up orphaned .g.md files first
    const deletedCount = cleanupOrphans(config);
    if (deletedCount > 0) {
      console.log();
    }

    let successCount = 0;

    for (const mdocPath of mdocFiles) {
      if (renderAndWrite(config, mdocPath)) {
        successCount++;
      } else {
        pendingErrors.add(mdocPath);
      }
    }

    if (pendingErrors.size === 0) {
      console.log(`\n${GREEN}All ok${RESET} - Rendered ${successCount} file(s)`);
    } else {
      console.log(
        `\n${RED}Rendered ${successCount} file(s), ${pendingErrors.size} error(s)${RESET}`
      );
    }
  }

  // Start watching (including output directory for .g.md creation)
  watchDir(rootDir);

  console.log(`\nWatching for changes... (press Ctrl+C to stop)\n`);
}

// Render and write a single file, creating output file if needed (for push mode)
function renderAndWriteForce(config, mdocPath) {
  const rootDir = path.resolve(config.templatesDir);
  const relativePath = path.relative(rootDir, mdocPath);
  const outputPath = getOutputPath(config, mdocPath);

  // Create directory if needed
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const md = renderFile(mdocPath);
  const isNew = !fs.existsSync(outputPath);
  fs.writeFileSync(outputPath, md);

  if (isNew) {
    console.log(
      `${GREEN}Created:${RESET} ${relativePath} -> ${path.relative(rootDir, outputPath)}`
    );
  } else {
    console.log(`${relativePath} -> ${path.relative(rootDir, outputPath)}`);
  }
  return true;
}

// Push mode - clean orphans and (re)create all .g.md files
function push(config) {
  const rootDir = path.resolve(config.templatesDir);

  // Clean up orphaned .g.md files first
  const deletedCount = cleanupOrphans(config);
  if (deletedCount > 0) {
    console.log();
  }

  // Find all .mdoc files
  const mdocFiles = findMdocFiles(rootDir, config);

  if (mdocFiles.length === 0) {
    console.log("No .mdoc files found");
    return;
  }

  let successCount = 0;
  let createdCount = 0;

  for (const mdocPath of mdocFiles) {
    const outputPath = getOutputPath(config, mdocPath);
    const isNew = !fs.existsSync(outputPath);

    try {
      renderAndWriteForce(config, mdocPath);
      successCount++;
      if (isNew) createdCount++;
    } catch (err) {
      console.error(
        `${RED}Error rendering ${path.relative(rootDir, mdocPath)}: ${err.message}${RESET}`
      );
    }
  }

  console.log(
    `\n${GREEN}All ok${RESET} - Rendered ${successCount} file(s)${createdCount > 0 ? `, created ${createdCount} new` : ""}`
  );
}

module.exports = { render, watch, push };
