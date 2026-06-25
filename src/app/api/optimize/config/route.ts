import { NextResponse } from 'next/server';

/**
 * Returns server optimization capabilities.
 * The frontend uses this to decide whether to precompute an OSRM matrix
 * or let the server handle everything via Geoapify.
 */
export async function GET() {
  const geoapifyKey = process.env.GEOAPIFY_API_KEY;

  return NextResponse.json({
    hasGeoapify: !!geoapifyKey,
    maxLocations: geoapifyKey ? 500 : 100,
  });
}
