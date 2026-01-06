import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileText, X, CheckCircle, Navigation } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L, { type LeafletMouseEvent } from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  file: File;
}

interface FileUploadSectionProps {
  hideHeader?: boolean;
  onContinueToSignIn?: () => void;
  // Called when user closes the receipt modal to return to the main page
  onCloseUpload?: () => void;
}

type ReceiptEntry = {
  id: string;
  createdAt: string;
  text: string;
};

// Helpers to parse values directly from the generated receipt text as a fallback
const extractTransactionIdFromText = (text: string): string | null => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const patterns = [
    /\btransaction\s*id\s*[:#-]?\s*([A-Za-z0-9._-]+)/i,
    /\btxn\s*id\s*[:#-]?\s*([A-Za-z0-9._-]+)/i,
    /\btransaction\s*#\s*[:#-]?\s*([A-Za-z0-9._-]+)/i,
  ];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m?.[1]) return m[1].trim();
    }
  }
  return null;
};

const extractAddressFromSection = (text: string, sectionNames: string[]): string | null => {
  const lines = text.split(/\r?\n/);
  const isHeader = (s: string) =>
    sectionNames.some((name) => new RegExp(`^\\s*${name}\\s*:`, 'i').test(s.trim())) ||
    sectionNames.some((name) => new RegExp(`^\\s*${name}\\b`, 'i').test(s.trim()));
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isHeader(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) break;
    if (/^(pickup|pick\s*up|dropoff|drop-off|drop\s*off|transaction)\b/i.test(cur)) break;
    const m = cur.match(/^(?:address|adress|addr)\s*[:#-]\s*(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  return null;
};

const extractPickupAddressFromText = (text: string) =>
  extractAddressFromSection(text, ['pickup location', 'pickup', 'pick up']);

const extractDropoffAddressFromText = (text: string) =>
  extractAddressFromSection(text, ['dropoff location', 'drop-off location', 'drop off location', 'dropoff', 'drop-off', 'drop off']);

type ServiceType = 'pickup_one_way' | 'delivery_one_way';
type VehicleType = 'standard';

type CostData = {
  distance: number;
  cost: number;
  duration?: number;
  route?: unknown;
  pricingCity?: string;
  pricingStatus?: 'official' | 'estimated';
};

type FormData = {
  service: {
    service_type: ServiceType;
    vehicle_type: VehicleType;
  };
  vehicle: {
    vin: string;
    year: string;
    make: string;
    model: string;
    transmission: string;
    odometer_km: string;
    exterior_color: string;
    interior_color: string;
    has_accident: string;
  };
  selling_dealership: {
    name: string;
    phone: string;
    address: string;
  };
  buying_dealership: {
    name: string;
    phone: string;
    contact_name: string;
  };
  pickup_location: {
    name: string;
    address: string;
    phone: string;
  };
  dropoff_location: {
    name: string;
    phone: string;
    address: string;
    lat: string;
    lng: string;
    service_area: string;
  };
  transaction: {
    transaction_id: string;
    release_form_number: string;
    release_date: string;
    arrival_date: string;
  };
  authorization: {
    released_by_name: string;
    released_to_name: string;
  };
  dealer_notes: string;
  costEstimate?: CostData | null;
  transaction_id?: string;
  release_form_number?: string;
  arrival_date?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const readString = (value: unknown): string => (typeof value === 'string' ? value : '');
const readNumber = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const pickFirstString = (...values: unknown[]): string => {
  for (const v of values) {
    const s = readString(v).trim();
    if (s) return s;
  }
  return '';
};

const extractWebhookOutput = (data: unknown): unknown => {
  if (Array.isArray(data)) {
    const first = data[0];
    if (isRecord(first)) return first.output ?? null;
    return null;
  }
  if (isRecord(data)) return data.output ?? null;
  return null;
};

const extractWebhookText = (data: unknown): string | null => {
  if (Array.isArray(data)) {
    const first = data[0];
    if (!isRecord(first)) return null;
    const maybe = first.output ?? first.text;
    const s = readString(maybe).trim();
    return s || null;
  }
  if (isRecord(data)) {
    const maybe = data.output ?? data.text;
    const s = readString(maybe).trim();
    return s || null;
  }
  const s = readString(data).trim();
  return s || null;
};

const OFFICIAL_CITY_TOTAL_PRICES: Array<{ city: string; total_price: number; match: (addr: string) => boolean }> = [
  {
    city: 'Toronto (Oshawa Region)',
    total_price: 385,
    match: (addr) => /\boshawa\b/i.test(addr) || /\bajax\b/i.test(addr) || /\bwhitby\b/i.test(addr) || /\bpickering\b/i.test(addr),
  },
  {
    city: 'Toronto (Downtown / Brampton / Mississauga)',
    total_price: 435,
    match: (addr) =>
      /\btoronto\b/i.test(addr) || /\bdowntown\b/i.test(addr) || /\bbrampton\b/i.test(addr) || /\bmississauga\b/i.test(addr),
  },
  { city: 'Hamilton', total_price: 535, match: (addr) => /\bhamilton\b/i.test(addr) },
  { city: 'Niagara Falls', total_price: 585, match: (addr) => /\bniagara\s*falls\b/i.test(addr) },
  { city: 'Windsor', total_price: 635, match: (addr) => /\bwindsor\b/i.test(addr) },
  { city: 'London, Ontario', total_price: 585, match: (addr) => /\blondon\b/i.test(addr) },
  { city: 'Kingston', total_price: 235, match: (addr) => /\bkingston\b/i.test(addr) },
  { city: 'Belleville', total_price: 285, match: (addr) => /\bbelleville\b/i.test(addr) },
  { city: 'Cornwall', total_price: 205, match: (addr) => /\bcornwall\b/i.test(addr) },
  { city: 'Peterborough', total_price: 385, match: (addr) => /\bpeterborough\b/i.test(addr) },
  { city: 'Barrie', total_price: 435, match: (addr) => /\bbarrie\b/i.test(addr) },
  { city: 'North Bay', total_price: 435, match: (addr) => /\bnorth\s*bay\b/i.test(addr) },
  { city: 'Timmins', total_price: 685, match: (addr) => /\btimmins\b/i.test(addr) },
  {
    city: 'Montreal (Trois-Rivières Region)',
    total_price: 335,
    match: (addr) => /\btrois[-\s]*rivi(e|è)res\b/i.test(addr) || /\btrois\s*rivieres\b/i.test(addr),
  },
  { city: 'Montreal', total_price: 285, match: (addr) => /\bmontreal\b/i.test(addr) || /\bmontr(e|é)al\b/i.test(addr) },
  { city: 'Quebec City', total_price: 435, match: (addr) => /\bqu(e|é)bec\s*city\b/i.test(addr) || /\bville\s*de\s*qu(e|é)bec\b/i.test(addr) },
];

const SERVICE_AREAS = [
  'Toronto (Oshawa Region)',
  'Toronto (Downtown / Brampton / Mississauga)',
  'Hamilton',
  'Niagara Falls',
  'Windsor',
  'London, Ontario',
  'Kingston',
  'Belleville',
  'Cornwall',
  'Peterborough',
  'Barrie',
  'North Bay',
  'Timmins',
  'Montreal',
  'Montreal (Trois-Rivières Region)',
  'Quebec City',
] as const;

const SERVICE_AREA_GEOCODE_QUERY: Record<(typeof SERVICE_AREAS)[number], string> = {
  'Toronto (Oshawa Region)': 'Oshawa, ON, Canada',
  'Toronto (Downtown / Brampton / Mississauga)': 'Toronto, ON, Canada',
  Hamilton: 'Hamilton, ON, Canada',
  'Niagara Falls': 'Niagara Falls, ON, Canada',
  Windsor: 'Windsor, ON, Canada',
  'London, Ontario': 'London, ON, Canada',
  Kingston: 'Kingston, ON, Canada',
  Belleville: 'Belleville, ON, Canada',
  Cornwall: 'Cornwall, ON, Canada',
  Peterborough: 'Peterborough, ON, Canada',
  Barrie: 'Barrie, ON, Canada',
  'North Bay': 'North Bay, ON, Canada',
  Timmins: 'Timmins, ON, Canada',
  Montreal: 'Montreal, QC, Canada',
  'Montreal (Trois-Rivières Region)': 'Trois-Rivières, QC, Canada',
  'Quebec City': 'Quebec City, QC, Canada',
};

const getOfficialCityPriceForServiceArea = (serviceArea: string | null | undefined) => {
  const area = String(serviceArea ?? '').trim();
  if (!area) return null;
  const found = OFFICIAL_CITY_TOTAL_PRICES.find((item) => item.city === area);
  if (!found) return null;
  return { city: found.city, total_price: found.total_price };
};

const getOfficialCityPriceForAddress = (address: string | null | undefined) => {
  const addr = String(address ?? '').trim();
  if (!addr) return null;
  for (const item of OFFICIAL_CITY_TOTAL_PRICES) {
    if (item.match(addr)) return { city: item.city, total_price: item.total_price };
  }
  return null;
};

export default function FileUploadSection({ hideHeader = false, onContinueToSignIn, onCloseUpload }: FileUploadSectionProps) {
  const STORAGE_FORM = 'ed_extractedFormData';
  const STORAGE_MESSAGE = 'ed_submitMessage';
  const STORAGE_ERROR = 'ed_submitError';
  const STORAGE_RECEIPTS_PENDING = 'ed_receipts_pending';
  const STORAGE_RECEIPTS_BY_USER_PREFIX = 'ed_receipts_by_user_';
  const STORAGE_DOCUMENTS_PENDING_CLAIM = 'ed_documents_pending_claim';

  const isLoggedIn = useMemo(() => {
    try {
      return Boolean(localStorage.getItem('ed_googleCredential'));
    } catch {
      return false;
    }
  }, []);

  const preventFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiptText, setReceiptText] = useState<string | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [showCostEstimate, setShowCostEstimate] = useState(false);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_MESSAGE);
    } catch {
      return null;
    }
  });
  const [submitError, setSubmitError] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_ERROR) === 'true';
    } catch {
      return false;
    }
  });
  const [formData, setFormData] = useState<FormData | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_FORM);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return isRecord(parsed) ? (parsed as FormData) : null;
    } catch {
      return null;
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressGeocodeRef = useRef(false);
  const lastServiceAreaGeocodeRef = useRef<string | null>(null);
  const [dealershipCoords, setDealershipCoords] = useState<{ lat: number; lng: number } | null>(null);

  const dropoffMarkerIcon = useMemo(
    () =>
      L.icon({
        iconRetinaUrl: markerIcon2x,
        iconUrl: markerIcon,
        shadowUrl: markerShadow,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
    []
  );

  useEffect(() => {
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: markerIcon2x,
      iconUrl: markerIcon,
      shadowUrl: markerShadow,
    });
  }, []);

  const clearPersisted = () => {
    try {
      localStorage.removeItem(STORAGE_FORM);
      localStorage.removeItem(STORAGE_MESSAGE);
      localStorage.removeItem(STORAGE_ERROR);
    } catch {
      // ignore
    }
  };

  const getUserKey = (): string | null => {
    try {
      const token = localStorage.getItem('ed_googleCredential');
      if (!token) return null;

      const parts = token.split('.');
      if (parts.length < 2) return null;

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = atob(padded);
      const payload = JSON.parse(json) as { sub?: string; email?: string };
      return payload?.sub || payload?.email || null;
    } catch {
      return null;
    }
  };

  const persistReceipt = (text: string) => {
    const entry: ReceiptEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
      text,
    };

    const userKey = getUserKey();
    const storageKey = userKey ? `${STORAGE_RECEIPTS_BY_USER_PREFIX}${userKey}` : STORAGE_RECEIPTS_PENDING;

    try {
      const existingRaw = localStorage.getItem(storageKey);
      const existing = existingRaw ? (JSON.parse(existingRaw) as ReceiptEntry[]) : [];
      localStorage.setItem(storageKey, JSON.stringify([entry, ...existing]));
    } catch {
      // ignore
    }
  };

  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    const q = address.trim();
    if (!q) return null;

    const parts = q.split(',').map((p) => p.trim()).filter(Boolean);
    const idxWithNumber = parts.findIndex((p) => /\d/.test(p));
    const normalizedQuery = idxWithNumber > 0 ? parts.slice(idxWithNumber).join(', ') : q;
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=pjson&maxLocations=1&outFields=*&singleLine=${encodeURIComponent(normalizedQuery)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ location?: { x?: number; y?: number } }>;
    };
    const candidate = data?.candidates?.[0];
    const lat = Number(candidate?.location?.y);
    const lng = Number(candidate?.location?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&location=${encodeURIComponent(String(lng))}%2C${encodeURIComponent(String(lat))}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: { Match_addr?: string; LongLabel?: string } };
    return data?.address?.LongLabel ?? data?.address?.Match_addr ?? null;
  };

  const encodePolyline = (coordinates: [number, number][]): string => {
    // Convert coordinates to lat,lng format and join with |
    // Note: coordinates come as [lng, lat] from routing APIs, need to flip to [lat, lng]
    return coordinates.map(coord => `${coord[1]},${coord[0]}`).join('|');
  };

  const calculateCostAndDistance = async (pickupLat: number, pickupLng: number, dropoffLat: number, dropoffLng: number): Promise<CostData | null> => {
    try {
      // Try to get road-based routing first using OSRM (Open Source Routing Machine)
      try {
        const routingUrl = `https://router.project-osrm.org/route/v1/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?overview=full&geometries=geojson`;
        const routeResponse = await fetch(routingUrl);
        
        if (routeResponse.ok) {
          const routeData = await routeResponse.json();
          const route = routeData?.routes?.[0];
          if (route) {
            const distanceKm = Math.round(route.distance / 1000);
            const durationMin = Math.round(route.duration / 60);
            const polyline = route?.geometry?.coordinates ? encodePolyline(route.geometry.coordinates) : undefined;
            
            const costPerKm = 2.50;
            const minimumCost = 150;
            const calculatedCost = Math.max(distanceKm * costPerKm, minimumCost);
            
            return {
              distance: distanceKm,
              cost: Math.round(calculatedCost),
              duration: durationMin,
              route: { geometry: route.geometry, polyline }
            };
          }
        }
      } catch {
        console.log('OSRM routing failed, trying alternative...');
        
        // Try MapBox routing as backup
        try {
          const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw&geometries=geojson`;
          const mapboxResponse = await fetch(mapboxUrl);
          
          if (mapboxResponse.ok) {
            const mapboxData = await mapboxResponse.json();
            const route = mapboxData?.routes?.[0];
            if (route) {
              const distanceKm = Math.round(route.distance / 1000);
              const durationMin = Math.round(route.duration / 60);
              const polyline = route?.geometry?.coordinates ? encodePolyline(route.geometry.coordinates) : undefined;
              
              const costPerKm = 2.50;
              const minimumCost = 150;
              const calculatedCost = Math.max(distanceKm * costPerKm, minimumCost);
              
              return {
                distance: distanceKm,
                cost: Math.round(calculatedCost),
                duration: durationMin,
                route: { geometry: route.geometry, polyline }
              };
            }
          }
        } catch {
          console.log('MapBox routing also failed, using straight-line distance');
        }
      }

      // Fallback to Haversine formula if routing fails
      const R = 6371; // Earth's radius in kilometers
      const dLat = (dropoffLat - pickupLat) * Math.PI / 180;
      const dLng = (dropoffLng - pickupLng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(pickupLat * Math.PI / 180) * Math.cos(dropoffLat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c; // Distance in kilometers

      // Estimate duration (assuming average speed of 60 km/h)
      const averageSpeed = 60; // km/h
      const duration = Math.round((distance / averageSpeed) * 60); // minutes

      // Simple cost calculation: $2.50 per km with minimum $150
      const costPerKm = 2.50;
      const minimumCost = 150;
      const calculatedCost = Math.max(distance * costPerKm, minimumCost);

      return {
        distance: Math.round(distance),
        cost: Math.round(calculatedCost),
        duration: duration
      };
    } catch (error) {
      console.error('Error calculating cost:', error);
      return null;
    }
  };

  const dropoffCoords = useMemo(() => {
    const addr = String(formData?.dropoff_location?.address ?? '').trim();
    if (!addr) return null;
    const latRaw = String(formData?.dropoff_location?.lat ?? '').trim();
    const lngRaw = String(formData?.dropoff_location?.lng ?? '').trim();
    if (!latRaw || !lngRaw) return null;
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  }, [formData?.dropoff_location?.address, formData?.dropoff_location?.lat, formData?.dropoff_location?.lng]);

  useEffect(() => {
    const addr = String(formData?.dropoff_location?.address ?? '').trim();
    if (addr) return;

    const lat = String(formData?.dropoff_location?.lat ?? '').trim();
    const lng = String(formData?.dropoff_location?.lng ?? '').trim();
    if (!lat && !lng) return;

    updateFormField('dropoff_location', 'lat', '');
    updateFormField('dropoff_location', 'lng', '');
  }, [formData?.dropoff_location?.address, formData?.dropoff_location?.lat, formData?.dropoff_location?.lng]);

  useEffect(() => {
    const pickupAddress = String(formData?.pickup_location?.address ?? '').trim();
    if (!pickupAddress) return;

    const timer = window.setTimeout(async () => {
      try {
        const result = await geocodeAddress(pickupAddress);
        if (!result) return;
        setDealershipCoords(result);
      } catch {
        // ignore
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [formData?.pickup_location?.address]);

  useEffect(() => {
    const area = String(formData?.dropoff_location?.service_area ?? '').trim();
    if (!area) return;

    const latRaw = String(formData?.dropoff_location?.lat ?? '').trim();
    const lngRaw = String(formData?.dropoff_location?.lng ?? '').trim();
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const hasValidCoords =
      latRaw !== '' &&
      lngRaw !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180 &&
      !(lat === 0 && lng === 0);

    const prevArea = lastServiceAreaGeocodeRef.current;
    lastServiceAreaGeocodeRef.current = area;

    // On first render/load, don't override coordinates that were already extracted from the PDF.
    if (prevArea === null && hasValidCoords) return;

    // If nothing changed and coords are already valid, do nothing.
    if (prevArea === area && hasValidCoords) return;

    const query = (SERVICE_AREA_GEOCODE_QUERY as Record<string, string>)[area] ?? `${area}, Canada`;
    const existingAddress = String(formData?.dropoff_location?.address ?? '').trim();
    const timer = window.setTimeout(async () => {
      try {
        const result = await geocodeAddress(query);
        if (!result) return;

        updateFormField('dropoff_location', 'lat', String(result.lat));
        updateFormField('dropoff_location', 'lng', String(result.lng));

        if (!existingAddress) {
          suppressGeocodeRef.current = true;
          updateFormField('dropoff_location', 'address', area);
        }
      } catch {
        // ignore
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    formData?.dropoff_location?.service_area,
    formData?.dropoff_location?.lat,
    formData?.dropoff_location?.lng,
    formData?.dropoff_location?.address,
  ]);

  useEffect(() => {
    const vt = String(formData?.service?.vehicle_type ?? 'standard');
    if (vt && vt !== 'standard') {
      updateFormField('service', 'vehicle_type', 'standard');
    }
  }, [formData?.service?.vehicle_type]);

  useEffect(() => {
    const address = String(formData?.dropoff_location?.address ?? '');
    if (!address.trim()) return;
    if (suppressGeocodeRef.current) {
      suppressGeocodeRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await geocodeAddress(address);
        if (!result) return;
        updateFormField('dropoff_location', 'lat', String(result.lat));
        updateFormField('dropoff_location', 'lng', String(result.lng));
      } catch {
        // ignore
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [formData?.dropoff_location?.address]);

  const DropoffMapUpdater = ({ lat, lng }: { lat: number; lng: number }) => {
    const map = useMap();
    useEffect(() => {
      map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: true });
    }, [lat, lng, map]);
    return null;
  };

  const DropoffMapClickHandler = () => {
    useMapEvents({
      click: async (e: LeafletMouseEvent) => {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        updateFormField('dropoff_location', 'lat', String(lat));
        updateFormField('dropoff_location', 'lng', String(lng));

        try {
          const addr = await reverseGeocode(lat, lng);
          if (addr) {
            suppressGeocodeRef.current = true;
            updateFormField('dropoff_location', 'address', addr);
          }
        } catch {
          // ignore
        }
      },
    });
    return null;
  };

  useEffect(() => {
    try {
      if (formData) {
        localStorage.setItem(STORAGE_FORM, JSON.stringify(formData));
      } else {
        localStorage.removeItem(STORAGE_FORM);
      }

      if (submitMessage === null) {
        localStorage.removeItem(STORAGE_MESSAGE);
      } else {
        localStorage.setItem(STORAGE_MESSAGE, submitMessage);
      }

      localStorage.setItem(STORAGE_ERROR, submitError ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [formData, submitMessage, submitError]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const initFormData = (output: unknown): FormData | null => {
    if (!output || !isRecord(output)) return null;

    const serviceObj = isRecord(output.service) ? output.service : null;
    const transactionObj = isRecord(output.transaction) ? output.transaction : null;
    const vehicleObj = isRecord(output.vehicle) ? output.vehicle : null;
    const sellingObj = isRecord(output.selling_dealership) ? output.selling_dealership : null;
    const buyingObj = isRecord(output.buying_dealership) ? output.buying_dealership : null;
    const pickupObj = isRecord(output.pickup_location) ? output.pickup_location : null;
    const dropoffObj = isRecord(output.dropoff_location) ? output.dropoff_location : null;
    const dropOffAltObj = isRecord((output as Record<string, unknown>).drop_off_location)
      ? ((output as Record<string, unknown>).drop_off_location as Record<string, unknown>)
      : null;
    const dropoffAlt2Obj = isRecord(output.dropoff) ? output.dropoff : null;
    const deliveryObj = isRecord(output.delivery_location) ? output.delivery_location : null;
    const deliveryObj2 = isRecord((output as Record<string, unknown>).deliveryLocation)
      ? ((output as Record<string, unknown>).deliveryLocation as Record<string, unknown>)
      : null;
    const destinationObj = isRecord((output as Record<string, unknown>).destination)
      ? ((output as Record<string, unknown>).destination as Record<string, unknown>)
      : null;
    const authObj = isRecord(output.authorization) ? output.authorization : null;

    // New flat format (from webhook) support
    const out = output as Record<string, unknown>;
    const newTxnId = readString(out.transaction_number);
    const newReleaseDate = readString(out.release_date);
    const newVehicleYear = readString(out.vehicle_year);
    const newVehicleMake = readString(out.vehicle_make);
    const newVehicleModel = readString(out.vehicle_model);
    const newVehicleTrans = readString(out.vehicle_transmission);
    const newVehicleCyl = readString(out.vehicle_cylinders);
    const newVehicleColor = readString(out.vehicle_color);
    const newVehicleOdoRaw = readString(out.vehicle_odometer);
    const newVehicleOdo = newVehicleOdoRaw ? newVehicleOdoRaw.replace(/[^0-9.]/g, '') : '';
    const newPickupName = readString(out.pickup_location_name);
    const newPickupAddress = readString(out.pickup_location_address);
    const newPickupPhone = readString(out.pickup_location_phone);
    const newSellingName = readString(out.selling_dealership_name);
    const newSellingPhone = readString(out.selling_dealership_phone);
    const newBuyingName = readString(out.buying_dealership_name);
    const newBuyingPhone = readString(out.buying_dealership_phone);

    const extractedServiceTypeRaw = pickFirstString(
      output.service_type,
      (output as Record<string, unknown>).serviceType,
      serviceObj?.service_type,
      serviceObj?.serviceType,
      transactionObj?.service_type,
      transactionObj?.serviceType
    );
    const normalizedServiceType = extractedServiceTypeRaw.toLowerCase();
    const serviceType = /deliver/.test(normalizedServiceType) ? 'delivery_one_way' : 'pickup_one_way';

    const vehicleType = 'standard';

    const extractedDropoffAddress = pickFirstString(
      dropoffObj?.address,
      dropoffObj?.full_address,
      (typeof output.dropoff_location === 'string' ? output.dropoff_location : ''),
      dropOffAltObj?.address,
      dropOffAltObj?.full_address,
      (typeof (output as Record<string, unknown>).drop_off_location === 'string' ? (output as Record<string, unknown>).drop_off_location : ''),
      dropoffAlt2Obj?.address,
      (typeof output.dropoff === 'string' ? output.dropoff : ''),
      (output as Record<string, unknown>).dropoff_address,
      (output as Record<string, unknown>).dropoffAddress,
      deliveryObj?.address,
      (typeof output.delivery_location === 'string' ? output.delivery_location : ''),
      deliveryObj2?.address,
      (typeof (output as Record<string, unknown>).deliveryLocation === 'string' ? (output as Record<string, unknown>).deliveryLocation : ''),
      destinationObj?.address,
      (typeof (output as Record<string, unknown>).destination === 'string' ? (output as Record<string, unknown>).destination : ''),
      (output as Record<string, unknown>).destination_address,
      (output as Record<string, unknown>).destinationAddress,
      (output as Record<string, unknown>).delivery_address,
      (output as Record<string, unknown>).deliveryAddress
    );

    const extractedDropoffCity = pickFirstString(
      dropoffObj?.city,
      dropOffAltObj?.city,
      (output as Record<string, unknown>).dropoff_city,
      (output as Record<string, unknown>).dropoffCity,
      deliveryObj?.city,
      deliveryObj2?.city,
      (output as Record<string, unknown>).destination_city,
      (output as Record<string, unknown>).destinationCity,
      (output as Record<string, unknown>).delivery_city,
      (output as Record<string, unknown>).deliveryCity
    );

    const extractedDropoffName = pickFirstString(dropoffObj?.name, dropOffAltObj?.name, dropoffAlt2Obj?.name, deliveryObj?.name);
    const extractedDropoffPhone = pickFirstString(dropoffObj?.phone, dropOffAltObj?.phone, dropoffAlt2Obj?.phone, deliveryObj?.phone);
    const extractedDropoffLat =
      dropoffObj?.lat ?? dropOffAltObj?.lat ?? dropoffAlt2Obj?.lat ?? (output as Record<string, unknown>).dropoff_lat ?? (output as Record<string, unknown>).dropoffLat ?? deliveryObj?.lat;
    const extractedDropoffLng =
      dropoffObj?.lng ?? dropOffAltObj?.lng ?? dropoffAlt2Obj?.lng ?? (output as Record<string, unknown>).dropoff_lng ?? (output as Record<string, unknown>).dropoffLng ?? deliveryObj?.lng;

    const dropoffAddress = String(extractedDropoffAddress ?? '').trim() || String(extractedDropoffCity ?? '').trim();
    const dropoffName = extractedDropoffName;
    const dropoffPhone = extractedDropoffPhone;
    const dropoffLat = Number.isFinite(readNumber(extractedDropoffLat)) ? String(readNumber(extractedDropoffLat)) : '';
    const dropoffLng = Number.isFinite(readNumber(extractedDropoffLng)) ? String(readNumber(extractedDropoffLng)) : '';
    const inferredServiceArea =
      getOfficialCityPriceForAddress(`${dropoffAddress} ${String(dropoffName ?? '').trim()}`.trim())?.city ??
      getOfficialCityPriceForServiceArea(String(extractedDropoffCity ?? '').trim())?.city ??
      '';

    return {
      service: {
        service_type: serviceType,
        vehicle_type: vehicleType,
      },
      vehicle: {
        vin: readString(vehicleObj?.vin) || readString(out.vin),
        year: readString(vehicleObj?.year) || newVehicleYear,
        make: readString(vehicleObj?.make) || newVehicleMake,
        model: readString(vehicleObj?.model) || newVehicleModel,
        transmission: readString(vehicleObj?.transmission) || newVehicleTrans,
        odometer_km: readString(vehicleObj?.odometer_km) || newVehicleOdo,
        exterior_color: readString(vehicleObj?.exterior_color) || newVehicleColor,
        interior_color: readString(vehicleObj?.interior_color),
        has_accident: readString(vehicleObj?.has_accident) || newVehicleCyl,
      },
      selling_dealership: {
        name: readString(sellingObj?.name) || newSellingName,
        phone: readString(sellingObj?.phone) || newSellingPhone,
        address: readString(sellingObj?.address),
      },
      buying_dealership: {
        name: readString(buyingObj?.name) || newBuyingName,
        phone: readString(buyingObj?.phone) || newBuyingPhone,
        contact_name: readString(buyingObj?.contact_name),
      },
      pickup_location: {
        name: readString(pickupObj?.name) || newPickupName,
        address: readString(pickupObj?.address) || newPickupAddress,
        phone: readString(pickupObj?.phone) || newPickupPhone,
      },
      dropoff_location: {
        name: dropoffName,
        phone: dropoffPhone,
        address: dropoffAddress,
        lat: dropoffLat,
        lng: dropoffLng,
        service_area: inferredServiceArea,
      },
      transaction: {
        transaction_id: readString(transactionObj?.transaction_id) || newTxnId,
        release_form_number: readString(transactionObj?.release_form_number),
        release_date: readString(transactionObj?.release_date) || newReleaseDate,
        arrival_date: readString(transactionObj?.arrival_date),
      },
      authorization: {
        released_by_name: readString(authObj?.released_by_name),
        released_to_name: readString(authObj?.released_to_name),
      },
      dealer_notes: readString((output as Record<string, unknown>).dealer_notes),
    };
  };

  const createBlankFormData = () =>
    initFormData({
      service: { service_type: 'pickup_one_way', vehicle_type: 'standard' },
      vehicle: {},
      selling_dealership: {},
      buying_dealership: {},
      pickup_location: {},
      dropoff_location: { lat: '', lng: '', service_area: '' },
      transaction: {},
      authorization: {},
      dealer_notes: '',
    });

  const closeManualForm = () => {
    setIsManualFormOpen(false);
    setFormData(null);
  };

  const renderFormDetails = () => {
    if (!formData) return null;

    return (
      <div className="mt-6 border border-gray-200 rounded-lg p-4 sm:p-6 bg-gray-50">
        <h4 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Extracted Details</h4>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Vehicle</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">VIN</label>
              <input value={formData.vehicle.vin} onChange={(e) => updateFormField('vehicle', 'vin', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Year</label>
              <input value={formData.vehicle.year} onChange={(e) => updateFormField('vehicle', 'year', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Make</label>
              <input value={formData.vehicle.make} onChange={(e) => updateFormField('vehicle', 'make', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Model</label>
              <input value={formData.vehicle.model} onChange={(e) => updateFormField('vehicle', 'model', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Transmission</label>
              <input value={formData.vehicle.transmission} onChange={(e) => updateFormField('vehicle', 'transmission', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Odometer (km)</label>
              <input value={formData.vehicle.odometer_km} onChange={(e) => updateFormField('vehicle', 'odometer_km', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Exterior Color</label>
              <input value={formData.vehicle.exterior_color} onChange={(e) => updateFormField('vehicle', 'exterior_color', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Interior Color</label>
              <input value={formData.vehicle.interior_color} onChange={(e) => updateFormField('vehicle', 'interior_color', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Has Accident</label>
              <input value={formData.vehicle.has_accident} onChange={(e) => updateFormField('vehicle', 'has_accident', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Selling Dealership</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input value={formData.selling_dealership.name} onChange={(e) => updateFormField('selling_dealership', 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input value={formData.selling_dealership.phone} onChange={(e) => updateFormField('selling_dealership', 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Address</label>
              <input value={formData.selling_dealership.address} onChange={(e) => updateFormField('selling_dealership', 'address', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Buying Dealership</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input value={formData.buying_dealership.name} onChange={(e) => updateFormField('buying_dealership', 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input value={formData.buying_dealership.phone} onChange={(e) => updateFormField('buying_dealership', 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Contact Name</label>
              <input value={formData.buying_dealership.contact_name} onChange={(e) => updateFormField('buying_dealership', 'contact_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Service Details</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Service Type</label>
              <select
                value={String(formData?.service?.service_type ?? 'pickup_one_way')}
                onChange={(e) => updateFormField('service', 'service_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
              >
                <option value="pickup_one_way">Pickup (one-way)</option>
                <option value="delivery_one_way">Delivery (one-way)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Vehicle Type</label>
              <input
                value="Standard passenger vehicle"
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-800"
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Pickup Location</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input value={formData.pickup_location.name} onChange={(e) => updateFormField('pickup_location', 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input value={formData.pickup_location.phone} onChange={(e) => updateFormField('pickup_location', 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Address</label>
              <input value={formData.pickup_location.address} onChange={(e) => updateFormField('pickup_location', 'address', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Drop-off Location</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input value={String(formData?.dropoff_location?.name ?? '')} onChange={(e) => updateFormField('dropoff_location', 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input value={String(formData?.dropoff_location?.phone ?? '')} onChange={(e) => updateFormField('dropoff_location', 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Route / Service Area</label>
              <select
                value={String(formData?.dropoff_location?.service_area ?? '')}
                onChange={(e) => updateFormField('dropoff_location', 'service_area', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
              >
                <option value="">Select service area</option>
                {SERVICE_AREAS.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Address</label>
              <input
                value={String(formData?.dropoff_location?.address ?? '')}
                onChange={(e) => updateFormField('dropoff_location', 'address', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Optional: type address to auto-pin on the map"
              />
            </div>
          </div>

          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden bg-white h-60 sm:h-80 relative z-0">
            <MapContainer
              center={dropoffCoords ? [dropoffCoords.lat, dropoffCoords.lng] : dealershipCoords ? [dealershipCoords.lat, dealershipCoords.lng] : [45.5017, -73.5673]}
              zoom={dropoffCoords || dealershipCoords ? 13 : 10}
              style={{ height: '100%', width: '100%', zIndex: 1 }}
            >
              <TileLayer
                attribution='Tiles &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <DropoffMapClickHandler />
              {(dropoffCoords || dealershipCoords) && (
                <>
                  <DropoffMapUpdater lat={(dropoffCoords ?? dealershipCoords)!.lat} lng={(dropoffCoords ?? dealershipCoords)!.lng} />
                  <Marker position={[(dropoffCoords ?? dealershipCoords)!.lat, (dropoffCoords ?? dealershipCoords)!.lng]} icon={dropoffMarkerIcon} />
                </>
              )}
            </MapContainer>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Transaction</h5>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Transaction ID</label>
              <input value={formData.transaction.transaction_id} onChange={(e) => updateFormField('transaction', 'transaction_id', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Release Form #</label>
              <input value={formData.transaction.release_form_number} onChange={(e) => updateFormField('transaction', 'release_form_number', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Release Date</label>
              <input value={formData.transaction.release_date} onChange={(e) => updateFormField('transaction', 'release_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Arrival Date</label>
              <input value={formData.transaction.arrival_date} onChange={(e) => updateFormField('transaction', 'arrival_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Authorization</h5>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Released By Name</label>
              <input value={formData.authorization.released_by_name} onChange={(e) => updateFormField('authorization', 'released_by_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Released To Name</label>
              <input value={formData.authorization.released_to_name} onChange={(e) => updateFormField('authorization', 'released_to_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
        </div>

        <div>
          <h5 className="text-sm font-semibold text-gray-700 mb-3">Dealer Notes</h5>
          <textarea
            value={formData.dealer_notes}
            onChange={(e) =>
              setFormData((prev) => {
                if (!prev) return prev;
                return { ...prev, dealer_notes: e.target.value };
              })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-[96px]"
          />
        </div>
      </div>
    );
  };

  // Update a nested field in FormData safely (only spreads when it's an object)
  const updateFormField = <K extends keyof FormData>(section: K, key: string, value: string) => {
    setFormData((prev) => {
      if (!prev) return prev;
      const current = prev[section] as unknown;
      const sectionObj: Record<string, unknown> =
        current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
      sectionObj[key] = value;
      return { ...prev, [section]: sectionObj } as FormData;
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = (files: FileList) => {
    const file = files[0];
    if (!file) return;

    const newFile: UploadedFile = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type || 'unknown',
      file,
    };

    clearPersisted();
    setSubmitMessage(null);
    setSubmitError(false);
    setReceiptText(null);
    setIsReceiptOpen(false);
    setShowCostEstimate(false);
    setCostData(null);
    setFormData(null);
    setUploadedFiles([newFile]);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmitDocuments = async () => {
    if (isSubmitting) return;

    if (formData) {
      setShowCostEstimate(false);

      const pickupLat = Number(dealershipCoords?.lat);
      const pickupLng = Number(dealershipCoords?.lng);
      const dropoffLatRaw = String(formData?.dropoff_location?.lat ?? '').trim();
      const dropoffLngRaw = String(formData?.dropoff_location?.lng ?? '').trim();
      const dropoffLat = Number(dropoffLatRaw);
      const dropoffLng = Number(dropoffLngRaw);

      const selectedServiceArea = String(formData?.dropoff_location?.service_area ?? '').trim();

      const official =
        getOfficialCityPriceForServiceArea(selectedServiceArea) ??
        getOfficialCityPriceForAddress(
          `${String(formData?.dropoff_location?.address ?? '').trim()} ${String(formData?.dropoff_location?.name ?? '').trim()}`.trim()
        );

      const hasValidDropoffCoords =
        dropoffLatRaw !== '' &&
        dropoffLngRaw !== '' &&
        Number.isFinite(dropoffLat) &&
        Number.isFinite(dropoffLng) &&
        dropoffLat >= -90 &&
        dropoffLat <= 90 &&
        dropoffLng >= -180 &&
        dropoffLng <= 180 &&
        !(dropoffLat === 0 && dropoffLng === 0);

      if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng) && hasValidDropoffCoords) {
        const estimate = await calculateCostAndDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
        if (estimate) {
          const nextCost = official
            ? { ...estimate, cost: official.total_price, pricingCity: official.city, pricingStatus: 'official' as const }
            : { ...estimate, pricingStatus: 'estimated' as const };
          setCostData(nextCost);
          setShowCostEstimate(true);
          return;
        }
      }

      if (official) {
        setCostData({ distance: 0, cost: official.total_price, pricingCity: official.city, pricingStatus: 'official' as const });
        setShowCostEstimate(true);
        return;
      }

      setSubmitMessage('Please select a Route / Service Area (or set drop-off coordinates) and try again.');
      setSubmitError(true);
      return;
    }

    if (uploadedFiles.length === 0) {
      setSubmitMessage('Please select a file to extract.');
      setSubmitError(true);
      onButtonClick();
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);
    setSubmitError(false);

    try {
      const files = await Promise.all(
        uploadedFiles.map(async (f) => ({
          name: f.name,
          type: f.type,
          size: f.file.size,
          base64: await fileToBase64(f.file),
        }))
      );

      const res = await fetch('https://primary-production-6722.up.railway.app/webhook/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Upload failed (${res.status})`);
      }

      const data = await res.json().catch(() => null);
      const output = extractWebhookOutput(data);
      const extracted = initFormData(output);
      setFormData(extracted);
      setReceiptText(null);
      setIsReceiptOpen(false);

      const extractedServiceArea = String(extracted?.dropoff_location?.service_area ?? '').trim();
      const extractedOfficial =
        getOfficialCityPriceForServiceArea(extractedServiceArea) ??
        getOfficialCityPriceForAddress(
          `${String(extracted?.dropoff_location?.address ?? '').trim()} ${String(extracted?.dropoff_location?.name ?? '').trim()}`.trim()
        );
      if (extractedOfficial) {
        setCostData({
          distance: 0,
          cost: extractedOfficial.total_price,
          pricingCity: extractedOfficial.city,
          pricingStatus: 'official' as const,
        });
        setShowCostEstimate(true);
        setSubmitMessage('Document extracted successfully.');
        setSubmitError(false);
        return;
      }

      setSubmitMessage('Document extracted successfully. Please review the details then click Submit Document.');
      setSubmitError(false);
    } catch (err) {
      setSubmitMessage(err instanceof Error ? err.message : 'Upload failed');
      setSubmitError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProceedWithCost = async () => {
    setShowCostEstimate(false);
    
    if (!isLoggedIn) {
      setSubmitMessage('Please log in with Google to continue.');
      setSubmitError(true);
      onContinueToSignIn?.();
      return;
    }

    // Proceed with document submission after login
    await proceedWithDocumentSubmission();
  };

  const proceedWithDocumentSubmission = async () => {
    if (!formData) return;

    setIsSubmitting(true);
    setSubmitMessage(null);
    setSubmitError(false);

    try {
      setReceiptText(null);
      setIsReceiptOpen(false);
      const submittedAt = new Date().toISOString();
      const user = (() => {
        try {
          const token = localStorage.getItem('ed_googleCredential');
          if (!token) return { name: '', email: '' };

          const parts = token.split('.');
          if (parts.length < 2) return { name: '', email: '' };

          const base64Url = parts[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
          const json = atob(padded);
          const payload = JSON.parse(json) as { name?: string; email?: string };
          return {
            name: payload?.name ?? '',
            email: payload?.email ?? '',
          };
        } catch {
          return { name: '', email: '' };
        }
      })();

      // Include files if available (may be empty for manual entry)
      const files = uploadedFiles.length > 0
        ? await Promise.all(
            uploadedFiles.map(async (f) => ({
              name: f.name,
              type: f.type,
              size: f.file.size,
              base64: await fileToBase64(f.file),
            }))
          )
        : [];

      const webhookRes = await fetch('https://primary-production-6722.up.railway.app/webhook/Dox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          submittedAt,
          user,
          userName: user.name || user.email || 'Account',
          files,
          formData: {
            ...formData,
            costEstimate: costData
          },
        }),
      });

      if (!webhookRes.ok) {
        const text = await webhookRes.text().catch(() => '');
        throw new Error(text || `Webhook failed (${webhookRes.status})`);
      }

      const responseJson = await webhookRes.json().catch(() => null);
      const responseText = extractWebhookText(responseJson);
      
      const fallbackReceipt = (() => {
        const now = new Date().toISOString();
        const pickupName = String(formData?.pickup_location?.name ?? '').trim();
        const pickupPhone = String(formData?.pickup_location?.phone ?? '').trim();
        const pickupAddress = String(formData?.pickup_location?.address ?? '').trim();
        const dropName = String(formData?.dropoff_location?.name ?? '').trim();
        const dropPhone = String(formData?.dropoff_location?.phone ?? '').trim();
        const dropAddress = String(formData?.dropoff_location?.address ?? '').trim();
        const txnId = String(formData?.transaction?.transaction_id ?? formData?.transaction_id ?? '').trim();
        const releaseForm = String(formData?.transaction?.release_form_number ?? formData?.release_form_number ?? '').trim();
        const arrivalDate = String(formData?.transaction?.arrival_date ?? formData?.arrival_date ?? '').trim();
        const userLabel = String(user?.name || user?.email || 'Account').trim();

        const fulfillment = (() => {
          const city = String(costData?.pricingCity ?? '').toLowerCase();
          return city.includes('montreal') ? 'As fast as 1–2 business days' : '3–8 business days';
        })();

        const lines: string[] = [];
        lines.push('Receipt');
        lines.push(`Created: ${now}`);
        lines.push(`Account: ${userLabel}`);
        lines.push('');
        if (costData) {
          lines.push(`Distance: ${costData.distance} km`);
          if (costData.pricingCity && costData.pricingStatus === 'official') {
            lines.push(`City: ${costData.pricingCity}`);
            lines.push(`Retail Price (before tax): $${costData.cost}`);
            lines.push('+ applicable tax');
          } else {
            lines.push(`Retail Price (before tax): $${costData.cost}`);
            lines.push('+ applicable tax');
          }
          lines.push(`Estimated fulfillment time: ${fulfillment}`);
          lines.push('');
        }
        lines.push('Pickup Location:');
        if (pickupName) lines.push(`Name: ${pickupName}`);
        if (pickupPhone) lines.push(`Phone: ${pickupPhone}`);
        if (pickupAddress) lines.push(`Address: ${pickupAddress}`);
        lines.push('');
        lines.push('Dropoff Location:');
        if (dropName) lines.push(`Name: ${dropName}`);
        if (dropPhone) lines.push(`Phone: ${dropPhone}`);
        if (dropAddress) lines.push(`Address: ${dropAddress}`);
        lines.push('');
        lines.push('Transaction:');
        if (txnId) lines.push(`Transaction ID: ${txnId}`);
        if (releaseForm) lines.push(`Release Form Number: ${releaseForm}`);
        if (arrivalDate) lines.push(`Arrival Date: ${arrivalDate}`);
        return lines.join('\n');
      })();

      const finalReceiptText = responseText ? responseText : fallbackReceipt;
      const normalizedReceipt = String(finalReceiptText).replace(/\r\n/g, '\n').trim();

      persistReceipt(normalizedReceipt);
      setReceiptText(normalizedReceipt);
      setIsReceiptOpen(true);

      if (!isLoggedIn) {
        try {
          const raw = localStorage.getItem(STORAGE_DOCUMENTS_PENDING_CLAIM);
          const existing = raw ? (JSON.parse(raw) as Array<{ submittedAt: string; receipt: string }>) : [];
          const next = Array.isArray(existing) ? existing : [];
          next.unshift({ submittedAt, receipt: normalizedReceipt });
          localStorage.setItem(STORAGE_DOCUMENTS_PENDING_CLAIM, JSON.stringify(next.slice(0, 25)));
        } catch {
          // ignore
        }
      }

      setSubmitMessage('Document submitted successfully.');
      setSubmitError(false);

      clearPersisted();
      setUploadedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setSubmitMessage(err instanceof Error ? err.message : 'Submit failed');
      setSubmitError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {/* Cost Estimate Modal */}
      {showCostEstimate && costData && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowCostEstimate(false);
              setCostData(null);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-2xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-4">
              <div className="text-lg font-semibold">Transport Quote</div>
              <div className="text-sm opacity-90">Route and cost estimate</div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-medium text-gray-500">Route / Service Area</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">
                    {String(costData?.pricingCity ?? formData?.dropoff_location?.service_area ?? '—')}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-medium text-gray-500">Service Type</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">
                    {String(formData?.service?.service_type ?? '') === 'delivery_one_way' ? 'Delivery (one-way)' : 'Pickup (one-way)'}
                  </div>
                </div>
              </div>

              {/* Route Map */}
              <div className="mb-6 rounded-lg overflow-hidden border border-gray-200 h-64 bg-gray-100 relative">
                {formData?.dropoff_location?.lat && formData?.dropoff_location?.lng ? (
                  <iframe
                    src={`https://www.google.com/maps/embed/v1/directions?key=AIzaSyCtkoLYRRy_X-8cBPVn_b2UkbjNRkJeqtY&origin=${dealershipCoords?.lat || 45.5017},${dealershipCoords?.lng || -73.5673}&destination=${formData.dropoff_location.lat},${formData.dropoff_location.lng}&mode=driving&avoid=tolls`}
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <div className="text-center">
                      <Navigation className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">Route will appear when locations are set</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Route Info */}
              <div className="mb-6">
                <div className="bg-blue-50 rounded-lg p-6 text-center">
                  <div className="flex items-center justify-center mb-3">
                    <Navigation className="w-6 h-6 text-blue-600 mr-2" />
                    <span className="text-lg font-medium text-blue-800">Transport Distance</span>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">
                    {costData.pricingStatus === 'official' && costData.distance === 0 ? 'N/A' : `${costData.distance} km`}
                  </div>
                </div>
              </div>

              {/* Cost */}
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-cyan-600 mb-2">${costData.cost}</div>
                <div className="text-sm text-gray-600">Retail Price (before tax)</div>
                <div className="text-xs text-gray-500 mt-1">+ applicable tax</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="text-sm text-gray-700 text-center font-medium">Estimated fulfillment time</div>
                <div className="text-sm text-gray-600 text-center mt-1">
                  {String(costData?.pricingCity ?? '').toLowerCase().includes('montreal') ? 'As fast as 1–2 business days' : '3–8 business days'}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="text-xs text-gray-600 text-center">
                  Rate: $2.50/km • Minimum: $150
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4">
              <div className="space-y-3">
                {isLoggedIn ? (
                  <button
                    onClick={handleProceedWithCost}
                    disabled={isSubmitting}
                    className="w-full bg-cyan-500 text-white px-6 py-3 rounded-lg hover:bg-cyan-600 transition-colors font-semibold disabled:opacity-60"
                  >
                    {isSubmitting ? 'Processing...' : 'Confirm & Generate Receipt'}
                  </button>
                ) : (
                  <>
                    <div className="text-sm text-gray-600 text-center">
                      Please log in with Google to continue
                    </div>
                    <button
                      onClick={() => {
                        setShowCostEstimate(false);
                        onContinueToSignIn?.();
                      }}
                      className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                    >
                      Log In with Google
                    </button>
                  </>
                )}

                <button
                  onClick={() => {
                    setShowCostEstimate(false);
                    setCostData(null);
                  }}
                  className="w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isReceiptOpen && receiptText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsReceiptOpen(false);
              setReceiptText(null);
              setReceiptCopied(false);
              setFormData(null);
              onCloseUpload?.();
            }
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/50 to-black/70 backdrop-blur-sm"></div>

          <div className="relative w-full max-w-2xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                    <CheckCircle className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">Receipt</div>
                    <div className="text-sm opacity-90">Submission confirmed</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const fullText = (() => {
                        const pricingCity = String(costData?.pricingCity ?? formData?.dropoff_location?.service_area ?? '').trim();
                        const serviceTypeLabel =
                          String(formData?.service?.service_type ?? '') === 'delivery_one_way' ? 'Delivery (one-way)' : 'Pickup (one-way)';
                        const fulfillment = pricingCity.toLowerCase().includes('montreal') ? 'As fast as 1–2 business days' : '3–8 business days';
                        const parts: string[] = [];
                        parts.push('Receipt Summary');
                        if (pricingCity) parts.push(`Route / Service Area: ${pricingCity}`);
                        parts.push(`Service Type: ${serviceTypeLabel}`);
                        if (costData) {
                          parts.push(`Retail Price (before tax): $${costData.cost}`);
                          parts.push('+ applicable tax');
                          parts.push(`Estimated fulfillment time: ${fulfillment}`);
                        }
                        parts.push('');
                        parts.push(String(receiptText));
                        return parts.join('\n');
                      })();
                      try {
                        await navigator.clipboard.writeText(fullText);
                        setReceiptCopied(true);
                        window.setTimeout(() => setReceiptCopied(false), 1500);
                      } catch {
                        setReceiptCopied(false);
                      }
                    }}
                    className="inline-flex items-center rounded-xl bg-white/15 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/20 hover:bg-white/20 transition-colors"
                  >
                    {receiptCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsReceiptOpen(false);
                      setReceiptText(null);
                      setReceiptCopied(false);
                      setFormData(null);
                      onCloseUpload?.();
                    }}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 text-white hover:bg-white/20 transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {(() => {
                const pricingCity = String(costData?.pricingCity ?? formData?.dropoff_location?.service_area ?? '').trim();
                const serviceTypeLabel =
                  String(formData?.service?.service_type ?? '') === 'delivery_one_way' ? 'Delivery (one-way)' : 'Pickup (one-way)';
                const fulfillment = pricingCity.toLowerCase().includes('montreal') ? 'As fast as 1–2 business days' : '3–8 business days';

                const pickupName = String(formData?.pickup_location?.name ?? '').trim();
                const pickupPhone = String(formData?.pickup_location?.phone ?? '').trim();
                const rawPickupAddr = String(formData?.pickup_location?.address ?? '').trim();
                const dropName = String(formData?.dropoff_location?.name ?? '').trim();
                const dropPhone = String(formData?.dropoff_location?.phone ?? '').trim();
                const rawDropAddr = String(formData?.dropoff_location?.address ?? '').trim();
                const rawTxnId = String(formData?.transaction?.transaction_id ?? '').trim();

                const textForParse = String(receiptText ?? '');
                const pickupAddress = rawPickupAddr || extractPickupAddressFromText(textForParse) || '';
                const dropAddress = rawDropAddr || extractDropoffAddressFromText(textForParse) || '';
                const txnId = rawTxnId || extractTransactionIdFromText(textForParse) || '';

                return (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs font-medium text-gray-500">Route / Service Area</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{pricingCity || '—'}</div>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs font-medium text-gray-500">Service Type</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{serviceTypeLabel}</div>
                      </div>
                    </div>

                    {costData && (
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <div className="text-xs font-medium text-gray-500">Retail Price (before tax)</div>
                        <div className="mt-1 text-3xl font-bold text-cyan-600">${costData.cost}</div>
                        <div className="text-sm text-gray-500 mt-1">+ applicable tax</div>
                        <div className="mt-3 text-sm text-gray-700">
                          <span className="font-medium">Estimated fulfillment time:</span> {fulfillment}
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-4 shadow-sm">
                      <div className="text-sm font-semibold text-gray-900 mb-3">Order Details</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                        <div className="rounded-lg bg-white border border-gray-200 p-3">
                          <div className="text-xs font-medium text-gray-500">Pickup</div>
                          <div className="mt-1 font-semibold text-gray-900">{pickupName || pickupAddress || '—'}</div>
                          {pickupPhone && <div className="mt-1">{pickupPhone}</div>}
                          {pickupAddress && pickupName && <div className="mt-1 text-gray-600">{pickupAddress}</div>}
                        </div>
                        <div className="rounded-lg bg-white border border-gray-200 p-3">
                          <div className="text-xs font-medium text-gray-500">Drop-off</div>
                          <div className="mt-1 font-semibold text-gray-900">{dropName || dropAddress || '—'}</div>
                          {dropPhone && <div className="mt-1">{dropPhone}</div>}
                          {dropAddress && dropName && <div className="mt-1 text-gray-600">{dropAddress}</div>}
                        </div>
                        <div className="rounded-lg bg-white border border-gray-200 p-3 sm:col-span-2">
                          <div className="text-xs font-medium text-gray-500">Transaction ID</div>
                          <div className="mt-1 font-semibold text-gray-900">{txnId || '—'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="text-sm font-semibold text-gray-900 mb-3">Receipt Text</div>
                      <pre className="whitespace-pre-wrap text-base leading-7 text-gray-800 max-h-[45vh] overflow-auto">
                        {receiptText}
                      </pre>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-500">You can close this receipt and upload a new document.</div>
                <div className="flex flex-col sm:flex-row gap-3">
                  {!isLoggedIn && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsReceiptOpen(false);
                          setReceiptText(null);
                          setReceiptCopied(false);
                        }}
                        className="inline-flex justify-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsReceiptOpen(false);
                          setReceiptText(null);
                          setReceiptCopied(false);
                          onContinueToSignIn?.();
                        }}
                        className="inline-flex justify-center rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                      >
                        Continue
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {!hideHeader && (
        <div className="mb-6">
          <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-1 sm:mb-2">Upload Documents</h3>
          <p className="text-sm sm:text-base text-gray-600">Upload vehicle release forms, work orders, or any related documentation</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
      />

      {uploadedFiles.length === 0 && !formData && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`p-6 sm:p-10 transition-all md:rounded-l-2xl ${
                dragActive ? 'bg-cyan-50' : 'bg-white'
              }`}
            >
              <div className="flex flex-col items-center text-center">
                <div className="bg-cyan-50 p-4 rounded-full mb-4 ring-1 ring-cyan-100">
                  <Upload className="w-10 h-10 text-cyan-600" />
                </div>
                <div className="text-sm font-semibold text-cyan-700 mb-1">Automatic Extraction</div>
                <div className="text-lg font-semibold text-gray-900">Upload Release Form</div>
                <div className="mt-2 max-w-md text-sm text-gray-600">
                  Upload the release form or work order and we will automatically extract the details for you.
                </div>

                <div
                  className={`mt-6 w-full max-w-md min-h-[200px] rounded-2xl border-2 border-dashed px-5 py-6 transition-colors flex flex-col items-center ${
                    dragActive ? 'border-cyan-500 bg-cyan-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="text-center">
                    <div className="text-sm font-medium text-gray-800">Drag and drop your file here</div>
                    <div className="mt-1 text-xs text-gray-500">or</div>
                  </div>
                  <button
                    type="button"
                    onClick={onButtonClick}
                    className="mt-auto w-full bg-cyan-500 text-white px-6 py-3 rounded-lg hover:bg-cyan-600 transition-colors font-semibold"
                  >
                    Browse Files
                  </button>
                  <div className="mt-3 text-xs text-gray-500 text-center">
                    Supported formats: PDF, DOC, DOCX, JPG, PNG (Max 10MB)
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t md:border-t-0 md:border-l border-gray-200 p-6 sm:p-10 md:rounded-r-2xl bg-gray-50">
              <div className="flex flex-col items-center text-center">
                <div className="bg-white p-4 rounded-full mb-4 ring-1 ring-gray-200">
                  <FileText className="w-10 h-10 text-gray-700" />
                </div>
                <div className="text-sm font-semibold text-gray-700 mb-1">Manual Entry</div>
                <div className="text-lg font-semibold text-gray-900">Fill Out the Form</div>
                <div className="mt-2 max-w-md text-sm text-gray-600">
                  Use this option if you don’t have a release form file. You can manually enter pickup, drop-off, and vehicle details.
                </div>

                <div className="mt-6 w-full max-w-md min-h-[200px] rounded-2xl border border-gray-200 bg-white px-5 py-6 flex flex-col items-center">
                  <div className="text-center text-sm font-medium text-gray-800">No file to upload?</div>
                  <div className="mt-1 text-center text-xs text-gray-500">Use manual entry instead.</div>

                  <button
                    type="button"
                    onClick={() => {
                      clearPersisted();
                      setSubmitMessage(null);
                      setSubmitError(false);
                      setReceiptText(null);
                      setIsReceiptOpen(false);
                      setUploadedFiles([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setFormData(createBlankFormData());
                      setIsManualFormOpen(true);
                    }}
                    className="mt-auto w-full px-6 py-3 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors font-semibold"
                  >
                    Open Manual Form
                  </button>

                  <div className="mt-3 text-xs text-gray-500 text-center">
                    Tip: Manual entry is best when the file is unclear or incomplete.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isManualFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeManualForm();
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-5xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
            <div className="flex-shrink-0 bg-white flex items-center justify-between px-6 py-4 border-b border-gray-100 rounded-t-2xl">
              <div>
                <div className="text-lg font-semibold text-gray-900">Manual Form</div>
                <div className="text-sm text-gray-500">Fill out the form manually</div>
              </div>
              <button
                type="button"
                onClick={closeManualForm}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 overflow-y-auto flex-1 min-h-0">
              <form onSubmit={preventFormSubmit}>
              {renderFormDetails()}

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    clearPersisted();
                    setUploadedFiles([]);
                    setSubmitMessage(null);
                    setSubmitError(false);
                    setReceiptText(null);
                    setIsReceiptOpen(false);
                    closeManualForm();
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={handleSubmitDocuments}
                  disabled={isSubmitting}
                  className="px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Document'}
                </button>
              </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {!isManualFormOpen && (uploadedFiles.length > 0 || formData) && (
        <div className="mt-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h4 className="text-base sm:text-lg font-semibold text-gray-800">Uploaded Files</h4>
            <button
              type="button"
              onClick={onButtonClick}
              className="w-full sm:w-auto px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Replace File
            </button>
          </div>
          {uploadedFiles.length > 0 ? (
            <div className="space-y-3">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-gray-200 rounded-lg p-4 hover:border-cyan-500 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="bg-cyan-50 p-2 rounded">
                      <FileText className="w-6 h-6 text-cyan-500" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{file.name}</p>
                      <p className="text-sm text-gray-500">{file.size}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end space-x-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <button
                      type="button"
                      onClick={() => removeFile(file.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              No file selected (page refresh clears the file). Use “Replace File” if you need to upload again.
            </div>
          )}

          {submitMessage && (
            <div className={`mt-4 text-sm font-medium ${submitError ? 'text-red-600' : 'text-green-600'}`}>
              {submitMessage}
            </div>
          )}

          <form onSubmit={preventFormSubmit}>
            {renderFormDetails()}

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  clearPersisted();
                  setUploadedFiles([]);
                  setSubmitMessage(null);
                  setSubmitError(false);
                  setReceiptText(null);
                  setIsReceiptOpen(false);
                  setFormData(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Clear All
              </button>
              <button
                type="button"
                onClick={handleSubmitDocuments}
                disabled={isSubmitting}
                className="px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : formData ? 'Submit Document' : 'Extract Document'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
