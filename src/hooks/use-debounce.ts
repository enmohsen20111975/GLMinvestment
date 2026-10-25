/**
 * hooks/use-debounce.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.10): useDebounce — debounce a value
 * (delay updating the debounced value until after `delay` ms of no changes).
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه inline debounce patterns في أكتر من مكان للـ search
 * inputs. الـ hook ده بـ يـوحّدهم.
 *
 * Migration (Phase 2 codemod): كل inline debounce pattern بـ يـتعمل بـ:
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebounce(query, 300);
 *   useApiQuery('/api/search', { params: { q: debouncedQuery } });
 * ============================================================================
 */

import { useState, useEffect } from 'react';

/**
 * بياخد value + delay و بيرجّع value جديدة اللي بـ تـتـأخر `delay` ms
 * قبل ما تـتـحدث. لو الـ value الأصلية اتـغيرت قبل ما الـ delay يخلص،
 * الـ timer بـ يـreset و الـ delay بـ يبدأ من الأول.
 *
 * @example
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 *
 * // الـ API call ما يـتعملش على كل keystroke — بس بعد ما المستخدم يـقف 300ms
 * const { data } = useApiQuery('/api/search', { params: { q: debouncedSearch } });
 *
 * @param value القيمة اللي عايزها تتـdebounce
 * @param delay مدة التـأخير بالـ milliseconds (default: 300ms)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    // لما الـ value تتـغير، ابدأ timer
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    // cleanup: لو الـ value اتـغير قبل ما الـ timer يخلص، الـ timer القديم
    // بـ يـتـكنسل و واحد جديد بـ يبدأ
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
