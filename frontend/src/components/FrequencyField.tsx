export const FREQUENCY_CHOICES = ["Daily", "Weekly", "Monthly", "Other"] as const;

export function selectedFrequencies(value: string | undefined) {
  const known = new Set<string>(FREQUENCY_CHOICES);
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => known.has(item));
}

export function frequencyText(frequency: string | undefined, other: string | undefined) {
  const extra = (other || "").trim();
  const parts = selectedFrequencies(frequency).map((item) => (item === "Other" && extra ? `Other: ${extra}` : item));
  return parts.join(", ");
}

export function FrequencyField({
  selected,
  other,
  disabled,
  onChange,
}: {
  selected: string[];
  other: string;
  disabled?: boolean;
  onChange: (selected: string[], other: string) => void;
}) {
  function toggle(option: string) {
    const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
    const ordered = FREQUENCY_CHOICES.filter((item) => next.includes(item));
    onChange([...ordered], option === "Other" && !next.includes("Other") ? "" : other);
  }

  return (
    <fieldset>
      <legend className="font-label text-[10px] uppercase text-muted">Frequency</legend>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {FREQUENCY_CHOICES.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={option} checked={selected.includes(option)} disabled={disabled} onChange={() => toggle(option)} />
            {option}
          </label>
        ))}
      </div>
      {selected.includes("Other") && (
        <input
          className="field mt-2"
          aria-label="Other frequency"
          value={other}
          disabled={disabled}
          placeholder="Enter the frequency"
          onChange={(event) => onChange(selected, event.target.value)}
        />
      )}
    </fieldset>
  );
}
