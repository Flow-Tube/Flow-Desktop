import { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  containerClassName?: string;
}

export function SearchInput({
  className = '',
  containerClassName = '',
  ...props
}: SearchInputProps) {
  return (
    <div className={`relative ${containerClassName}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chrome-neutral-500"
      />
      <input
        type="search"
        dir="auto"
        className={`h-10 w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low py-2 pl-10 pr-3 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-500 hover:bg-surface-container focus:border-chrome-neutral-700 focus:bg-surface-container ${className}`}
        {...props}
      />
    </div>
  );
}
