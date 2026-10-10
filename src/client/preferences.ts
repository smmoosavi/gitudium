import { readDiffMode, writeDiffMode, readDiffWrap, writeDiffWrap, readLinePairing, writeLinePairing, readWhitespaceMode, writeWhitespaceMode } from "./diff";
import { readFilesMode, writeFilesMode } from "./files";
import { defaultLayout, readLayout, writeLayout } from "./layout";
import { isRefExclusions } from "../repository/validation";

export const refExclusionsStorageKey = "gitudium.ref-exclusions.v1";
const refExclusions: Preference<string> = {
  defaultValue: () => "",
  read: storage => {
    const saved = storage.getItem(refExclusionsStorageKey);
    return isRefExclusions(saved) ? saved : "";
  },
  write: (storage, value) => storage.setItem(refExclusionsStorageKey, value),
};

export type Preference<T> = {
  defaultValue: () => T;
  read: (storage: Pick<Storage, "getItem">) => T;
  write: (storage: Pick<Storage, "setItem">, value: T) => void;
};
export type PreferenceStorage = () => Pick<Storage, "getItem" | "setItem">;
const browserStorage: PreferenceStorage = () => window.localStorage;

export function readPreference<T>(preference: Preference<T>, storage: PreferenceStorage = browserStorage): T {
  try { return preference.read(storage()); }
  catch { return preference.defaultValue(); }
}

export function writePreference<T>(preference: Preference<T>, value: T, storage: PreferenceStorage = browserStorage): void {
  try { preference.write(storage(), value); }
  catch { /* Preferences remain usable when storage is blocked or full. */ }
}

export const viewerPreferences = {
  refExclusions,
  wrap: { defaultValue: () => false, read: readDiffWrap, write: writeDiffWrap },
  filesMode: { defaultValue: () => "list" as const, read: readFilesMode, write: writeFilesMode },
  diffMode: { defaultValue: () => "unified" as const, read: readDiffMode, write: writeDiffMode },
  layout: { defaultValue: defaultLayout, read: readLayout, write: writeLayout },
  pairLines: { defaultValue: () => false, read: readLinePairing, write: writeLinePairing },
  whitespace: { defaultValue: () => "none" as const, read: readWhitespaceMode, write: writeWhitespaceMode },
};
