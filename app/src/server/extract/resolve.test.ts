import { describe, expect, it } from 'vitest';
import { type BrokenLink, type LinkContext, renderReport, resolvePlaceholders } from './resolve.js';

function ctx(over: Partial<LinkContext>): LinkContext {
  return {
    fromFile: '/v/A.md',
    idToPath: new Map(),
    urlToLocal: new Map(),
    vaultRoot: '/v',
    ...over,
  };
}

describe('resolvePlaceholders', () => {
  it('known link becomes wikilink', () => {
    const { md, broken } = resolvePlaceholders(
      'see {{notion-link:abc|Other}} for more',
      ctx({ idToPath: new Map([['abc', '/v/Other.md']]) }),
    );
    expect(md).toBe('see [[Other]] for more');
    expect(broken).toEqual([]);
  });

  it('known link without label uses target basename', () => {
    const { md, broken } = resolvePlaceholders(
      '{{notion-link:abc}}',
      ctx({ idToPath: new Map([['abc', '/v/Some Page.md']]) }),
    );
    expect(md).toBe('[[Some Page]]');
    expect(broken).toEqual([]);
  });

  it('unknown link with label keeps label and reports', () => {
    const { md, broken } = resolvePlaceholders('{{notion-link:xyz|External Page}}', ctx({}));
    expect(md).toBe('External Page');
    expect(broken).toEqual<BrokenLink[]>([
      { id: 'xyz', label: 'External Page', fromFile: '/v/A.md' },
    ]);
  });

  it('unknown link without label renders "(link removed)"', () => {
    const { md, broken } = resolvePlaceholders('{{notion-link:xyz}}', ctx({}));
    expect(md).toBe('(link removed)');
    expect(broken).toEqual<BrokenLink[]>([{ id: 'xyz', label: null, fromFile: '/v/A.md' }]);
  });

  it('asset placeholder becomes relative path', () => {
    const { md } = resolvePlaceholders(
      '![alt]({{notion-asset:https://x/y.png}})',
      ctx({
        fromFile: '/v/sub/A.md',
        urlToLocal: new Map([['https://x/y.png', '/v/assets/a1b2c3d4-y.png']]),
      }),
    );
    expect(md).toBe('![alt](../assets/a1b2c3d4-y.png)');
  });

  it('asset placeholder with no local mapping keeps original URL', () => {
    const { md } = resolvePlaceholders('![]({{notion-asset:https://x/y.png}})', ctx({}));
    expect(md).toBe('![](https://x/y.png)');
  });
});

describe('renderReport', () => {
  it('summary, broken links, failures, warnings all appear', () => {
    const report = renderReport({
      vaultRoot: '/v',
      pagesExtracted: 10,
      itemsExtracted: 5,
      attachmentsDownloaded: 2,
      totalBytes: 1024,
      durationS: 1.5,
      brokenLinks: [
        { id: 'xyz', label: 'External', fromFile: '/v/A.md' },
        { id: 'abc', label: null, fromFile: '/v/A.md' },
      ],
      failures: [{ id: 'page-1', reason: '404' }],
      warnings: ['unknown block: template'],
    });
    expect(report).toContain('Páginas extraídas: 10');
    expect(report).toContain('Itens de database extraídos: 5');
    expect(report).toContain('xyz');
    expect(report).toContain('Falhas (1)');
    expect(report).toContain('unknown block: template');
  });
});
