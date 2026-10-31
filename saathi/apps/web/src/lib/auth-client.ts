'use client';

import { createAuthClient } from 'better-auth/react';

// Same-origin Better Auth client (no base URL needed in the browser).
export const authClient = createAuthClient();
