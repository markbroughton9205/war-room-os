import { ADMIN_IDENTITY_DATA_PATHS } from './sources'
import type { AdminFlagAsset, AdminFlagOfficialStatus } from './types'

/**
 * Verified flag assets only. Country SVGs are vendored from flag-icons (MIT, Wikipedia SVG
 * lineage). State/province flags are Wikimedia Commons files with recorded licenses.
 * Territories not listed here render boundary + name only — never an invented flag.
 */
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina',
  GB: 'United Kingdom', FR: 'France', DE: 'Germany', ES: 'Spain', IT: 'Italy',
  PT: 'Portugal', NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', DK: 'Denmark', IE: 'Ireland',
  PL: 'Poland', UA: 'Ukraine', RU: 'Russia', TR: 'Turkey', GR: 'Greece',
  CN: 'China', JP: 'Japan', KR: 'South Korea', IN: 'India', PK: 'Pakistan',
  BD: 'Bangladesh', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines',
  AU: 'Australia', NZ: 'New Zealand', ZA: 'South Africa', EG: 'Egypt', NG: 'Nigeria',
  KE: 'Kenya', ET: 'Ethiopia', MA: 'Morocco', DZ: 'Algeria', SA: 'Saudi Arabia',
  AE: 'United Arab Emirates', IL: 'Israel', IR: 'Iran', IQ: 'Iraq', AF: 'Afghanistan',
  KZ: 'Kazakhstan', MN: 'Mongolia', CL: 'Chile', PE: 'Peru', CO: 'Colombia',
  VE: 'Venezuela', BO: 'Bolivia', EC: 'Ecuador', CU: 'Cuba', GT: 'Guatemala',
  HN: 'Honduras', CR: 'Costa Rica', PA: 'Panama', DO: 'Dominican Republic',
  PR: 'Puerto Rico', GL: 'Greenland', IS: 'Iceland', CZ: 'Czechia', SK: 'Slovakia',
  HU: 'Hungary', RO: 'Romania', BG: 'Bulgaria', RS: 'Serbia', HR: 'Croatia',
  SI: 'Slovenia', BA: 'Bosnia and Herzegovina', MK: 'North Macedonia', AL: 'Albania',
  LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', BY: 'Belarus', MD: 'Moldova',
  GE: 'Georgia', AM: 'Armenia', AZ: 'Azerbaijan', UZ: 'Uzbekistan', TM: 'Turkmenistan',
  KG: 'Kyrgyzstan', TJ: 'Tajikistan', NP: 'Nepal', LK: 'Sri Lanka', MM: 'Myanmar',
  KH: 'Cambodia', LA: 'Laos', MY: 'Malaysia', SG: 'Singapore', TW: 'Taiwan',
  HK: 'Hong Kong', MO: 'Macau', KP: 'North Korea',
  CD: 'Democratic Republic of the Congo', CG: 'Republic of the Congo', AO: 'Angola',
  TZ: 'Tanzania', UG: 'Uganda', GH: 'Ghana', CI: "Côte d'Ivoire", SN: 'Senegal',
  ML: 'Mali', NE: 'Niger', TD: 'Chad', SD: 'Sudan', SS: 'South Sudan',
  LY: 'Libya', TN: 'Tunisia', SO: 'Somalia', MZ: 'Mozambique', ZW: 'Zimbabwe',
  ZM: 'Zambia', BW: 'Botswana', NA: 'Namibia', MG: 'Madagascar', CM: 'Cameroon',
  QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', YE: 'Yemen', JO: 'Jordan', LB: 'Lebanon',
  SY: 'Syria', PS: 'Palestine', CY: 'Cyprus', MT: 'Malta', LU: 'Luxembourg',
  MC: 'Monaco', LI: 'Liechtenstein', AD: 'Andorra', SM: 'San Marino', VA: 'Vatican City',
  FJ: 'Fiji', PG: 'Papua New Guinea', NC: 'New Caledonia', PF: 'French Polynesia',
  WS: 'Samoa', TO: 'Tonga', VU: 'Vanuatu', SB: 'Solomon Islands',
  TT: 'Trinidad and Tobago', JM: 'Jamaica', HT: 'Haiti', BS: 'Bahamas',
  BZ: 'Belize', SV: 'El Salvador', NI: 'Nicaragua', GY: 'Guyana', SR: 'Suriname',
  PY: 'Paraguay', UY: 'Uruguay', GF: 'French Guiana',
}

const US_STATE_FLAGS: Array<{ iso: string; name: string; file: string; license: string; official: AdminFlagOfficialStatus }> = [
  { iso: 'US-AL', name: 'Alabama', file: 'Flag_of_Alabama.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-AK', name: 'Alaska', file: 'Flag_of_Alaska.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-AZ', name: 'Arizona', file: 'Flag_of_Arizona.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-AR', name: 'Arkansas', file: 'Flag_of_Arkansas.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-CA', name: 'California', file: 'Flag_of_California.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-CO', name: 'Colorado', file: 'Flag_of_Colorado.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-CT', name: 'Connecticut', file: 'Flag_of_Connecticut.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-DE', name: 'Delaware', file: 'Flag_of_Delaware.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-FL', name: 'Florida', file: 'Flag_of_Florida.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-GA', name: 'Georgia', file: 'Flag_of_Georgia_(U.S._state).svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-HI', name: 'Hawaii', file: 'Flag_of_Hawaii.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-ID', name: 'Idaho', file: 'Flag_of_Idaho.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-IL', name: 'Illinois', file: 'Flag_of_Illinois.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-IN', name: 'Indiana', file: 'Flag_of_Indiana.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-IA', name: 'Iowa', file: 'Flag_of_Iowa.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-KS', name: 'Kansas', file: 'Flag_of_Kansas.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-KY', name: 'Kentucky', file: 'Flag_of_Kentucky.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-LA', name: 'Louisiana', file: 'Flag_of_Louisiana.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-ME', name: 'Maine', file: 'Flag_of_Maine.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MD', name: 'Maryland', file: 'Flag_of_Maryland.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MA', name: 'Massachusetts', file: 'Flag_of_Massachusetts.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MI', name: 'Michigan', file: 'Flag_of_Michigan.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MN', name: 'Minnesota', file: 'Flag_of_Minnesota.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MS', name: 'Mississippi', file: 'Flag_of_Mississippi.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MO', name: 'Missouri', file: 'Flag_of_Missouri.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-MT', name: 'Montana', file: 'Flag_of_Montana.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NE', name: 'Nebraska', file: 'Flag_of_Nebraska.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NV', name: 'Nevada', file: 'Flag_of_Nevada.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NH', name: 'New Hampshire', file: 'Flag_of_New_Hampshire.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NJ', name: 'New Jersey', file: 'Flag_of_New_Jersey.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NM', name: 'New Mexico', file: 'Flag_of_New_Mexico.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NY', name: 'New York', file: 'Flag_of_New_York.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-NC', name: 'North Carolina', file: 'Flag_of_North_Carolina.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-ND', name: 'North Dakota', file: 'Flag_of_North_Dakota.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-OH', name: 'Ohio', file: 'Flag_of_Ohio.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-OK', name: 'Oklahoma', file: 'Flag_of_Oklahoma.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-OR', name: 'Oregon', file: 'Flag_of_Oregon.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-PA', name: 'Pennsylvania', file: 'Flag_of_Pennsylvania.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-RI', name: 'Rhode Island', file: 'Flag_of_Rhode_Island.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-SC', name: 'South Carolina', file: 'Flag_of_South_Carolina.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-SD', name: 'South Dakota', file: 'Flag_of_South_Dakota.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-TN', name: 'Tennessee', file: 'Flag_of_Tennessee.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-TX', name: 'Texas', file: 'Flag_of_Texas.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-UT', name: 'Utah', file: 'Flag_of_Utah.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-VT', name: 'Vermont', file: 'Flag_of_Vermont.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-VA', name: 'Virginia', file: 'Flag_of_Virginia.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-WA', name: 'Washington', file: 'Flag_of_Washington.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-WV', name: 'West Virginia', file: 'Flag_of_West_Virginia.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-WI', name: 'Wisconsin', file: 'Flag_of_Wisconsin.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-WY', name: 'Wyoming', file: 'Flag_of_Wyoming.svg', license: 'Public domain (US state flag)', official: 'official' },
  { iso: 'US-DC', name: 'District of Columbia', file: 'Flag_of_the_District_of_Columbia.svg', license: 'Public domain (US district flag)', official: 'official' },
]

const OTHER_STATE_FLAGS: Array<{ iso: string; name: string; file: string; license: string; official: AdminFlagOfficialStatus }> = [
  { iso: 'CA-ON', name: 'Ontario', file: 'Flag_of_Ontario.svg', license: 'Wikimedia Commons (provincial flag)', official: 'official' },
  { iso: 'CA-QC', name: 'Quebec', file: 'Flag_of_Quebec.svg', license: 'Wikimedia Commons (provincial flag)', official: 'official' },
  { iso: 'CA-BC', name: 'British Columbia', file: 'Flag_of_British_Columbia.svg', license: 'Wikimedia Commons (provincial flag)', official: 'official' },
  { iso: 'AU-NSW', name: 'New South Wales', file: 'Flag_of_New_South_Wales.svg', license: 'Wikimedia Commons (state flag)', official: 'official' },
  { iso: 'AU-VIC', name: 'Victoria', file: 'Flag_of_Victoria_(Australia).svg', license: 'Wikimedia Commons (state flag)', official: 'official' },
  { iso: 'AU-QLD', name: 'Queensland', file: 'Flag_of_Queensland.svg', license: 'Wikimedia Commons (state flag)', official: 'official' },
  { iso: 'DE-BY', name: 'Bavaria', file: 'Flag_of_Bavaria_(lozengy).svg', license: 'Wikimedia Commons (state flag)', official: 'official' },
  { iso: 'ES-CT', name: 'Catalonia', file: 'Flag_of_Catalonia.svg', license: 'Wikimedia Commons (autonomous-community flag)', official: 'official' },
  { iso: 'JP-13', name: 'Tokyo', file: 'Flag_of_Tokyo_Metropolis.svg', license: 'Wikimedia Commons (prefecture flag)', official: 'official' },
]

function countryAsset(iso2: string): AdminFlagAsset | null {
  const code = iso2.trim().toUpperCase()
  if (code.length !== 2 || code === '-99' || code === 'XX') return null
  const name = COUNTRY_NAMES[code] ?? code
  return {
    territoryId: code,
    territoryName: name,
    kind: 'country',
    isoCode: code,
    fileName: `${code.toLowerCase()}.svg`,
    publicPath: ADMIN_IDENTITY_DATA_PATHS.countryFlag(code),
    source: 'flag-icons (MIT) / Wikipedia SVG lineage',
    sourceUrl: 'https://github.com/lipis/flag-icons',
    license: 'MIT (flag-icons) · original SVG typically public domain or CC on Wikimedia',
    version: 'flag-icons-7',
    officialStatus: 'official',
  }
}

const STATE_BY_ISO = new Map<string, AdminFlagAsset>()
for (const row of [...US_STATE_FLAGS, ...OTHER_STATE_FLAGS]) {
  STATE_BY_ISO.set(row.iso, {
    territoryId: row.iso,
    territoryName: row.name,
    kind: 'state',
    isoCode: row.iso,
    fileName: row.file,
    publicPath: ADMIN_IDENTITY_DATA_PATHS.stateFlag(row.iso),
    source: 'Wikimedia Commons',
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(row.file)}`,
    license: row.license,
    version: 'wikimedia-commons',
    officialStatus: row.official,
  })
}

export function lookupFlagAsset(isoCode: string, kind: 'country' | 'state'): AdminFlagAsset | null {
  const code = isoCode.trim().toUpperCase()
  if (!code) return null
  if (kind === 'country') return countryAsset(code)
  return STATE_BY_ISO.get(code) ?? null
}

export function flagPublicPath(asset: AdminFlagAsset): string {
  return asset.publicPath
}

export function listedCountryIsoCodes(): string[] {
  return Object.keys(COUNTRY_NAMES).filter(code => code.length === 2)
}

export function listedStateIsoCodes(): string[] {
  return [...STATE_BY_ISO.keys()]
}

export { COUNTRY_NAMES, US_STATE_FLAGS }
