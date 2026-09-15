/** Disjoint sets of values, merged by union and identified by their root. */
export class UnionFind<T> {
  private parent = new Map<T, T>();
  private rank = new Map<T, number>();

  find(x: T): T {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    for (let node = x; node !== root; ) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  /** Merge the sets of `x` and `y`; false when they were one set already. */
  union(x: T, y: T): boolean {
    let rootX = this.find(x);
    let rootY = this.find(y);
    if (rootX === rootY) return false;
    const rankX = this.rank.get(rootX) ?? 0;
    const rankY = this.rank.get(rootY) ?? 0;
    if (rankX < rankY) [rootX, rootY] = [rootY, rootX];
    this.parent.set(rootY, rootX);
    if (rankX === rankY) this.rank.set(rootX, rankX + 1);
    return true;
  }
}
