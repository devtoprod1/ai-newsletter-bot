
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

async function run() {
  console.log("🚀 Starting Daily AI News Automation...");

  // 1. Fetch News from 3 Sources
  const sources = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml",
    "https://arstechnica.com/tag/ai/feed/"
  ];
  
  let allItems = [];
  for (const url of sources) {
    try {
      const feed = await parser.parseURL(url);
      allItems = [...allItems, ...feed.items.slice(0, 3)];
    } catch (e) {
      console.warn("⚠️ Could not fetch from: " + url);
    }
  }

  // 2. Generate Content with Gemini
  console.log("🤖 Generating viral content with Gemini...");
  const contentResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze these news items and create a hyped Instagram post with 4 summary points. Tone: ${CONFIG.TONE}. News: ${JSON.stringify(allItems.map(i => ({t: i.title, d: i.contentSnippet})))}`,
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

  // 3. Generate Hyped Background Image
  console.log("🎨 Generating energetic background image...");
  const imageResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: "Vibrant, neon, futuristic background: " + postData.imagePrompt }] },
    config: { imageConfig: { aspectRatio: "1:1" } }
  });
  
  const base64Image = imageResponse.candidates[0].content.parts.find(p => p.inlineData).inlineData.data;

  // 4. Host Image on ImgBB
  console.log("☁️ Uploading image to ImgBB...");
  const formData = new FormData();
  formData.append("image", base64Image);
  const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_KEY}`, {
    method: "POST",
    body: formData
  });
  const imgbbJson = await imgbbRes.json();
  const publicImageUrl = imgbbJson.data.url;

  // 5. Post to Instagram
  console.log("📱 Publishing to Instagram...");
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
  
  if (!container.id) throw new Error("Failed to create container: " + JSON.stringify(container));

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_PAGE_ID}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: CONFIG.INSTA_TOKEN })
  });
  const publishJson = await publishRes.json();

  console.log("✅ Success! Post ID: " + publishJson.id);
}

run().catch(err => {
  console.error("❌ Automation failed:", err);
  process.exit(1);
});
