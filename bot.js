
const { GoogleGenAI, Type } = require("@google/genai");
const Parser = require("rss-parser");

const CONFIG = {
  GEMINI_KEY: process.env.GEMINI_API_KEY,
  INSTA_ID: process.env.INSTA_PAGE_ID, 
  INSTA_TOKEN: process.env.INSTA_ACCESS_TOKEN,
  IMGBB_KEY: process.env.IMGBB_API_KEY,
  TONE: "Hyped & Energetic",
  FALLBACK_IMAGE: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=1000&auto=format&fit=crop" 
};

const parser = new Parser();
const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

async function run() {
  console.log("-----------------------------------------");
  console.log("🚀 STARTING INSTAGRAM BOT V2.2 (AUTH CHECK)");
  console.log("-----------------------------------------");

  // 1. FETCH NEWS
  console.log("[1/4] 📡 Fetching RSS Feeds...");
  let allItems = [];
  try {
    const feed = await parser.parseURL("https://techcrunch.com/category/artificial-intelligence/feed/");
    allItems = feed.items.slice(0, 3);
  } catch (e) { throw new Error("RSS Fetch Failed."); }

  // 2. GENERATE TEXT
  console.log("[2/4] 🤖 Generating Viral Copy...");
  const contentResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Summarize for IG: ${JSON.stringify(allItems.map(i => i.title))}. Tone: ${CONFIG.TONE}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["caption", "hashtags"]
      }
    }
  });
  const postData = JSON.parse(contentResponse.text);

  // 3. IMAGE LOGIC
  console.log("[3/4] 🎨 Preparing Media...");
  let finalImageUrl = CONFIG.FALLBACK_IMAGE;
  try {
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: "Abstract tech background, neon, professional" }] },
    });
    const imgPart = imageResponse.candidates[0].content.parts.find(p => p.inlineData);
    if (imgPart) {
      const formData = new URLSearchParams();
      formData.append("image", imgPart.inlineData.data);
      const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_KEY}`, { method: "POST", body: formData });
      const imgbbJson = await imgbbRes.json();
      finalImageUrl = imgbbJson.data.url;
    }
  } catch (err) { console.warn("   ⚠️ Image Quota Limit Hit. Using Fallback."); }

  // 4. POST TO INSTAGRAM
  console.log("[4/4] 📱 Publishing to Meta Graph...");
  
  const containerRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_ID}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: finalImageUrl,
      caption: postData.caption + "\n\n" + postData.hashtags.map(h => "#"+h).join(" "),
      access_token: CONFIG.INSTA_TOKEN
    })
  });
  
  const container = await containerRes.json();
  
  if (!containerRes.ok || container.error) {
    console.error("   ❌ META GRAPH REJECTED REQUEST");
    console.error("   MESSAGE: " + (container.error?.message || "Unknown Error"));
    
    // PERMISSION CHECKER
    if (containerRes.status === 403 || container.error?.message?.toLowerCase().includes("permission")) {
      console.error("\n   🚨 PERMISSION ERROR DETECTED!");
      console.error("   💡 You likely forgot to check 'instagram_content_publish'.");
      console.error("   💡 Please check your Token permissions in Meta Graph Explorer.");
    }
    throw new Error("Meta Graph Media Container Creation Failed.");
  }

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_ID}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: CONFIG.INSTA_TOKEN })
  });

  const publishJson = await publishRes.json();
  console.log("-----------------------------------------");
  console.log("✅ SUCCESS! POST IS LIVE. ID: " + publishJson.id);
  console.log("-----------------------------------------");
}

run().catch(err => {
  console.error("\n🚨 FATAL ERROR: " + err.message);
  process.exit(1);
});
