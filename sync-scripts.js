const https = require('https');
const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname, 'scripts');

// Ensure the scripts directory exists
if (!fs.existsSync(scriptsDir)) {
  fs.mkdirSync(scriptsDir, { recursive: true });
}

// The raw GitHub URLs for your master bash scripts
const files = [
  { url: 'https://raw.githubusercontent.com/iamPrashanta/dbbkp/main/dbbkp.sh', name: 'dbbkp.sh' },
  { url: 'https://raw.githubusercontent.com/iamPrashanta/dbbkp/main/infra-agent.sh', name: 'infra-agent.sh' }
];

console.log("🔄 Syncing latest agent scripts from GitHub...");

files.forEach(file => {
  const filePath = path.join(scriptsDir, file.name);
  const fileStream = fs.createWriteStream(filePath);
  
  https.get(file.url, response => {
    if (response.statusCode !== 200) {
      console.error(`❌ Failed to download ${file.name} (Status Code: ${response.statusCode})`);
      return;
    }

    response.pipe(fileStream);
    
    fileStream.on('finish', () => {
      fileStream.close();
      
      // Make it executable (only applies to Linux/macOS environments)
      try {
        fs.chmodSync(filePath, '755');
      } catch (e) {
        // Ignore chmod errors on Windows
      }
      
      console.log(`✅ Successfully synced ${file.name}`);
    });
  }).on('error', err => {
    fs.unlink(filePath, () => {});
    console.error(`❌ Error downloading ${file.name}: ${err.message}`);
  });
});
