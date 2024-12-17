import { FilterFn } from "@tanstack/react-table";

export const fuzzyFilter: FilterFn<unknown> = (row, columnId, value) => {
  // Simple case-insensitive filtering
  const cellValue = String(row.getValue(columnId)).toLowerCase();
  const searchValue = value.toLowerCase();

  // Check if the cell value includes the search value
  return cellValue.includes(searchValue);
};