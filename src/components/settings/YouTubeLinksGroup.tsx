import { Copy } from 'lucide-react';
import { SettingsGroup } from './SettingsGroup';
import { SettingItem } from './SettingItem';
import { Button } from '../ui/Button';
import { copyText } from '../../lib/clipboard';
import { getString } from '../../lib/i18n/index';
import { openExternalOrOfferCopy } from '../../lib/openExternal';
import { EXTENSION_RELEASES_URL, OPEN_IN_FLOW_BOOKMARKLET } from '../../lib/openInFlowLinks';
import { useUiStore } from '../../store/useUiStore';

/** How YouTube links from a browser reach Flow: the extension's switch, or a bookmark where it can't run. */
export function YouTubeLinksGroup() {
  const showToast = useUiStore((state) => state.showToast);

  const copyBookmark = async () => {
    const copied = await copyText(OPEN_IN_FLOW_BOOKMARKLET);
    showToast(copied
      ? { variant: 'success', message: getString('settings_open_in_flow_bookmark_copied') }
      : { variant: 'error', message: getString('selection_copy_failed') });
  };

  return (
    <SettingsGroup title={getString('settings_group_links')}>
      <SettingItem
        title={getString('settings_open_links')}
        description={getString('settings_open_links_desc')}
        onSelect={() => void openExternalOrOfferCopy(EXTENSION_RELEASES_URL)}
      />
      <SettingItem title={getString('settings_open_in_flow_bookmark')} description={getString('settings_open_in_flow_bookmark_desc')}>
        <Button variant="secondary" size="sm" onClick={() => void copyBookmark()}>
          <Copy size={14} />
          {getString('selection_copy')}
        </Button>
      </SettingItem>
    </SettingsGroup>
  );
}
