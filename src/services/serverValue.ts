import { useEffect, useRef } from 'react';
import { loadServerDocument, saveServerDocument, serverPersistenceEnabled } from './serverPersistence';

export function useServerValue<T>(tool: string, key: string, value: T, setValue: (value: T) => void): void {
  const hydrated = useRef(false);
  const writer = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!serverPersistenceEnabled()) return;
    let alive = true;
    void loadServerDocument<T>(`${tool}:${key}`).then((stored) => {
      if (alive && stored !== null) setValue(stored);
      hydrated.current = true;
    }).catch(() => { hydrated.current = true; });
    return () => { alive = false; };
  }, [tool, key, setValue]);
  useEffect(() => {
    if (!serverPersistenceEnabled() || !hydrated.current) return;
    writer.current = writer.current.catch(() => {}).then(() => saveServerDocument(`${tool}:${key}`, value, tool));
  }, [tool, key, value]);
}
