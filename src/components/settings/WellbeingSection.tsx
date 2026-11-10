import { getPlural, getString } from "../../lib/i18n/index";
import { spentTimeLabel } from "../../lib/recap/recapFormat";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref, usePreference } from "../../lib/usePreference";
import { sleepWindowMs } from "../../lib/wellbeing/bedtime";
import { Select } from "../ui/Select";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingItem } from "./SettingItem";
import { SettingsGroup } from "./SettingsGroup";
import { WatchTimeCard } from "./WatchTimeCard";

const BREAK_FREQUENCIES = ["5", "10", "15", "20", "30", "45", "60", "90", "120"];

function TimeInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(event) => {
        if (event.target.value) onChange(event.target.value);
      }}
      className="rounded-lg border border-outline-variant bg-surface-container px-2 py-1 text-sm tabular-nums text-on-surface transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    />
  );
}

/** Watch time over the last week, and the reminders that help keep it in check. */
export function WellbeingSection() {
  const [bedtimeOn, setBedtimeOn] = useBoolPref(SETTINGS.BEDTIME_REMINDER, false);
  const [bedtimeStart, setBedtimeStart] = usePreference(SETTINGS.BEDTIME_START, "23:00");
  const [bedtimeEnd, setBedtimeEnd] = usePreference(SETTINGS.BEDTIME_END, "07:00");
  const [breakOn, setBreakOn] = useBoolPref(SETTINGS.BREAK_REMINDER, false);
  const [breakFrequency, setBreakFrequency] = usePreference(SETTINGS.BREAK_FREQUENCY, "30");
  const sleepMs = sleepWindowMs(bedtimeStart, bedtimeEnd);

  return (
    <SettingsGroup title={getString("settings_group_wellbeing")}>
      <WatchTimeCard />
      <SettingItem
        title={getString("bedtime_reminder_title")}
        description={
          bedtimeOn && sleepMs !== null
            ? getString("settings_sleep_window_summary", spentTimeLabel(sleepMs))
            : getString("bedtime_reminder_subtitle")
        }
      >
        <ToggleSwitch checked={bedtimeOn} onChange={setBedtimeOn} />
      </SettingItem>
      {bedtimeOn && (
        <SettingItem title={getString("bedtime_start_title")} description={getString("bedtime_notification_note")}>
          <TimeInput value={bedtimeStart} onChange={setBedtimeStart} label={getString("bedtime_start_title")} />
        </SettingItem>
      )}
      {bedtimeOn && (
        <SettingItem title={getString("bedtime_end_title")}>
          <TimeInput value={bedtimeEnd} onChange={setBedtimeEnd} label={getString("bedtime_end_title")} />
        </SettingItem>
      )}
      <SettingItem title={getString("break_reminder_title")} description={getString("break_reminder_subtitle")}>
        <ToggleSwitch checked={breakOn} onChange={setBreakOn} />
      </SettingItem>
      {breakOn && (
        <SettingItem title={getString("frequency_dialog_title")} description={getString("frequency_description")}>
          <Select
            value={breakFrequency}
            onChange={setBreakFrequency}
            options={BREAK_FREQUENCIES.map((minutes) => ({
              value: minutes,
              label: getPlural("every_minutes_template", Number(minutes)),
            }))}
          />
        </SettingItem>
      )}
    </SettingsGroup>
  );
}
