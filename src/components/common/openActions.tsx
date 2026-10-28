import { AppWindow, SquarePlus } from 'lucide-react';
import type { MediaMenuAction } from '../ui/MediaMenu';
import { openInNewTab, openInNewWindow } from '../../lib/openTarget';
import { getString } from '../../lib/i18n/index';

/** "Open in new tab" and "Open in new window" for a card's menu. */
export function openActions(route: string): MediaMenuAction[] {
  return [
    {
      id: 'open-tab',
      label: getString('open_in_new_tab'),
      icon: <SquarePlus size={16} />,
      group: 'go',
      onSelect: () => openInNewTab(route),
    },
    {
      id: 'open-window',
      label: getString('open_in_new_window'),
      icon: <AppWindow size={16} />,
      group: 'go',
      onSelect: () => void openInNewWindow(route),
    },
  ];
}
