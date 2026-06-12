Universal Netlist MCP Server: Auto-Discovery & ID-Based Access
Problem
All tools currently require absolute paths to design files:
javascriptlist_nets({ design: "/Users/valentino/Developer/westworld/reference-designs/Altium-STM32-PCB/STM32_PCB_Design.PrjPcb" })
This is cumbersome and breaks when Claude runs in environments with different filesystem views.
Solution
Implement auto-discovery so list_designs builds a registry, then all other tools work with a design identifier (relative path from search root):
javascriptlist_designs({ path: "/Users/valentino/Developer" })
// Returns:
// [
//   { "id": "project-a/STM32_PCB_Design", "path": "/Users/.../project-a/STM32_PCB_Design.PrjPcb" },
//   { "id": "project-b/rev1/board", "path": "/Users/.../project-b/rev1/board.PrjPcb" },
//   { "id": "project-b/rev2/board", "path": "/Users/.../project-b/rev2/board.PrjPcb" }
// ]

list_nets({ design: "project-b/rev1/board" })
// Unambiguous - uses relative path as identifier
Handling Duplicate Names
When multiple designs have the same filename (e.g., board.PrjPcb in different folders), use the relative path from the search root as the design identifier:
Search root: /Users/valentino/Developer
Found files:
  /Users/valentino/Developer/project-b/rev1/board.PrjPcb → id: "project-b/rev1/board"
  /Users/valentino/Developer/project-b/rev2/board.PrjPcb → id: "project-b/rev2/board"
This ensures every design has a unique identifier.

Implementation note (current layout, post-0.1.0)
The pseudocode below predates the `service.ts` -> `src/service/` split and
uses `.js` sketches. Map it onto the current structure when implementing:
- The registry belongs in a new module (e.g. `src/service/registry.ts`),
  not a root `registry.js`.
- Path normalization already exists in `src/paths.ts` (`resolvePath`); reuse
  it rather than re-resolving paths ad hoc.
- The per-tool entrypoints live under `src/service/tools/*.ts` (e.g.
  `query-component.ts`, `list-nets.ts`); add the `getDesignPath(id)` lookup
  at the top of each. Design-name derivation is centralized in `src/paths.ts`
  (`getDesignName`).
- `computeDesignId`'s extension strip should match the formats we actually
  support today (`.PrjPcb`, `.SchDoc`, `.dsn`, `.dat`). `.cpm` and
  `.kicad_pro` from the original sketch are not currently parsed.

Implementation Tasks
Task 1: Add Design Registry
Create an in-memory registry that maps design IDs to their full paths:
javascript// registry.js
const designRegistry = new Map();

function registerDesign(id, fullPath, type) {
  designRegistry.set(id, { path: fullPath, type });
}

function getDesignPath(id) {
  if (!designRegistry.has(id)) {
    throw new Error(`Design "${id}" not found. Run list_designs first.`);
  }
  return designRegistry.get(id).path;
}

function clearRegistry() {
  designRegistry.clear();
}

// Helper: compute relative path ID from search root and full path
function computeDesignId(searchRoot, fullPath) {
  const relativePath = path.relative(searchRoot, fullPath);
  // Remove file extension
  return relativePath.replace(/\.(PrjPcb|kicad_pro|dsn|cpm)$/i, '');
}
Task 2: Update list_designs to Populate Registry
When list_designs scans a directory, register each design with its relative path ID:
javascriptasync function listDesigns({ path: searchRoot, pattern }) {
  clearRegistry(); // Fresh scan

  const designPaths = await scanForDesigns(searchRoot, pattern);

  const designs = designPaths.map(fullPath => {
    const id = computeDesignId(searchRoot, fullPath);
    const type = detectDesignType(fullPath);
    registerDesign(id, fullPath, type);
    return { id, path: fullPath, type };
  });

  return designs;
}
Task 3: Update All Other Tools
Add path resolution at the start of each tool. Change from:
javascriptasync function listNets({ design }) {
  const projectPath = design; // Currently expects full path
  // ...
}
To:
javascriptasync function listNets({ design }) {
  const projectPath = getDesignPath(design); // Resolves ID to full path
  // ...
}
Apply this change to:

list_components
list_nets
search_nets
search_components_by_refdes
search_components_by_mpn
search_components_by_description
query_xnet_by_net_name
query_xnet_by_pin_name
query_component
export_cadence_netlist

Task 4: Update Tool Descriptions
Update the design parameter description in all tools:
"design": "Design ID from list_designs results (relative path without extension)"
Example Workflow
javascript// Step 1: Discover designs (user provides their path once)
list_designs({ path: "/Users/valentino/Developer" })
// Response:
// [
//   { "id": "westworld/Altium-STM32-PCB/STM32_PCB_Design", "path": "/Users/.../STM32_PCB_Design.PrjPcb" },
//   { "id": "power-supplies/rev1/board", "path": "/Users/.../rev1/board.PrjPcb" },
//   { "id": "power-supplies/rev2/board", "path": "/Users/.../rev2/board.PrjPcb" }
// ]

// Step 2: Use any tool with the design ID
list_nets({ design: "westworld/Altium-STM32-PCB/STM32_PCB_Design" })
query_component({ design: "power-supplies/rev1/board", refdes: "U2" })
search_nets({ design: "power-supplies/rev2/board", pattern: "VCC.*" })
Acceptance Criteria

list_designs({ path }) scans recursively and registers all found designs
Design IDs are relative paths from search root without file extension (e.g., "project/rev1/board")
All other tools only accept design IDs
Clear error if design ID not found: "Design 'X' not found. Run list_designs first."
