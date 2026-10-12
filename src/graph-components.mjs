/** Iterative SCC analysis for internally validated, bounded adjacency maps. */
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function findCyclicComponents(adjacency) {
  const ordered = [...adjacency.keys()].sort(compare), visited = new Set(), finished = [];
  for (const root of ordered) {
    if (visited.has(root)) continue; visited.add(root);
    const stack = [{ id: root, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), children = adjacency.get(frame.id);
      if (frame.next === children.length) { finished.push(frame.id); stack.pop(); continue; }
      const child = children[frame.next++]; if (!visited.has(child)) { visited.add(child); stack.push({ id: child, next: 0 }); }
    }
  }
  const reverse = new Map(ordered.map(key => [key, []]));
  for (const [parent, children] of adjacency) for (const child of children) reverse.get(child).push(parent);
  visited.clear(); const result = [];
  for (const root of finished.reverse()) {
    if (visited.has(root)) continue; visited.add(root); const stack = [root], component = [];
    while (stack.length) {
      const parent = stack.pop(); component.push(parent);
      for (const child of reverse.get(parent)) if (!visited.has(child)) { visited.add(child); stack.push(child); }
    }
    if (component.length > 1 || adjacency.get(root).includes(root)) result.push(component.sort(compare));
  }
  return result.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
}
