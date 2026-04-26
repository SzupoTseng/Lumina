import type { NextApiRequest, NextApiResponse } from 'next';

// Simple in-memory rate limiter: 10 requests per minute per IP
const attempts = new Map<string, { count: number; start: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, start: now };
  if (now - entry.start > 60_000) { attempts.set(ip, { count: 1, start: now }); return false; }
  entry.count++;
  attempts.set(ip, entry);
  return entry.count > 10;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit
  const ip = req.socket?.remoteAddress ?? '127.0.0.1';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Validate token field
  const body = req.body as Record<string, unknown> | null;
  const refresh_token = body?.refresh_token;
  if (!refresh_token || typeof refresh_token !== 'string' || refresh_token.length > 2048) {
    return res.status(400).json({ error: 'Invalid or missing refresh_token' });
  }

  try {
    const response = await fetch('https://restream-token-fetcher.vercel.app/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    const data = await response.json();
    return response.ok ? res.json(data) : res.status(response.status).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
}
