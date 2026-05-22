const fs = require('fs');
const https = require('https');
const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");

// 1. Download a test image directly on the server
const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/8/8d/President_Barack_Obama.jpg";
const localPath = "./debug-face.jpg";

console.log("📥 Downloading test image...");
const file = fs.createWriteStream(localPath);
https.get(imageUrl, function(response) {
  response.pipe(file);
  file.on('finish', () => {
    file.close(async () => {
      const stats = fs.statSync(localPath);
      console.log(`💾 File saved to: ${localPath}`);
      console.log(`📏 File size: ${stats.size} bytes`);

      if (stats.size === 0) {
        console.error("❌ Error: Downloaded file is empty!");
        return;
      }

      // 2. Try AWS Rekognition
      console.log("🧠 Sending to AWS Rekognition...");
      try {
        const rekognition = new RekognitionClient({ region: "us-east-1" });
        const command = new DetectFacesCommand({
          Image: { Bytes: fs.readFileSync(localPath) },
          Attributes: ["DEFAULT"]
        });
        
        const data = await rekognition.send(command);
        console.log("✅ AWS Response Received!");
        console.log(`👥 Faces detected: ${data.FaceDetails ? data.FaceDetails.length : 0}`);
        
        if (data.FaceDetails && data.FaceDetails.length > 0) {
          console.log("🎉 SUCCESS: Face verified!");
        } else {
          console.log("⚠️ FAILED: No faces detected in image.");
        }
      } catch (err) {
        console.error("❌ AWS REKOGNITION ERROR DETAILS:");
        console.error(err);
      } finally {
        // Clean up the debug file
        fs.unlinkSync(localPath);
        console.log("🧹 Cleaned up debug image file.");
      }
    });
  });
}).on('error', (err) => {
  console.error("Download failed:", err);
});
