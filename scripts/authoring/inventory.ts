/**
 * What already exists, printed compactly.
 *
 *   node scripts/authoring/inventory.ts
 *   node scripts/authoring/inventory.ts --ingredients
 *
 * Reuse is the rule that keeps the shopping list, the reverse search and every
 * computed figure coherent, and an author can only reuse what they know is
 * there. This exists so that list is one command rather than a paragraph
 * pasted into a task — a pasted list is stale the moment the next drink lands,
 * and it is the same list every time, paid for again on every dispatch.
 *
 * Reads `src/content` directly, because that is what exists. The catalogue
 * plans what to write and is not a record of what has been written.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTENT = 'src/content';

const wrap = (items: string[], width = 92): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (line && line.length + item.length + 2 > width) {
      lines.push(line);
      line = '';
    }
    line += (line ? ' · ' : '') + item;
  }
  if (line) lines.push(line);
  return lines;
};

async function jsonRecords(dir: string): Promise<Array<Record<string, unknown>>> {
  const files = await readdir(path.join(CONTENT, dir)).catch(() => []);
  const out: Array<Record<string, unknown>> = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    out.push(JSON.parse(await readFile(path.join(CONTENT, dir, f), 'utf8')));
  }
  return out;
}

/** Frontmatter only, and only the two or three keys this needs. */
async function mdxHeads(dir: string): Promise<Array<Record<string, string>>> {
  const files = await readdir(path.join(CONTENT, dir)).catch(() => []);
  const out: Array<Record<string, string>> = [];
  for (const f of files) {
    if (!f.endsWith('.mdx')) continue;
    const raw = await readFile(path.join(CONTENT, dir, f), 'utf8');
    const head: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (line === '---') break;
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m?.[1] && m[2]) head[m[1]] = m[2];
    }
    head['file'] = f;
    out.push(head);
  }
  return out;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2));
  const want = (name: string): boolean => only.length === 0 || only.includes(name);

  if (want('ingredients')) {
    const records = await jsonRecords('ingredients');
    console.log(`\nINGREDIENTS (${records.length}) — id, then the Form ids on it`);
    for (const line of wrap(
      records
        .map((r) => {
          const forms = (r['forms'] as Array<{ id: string }>).map((f) => f.id);
          const only = forms.length === 1 && forms[0] === 'standard';
          return only ? String(r['id']) : `${String(r['id'])}[${forms.join('|')}]`;
        })
        .sort(),
    )) {
      console.log('  ' + line);
    }
  }

  if (want('preparations')) {
    const preps = await mdxHeads('preparations');
    console.log(`\nPREPARATIONS (${preps.length})`);
    for (const line of wrap(preps.map((p) => p['id'] ?? '').sort())) console.log('  ' + line);
  }

  if (want('glassware')) {
    const glasses = await jsonRecords('glassware');
    console.log(`\nGLASSWARE (${glasses.length}) — id and capacity in ml`);
    for (const line of wrap(
      glasses.map((g) => `${String(g['id'])} ${String(g['capacityMl'])}`).sort(),
    )) {
      console.log('  ' + line);
    }
  }

  if (want('families')) {
    const families = await mdxHeads('families');
    console.log(`\nFAMILIES (${families.length})`);
    for (const line of wrap(families.map((f) => f['id'] ?? '').sort())) console.log('  ' + line);
  }

  if (want('drinks')) {
    const dirs = await readdir(path.join(CONTENT, 'drinks'), { withFileTypes: true }).catch(
      () => [],
    );
    const slugs = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
    console.log(`\nDRINKS ALREADY WRITTEN (${slugs.length})`);
    for (const line of wrap(slugs.sort())) console.log('  ' + line);
  }

  console.log('\nReuse what is here. A near-duplicate poisons every figure that reads it.\n');
}

await main();
