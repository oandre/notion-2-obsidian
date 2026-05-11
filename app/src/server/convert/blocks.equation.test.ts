import { describe, expect, it } from 'vitest';
import { blocksToMd } from './blocks.js';

describe('equation block', () => {
  it('renders as $$ fenced block', () => {
    const block = {
      type: 'equation',
      equation: { expression: 'e^{i\\pi} + 1 = 0' },
      has_children: false,
      children: [],
    };
    expect(blocksToMd([block])).toBe('$$\ne^{i\\pi} + 1 = 0\n$$\n');
  });
});
