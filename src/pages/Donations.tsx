import { Heart } from "lucide-react";
import { CryptoDonationCard } from "../components/donations/CryptoDonationCard";
import { SupportMethodRow } from "../components/donations/SupportMethodRow";
import { SettingsGroup } from "../components/settings/SettingsGroup";
import { Button } from "../components/ui/Button";
import { OpenCollectiveIcon, PatreonIcon } from "../components/ui/SupportPlatformIcons";
import { getString } from "../lib/i18n/index";
import { openExternal } from "../lib/openExternal";
import { OPEN_COLLECTIVE_URL, PATREON_URL } from "../lib/supportLinks";

export default function Donations() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("donations_title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-chrome-neutral-400">{getString("donations_subtitle")}</p>
      </header>

      <SettingsGroup>
        <SupportMethodRow
          icon={<OpenCollectiveIcon size={20} />}
          title={getString("donations_oc_title")}
          badge={getString("donations_recommended")}
          description={getString("donations_oc_desc")}
          action={
            <Button onClick={() => void openExternal(OPEN_COLLECTIVE_URL)}>
              <Heart className="h-4 w-4" />
              {getString("donations_oc_button")}
            </Button>
          }
        />
        <SupportMethodRow
          icon={<PatreonIcon size={18} />}
          title={getString("donations_patreon_title")}
          description={getString("donations_patreon_desc")}
          action={
            <Button variant="tonal" onClick={() => void openExternal(PATREON_URL)}>
              {getString("donations_patreon_button")}
            </Button>
          }
        />
      </SettingsGroup>

      <CryptoDonationCard />

      <p className="flex items-center gap-2 text-sm text-chrome-neutral-400">
        <Heart className="h-4 w-4 shrink-0 text-primary" />
        {getString("donations_thank_you")}
      </p>
    </div>
  );
}
