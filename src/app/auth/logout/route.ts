import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { clearUserSession } from '@/lib/session';

export async function POST() {
  await clearUserSession();
  return NextResponse.redirect(new URL('/', env.siteUrl), { status: 303 });
}
