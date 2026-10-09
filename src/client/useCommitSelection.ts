import { useEffect, useRef, useState } from "react";
import { CommitSelection } from "./commitSelection";

export function useCommitSelection(selected: string | null) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const selection = useRef<CommitSelection | null>(null);
  if (selection.current === null) selection.current = new CommitSelection(setDetailId);
  useEffect(() => {
    const current = selection.current!;
    current.select(selected);
  }, [selected]);
  useEffect(() => () => selection.current!.cancel(), []);
  return detailId === selected ? detailId : null;
}
