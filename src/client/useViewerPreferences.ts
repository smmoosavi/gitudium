import { viewerPreferences } from "./preferences";
import { usePreference } from "./usePreference";

export function useViewerPreferences() {
  const [wrap, setWrap] = usePreference(viewerPreferences.wrap);
  const [filesMode, setFilesMode] = usePreference(viewerPreferences.filesMode);
  const [diffMode, setDiffMode] = usePreference(viewerPreferences.diffMode);
  const [layout, setLayout] = usePreference(viewerPreferences.layout);
  return { wrap, setWrap, filesMode, setFilesMode, diffMode, setDiffMode, layout, setLayout };
}
