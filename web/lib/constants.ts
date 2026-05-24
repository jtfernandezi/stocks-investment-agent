export const START_CAPITAL = 60_000;

export const TICKER_NICHE: Record<string, string> = {
  CRWD: 'cybersecurity', PANW: 'cybersecurity', ZS: 'cybersecurity', OKTA: 'cybersecurity',
  FTNT: 'cybersecurity', S: 'cybersecurity', CYBR: 'cybersecurity', TMUS: 'cybersecurity',
  QLYS: 'cybersecurity', TENB: 'cybersecurity',
  LMT: 'defense', RTX: 'defense', NOC: 'defense', GD: 'defense', HII: 'defense',
  LHX: 'defense', KTOS: 'defense', RCAT: 'defense', PLTR: 'defense', AXON: 'defense',
  CCJ: 'nuclear_uranium', UEC: 'nuclear_uranium', NXE: 'nuclear_uranium', DNN: 'nuclear_uranium',
  SMR: 'nuclear_uranium', OKLO: 'nuclear_uranium', CEG: 'nuclear_uranium', VST: 'nuclear_uranium',
  ETR: 'nuclear_uranium', NEE: 'nuclear_uranium',
  FCX: 'copper_minerals', SCCO: 'copper_minerals', TECK: 'copper_minerals', HBM: 'copper_minerals',
  VALE: 'copper_minerals', MP: 'copper_minerals', LTHM: 'copper_minerals', ALB: 'copper_minerals',
  SQM: 'copper_minerals', LAC: 'copper_minerals',
  NVDA: 'ai_semiconductors', AMD: 'ai_semiconductors', AVGO: 'ai_semiconductors',
  QCOM: 'ai_semiconductors', MRVL: 'ai_semiconductors', AMAT: 'ai_semiconductors',
  KLAC: 'ai_semiconductors', LRCX: 'ai_semiconductors', MU: 'ai_semiconductors', ARM: 'ai_semiconductors',
  MSFT: 'cloud_hyperscalers', AMZN: 'cloud_hyperscalers', GOOGL: 'cloud_hyperscalers',
  META: 'cloud_hyperscalers', ORCL: 'cloud_hyperscalers', SNOW: 'cloud_hyperscalers',
  MDB: 'cloud_hyperscalers', DDOG: 'cloud_hyperscalers', NET: 'cloud_hyperscalers', CRM: 'cloud_hyperscalers',
  XOM: 'oil_gas', CVX: 'oil_gas', COP: 'oil_gas', SLB: 'oil_gas', HAL: 'oil_gas',
  MPC: 'oil_gas', PSX: 'oil_gas', VLO: 'oil_gas', OXY: 'oil_gas', EOG: 'oil_gas',
  EQIX: 'data_centers', DLR: 'data_centers', AMT: 'data_centers', IREN: 'data_centers',
  CORZ: 'data_centers', VRT: 'data_centers', SMCI: 'data_centers', DELL: 'data_centers',
  HPE: 'data_centers', WDC: 'data_centers',
};

export const NICHE_DISPLAY: Record<string, string> = {
  cybersecurity:     'Cybersecurity',
  defense:           'Defense',
  nuclear_uranium:   'Nuclear / Uranium',
  copper_minerals:   'Copper / Minerals',
  ai_semiconductors: 'AI & Semiconductors',
  cloud_hyperscalers:'Cloud Hyperscalers',
  oil_gas:           'Oil & Gas',
  data_centers:      'Data Centers',
};

export const ALL_NICHES = [
  'cybersecurity', 'defense', 'nuclear_uranium', 'copper_minerals',
  'ai_semiconductors', 'cloud_hyperscalers', 'oil_gas', 'data_centers',
] as const;
