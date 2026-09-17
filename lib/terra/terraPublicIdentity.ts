/**
 * Identifying User-Agent for public Earth-data fetches. MET Norway and Nominatim require a
 * product + contact identity. Never use the literal "test@example.com" (met.no WAF blocks it).
 */
export const TERRA_PUBLIC_USER_AGENT =
  process.env.TERRA_USER_AGENT_BASE?.trim()
  || process.env.MET_NO_USER_AGENT_BASE?.trim()
  || 'WarRoomOS-Terra/1.0 (https://github.com/war-room-os; terra-coverage@warroom.local)'

export const TERRA_OFFICIAL_VIEWERS = {
  ohgo: 'https://www.ohgo.com/',
  ohgoMap: 'https://www.ohgo.com/map',
  ny511: 'https://511ny.org/',
  caltrans: 'https://cwwp2.dot.ca.gov/vm/ifw/ifw_display.php',
  metNorway: 'https://www.yr.no/',
  openMeteo: 'https://open-meteo.com/',
  gbif: 'https://www.gbif.org/',
  obis: 'https://obis.org/',
  nominatim: 'https://nominatim.openstreetmap.org/',
  osm: 'https://www.openstreetmap.org/',
  ohm: 'https://www.openhistoricalmap.org/',
  idai: 'https://gazetteer.dainst.org/',
  pleiades: 'https://pleiades.stoa.org/',
  whg: 'https://whgazetteer.org/',
  edh: 'https://edh.ub.uni-heidelberg.de/',
} as const
