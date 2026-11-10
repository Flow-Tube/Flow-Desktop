import { InputHTMLAttributes, ReactNode } from 'react';
import { Search } from 'lucide-react';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  containerClassName?: string;
  /** The same pill as the top bar's search. */
  pill?: boolean;
  /** Shown at the end of the field, such as a progress spinner. */
  trailing?: ReactNode;
}

export function SearchInput({
  className = '',
  containerClassName = '',
  pill = false,
  trailing,
  ...props
}: SearchInputProps) {
  return (
    <div className={`relative ${containerClassName}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chrome-neutral-500"
      />
      <input
        type="search"
        className={`h-10 w-full ${pill ? 'rounded-full' : 'rounded-lg'} border border-chrome-neutral-800 bg-surface-container-low py-2 ps-10 pe-3 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-500 hover:bg-surface-container focus:border-chrome-neutral-700 focus:bg-surface-container ${className}`}
        {...props}
      />
      {trailing ? <div className="absolute end-3 top-1/2 -translate-y-1/2">{trailing}</div> : null}
    </div>
  );
}
