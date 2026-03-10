/**
 * DSN vs DAT Coverage Analysis
 *
 * Pure comparison of two ParsedNetlist objects and markdown report formatting.
 * No file I/O; used by both the CLI --coverage command and scripts/dsn-coverage-report.ts.
 */

import type { ParsedNetlist, PinEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldStats {
  match: number;
  total: number;
  hasDsn: number;
  caseMatch: number;
  mismatches: string[];
}

export interface CoverageResult {
  projectName: string;
  goldenNetCount: number;
  dsnNetCount: number;
  commonNets: number;
  netCoverage: number;
  goldenCompCount: number;
  dsnCompCount: number;
  commonComps: number;
  compCoverage: number;
  missingNets: { name: string; category: string; connections: Record<string, unknown> }[];
  extraNets: { name: string; category: string }[];
  mpn: FieldStats;
  value: FieldStats;
  description: FieldStats;
  comment: FieldStats;
  dns: FieldStats;
  pinNum: FieldStats;
  pinName: FieldStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const categorizeNet = (name: string): string => {
  if (name === "NC") return "no-connect";
  if (/^N\d+$/.test(name)) return "auto-generated";
  if (/\[.*\.\.]/.test(name)) return "bus-range";
  return "named";
};

const getPinName = (entry: PinEntry): string | undefined =>
  typeof entry === "string" ? undefined : entry.name;

export const pct = (n: number, d: number): string =>
  d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "N/A";

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const emptyFieldStats = (): FieldStats => ({
  match: 0,
  total: 0,
  hasDsn: 0,
  caseMatch: 0,
  mismatches: [],
});

/**
 * Compare a DSN-parsed netlist against a reference (DAT/golden) netlist.
 * Pure function, no I/O.
 */
export const analyzeCoverage = (
  projectName: string,
  dsn: ParsedNetlist,
  reference: ParsedNetlist
): CoverageResult => {
  const refNets = new Set(Object.keys(reference.nets));
  const dsnNets = new Set(Object.keys(dsn.nets));
  const commonNets = [...dsnNets].filter((n) => refNets.has(n));

  const refComps = new Set(Object.keys(reference.components));
  const dsnComps = new Set(Object.keys(dsn.components));
  const commonCompKeys = [...dsnComps].filter((c) => refComps.has(c));

  const missingNets = [...refNets]
    .filter((n) => !dsnNets.has(n))
    .map((name) => ({ name, category: categorizeNet(name), connections: reference.nets[name] }));

  const extraNets = [...dsnNets]
    .filter((n) => !refNets.has(n))
    .map((name) => ({ name, category: categorizeNet(name) }));

  const mpn = emptyFieldStats();
  const value = emptyFieldStats();
  const description = emptyFieldStats();
  const comment = emptyFieldStats();
  const dns = emptyFieldStats();
  const pinNum = emptyFieldStats();
  const pinName = emptyFieldStats();

  for (const ref of commonCompKeys) {
    const gc = reference.components[ref];
    const dc = dsn.components[ref];

    if (gc.mpn) {
      mpn.total++;
      if (dc.mpn) {
        mpn.hasDsn++;
        const gUpper = gc.mpn.toUpperCase();
        const dUpper = dc.mpn.toUpperCase();
        if (dUpper === gUpper) mpn.match++;
        else if (gUpper.includes(dUpper) || dUpper.includes(gUpper)) {
          mpn.match++;
          mpn.caseMatch++; // reuse caseMatch to count substring matches
        } else mpn.mismatches.push(`${ref}: golden="${gc.mpn}" dsn="${dc.mpn}"`);
      }
    }

    if (gc.value) {
      value.total++;
      if (dc.value) value.hasDsn++;
      if (dc.value === gc.value) value.match++;
      else if (dc.value && dc.value.toUpperCase() === gc.value.toUpperCase()) {
        value.match++;
        value.caseMatch++;
      } else if (dc.value) value.mismatches.push(`${ref}: golden="${gc.value}" dsn="${dc.value}"`);
    }

    if (gc.description) {
      description.total++;
      if (dc.description) {
        description.hasDsn++;
        if (dc.description === gc.description) description.match++;
        else if (dc.description.toUpperCase() === gc.description.toUpperCase()) {
          description.match++;
          description.caseMatch++;
        } else
          description.mismatches.push(`${ref}: golden="${gc.description}" dsn="${dc.description}"`);
      }
    }

    if (gc.comment) {
      comment.total++;
      if (dc.comment) {
        comment.hasDsn++;
        if (dc.comment === gc.comment) comment.match++;
        else if (dc.comment.toUpperCase() === gc.comment.toUpperCase()) {
          comment.match++;
          comment.caseMatch++;
        } else comment.mismatches.push(`${ref}: golden="${gc.comment}" dsn="${dc.comment}"`);
      }
    }

    if (gc.dns) {
      dns.total++;
      if (dc.dns) dns.match++;
      else dns.mismatches.push(`${ref}: golden=DNS dsn=not marked`);
    }

    const goldenPins = gc.pins || {};
    const dsnPins = dc.pins || {};
    for (const pin of Object.keys(goldenPins)) {
      const gp = goldenPins[pin];
      const dp = dsnPins[pin];

      pinNum.total++;
      if (dp) pinNum.match++;
      else {
        const dsnPinKeys = Object.keys(dsnPins);
        pinNum.mismatches.push(`${ref}.${pin} missing (DSN pins: [${dsnPinKeys.join(",")}])`);
      }

      const gpName = getPinName(gp);
      const dpName = dp ? getPinName(dp) : undefined;
      if (gpName) {
        pinName.total++;
        if (dpName) pinName.hasDsn++;
        if (dpName === gpName) pinName.match++;
        else if (dpName)
          pinName.mismatches.push(`${ref}.${pin}: golden="${gpName}" dsn="${dpName}"`);
      }
    }
  }

  return {
    projectName,
    goldenNetCount: refNets.size,
    dsnNetCount: dsnNets.size,
    commonNets: commonNets.length,
    netCoverage: refNets.size > 0 ? commonNets.length / refNets.size : 1,
    goldenCompCount: refComps.size,
    dsnCompCount: dsnComps.size,
    commonComps: commonCompKeys.length,
    compCoverage: refComps.size > 0 ? commonCompKeys.length / refComps.size : 1,
    missingNets,
    extraNets,
    mpn,
    value,
    description,
    comment,
    dns,
    pinNum,
    pinName,
  };
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pad = (s: string, w: number) => s.padEnd(w);

const formatVerboseDesignTerminal = (
  r: CoverageResult,
  lines: string[],
  truncate: boolean
): void => {
  lines.push("");
  lines.push("=".repeat(80));
  lines.push(r.projectName);
  lines.push("=".repeat(80));

  lines.push("");
  lines.push("Field coverage:");
  const valueCaseNote = r.value.caseMatch > 0 ? `, ${r.value.caseMatch} case-transformed` : "";
  lines.push(
    `  Value:   ${r.value.match}/${r.value.total} match (${pct(r.value.match, r.value.total)}), ${r.value.hasDsn} have DSN value${valueCaseNote}`
  );
  lines.push(
    `  PinNum:  ${r.pinNum.match}/${r.pinNum.total} (${pct(r.pinNum.match, r.pinNum.total)})`
  );
  lines.push(
    `  PinName: ${r.pinName.match}/${r.pinName.total} exact (${pct(r.pinName.match, r.pinName.total)}), ${r.pinName.hasDsn} have DSN value`
  );
  const mpnSubstringNote = r.mpn.caseMatch > 0 ? `, ${r.mpn.caseMatch} substring` : "";
  lines.push(
    `  MPN:     ${r.mpn.match}/${r.mpn.total} match (${pct(r.mpn.match, r.mpn.total)}), ${r.mpn.hasDsn} have DSN value${mpnSubstringNote}`
  );
  if (r.description.total > 0) {
    lines.push(
      `  Desc:    ${r.description.match}/${r.description.total} (${pct(r.description.match, r.description.total)}), ${r.description.hasDsn} have DSN value`
    );
  }
  if (r.comment.total > 0) {
    lines.push(
      `  Comment: ${r.comment.match}/${r.comment.total} (${pct(r.comment.match, r.comment.total)}), ${r.comment.hasDsn} have DSN value`
    );
  }
  if (r.dns.total > 0) {
    lines.push(`  DNS:     ${r.dns.match}/${r.dns.total} (${pct(r.dns.match, r.dns.total)})`);
  }

  const formatMismatches = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("");
    lines.push(`  ${label} (${items.length}):`);
    const limit = truncate ? 10 : items.length;
    for (const m of items.slice(0, limit)) lines.push(`    ${m}`);
    if (items.length > limit) lines.push(`    ... and ${items.length - limit} more`);
  };

  formatMismatches("Value mismatches", r.value.mismatches);
  formatMismatches("MPN mismatches", r.mpn.mismatches);
  formatMismatches("Description mismatches", r.description.mismatches);
  formatMismatches("Comment mismatches", r.comment.mismatches);
  formatMismatches("DNS mismatches", r.dns.mismatches);
  formatMismatches("PinNum missing", r.pinNum.mismatches);
  formatMismatches("PinName mismatches", r.pinName.mismatches);

  const formatNets = (
    label: string,
    nets: { name: string; category: string; connections?: Record<string, unknown> }[],
    showConnections: boolean
  ) => {
    if (nets.length === 0) return;
    const byCategory = new Map<string, typeof nets>();
    for (const net of nets) {
      if (!byCategory.has(net.category)) byCategory.set(net.category, []);
      byCategory.get(net.category)!.push(net);
    }
    lines.push("");
    lines.push(`  ${label} (${nets.length}):`);
    for (const [category, catNets] of byCategory) {
      lines.push("");
      lines.push(`    [${category}] (${catNets.length}):`);
      const limit = truncate ? 20 : catNets.length;
      for (const net of catNets.slice(0, limit)) {
        if (showConnections && net.connections) {
          const refs = Object.keys(net.connections);
          lines.push(`      ${net.name} -> ${refs.length} components: ${refs.join(", ")}`);
        } else {
          lines.push(`      ${net.name}`);
        }
      }
      if (catNets.length > limit) lines.push(`      ... and ${catNets.length - limit} more`);
    }
  };

  formatNets("Missing nets", r.missingNets, true);
  formatNets("Extra nets", r.extraNets, false);

  if (r.missingNets.length === 0 && r.extraNets.length === 0) {
    lines.push("");
    lines.push("  Perfect net parity!");
  }
};

const formatVerboseDesignMarkdown = (
  r: CoverageResult,
  lines: string[],
  truncate: boolean
): void => {
  lines.push("");
  lines.push(`## ${r.projectName}`);
  lines.push("");

  // Field coverage table
  const fieldRows: [string, number, number, string][] = [
    [
      "Value",
      r.value.match,
      r.value.total,
      r.value.caseMatch > 0 ? `${r.value.caseMatch} case-transformed` : "",
    ],
    ["MPN", r.mpn.match, r.mpn.total, r.mpn.caseMatch > 0 ? `${r.mpn.caseMatch} substring` : ""],
    ["PinNum", r.pinNum.match, r.pinNum.total, ""],
    ["PinName", r.pinName.match, r.pinName.total, ""],
  ];
  if (r.description.total > 0)
    fieldRows.push(["Desc", r.description.match, r.description.total, ""]);
  if (r.comment.total > 0) fieldRows.push(["Comment", r.comment.match, r.comment.total, ""]);
  if (r.dns.total > 0) fieldRows.push(["DNS", r.dns.match, r.dns.total, ""]);

  lines.push("| Field | Match | Total | Coverage | Notes |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const [field, match, total, notes] of fieldRows) {
    lines.push(`| ${field} | ${match} | ${total} | ${pct(match, total)} | ${notes} |`);
  }

  const formatMismatches = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("");
    lines.push(`### ${label} (${items.length})`);
    lines.push("");
    const limit = truncate ? 10 : items.length;
    for (const m of items.slice(0, limit)) lines.push(`- ${m}`);
    if (items.length > limit) lines.push(`- ... and ${items.length - limit} more`);
  };

  formatMismatches("Value mismatches", r.value.mismatches);
  formatMismatches("MPN mismatches", r.mpn.mismatches);
  formatMismatches("Description mismatches", r.description.mismatches);
  formatMismatches("Comment mismatches", r.comment.mismatches);
  formatMismatches("DNS mismatches", r.dns.mismatches);
  formatMismatches("PinNum missing", r.pinNum.mismatches);
  formatMismatches("PinName mismatches", r.pinName.mismatches);

  const formatNets = (
    label: string,
    nets: { name: string; category: string; connections?: Record<string, unknown> }[],
    showConnections: boolean
  ) => {
    if (nets.length === 0) return;
    const byCategory = new Map<string, typeof nets>();
    for (const net of nets) {
      if (!byCategory.has(net.category)) byCategory.set(net.category, []);
      byCategory.get(net.category)!.push(net);
    }
    lines.push("");
    lines.push(`### ${label} (${nets.length})`);
    for (const [category, catNets] of byCategory) {
      lines.push("");
      lines.push(`**${category}** (${catNets.length}):`);
      lines.push("");
      const limit = truncate ? 20 : catNets.length;
      for (const net of catNets.slice(0, limit)) {
        if (showConnections && net.connections) {
          const refs = Object.keys(net.connections);
          lines.push(`- \`${net.name}\` -> ${refs.length} components: ${refs.join(", ")}`);
        } else {
          lines.push(`- \`${net.name}\``);
        }
      }
      if (catNets.length > limit) lines.push(`- ... and ${catNets.length - limit} more`);
    }
  };

  formatNets("Missing nets", r.missingNets, true);
  formatNets("Extra nets", r.extraNets, false);

  if (r.missingNets.length === 0 && r.extraNets.length === 0) {
    lines.push("");
    lines.push("Perfect net parity.");
  }
};

const formatAggregateTerminal = (results: CoverageResult[], lines: string[]): void => {
  const sum = (fn: (r: CoverageResult) => number) => results.reduce((s, r) => s + fn(r), 0);

  lines.push("");
  lines.push("=".repeat(98));
  lines.push("AGGREGATE");
  lines.push("=".repeat(98));
  lines.push(
    `Nets:    ${sum((r) => r.commonNets)}/${sum((r) => r.goldenNetCount)} (${pct(
      sum((r) => r.commonNets),
      sum((r) => r.goldenNetCount)
    )})`
  );
  lines.push(
    `Comps:   ${sum((r) => r.commonComps)}/${sum((r) => r.goldenCompCount)} (${pct(
      sum((r) => r.commonComps),
      sum((r) => r.goldenCompCount)
    )})`
  );
  const totalCaseMatch = sum((r) => r.value.caseMatch);
  const valueCaseNote = totalCaseMatch > 0 ? ` [${totalCaseMatch} case-transformed]` : "";
  lines.push(
    `Value:   ${sum((r) => r.value.match)}/${sum((r) => r.value.total)} (${pct(
      sum((r) => r.value.match),
      sum((r) => r.value.total)
    )})${valueCaseNote}`
  );
  lines.push(
    `PinNum:  ${sum((r) => r.pinNum.match)}/${sum((r) => r.pinNum.total)} (${pct(
      sum((r) => r.pinNum.match),
      sum((r) => r.pinNum.total)
    )})`
  );
  lines.push(
    `PinName: ${sum((r) => r.pinName.match)}/${sum((r) => r.pinName.total)} (${pct(
      sum((r) => r.pinName.match),
      sum((r) => r.pinName.total)
    )})`
  );
  const totalMpnSubstring = sum((r) => r.mpn.caseMatch);
  const mpnSubstringNote = totalMpnSubstring > 0 ? ` [${totalMpnSubstring} substring]` : "";
  lines.push(
    `MPN:     ${sum((r) => r.mpn.match)}/${sum((r) => r.mpn.total)} (${pct(
      sum((r) => r.mpn.match),
      sum((r) => r.mpn.total)
    )})${mpnSubstringNote}`
  );
  const totalDesc = sum((r) => r.description.total);
  if (totalDesc > 0) {
    lines.push(
      `Desc:    ${sum((r) => r.description.match)}/${totalDesc} (${pct(
        sum((r) => r.description.match),
        totalDesc
      )})`
    );
  }
  const totalComment = sum((r) => r.comment.total);
  if (totalComment > 0) {
    lines.push(
      `Comment: ${sum((r) => r.comment.match)}/${totalComment} (${pct(
        sum((r) => r.comment.match),
        totalComment
      )})`
    );
  }
  const totalDns = sum((r) => r.dns.total);
  if (totalDns > 0) {
    lines.push(
      `DNS:     ${sum((r) => r.dns.match)}/${totalDns} (${pct(
        sum((r) => r.dns.match),
        totalDns
      )})`
    );
  }

  const totalMissing = sum((r) => r.missingNets.length);
  const totalExtra = sum((r) => r.extraNets.length);
  if (totalMissing > 0 || totalExtra > 0) {
    lines.push("");
    lines.push(`Missing nets: ${totalMissing}, Extra nets: ${totalExtra}`);
    const allMissing = results.flatMap((r) => r.missingNets);
    const missingByCategory = new Map<string, number>();
    for (const net of allMissing) {
      missingByCategory.set(net.category, (missingByCategory.get(net.category) || 0) + 1);
    }
    for (const [cat, count] of [...missingByCategory.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${cat}: ${count}`);
    }
  }
};

const formatAggregateMarkdown = (results: CoverageResult[], lines: string[]): void => {
  const sum = (fn: (r: CoverageResult) => number) => results.reduce((s, r) => s + fn(r), 0);

  lines.push("");
  lines.push("## Aggregate");
  lines.push("");

  const rows: [string, number, number, string][] = [
    ["Nets", sum((r) => r.commonNets), sum((r) => r.goldenNetCount), ""],
    ["Comps", sum((r) => r.commonComps), sum((r) => r.goldenCompCount), ""],
  ];

  const totalCaseMatch = sum((r) => r.value.caseMatch);
  rows.push([
    "Value",
    sum((r) => r.value.match),
    sum((r) => r.value.total),
    totalCaseMatch > 0 ? `${totalCaseMatch} case-transformed` : "",
  ]);
  rows.push(["PinNum", sum((r) => r.pinNum.match), sum((r) => r.pinNum.total), ""]);
  rows.push(["PinName", sum((r) => r.pinName.match), sum((r) => r.pinName.total), ""]);

  const totalMpnSubstring = sum((r) => r.mpn.caseMatch);
  rows.push([
    "MPN",
    sum((r) => r.mpn.match),
    sum((r) => r.mpn.total),
    totalMpnSubstring > 0 ? `${totalMpnSubstring} substring` : "",
  ]);

  const totalDesc = sum((r) => r.description.total);
  if (totalDesc > 0) rows.push(["Desc", sum((r) => r.description.match), totalDesc, ""]);
  const totalComment = sum((r) => r.comment.total);
  if (totalComment > 0) rows.push(["Comment", sum((r) => r.comment.match), totalComment, ""]);
  const totalDns = sum((r) => r.dns.total);
  if (totalDns > 0) rows.push(["DNS", sum((r) => r.dns.match), totalDns, ""]);

  lines.push("| Field | Match | Total | Coverage | Notes |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const [field, match, total, notes] of rows) {
    lines.push(`| ${field} | ${match} | ${total} | ${pct(match, total)} | ${notes} |`);
  }

  const totalMissing = sum((r) => r.missingNets.length);
  const totalExtra = sum((r) => r.extraNets.length);
  if (totalMissing > 0 || totalExtra > 0) {
    lines.push("");
    lines.push(`Missing nets: ${totalMissing}, Extra nets: ${totalExtra}`);
    lines.push("");
    const allMissing = results.flatMap((r) => r.missingNets);
    const missingByCategory = new Map<string, number>();
    for (const net of allMissing) {
      missingByCategory.set(net.category, (missingByCategory.get(net.category) || 0) + 1);
    }
    for (const [cat, count] of [...missingByCategory.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${cat}: ${count}`);
    }
  }
};

/**
 * Render a coverage report as a string.
 * When `markdown` is true, wraps output with a heading and code fence for `.md` files.
 * Includes summary table, optional verbose per-design breakdowns, and aggregate stats.
 */
export const formatCoverageReport = (
  results: CoverageResult[],
  options?: { verbose?: boolean; truncate?: boolean; markdown?: boolean }
): string => {
  const verbose = options?.verbose ?? false;
  const truncate = options?.truncate ?? true;
  const markdown = options?.markdown ?? false;
  const lines: string[] = [];

  if (markdown) {
    lines.push("# DSN vs DAT Coverage Report");
    lines.push("");
  } else {
    lines.push("");
  }

  // Determine which optional fields have data across any result
  const hasDesc = results.some((r) => r.description.total > 0);
  const hasComment = results.some((r) => r.comment.total > 0);
  const hasDns = results.some((r) => r.dns.total > 0);

  if (markdown) {
    // Pipe-delimited markdown table
    const cols = ["Design", "Nets", "Comps", "Value", "MPN"];
    if (hasDesc) cols.push("Desc");
    if (hasComment) cols.push("Comment");
    if (hasDns) cols.push("DNS");
    cols.push("PinNum", "PinName");

    lines.push("| " + cols.join(" | ") + " |");
    lines.push("| " + cols.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ") + " |");

    for (const r of results) {
      const cells = [
        r.projectName,
        pct(r.commonNets, r.goldenNetCount),
        pct(r.commonComps, r.goldenCompCount),
        pct(r.value.match, r.value.total),
        pct(r.mpn.match, r.mpn.total),
      ];
      if (hasDesc) cells.push(pct(r.description.match, r.description.total));
      if (hasComment) cells.push(pct(r.comment.match, r.comment.total));
      if (hasDns) cells.push(pct(r.dns.match, r.dns.total));
      cells.push(pct(r.pinNum.match, r.pinNum.total), pct(r.pinName.match, r.pinName.total));
      lines.push("| " + cells.join(" | ") + " |");
    }
  } else {
    // Padded plain-text table for terminal
    let header =
      pad("Design", 50) + pad("Nets", 8) + pad("Comps", 8) + pad("Value", 8) + pad("MPN", 8);
    if (hasDesc) header += pad("Desc", 8);
    if (hasComment) header += pad("Comment", 8);
    if (hasDns) header += pad("DNS", 8);
    header += pad("PinNum", 8) + "PinName";
    lines.push(header);
    lines.push("-".repeat(header.length));

    for (const r of results) {
      let row =
        pad(r.projectName, 50) +
        pad(pct(r.commonNets, r.goldenNetCount), 8) +
        pad(pct(r.commonComps, r.goldenCompCount), 8) +
        pad(pct(r.value.match, r.value.total), 8) +
        pad(pct(r.mpn.match, r.mpn.total), 8);
      if (hasDesc) row += pad(pct(r.description.match, r.description.total), 8);
      if (hasComment) row += pad(pct(r.comment.match, r.comment.total), 8);
      if (hasDns) row += pad(pct(r.dns.match, r.dns.total), 8);
      row += pad(pct(r.pinNum.match, r.pinNum.total), 8) + pct(r.pinName.match, r.pinName.total);
      lines.push(row);
    }
  }

  if (verbose) {
    for (const r of results) {
      if (markdown) formatVerboseDesignMarkdown(r, lines, truncate);
      else formatVerboseDesignTerminal(r, lines, truncate);
    }
  }

  if (results.length > 1) {
    if (markdown) formatAggregateMarkdown(results, lines);
    else formatAggregateTerminal(results, lines);
  }

  return lines.join("\n");
};
