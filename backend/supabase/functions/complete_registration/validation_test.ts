import {
  isAdult,
  isAllowedDateOfBirth,
  MIN_DATE_OF_BIRTH,
} from "./validation.ts";

Deno.test("rejects birthdates before 1900", () => {
  if (!isAllowedDateOfBirth(MIN_DATE_OF_BIRTH)) {
    throw new Error("Expected minimum allowed date of birth to be accepted.");
  }

  if (isAllowedDateOfBirth("1899-12-31")) {
    throw new Error("Expected birthdates before 1900 to be rejected.");
  }
});

Deno.test("rejects malformed date strings", () => {
  if (isAllowedDateOfBirth("1900-02-30")) {
    throw new Error("Expected impossible calendar dates to be rejected.");
  }

  if (isAdult("not-a-date")) {
    throw new Error("Expected invalid DOB strings to fail age validation.");
  }
});

Deno.test("keeps the adult cutoff behavior", () => {
  const referenceNow = new Date(Date.UTC(2026, 4, 11));

  if (!isAdult("2008-05-11", referenceNow)) {
    throw new Error("Expected someone turning 18 today to pass validation.");
  }

  if (isAdult("2008-05-12", referenceNow)) {
    throw new Error("Expected someone still under 18 to fail validation.");
  }
});
