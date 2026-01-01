
const { GoogleGenAI, Type } = require("@google/genai");
const Parser = require("rss-parser");

const CONFIG = {
  GEMINI_KEY: process.env.GEMINI_API_KEY,
  INSTA_PAGE_ID: process.env.INSTA_PAGE_ID,
  INSTA_TOKEN: process.env.INSTA_ACCESS_TOKEN,
  IMGBB_KEY: process.env.IMGBB_API_KEY,
  TONE: "Hyped & Energetic"
};

const parser = new Parser();
const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
  console.log("-----------------------------------------");
  console.log("🚀 STARTING AI NEWS AUTOMATION ENGINE");
  console.log("-----------------------------------------");

  if (!CONFIG.GEMINI_KEY || !CONFIG.INSTA_TOKEN || !CONFIG.INSTA_PAGE_ID || !CONFIG.IMGBB_KEY) {
    throw new Error("Missing Secrets! Ensure GEMINI_API_KEY, INSTA_PAGE_ID, INSTA_ACCESS_TOKEN, and IMGBB_API_KEY are set in GitHub.");
  }

  // 1. FETCH NEWS
  console.log("[1/5] 📡 Fetching RSS Feeds...");
  const sources = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"
  ];
  
  let allItems = [];
  for (const url of sources) {
    try {
      const feed = await parser.parseURL(url);
      console.log(`   ✅ ${url}`);
      allItems = [...allItems, ...feed.items.slice(0, 3)];
    } catch (e) {
      console.warn(`   ⚠️  Feed skip: ${url}`);
    }
  }

  if (allItems.length === 0) throw new Error("No news found.");

  // 2. GENERATE CONTENT
  console.log("[2/5] 🤖 Generating Copy with Gemini...");
  const contentResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Summarize these news items for Instagram. Tone: ${CONFIG.TONE}. News: ${JSON.stringify(allItems.map(i => i.title))}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          imagePrompt: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          summaryPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["caption", "imagePrompt", "hashtags", "summaryPoints"]
      }
    }
  });
  const postData = JSON.parse(contentResponse.text);

  // 3. GENERATE IMAGE (With Retry for 429)
  console.log("[3/5] 🎨 Creating AI Background...");
  let imageBase64;
  let attempts = 0;
  while (attempts < 3) {
    try {
      const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: "Futuristic neon background: " + postData.imagePrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      imageBase64 = imageResponse.candidates[0].content.parts.find(p => p.inlineData).inlineData.data;
      break;
    } catch (err) {
      attempts++;
      if (err.message.includes("429") || err.message.includes("quota")) {
        console.warn(`   ⚠️  Rate limited! Waiting 20s (Attempt ${attempts}/3)... observer billing limits at ai.google.dev/gemini-api/docs/billing`);
        await sleep(20000);
      } else {
        throw err;
      }
    }
  }
  if (!imageBase64) throw new Error("Failed to generate image after retries.");

  // 4. HOST IMAGE
  console.log("[4/5] ☁️ Uploading to ImgBB...");
  const formData = new URLSearchParams();
  formData.append("image", imageBase64);
  const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_KEY}`, {
    method: "POST",
    body: formData
  });
  const imgbbJson = await imgbbRes.json();
  const publicImageUrl = imgbbJson.data.url;

  // 5. POST TO INSTAGRAM
  console.log("[5/5] 📱 Publishing to Instagram...");
  const containerRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_PAGE_ID}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: publicImageUrl,
      caption: postData.caption + "\n\n" + postData.hashtags.map(h => "#"+h).join(" "),
      access_token: CONFIG.INSTA_TOKEN
    })
  });
  const container = await containerRes.json();
  if (container.error) throw new Error("Meta Error: " + container.error.message);

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_PAGE_ID}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: CONFIG.INSTA_TOKEN })
  });
  const publishJson = await publishRes.json();

  console.log("-----------------------------------------");
  console.log("✅ SUCCESS! POST ID: " + publishJson.id);
  console.log("-----------------------------------------");
}

run().catch(err => {
  console.error("\n🚨 ERROR: " + err.message);
  process.exit(1);
});
