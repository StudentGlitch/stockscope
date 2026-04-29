import {
  UsePaginationInstanceProps,
  UsePaginationState,
  UseSortByColumnProps,
  UseSortByInstanceProps,
  UseSortByState,
  UsePaginationOptions,
  UseSortByOptions,
} from 'react-table'

declare module 'react-table' {
  export interface TableInstance<D extends Record<string, unknown> = Record<string, unknown>>
    extends UsePaginationInstanceProps<D>,
      UseSortByInstanceProps<D> {}

  export interface TableState<D extends Record<string, unknown> = Record<string, unknown>>
    extends UsePaginationState<D>,
      UseSortByState<D> {}

  export interface ColumnInstance<D extends Record<string, unknown> = Record<string, unknown>>
    extends UseSortByColumnProps<D> {}

  export interface TableOptions<D extends Record<string, unknown>>
    extends UsePaginationOptions<D>,
      UseSortByOptions<D> {}
}
