import { useEffect, useState } from "react";
import { readPreference, writePreference, type Preference } from "./preferences";

export function usePreference<T>(preference: Preference<T>) {
  const [value, setValue] = useState<T>(() => readPreference(preference));
  useEffect(() => { writePreference(preference, value); }, [preference, value]);
  return [value, setValue] as const;
}
