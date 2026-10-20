export function countryCodes(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== "all" && part.toLowerCase() !== "all countries");
}

/** Empty country, or "all", applies to every tab. A list applies to each of those codes. */
export function appliesToCountry(country: string, filter: string): boolean {
  const selected = filter.trim();
  if (!selected) return true;
  const codes = countryCodes(country);
  if (codes.length === 0) return true;
  return codes.some((code) => code.toLowerCase() === selected.toLowerCase());
}

export function countryLabel(country: string): string {
  const codes = country
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return codes.length ? codes.join(", ") : "All countries";
}
