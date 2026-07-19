export type MarketKind = 'stock' | 'etf' | 'crypto';
export type StockScope =
  | 'sp500'
  | 'nasdaq100'
  | 'nasdaq-composite'
  | 'nyse'
  | 'all-stocks'
  | 'dow-jones';
export type AreaMetric = 'market_cap' | 'equal' | 'aum';
export type ColorMetric = 'daily_change_pct' | 'weekly_change_pct' | 'volume_delta_pct';
export type Grouping = 'sector' | 'asset_class' | 'none';
export type ResponseScenario = 'success' | 'empty' | 'error';

export interface MarketQuery {
  market?: MarketKind;
  data_source?: StockScope;
  area_metric?: AreaMetric;
  color_metric?: ColorMetric;
  group_by?: Grouping;
  include_btc?: boolean;
  search?: string;
  scenario?: ResponseScenario;
  request_id?: string;
  delay_ms?: number;
}

export interface MarketNode {
  id: string;
  parent_id: string;
  market: MarketKind;
  symbol: string;
  name: string;
  logo_path: string | null;
  price: number | null;
  market_cap: number | null;
  aum: number | null;
  volume: number | null;
  daily_change_pct: number | null;
  weekly_change_pct: number | null;
  volume_delta_pct: number | null;
  scope_ids: StockScope[];
  is_btc: boolean;
  boundary_tags: string[];
}

export interface MarketResponse {
  status: 'success' | 'warning' | 'error';
  summary: string;
  next_actions: string[];
  artifacts: string[];
  request_id: string;
  data: {
    groups: Array<{ id: string; name: string; market: MarketKind; order: number }>;
    nodes: MarketNode[];
  };
  meta: {
    query: Required<Pick<MarketQuery, 'market' | 'area_metric' | 'color_metric' | 'group_by'>>;
    color_domain: { soft_min: number; neutral: number; soft_max: number; clamp: boolean };
    generated_at: string;
  };
  error?: {
    code: string;
    root_cause_hint: string;
    safe_retry: string;
    stop_condition: string;
  };
}

export declare function getFixtureCatalog(): {
  schema_version: number;
  generated_at: string;
  groups: MarketResponse['data']['groups'];
  nodes: MarketNode[];
  capabilities: Record<string, unknown>;
};
export declare function requestMarketData(query?: MarketQuery): Promise<MarketResponse>;
