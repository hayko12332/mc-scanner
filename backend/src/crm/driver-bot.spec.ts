import { describe, expect, it } from 'vitest';
import { docKind } from './driver-bot.js';

describe('Driver documents from Telegram', () => {
  it('takes the type from the caption, else from where the load is', () => {
    expect(docKind('BOL', { status: 'delivered' })).toBe('bol');
    expect(docKind('signed pod', { status: 'in_transit' })).toBe('pod');
    expect(docKind('', { status: 'in_transit' })).toBe('bol');
    expect(docKind('', { status: 'delivered' })).toBe('pod');
    expect(docKind('lumper receipt', null)).toBe('other');
  });
});
