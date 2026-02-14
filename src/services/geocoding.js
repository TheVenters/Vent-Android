const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'VentApp/1.0';

/**
 * Search for locations using OpenStreetMap Nominatim.
 * @param {string} query - The search string
 * @param {number} limit - Max results (default 5)
 * @returns {Promise<Array<{displayName: string, latitude: number, longitude: number}>>}
 */
export const searchLocations = async (query, limit = 5) => {
  if (!query || !query.trim()) return [];

  try {
    const params = new URLSearchParams({
      q: query.trim(),
      format: 'json',
      limit: String(limit),
    });

    const response = await fetch(`${NOMINATIM_BASE}?${params.toString()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const data = await response.json();

    return data.map((item) => ({
      displayName: item.display_name,
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
    }));
  } catch (error) {
    console.error('Geocoding search error:', error);
    return [];
  }
};
