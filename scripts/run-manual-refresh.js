import http from 'http';
// import dotenv from 'dotenv'; // Will be conditionally imported

async function main() {
  // Conditionally load dotenv only if not in production and a key var isn't already set
  if (process.env.NODE_ENV !== 'production' && !process.env.LOCAL_CRON_SCRIPT_SECRET) {
    try {
      const dotenv = await import('dotenv');
      dotenv.config();
      console.log('dotenv loaded by script.');
    } catch (e) {
      console.warn('dotenv could not be loaded by script:', e.message);
    }
  }

  // Load environment variables from .env if you use it for local secrets
  // If you're not using dotenv, ensure LOCAL_CRON_SCRIPT_SECRET is available in your environment
  // import dotenv from 'dotenv'; // Example if using ESM for dotenv
  // dotenv.config(); 

  const PORT = process.env.PORT || 3000; 
  // This should now reliably load from your .env file if dotenv ran correctly
  const LOCAL_SCRIPT_SECRET = process.env.LOCAL_CRON_SCRIPT_SECRET || "your-default-manual-script-secret"; // Use a default if not set, but prefer .env

  await triggerRefresh(PORT, LOCAL_SCRIPT_SECRET);
}

async function triggerRefresh(PORT, LOCAL_SCRIPT_SECRET) {
  console.log(`[${new Date().toISOString()}] Manually triggering refreshFreeTierCredits job via script...`);
  console.log(`Targeting: http://localhost:${PORT}/api/dev/trigger-refresh-credits`);

  // This warning should NOT appear if dotenv loaded the variable
  if (!process.env.LOCAL_CRON_SCRIPT_SECRET) {
    console.warn("WARN: LOCAL_CRON_SCRIPT_SECRET was not found in environment. Using default.");
    if (LOCAL_SCRIPT_SECRET === "your-default-manual-script-secret"){
       console.error("ERROR: Failed to load secret from .env file and using unsafe default!");
    }
  }

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/api/dev/trigger-refresh-credits',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOCAL_SCRIPT_SECRET}`,
      'Content-Type': 'application/json',
    },
  };

  const req = http.request(options, (res) => {
    let data = '';
    console.log(`[${new Date().toISOString()}] API Call Status Code: ${res.statusCode}`);

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log(`[${new Date().toISOString()}] API Response:`);
      try {
        console.log(JSON.stringify(JSON.parse(data), null, 2));
      } catch {
        // If not JSON, log raw data. Removed unused 'e' variable.
        console.log(data);
      }
      
      if (res.statusCode === 200) {
        console.log(`\n[${new Date().toISOString()}] refreshFreeTierCredits job initiated successfully via API.`);
      } else {
        console.error(`\n[${new Date().toISOString()}] refreshFreeTierCredits job initiation failed via API.`);
      }
    });
  });

  req.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Error triggering job via API:`, error.message);
    console.error("Ensure your Next.js development server (npm run dev) is running and the API endpoint is correct.");
    console.error("Also check if the LOCAL_CRON_SCRIPT_SECRET in your .env matches the one in the API route.");
  });

  // Send an empty body for POST if not sending data, or stringify an object if needed
  req.write(JSON.stringify({ triggerTime: new Date().toISOString() })); 
  req.end();
}

main().catch(err => {
  console.error("Script execution failed:", err);
  process.exit(1);
}); 