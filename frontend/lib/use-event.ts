'use client';

import { useCallback, useEffect, useRef } from 'react';

export function useEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result
): (...args: Args) => Result {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
