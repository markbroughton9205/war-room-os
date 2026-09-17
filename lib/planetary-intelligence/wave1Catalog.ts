import type { EndpointType, PlanetaryGeography, PlanetaryTopic, SourceClass } from './types'
import type { LocalityClass } from './sourceGeography'
import type { SourceRoleClass, Wave1Candidate } from './registryTypes'

type Loc = LocalityClass
type Role = SourceRoleClass
type Geo = PlanetaryGeography

function parse(block: string, continent: string, discoveryMethod: string): Wave1Candidate[] {
  return block.trim().split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const parts = line.split('|').map(part => part?.trim() || '')
    const [name, home, country, geo, loc, lang, type, role, own, pub, parent] = parts
    const city = parts[11] || ''
    let rss = parts[12] || ''
    let gap = parts[13] || ''
    let topics = parts[14] || ''
    let state = ''
    if (rss && !/^https?:\/\//i.test(rss)) {
      state = rss
      rss = ''
      if (!gap && parts[13]) gap = parts[13]
      if (!topics && parts[14]) topics = parts[14]
    }
    const languages = (lang || 'und').includes(',') ? lang.split(',').map(item => item.trim()) : [lang || 'und']
    return {
      canonicalName: name,
      homepage: home,
      country,
      region: geo as Geo,
      continent,
      localityClass: loc as Loc,
      sourceRole: (role || 'OTHER') as Role,
      primaryLanguage: languages[0]!,
      supportedLanguages: languages,
      sourceType: type as SourceClass,
      ownershipType: own || 'UNKNOWN',
      publisher: pub || name,
      parentCompany: parent || null,
      cityLocality: city || null,
      stateProvince: state || null,
      endpointUrl: rss || null,
      endpointType: (rss ? (rss.includes('atom') ? 'ATOM' : /\/api|\.gov\/alerts/i.test(rss) ? 'API' : 'RSS') : 'HTML') as EndpointType,
      discoveryMethod,
      requestedDiscoveryLanguage: languages[0]!,
      actualQueryLanguage: languages[0]!,
      gapPriority: gap || null,
      topics: topics ? topics.split(',').map(item => item.trim() as PlanetaryTopic) : [],
      originalReporting: type === 'JOURNALISM',
    } satisfies Wave1Candidate
  })
}

const AFRICA = `
Daily Nation|https://nation.africa|Kenya|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|INDEPENDENT|Nation Media Group|Nation Media Group|Nairobi||sw-health
The Standard Kenya|https://www.standardmedia.co.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|INDEPENDENT|Standard Group|Standard Group|Nairobi||
Tuko|https://tuko.co.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|INDEPENDENT|Tuko|Tuko|Nairobi||
KBC|https://www.kbc.co.ke|Kenya|EAST_AFRICA|NATIONAL|sw,en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Kenya Broadcasting Corporation|Kenya Broadcasting Corporation|Nairobi||sw-health
Kenya News Agency|https://www.kenyanews.go.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|GOVERNMENT|OFFICIAL|GOVERNMENT|Kenya News Agency|Government of Kenya|Nairobi||
Kenya Gazette|https://kenyagazette.go.ke|Kenya|EAST_AFRICA|NATIONAL|en|OFFICIAL_RECORD|OFFICIAL|GOVERNMENT|Attorney-General Kenya|Government of Kenya|Nairobi||
KNBS|https://www.knbs.or.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|GOVERNMENT|OFFICIAL|GOVERNMENT|Kenya National Bureau of Statistics|Government of Kenya|Nairobi||
Kenya Meteorological Department|https://meteo.go.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|WEATHER|WEATHER|GOVERNMENT|Kenya Meteorological Department|Government of Kenya|Nairobi||sw-health,WEATHER
Nairobi City County|https://nairobi.go.ke|Kenya|EAST_AFRICA|CITY_LOCAL|en,sw|GOVERNMENT|OFFICIAL|GOVERNMENT|Nairobi City County|Government of Kenya|Nairobi||LOCAL_GOVERNANCE
University of Nairobi|https://www.uonbi.ac.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|University of Nairobi|University of Nairobi|Nairobi||SCIENCE
Mwananchi|https://www.mwananchi.co.tz|Tanzania|EAST_AFRICA|NATIONAL|sw|JOURNALISM|NATIONAL|INDEPENDENT|Mwananchi Communications|Mwananchi Communications|Dar es Salaam||sw-health
The Citizen Tanzania|https://www.thecitizen.co.tz|Tanzania|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|INDEPENDENT|Mwananchi Communications|Mwananchi Communications|Dar es Salaam||
Nipashe|https://www.ippmedia.com/sw/nipashe|Tanzania|EAST_AFRICA|NATIONAL|sw|JOURNALISM|NATIONAL|INDEPENDENT|IPP Media|IPP Media|Dar es Salaam||sw-health
TBC|https://www.tbc.go.tz|Tanzania|EAST_AFRICA|NATIONAL|sw,en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Tanzania Broadcasting Corporation|Government of Tanzania|Dodoma||sw-health
Daily News Tanzania|https://dailynews.co.tz|Tanzania|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|GOVERNMENT|Tanzania Standard Newspapers|Government of Tanzania|Dar es Salaam||
Tanzania Met Agency|https://www.meteo.go.tz|Tanzania|EAST_AFRICA|NATIONAL|sw,en|WEATHER|WEATHER|GOVERNMENT|Tanzania Meteorological Authority|Government of Tanzania|Dodoma||WEATHER
Daily Monitor|https://www.monitor.co.ug|Uganda|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|INDEPENDENT|Nation Media Group|Nation Media Group|Kampala||
New Vision|https://www.newvision.co.ug|Uganda|EAST_AFRICA|NATIONAL|en,sw|JOURNALISM|NATIONAL|GOVERNMENT|Vision Group|Vision Group|Kampala||
UBOS|https://www.ubos.org|Uganda|EAST_AFRICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Uganda Bureau of Statistics|Government of Uganda|Kampala||
The New Times Rwanda|https://www.newtimes.co.rw|Rwanda|EAST_AFRICA|NATIONAL|en,fr|JOURNALISM|NATIONAL|INDEPENDENT|The New Times|The New Times|Kigali||
IGIHE|https://igihe.com|Rwanda|EAST_AFRICA|NATIONAL|rw,en,fr|JOURNALISM|NATIONAL|INDEPENDENT|IGIHE|IGIHE|Kigali||
Punch Nigeria|https://punchng.com|Nigeria|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Punch Nigeria|Punch Nigeria|Lagos||
Premium Times|https://www.premiumtimesng.com|Nigeria|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Premium Times|Premium Times|Abuja||
Vanguard Nigeria|https://www.vanguardngr.com|Nigeria|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Vanguard Media|Vanguard Media|Lagos||
The Guardian Nigeria|https://guardian.ng|Nigeria|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Guardian Newspapers|Guardian Newspapers|Lagos||
Daily Trust|https://dailytrust.com|Nigeria|WEST_AFRICA|NATIONAL|en,ha|JOURNALISM|NATIONAL|INDEPENDENT|Media Trust|Media Trust|Abuja||
NBS Nigeria|https://www.nigerianstat.gov.ng|Nigeria|WEST_AFRICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|National Bureau of Statistics Nigeria|Government of Nigeria|Abuja||
NiMet|https://nimet.gov.ng|Nigeria|WEST_AFRICA|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|Nigerian Meteorological Agency|Government of Nigeria|Abuja||WEATHER
Lagos State Government|https://lagosstate.gov.ng|Nigeria|WEST_AFRICA|REGIONAL|en,yo|GOVERNMENT|OFFICIAL|GOVERNMENT|Lagos State Government|Government of Nigeria|Lagos|Lagos||LOCAL_GOVERNANCE
Graphic Ghana|https://www.graphic.com.gh|Ghana|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|GOVERNMENT|Graphic Communications|Graphic Communications|Accra||
GhanaWeb|https://www.ghanaweb.com|Ghana|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|GhanaWeb|GhanaWeb|Accra||
Joy Online|https://www.myjoyonline.com|Ghana|WEST_AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|The Multimedia Group|The Multimedia Group|Accra||
Ghana Statistical Service|https://www.statsghana.gov.gh|Ghana|WEST_AFRICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Ghana Statistical Service|Government of Ghana|Accra||
GMet|https://www.meteo.gov.gh|Ghana|WEST_AFRICA|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|Ghana Meteorological Agency|Government of Ghana|Accra||WEATHER
University of Ghana|https://www.ug.edu.gh|Ghana|WEST_AFRICA|NATIONAL|en|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|University of Ghana|University of Ghana|Accra||SCIENCE
Fraternite Matin|https://www.fratmat.info|Cote d'Ivoire|WEST_AFRICA|NATIONAL|fr|JOURNALISM|NATIONAL|GOVERNMENT|Fraternite Matin|Fraternite Matin|Abidjan||
RFI Afrique|https://www.rfi.fr/fr/afrique|France|WEST_AFRICA|INTERNATIONAL|fr|JOURNALISM|INTERNATIONAL|PUBLIC_BROADCASTER|Radio France Internationale|France Medias Monde|||
APA Dakar|https://apanews.net|Senegal|WEST_AFRICA|REGIONAL|fr|JOURNALISM|REGIONAL|INDEPENDENT|African Press Agency|African Press Agency|Dakar||
Le Soleil Senegal|https://lesoleil.sn|Senegal|WEST_AFRICA|NATIONAL|fr|JOURNALISM|NATIONAL|GOVERNMENT|Le Soleil|Le Soleil|Dakar||
ANSD Senegal|https://www.ansd.sn|Senegal|WEST_AFRICA|NATIONAL|fr|GOVERNMENT|OFFICIAL|GOVERNMENT|ANSD|Government of Senegal|Dakar||
ANAM Senegal|https://www.anam.sn|Senegal|WEST_AFRICA|NATIONAL|fr|WEATHER|WEATHER|GOVERNMENT|ANAM Senegal|Government of Senegal|Dakar||WEATHER
Mail and Guardian|https://mg.co.za|South Africa|AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Mail & Guardian|Mail & Guardian|Johannesburg||
News24|https://www.news24.com|South Africa|AFRICA|NATIONAL|en,af|JOURNALISM|NATIONAL|CORPORATE_GROUP|News24|Naspers|Cape Town||
SABC News|https://www.sabcnews.com|South Africa|AFRICA|NATIONAL|en,zu,af|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|SABC|SABC|Johannesburg||
Daily Maverick|https://www.dailymaverick.co.za|South Africa|AFRICA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Daily Maverick|Daily Maverick|Cape Town||
Stats SA|https://www.statssa.gov.za|South Africa|AFRICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Statistics South Africa|Government of South Africa|Pretoria||
SAWS|https://www.weathersa.co.za|South Africa|AFRICA|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|South African Weather Service|Government of South Africa|Pretoria||WEATHER
City of Cape Town|https://www.capetown.gov.za|South Africa|AFRICA|CITY_LOCAL|en,af,xh|GOVERNMENT|OFFICIAL|GOVERNMENT|City of Cape Town|Government of South Africa|Cape Town|Western Cape||LOCAL_GOVERNANCE
Addis Standard|https://addisstandard.com|Ethiopia|EAST_AFRICA|NATIONAL|en,am|JOURNALISM|NATIONAL|INDEPENDENT|Addis Standard|Addis Standard|Addis Ababa||
ENA Ethiopia|https://www.ena.et|Ethiopia|EAST_AFRICA|NATIONAL|am,en|GOVERNMENT|OFFICIAL|GOVERNMENT|Ethiopian News Agency|Government of Ethiopia|Addis Ababa||
AllAfrica|https://allafrica.com|Mauritius|AFRICA|REGIONAL|en,fr|JOURNALISM|REGIONAL|INDEPENDENT|AllAfrica|AllAfrica|||
ReliefWeb|https://reliefweb.int|Global|AFRICA|INTERNATIONAL|en,fr,ar|NGO|NGO|GOVERNMENT|UN OCHA|United Nations|||
VOA Swahili|https://www.voaswahili.com|United States|EAST_AFRICA|INTERNATIONAL|sw|JOURNALISM|DIASPORA|GOVERNMENT|Voice of America|USAGM|||sw-health
Makerere University|https://www.mak.ac.ug|Uganda|EAST_AFRICA|NATIONAL|en|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Makerere University|Makerere University|Kampala||SCIENCE
Aga Khan University|https://www.aku.edu|Kenya|EAST_AFRICA|REGIONAL|en,sw|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Aga Khan University|Aga Khan Development Network|Nairobi||HEALTH
Kenya Railways|https://krc.co.ke|Kenya|EAST_AFRICA|NATIONAL|en,sw|TRANSPORT|TRANSPORT|GOVERNMENT|Kenya Railways|Government of Kenya|Nairobi||TRANSPORT
Nairobi Water|https://www.nairobiwater.co.ke|Kenya|EAST_AFRICA|CITY_LOCAL|en,sw|UTILITIES|UTILITY|GOVERNMENT|Nairobi City Water and Sewerage|Nairobi City County|Nairobi||INFRASTRUCTURE
`

const EAST_ASIA = `
NHK News|https://www3.nhk.or.jp/news/|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|NHK|NHK|Tokyo||ja-infra
Asahi Shimbun|https://www.asahi.com|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|NATIONAL|INDEPENDENT|The Asahi Shimbun|The Asahi Shimbun|Tokyo||ja-infra
Mainichi Shimbun|https://mainichi.jp|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|NATIONAL|INDEPENDENT|The Mainichi Newspapers|The Mainichi Newspapers|Tokyo||
Yomiuri Shimbun|https://www.yomiuri.co.jp|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|NATIONAL|INDEPENDENT|The Yomiuri Shimbun|The Yomiuri Shimbun|Tokyo||
Nikkei|https://www.nikkei.com|Japan|EAST_ASIA|NATIONAL|ja|TRADE_SOURCE|TRADE|INDEPENDENT|Nikkei Inc|Nikkei Inc|Tokyo||ECONOMICS
Kyodo News|https://www.kyodo.co.jp|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|NATIONAL|INDEPENDENT|Kyodo News|Kyodo News|Tokyo||
Jiji Press|https://www.jiji.com|Japan|EAST_ASIA|NATIONAL|ja|JOURNALISM|NATIONAL|INDEPENDENT|Jiji Press|Jiji Press|Tokyo||
Japan Times|https://www.japantimes.co.jp|Japan|EAST_ASIA|NATIONAL|en,ja|JOURNALISM|NATIONAL|INDEPENDENT|The Japan Times|The Japan Times|Tokyo||
Hokkaido Shimbun|https://www.hokkaido-np.co.jp|Japan|EAST_ASIA|REGIONAL|ja|JOURNALISM|REGIONAL|INDEPENDENT|Hokkaido Shimbun|Hokkaido Shimbun|Sapporo|Hokkaido||ja-infra
Chunichi Shimbun|https://www.chunichi.co.jp|Japan|EAST_ASIA|REGIONAL|ja|JOURNALISM|REGIONAL|INDEPENDENT|Chunichi Shimbun|Chunichi Shimbun|Nagoya|Aichi||ja-infra
Nishinippon Shimbun|https://www.nishinippon.co.jp|Japan|EAST_ASIA|REGIONAL|ja|JOURNALISM|REGIONAL|INDEPENDENT|Nishinippon Shimbun|Nishinippon Shimbun|Fukuoka|Fukuoka||ja-infra
Okinawa Times|https://www.okinawatimes.co.jp|Japan|EAST_ASIA|REGIONAL|ja|JOURNALISM|REGIONAL|INDEPENDENT|Okinawa Times|Okinawa Times|Naha|Okinawa||ja-infra
Kyoto Shimbun|https://www.kyoto-np.co.jp|Japan|EAST_ASIA|REGIONAL|ja|JOURNALISM|REGIONAL|INDEPENDENT|Kyoto Shimbun|Kyoto Shimbun|Kyoto|Kyoto||ja-infra
Tokyo Shimbun|https://www.tokyo-np.co.jp|Japan|EAST_ASIA|CITY_LOCAL|ja|JOURNALISM|CITY_LOCAL|INDEPENDENT|Chunichi Shimbun|Chunichi Shimbun|Tokyo|Tokyo||ja-infra
JMA|https://www.jma.go.jp|Japan|EAST_ASIA|NATIONAL|ja|WEATHER|WEATHER|GOVERNMENT|Japan Meteorological Agency|Government of Japan|Tokyo||WEATHER
e-Gov Japan|https://www.e-gov.go.jp|Japan|EAST_ASIA|NATIONAL|ja|GOVERNMENT|OFFICIAL|GOVERNMENT|e-Gov|Government of Japan|Tokyo||ja-infra
e-Stat Japan|https://www.e-stat.go.jp|Japan|EAST_ASIA|NATIONAL|ja|GOVERNMENT|OFFICIAL|GOVERNMENT|Statistics Bureau of Japan|Government of Japan|Tokyo||
MLIT|https://www.mlit.go.jp|Japan|EAST_ASIA|NATIONAL|ja|GOVERNMENT|OFFICIAL|GOVERNMENT|MLIT Japan|Government of Japan|Tokyo||ja-infra,INFRASTRUCTURE
J-STAGE|https://www.jstage.jst.go.jp|Japan|EAST_ASIA|NATIONAL|ja,en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|JST|Japan Science and Technology Agency|||SCIENCE
NDL|https://ndlsearch.ndl.go.jp|Japan|EAST_ASIA|NATIONAL|ja|ACADEMIC_SOURCE|EDUCATION|GOVERNMENT|National Diet Library|Government of Japan|Tokyo||
University of Tokyo|https://www.u-tokyo.ac.jp|Japan|EAST_ASIA|NATIONAL|ja,en|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|University of Tokyo|University of Tokyo|Tokyo||SCIENCE
Kyoto University|https://www.kyoto-u.ac.jp|Japan|EAST_ASIA|REGIONAL|ja,en|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Kyoto University|Kyoto University|Kyoto|Kyoto||SCIENCE
JR East|https://www.jreast.co.jp|Japan|EAST_ASIA|REGIONAL|ja|TRANSPORT|TRANSPORT|CORPORATE_GROUP|East Japan Railway Company|JR East|Tokyo||TRANSPORT
Tokyo Metro|https://www.tokyometro.jp|Japan|EAST_ASIA|CITY_LOCAL|ja|TRANSPORT|TRANSPORT|GOVERNMENT|Tokyo Metro|Tokyo Metro|Tokyo|Tokyo||TRANSPORT
SCMP|https://www.scmp.com|Hong Kong|EAST_ASIA|REGIONAL|en,zh|JOURNALISM|REGIONAL|CORPORATE_GROUP|South China Morning Post|Alibaba Group|Hong Kong||
Ming Pao|https://news.mingpao.com|Hong Kong|EAST_ASIA|REGIONAL|zh|JOURNALISM|REGIONAL|INDEPENDENT|Ming Pao|Media Chinese International|Hong Kong||
RTHK|https://news.rthk.hk|Hong Kong|EAST_ASIA|REGIONAL|zh,en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|RTHK|RTHK|Hong Kong||
Hong Kong Observatory|https://www.hko.gov.hk|Hong Kong|EAST_ASIA|REGIONAL|zh,en|WEATHER|WEATHER|GOVERNMENT|Hong Kong Observatory|Government of Hong Kong|Hong Kong||WEATHER
Yonhap|https://www.yna.co.kr|South Korea|EAST_ASIA|NATIONAL|ko|JOURNALISM|NATIONAL|INDEPENDENT|Yonhap News Agency|Yonhap|Seoul||
KBS|https://news.kbs.co.kr|South Korea|EAST_ASIA|NATIONAL|ko|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|KBS|KBS|Seoul||
Chosun Ilbo|https://www.chosun.com|South Korea|EAST_ASIA|NATIONAL|ko|JOURNALISM|NATIONAL|INDEPENDENT|Chosun Ilbo|Chosun Ilbo|Seoul||
KMA Korea|https://www.kma.go.kr|South Korea|EAST_ASIA|NATIONAL|ko|WEATHER|WEATHER|GOVERNMENT|Korea Meteorological Administration|Government of South Korea|Seoul||WEATHER
Statistics Korea|https://kostat.go.kr|South Korea|EAST_ASIA|NATIONAL|ko|GOVERNMENT|OFFICIAL|GOVERNMENT|Statistics Korea|Government of South Korea|Daejeon||
People's Daily|https://www.people.com.cn|China|EAST_ASIA|NATIONAL|zh|JOURNALISM|NATIONAL|GOVERNMENT|People's Daily|People's Daily|Beijing||
Xinhua|https://www.news.cn|China|EAST_ASIA|NATIONAL|zh|JOURNALISM|NATIONAL|GOVERNMENT|Xinhua News Agency|Xinhua|Beijing||
China Daily|https://www.chinadaily.com.cn|China|EAST_ASIA|NATIONAL|en,zh|JOURNALISM|NATIONAL|GOVERNMENT|China Daily|China Daily|Beijing||
CMA China|https://www.cma.gov.cn|China|EAST_ASIA|NATIONAL|zh|WEATHER|WEATHER|GOVERNMENT|China Meteorological Administration|Government of China|Beijing||WEATHER
`

const SOUTHEAST_ASIA = `
Kompas|https://www.kompas.com|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|JOURNALISM|NATIONAL|INDEPENDENT|Kompas Gramedia|Kompas Gramedia|Jakarta||id-infra
Tempo|https://www.tempo.co|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|JOURNALISM|NATIONAL|INDEPENDENT|Tempo Inti Media|Tempo Inti Media|Jakarta||id-infra
Antara|https://www.antaranews.com|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|JOURNALISM|NATIONAL|GOVERNMENT|LKBN Antara|LKBN Antara|Jakarta||id-infra
Republika|https://www.republika.co.id|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|JOURNALISM|NATIONAL|INDEPENDENT|Republika|Mahaka Media|Jakarta||
detik|https://www.detik.com|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|JOURNALISM|NATIONAL|CORPORATE_GROUP|detikcom|CT Corp|Jakarta||
The Jakarta Post|https://www.thejakartapost.com|Indonesia|SOUTHEAST_ASIA|NATIONAL|en,id|JOURNALISM|NATIONAL|INDEPENDENT|PT Bina Media Tenggara|PT Bina Media Tenggara|Jakarta||
Jawa Pos|https://www.jawapos.com|Indonesia|SOUTHEAST_ASIA|REGIONAL|id|JOURNALISM|REGIONAL|CORPORATE_GROUP|Jawa Pos|Jawa Pos Group|Surabaya|East Java||id-infra
Pikiran Rakyat|https://www.pikiran-rakyat.com|Indonesia|SOUTHEAST_ASIA|REGIONAL|id|JOURNALISM|REGIONAL|INDEPENDENT|Pikiran Rakyat|Pikiran Rakyat|Bandung|West Java||id-infra
BMKG|https://www.bmkg.go.id|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|WEATHER|WEATHER|GOVERNMENT|BMKG|Government of Indonesia|Jakarta||WEATHER
BPS Indonesia|https://www.bps.go.id|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|GOVERNMENT|OFFICIAL|GOVERNMENT|BPS|Government of Indonesia|Jakarta||
KAI|https://www.kai.id|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|TRANSPORT|TRANSPORT|GOVERNMENT|PT Kereta Api Indonesia|Government of Indonesia|Bandung||TRANSPORT,id-infra
ITB|https://www.itb.ac.id|Indonesia|SOUTHEAST_ASIA|REGIONAL|id|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Institut Teknologi Bandung|ITB|Bandung|West Java||SCIENCE,id-infra
University of Indonesia|https://www.ui.ac.id|Indonesia|SOUTHEAST_ASIA|NATIONAL|id|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Universitas Indonesia|Universitas Indonesia|Depok|West Java||SCIENCE
Jakarta Provincial Government|https://www.jakarta.go.id|Indonesia|SOUTHEAST_ASIA|CITY_LOCAL|id|GOVERNMENT|OFFICIAL|GOVERNMENT|Pemerintah Provinsi DKI Jakarta|Government of Indonesia|Jakarta||LOCAL_GOVERNANCE
Straits Times|https://www.straitstimes.com|Singapore|SOUTHEAST_ASIA|NATIONAL|en|JOURNALISM|NATIONAL|CORPORATE_GROUP|The Straits Times|SPH Media|Singapore||
CNA|https://www.channelnewsasia.com|Singapore|SOUTHEAST_ASIA|NATIONAL|en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Mediacorp|Mediacorp|Singapore||
The Star Malaysia|https://www.thestar.com.my|Malaysia|SOUTHEAST_ASIA|NATIONAL|en,ms|JOURNALISM|NATIONAL|INDEPENDENT|Star Media Group|Star Media Group|Petaling Jaya||
Bernama|https://www.bernama.com|Malaysia|SOUTHEAST_ASIA|NATIONAL|ms,en|JOURNALISM|NATIONAL|GOVERNMENT|BERNAMA|Government of Malaysia|Kuala Lumpur||
MetMalaysia|https://www.met.gov.my|Malaysia|SOUTHEAST_ASIA|NATIONAL|ms,en|WEATHER|WEATHER|GOVERNMENT|Malaysian Meteorological Department|Government of Malaysia|Petaling Jaya||WEATHER
Bangkok Post|https://www.bangkokpost.com|Thailand|SOUTHEAST_ASIA|NATIONAL|en,th|JOURNALISM|NATIONAL|INDEPENDENT|Bangkok Post|Bangkok Post|Bangkok||
Thai PBS|https://www.thaipbs.or.th|Thailand|SOUTHEAST_ASIA|NATIONAL|th|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Thai PBS|Thai PBS|Bangkok||
TMD Thailand|https://www.tmd.go.th|Thailand|SOUTHEAST_ASIA|NATIONAL|th|WEATHER|WEATHER|GOVERNMENT|Thai Meteorological Department|Government of Thailand|Bangkok||WEATHER
VNExpress|https://vnexpress.net|Vietnam|SOUTHEAST_ASIA|NATIONAL|vi|JOURNALISM|NATIONAL|INDEPENDENT|VNExpress|FPT|Hanoi||
Nhan Dan|https://nhandan.vn|Vietnam|SOUTHEAST_ASIA|NATIONAL|vi|JOURNALISM|NATIONAL|GOVERNMENT|Nhan Dan|Nhan Dan|Hanoi||
Inquirer|https://www.inquirer.net|Philippines|SOUTHEAST_ASIA|NATIONAL|en,fil|JOURNALISM|NATIONAL|INDEPENDENT|Philippine Daily Inquirer|Inquirer Group|Manila||
Rappler|https://www.rappler.com|Philippines|SOUTHEAST_ASIA|NATIONAL|en,fil|JOURNALISM|NATIONAL|INDEPENDENT|Rappler|Rappler|Manila||
PAGASA|https://www.pagasa.dost.gov.ph|Philippines|SOUTHEAST_ASIA|NATIONAL|en,fil|WEATHER|WEATHER|GOVERNMENT|PAGASA|Government of the Philippines|Quezon City||WEATHER
`

const SOUTH_ASIA = `
The Hindu|https://www.thehindu.com|India|SOUTH_ASIA|NATIONAL|en,ta|JOURNALISM|NATIONAL|INDEPENDENT|The Hindu|The Hindu Group|Chennai||
Indian Express|https://indianexpress.com|India|SOUTH_ASIA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|The Indian Express|Indian Express Group|Mumbai||
Dainik Jagran|https://www.jagran.com|India|SOUTH_ASIA|NATIONAL|hi|JOURNALISM|NATIONAL|INDEPENDENT|Dainik Jagran|Jagran Prakashan|Kanpur||hi-econ
Amar Ujala|https://www.amarujala.com|India|SOUTH_ASIA|NATIONAL|hi|JOURNALISM|NATIONAL|INDEPENDENT|Amar Ujala|Amar Ujala|Noida||hi-econ
Hindustan|https://www.livehindustan.com|India|SOUTH_ASIA|NATIONAL|hi|JOURNALISM|NATIONAL|CORPORATE_GROUP|Hindustan|HT Media|New Delhi||hi-econ
Navbharat Times|https://navbharattimes.indiatimes.com|India|SOUTH_ASIA|NATIONAL|hi|JOURNALISM|NATIONAL|CORPORATE_GROUP|Navbharat Times|The Times Group|New Delhi||hi-econ
PIB India|https://pib.gov.in|India|SOUTH_ASIA|NATIONAL|hi,en|GOVERNMENT|OFFICIAL|GOVERNMENT|Press Information Bureau|Government of India|New Delhi||hi-econ
MOSPI|https://www.mospi.gov.in|India|SOUTH_ASIA|NATIONAL|en,hi|GOVERNMENT|OFFICIAL|GOVERNMENT|Ministry of Statistics India|Government of India|New Delhi||hi-econ,ECONOMICS
IMD|https://mausam.imd.gov.in|India|SOUTH_ASIA|NATIONAL|hi,en|WEATHER|WEATHER|GOVERNMENT|India Meteorological Department|Government of India|New Delhi||WEATHER
RBI|https://www.rbi.org.in|India|SOUTH_ASIA|NATIONAL|en,hi|GOVERNMENT|OFFICIAL|GOVERNMENT|Reserve Bank of India|Government of India|Mumbai||hi-econ,ECONOMICS
Indian Railways|https://indianrailways.gov.in|India|SOUTH_ASIA|NATIONAL|hi,en|TRANSPORT|TRANSPORT|GOVERNMENT|Indian Railways|Government of India|New Delhi||TRANSPORT
IIT Bombay|https://www.iitb.ac.in|India|SOUTH_ASIA|CITY_LOCAL|en,hi|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|IIT Bombay|IIT Bombay|Mumbai|Maharashtra||SCIENCE
ISRO|https://www.isro.gov.in|India|SOUTH_ASIA|NATIONAL|en,hi|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|ISRO|Government of India|Bengaluru||SCIENCE
Dawn|https://www.dawn.com|Pakistan|SOUTH_ASIA|NATIONAL|en,ur|JOURNALISM|NATIONAL|INDEPENDENT|Dawn Media Group|Dawn Media Group|Karachi||
The Daily Star Bangladesh|https://www.thedailystar.net|Bangladesh|SOUTH_ASIA|NATIONAL|en,bn|JOURNALISM|NATIONAL|INDEPENDENT|The Daily Star|Transcom Group|Dhaka||
Prothom Alo|https://www.prothomalo.com|Bangladesh|SOUTH_ASIA|NATIONAL|bn|JOURNALISM|NATIONAL|INDEPENDENT|Prothom Alo|Mediaworld|Dhaka||
Nepal Rastra Bank|https://www.nrb.org.np|Nepal|SOUTH_ASIA|NATIONAL|ne,en|GOVERNMENT|OFFICIAL|GOVERNMENT|Nepal Rastra Bank|Government of Nepal|Kathmandu||ECONOMICS
`

const MIDDLE_EAST = `
Al Jazeera Arabic|https://www.aljazeera.net|Qatar|MIDDLE_EAST|INTERNATIONAL|ar|JOURNALISM|INTERNATIONAL|PUBLIC_BROADCASTER|Al Jazeera|Al Jazeera Media Network|Doha||ar-safety
Al Jazeera English|https://www.aljazeera.com|Qatar|MIDDLE_EAST|INTERNATIONAL|en|JOURNALISM|INTERNATIONAL|PUBLIC_BROADCASTER|Al Jazeera|Al Jazeera Media Network|Doha||
Al Arabiya|https://www.alarabiya.net|Saudi Arabia|MIDDLE_EAST|INTERNATIONAL|ar|JOURNALISM|INTERNATIONAL|CORPORATE_GROUP|Al Arabiya|MBC Group|Riyadh||ar-safety
SPA|https://www.spa.gov.sa|Saudi Arabia|MIDDLE_EAST|NATIONAL|ar|GOVERNMENT|OFFICIAL|GOVERNMENT|Saudi Press Agency|Government of Saudi Arabia|Riyadh||ar-safety
WAM|https://www.wam.ae|United Arab Emirates|MIDDLE_EAST|NATIONAL|ar,en|GOVERNMENT|OFFICIAL|GOVERNMENT|Emirates News Agency|Government of the UAE|Abu Dhabi||ar-safety
NCM UAE|https://www.ncm.gov.ae|United Arab Emirates|MIDDLE_EAST|NATIONAL|ar,en|WEATHER|WEATHER|GOVERNMENT|National Center of Meteorology|Government of the UAE|Abu Dhabi||WEATHER,ar-safety
Al Ahram|https://www.ahram.org.eg|Egypt|MIDDLE_EAST|NATIONAL|ar|JOURNALISM|NATIONAL|GOVERNMENT|Al-Ahram|Al-Ahram|Cairo||ar-safety
Al Masry Al Youm|https://www.almasryalyoum.com|Egypt|MIDDLE_EAST|NATIONAL|ar|JOURNALISM|NATIONAL|INDEPENDENT|Al-Masry Al-Youm|Al-Masry Al-Youm|Cairo||
Egypt Meteorological Authority|https://www.ema.gov.eg|Egypt|MIDDLE_EAST|NATIONAL|ar|WEATHER|WEATHER|GOVERNMENT|Egyptian Meteorological Authority|Government of Egypt|Cairo||WEATHER
PETRA Jordan|https://petra.gov.jo|Jordan|MIDDLE_EAST|NATIONAL|ar|GOVERNMENT|OFFICIAL|GOVERNMENT|Jordan News Agency|Government of Jordan|Amman||ar-safety
KUNA|https://www.kuna.net.kw|Kuwait|MIDDLE_EAST|NATIONAL|ar|GOVERNMENT|OFFICIAL|GOVERNMENT|Kuwait News Agency|Government of Kuwait|Kuwait City||ar-safety
QNA|https://www.qna.org.qa|Qatar|MIDDLE_EAST|NATIONAL|ar|GOVERNMENT|OFFICIAL|GOVERNMENT|Qatar News Agency|Government of Qatar|Doha||ar-safety
Haaretz|https://www.haaretz.co.il|Israel|MIDDLE_EAST|NATIONAL|he|JOURNALISM|NATIONAL|INDEPENDENT|Haaretz|Haaretz|Tel Aviv||
Jerusalem Post|https://www.jpost.com|Israel|MIDDLE_EAST|NATIONAL|en,he|JOURNALISM|NATIONAL|INDEPENDENT|The Jerusalem Post|The Jerusalem Post|Jerusalem||
Israel CBS|https://www.cbs.gov.il|Israel|MIDDLE_EAST|NATIONAL|he,en,ar|GOVERNMENT|OFFICIAL|GOVERNMENT|Central Bureau of Statistics Israel|Government of Israel|Jerusalem||
Tehran Times|https://www.tehrantimes.com|Iran|MIDDLE_EAST|NATIONAL|en,fa|JOURNALISM|NATIONAL|GOVERNMENT|Tehran Times|Tehran Times|Tehran||
IRNA|https://www.irna.ir|Iran|MIDDLE_EAST|NATIONAL|fa|GOVERNMENT|OFFICIAL|GOVERNMENT|IRNA|Government of Iran|Tehran||
Anadolu Agency|https://www.aa.com.tr|Turkey|MIDDLE_EAST|NATIONAL|tr,ar,en|JOURNALISM|NATIONAL|GOVERNMENT|Anadolu Agency|Anadolu Agency|Ankara||
Turkish State Met|https://www.mgm.gov.tr|Turkey|MIDDLE_EAST|NATIONAL|tr|WEATHER|WEATHER|GOVERNMENT|Turkish State Meteorological Service|Government of Turkey|Ankara||WEATHER
`

const EUROPE = `
Tagesschau|https://www.tagesschau.de|Germany|EUROPE|NATIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|ARD|ARD|Hamburg||de-energy
FAZ|https://www.faz.net|Germany|EUROPE|NATIONAL|de|JOURNALISM|NATIONAL|INDEPENDENT|Frankfurter Allgemeine Zeitung|FAZ|Frankfurt||de-energy
Sueddeutsche Zeitung|https://www.sueddeutsche.de|Germany|EUROPE|NATIONAL|de|JOURNALISM|NATIONAL|INDEPENDENT|Sueddeutsche Zeitung|Sueddeutsche Zeitung|Munich||
Der Spiegel|https://www.spiegel.de|Germany|EUROPE|NATIONAL|de|JOURNALISM|NATIONAL|INDEPENDENT|DER SPIEGEL|DER SPIEGEL|Hamburg||
Die Zeit|https://www.zeit.de|Germany|EUROPE|NATIONAL|de|JOURNALISM|NATIONAL|INDEPENDENT|Die Zeit|Zeit-Verlag|Hamburg||
Destatis|https://www.destatis.de|Germany|EUROPE|NATIONAL|de|GOVERNMENT|OFFICIAL|GOVERNMENT|Destatis|Government of Germany|Wiesbaden||de-energy
DWD|https://www.dwd.de|Germany|EUROPE|NATIONAL|de|WEATHER|WEATHER|GOVERNMENT|Deutscher Wetterdienst|Government of Germany|Offenbach||WEATHER
BNetzA|https://www.bundesnetzagentur.de|Germany|EUROPE|NATIONAL|de|REGULATOR|OFFICIAL|GOVERNMENT|Bundesnetzagentur|Government of Germany|Bonn||de-energy,ENERGY
BDEW|https://www.bdew.de|Germany|EUROPE|NATIONAL|de|TRADE_SOURCE|TRADE|NGO|BDEW|BDEW|Berlin||de-energy,ENERGY
ENTSO-E|https://www.entsoe.eu|Belgium|EUROPE|INTERNATIONAL|en,de,fr|TRADE_SOURCE|TRADE|NGO|ENTSO-E|ENTSO-E|Brussels||de-energy,ENERGY
WDR|https://www1.wdr.de|Germany|EUROPE|REGIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|WDR|ARD|Cologne|North Rhine-Westphalia||de-energy
BR24|https://www.br.de|Germany|EUROPE|REGIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Bayerischer Rundfunk|ARD|Munich|Bavaria||
NDR|https://www.ndr.de|Germany|EUROPE|REGIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|NDR|ARD|Hamburg|Hamburg||
Deutsche Welle|https://www.dw.com|Germany|EUROPE|INTERNATIONAL|de,en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Deutsche Welle|Deutsche Welle|Bonn||
Le Monde|https://www.lemonde.fr|France|EUROPE|NATIONAL|fr|JOURNALISM|NATIONAL|INDEPENDENT|Le Monde|Le Monde Group|Paris||
France 24|https://www.france24.com|France|EUROPE|INTERNATIONAL|fr,en,ar|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|France 24|France Medias Monde|Paris||
INSEE|https://www.insee.fr|France|EUROPE|NATIONAL|fr|GOVERNMENT|OFFICIAL|GOVERNMENT|INSEE|Government of France|Paris||
Meteo-France|https://meteofrance.com|France|EUROPE|NATIONAL|fr|WEATHER|WEATHER|GOVERNMENT|Meteo-France|Government of France|Paris||WEATHER
RTE France|https://www.rte-france.com|France|EUROPE|NATIONAL|fr|UTILITIES|UTILITY|GOVERNMENT|RTE|RTE|Paris||ENERGY
El Pais|https://elpais.com|Spain|EUROPE|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|El Pais|PRISA|Madrid||
AEMET|https://www.aemet.es|Spain|EUROPE|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|AEMET|Government of Spain|Madrid||WEATHER
INE Spain|https://www.ine.es|Spain|EUROPE|NATIONAL|es|GOVERNMENT|OFFICIAL|GOVERNMENT|INE|Government of Spain|Madrid||
ANSA|https://www.ansa.it|Italy|EUROPE|NATIONAL|it|JOURNALISM|NATIONAL|INDEPENDENT|ANSA|ANSA|Rome||
ISTAT|https://www.istat.it|Italy|EUROPE|NATIONAL|it|GOVERNMENT|OFFICIAL|GOVERNMENT|ISTAT|Government of Italy|Rome||
Protezione Civile|https://www.protezionecivile.gov.it|Italy|EUROPE|NATIONAL|it|PUBLIC_SAFETY|PUBLIC_SAFETY|GOVERNMENT|Protezione Civile|Government of Italy|Rome||PUBLIC_SAFETY
NOS|https://nos.nl|Netherlands|EUROPE|NATIONAL|nl|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|NOS|NPO|Hilversum||
KNMI|https://www.knmi.nl|Netherlands|EUROPE|NATIONAL|nl|WEATHER|WEATHER|GOVERNMENT|KNMI|Government of the Netherlands|De Bilt||WEATHER
Aftenposten|https://www.aftenposten.no|Norway|EUROPE|NATIONAL|nb|JOURNALISM|NATIONAL|INDEPENDENT|Aftenposten|Schibsted|Oslo||
YR|https://www.yr.no|Norway|EUROPE|NATIONAL|nb|WEATHER|WEATHER|GOVERNMENT|MET Norway / NRK|MET Norway|Oslo||WEATHER
SVT Nyheter|https://www.svt.se|Sweden|EUROPE|NATIONAL|sv|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|SVT|SVT|Stockholm||
SMHI|https://www.smhi.se|Sweden|EUROPE|NATIONAL|sv|WEATHER|WEATHER|GOVERNMENT|SMHI|Government of Sweden|Norrkoping||WEATHER
Yle|https://yle.fi|Finland|EUROPE|NATIONAL|fi,sv|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Yle|Yle|Helsinki||
FMI|https://www.ilmatieteenlaitos.fi|Finland|EUROPE|NATIONAL|fi|WEATHER|WEATHER|GOVERNMENT|Finnish Meteorological Institute|Government of Finland|Helsinki||WEATHER
Der Standard|https://www.derstandard.at|Austria|EUROPE|NATIONAL|de|JOURNALISM|NATIONAL|INDEPENDENT|Der Standard|STANDARD Medien|Vienna||de-energy
ORF|https://orf.at|Austria|EUROPE|NATIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|ORF|ORF|Vienna||
ZAMG|https://www.geosphere.at|Austria|EUROPE|NATIONAL|de|WEATHER|WEATHER|GOVERNMENT|GeoSphere Austria|Government of Austria|Vienna||WEATHER
SRF|https://www.srf.ch|Switzerland|EUROPE|NATIONAL|de|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|SRF|SRG SSR|Zurich||
MeteoSwiss|https://www.meteoswiss.admin.ch|Switzerland|EUROPE|NATIONAL|de,fr,it|WEATHER|WEATHER|GOVERNMENT|MeteoSwiss|Government of Switzerland|Zurich||WEATHER
Gazeta Wyborcza|https://wyborcza.pl|Poland|EUROPE|NATIONAL|pl|JOURNALISM|NATIONAL|INDEPENDENT|Gazeta Wyborcza|Agora|Warsaw||
IMGW|https://www.imgw.pl|Poland|EUROPE|NATIONAL|pl|WEATHER|WEATHER|GOVERNMENT|IMGW|Government of Poland|Warsaw||WEATHER
UK Met Office|https://www.metoffice.gov.uk|United Kingdom|EUROPE|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|Met Office|Government of the United Kingdom|Exeter||WEATHER
ONS|https://www.ons.gov.uk|United Kingdom|EUROPE|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Office for National Statistics|Government of the United Kingdom|Newport||
BBC News|https://www.bbc.com/news|United Kingdom|EUROPE|INTERNATIONAL|en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|BBC|BBC|London||
The Guardian|https://www.theguardian.com|United Kingdom|EUROPE|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Guardian Media Group|Guardian Media Group|London||
legislation.gov.uk|https://www.legislation.gov.uk|United Kingdom|EUROPE|NATIONAL|en|OFFICIAL_RECORD|OFFICIAL|GOVERNMENT|The National Archives|Government of the United Kingdom|London||
Eurostat|https://ec.europa.eu/eurostat|Luxembourg|EUROPE|INTERNATIONAL|en,de,fr|GOVERNMENT|OFFICIAL|GOVERNMENT|Eurostat|European Union|Luxembourg||
ECB|https://www.ecb.europa.eu|Germany|EUROPE|INTERNATIONAL|en,de|GOVERNMENT|OFFICIAL|GOVERNMENT|European Central Bank|European Union|Frankfurt||ECONOMICS
`

const AMERICAS = `
Federal Register|https://www.federalregister.gov|United States|NORTH_AMERICA|NATIONAL|en|OFFICIAL_RECORD|OFFICIAL|GOVERNMENT|National Archives|Government of the United States|Washington||
NWS|https://www.weather.gov|United States|NORTH_AMERICA|NATIONAL|en|ALERT_FEED|WEATHER|GOVERNMENT|National Weather Service|NOAA|Silver Spring|https://api.weather.gov/alerts|WEATHER
USGS Earthquakes|https://earthquake.usgs.gov|United States|NORTH_AMERICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|USGS|Government of the United States|Reston||
Census Bureau|https://www.census.gov|United States|NORTH_AMERICA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|U.S. Census Bureau|Government of the United States|Suitland||
ABC News|https://abcnews.go.com|United States|NORTH_AMERICA|NATIONAL|en|JOURNALISM|NATIONAL|CORPORATE_GROUP|ABC News|Disney|New York||
NPR|https://www.npr.org|United States|NORTH_AMERICA|NATIONAL|en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|NPR|NPR|Washington||
NYC Emergency Management|https://www.nyc.gov/site/em/index.page|United States|NORTH_AMERICA|CITY_LOCAL|en,es|PUBLIC_SAFETY|PUBLIC_SAFETY|GOVERNMENT|NYC Emergency Management|City of New York|New York|New York||PUBLIC_SAFETY
LAFD|https://www.lafd.org|United States|NORTH_AMERICA|CITY_LOCAL|en,es|PUBLIC_SAFETY|PUBLIC_SAFETY|GOVERNMENT|Los Angeles Fire Department|City of Los Angeles|Los Angeles|California||PUBLIC_SAFETY
Statistics Canada|https://www.statcan.gc.ca|Canada|NORTH_AMERICA|NATIONAL|en,fr|GOVERNMENT|OFFICIAL|GOVERNMENT|Statistics Canada|Government of Canada|Ottawa||
Environment Canada|https://weather.gc.ca|Canada|NORTH_AMERICA|NATIONAL|en,fr|WEATHER|WEATHER|GOVERNMENT|ECCC|Government of Canada|Ottawa||WEATHER
CBC News|https://www.cbc.ca/news|Canada|NORTH_AMERICA|NATIONAL|en,fr|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|CBC|CBC|Toronto||
Toronto Star|https://www.thestar.com|Canada|NORTH_AMERICA|CITY_LOCAL|en|JOURNALISM|CITY_LOCAL|INDEPENDENT|Toronto Star|Torstar|Toronto|Ontario||
Radio-Canada|https://ici.radio-canada.ca|Canada|NORTH_AMERICA|NATIONAL|fr|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|Radio-Canada|CBC|Montreal|Quebec||
INEGI|https://www.inegi.org.mx|Mexico|LATIN_AMERICA|NATIONAL|es|GOVERNMENT|OFFICIAL|GOVERNMENT|INEGI|Government of Mexico|Aguascalientes||es-science
CONAGUA|https://www.gob.mx/conagua|Mexico|LATIN_AMERICA|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|CONAGUA|Government of Mexico|Mexico City||WEATHER
Reforma|https://www.reforma.com|Mexico|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|Reforma|Grupo Reforma|Mexico City||
La Jornada|https://www.jornada.com.mx|Mexico|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|La Jornada|La Jornada|Mexico City||
UNAM|https://www.unam.mx|Mexico|LATIN_AMERICA|NATIONAL|es|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|UNAM|UNAM|Mexico City||es-science,SCIENCE
IBGE|https://www.ibge.gov.br|Brazil|LATIN_AMERICA|NATIONAL|pt|GOVERNMENT|OFFICIAL|GOVERNMENT|IBGE|Government of Brazil|Rio de Janeiro||
INMET|https://portal.inmet.gov.br|Brazil|LATIN_AMERICA|NATIONAL|pt|WEATHER|WEATHER|GOVERNMENT|INMET|Government of Brazil|Brasilia||WEATHER
Folha de S.Paulo|https://www.folha.uol.com.br|Brazil|LATIN_AMERICA|NATIONAL|pt|JOURNALISM|NATIONAL|INDEPENDENT|Folha|Grupo Folha|Sao Paulo||
O Globo|https://oglobo.globo.com|Brazil|LATIN_AMERICA|NATIONAL|pt|JOURNALISM|NATIONAL|CORPORATE_GROUP|O Globo|Grupo Globo|Rio de Janeiro||
Agencia Brasil|https://agenciabrasil.ebc.com.br|Brazil|LATIN_AMERICA|NATIONAL|pt|GOVERNMENT|OFFICIAL|GOVERNMENT|EBC|Government of Brazil|Brasilia||
USP|https://www.usp.br|Brazil|LATIN_AMERICA|NATIONAL|pt|ACADEMIC_SOURCE|EDUCATION|UNIVERSITY|Universidade de Sao Paulo|USP|Sao Paulo||SCIENCE
SciELO|https://www.scielo.org|Brazil|LATIN_AMERICA|INTERNATIONAL|es,pt,en|SCIENTIFIC_SOURCE|SCIENTIFIC|NGO|SciELO|FAPESP|||es-science,SCIENCE
ECLAC|https://www.cepal.org|Chile|LATIN_AMERICA|INTERNATIONAL|es,en|GOVERNMENT|OFFICIAL|GOVERNMENT|CEPAL|United Nations|Santiago||es-science,SCIENCE
El Mercurio|https://www.emol.com|Chile|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|El Mercurio|El Mercurio|Santiago||
DMC Chile|https://www.meteochile.gob.cl|Chile|LATIN_AMERICA|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|Direccion Meteorologica de Chile|Government of Chile|Santiago||WEATHER
La Nacion Argentina|https://www.lanacion.com.ar|Argentina|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|La Nacion|La Nacion|Buenos Aires||
Clarín|https://www.clarin.com|Argentina|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|CORPORATE_GROUP|Clarin|Grupo Clarin|Buenos Aires||
SMN Argentina|https://www.smn.gob.ar|Argentina|LATIN_AMERICA|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|Servicio Meteorologico Nacional|Government of Argentina|Buenos Aires||WEATHER
INDEC|https://www.indec.gob.ar|Argentina|LATIN_AMERICA|NATIONAL|es|GOVERNMENT|OFFICIAL|GOVERNMENT|INDEC|Government of Argentina|Buenos Aires||ECONOMICS
CONICET|https://www.conicet.gov.ar|Argentina|LATIN_AMERICA|NATIONAL|es|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|CONICET|Government of Argentina|Buenos Aires||es-science,SCIENCE
El Tiempo|https://www.eltiempo.com|Colombia|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|El Tiempo|El Tiempo Casa Editorial|Bogota||
IDEAM|https://www.ideam.gov.co|Colombia|LATIN_AMERICA|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|IDEAM|Government of Colombia|Bogota||WEATHER
El Comercio Peru|https://elcomercio.pe|Peru|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|CORPORATE_GROUP|El Comercio|Grupo El Comercio|Lima||
SENAMHI|https://www.senamhi.gob.pe|Peru|LATIN_AMERICA|NATIONAL|es|WEATHER|WEATHER|GOVERNMENT|SENAMHI|Government of Peru|Lima||WEATHER
El Universo|https://www.eluniverso.com|Ecuador|LATIN_AMERICA|NATIONAL|es|JOURNALISM|NATIONAL|INDEPENDENT|El Universo|El Universo|Guayaquil||
Reforma Transport CDMX|https://www.metro.cdmx.gob.mx|Mexico|LATIN_AMERICA|CITY_LOCAL|es|TRANSPORT|TRANSPORT|GOVERNMENT|STC Metro|Gobierno de la Ciudad de Mexico|Mexico City||TRANSPORT
`

const OCEANIA = `
Sydney Morning Herald|https://www.smh.com.au|Australia|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|CORPORATE_GROUP|Sydney Morning Herald|Nine Entertainment|Sydney||
The Age|https://www.theage.com.au|Australia|OCEANIA|CITY_LOCAL|en|JOURNALISM|CITY_LOCAL|CORPORATE_GROUP|The Age|Nine Entertainment|Melbourne|Victoria||
ABC News Australia|https://www.abc.net.au/news|Australia|OCEANIA|NATIONAL|en|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|ABC|ABC|Sydney||
The Australian|https://www.theaustralian.com.au|Australia|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|CORPORATE_GROUP|The Australian|News Corp Australia|Sydney||
BOM|https://www.bom.gov.au|Australia|OCEANIA|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|Bureau of Meteorology|Government of Australia|Melbourne||oceania-weather,WEATHER
ABS|https://www.abs.gov.au|Australia|OCEANIA|NATIONAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Australian Bureau of Statistics|Government of Australia|Canberra||
Geoscience Australia|https://www.ga.gov.au|Australia|OCEANIA|NATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|Geoscience Australia|Government of Australia|Canberra||SCIENCE
NSW SES|https://www.ses.nsw.gov.au|Australia|OCEANIA|REGIONAL|en|PUBLIC_SAFETY|PUBLIC_SAFETY|GOVERNMENT|NSW State Emergency Service|Government of New South Wales|Sydney|New South Wales||oceania-weather,PUBLIC_SAFETY
QLD Disaster|https://www.disaster.qld.gov.au|Australia|OCEANIA|REGIONAL|en|PUBLIC_SAFETY|PUBLIC_SAFETY|GOVERNMENT|Queensland Disaster Management|Government of Queensland|Brisbane|Queensland||oceania-weather
Brisbane City Council|https://www.brisbane.qld.gov.au|Australia|OCEANIA|CITY_LOCAL|en|GOVERNMENT|OFFICIAL|GOVERNMENT|Brisbane City Council|Brisbane City Council|Brisbane|Queensland||LOCAL_GOVERNANCE
Auckland Council|https://www.aucklandcouncil.govt.nz|New Zealand|OCEANIA|CITY_LOCAL|en,mi|GOVERNMENT|OFFICIAL|GOVERNMENT|Auckland Council|Auckland Council|Auckland||LOCAL_GOVERNANCE
RNZ|https://www.rnz.co.nz|New Zealand|OCEANIA|NATIONAL|en,mi|JOURNALISM|PUBLIC_BROADCASTER|PUBLIC_BROADCASTER|RNZ|RNZ|Wellington||
Stuff|https://www.stuff.co.nz|New Zealand|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Stuff|Stuff Ltd|Wellington||
NZ Herald|https://www.nzherald.co.nz|New Zealand|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|CORPORATE_GROUP|NZ Herald|NZME|Auckland||
MetService|https://www.metservice.com|New Zealand|OCEANIA|NATIONAL|en|WEATHER|WEATHER|GOVERNMENT|MetService|Government of New Zealand|Wellington||oceania-weather,WEATHER
Stats NZ|https://www.stats.govt.nz|New Zealand|OCEANIA|NATIONAL|en,mi|GOVERNMENT|OFFICIAL|GOVERNMENT|Stats NZ|Government of New Zealand|Wellington||
Fiji Met|https://www.met.gov.fj|Fiji|OCEANIA|NATIONAL|en,fj|WEATHER|WEATHER|GOVERNMENT|Fiji Meteorological Service|Government of Fiji|Nadi||oceania-weather,WEATHER
Fiji Times|https://www.fijitimes.com.fj|Fiji|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|The Fiji Times|The Fiji Times|Suva||
PNG Post-Courier|https://www.postcourier.com.pg|Papua New Guinea|OCEANIA|NATIONAL|en|JOURNALISM|NATIONAL|INDEPENDENT|Post-Courier|Post-Courier|Port Moresby||
NIWA|https://niwa.co.nz|New Zealand|OCEANIA|NATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|NIWA|Government of New Zealand|Auckland||SCIENCE,WEATHER
`

const SCIENCE_GLOBAL = `
arXiv|https://arxiv.org|United States|NORTH_AMERICA|INTERNATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|UNIVERSITY|Cornell University|Cornell University|||SCIENCE
PubMed|https://pubmed.ncbi.nlm.nih.gov|United States|NORTH_AMERICA|INTERNATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|NCBI|National Library of Medicine|||HEALTH,SCIENCE
Crossref|https://www.crossref.org|United States|NORTH_AMERICA|INTERNATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|NGO|Crossref|Crossref|||SCIENCE
NASA|https://www.nasa.gov|United States|NORTH_AMERICA|INTERNATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|NASA|Government of the United States|Washington||SCIENCE
ESA|https://www.esa.int|France|EUROPE|INTERNATIONAL|en,fr,de|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|ESA|ESA|Paris||SCIENCE
WHO|https://www.who.int|Switzerland|EUROPE|INTERNATIONAL|en,fr,ar,zh,es,ru|NGO|HEALTH|GOVERNMENT|World Health Organization|United Nations|Geneva||HEALTH
WMO|https://wmo.int|Switzerland|EUROPE|INTERNATIONAL|en,fr,ar,ru,zh,es|NGO|WEATHER|GOVERNMENT|World Meteorological Organization|United Nations|Geneva||WEATHER
IPCC|https://www.ipcc.ch|Switzerland|EUROPE|INTERNATIONAL|en|SCIENTIFIC_SOURCE|SCIENTIFIC|GOVERNMENT|IPCC|United Nations|Geneva||SCIENCE,ENVIRONMENT
`

export function wave1Catalog(): Wave1Candidate[] {
  const rows = [
    ...parse(AFRICA, 'Africa', 'official_broadcast_university_directory'),
    ...parse(EAST_ASIA, 'Asia', 'official_broadcast_university_directory'),
    ...parse(SOUTHEAST_ASIA, 'Asia', 'official_broadcast_university_directory'),
    ...parse(SOUTH_ASIA, 'Asia', 'official_broadcast_university_directory'),
    ...parse(MIDDLE_EAST, 'Middle East', 'official_broadcast_university_directory'),
    ...parse(EUROPE, 'Europe', 'official_broadcast_university_directory'),
    ...parse(AMERICAS, 'Americas', 'official_broadcast_university_directory'),
    ...parse(OCEANIA, 'Oceania', 'official_broadcast_university_directory'),
    ...parse(SCIENCE_GLOBAL, 'Global', 'scientific_directory'),
  ]
  const seen = new Set<string>()
  return rows.filter(row => {
    const host = row.homepage.toLowerCase()
    if (seen.has(host)) return false
    seen.add(host)
    return true
  })
}

export function catalogIsBelowCap(rows: Wave1Candidate[]): boolean {
  return rows.length <= 1000
}

export function catalogEnglishShare(rows: Wave1Candidate[]): number {
  if (!rows.length) return 0
  return rows.filter(row => row.primaryLanguage === 'en').length / rows.length
}

export function catalogUsUkShare(rows: Wave1Candidate[]): number {
  if (!rows.length) return 0
  return rows.filter(row => row.country === 'United States' || row.country === 'United Kingdom').length / rows.length
}
