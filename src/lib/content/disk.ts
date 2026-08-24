/**
 * Reading content off disk.
 *
 * Structured data lives in frontmatter and step prose lives in the MDX body
 * inside `<Step id="…">` blocks, joined by id and enforced in both directions.
 * Prose is extracted as raw text rather than rendered through MDX, because
 * transclusion and the two service modes assemble a page's method from several
 * files in an order none of them declares — there is no single document for a
 * Markdown renderer to work on.
 *
 * Build-time only. Nothing a client island imports may reach this file.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

import type { Ingredient, Step } from '../math/types.ts';
import type { Component, StepSlot } from '../transclusion/flatten.ts';

export interface StepProse {
  id: string;
  prose: string;
}

export interface LoadIssue {
  kind: 'missing-prose' | 'orphan-prose' | 'no-frontmatter' | 'bad-frontmatter';
  file: string;
  ref: string;
  message: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const STEP_BLOCK = /<Step\s+([^>]*?)>([\s\S]*?)<\/Step>/g;

export interface ParsedFile<T> {
  data: T;
  body: string;
}

export function parseFrontmatter<T>(raw: string, file: string, issues: LoadIssue[]): ParsedFile<T> | null {
  const match = raw.match(FRONTMATTER);
  if (!match) {
    issues.push({
      kind: 'no-frontmatter',
      file,
      ref: file,
      message: 'No YAML frontmatter block.',
    });
    return null;
  }
  try {
    return { data: parseYaml(match[1] ?? '') as T, body: match[2] ?? '' };
  } catch (error) {
    issues.push({
      kind: 'bad-frontmatter',
      file,
      ref: file,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Pull the `<Step id="…">` blocks out of a body, in document order. */
export function extractSteps(body: string): StepProse[] {
  const out: StepProse[] = [];
  for (const match of body.matchAll(STEP_BLOCK)) {
    const id = match[1]?.match(/\bid\s*=\s*"([^"]*)"/)?.[1];
    if (!id) continue;
    out.push({ id, prose: (match[2] ?? '').trim() });
  }
  return out;
}

/** Frontmatter shape of a step, before its prose is attached. */
export interface StepMeta {
  id: string;
  durationSec: number;
  type: Step['type'];
  phase: Step['phase'];
  componentRef?: string;
  multiplier?: number;
}

/**
 * Join step metadata to step prose, in both directions.
 *
 * Metadata without prose renders an empty instruction; prose without metadata
 * contributes no time to a card that claims to be complete. Both are silent
 * failures, so both are reported.
 */
export function joinSteps(
  metas: StepMeta[],
  prose: StepProse[],
  file: string,
  issues: LoadIssue[],
): StepSlot[] {
  const proseById = new Map(prose.map((p) => [p.id, p.prose]));
  const slots: StepSlot[] = [];
  const claimed = new Set<string>();

  for (const meta of metas) {
    if (meta.componentRef) {
      slots.push({
        kind: 'component',
        componentRef: meta.componentRef,
        ...(meta.multiplier !== undefined ? { multiplier: meta.multiplier } : {}),
      });
      continue;
    }

    const text = proseById.get(meta.id);
    if (text === undefined) {
      issues.push({
        kind: 'missing-prose',
        file,
        ref: meta.id,
        message: `Step "${meta.id}" has timing data but no <Step id="${meta.id}"> block.`,
      });
    }
    claimed.add(meta.id);
    slots.push({
      kind: 'inline',
      step: {
        id: meta.id,
        durationSec: meta.durationSec,
        type: meta.type,
        phase: meta.phase,
        prose: text ?? '',
      },
    });
  }

  for (const p of prose) {
    if (!claimed.has(p.id)) {
      issues.push({
        kind: 'orphan-prose',
        file,
        ref: p.id,
        message: `<Step id="${p.id}"> has prose but no entry in the steps frontmatter.`,
      });
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Directory loading
// ---------------------------------------------------------------------------

export interface DrinkFile {
  slug: string;
  versionId: string;
  file: string;
  /** Everything the version declares, minus the steps, which become slots. */
  frontmatter: Record<string, unknown>;
  slots: StepSlot[];
}

/**
 * The About section is per DRINK, not per version.
 *
 * Where a drink comes from does not change because its ratio does, and one
 * history stated twice is one history that can end up stated two ways.
 */
export interface AboutFile {
  slug: string;
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * A Preparation's own recipe, with its step prose joined to its step metadata.
 *
 * The ingredients map carries the composition half of a Preparation, because
 * that is how a drink reaches it. This is the recipe half, which only the
 * preparation's own page needs — and it has to be loaded the same way a drink's
 * is, or a syrup's method is authored and never rendered.
 */
export interface PreparationFile {
  id: string;
  file: string;
  frontmatter: Record<string, unknown>;
  steps: Step[];
}

export interface FamilyFile {
  id: string;
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/** A standalone technique explainer. Same shape as a family: prose and sources. */
export type TechniqueFile = FamilyFile;

export interface RawRecord {
  file: string;
  data: unknown;
}

export interface LoadedContent {
  ingredients: Map<string, Ingredient>;
  preparations: Map<string, PreparationFile>;
  components: Map<string, Component>;
  glassware: Map<string, Record<string, unknown>>;
  drinks: DrinkFile[];
  abouts: Map<string, AboutFile>;
  families: Map<string, FamilyFile>;
  techniques: Map<string, TechniqueFile>;
  /** Untouched frontmatter, kept so the schemas can validate what was authored. */
  raw: {
    ingredients: RawRecord[];
    preparations: RawRecord[];
    glassware: RawRecord[];
    components: RawRecord[];
    drinks: RawRecord[];
    abouts: RawRecord[];
    families: RawRecord[];
    techniques: RawRecord[];
  };
  issues: LoadIssue[];
}

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, 'utf8')) as T;

export async function loadContent(contentDir: string): Promise<LoadedContent> {
  const issues: LoadIssue[] = [];
  const raw: LoadedContent['raw'] = {
    ingredients: [],
    preparations: [],
    glassware: [],
    components: [],
    drinks: [],
    abouts: [],
    families: [],
    techniques: [],
  };

  const ingredients = new Map<string, Ingredient>();
  for (const rel of await glob('ingredients/*.json', { cwd: contentDir })) {
    const record = await readJson<Ingredient>(path.join(contentDir, rel));
    raw.ingredients.push({ file: rel, data: record });
    ingredients.set(record.id, record);
  }
  // A Preparation is an ingredient that also has a recipe, so its composition
  // half lands in the same lookup and nothing downstream needs to know which
  // kind it is to use it. Its recipe half is kept separately, because only its
  // own page walks it.
  const preparations = new Map<string, PreparationFile>();
  for (const rel of await glob('preparations/*.mdx', { cwd: contentDir })) {
    const file = path.join(contentDir, rel);
    const parsed = parseFrontmatter<Ingredient & { steps?: StepMeta[] }>(
      await readFile(file, 'utf8'),
      rel,
      issues,
    );
    if (!parsed) continue;
    raw.preparations.push({ file: rel, data: { ...parsed.data, kind: 'preparation' } });
    ingredients.set(parsed.data.id, { ...parsed.data, kind: 'preparation' });

    const slots = joinSteps(parsed.data.steps ?? [], extractSteps(parsed.body), rel, issues);
    preparations.set(parsed.data.id, {
      id: parsed.data.id,
      file: rel,
      frontmatter: parsed.data as unknown as Record<string, unknown>,
      steps: slots.flatMap((s) => (s.kind === 'inline' ? [s.step] : [])),
    });
  }

  const glassware = new Map<string, Record<string, unknown>>();
  for (const rel of await glob('glassware/*.json', { cwd: contentDir })) {
    const record = await readJson<{ id: string }>(path.join(contentDir, rel));
    raw.glassware.push({ file: rel, data: record });
    glassware.set(record.id, record as Record<string, unknown>);
  }

  const components = new Map<string, Component>();
  for (const rel of await glob('components/*.mdx', { cwd: contentDir })) {
    const file = path.join(contentDir, rel);
    const parsed = parseFrontmatter<{
      id: string;
      name: string;
      ingredients?: Component['lines'];
      steps?: StepMeta[];
    }>(await readFile(file, 'utf8'), rel, issues);
    if (!parsed) continue;

    raw.components.push({ file: rel, data: parsed.data });
    const slots = joinSteps(parsed.data.steps ?? [], extractSteps(parsed.body), rel, issues);
    components.set(parsed.data.id, {
      id: parsed.data.id,
      name: parsed.data.name,
      lines: parsed.data.ingredients ?? [],
      steps: slots.flatMap((s) => (s.kind === 'inline' ? [s.step] : [])),
    });
  }

  const families = new Map<string, FamilyFile>();
  for (const rel of await glob('families/*.mdx', { cwd: contentDir })) {
    const file = path.join(contentDir, rel);
    const parsed = parseFrontmatter<Record<string, unknown>>(
      await readFile(file, 'utf8'),
      rel,
      issues,
    );
    if (!parsed) continue;
    raw.families.push({ file: rel, data: parsed.data });
    const id = String(parsed.data['id'] ?? path.basename(rel, '.mdx'));
    families.set(id, { id, file: rel, frontmatter: parsed.data, body: parsed.body });
  }

  // Same shape as a family: authored prose with optional sources, and no
  // structured recipe of its own.
  const techniques = new Map<string, TechniqueFile>();
  for (const rel of await glob('techniques/*.mdx', { cwd: contentDir })) {
    const file = path.join(contentDir, rel);
    const parsed = parseFrontmatter<Record<string, unknown>>(
      await readFile(file, 'utf8'),
      rel,
      issues,
    );
    if (!parsed) continue;
    raw.techniques.push({ file: rel, data: parsed.data });
    const id = String(parsed.data['id'] ?? path.basename(rel, '.mdx'));
    techniques.set(id, { id, file: rel, frontmatter: parsed.data, body: parsed.body });
  }

  const drinks: DrinkFile[] = [];
  const abouts = new Map<string, AboutFile>();

  for (const rel of await glob('drinks/*/*.mdx', { cwd: contentDir })) {
    const file = path.join(contentDir, rel);
    const parsed = parseFrontmatter<Record<string, unknown> & { steps?: StepMeta[] }>(
      await readFile(file, 'utf8'),
      rel,
      issues,
    );
    if (!parsed) continue;

    const parts = rel.split(/[\\/]/);
    const slug = parts[1] ?? '';
    const base = (parts[2] ?? '').replace(/\.mdx$/, '');

    // About is per drink, not per version: where a drink comes from does not
    // change because its ratio does.
    if (base === 'about') {
      raw.abouts.push({ file: rel, data: parsed.data });
      abouts.set(slug, { slug, file: rel, frontmatter: parsed.data, body: parsed.body });
      continue;
    }

    raw.drinks.push({ file: rel, data: parsed.data });
    drinks.push({
      slug,
      // index.mdx is the default version; its id comes from the frontmatter.
      versionId: base === 'index' ? String(parsed.data['id'] ?? 'default') : base,
      file: rel,
      frontmatter: parsed.data,
      slots: joinSteps(parsed.data.steps ?? [], extractSteps(parsed.body), rel, issues),
    });
  }

  return {
    ingredients,
    preparations,
    components,
    glassware,
    drinks,
    abouts,
    families,
    techniques,
    raw,
    issues,
  };
}
