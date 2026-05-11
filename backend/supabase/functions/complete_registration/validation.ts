const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_DATE_OF_BIRTH = "1900-01-01";

const parseIsoDateOnly = (value: string) => {
  const match = ISO_DATE_ONLY_RE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

export const isAdult = (dob: string, now = new Date()) => {
  const date = parseIsoDateOnly(dob);
  if (!date) return false;

  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18,
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  return date.getTime() <= cutoff.getTime();
};

export const isAllowedDateOfBirth = (dob: string) => {
  const date = parseIsoDateOnly(dob);
  const minimum = parseIsoDateOnly(MIN_DATE_OF_BIRTH);
  if (!date || !minimum) return false;
  return date.getTime() >= minimum.getTime();
};
