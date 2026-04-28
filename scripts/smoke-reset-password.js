// File purpose: Command-line smoke test for the password reset edge function.

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parses command-line flags into a simple options object.
const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
};

// Loads key-value pairs from the local .env file for command-line scripts.
const loadDotEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

// Prints the required command-line arguments for the smoke test.
const printUsage = () => {
  console.log(
    [
      'Usage:',
      '  npm run smoke:reset -- --email <email> --token <otp> --password <new-password>',
      '',
      'Optional:',
      '  --url <supabase-url> (defaults to EXPO_PUBLIC_SUPABASE_URL)',
      '  --anon-key <publishable-key> (defaults to EXPO_PUBLIC_SUPABASE_ANON_KEY)',
    ].join('\n'),
  );
};

// Runs the command-line workflow for this script or edge action dispatcher.
const main = async () => {
  if (typeof fetch !== 'function') {
    console.error('Node 18+ is required (global fetch missing).');
    process.exit(1);
  }

  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  const email = String(args.email || '').trim();
  const token = String(args.token || '').trim();
  const newPassword = String(args.password || '').trim();
  const supabaseUrl = String(
    args.url || process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  ).trim();
  const anonKey = String(
    args['anon-key'] || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  ).trim();

  if (!email || !token || !newPassword) {
    console.error('Missing required arguments.');
    printUsage();
    process.exit(1);
  }

  if (!supabaseUrl || !anonKey) {
    console.error(
      'Missing Supabase URL or publishable key. Provide via .env or flags.',
    );
    process.exit(1);
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/reset-password-with-otp`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, token, newPassword }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {}

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.msg ||
      payload?.error_description ||
      `HTTP ${response.status}`;
    console.error(`FAIL: ${message}`);
    if (payload) console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  if (!payload?.success) {
    console.error('FAIL: Function returned success=false or unexpected payload.');
    if (payload) console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log('PASS: Password reset flow completed through edge function.');
};

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
