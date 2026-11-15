import { useState, type ReactNode } from 'react';
import { Chip } from '../ui/Chip';

interface CategoryChipsProps {
  categories: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  sticky?: boolean;
  className?: string;
  /** Chips of their own before the categories, such as a toggle that isn't one of them. */
  leading?: ReactNode;
}

export function CategoryChips({
  categories,
  activeCategory,
  onCategoryChange,
  sticky = true,
  className = '',
  leading = null,
}: CategoryChipsProps) {
  const [internalActive, setInternalActive] = useState(categories[0] || 'All');
  const active = activeCategory ?? internalActive;

  const handleChange = (category: string) => {
    setInternalActive(category);
    onCategoryChange?.(category);
  };

  return (
    <div 
      className={`${sticky ? 'sticky top-0 z-30 border-b border-chrome-neutral-800 bg-background px-4' : ''} flex items-center gap-3 overflow-x-auto py-3 ${className}`}
    >
      <div className="flex gap-3">
        {leading}
        {categories.map((cat) => (
          <Chip 
            key={cat} 
            active={active === cat} 
            onClick={() => handleChange(cat)}
          >
            {cat}
          </Chip>
        ))}
      </div>
    </div>
  );
}
