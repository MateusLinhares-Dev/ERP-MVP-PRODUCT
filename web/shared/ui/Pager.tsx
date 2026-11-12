export const PAGE_SIZES = [25, 50, 100] as const;

export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size: number,
): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

interface PagerProps {
  total: number;
  page: number;
  pages: number;
  size: number;
  onPage(page: number): void;
  onSize(size: number): void;
}

export function Pager({ total, page, pages, size, onPage, onSize }: PagerProps) {
  if (total <= PAGE_SIZES[0]) return null;
  const start = (page - 1) * size + 1;
  return (
    <div className="erp-list-pager">
      <span className="erp-list-pager-count" aria-live="polite">
        {start}–{Math.min(page * size, total)} de {total} registros
      </span>
      <div className="erp-list-pager-nav">
        <label>
          Por página{' '}
          <select
            aria-label="Registros por página"
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
          >
            {PAGE_SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </button>
        <span className="erp-list-pager-position">
          Página {page} de {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </button>
      </div>
    </div>
  );
}
