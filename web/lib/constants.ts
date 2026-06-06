export const START_CAPITAL = 60_000;

export const TICKER_NICHE: Record<string, string> = {
  CRWD: 'cybersecurity', PANW: 'cybersecurity', ZS: 'cybersecurity', OKTA: 'cybersecurity',
  FTNT: 'cybersecurity', S: 'cybersecurity', CYBR: 'cybersecurity', CHKP: 'cybersecurity',
  QLYS: 'cybersecurity', TENB: 'cybersecurity',
  LMT: 'defense', RTX: 'defense', NOC: 'defense', GD: 'defense', HII: 'defense',
  LHX: 'defense', KTOS: 'defense', RCAT: 'defense', PLTR: 'defense', AXON: 'defense',
  CCJ: 'nuclear_uranium', UEC: 'nuclear_uranium', NXE: 'nuclear_uranium', DNN: 'nuclear_uranium',
  SMR: 'nuclear_uranium', OKLO: 'nuclear_uranium', CEG: 'nuclear_uranium', VST: 'nuclear_uranium',
  ETR: 'nuclear_uranium', NEE: 'nuclear_uranium',
  FCX: 'copper_minerals', SCCO: 'copper_minerals', TECK: 'copper_minerals', HBM: 'copper_minerals',
  VALE: 'copper_minerals', MP: 'copper_minerals', AA: 'copper_minerals', ALB: 'copper_minerals',
  SQM: 'copper_minerals', LAC: 'copper_minerals',
  ARM: 'semiconductors', AMAT: 'semiconductors', LRCX: 'semiconductors', KLAC: 'semiconductors',
  ON: 'semiconductors', TER: 'semiconductors', NXPI: 'semiconductors', MCHP: 'semiconductors',
  MPWR: 'semiconductors', SNPS: 'semiconductors',
  ORCL: 'enterprise_saas', NOW: 'enterprise_saas', CRM: 'enterprise_saas', DDOG: 'enterprise_saas',
  SNOW: 'enterprise_saas', ADBE: 'enterprise_saas', NET: 'enterprise_saas', TEAM: 'enterprise_saas',
  WDAY: 'enterprise_saas', MDB: 'enterprise_saas',
  XOM: 'oil_gas', CVX: 'oil_gas', COP: 'oil_gas', SLB: 'oil_gas', HAL: 'oil_gas',
  MPC: 'oil_gas', PSX: 'oil_gas', VLO: 'oil_gas', OXY: 'oil_gas', EOG: 'oil_gas',
  EQIX: 'data_centers', DLR: 'data_centers', AMT: 'data_centers', IREN: 'data_centers',
  CORZ: 'data_centers', VRT: 'data_centers', SMCI: 'data_centers', DELL: 'data_centers',
  HPE: 'data_centers', WDC: 'data_centers',
  UNH: 'healthcare', ELV: 'healthcare', CVS: 'healthcare', LLY: 'healthcare', MRK: 'healthcare',
  PFE: 'healthcare', ABBV: 'healthcare', ISRG: 'healthcare', MDT: 'healthcare', TMO: 'healthcare',
  JPM: 'financials', BAC: 'financials', WFC: 'financials', C: 'financials', GS: 'financials',
  MS: 'financials', SCHW: 'financials', BLK: 'financials', AXP: 'financials', COF: 'financials',
};

export const NICHE_DISPLAY: Record<string, string> = {
  cybersecurity:    'Cybersecurity',
  defense:          'Defense',
  nuclear_uranium:  'Nuclear / Uranium',
  copper_minerals:  'Copper / Minerals',
  semiconductors:   'Semiconductors & EDA',
  enterprise_saas:  'Enterprise SaaS',
  oil_gas:          'Oil & Gas',
  data_centers:     'Data Centers',
  healthcare:       'Healthcare & Pharma',
  financials:       'Financials',
};

export const ALL_NICHES = [
  'cybersecurity', 'defense', 'nuclear_uranium', 'copper_minerals',
  'semiconductors', 'enterprise_saas', 'oil_gas', 'data_centers',
  'healthcare', 'financials',
] as const;
