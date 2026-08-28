const DEFAULT_BASE = 'https://api.cotality.com/trestle';

export function mlsConfigured(env) {
  return !!(String(env.MLS_CLIENT_ID || '').trim() && String(env.MLS_CLIENT_SECRET || '').trim());
}

export async function searchMls(env, profile, {top=25}={}) {
  if (!mlsConfigured(env)) {
    return {configured:false, provider:'Trestle', feedMode:String(env.MLS_FEED_MODE || 'VOW'), query:null, count:null, listings:[]};
  }

  const token = await accessToken(env);
  const base = String(env.MLS_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const query = buildObjectiveFilter(profile);
  const params = new URLSearchParams();
  if (query) params.set('$filter', query);
  params.set('$count', 'true');
  params.set('$top', String(Math.max(1, Math.min(100, Number(top) || 25))));
  params.set('$orderby', 'ModificationTimestamp desc');
  params.set('$select', [
    'ListingKey','ListingId','StandardStatus','ListPrice','BedroomsTotal','BathroomsTotalInteger',
    'LivingArea','LotSizeAcres','GarageSpaces','PropertyType','PropertySubType','City','CountyOrParish',
    'StateOrProvince','PostalCode','UnparsedAddress','ModificationTimestamp','ListOfficeName'
  ].join(','));

  const url = `${base}/odata/Property?${params.toString()}`;
  const response = await fetch(url, {headers:{accept:'application/json',authorization:`Bearer ${token}`}});
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MLS query failed (${response.status}): ${text.slice(0,500)}`);
  }
  const body = await response.json();
  return {
    configured:true,
    provider:'Trestle',
    feedMode:String(env.MLS_FEED_MODE || 'VOW'),
    query,
    count:Number.isFinite(body['@odata.count']) ? body['@odata.count'] : null,
    listings:Array.isArray(body.value) ? body.value : []
  };
}

export function buildObjectiveFilter(profile={}) {
  const filters = [`StandardStatus in ('Active','Active Under Contract','Pending')`];
  const minPrice = number(profile.price_min);
  const maxPrice = number(profile.price_max);
  const beds = number(profile.beds_min);
  const baths = number(profile.baths_min);
  const sqft = number(profile.sqft_min);
  const lot = number(profile.lot_min_acres);
  const garage = number(profile.garage_min);
  const year = number(profile.year_built_min);

  if (minPrice !== null) filters.push(`ListPrice ge ${Math.round(minPrice)}`);
  if (maxPrice !== null) filters.push(`ListPrice le ${Math.round(maxPrice)}`);
  if (beds !== null) filters.push(`BedroomsTotal ge ${Math.round(beds)}`);
  if (baths !== null) filters.push(`BathroomsTotalInteger ge ${Math.round(baths)}`);
  if (sqft !== null) filters.push(`LivingArea ge ${Math.round(sqft)}`);
  if (lot !== null) filters.push(`LotSizeAcres ge ${lot}`);
  if (garage !== null) filters.push(`GarageSpaces ge ${garage}`);
  if (year !== null) filters.push(`YearBuilt ge ${Math.round(year)}`);

  const cities = list(profile.cities);
  if (cities.length) filters.push(`(${cities.map(v=>`City eq '${odata(v)}'`).join(' or ')})`);
  const counties = list(profile.counties);
  if (counties.length) filters.push(`(${counties.map(v=>`CountyOrParish eq '${odata(v)}'`).join(' or ')})`);
  const zips = list(profile.postal_codes);
  if (zips.length) filters.push(`(${zips.map(v=>`PostalCode eq '${odata(v)}'`).join(' or ')})`);

  const types = jsonList(profile.property_types_json);
  if (types.length) filters.push(`(${types.map(v=>`PropertyType eq '${odata(v)}'`).join(' or ')})`);

  return filters.join(' and ');
}

async function accessToken(env) {
  const base = String(env.MLS_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const body = new URLSearchParams({
    client_id:String(env.MLS_CLIENT_ID || ''),
    client_secret:String(env.MLS_CLIENT_SECRET || ''),
    grant_type:'client_credentials',
    scope:'api'
  });
  const response = await fetch(`${base}/oidc/connect/token`, {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
    body
  });
  if (!response.ok) throw new Error(`MLS authentication failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('MLS authentication returned no access token');
  return data.access_token;
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function list(value) {
  return String(value || '').split(/[,\n]/).map(v=>v.trim()).filter(Boolean).slice(0,25);
}
function jsonList(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    return Array.isArray(parsed) ? parsed.map(v=>String(v).trim()).filter(Boolean).slice(0,20) : [];
  } catch { return []; }
}
function odata(value) { return String(value).replace(/'/g,"''"); }
