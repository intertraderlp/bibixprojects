import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAuthStore } from '../store/authStore';
import { format, parseISO } from 'date-fns';
import Avatar from '../components/ui/Avatar';
import { useEffect, useRef, useState } from 'react';
import { Settings, X, Check, Plus, Trash2, Link2, ChevronDown, ExternalLink } from 'lucide-react';

// ── World Clock ───────────────────────────────────────────────────────────────

const CITIES = [
  // Americas
  { label: 'New York',         country: 'USA',           tz: 'America/New_York' },
  { label: 'Los Angeles',      country: 'USA',           tz: 'America/Los_Angeles' },
  { label: 'Chicago',          country: 'USA',           tz: 'America/Chicago' },
  { label: 'Miami',            country: 'USA',           tz: 'America/New_York' },
  { label: 'Dallas',           country: 'USA',           tz: 'America/Chicago' },
  { label: 'Denver',           country: 'USA',           tz: 'America/Denver' },
  { label: 'Phoenix',          country: 'USA',           tz: 'America/Phoenix' },
  { label: 'Seattle',          country: 'USA',           tz: 'America/Los_Angeles' },
  { label: 'Boston',           country: 'USA',           tz: 'America/New_York' },
  { label: 'Atlanta',          country: 'USA',           tz: 'America/New_York' },
  { label: 'San Francisco',    country: 'USA',           tz: 'America/Los_Angeles' },
  { label: 'Las Vegas',        country: 'USA',           tz: 'America/Los_Angeles' },
  { label: 'Houston',          country: 'USA',           tz: 'America/Chicago' },
  { label: 'Washington DC',    country: 'USA',           tz: 'America/New_York' },
  { label: 'Toronto',          country: 'Canada',        tz: 'America/Toronto' },
  { label: 'Vancouver',        country: 'Canada',        tz: 'America/Vancouver' },
  { label: 'Montreal',         country: 'Canada',        tz: 'America/Montreal' },
  { label: 'Calgary',          country: 'Canada',        tz: 'America/Edmonton' },
  { label: 'Mexico City',      country: 'Mexico',        tz: 'America/Mexico_City' },
  { label: 'Guadalajara',      country: 'Mexico',        tz: 'America/Mexico_City' },
  { label: 'São Paulo',        country: 'Brazil',        tz: 'America/Sao_Paulo' },
  { label: 'Rio de Janeiro',   country: 'Brazil',        tz: 'America/Sao_Paulo' },
  { label: 'Brasília',         country: 'Brazil',        tz: 'America/Sao_Paulo' },
  { label: 'Buenos Aires',     country: 'Argentina',     tz: 'America/Argentina/Buenos_Aires' },
  { label: 'Córdoba',          country: 'Argentina',     tz: 'America/Argentina/Cordoba' },
  { label: 'Santiago',         country: 'Chile',         tz: 'America/Santiago' },
  { label: 'Bogotá',           country: 'Colombia',      tz: 'America/Bogota' },
  { label: 'Medellín',         country: 'Colombia',      tz: 'America/Bogota' },
  { label: 'Lima',             country: 'Peru',          tz: 'America/Lima' },
  { label: 'Caracas',          country: 'Venezuela',     tz: 'America/Caracas' },
  { label: 'Quito',            country: 'Ecuador',       tz: 'America/Guayaquil' },
  { label: 'La Paz',           country: 'Bolivia',       tz: 'America/La_Paz' },
  { label: 'Asunción',         country: 'Paraguay',      tz: 'America/Asuncion' },
  { label: 'Montevideo',       country: 'Uruguay',       tz: 'America/Montevideo' },
  { label: 'Havana',           country: 'Cuba',          tz: 'America/Havana' },
  { label: 'Panama City',      country: 'Panama',        tz: 'America/Panama' },
  { label: 'San José',         country: 'Costa Rica',    tz: 'America/Costa_Rica' },
  { label: 'Guatemala City',   country: 'Guatemala',     tz: 'America/Guatemala' },
  { label: 'Santo Domingo',    country: 'Dominican Rep.',tz: 'America/Santo_Domingo' },
  { label: 'San Juan',         country: 'Puerto Rico',   tz: 'America/Puerto_Rico' },
  // Europe
  { label: 'London',           country: 'UK',            tz: 'Europe/London' },
  { label: 'Edinburgh',        country: 'UK',            tz: 'Europe/London' },
  { label: 'Manchester',       country: 'UK',            tz: 'Europe/London' },
  { label: 'Paris',            country: 'France',        tz: 'Europe/Paris' },
  { label: 'Lyon',             country: 'France',        tz: 'Europe/Paris' },
  { label: 'Berlin',           country: 'Germany',       tz: 'Europe/Berlin' },
  { label: 'Munich',           country: 'Germany',       tz: 'Europe/Berlin' },
  { label: 'Frankfurt',        country: 'Germany',       tz: 'Europe/Berlin' },
  { label: 'Hamburg',          country: 'Germany',       tz: 'Europe/Berlin' },
  { label: 'Madrid',           country: 'Spain',         tz: 'Europe/Madrid' },
  { label: 'Barcelona',        country: 'Spain',         tz: 'Europe/Madrid' },
  { label: 'Rome',             country: 'Italy',         tz: 'Europe/Rome' },
  { label: 'Milan',            country: 'Italy',         tz: 'Europe/Rome' },
  { label: 'Amsterdam',        country: 'Netherlands',   tz: 'Europe/Amsterdam' },
  { label: 'Brussels',         country: 'Belgium',       tz: 'Europe/Brussels' },
  { label: 'Zurich',           country: 'Switzerland',   tz: 'Europe/Zurich' },
  { label: 'Geneva',           country: 'Switzerland',   tz: 'Europe/Zurich' },
  { label: 'Vienna',           country: 'Austria',       tz: 'Europe/Vienna' },
  { label: 'Stockholm',        country: 'Sweden',        tz: 'Europe/Stockholm' },
  { label: 'Oslo',             country: 'Norway',        tz: 'Europe/Oslo' },
  { label: 'Copenhagen',       country: 'Denmark',       tz: 'Europe/Copenhagen' },
  { label: 'Helsinki',         country: 'Finland',       tz: 'Europe/Helsinki' },
  { label: 'Warsaw',           country: 'Poland',        tz: 'Europe/Warsaw' },
  { label: 'Prague',           country: 'Czech Republic',tz: 'Europe/Prague' },
  { label: 'Budapest',         country: 'Hungary',       tz: 'Europe/Budapest' },
  { label: 'Bucharest',        country: 'Romania',       tz: 'Europe/Bucharest' },
  { label: 'Athens',           country: 'Greece',        tz: 'Europe/Athens' },
  { label: 'Istanbul',         country: 'Turkey',        tz: 'Europe/Istanbul' },
  { label: 'Ankara',           country: 'Turkey',        tz: 'Europe/Istanbul' },
  { label: 'Moscow',           country: 'Russia',        tz: 'Europe/Moscow' },
  { label: 'St. Petersburg',   country: 'Russia',        tz: 'Europe/Moscow' },
  { label: 'Kyiv',             country: 'Ukraine',       tz: 'Europe/Kiev' },
  { label: 'Lisbon',           country: 'Portugal',      tz: 'Europe/Lisbon' },
  { label: 'Dublin',           country: 'Ireland',       tz: 'Europe/Dublin' },
  { label: 'Minsk',            country: 'Belarus',       tz: 'Europe/Minsk' },
  { label: 'Belgrade',         country: 'Serbia',        tz: 'Europe/Belgrade' },
  { label: 'Sofia',            country: 'Bulgaria',      tz: 'Europe/Sofia' },
  { label: 'Riga',             country: 'Latvia',        tz: 'Europe/Riga' },
  { label: 'Tallinn',          country: 'Estonia',       tz: 'Europe/Tallinn' },
  { label: 'Vilnius',          country: 'Lithuania',     tz: 'Europe/Vilnius' },
  { label: 'Zagreb',           country: 'Croatia',       tz: 'Europe/Zagreb' },
  { label: 'Ljubljana',        country: 'Slovenia',      tz: 'Europe/Ljubljana' },
  { label: 'Bratislava',       country: 'Slovakia',      tz: 'Europe/Bratislava' },
  { label: 'Skopje',           country: 'N. Macedonia',  tz: 'Europe/Skopje' },
  { label: 'Tirana',           country: 'Albania',       tz: 'Europe/Tirane' },
  { label: 'Reykjavik',        country: 'Iceland',       tz: 'Atlantic/Reykjavik' },
  { label: 'Luxembourg',       country: 'Luxembourg',    tz: 'Europe/Luxembourg' },
  { label: 'Nicosia',          country: 'Cyprus',        tz: 'Asia/Nicosia' },
  // Africa
  { label: 'Cairo',            country: 'Egypt',         tz: 'Africa/Cairo' },
  { label: 'Lagos',            country: 'Nigeria',       tz: 'Africa/Lagos' },
  { label: 'Abuja',            country: 'Nigeria',       tz: 'Africa/Lagos' },
  { label: 'Johannesburg',     country: 'South Africa',  tz: 'Africa/Johannesburg' },
  { label: 'Cape Town',        country: 'South Africa',  tz: 'Africa/Johannesburg' },
  { label: 'Durban',           country: 'South Africa',  tz: 'Africa/Johannesburg' },
  { label: 'Nairobi',          country: 'Kenya',         tz: 'Africa/Nairobi' },
  { label: 'Casablanca',       country: 'Morocco',       tz: 'Africa/Casablanca' },
  { label: 'Rabat',            country: 'Morocco',       tz: 'Africa/Casablanca' },
  { label: 'Accra',            country: 'Ghana',         tz: 'Africa/Accra' },
  { label: 'Addis Ababa',      country: 'Ethiopia',      tz: 'Africa/Addis_Ababa' },
  { label: 'Dar es Salaam',    country: 'Tanzania',      tz: 'Africa/Dar_es_Salaam' },
  { label: 'Khartoum',         country: 'Sudan',         tz: 'Africa/Khartoum' },
  { label: 'Algiers',          country: 'Algeria',       tz: 'Africa/Algiers' },
  { label: 'Tunis',            country: 'Tunisia',       tz: 'Africa/Tunis' },
  { label: 'Abidjan',          country: "Côte d'Ivoire", tz: 'Africa/Abidjan' },
  { label: 'Dakar',            country: 'Senegal',       tz: 'Africa/Dakar' },
  { label: 'Luanda',           country: 'Angola',        tz: 'Africa/Luanda' },
  { label: 'Kampala',          country: 'Uganda',        tz: 'Africa/Kampala' },
  { label: 'Harare',           country: 'Zimbabwe',      tz: 'Africa/Harare' },
  { label: 'Maputo',           country: 'Mozambique',    tz: 'Africa/Maputo' },
  { label: 'Lusaka',           country: 'Zambia',        tz: 'Africa/Lusaka' },
  { label: 'Kinshasa',         country: 'DR Congo',      tz: 'Africa/Kinshasa' },
  { label: 'Tripoli',          country: 'Libya',         tz: 'Africa/Tripoli' },
  // Middle East
  { label: 'Dubai',            country: 'UAE',           tz: 'Asia/Dubai' },
  { label: 'Abu Dhabi',        country: 'UAE',           tz: 'Asia/Dubai' },
  { label: 'Tel Aviv',         country: 'Israel',        tz: 'Asia/Jerusalem' },
  { label: 'Jerusalem',        country: 'Israel',        tz: 'Asia/Jerusalem' },
  { label: 'Riyadh',           country: 'Saudi Arabia',  tz: 'Asia/Riyadh' },
  { label: 'Jeddah',           country: 'Saudi Arabia',  tz: 'Asia/Riyadh' },
  { label: 'Doha',             country: 'Qatar',         tz: 'Asia/Qatar' },
  { label: 'Kuwait City',      country: 'Kuwait',        tz: 'Asia/Kuwait' },
  { label: 'Muscat',           country: 'Oman',          tz: 'Asia/Muscat' },
  { label: 'Manama',           country: 'Bahrain',       tz: 'Asia/Bahrain' },
  { label: 'Beirut',           country: 'Lebanon',       tz: 'Asia/Beirut' },
  { label: 'Amman',            country: 'Jordan',        tz: 'Asia/Amman' },
  { label: 'Damascus',         country: 'Syria',         tz: 'Asia/Damascus' },
  { label: 'Baghdad',          country: 'Iraq',          tz: 'Asia/Baghdad' },
  { label: 'Tehran',           country: 'Iran',          tz: 'Asia/Tehran' },
  { label: "Sana'a",           country: 'Yemen',         tz: 'Asia/Aden' },
  // Central & South Asia
  { label: 'Mumbai',           country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Delhi',            country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Bangalore',        country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Kolkata',          country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Chennai',          country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Hyderabad',        country: 'India',         tz: 'Asia/Kolkata' },
  { label: 'Karachi',          country: 'Pakistan',      tz: 'Asia/Karachi' },
  { label: 'Lahore',           country: 'Pakistan',      tz: 'Asia/Karachi' },
  { label: 'Islamabad',        country: 'Pakistan',      tz: 'Asia/Karachi' },
  { label: 'Dhaka',            country: 'Bangladesh',    tz: 'Asia/Dhaka' },
  { label: 'Colombo',          country: 'Sri Lanka',     tz: 'Asia/Colombo' },
  { label: 'Kathmandu',        country: 'Nepal',         tz: 'Asia/Kathmandu' },
  { label: 'Kabul',            country: 'Afghanistan',   tz: 'Asia/Kabul' },
  { label: 'Tashkent',         country: 'Uzbekistan',    tz: 'Asia/Tashkent' },
  { label: 'Almaty',           country: 'Kazakhstan',    tz: 'Asia/Almaty' },
  { label: 'Baku',             country: 'Azerbaijan',    tz: 'Asia/Baku' },
  { label: 'Tbilisi',          country: 'Georgia',       tz: 'Asia/Tbilisi' },
  { label: 'Yerevan',          country: 'Armenia',       tz: 'Asia/Yerevan' },
  // Southeast & East Asia
  { label: 'Singapore',        country: 'Singapore',     tz: 'Asia/Singapore' },
  { label: 'Kuala Lumpur',     country: 'Malaysia',      tz: 'Asia/Kuala_Lumpur' },
  { label: 'Bangkok',          country: 'Thailand',      tz: 'Asia/Bangkok' },
  { label: 'Chiang Mai',       country: 'Thailand',      tz: 'Asia/Bangkok' },
  { label: 'Jakarta',          country: 'Indonesia',     tz: 'Asia/Jakarta' },
  { label: 'Bali',             country: 'Indonesia',     tz: 'Asia/Makassar' },
  { label: 'Manila',           country: 'Philippines',   tz: 'Asia/Manila' },
  { label: 'Ho Chi Minh City', country: 'Vietnam',       tz: 'Asia/Ho_Chi_Minh' },
  { label: 'Hanoi',            country: 'Vietnam',       tz: 'Asia/Ho_Chi_Minh' },
  { label: 'Phnom Penh',       country: 'Cambodia',      tz: 'Asia/Phnom_Penh' },
  { label: 'Yangon',           country: 'Myanmar',       tz: 'Asia/Rangoon' },
  { label: 'Vientiane',        country: 'Laos',          tz: 'Asia/Vientiane' },
  { label: 'Tokyo',            country: 'Japan',         tz: 'Asia/Tokyo' },
  { label: 'Osaka',            country: 'Japan',         tz: 'Asia/Tokyo' },
  { label: 'Seoul',            country: 'South Korea',   tz: 'Asia/Seoul' },
  { label: 'Busan',            country: 'South Korea',   tz: 'Asia/Seoul' },
  { label: 'Beijing',          country: 'China',         tz: 'Asia/Shanghai' },
  { label: 'Shanghai',         country: 'China',         tz: 'Asia/Shanghai' },
  { label: 'Hong Kong',        country: 'Hong Kong',     tz: 'Asia/Hong_Kong' },
  { label: 'Taipei',           country: 'Taiwan',        tz: 'Asia/Taipei' },
  { label: 'Chengdu',          country: 'China',         tz: 'Asia/Shanghai' },
  { label: 'Shenzhen',         country: 'China',         tz: 'Asia/Shanghai' },
  { label: 'Guangzhou',        country: 'China',         tz: 'Asia/Shanghai' },
  { label: 'Ulaanbaatar',      country: 'Mongolia',      tz: 'Asia/Ulaanbaatar' },
  { label: 'Pyongyang',        country: 'North Korea',   tz: 'Asia/Pyongyang' },
  { label: 'Brunei',           country: 'Brunei',        tz: 'Asia/Brunei' },
  { label: 'Dili',             country: 'Timor-Leste',   tz: 'Asia/Dili' },
  // Oceania
  { label: 'Sydney',           country: 'Australia',     tz: 'Australia/Sydney' },
  { label: 'Melbourne',        country: 'Australia',     tz: 'Australia/Melbourne' },
  { label: 'Brisbane',         country: 'Australia',     tz: 'Australia/Brisbane' },
  { label: 'Perth',            country: 'Australia',     tz: 'Australia/Perth' },
  { label: 'Adelaide',         country: 'Australia',     tz: 'Australia/Adelaide' },
  { label: 'Auckland',         country: 'New Zealand',   tz: 'Pacific/Auckland' },
  { label: 'Wellington',       country: 'New Zealand',   tz: 'Pacific/Auckland' },
  { label: 'Honolulu',         country: 'USA (Hawaii)',  tz: 'Pacific/Honolulu' },
  { label: 'Suva',             country: 'Fiji',          tz: 'Pacific/Fiji' },
  { label: 'Port Moresby',     country: 'Papua New Guinea', tz: 'Pacific/Port_Moresby' },
];

const DEFAULT_CITIES = ['New York', 'London', 'Paris', 'Dubai', 'Singapore', 'Tokyo'];

function useClockTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function ClockFace({ tz, label }: { tz: string; label: string }) {
  useClockTick();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  const secDeg   = ss * 6;
  const minDeg   = mm * 6 + ss * 0.1;
  const hourDeg  = (hh % 12) * 30 + mm * 0.5;

  const hand = (deg: number, len: number, width: number, color: string) => {
    const rad = (deg - 90) * (Math.PI / 180);
    const x = 50 + len * Math.cos(rad);
    const y = 50 + len * Math.sin(rad);
    return <line x1="50" y1="50" x2={x} y2={y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  };

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const rad = (i * 30 - 90) * (Math.PI / 180);
    const x1 = 50 + 42 * Math.cos(rad);
    const y1 = 50 + 42 * Math.sin(rad);
    const x2 = 50 + 46 * Math.cos(rad);
    const y2 = 50 + 46 * Math.sin(rad);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d1d5db" strokeWidth="2" />;
  });

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 100" className="w-20 h-20">
        <circle cx="50" cy="50" r="48" fill="white" stroke="#e5e7eb" strokeWidth="2" />
        {ticks}
        {hand(hourDeg, 28, 3, '#1f2937')}
        {hand(minDeg,  36, 2, '#1f2937')}
        {hand(secDeg,  40, 1, '#ef4444')}
        <circle cx="50" cy="50" r="2.5" fill="#1f2937" />
      </svg>
      <div className="text-xs font-semibold text-gray-700 mt-1 tabular-nums">{timeStr.slice(0,5)}</div>
      <div className="text-[10px] text-gray-400">{dateStr}</div>
      <div className="text-[10px] font-medium text-gray-500 mt-0.5 truncate max-w-[80px] text-center">{label}</div>
    </div>
  );
}

function WorldClocks({ userId }: { userId: string }) {
  const storageKey = `world_clocks_${userId}`;
  const loadSaved = (): string[] => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_CITIES;
      const parsed: string[] = JSON.parse(raw);
      // Validate: must be city labels that exist in CITIES, not old timezone strings
      const valid = parsed.filter(l => CITIES.some(c => c.label === l));
      return valid.length > 0 ? valid : DEFAULT_CITIES;
    } catch { return DEFAULT_CITIES; }
  };
  const [selected, setSelected] = useState<string[]>(loadSaved);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [search, setSearch] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const save = () => {
    setSelected(draft);
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setEditing(false);
  };

  const toggle = (label: string) => {
    setDraft(d => d.includes(label) ? d.filter(l => l !== label) : d.length < 6 ? [...d, label] : d);
  };

  const filtered = CITIES.filter(c => {
    const q = search.toLowerCase();
    return c.label.toLowerCase().includes(q) || c.country.toLowerCase().includes(q);
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">World Clocks</span>
        <button onClick={() => { setDraft(selected); setSearch(''); setEditing(true); }}
          className="text-gray-400 hover:text-gray-600 p-1 rounded">
          <Settings size={14} />
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {selected.map(label => {
          const city = CITIES.find(c => c.label === label);
          return city ? <ClockFace key={label} tz={city.tz} label={city.label} /> : null;
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div ref={modalRef} className="bg-white rounded-2xl shadow-xl w-96 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Select Cities</h3>
                <p className="text-xs text-gray-400 mt-0.5">{draft.length}/6 selected{draft.length >= 6 ? ' — deselect one to swap' : ''}</p>
              </div>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 pt-3">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by city or country..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
              {filtered.map(city => {
                const on = draft.includes(city.label);
                const disabled = !on && draft.length >= 6;
                return (
                  <button key={city.label} onClick={() => !disabled && toggle(city.label)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${on ? 'bg-blue-50 text-monday-blue' : disabled ? 'opacity-40 cursor-not-allowed text-gray-500' : 'hover:bg-gray-50 text-gray-700'}`}>
                    <div className="text-left">
                      <div>{city.label}</div>
                      <div className="text-xs opacity-60">{city.country}</div>
                    </div>
                    {on && <Check size={14} className="text-monday-blue" />}
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick Links ───────────────────────────────────────────────────────────────

interface QuickLink { id: string; title: string; url: string; }

const MAX_LINKS = 10;

// Prepend https:// when the user omits a scheme, so the href actually navigates.
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function hostOf(url: string): string {
  try { return new URL(normalizeUrl(url)).hostname; } catch { return ''; }
}

function LinkFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (failed || !host) {
    return <span className="w-7 h-7 rounded-md bg-blue-50 text-monday-blue flex items-center justify-center flex-shrink-0"><Link2 size={15} /></span>;
  }
  return (
    <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} alt=""
      onError={() => setFailed(true)}
      className="w-7 h-7 rounded-md flex-shrink-0 bg-white object-contain" />
  );
}

function QuickLinks({ userId }: { userId: string }) {
  const storageKey = `quick_links_${userId}`;
  const load = (): QuickLink[] => {
    try { const r = localStorage.getItem(storageKey); const p = r ? JSON.parse(r) : []; return Array.isArray(p) ? p : []; }
    catch { return []; }
  };
  const [links, setLinks] = useState<QuickLink[]>(load);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QuickLink[]>([]);

  const persist = (next: QuickLink[]) => {
    setLinks(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore quota */ }
  };

  const openEditor = () => {
    setDraft(links.length ? links.map(l => ({ ...l })) : [{ id: crypto.randomUUID(), title: '', url: '' }]);
    setEditing(true);
  };

  const save = () => {
    const cleaned = draft
      .map(l => ({ ...l, title: l.title.trim(), url: l.url.trim() }))
      .filter(l => l.url) // a url is required; title falls back to the host
      .map(l => ({ ...l, title: l.title || hostOf(l.url) || l.url }))
      .slice(0, MAX_LINKS);
    persist(cleaned);
    setEditing(false);
  };

  const updateDraft = (id: string, field: 'title' | 'url', value: string) =>
    setDraft(d => d.map(l => l.id === id ? { ...l, [field]: value } : l));
  const removeDraft = (id: string) => setDraft(d => d.filter(l => l.id !== id));
  const addDraft = () => setDraft(d => d.length < MAX_LINKS ? [...d, { id: crypto.randomUUID(), title: '', url: '' }] : d);

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Quick Links</span>
        <button onClick={openEditor} className="text-gray-400 hover:text-gray-600 p-1 rounded" title="Edit quick links">
          <Settings size={14} />
        </button>
      </div>

      {links.length === 0 ? (
        <button onClick={openEditor}
          className="w-full flex items-center justify-center gap-2 py-6 text-sm text-gray-400 hover:text-monday-blue border-2 border-dashed border-gray-200 hover:border-monday-blue rounded-lg transition-colors">
          <Plus size={16} /> Add quick links for fast access
        </button>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {links.map(l => (
            <a key={l.id} href={normalizeUrl(l.url)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 hover:border-monday-blue hover:bg-blue-50 transition-colors group min-w-0">
              <LinkFavicon url={l.url} />
              <span className="text-sm font-medium text-gray-700 group-hover:text-monday-blue truncate flex-1 min-w-0">{l.title}</span>
              <ExternalLink size={12} className="text-gray-300 group-hover:text-monday-blue flex-shrink-0" />
            </a>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">Quick Links</h3>
                <p className="text-xs text-gray-400 mt-0.5">{draft.length}/{MAX_LINKS} links — only you see these</p>
              </div>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {draft.map((l, i) => (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-300 w-4 text-right flex-shrink-0">{i + 1}</span>
                  <input value={l.title} onChange={e => updateDraft(l.id, 'title', e.target.value)} placeholder="Label (optional)"
                    className="w-1/3 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                  <input value={l.url} onChange={e => updateDraft(l.id, 'url', e.target.value)} placeholder="example.com"
                    className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                  <button onClick={() => removeDraft(l.id)} className="text-gray-300 hover:text-red-500 p-1 flex-shrink-0" title="Remove">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {draft.length < MAX_LINKS && (
                <button onClick={addDraft} className="flex items-center gap-1.5 text-sm text-monday-blue hover:text-blue-600 mt-1 px-1">
                  <Plus size={15} /> Add link
                </button>
              )}
            </div>
            <div className="px-5 py-4 border-t flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const { workspaces, boards } = useWorkspaceStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const allBoards = Object.values(boards).flat();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const boardsCollapseKey = `recent_boards_collapsed_${user?.id ?? 'anon'}`;
  const [boardsCollapsed, setBoardsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(boardsCollapseKey) === '1'; } catch { return false; }
  });
  const toggleBoards = () => {
    setBoardsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(boardsCollapseKey, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center gap-4 mb-8">
          {user && <Avatar name={user.name} color={user.avatar_color} size="lg" />}
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{greeting}, {user?.name?.split(' ')[0]}!</h1>
            <p className="text-gray-500 mt-1">Here's what's happening across your boards</p>
          </div>
        </div>

        {user && <WorldClocks userId={user.id} />}

        {user && <QuickLinks userId={user.id} />}

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 border border-gray-200">
            <div className="text-2xl font-bold text-monday-blue">{workspaces.length}</div>
            <div className="text-sm text-gray-500 mt-1">Workspaces</div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-200">
            <div className="text-2xl font-bold text-monday-green">{allBoards.length}</div>
            <div className="text-sm text-gray-500 mt-1">Boards</div>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-200">
            <div className="text-2xl font-bold text-monday-orange">{workspaces.filter(w => w.role === 'owner').length}</div>
            <div className="text-sm text-gray-500 mt-1">Owned workspaces</div>
          </div>
        </div>

        <button onClick={toggleBoards}
          className="flex items-center gap-2 mb-4 group" title={boardsCollapsed ? 'Expand' : 'Minimize'}>
          <ChevronDown size={18}
            className={`text-gray-400 group-hover:text-gray-700 transition-transform ${boardsCollapsed ? '-rotate-90' : ''}`} />
          <h2 className="text-lg font-bold text-gray-900">Recent Boards</h2>
          {boardsCollapsed && <span className="text-xs text-gray-400 font-normal">({allBoards.length})</span>}
        </button>
        {boardsCollapsed ? null : allBoards.length === 0 ? (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 text-sm">No boards yet — create one from the sidebar!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {allBoards.map(board => {
              const ws = workspaces.find(w => w.id === board.workspace_id);
              return (
                <button key={board.id} onClick={() => navigate(`/board/${board.id}`)}
                  className="bg-white rounded-xl p-5 border border-gray-200 hover:border-monday-blue hover:shadow-md transition-all text-left group">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{board.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 group-hover:text-monday-blue truncate">{board.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{ws?.name}</div>
                      <div className="text-xs text-gray-400 mt-1">{format(parseISO(board.created_at), 'MMM d, yyyy')}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
