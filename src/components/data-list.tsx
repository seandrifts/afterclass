import type { ReactNode } from 'react';

/**
 * 同一份資料的兩種呈現：桌機用表格，手機用卡片。
 *
 * 讓表格橫向捲動在手機上是很糟的體驗，使用者要左右滑才能把一列
 * 看完，而且捲動時看不到欄位標題，根本不知道自己在看哪一欄。
 *
 * 老闆很可能站在店裡用手機看後台，這個差別很有感。
 */
export interface Column<T> {
  key: string;
  header: string;
  /** 桌機表格的儲存格 */
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** 手機卡片模式下隱藏這一欄（次要資訊） */
  hideOnMobile?: boolean;
}

export function DataList<T>({
  rows,
  columns,
  rowKey,
  /** 手機卡片的標題列 */
  mobileTitle,
  /** 手機卡片右上角的重點數字 */
  mobileHighlight,
  empty = '沒有資料',
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  mobileTitle: (row: T) => ReactNode;
  mobileHighlight?: (row: T) => ReactNode;
  empty?: string;
  footer?: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-line bg-raised py-12 text-center text-sm text-ink-soft">
        {empty}
      </div>
    );
  }

  return (
    <>
      {/* 手機：卡片 */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="rounded-card border border-line bg-raised p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-bold">{mobileTitle(row)}</div>
              {mobileHighlight ? (
                <div className="shrink-0 text-right">
                  {mobileHighlight(row)}
                </div>
              ) : null}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((col) => (
                  <div key={col.key} className="flex justify-between gap-2">
                    <dt className="text-ink-soft">{col.header}</dt>
                    <dd className="tabular text-right font-medium">
                      {col.cell(row)}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* 桌機：表格 */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-raised md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-xs text-ink-soft">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 font-medium ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line/60">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 ${
                      col.align === 'right' ? 'tabular text-right' : ''
                    }`}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </>
  );
}
