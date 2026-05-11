import { richTextToMd } from './inline.js';

// biome-ignore lint/suspicious/noExplicitAny: properties come from Notion JSON with dynamic schemas
type Prop = Record<string, any>;

export function propertiesToFrontmatter(props: Record<string, Prop>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) out[name] = convertProp(prop);
  return out;
}

function convertProp(prop: Prop): unknown {
  switch (prop.type) {
    case 'title':
      return richTextToMd(prop.title ?? []);
    case 'rich_text':
      return richTextToMd(prop.rich_text ?? []);
    case 'number':
      return prop.number;
    case 'select':
      return prop.select?.name ?? null;
    case 'multi_select':
      return (prop.multi_select ?? []).map((i: Prop) => i.name);
    case 'status':
      return prop.status?.name ?? null;
    case 'date':
      return dateToStr(prop.date);
    case 'checkbox':
      return prop.checkbox;
    case 'url':
      return prop.url;
    case 'email':
      return prop.email;
    case 'phone_number':
      return prop.phone_number;
    case 'people':
      return (prop.people ?? []).map((p: Prop) => p.name).filter(Boolean);
    case 'files':
      return (prop.files ?? []).map(fileValue);
    case 'relation':
      return (prop.relation ?? []).map((r: Prop) => `{{notion-link:${r.id}}}`);
    case 'formula':
      return formulaValue(prop.formula ?? {});
    case 'rollup':
      return rollupValue(prop.rollup ?? {});
    case 'created_time':
    case 'last_edited_time':
      return prop[prop.type];
    case 'created_by':
    case 'last_edited_by':
      return prop[prop.type]?.name ?? null;
    default:
      return null;
  }
}

function dateToStr(date: Prop | null | undefined): string | null {
  if (!date) return null;
  return date.end ? `${date.start}/${date.end}` : date.start;
}

function fileValue(f: Prop): string {
  if (f.type === 'external') return f.external.url;
  return `{{notion-asset:${f.file.url}}}`;
}

function formulaValue(f: Prop): unknown {
  switch (f.type) {
    case 'number':
      return f.number;
    case 'string':
      return f.string;
    case 'boolean':
      return f.boolean;
    case 'date':
      return dateToStr(f.date);
    default:
      return null;
  }
}

function rollupValue(r: Prop): unknown {
  switch (r.type) {
    case 'number':
      return r.number;
    case 'date':
      return dateToStr(r.date);
    case 'array':
      return (r.array ?? []).map(convertProp);
    default:
      return null;
  }
}
