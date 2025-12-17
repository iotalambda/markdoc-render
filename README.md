# markdoc-render

Markdoc template renderer with cross-references and partials. Renders `.mdoc` files to Markdown.

See the [example](./example) directory for a complete setup.

## Installation

```bash
npm install github:iotalambda/markdoc-render
```

Or with a specific version:

```bash
npm install github:iotalambda/markdoc-render#v0.1.1
```

## Configuration

Create `mdr.config.js` in your project root:

```javascript
// mdr.config.js
module.exports = {
  // Required
  templatesDir: "./templates",  // Where .mdoc files are located
  outputDir: "./out",           // Where .g.md files will be written

  // Optional
  ignore: ["drafts", "internal"],  // Directories to skip
  debounceMs: 100,                 // Watch mode debounce (default: 100)
};
```

## Usage

```bash
# Render all files (output .g.md files must already exist)
npx mdr render

# Watch for changes
npx mdr watch

# Create/update all output files (creates missing .g.md files)
npx mdr push
```

Or add scripts to your `package.json`:

```json
{
  "scripts": {
    "render": "mdr render",
    "watch": "mdr watch",
    "push": "mdr push"
  }
}
```

## File Conventions

- **Templates**: `*.mdoc` - Source files to render
- **Partials**: `*.p.mdoc` - Include files (not rendered directly)
- **Output**: `*.g.md` - Generated markdown files

## Features

### Partials

Include other files:

```markdoc
{% partial file="partials/header.p.mdoc" /%}
```

### Cross-references

Reference list items by ID or class:

```markdoc
{% ol id="steps" %}
    {% li cl="install" %} Install the package {% /li %}
    {% li cl="configure" %} Configure settings {% /li %}
    {% li cl="run" %} Run the app {% /li %}
{% /ol %}

See step {% liRef("#steps .configure") %} for configuration.
```

This renders as: "See step 2 for configuration."

## Safe Renames

The `render` and `watch` commands require output `.g.md` files to already exist. This prevents accidental breakage when renaming `.mdoc` files. If you rename `foo.mdoc` to `bar.mdoc`, other markdown files might still link to `foo.g.md`. The error reminds you to update those references before proceeding.

Orphaned `.g.md` files (without corresponding `.mdoc`) are automatically deleted.

On the other hand, use `push` to recreate all `.g.md` files, remove orphaned ones, and clean up empty sub-directories.


## License

MIT
