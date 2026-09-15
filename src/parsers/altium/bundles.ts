/**
 * Harness bundles across a project.
 *
 * A bundle crosses sheets as a port does: a harness port meets the entry of its name on
 * the channel that placed its sheet, a harness entry reaches every channel of its symbol,
 * and under Flat and Global scope harness ports also meet by name. A bundle reaching
 * neither stays within its instance. A nested bundle is a member of its parent bundle, so
 * wherever two bundles join, their members of one name join too.
 */

import { harnessSignalKey, splitHarnessSignalKey } from "./harness.js";
import { identifierKey } from "./notation.js";
import type { ParsedDocument } from "./document.js";
import type { NetIdentifierScope } from "./project-options.js";
import { UnionFind } from "./union-find.js";

/** Resolves a document's harness signal key to its key across the project. */
export type SignalResolver = (document: ParsedDocument, signal: string) => string;

/** Join every document's bundles, and return how their signals resolve. */
export const resolveBundles = (
  documents: readonly ParsedDocument[],
  scope: NetIdentifierScope,
  symbolChannels: ReadonlyMap<string, readonly number[]>
): SignalResolver => {
  const bundles = new UnionFind<string>();
  const join = (nodes: readonly string[]): boolean =>
    nodes.reduce((joined, node) => bundles.union(nodes[0], node) || joined, false);
  /** Each nested bundle's node, with its parent bundle's node and its member. */
  const nested = new Map<string, { parent: string; member: string }>();
  const nodeCache = new Map<string, string[]>();

  /** The project nodes a document's bundle identity stands for. */
  const nodesOf = (document: ParsedDocument, identity: string): string[] => {
    const cacheKey = `${document.placement}\n${document.name}\n${identity}`;
    const cached = nodeCache.get(cacheKey);
    if (cached) return cached;
    let nodes: string[];
    const { bundle: parentIdentity, member } = splitHarnessSignalKey(identity);
    if (member !== "") {
      const parents = nodesOf(document, parentIdentity);
      const node = harnessSignalKey(parents[0], identifierKey(member));
      nested.set(node, { parent: parents[0], member: identifierKey(member) });
      join(parents);
      nodes = [node];
    } else {
      const separator = identity.indexOf("|");
      const kind = identity.slice(0, separator);
      const rest = identifierKey(identity.slice(separator + 1));
      const index = rest.slice(0, rest.indexOf("|"));
      const channels =
        kind === "entry" ? (symbolChannels.get(`${document.name}#${index}`) ?? []) : [];
      if (kind === "port") {
        nodes = [
          `hier|${document.placement}|${rest}`,
          ...(scope === "flat" || scope === "global" ? [`port|${rest}`] : []),
        ];
      } else if (channels.length > 0) {
        const name = rest.slice(index.length + 1);
        nodes = channels.map((channel) => `hier|${document.placement}/${index}@${channel}|${name}`);
      } else {
        nodes = [`${document.placement}|${identifierKey(identity)}`];
      }
    }
    nodeCache.set(cacheKey, nodes);
    return nodes;
  };

  for (const document of documents) {
    const identities = [
      ...[...document.harnessSignals.keys()].map((signal) => splitHarnessSignalKey(signal).bundle),
      ...document.bundleLinks.flat(),
      ...document.links.flatMap((group) =>
        group.keys
          .filter((key: string) => key.startsWith("harness|"))
          .map((key: string) => splitHarnessSignalKey(key.slice("harness|".length)).bundle)
      ),
    ];
    for (const identity of identities) join(nodesOf(document, identity));
    for (const group of document.bundleLinks) {
      join(group.map((identity) => nodesOf(document, identity)[0]));
    }
  }

  for (let joined = true; joined; ) {
    joined = false;
    const byMember = new Map<string, string>();
    for (const [node, { parent, member }] of nested) {
      const key = harnessSignalKey(bundles.find(parent), member);
      const met = byMember.get(key);
      if (met === undefined) byMember.set(key, node);
      else joined = join([met, node]) || joined;
    }
  }

  return (document, signal) => {
    const { bundle, member } = splitHarnessSignalKey(signal);
    return harnessSignalKey(bundles.find(nodesOf(document, bundle)[0]), identifierKey(member));
  };
};
