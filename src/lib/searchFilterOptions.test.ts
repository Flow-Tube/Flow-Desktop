import { describe, expect, it } from 'vitest';
import { activeFilters } from './searchFilterOptions';
import { DEFAULT_ADVANCED_FILTERS } from './searchFilterState';

describe('activeFilters', () => {
  it('lists nothing for the defaults', () => {
    expect(activeFilters(DEFAULT_ADVANCED_FILTERS)).toEqual([]);
  });

  it('lists each narrowing in panel order, and each removes only itself', () => {
    const filters = { ...DEFAULT_ADVANCED_FILTERS, watchState: 'unwatched' as const, uploadDate: 'week' as const, features: ['4k' as const, 'hd' as const] };
    const active = activeFilters(filters);
    expect(active.map((filter) => filter.label)).toEqual(['This week', 'HD', '4K', 'Unwatched']);
    expect(active[1]!.without(filters)).toEqual({ ...filters, features: ['4k'] });
    expect(active[0]!.without(filters).uploadDate).toBe('any');
    expect(active[3]!.without(filters).watchState).toBe('any');
  });
});
